"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const themeLoader = require("../src/theme-loader");
const {
  getLeaseFilePath,
  readLeaseFile,
  updateRecoveryLeaseFromStateBody,
} = require("../hooks/session-recovery-lease");
const {
  restoreSessionsFromRecoveryLeases,
  recoverSessionsFromLeases,
  formatRecoverySummary,
} = require("../src/session-recovery-loader");

themeLoader.init(path.join(__dirname, "fixtures", "legacy-app", "src"));
const defaultTheme = themeLoader.loadTheme("clawd");

function makeState() {
  return require("../src/state")({
    lang: "en",
    theme: defaultTheme,
    t: (key) => key,
    doNotDisturb: false,
    miniTransitioning: false,
    miniMode: false,
    mouseOverPet: false,
    idlePaused: false,
    forceEyeResend: false,
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
    processKill: () => true,
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
  });
}

function leaseBody(overrides = {}) {
  return {
    agent_id: "claude-code",
    session_id: "real-session-1",
    event: "UserPromptSubmit",
    state: "thinking",
    agent_pid: process.pid,
    source_pid: process.pid,
    cwd: "C:/work/project",
    session_title: "Explicit task title",
    ...overrides,
  };
}

function leaseOptions(recoveryDir, eventAt) {
  return {
    recoveryDir,
    eventAt,
    platform: "win32",
    getProcessStartIdentities: (pids) => new Map(
      pids.filter(Boolean).map((pid) => [pid, `win32:test-${pid}`]),
    ),
  };
}

