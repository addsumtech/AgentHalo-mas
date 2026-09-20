"use strict";

const { it } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { focusWebSessionTarget, BROWSER_FOCUS_SCRIPT } = require("../src/web-session-focus");
const URL = "https://chatgpt.com/c/existing-conversation";

function harness(result) {
  const opened = [], commands = [], unavailable = [];
  return {
    opened, commands, unavailable,
    options: {
      url: URL, platform: "darwin",
      shell: { openExternal: async (url) => opened.push(url) },
      execFileImpl: (...args) => {
        commands.push(args.slice(0, 3));
        queueMicrotask(() => args[3](result instanceof Error ? result : null, JSON.stringify(result)));
      },
      onUnavailable: (error) => unavailable.push(error),
    },
  };
}

it("reuses an existing tab without opening a URL, passing target as argv", async () => {
  const h = harness({ status: "focused", browser: "com.google.Chrome" });
  assert.equal((await focusWebSessionTarget({ ...h.options, sessionId: "custom:web-12-a" })).status, "focused");
  assert.deepEqual(h.opened, []);
  assert.equal(h.commands[0][0], "/usr/bin/osascript");
  assert.equal(h.commands[0][1].at(-2), URL);
  assert.equal(h.commands[0][1].at(-1), "12");
});

it("opens once only after a successful search finds no matching tab", async () => {
  const h = harness({ status: "not-found" });
  const one = focusWebSessionTarget(h.options);
  const two = focusWebSessionTarget(h.options);
  assert.equal(one, two);
  assert.equal((await one).status, "opened");
  assert.deepEqual(h.opened, [URL]);
});

it("does not create duplicates when search is denied, fails, or times out", async () => {
  for (const result of [{ status: "unavailable" }, new Error("timeout"), {}]) {
    const h = harness(result);
    assert.equal((await focusWebSessionTarget(h.options)).status, "unavailable");
    assert.equal(h.unavailable.length, 1);
    assert.deepEqual(h.opened, []);
  }
});

it("retains the default browser handoff on other platforms", async () => {
  const h = harness({ status: "focused" });
  await focusWebSessionTarget({ ...h.options, platform: "win32" });
  assert.deepEqual(h.opened, [URL]);
  assert.equal(h.commands.length, 0);
});

it("rejects unrelated hosts and executable URLs before launching any process", async () => {
  for (const url of ["javascript:alert(1)", "https://example.com/c/a", "https://chatgpt.com.evil.test/c/a"]) {
    const h = harness({ status: "not-found" });
    assert.equal((await focusWebSessionTarget({ ...h.options, url })).status, "invalid");
    assert.equal(h.commands.length, 0);
    assert.equal(h.opened.length, 0);
  }
});

function simulateBrowser({ preferredId = "0", safari = false, failure = false } = {}) {
  const tabs = [
    { id: () => 1, url: () => "https://chatgpt.com/c/other-conversation" },
    { id: () => 2, url: () => URL + "?model=auto#reply" },
    { id: () => 3, url: () => URL },
  ];
  const window = { tabs: () => tabs, minimized: true, index: 3 };
  let activated = 0;
  const browserId = safari ? "com.apple.Safari" : "com.google.Chrome";
  const context = {
    Application: (id) => ({
      running: () => id === browserId,
      windows: () => { if (failure) throw { errorNumber: -1743 }; return [window]; },
      activate: () => { activated++; },
    }),
  };
  vm.runInNewContext(BROWSER_FOCUS_SCRIPT, context);
  const result = JSON.parse(context.run([URL, preferredId]));
  return { result, window, tabs, activated };
}

it("JXA matches the conversation, ignores presentation query/hash, and raises its window", () => {
  const h = simulateBrowser();
  assert.equal(h.result.status, "focused");
  assert.equal(h.window.activeTabIndex, 2);
  assert.equal(h.window.index, 1);
  assert.equal(h.window.minimized, false);
  assert.equal(h.activated, 1);
});

it("JXA prefers the originating extension tab when a conversation is open twice", () => {
  const h = simulateBrowser({ preferredId: "3" });
  assert.equal(h.window.activeTabIndex, 3);
});

it("JXA supports Safari's currentTab and reports denied access without changing tabs", () => {
  const safari = simulateBrowser({ safari: true });
  assert.equal(safari.window.currentTab, safari.tabs[1]);
  const denied = simulateBrowser({ failure: true });
  assert.equal(denied.result.status, "unavailable");
  assert.equal(denied.activated, 0);
});

it("temporary conversation focus does not select the normal new-chat tab", () => {
  let selected = 0;
  const tabs = ["https://claude.ai/new", "https://claude.ai/new?incognito=&model=auto"]
    .map((url, i) => ({ id: () => i+1, url: () => url }));
  const window = { tabs: () => tabs };
  const context = { Application: id => ({ running: () => id === "com.google.Chrome",
    windows: () => [window], activate() { selected++; } }) };
  vm.runInNewContext(BROWSER_FOCUS_SCRIPT, context);
  const result = JSON.parse(context.run(["https://claude.ai/new?incognito=", "0", "browser"]));
  assert.equal(result.status, "focused"); assert.equal(window.activeTabIndex, 2);
  assert.equal(selected, 1);
});
