"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createWorkBuddySessionMonitor } = require("../src/workbuddy-session-monitor");
const { getSessionFocusTarget } = require("../src/session-focus");
const ID = "0b246f84-11ec-4e04-8df9-eae2cf092836";
function harness() {
  const sessions = new Map([[ID, { agentId: "workbuddy", rawSessionId: ID }]]);
  const closed = [], commands = [];
  let result = [], error = null;
  const monitor = createWorkBuddySessionMonitor({
    platform: "darwin", getSessions: () => sessions,
    onClosed: (id) => { closed.push(id); sessions.delete(id); },
    execFileImpl: (bin, args, _options, callback) => {
      commands.push([bin, args]); queueMicrotask(() => callback(error, JSON.stringify(result)));
    },
  });
  return { monitor, sessions, closed, commands, result(value) { result = value; }, error(value) { error = value; } };
}
test("archive ends an observed task; an unarchived row permits it again", async () => {
  const h = harness(); h.result([{ id: ID, status: "archived", deleted_at: null }]);
  await h.monitor.poll();
  assert.deepEqual(h.closed, [ID]); assert.equal(h.monitor.isClosed(ID), true);
  assert.equal(h.commands[0][1][0], "-readonly");
  h.result([{ id: ID, status: "Completed", deleted_at: null }]);
  await h.monitor.poll(); assert.equal(h.monitor.isClosed(ID), false);
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
test("WorkBuddy targets the exact task, never a generic process or injected URL", () => {
  assert.deepEqual(getSessionFocusTarget({ id: ID, rawSessionId: ID, agentId: "workbuddy", sourcePid: 99 }),
    { canFocus: true, type: "workbuddy-task", url: `workbuddy://chat/${ID}` });
  assert.equal(getSessionFocusTarget({ id: "malformed", agentId: "workbuddy", sourcePid: 99 }).canFocus, false);
  assert.equal(getSessionFocusTarget({ id: ID, agentId: "workbuddy", host: "remote", sourcePid: 99 }).canFocus, false);
});
