"""Unique confirm/complete sounds: character SFX plus Edge TTS lines."""

from __future__ import annotations

import math
import random
import struct
import subprocess
import tempfile
import time
import wave
from pathlib import Path

SR = 44100


def write_wav(path: Path, samples: list[float]) -> None:
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        frames = b"".join(
            struct.pack("<h", max(-32767, min(32767, int(sample * 32767))))
            for sample in samples
        )
        handle.writeframes(frames)


def read_wav(path: Path) -> list[float]:
    with wave.open(str(path), "r") as handle:
        raw = handle.readframes(handle.getnframes())
        return [struct.unpack_from("<h", raw, i)[0] / 32768.0 for i in range(0, len(raw), 2)]


def env(index: int, total: int, attack: float = 0.01, release: float = 0.22) -> float:
    attack_gain = min(1.0, (index / SR) / attack) if attack else 1.0
    t = index / max(1, total)
    release_gain = 1.0
    rel_start = 1.0 - release
    if t > rel_start:
        release_gain = max(0.0, 1.0 - (t - rel_start) / release)
    return attack_gain * release_gain


def mix(*tracks: list[float]) -> list[float]:
    length = max((len(track) for track in tracks), default=0)
    out = [0.0] * length
    for track in tracks:
        for i, value in enumerate(track):
            out[i] += value
    peak = max(1e-9, max((abs(value) for value in out), default=0.0))
    if peak > 0.95:
        out = [value * 0.95 / peak for value in out]
    return out


def offset(samples: list[float], delay: float) -> list[float]:
    return [0.0] * int(SR * delay) + samples


def pad(samples: list[float], lead: float = 0.02, tail: float = 0.08) -> list[float]:
    return [0.0] * int(SR * lead) + samples + [0.0] * int(SR * tail)


def sine(freq: float, dur: float, gain: float, attack: float = 0.01, release: float = 0.25) -> list[float]:
    n = int(SR * dur)
    return [math.sin(2 * math.pi * freq * i / SR) * gain * env(i, n, attack, release) for i in range(n)]


def noise(dur: float, gain: float, rng: random.Random, attack: float = 0.004, release: float = 0.2) -> list[float]:
    n = int(SR * dur)
    return [rng.uniform(-1.0, 1.0) * gain * env(i, n, attack, release) for i in range(n)]


def bandpass(samples: list[float], freq: float, q: float = 4.0) -> list[float]:
    w0 = 2 * math.pi * freq / SR
    alpha = math.sin(w0) / (2 * q)
    b0 = alpha
    b1 = 0.0
    b2 = -alpha
    a0 = 1 + alpha
    a1 = -2 * math.cos(w0)
    a2 = 1 - alpha
    x1 = x2 = y1 = y2 = 0.0
    out = []
    for x in samples:
        y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2
        out.append(y)
        x2, x1 = x1, x
        y2, y1 = y1, y
    return out


def plucked(freq: float, dur: float, gain: float, rng: random.Random) -> list[float]:
    n = int(SR * dur)
    period = max(2, int(SR / freq))
    buf = [rng.uniform(-1.0, 1.0) for _ in range(period)]
    out = []
    idx = 0
    for i in range(n):
        sample = buf[idx]
        nxt = buf[(idx + 1) % period]
        buf[idx] = 0.996 * 0.5 * (sample + nxt)
        out.append(sample * gain * env(i, n, 0.001, 0.4))
        idx = (idx + 1) % period
    return out


