"use strict";

// Codex Desktop spawns child threads inside a parent's turn. They run their own
// tools and fire the full official hook lifecycle, but they are not threads the
// user opened: nothing about them reaches disk, so they have no rollout file, no
// entry in session_index.jsonl, and no working directory. Left alone they became
// a task card whose title degraded to the raw session id.
//
// Codex sends no parent or role marker for them, so the subagent classifier
// cannot see what they are. What separates them from a real conversation is
// observable here instead: a real thread is written to a rollout file and so is
// reported by the JSONL monitor, while a child thread only ever arrives through
// the official hook.
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 400;

function createCodexJsonlSessions(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;
  const maxSessions = Number.isInteger(options.maxSessions) && options.maxSessions > 0
    ? options.maxSessions
    : DEFAULT_MAX_SESSIONS;
  const seen = new Map();

  function prune() {
    const cutoff = now() - ttlMs;
    for (const [sessionId, at] of seen) {
      if (at <= cutoff) seen.delete(sessionId);
    }
    while (seen.size > maxSessions) seen.delete(seen.keys().next().value);
  }

  function mark(sessionId) {
    if (!sessionId) return;
    const key = String(sessionId);
    seen.delete(key);
    seen.set(key, now());
    prune();
  }

  function has(sessionId) {
    if (!sessionId) return false;
    const key = String(sessionId);
    const at = seen.get(key);
    if (at === undefined) return false;
    if (at <= now() - ttlMs) {
      seen.delete(key);
      return false;
    }
    return true;
  }

  return {
    mark,
    has,
    clear() { seen.clear(); },
    get size() { return seen.size; },
  };
}

// A child thread is only ever identified by the official hook. Requiring all
// three signals keeps a real conversation whose rollout write lags behind its
// first Stop from being mistaken for one.
function isCodexChildThread({ jsonlSeen, cwd, sessionTitle }) {
  if (jsonlSeen) return false;
  if (typeof cwd === "string" && cwd.trim()) return false;
  if (typeof sessionTitle === "string" && sessionTitle.trim()) return false;
  return true;
}

createCodexJsonlSessions.DEFAULT_TTL_MS = DEFAULT_TTL_MS;
createCodexJsonlSessions.DEFAULT_MAX_SESSIONS = DEFAULT_MAX_SESSIONS;

module.exports = { createCodexJsonlSessions, isCodexChildThread };
