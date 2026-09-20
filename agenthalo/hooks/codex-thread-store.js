"use strict";

// Codex's own thread record, read from its SQLite store.
//
// Codex Desktop retired the files this integration used to read: rollout
// JSONL under ~/.codex/sessions stopped on 2026-09-08 and session_index.jsonl
// stopped on 2026-09-15. Both now live in ~/.codex/state_<n>.sqlite, so a
// thread created after that date had no title here and degraded to its raw
// session id, and the "was it reported by the JSONL monitor" test that
// separated real conversations from ephemeral ones answered false for
// everything.
//
// The `threads` table answers both questions directly. Observed values of
// `thread_source`:
//   user      — a conversation the user opened
//   subagent  — a child Codex spawned inside another thread
// and a session absent from the table entirely is ephemeral: the ChatGPT app
// runs its embedded `codex app-server` in code mode for tool calls, and those
// runs are never recorded as threads.
//
// SAFETY: "the store says no such thread" and "the store could not be read"
// must stay distinguishable. Callers hide cards on the first and must not on
// the second, so that a future Codex layout change degrades to today's
// behaviour instead of emptying the task list.

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_TTL_MS = 10 * 1000;
const DEFAULT_MAX_ENTRIES = 256;
// Re-resolving which state_<n>.sqlite is current costs a readdir, so do it at
// most this often. A Codex upgrade that bumps the number is picked up within
// the window instead of needing an AgentHalo restart.
const DEFAULT_PATH_TTL_MS = 60 * 1000;

function getCodexDir() {
  const configured = process.env.CODEX_HOME;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  return path.join(os.homedir(), ".codex");
}

function bareCodexSessionId(sessionId) {
  if (typeof sessionId !== "string") return null;
  const trimmed = sessionId.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("codex:") ? trimmed.slice("codex:".length) : trimmed;
}

// state_5.sqlite today; the number has been bumped by past Codex migrations, so
// select the highest rather than pinning a version.
function findStateDbPath(codexDir) {
  let entries;
  try {
    entries = fs.readdirSync(codexDir);
  } catch {
    return null;
  }
  let best = null;
  let bestVersion = -1;
  for (const entry of entries) {
    const match = /^state_(\d+)\.sqlite$/.exec(entry);
    if (!match) continue;
    const version = Number(match[1]);
    if (!Number.isFinite(version) || version <= bestVersion) continue;
    bestVersion = version;
    best = path.join(codexDir, entry);
  }
  return best;
}

function loadSqlite() {
  try {
    return require("node:sqlite");
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createCodexThreadStore(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;
  const pathTtlMs = Number.isFinite(options.pathTtlMs) && options.pathTtlMs > 0
    ? options.pathTtlMs
    : DEFAULT_PATH_TTL_MS;
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries
    : DEFAULT_MAX_ENTRIES;
  const codexDir = typeof options.codexDir === "string" && options.codexDir
    ? options.codexDir
    : getCodexDir();
  const sqlite = options.sqlite !== undefined ? options.sqlite : loadSqlite();

  const cache = new Map();
  let db = null;
  let statement = null;
  let dbPath = null;
  let dbPathCheckedAt = 0;

  function closeDb() {
    if (db) {
      try { db.close(); } catch {}
    }
    db = null;
    statement = null;
  }

  function resolveDbPath() {
    const at = now();
    if (dbPath !== null && at - dbPathCheckedAt < pathTtlMs) return dbPath;
    const resolved = findStateDbPath(codexDir);
    dbPathCheckedAt = at;
    if (resolved !== dbPath) {
      // A Codex migration moved to a new file; drop the handle to the old one.
      closeDb();
      cache.clear();
      dbPath = resolved;
    }
    return dbPath;
  }

  function ensureStatement() {
    if (statement) return statement;
    if (!sqlite || typeof sqlite.DatabaseSync !== "function") return null;
    const file = resolveDbPath();
    if (!file) return null;
    try {
      // Read-only so a running Codex is never blocked or altered. This still
      // observes committed WAL frames, which matters because Codex checkpoints
      // infrequently and a brand-new thread lives in the WAL for a while.
      db = new sqlite.DatabaseSync(file, { readOnly: true });
      statement = db.prepare(
        "SELECT name, title, cwd, thread_source, archived FROM threads WHERE id = ?"
      );
      return statement;
    } catch {
      closeDb();
      return null;
    }
  }

  function remember(key, value) {
    cache.delete(key);
    cache.set(key, { at: now(), value });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return value;
  }

  // Returns { available, found, name, cwd, source, archived }. `available:false`
  // means the store could not be consulted at all — never treat that as "no
  // such thread".
  function lookup(sessionId) {
    const id = bareCodexSessionId(sessionId);
    if (!id) return { available: false, found: false };
    const cached = cache.get(id);
    if (cached && now() - cached.at < ttlMs) return cached.value;

    const stmt = ensureStatement();
    if (!stmt) return { available: false, found: false };

    let row;
    try {
      row = stmt.get(id);
    } catch {
      // A Codex schema change or a replaced file invalidates the handle; drop
      // it so the next call re-opens, and report unavailable rather than absent.
      closeDb();
      return { available: false, found: false };
    }
    if (!row) return remember(id, { available: true, found: false });
    return remember(id, {
      available: true,
      found: true,
      // `name` is the thread's display name. The `title` column holds the first
      // user message verbatim — thousands of characters for a long prompt — so
      // it is not a fallback. An unnamed thread falls through to the existing
      // chain (session_index, then the workspace folder).
      name: normalizeText(row.name),
      cwd: normalizeText(row.cwd),
      source: normalizeText(row.thread_source),
      archived: row.archived === 1,
    });
  }

  return {
    lookup,
    close: closeDb,
    clear() { cache.clear(); },
    get dbPath() { return dbPath; },
  };
}

// "visible" | "hidden" | "unknown". `unknown` means the store could not answer,
// so the caller must keep whatever behaviour it had before rather than hiding.
function classifyCodexThread(record) {
  if (!record || !record.available) return "unknown";
  // The ChatGPT app runs its embedded codex in code mode for tool calls. Those
  // runs are never recorded as threads, so they are not conversations.
  if (!record.found) return "hidden";
  // A subagent belongs to the thread that spawned it, not to the task list.
  if (record.source === "subagent") return "hidden";
  return "visible";
}

// Memory maintenance uses app-server hooks but has no user thread. Directory
// identity plus a successful missing-row lookup lets us filter it before Stop
// without hiding ordinary new conversations whose records are still arriving.
function isCodexMemoryMaintenanceThread(record, cwd, codexDir = getCodexDir()) {
  if (!record || record.available !== true || record.found !== false) return false;
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return false;
  const relative = path.relative(path.resolve(codexDir, "memories"), path.resolve(cwd));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

let sharedStore = null;

function getSharedCodexThreadStore() {
  if (!sharedStore) sharedStore = createCodexThreadStore();
  return sharedStore;
}

module.exports = {
  bareCodexSessionId,
  classifyCodexThread,
  createCodexThreadStore,
  findStateDbPath,
  getSharedCodexThreadStore,
  isCodexMemoryMaintenanceThread,
};