def sfx_for(kind: str, role: str) -> list[float]:
    rng = random.Random(f"{kind}-{role}")
    short = role == "confirm"
    if kind == "bell":
        freqs = (784.0, 1176.9, 1568.0) if short else (523.25, 784.0, 1046.5, 1318.5)
        tracks = [sine(freq, 0.22 if short else 0.55, 0.16 / (i + 1), 0.004, 0.55) for i, freq in enumerate(freqs)]
        return mix(*tracks)
    if kind == "leaf":
        rustle = bandpass(noise(0.18 if short else 0.36, 0.55, rng, 0.002, 0.25), 2800, 1.6)
        return mix(rustle, sine(784 if short else 659, 0.12, 0.08, 0.01, 0.3))
    if kind == "pluck":
        return plucked(196 if short else 147, 0.28 if short else 0.5, 0.42, rng)
    if kind == "drip":
        n = int(SR * (0.22 if short else 0.4))
        drop = []
        for i in range(n):
            t = i / SR
            freq = 920 - 640 * min(1.0, t / 0.16)
            drop.append(math.sin(2 * math.pi * freq * t) * 0.28 * env(i, n, 0.004, 0.45))
        splash = bandpass(noise(0.08, 0.22, rng, 0.001, 0.2), 1800, 2.2)
        return mix(drop, offset(splash, 0.09))
    if kind == "glass":
        wobble = []
        n = int(SR * (0.3 if short else 0.55))
        for i in range(n):
            t = i / SR
            sample = math.sin(2 * math.pi * 740 * t) * (1 + 0.18 * math.sin(2 * math.pi * 6 * t))
            sample += 0.35 * math.sin(2 * math.pi * 1110 * t)
            wobble.append(sample * 0.18 * env(i, n, 0.02, 0.5))
        return wobble
    if kind == "ceramic":
        clink = mix(sine(1480, 0.08, 0.2, 0.001, 0.7), sine(2230, 0.06, 0.1, 0.001, 0.6))
        pour = bandpass(noise(0.14 if short else 0.28, 0.18, rng, 0.02, 0.3), 900, 1.1)
        return mix(clink, offset(pour, 0.04))
    if kind == "paper":
        bursts = [offset(bandpass(noise(0.05, 0.35, rng, 0.001, 0.4), 2400, 1.3), i * 0.04) for i in range(2 if short else 4)]
        return mix(*bursts)
    if kind == "rain":
        drops = []
        count = 5 if short else 11
        for i in range(count):
            tick = bandpass(noise(0.035, 0.28, rng, 0.001, 0.5), 1600 + i * 90, 2.4)
            drops.append(offset(tick, i * (0.035 if short else 0.045)))
        return mix(*drops)
    if kind == "wood":
        hit = mix(sine(210, 0.09, 0.28, 0.001, 0.55), sine(640, 0.06, 0.12, 0.001, 0.5))
        knock = bandpass(noise(0.04, 0.2, rng, 0.001, 0.4), 420, 3.0)
        return mix(hit, knock)
    if kind == "snap":
        click = bandpass(noise(0.03, 0.4, rng, 0.001, 0.35), 3200, 4.0)
        body = sine(180, 0.08, 0.16, 0.001, 0.45)
        return mix(click, body)
    if kind == "steam":
        hiss = bandpass(noise(0.2 if short else 0.38, 0.22, rng, 0.03, 0.35), 4200, 0.8)
        puff = sine(140, 0.12, 0.1, 0.02, 0.4)
        return mix(hiss, puff)
    if kind == "bubble":
        pops = []
        for i, freq in enumerate((620, 740, 510)[: 2 if short else 3]):
            n = int(SR * 0.09)
            pop = [math.sin(2 * math.pi * (freq + 80 * math.sin(40 * i / SR)) * i / SR) * 0.18 * env(i, n, 0.004, 0.5) for i in range(n)]
            pops.append(offset(pop, i * 0.07))
        wash = bandpass(noise(0.22 if short else 0.4, 0.08, rng, 0.02, 0.4), 700, 0.9)
        return mix(wash, *pops)
    if kind == "stone":
        thud = mix(sine(92, 0.16, 0.32, 0.002, 0.45), sine(140, 0.12, 0.12, 0.002, 0.4))
        grit = bandpass(noise(0.08, 0.16, rng, 0.001, 0.35), 280, 1.4)
        return mix(thud, grit)
    if kind == "yip":
        n = int(SR * (0.16 if short else 0.28))
        out = []
        for i in range(n):
            t = i / SR
            freq = 420 + 380 * math.sin(math.pi * min(1.0, t / 0.12))
            formant = math.sin(2 * math.pi * freq * t) + 0.4 * math.sin(2 * math.pi * freq * 2.1 * t)
            out.append(formant * 0.2 * env(i, n, 0.008, 0.35))
        return out
    if kind == "hoot":
        first = sine(220, 0.16 if short else 0.22, 0.22, 0.03, 0.4)
        second = sine(185, 0.18, 0.18, 0.03, 0.45) if not short else []
        return mix(first, offset(second, 0.14)) if second else first
    if kind == "nut":
        first = mix(sine(310, 0.08, 0.22, 0.001, 0.5), bandpass(noise(0.04, 0.18, rng, 0.001, 0.4), 900, 2.2))
        bounce = mix(sine(260, 0.06, 0.14, 0.001, 0.5), bandpass(noise(0.03, 0.12, rng, 0.001, 0.4), 800, 2.0))
        return mix(first, offset(bounce, 0.09 if short else 0.12))
    if kind == "crunch":
        ticks = [offset(bandpass(noise(0.03, 0.28, rng, 0.001, 0.4), 1400 + i * 200, 1.8), i * 0.028) for i in range(3 if short else 5)]
        return mix(*ticks)
    return sine(440, 0.2, 0.16)


def tts_wav(text: str, voice: str, rate: str, pitch: str, dest: Path) -> list[float]:
    mp3 = dest.with_suffix(".mp3")
    cmd = [
        "edge-tts",
        "--voice",
        voice,
        f"--rate={rate}",
        f"--pitch={pitch}",
        "--text",
        text,
        "--write-media",
        str(mp3),
    ]
    last_error = None
    for attempt in range(4):
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and mp3.exists() and mp3.stat().st_size > 0:
            break
        last_error = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        time.sleep(0.8 * (attempt + 1))
    else:
        raise RuntimeError(f"edge-tts failed for {voice!r} {text!r}: {last_error}")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(mp3), "-ac", "1", "-ar", str(SR), str(dest)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    samples = read_wav(dest)
    peak = max(1e-9, max(abs(value) for value in samples))
    return [value * 0.78 / peak for value in samples]


def to_mp3(wav_path: Path, mp3_path: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav_path), "-codec:a", "libmp3lame", "-qscale:a", "4", str(mp3_path)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    wav_path.unlink(missing_ok=True)


def write_sounds(char: dict, sound_dir: Path) -> None:
    sound_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"halo-{char['id']}-") as tmp:
        tmp_dir = Path(tmp)
        confirm_tts = tts_wav(char["confirm_text"], char["voice"], char["rate"], char["pitch"], tmp_dir / "confirm.wav")
        complete_tts = tts_wav(char["complete_text"], char["voice"], char["rate"], char["pitch"], tmp_dir / "complete.wav")
        confirm = mix(sfx_for(char["sfx"], "confirm"), offset(confirm_tts, 0.04))
        complete = mix(sfx_for(char["sfx"], "complete"), offset(complete_tts, 0.08))
        confirm_wav = sound_dir / "confirm.wav"
        complete_wav = sound_dir / "complete.wav"
        write_wav(confirm_wav, pad(confirm, 0.02, 0.06))
        write_wav(complete_wav, pad(complete, 0.02, 0.1))
        to_mp3(confirm_wav, sound_dir / "confirm.mp3")
        to_mp3(complete_wav, sound_dir / "complete.mp3")
