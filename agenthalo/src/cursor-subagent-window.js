"use strict";

// Cursor reports a subagent's own conversation as a separate cursor-agent
// session, so without this it lands in the task list as a second card beside
// the chat that spawned it. Two signals separate the two: the parent brackets
// the span with SubagentStart/SubagentStop, and the subagent never announces
// itself — it emits only thought and tool events, never SessionStart or a
// prompt. A first-seen conversation matching both is that subagent.
const CURSOR_SUBAGENT_OPEN_EVENT = "SubagentStart";
const CURSOR_SUBAGENT_CLOSE_EVENT = "SubagentStop";
const CURSOR_SELF_ANNOUNCING_EVENTS = new Set(["SessionStart", "UserPromptSubmit"]);
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_PARENTS = 64;

function createCursorSubagentWindows(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;
  const maxParents = Number.isInteger(options.maxParents) && options.maxParents > 0
    ? options.maxParents
    : DEFAULT_MAX_PARENTS;
  // parentSessionId -> { depth, updatedAt }. A parent can run several subagents
  // at once, so the span closes only when the last one stops.
  const open = new Map();

  function prune() {
    const cutoff = now() - ttlMs;
    for (const [parentId, entry] of open) {
      if (entry.updatedAt <= cutoff) open.delete(parentId);
    }
    while (open.size > maxParents) open.delete(open.keys().next().value);
  }

  function observe(sessionId, event) {
    if (!sessionId) return;
    if (event === CURSOR_SUBAGENT_OPEN_EVENT) {
      const entry = open.get(sessionId) || { depth: 0, updatedAt: now() };
      entry.depth += 1;
      entry.updatedAt = now();
      open.delete(sessionId);
      open.set(sessionId, entry);
      prune();
      return;
    }
    if (event !== CURSOR_SUBAGENT_CLOSE_EVENT) return;
    const entry = open.get(sessionId);
    if (!entry) return;
    entry.depth -= 1;
    if (entry.depth <= 0) open.delete(sessionId);
    else entry.updatedAt = now();
  }

  function isSubagentSession(sessionId, event, sessionExists) {
    if (sessionExists || !sessionId) return false;
    if (CURSOR_SELF_ANNOUNCING_EVENTS.has(event)) return false;
    prune();
    if (!open.size) return false;
    // A parent inside its own span still reports under its own id.
    return !open.has(sessionId);
  }

  return {
    observe,
    isSubagentSession,
    clear() { open.clear(); },
    get size() { return open.size; },
  };
}

createCursorSubagentWindows.DEFAULT_TTL_MS = DEFAULT_TTL_MS;
createCursorSubagentWindows.DEFAULT_MAX_PARENTS = DEFAULT_MAX_PARENTS;

module.exports = {
  CURSOR_SUBAGENT_OPEN_EVENT,
  CURSOR_SUBAGENT_CLOSE_EVENT,
  CURSOR_SELF_ANNOUNCING_EVENTS,
  createCursorSubagentWindows,
};
