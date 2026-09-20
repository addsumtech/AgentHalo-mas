"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSoundPlayback } = require("../src/sound-playback");
function audio() {
  return { paused: true, ended: false, currentTime: 4, plays: 0, pauses: 0,
    play() { this.plays++; this.paused = false; return Promise.resolve(); },
    pause() { this.pauses++; this.paused = true; } };
}
function setup() {
  let muted = false, timer = null;
  const guard = createSoundPlayback(async () => muted, {
    setTimer(fn) { timer = fn; return 1; }, clearTimer() { timer = null; },
  });
  return { guard, mute() { muted = true; }, unmute() { muted = false; },
    hasTimer: () => !!timer, tick: async () => { const fn = timer; timer = null; if (fn) await fn(); } };
}
test("already-muted output blocks both notification and volume-preview audio", async () => {
  const h = setup(); h.mute();
  for (const clip of [audio(), audio()]) {
    assert.equal(await h.guard.play(clip), false); assert.equal(clip.plays, 0);
  }
  assert.equal(h.hasTimer(), false);
});
test("muting mid-clip stops every active sound and never resumes after unmute", async () => {
  const h = setup(), a = audio(), b = audio();
  await h.guard.play(a); await h.guard.play(b); h.mute(); await h.tick();
  assert.equal(a.paused, true); assert.equal(b.paused, true); assert.equal(a.currentTime, 0);
  assert.equal(h.hasTimer(), false); h.unmute(); await h.tick();
  assert.equal(a.plays, 1); assert.equal(b.plays, 1);
});
test("closing a preview cancels a pending mute check", async () => {
  let resolve;
  const guard = createSoundPlayback(() => new Promise(r => { resolve = r; }));
  const clip = audio(), result = guard.play(clip); guard.stopAll(); resolve(false);
  assert.equal(await result, false); assert.equal(clip.plays, 0);
});
test("mute probe failure stops active playback", async () => {
  let fail = false, tick;
  const guard = createSoundPlayback(async () => { if (fail) throw new Error("unavailable"); return false; }, {
    setTimer(fn) { tick = fn; return 1; }, clearTimer() {},
  });
  const clip = audio(); await guard.play(clip); fail = true; await tick();
  assert.equal(clip.paused, true);
});
test("finished audio retires its polling timer", async () => {
  const h = setup(), clip = audio(); await h.guard.play(clip); clip.ended = true; await h.tick();
  assert.equal(h.hasTimer(), false);
});
