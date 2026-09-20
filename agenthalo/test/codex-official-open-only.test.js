"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  isCodexOfficialSessionOpenOnly,
  isCodexOfficialEmptyTurnEnd,
} = require("../src/server-codex-official-turns");

const official = (fields) => ({
  agent_id: "codex",
  hook_source: "codex-official",
  ...fields,
});

test("SessionStart for an unknown thread does not open a card", () => {
  assert.strictEqual(isCodexOfficialSessionOpenOnly(official({ event: "SessionStart" }), false), true);
});

test("SessionStart for a thread already in the list is left alone", () => {
  assert.strictEqual(isCodexOfficialSessionOpenOnly(official({ event: "SessionStart" }), true), false);
});

test("a prompt still opens a card, so the pet reacts to a real turn", () => {
  assert.strictEqual(isCodexOfficialSessionOpenOnly(official({ event: "UserPromptSubmit" }), false), false);
});

test("only the official Codex hook is gated", () => {
  const jsonl = { agent_id: "codex", event: "SessionStart" };
  assert.strictEqual(isCodexOfficialSessionOpenOnly(jsonl, false), false);
  assert.strictEqual(isCodexOfficialSessionOpenOnly(null, false), false);
});

test("an empty turn on a thread nothing identified is retired", () => {
  assert.strictEqual(
    isCodexOfficialEmptyTurnEnd(official({ event: "Stop" }), "idle", { cwd: "" }),
    true,
  );
  assert.strictEqual(isCodexOfficialEmptyTurnEnd(official({ event: "Stop" }), "idle", null), true);
});

test("a turn that produced something is never retired", () => {
  assert.strictEqual(
    isCodexOfficialEmptyTurnEnd(official({ event: "Stop" }), "attention", null),
    false,
  );
});

test("a working directory from either the payload or the session keeps the thread", () => {
  assert.strictEqual(
    isCodexOfficialEmptyTurnEnd(official({ event: "Stop", cwd: "/repo" }), "idle", null),
    false,
  );
  assert.strictEqual(
    isCodexOfficialEmptyTurnEnd(official({ event: "Stop" }), "idle", { cwd: "/repo" }),
    false,
  );
});

test("only Stop retires a thread", () => {
  assert.strictEqual(
    isCodexOfficialEmptyTurnEnd(official({ event: "PostToolUse" }), "idle", null),
    false,
  );
});
