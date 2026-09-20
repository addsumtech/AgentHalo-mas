"use strict";

const { execFile } = require("child_process");
const path = require("path");
const os = require("os");

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// WorkBuddy's task runner can survive Archive, which emits no SessionEnd.
// Read only the status of tasks already observed by AgentHalo. Never infer
// deletion from an absent row, an unreadable DB, or a stopped process.
function createWorkBuddySessionMonitor({
  getSessions, onClosed, isEnabled = () => true,
  platform = process.platform,
  dbPath = path.join(os.homedir(), ".workbuddy", "workbuddy.db"),
  execFileImpl = execFile,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
} = {}) {
  let timer = null;
  let pending = null;
  const closed = new Map();

  function poll() {
    if (pending) return pending;
    if (platform !== "darwin" || !isEnabled()) return Promise.resolve();
    const sessions = [...(getSessions() || new Map()).entries()]
      .filter(([, s]) => s.agentId === "workbuddy" && !s.host);
    const ids = new Set(closed.keys());
    for (const [id, session] of sessions) {
      const rawId = session.rawSessionId || id.replace(/^workbuddy:/, "");
      if (UUID.test(rawId)) ids.add(rawId);
    }
    if (!ids.size) return Promise.resolve();
    // IDs are strictly UUIDs; neither a path nor SQL can arrive from hook data.
    const sql = `SELECT id,status,deleted_at FROM sessions WHERE id IN (${[...ids].map(id => `'${id}'`).join(",")});`;
    pending = new Promise(resolve => {
      execFileImpl("/usr/bin/sqlite3", ["-readonly", "-json", dbPath, sql],
        { timeout: 1500, encoding: "utf8", maxBuffer: 128 * 1024 }, (err, stdout) => {
          if (!err && isEnabled()) {
            try {
              for (const row of JSON.parse(stdout || "[]")) {
                if (!ids.has(row.id)) continue;
                if (String(row.status).toLowerCase() === "archived" || row.deleted_at != null) {
                  closed.set(row.id, true);
                  for (const [id, session] of sessions) {
                    if ((session.rawSessionId || id.replace(/^workbuddy:/, "")) === row.id) onClosed(id, session);
                  }
                } else closed.delete(row.id); // Restoring a task permits future activity.
              }
              while (closed.size > 500) closed.delete(closed.keys().next().value);
            } catch {} // Schema changes and corrupt/partial reads do not remove tasks.
          }
          resolve();
        });
    }).finally(() => { pending = null; });
    return pending;
  }

  return {
    poll,
    isClosed: (id) => closed.has(String(id || "").replace(/^workbuddy:/, "")),
    start() {
      if (timer || platform !== "darwin") return;
      timer = setIntervalImpl(poll, 2000);
      if (timer && typeof timer.unref === "function") timer.unref();
      poll();
    },
    stop() { if (timer) clearIntervalImpl(timer); timer = null; closed.clear(); },
  };
}
module.exports = { createWorkBuddySessionMonitor };
