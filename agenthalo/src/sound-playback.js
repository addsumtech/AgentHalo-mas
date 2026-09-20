"use strict";

(function (root) {
  // All audible playback uses this guard, including Settings volume previews.
  // Poll only while playing; a muted clip is stopped, never resumed later.
  function createSoundPlayback(checkMuted, { delay = 200, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const pending = new Map();
    const active = new Set();
    let timer = null;
    async function muted() {
      try { return (await checkMuted()) !== false; } catch { return true; }
    }
    function stop(audio) {
      pending.delete(audio);
      active.delete(audio);
      try { audio.pause(); audio.currentTime = 0; } catch {}
      if (!active.size && timer !== null) { clearTimer(timer); timer = null; }
    }
    function stopAll() {
      for (const audio of new Set([...active, ...pending.keys()])) stop(audio);
    }
    function schedule() {
      if (timer !== null || !active.size) return;
      timer = setTimer(async () => {
        timer = null;
        if (await muted()) { stopAll(); return; }
        for (const audio of active) {
          if (audio.ended || audio.paused) active.delete(audio);
        }
        schedule();
      }, delay);
    }
    async function play(audio) {
      const token = {};
      pending.set(audio, token);
      const blocked = await muted();
      if (pending.get(audio) !== token) return false;
      pending.delete(audio);
      if (blocked) { stopAll(); stop(audio); return false; }
      audio.currentTime = 0;
      active.add(audio);
      schedule();
      try { await audio.play(); return true; }
      catch (error) { stop(audio); throw error; }
    }
    return { play, stop, stopAll };
  }
  if (typeof module === "object" && module.exports) module.exports = { createSoundPlayback };
  else root.AgentHaloSoundPlayback = { createSoundPlayback };
})(typeof window !== "undefined" ? window : globalThis);
