"use strict";

const { execFile } = require("child_process");

// Other platforms already apply output mute in the system mixer. On macOS,
// also skip starting the clip while muted, so unmuting cannot reveal its tail.
function createSystemAudioCheck({ platform = process.platform, execFileImpl = execFile } = {}) {
  let pending = null;
  return function isSystemAudioMuted() {
    if (platform !== "darwin") return Promise.resolve(false);
    if (pending) return pending;
    pending = new Promise((resolve) => {
      execFileImpl("/usr/bin/osascript", ["-e", "set currentOutput to get volume settings\nreturn (output muted of currentOutput) or ((output volume of currentOutput) = 0)"],
        { timeout: 1000, maxBuffer: 1024 }, (error, stdout) => {
          // An unavailable output device must not produce an unexpected sound.
          resolve(!!error || String(stdout).trim() !== "false");
        });
    }).finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { createSystemAudioCheck };
