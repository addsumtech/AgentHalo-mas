"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const CodexLogMonitor = require("../agents/codex-log-monitor");
const { getSessionFocusTarget, getCodexThreadId } = require("../src/session-focus");
const { getStaleSessionDecision } = require("../src/state-stale-cleanup");
const { computeHudLayout, computeSessionHudBounds, computeHudHeight } = require("../src/session-hud").__test;

test("macOS binds exact rollout files to the writer process and caches the scan", async () => {
  const one = "/Users/test/Chinese folder/rollout-one.jsonl";
  const two = "/Users/test/Chinese folder/rollout-two.jsonl";
  let calls = 0;
  const monitor = new CodexLogMonitor({ logConfig: { sessionDir: "/tmp/sessions" } }, () => {}, {
    platform: "darwin",
    execFile(file, args, options, callback) {
      calls++;
      assert.equal(file, "/usr/sbin/lsof");
      assert.deepEqual(args, ["-n", "-P", "-c", "codex", "-Fpn"]);
      assert.equal(options.timeout, 750);
      callback(null, `p101\nn${one}\np202\nn${two}\n`, "");
    },
  });
  monitor._isProcessAlive = (pid) => pid === 101 || pid === 202;
  assert.equal(monitor._findCodexWriterPid(one), 101);
  await monitor._writerPidScanInFlight;
  assert.equal(monitor._findCodexWriterPid(two), 202);
  assert.equal(monitor._findCodexWriterPid(one + "-other"), null);
  assert.equal(calls, 1);
  assert.equal(monitor._writerPidScanValid, true);
  monitor._writerPidScanStartedAt = 0;
  monitor._execFile = (_file, _args, _options, callback) => {
    callback(Object.assign(new Error("timeout"), { killed: true, signal: "SIGTERM", code: null }), "", "");
  };
  assert.equal(monitor._findCodexWriterPid(one), 101);
  await monitor._writerPidScanInFlight;
  assert.equal(monitor._writerPidScanValid, false, "a timed-out inventory is not evidence");
  assert.equal(monitor._findCodexWriterPid(one), 101, "the last known mapping survives a failed scan");
  monitor._isProcessAlive = () => false;
  assert.equal(monitor._findCodexWriterPid(one), null);
});

test("macOS writer inventory runs off the main thread and de-duplicates in-flight scans", async () => {
  const rollout = "/Users/test/rollout-async.jsonl";
  const pending = [];
  const monitor = new CodexLogMonitor({ logConfig: { sessionDir: "/tmp/sessions" } }, () => {}, {
    platform: "darwin",
    execFile(_file, _args, _options, callback) { pending.push(callback); },
  });
  monitor._isProcessAlive = (pid) => pid === 303;

  // The lookup returns immediately from the (still empty) cache.
  assert.equal(monitor._findCodexWriterPid(rollout), null);
  assert.equal(monitor._findCodexWriterPid(rollout), null);
  assert.equal(monitor._refreshWriterPidCache(), monitor._writerPidScanInFlight, "callers share the running scan");
  assert.equal(pending.length, 1, "no second lsof while one is running");
  assert.equal(monitor._writerPidScanValid, false);

  pending[0](null, `p303\nn${rollout}\n`, "");
  await monitor._writerPidScanInFlight;
  assert.equal(monitor._writerPidScanInFlight, null);
  assert.equal(monitor._findCodexWriterPid(rollout), 303);
  assert.equal(pending.length, 1, "a fresh cache is reused for WRITER_PID_SCAN_INTERVAL_MS");

  // lsof exits 1 with no output when no Codex process has a rollout open.
  monitor._writerPidScanStartedAt = 0;
  assert.equal(monitor._findCodexWriterPid(rollout), 303);
  assert.equal(pending.length, 2);
  pending[1](Object.assign(new Error("exit 1"), { code: 1 }), "", "");
  await monitor._writerPidScanInFlight;
  assert.equal(monitor._writerPidScanValid, true);
  assert.equal(monitor._findCodexWriterPid(rollout), null);
});

test("closing a terminal clears its finished card immediately", () => {
  const result = getStaleSessionDecision({
    state: "idle", updatedAt: 1000, pidReachable: true, sourcePid: 100, agentPid: null,
  }, { now: 1001, isProcessAlive: () => false });
  assert.deepEqual(result, { action: "delete", reason: "source-exit" });
});

test("web cards open the exact supported conversation URL and reject unsafe schemes", () => {
  for (const url of ["https://claude.ai/chat/abc", "https://chatgpt.com/c/abc", "https://gemini.google.com/app/abc", "https://www.qianwen.com/chat/abc"]) {
    assert.deepEqual(getSessionFocusTarget({ id: "web", platform: "webui", cwd: url }), {
      canFocus: true, type: "web-chat", url,
    });
  }
  for (const cwd of ["javascript:alert(1)", "file:///tmp/chat", "https://chatgpt.com.evil.test/c/abc", "https://user:pass@chatgpt.com/c/abc"]) {
    assert.equal(getSessionFocusTarget({ id: "web", platform: "webui", cwd }).canFocus, false);
  }
});

test("Codex Desktop uses a thread ID while unidentified auxiliary work cannot fake a task jump", () => {
  const id = "01a00000-0000-7000-8000-000000000000";
  assert.equal(getCodexThreadId({ id, agentId: "codex", codexOriginator: "Codex Desktop" }), id);
  assert.equal(getSessionFocusTarget({ id: `codex:${id}`, agentId: "codex", sourcePid: 12 }).canFocus, false);
  assert.equal(getSessionFocusTarget({ id: `codex:${id}`, agentId: "codex", codexOriginator: "codex-tui", sourcePid: 12 }).type, "terminal");
});

test("all 40 tasks remain in the HUD with a viewport inside the display", () => {
  const sessions = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, state: "working", headless: false }));
  const layout = computeHudLayout({ sessions });
  assert.equal(layout.expanded.length, 40);
  assert.equal(layout.folded.length, 0);
  const result = computeSessionHudBounds({
    hitRect: { left: 400, top: 380, right: 450, bottom: 430 },
    workArea: { x: 0, y: 0, width: 900, height: 600 },
    height: computeHudHeight(layout.rowCount),
  });
  assert.ok(result.bounds.height <= 600);
  assert.ok(result.bounds.y >= 0);
  assert.ok(result.bounds.y + result.bounds.height <= 600);
});