describe("startup session recovery regressions", () => {
  let state;
  let recoveryDir;

  afterEach(() => {
    if (state) state.cleanup();
    state = null;
    if (recoveryDir) fs.rmSync(recoveryDir, { recursive: true, force: true });
    recoveryDir = null;
  });

  it("does not evict any real session when recovery starts at capacity", () => {
    state = makeState();
    const existing = new Map();
    for (let index = 0; index < 20; index += 1) {
      const id = `live-session-${index}`;
      const session = { state: "working", startupRecovered: undefined };
      existing.set(id, session);
      state.sessions.set(id, session);
    }

    const restored = state.restoreSessionFromLease({
      version: 1,
      agentId: "claude-code",
      sessionId: "recovered-session",
      active: true,
      state: "working",
      eventAt: Date.now(),
      validUntil: null,
      pid: process.pid,
      sourcePid: process.pid,
      cwd: "C:/work/project",
      title: "Recovered task",
    });

    assert.strictEqual(restored, false);
    assert.strictEqual(state.sessions.size, 20);
    assert.strictEqual(state.sessions.has("recovered-session"), false);
    for (const [id, session] of existing) {
      assert.strictEqual(state.sessions.get(id), session, `${id} must remain untouched`);
    }
  });

  it("rejects a valid lease when the integration is enabled but not installed", () => {
    recoveryDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-recovery-installed-"));
    updateRecoveryLeaseFromStateBody(
      leaseBody(),
      leaseOptions(recoveryDir, 1000),
    );
    let restoreCalls = 0;
    const enabled = true;
    const installed = false;

    const restored = restoreSessionsFromRecoveryLeases({
      restoreSessionFromLease: () => { restoreCalls += 1; return true; },
    }, {
      recoveryDir,
      now: 2000,
      processKill: () => true,
      platform: "win32",
      isAgentEnabled: () => enabled && installed,
      getProcessStartIdentities: (pids) => new Map(
        pids.filter(Boolean).map((pid) => [pid, `win32:test-${pid}`]),
      ),
    });

    assert.deepStrictEqual(restored, []);
    assert.strictEqual(restoreCalls, 0);
  });

  it("reports why a startup restored nothing", () => {
    recoveryDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-recovery-summary-"));
    for (const sessionId of ["task-a", "task-b"]) {
      updateRecoveryLeaseFromStateBody(
        leaseBody({ session_id: sessionId }),
        leaseOptions(recoveryDir, 1000),
      );
    }
    fs.writeFileSync(
      getLeaseFilePath("claude-code", "garbage", { recoveryDir }),
      "{not json",
    );
    const common = { recoveryDir, now: 2000, processKill: () => true, platform: "win32" };

    // The sandboxed store build could not read process start identities.
    const blind = recoverSessionsFromLeases({ restoreSessionFromLease: () => true }, {
      ...common,
      isAgentEnabled: () => true,
      getProcessStartIdentities: () => new Map(),
    });
    assert.deepStrictEqual(blind.restored, []);
    assert.deepStrictEqual(blind.summary, {
      dir: "ok",
      files: 3,
      candidates: 2,
      loaded: 0,
      restored: 0,
      rejected: 0,
      skipped: { unreadable: 1, "identity-unavailable": 2 },
    });
    assert.strictEqual(
      formatRecoverySummary(blind.summary),
      "dir=ok files=3 candidates=2 restored=0 rejected=0 skipped=identity-unavailable:2,unreadable:1",
    );

    const refused = recoverSessionsFromLeases({
      restoreSessionFromLease: (lease) => lease.sessionId !== "task-a",
    }, {
      ...common,
      isAgentEnabled: () => true,
      getProcessStartIdentities: (pids) => new Map(
        pids.filter(Boolean).map((pid) => [pid, `win32:test-${pid}`]),
      ),
    });
    assert.deepStrictEqual(refused.restored, ["task-b"]);
    assert.strictEqual(refused.summary.restored, 1);
    assert.strictEqual(refused.summary.rejected, 1);
    assert.deepStrictEqual(refused.summary.skipped, { unreadable: 1 });

    const disabled = recoverSessionsFromLeases({ restoreSessionFromLease: () => true }, {
      ...common,
      isAgentEnabled: () => false,
      getProcessStartIdentities: () => new Map(),
    });
    assert.deepStrictEqual(disabled.summary.skipped, { unreadable: 1, "agent-disabled": 2 });
  });

  it("reports a missing recovery folder instead of an empty one", () => {
    const missing = path.join(os.tmpdir(), `clawd-recovery-missing-${process.pid}-${Date.now()}`);
    const result = recoverSessionsFromLeases({ restoreSessionFromLease: () => true }, { recoveryDir: missing });
    assert.deepStrictEqual(result.restored, []);
    assert.strictEqual(result.summary.dir, "missing");
    assert.match(formatRecoverySummary(result.summary), /^dir=missing files=0 candidates=0 restored=0 rejected=0 skipped=none$/);
    assert.strictEqual(formatRecoverySummary(null), "unavailable");
  });

  it("never persists a title synthesized from the prompt", () => {
    recoveryDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-recovery-title-"));
    const body = leaseBody({ session_title: "Sensitive prompt used as fallback" });
    Object.defineProperty(body, "_sessionTitleFromPrompt", {
      value: true,
      enumerable: false,
    });

    const result = updateRecoveryLeaseFromStateBody(
      body,
      leaseOptions(recoveryDir, 1000),
    );
    const filePath = getLeaseFilePath("claude-code", "real-session-1", { recoveryDir });
    const persisted = readLeaseFile(filePath);

    assert.strictEqual(result.written, true);
    assert.strictEqual(persisted.title, null);
    assert.strictEqual(fs.readFileSync(filePath, "utf8").includes(body.session_title), false);
  });

  it("waits for the HTTP server to listen before loading recovery leases", () => {
    const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
    const startIndex = mainSource.indexOf("startHttpServer().then((port) => {");
    const portGuardIndex = mainSource.indexOf("if (port == null) return;", startIndex);
    const restoreIndex = mainSource.indexOf("recoverSessionsFromLeases(_state", startIndex);
    const completionIndex = mainSource.indexOf("}).catch(() => {});", startIndex);

    assert.notStrictEqual(startIndex, -1, "startup must await startHttpServer's promise");
    assert.ok(portGuardIndex > startIndex, "a failed bind must skip recovery");
    assert.ok(restoreIndex > portGuardIndex, "recovery must begin only after the server resolves");
    assert.ok(completionIndex > restoreIndex, "recovery must remain inside the resolved callback");

    const recoveryBlock = mainSource.slice(restoreIndex, completionIndex);
    assert.match(
      recoveryBlock,
      /_runtimeAgentGate\.isAgentEnabled\(agentId\)\s*&&\s*_runtimeAgentGate\.isAgentIntegrationInstalled\(agentId\)/,
      "main must require authoritative enabled and installed integration state",
    );
  });

  it("logs every startup recovery outcome, including one that restores nothing", () => {
    const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
    const restoreIndex = mainSource.indexOf("recoverSessionsFromLeases(_state");
    const summaryIndex = mainSource.indexOf("sessionLog(`startup recovery ${formatRecoverySummary(recovery.summary)}`)", restoreIndex);
    const restoredGuardIndex = mainSource.indexOf("if (restoredSessionIds.length > 0) {", restoreIndex);
    assert.ok(summaryIndex > restoreIndex, "main must log the recovery summary");
    assert.ok(summaryIndex < restoredGuardIndex, "the summary must not depend on a restored session");
  });
});
