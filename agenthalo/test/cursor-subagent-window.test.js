"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  createCursorSubagentWindows,
} = require("../src/cursor-subagent-window");

test("a conversation first seen inside a parent's subagent span is a subagent", () => {
  const windows = createCursorSubagentWindows();
  windows.observe("parent", "SubagentStart");
  assert.strictEqual(windows.isSubagentSession("child", "PreToolUse", false), true);
});

test("a conversation that announces itself is never a subagent", () => {
  const windows = createCursorSubagentWindows();
  windows.observe("parent", "SubagentStart");
  assert.strictEqual(windows.isSubagentSession("child", "SessionStart", false), false);
  assert.strictEqual(windows.isSubagentSession("child", "UserPromptSubmit", false), false);
});

test("the parent reporting inside its own span is not its own subagent", () => {
  const windows = createCursorSubagentWindows();
  windows.observe("parent", "SubagentStart");
  assert.strictEqual(windows.isSubagentSession("parent", "PreToolUse", false), false);
});

test("an already-known session keeps whatever it was classified as", () => {
  const windows = createCursorSubagentWindows();
  windows.observe("parent", "SubagentStart");
  assert.strictEqual(windows.isSubagentSession("child", "PreToolUse", true), false);
});

test("outside any span a new conversation is a normal session", () => {
  const windows = createCursorSubagentWindows();
  assert.strictEqual(windows.isSubagentSession("child", "PreToolUse", false), false);
});

test("the span closes only after the last concurrent subagent stops", () => {
  const windows = createCursorSubagentWindows();
  windows.observe("parent", "SubagentStart");
  windows.observe("parent", "SubagentStart");
  windows.observe("parent", "SubagentStop");
  assert.strictEqual(windows.isSubagentSession("child", "PreToolUse", false), true);
  windows.observe("parent", "SubagentStop");
  assert.strictEqual(windows.isSubagentSession("child", "PreToolUse", false), false);
});

test("an unmatched stop cannot drive the span negative", () => {
  const windows = createCursorSubagentWindows();
  windows.observe("parent", "SubagentStop");
  assert.strictEqual(windows.size, 0);
  windows.observe("parent", "SubagentStart");
  assert.strictEqual(windows.isSubagentSession("child", "PostToolUse", false), true);
});

test("a span left open by a crashed parent expires instead of misclassifying forever", () => {
  let clock = 1_000;
  const windows = createCursorSubagentWindows({ now: () => clock, ttlMs: 5_000 });
  windows.observe("parent", "SubagentStart");
  clock += 4_000;
  assert.strictEqual(windows.isSubagentSession("child", "PreToolUse", false), true);
  clock += 2_000;
  assert.strictEqual(windows.isSubagentSession("child", "PreToolUse", false), false);
});

test("tracked parents stay bounded", () => {
  const windows = createCursorSubagentWindows({ maxParents: 3 });
  for (let i = 0; i < 10; i++) windows.observe(`parent-${i}`, "SubagentStart");
  assert.strictEqual(windows.size, 3);
});
