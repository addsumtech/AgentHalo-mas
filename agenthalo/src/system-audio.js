"use strict";

const { execFile } = require("child_process");

// How long one osascript answer is trusted. Sounds often come in bursts (a
// batch of task completions, a permission prompt right after a notification);
// re-spawning osascript for each of them costs far more than the few seconds
// a toggled mute can go unnoticed. A stale "not muted" only plays into a muted
// mixer; a stale "muted" skips at most one clip.
const DEFAULT_CACHE_MS = 3000;

// Other platforms already apply output mute in the system mixer. On macOS,
// also skip starting the clip while muted, so unmuting cannot reveal its tail.
function createSystemAudioCheck({
  platform = process.platform,
  execFileImpl = execFile,
  now = Date.now,
  cacheMs = DEFAULT_CACHE_MS,
} = {}) {
  let pending = null;
  let cached = null; // { muted, at }
  return function isSystemAudioMuted() {
    if (platform !== "darwin") return Promise.resolve(false);
    if (cached && now() - cached.at < cacheMs) return Promise.resolve(cached.muted);
    if (pending) return pending;
    pending = new Promise((resolve) => {
      execFileImpl("/usr/bin/osascript", ["-e", "set currentOutput to get volume settings\nreturn (output muted of currentOutput) or ((output volume of currentOutput) = 0)"],
        { timeout: 1000, maxBuffer: 1024 }, (error, stdout) => {
          // Deliberately fail closed: an unavailable or switching output
          // device must not produce an unexpected sound.
          const muted = !!error || String(stdout).trim() !== "false";
          cached = { muted, at: now() };
          resolve(muted);
        });
    }).finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { createSystemAudioCheck };
