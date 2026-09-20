"use strict";

// Every path that removes a session must run the same teardown. Three of the
// six used to skip the per-session automation grant, so "allow for this
// session" survived the session and re-bound when the same id came back — the
// user had consented to one session and silently got another.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const themeLoader = require("../src/theme-loader");
themeLoader.init(path.join(__dirname, "fixtures", "legacy-app", "src"));
const defaultTheme = themeLoader.loadTheme("clawd");
const { createTranslator } = require("../src/i18n");

const STATE = path.join(__dirname, "..", "src", "state.js");

function makeCtx(overrides = {}) {
  const ctx = {
    lang: "en",
    theme: defaultTheme,
    doNotDisturb: false,
    miniTransitioning: false,
    miniMode: false,
    mouseOverPet: false,
    idlePaused: false,
    forceEyeResend: false,
    eyePauseUntil: 0,
    mouseStillSince: Date.now(),
    miniSleepPeeked: false,
    playSound: () => {},
    sendToRenderer: () => {},
    syncHitWin: () => {},
    sendToHitWin: () => {},
    miniPeekIn: () => {},
    miniPeekOut: () => {},
    buildContextMenu: () => {},
    buildTrayMenu: () => {},
    pendingPermissions: [],
    resolvePermissionEntry: () => {},
    dismissPermissionsForDnd: () => {},
    focusTerminalWindow: () => {},
    focusHostPlatform: "darwin",
    // Every pid reads as dead, so nothing is kept alive by process liveness.
    processKill: () => { const e = new Error("ESRCH"); e.code = "ESRCH"; throw e; },
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    ...overrides,
  };
  ctx.t = createTranslator(() => ctx.lang);
  return ctx;
}

function freshApi(ended) {
  delete require.cache[require.resolve(STATE)];
  return require(STATE)(makeCtx({
    onSessionAutomationLifecycleEnd: (info) => ended.push(info),
  }));
}

function seed(api, id) {
  api.updateSession(id, "working", "PreToolUse", { agentId: "codex" });
  assert.ok(api.sessions.has(id), "session was created");
}

test("dismissing a card ends its automation grant", () => {
  const ended = [];
  const api = freshApi(ended);
  seed(api, "s1");
  api.dismissSession("s1");
  assert.strictEqual(api.sessions.size, 0);
  assert.deepStrictEqual(ended.map((e) => e.sessionId), ["s1"]);
  assert.strictEqual(ended[0].agentId, "codex");
});

test("clearing an agent's sessions ends their automation grants", () => {
  const ended = [];
  const api = freshApi(ended);
  seed(api, "s1");
  seed(api, "s2");
  api.clearSessionsByAgent("codex");
  assert.strictEqual(api.sessions.size, 0);
  assert.deepStrictEqual(ended.map((e) => e.sessionId).sort(), ["s1", "s2"]);
});

test("a session evicted by the cap ends its automation grant", () => {
  const ended = [];
  const api = freshApi(ended);
  // The cap is 20; seeding past it evicts the oldest.
  for (let i = 0; i < 22; i++) seed(api, `s${i}`);
  assert.ok(ended.length > 0, "eviction ran the teardown");
  assert.ok(ended.every((e) => e.agentId === "codex"));
  // The evicted ids are gone from the map, and each got exactly one end.
  for (const info of ended) {
    assert.ok(!api.sessions.has(info.sessionId), `${info.sessionId} was removed`);
  }
  assert.strictEqual(
    new Set(ended.map((e) => e.sessionId)).size, ended.length,
    "no session ends twice"
  );
});

test("a session ending normally ends its grant exactly once", () => {
  const ended = [];
  const api = freshApi(ended);
  seed(api, "s1");
  api.updateSession("s1", "idle", "SessionEnd", { agentId: "codex" });
  assert.deepStrictEqual(ended.map((e) => e.sessionId), ["s1"]);
});

test("a subagent-scoped end leaves the parent's grant alone", () => {
  const ended = [];
  const api = freshApi(ended);
  seed(api, "s1");
  api.updateSession("s1", "idle", "SessionEnd", {
    agentId: "codex", subagentId: "child-1",
  });
  assert.deepStrictEqual(ended, [], "the parent keeps its consent");
});
