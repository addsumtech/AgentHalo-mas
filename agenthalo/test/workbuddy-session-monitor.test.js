"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkBuddySessionMonitor, resolveWorkBuddyDbPath } = require("../src/workbuddy-session-monitor");
const { getSessionFocusTarget } = require("../src/session-focus");
const ID = "0b246f84-11ec-4e04-8df9-eae2cf092836";
const OTHER = "5d8e2c3a-7f41-4b8e-9c0d-1a2b3c4d5e6f";
function harness(options = {}) {
  const sessions = new Map([[ID, { agentId: "workbuddy", rawSessionId: ID }]]);
  const closed = [], commands = [], timers = [];
  let result = [], error = null;
  const monitor = createWorkBuddySessionMonitor({
    platform: "darwin", getSessions: () => sessions, dbPath: "/Users/test/.workbuddy-ai/workbuddy.db",
    onClosed: (id) => { closed.push(id); sessions.delete(id); },
    execFileImpl: (bin, args, _options, callback) => {
      commands.push([bin, args]); queueMicrotask(() => callback(error, JSON.stringify(result)));
    },
    setIntervalImpl: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearIntervalImpl: (timer) => { timer.cleared = true; },
    ...options,
  });
  return {
    monitor, sessions, closed, commands, timers,
    result(value) { result = value; }, error(value) { error = value; },
    queriedIds: (index) => [...commands[index][1].at(-1).matchAll(/'([^']+)'/g)].map((m) => m[1]),
  };
}
test("archive ends an observed task; an unarchived row permits it again", async () => {
  const h = harness(); h.result([{ id: ID, status: "archived", deleted_at: null }]);
  await h.monitor.poll();
  assert.deepEqual(h.closed, [ID]); assert.equal(h.monitor.isClosed(ID), true);
  assert.equal(h.commands[0][1][0], "-readonly");
  // Activity on the archived task asks once whether it was restored.
  h.result([{ id: ID, status: "Completed", deleted_at: null }]);
  h.monitor.recheckClosed(ID);
  await h.monitor.poll(); assert.equal(h.monitor.isClosed(ID), false);
  assert.deepEqual(h.queriedIds(h.commands.length - 1), [ID]);
});
test("missing rows, query failures and remote sessions never prove archive", async () => {
  const h = harness(); await h.monitor.poll(); assert.deepEqual(h.closed, []);
  h.error(new Error("locked")); h.result([{ id: ID, status: "archived" }]);
  await h.monitor.poll(); assert.deepEqual(h.closed, []);
  h.sessions.set(ID, { agentId: "workbuddy", rawSessionId: ID, host: "remote" });
  const count = h.commands.length; await h.monitor.poll(); assert.equal(h.commands.length, count);
});
test("deletion closes a task, while hook input cannot become SQL", async () => {
  const h = harness(); h.sessions.set("injection", { agentId: "workbuddy", rawSessionId: "x');DROP TABLE sessions;--" });
  h.result([{ id: ID, status: "Completed", deleted_at: 1 }]);
  await h.monitor.poll(); assert.deepEqual(h.closed, [ID]);
  assert.equal(h.commands[0][1].at(-1).includes("DROP"), false);
});
test("only live tasks are queried; archived ids are not re-polled forever", async () => {
  const h = harness();
  h.sessions.set(OTHER, { agentId: "workbuddy", rawSessionId: OTHER });
  h.result([{ id: ID, status: "archived", deleted_at: null }, { id: OTHER, status: "Running", deleted_at: null }]);
  await h.monitor.poll();
  assert.deepEqual(h.closed, [ID]);
  assert.deepEqual(h.queriedIds(0).sort(), [ID, OTHER].sort());
  h.result([{ id: OTHER, status: "Running", deleted_at: null }]);
  await h.monitor.poll();
  assert.deepEqual(h.queriedIds(1), [OTHER]);
  // An archived task that stays archived is re-checked once on activity, then dropped again.
  h.result([{ id: ID, status: "archived", deleted_at: null }, { id: OTHER, status: "Running", deleted_at: null }]);
  h.monitor.recheckClosed(ID);
  await h.monitor.poll();
  assert.equal(h.monitor.isClosed(ID), true);
  await h.monitor.poll();
  assert.deepEqual(h.queriedIds(h.commands.length - 1), [OTHER]);
});
test("the interval stops once no task is tracked and restarts when one appears", async () => {
  const h = harness();
  h.sessions.clear();
  h.monitor.start();
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 2000);
  assert.equal(h.commands.length, 0, "nothing to ask means no sqlite3 spawn");
  assert.equal(h.monitor.isRunning(), true, "start() never stops the timer before the hook's session lands");

  await h.timers[0].fn();
  assert.equal(h.timers[0].cleared, true);
  assert.equal(h.monitor.isRunning(), false);

  h.sessions.set(ID, { agentId: "workbuddy", rawSessionId: ID });
  h.monitor.start();
  assert.equal(h.timers.length, 2);
  await h.timers[1].fn();
  assert.equal(h.timers[1].cleared, false);
  assert.deepEqual(h.queriedIds(h.commands.length - 1), [ID]);

  h.result([{ id: ID, status: "archived", deleted_at: null }]);
  await h.timers[1].fn();
  assert.deepEqual(h.closed, [ID]);
  await h.timers[1].fn();
  assert.equal(h.timers[1].cleared, true, "the last task was archived, so polling ends");
});
test("the database follows the installer's WorkBuddy AI / legacy directories", (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "workbuddy-db-"));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  assert.equal(resolveWorkBuddyDbPath({ homeDir }), null);
  fs.mkdirSync(path.join(homeDir, ".workbuddy"));
  fs.writeFileSync(path.join(homeDir, ".workbuddy", "workbuddy.db"), "");
  assert.equal(resolveWorkBuddyDbPath({ homeDir }), path.join(homeDir, ".workbuddy", "workbuddy.db"));
  // A bare ~/.workbuddy-ai directory without a database does not win.
  fs.mkdirSync(path.join(homeDir, ".workbuddy-ai"));
  assert.equal(resolveWorkBuddyDbPath({ homeDir }), path.join(homeDir, ".workbuddy", "workbuddy.db"));
  fs.writeFileSync(path.join(homeDir, ".workbuddy-ai", "workbuddy.db"), "");
  assert.equal(resolveWorkBuddyDbPath({ homeDir }), path.join(homeDir, ".workbuddy-ai", "workbuddy.db"));
});
test("without a WorkBuddy database there is no sqlite3 spawn and no idle timer", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "workbuddy-db-"));
  try {
    const h = harness({ dbPath: null, homeDir });
    h.monitor.start();
    await h.timers[0].fn();
    assert.equal(h.commands.length, 0);
    assert.equal(h.timers[0].cleared, true);

    fs.mkdirSync(path.join(homeDir, ".workbuddy-ai"));
    fs.writeFileSync(path.join(homeDir, ".workbuddy-ai", "workbuddy.db"), "");
    h.monitor.start();
    await h.monitor.poll();
    assert.equal(h.commands.at(-1)[1][2], path.join(homeDir, ".workbuddy-ai", "workbuddy.db"));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
test("WorkBuddy targets the exact task, never a generic process or injected URL", () => {
  assert.deepEqual(getSessionFocusTarget({ id: ID, rawSessionId: ID, agentId: "workbuddy", sourcePid: 99 }),
    { canFocus: true, type: "workbuddy-task", url: `workbuddy://chat/${ID}` });
  assert.equal(getSessionFocusTarget({ id: "malformed", agentId: "workbuddy", sourcePid: 99 }).canFocus, false);
  assert.equal(getSessionFocusTarget({ id: ID, agentId: "workbuddy", host: "remote", sourcePid: 99 }).canFocus, false);
});
