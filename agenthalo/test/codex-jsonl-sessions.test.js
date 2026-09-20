"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  createCodexJsonlSessions,
  isCodexChildThread,
} = require("../src/codex-jsonl-sessions");

test("a session the JSONL monitor reported is remembered", () => {
  const seen = createCodexJsonlSessions();
  assert.strictEqual(seen.has("codex:a"), false);
  seen.mark("codex:a");
  assert.strictEqual(seen.has("codex:a"), true);
});

test("a stale sighting expires rather than vouching for a thread forever", () => {
  let clock = 1_000;
  const seen = createCodexJsonlSessions({ now: () => clock, ttlMs: 5_000 });
  seen.mark("codex:a");
  clock += 4_000;
  assert.strictEqual(seen.has("codex:a"), true);
  clock += 2_000;
  assert.strictEqual(seen.has("codex:a"), false);
});

test("tracked sessions stay bounded", () => {
  const seen = createCodexJsonlSessions({ maxSessions: 3 });
  for (let i = 0; i < 10; i++) seen.mark(`codex:${i}`);
  assert.strictEqual(seen.size, 3);
  assert.strictEqual(seen.has("codex:9"), true);
});

test("empty ids are ignored", () => {
  const seen = createCodexJsonlSessions();
  seen.mark("");
  seen.mark(null);
  assert.strictEqual(seen.size, 0);
  assert.strictEqual(seen.has(""), false);
});

test("a thread nothing on disk knows about is a child", () => {
  assert.strictEqual(
    isCodexChildThread({ jsonlSeen: false, cwd: "", sessionTitle: "" }),
    true,
  );
});

test("any one identifying signal keeps a thread visible", () => {
  assert.strictEqual(
    isCodexChildThread({ jsonlSeen: true, cwd: "", sessionTitle: "" }),
    false,
  );
  assert.strictEqual(
    isCodexChildThread({ jsonlSeen: false, cwd: "/repo", sessionTitle: "" }),
    false,
  );
  assert.strictEqual(
    isCodexChildThread({ jsonlSeen: false, cwd: "", sessionTitle: "Fix the parser" }),
    false,
  );
});

test("whitespace is not an identity", () => {
  assert.strictEqual(
    isCodexChildThread({ jsonlSeen: false, cwd: "   ", sessionTitle: "  " }),
    true,
  );
});
