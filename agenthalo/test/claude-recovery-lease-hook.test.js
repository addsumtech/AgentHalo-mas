"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSpawnedHookHarness } = require("./helpers/spawned-hook");
const {
  getLeaseFilePath,
  readLeaseFile,
  updateRecoveryLeaseFromStateBody,
} = require("../hooks/session-recovery-lease");

const HOOK = path.join(__dirname, "..", "hooks", "clawd-hook.js");

describe("Claude hook recovery lease ordering", () => {
  let home;
  let recoveryDir;
  let hookHarness;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-hook-recovery-"));
    hookHarness = createSpawnedHookHarness({ home });
    recoveryDir = path.join(home, ".clawd", "session-recovery-v1");
    updateRecoveryLeaseFromStateBody({
      agent_id: "claude-code",
      session_id: "offline-session",
      event: "SessionStart",
      state: "idle",
      agent_pid: process.pid,
      source_pid: process.pid,
      cwd: "C:/work/project",
    }, {
      recoveryDir,
      eventAt: 1000,
      platform: "win32",
      getProcessStartIdentities: (pids) => new Map(
        pids.filter(Boolean).map((pid) => [pid, `win32:test-${pid}`]),
      ),
    });
  });

  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  function run(event, payload = {}) {
    return hookHarness.run({
      script: HOOK,
      args: [event],
      payload: { session_id: "offline-session", cwd: "C:/work/project", ...payload },
      httpContract: "expect-attempt",
    });
  }

  it("updates the lease even when the Clawd HTTP receiver is offline", () => {
    const result = run("PreToolUse", { tool_name: "Bash" });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, "");
    assert.strictEqual(result.stderr, "");
    const lease = readLeaseFile(getLeaseFilePath("claude-code", "offline-session", { recoveryDir }));
    assert.strictEqual(lease.active, true);
    assert.strictEqual(lease.state, "working");
  });

  it("writes the terminal tombstone before an offline Stop POST fails", () => {
    run("PreToolUse", { tool_name: "Bash" });
    const result = run("Stop");
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, "");
    assert.strictEqual(result.stderr, "");
    const lease = readLeaseFile(getLeaseFilePath("claude-code", "offline-session", { recoveryDir }));
    assert.strictEqual(lease.active, false);
    assert.strictEqual(lease.state, null);
  });
});

describe("store Claude hook recovery lease", () => {
  // Store hooks run this script through hooks/node-launcher.sh, which sets
  // AGENTHALO_STORE_HOOK.
  let home;
  let claudeDir;
  let exchangeDir;
  let hookHarness;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-store-lease-"));
    hookHarness = createSpawnedHookHarness({ home });
    claudeDir = path.join(home, ".claude");
    exchangeDir = path.join(claudeDir, "agenthalo");
    fs.mkdirSync(claudeDir, { recursive: true });
  });

  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  function run(event, payload = {}) {
    const result = hookHarness.run({
      script: HOOK,
      args: [event],
      payload: { session_id: "store-session", cwd: "/work/project", ...payload },
      env: { AGENTHALO_STORE_HOOK: "1", CLAUDE_CONFIG_DIR: claudeDir },
      httpContract: "expect-attempt",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, "");
    return result;
  }

  const leasePath = () => getLeaseFilePath("claude-code", "store-session", {
    recoveryDir: path.join(exchangeDir, "session-recovery-v1"),
  });

  it("never creates the exchange folder of a disconnected app", () => {
    run("SessionStart");
    run("PreToolUse", { tool_name: "Bash" });
    assert.strictEqual(fs.existsSync(exchangeDir), false);

    // An empty folder is not a connection either.
    fs.mkdirSync(exchangeDir);
    run("PreToolUse", { tool_name: "Bash" });
    assert.deepStrictEqual(fs.readdirSync(exchangeDir), []);
  });

  it("keeps the lease in the folder of a connected app, also while the app is quit", () => {
    fs.mkdirSync(exchangeDir);
    fs.writeFileSync(
      path.join(exchangeDir, "runtime.json"),
      JSON.stringify({ app: "clawd-on-desk", port: 23334, ownerPid: 1 })
    );
    run("SessionStart");
    run("PreToolUse", { tool_name: "Bash" });
    assert.strictEqual(readLeaseFile(leasePath()).state, "working");

    // Quitting removes runtime.json; the leases written so far keep the
    // folder a connected one, so a finished session is still recorded.
    fs.unlinkSync(path.join(exchangeDir, "runtime.json"));
    run("Stop");
    assert.strictEqual(readLeaseFile(leasePath()).active, false);
  });

  it("names the store lease folder only through a connected exchange folder", () => {
    const { recoveryLeaseOptions } = require("../hooks/clawd-hook");
    const env = { AGENTHALO_STORE_HOOK: "1", CLAUDE_CONFIG_DIR: claudeDir };
    assert.deepStrictEqual(recoveryLeaseOptions({}), {}, "non-store hooks keep ~/.clawd");
    assert.strictEqual(recoveryLeaseOptions(env), null);
    fs.mkdirSync(exchangeDir);
    assert.strictEqual(recoveryLeaseOptions(env), null);
    fs.writeFileSync(path.join(exchangeDir, "runtime.json"), "{}");
    assert.deepStrictEqual(recoveryLeaseOptions(env), {
      recoveryDir: path.join(exchangeDir, "session-recovery-v1"),
    });
  });
});
