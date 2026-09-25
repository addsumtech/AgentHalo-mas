"use strict";

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { workBuddySettingsCandidates } = require("../hooks/workbuddy-install");

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const POLL_INTERVAL_MS = 2000;
const DB_FILENAME = "workbuddy.db";

// Same generations the hook installer targets: current WorkBuddy AI keeps its
// data in ~/.workbuddy-ai, older builds in ~/.workbuddy. The first database
// that exists wins; with none, there is nothing to ask and no sqlite3 spawn.
function resolveWorkBuddyDbPath({ homeDir = os.homedir(), existsSync = fs.existsSync } = {}) {
  for (const candidate of workBuddySettingsCandidates({ homeDir })) {
    const dbPath = path.join(candidate.parentDir, DB_FILENAME);
    try {
      if (existsSync(dbPath)) return dbPath;
    } catch {}
  }
  return null;
}

// WorkBuddy's task runner can survive Archive, which emits no SessionEnd.
// Read only the status of tasks AgentHalo is currently showing. Never infer
// deletion from an absent row, an unreadable DB, or a stopped process.
//
// The interval runs only while there is something to ask about: start() arms
// it (every WorkBuddy hook event calls start()), and a tick that finds no live
// task stops it again. An archived task is not re-queried on a timer; if it
// shows activity again, recheckClosed() asks once whether it was restored.
function createWorkBuddySessionMonitor({
  getSessions, onClosed, isEnabled = () => true,
  platform = process.platform,
  dbPath = null,
  homeDir,
  existsSync,
  execFileImpl = execFile,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
} = {}) {
  let timer = null;
  let pending = null;
  const closed = new Map();
  const recheck = new Set();

  const rawIdOf = (id, session) => session.rawSessionId || String(id).replace(/^workbuddy:/, "");

  function liveSessions() {
    return [...(getSessions() || new Map()).entries()]
      .filter(([id, s]) => s && s.agentId === "workbuddy" && !s.host && !closed.has(rawIdOf(id, s)));
  }

  function stopTimer() {
    if (timer) clearIntervalImpl(timer);
    timer = null;
  }

  function query({ stopWhenIdle = false } = {}) {
    if (pending) return pending;
    if (platform !== "darwin" || !isEnabled()) return Promise.resolve();
    const sessions = liveSessions();
    const ids = new Set(recheck);
    for (const [id, session] of sessions) {
      const rawId = rawIdOf(id, session);
      if (UUID.test(rawId)) ids.add(rawId);
    }
    if (!ids.size) {
      if (stopWhenIdle) stopTimer();
      return Promise.resolve();
    }
    const resolvedDbPath = dbPath || resolveWorkBuddyDbPath({ homeDir, existsSync });
    if (!resolvedDbPath) {
      // No WorkBuddy database to read; the next hook event re-arms start().
      if (stopWhenIdle) stopTimer();
      return Promise.resolve();
    }
    const asked = new Set(ids);
    // IDs are strictly UUIDs; neither a path nor SQL can arrive from hook data.
    const sql = `SELECT id,status,deleted_at FROM sessions WHERE id IN (${[...asked].map(id => `'${id}'`).join(",")});`;
    pending = new Promise(resolve => {
      execFileImpl("/usr/bin/sqlite3", ["-readonly", "-json", resolvedDbPath, sql],
        { timeout: 1500, encoding: "utf8", maxBuffer: 128 * 1024 }, (err, stdout) => {
          if (!err && isEnabled()) {
            try {
              for (const row of JSON.parse(stdout || "[]")) {
                if (!asked.has(row.id)) continue;
                if (String(row.status).toLowerCase() === "archived" || row.deleted_at != null) {
                  closed.set(row.id, true);
                  for (const [id, session] of sessions) {
                    if (rawIdOf(id, session) === row.id) onClosed(id, session);
                  }
                } else closed.delete(row.id); // Restoring a task permits future activity.
              }
              for (const id of asked) recheck.delete(id);
              while (closed.size > 500) closed.delete(closed.keys().next().value);
            } catch {} // Schema changes and corrupt/partial reads do not remove tasks.
          }
          resolve();
        });
    }).finally(() => { pending = null; });
    return pending;
  }

  function tick() {
    return query({ stopWhenIdle: true });
  }

  function start() {
    if (timer || platform !== "darwin") return;
    // The event that calls start() may not have reached the session map yet,
    // so only a later tick is allowed to decide there is nothing to watch.
    timer = setIntervalImpl(tick, POLL_INTERVAL_MS);
    if (timer && typeof timer.unref === "function") timer.unref();
    query();
  }

  return {
    poll: () => query(),
    tick,
    isClosed: (id) => closed.has(String(id || "").replace(/^workbuddy:/, "")),
    // Activity arrived for an archived task: ask once whether WorkBuddy
    // restored it, so its next event is accepted again.
    recheckClosed(id) {
      const rawId = String(id || "").replace(/^workbuddy:/, "");
      if (!closed.has(rawId) || !UUID.test(rawId)) return;
      recheck.add(rawId);
      start();
    },
    isRunning: () => timer !== null,
    start,
    stop() { stopTimer(); closed.clear(); recheck.clear(); },
  };
}
module.exports = { createWorkBuddySessionMonitor, resolveWorkBuddyDbPath };
