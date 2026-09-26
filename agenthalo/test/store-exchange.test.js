"use strict";

// Store build: the sandboxed app's ~/.clawd is inside its container, so the
// app and its hooks exchange runtime.json, the Codex auto-start gate and the
// Claude recovery leases through the authorized tool folders instead.

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const storeExchange = require("../hooks/store-exchange");
const serverConfig = require("../hooks/server-config");
const recoveryLease = require("../hooks/session-recovery-lease");
const sandboxAccess = require("../src/sandbox-access");

const STORE_ENV = Object.freeze({ AGENTHALO_STORE_HOOK: "1" });

describe("store exchange folders", () => {
  let root;
  let home;
  let userDataDir;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-exchange-"));
    home = path.join(root, "home");
    userDataDir = path.join(root, "userData");
    fs.mkdirSync(home, { recursive: true });
  });

  afterEach(() => {
    sandboxAccess.releaseAllAccess();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("looks in the tools' relocated folders first, then every known tool folder", () => {
    const dirs = storeExchange.hookExchangeDirs({
      homeDir: home,
      env: { CLAUDE_CONFIG_DIR: "/custom/claude", CODEX_HOME: "relative/ignored" },
    });
    assert.equal(dirs[0], path.join("/custom/claude", "agenthalo"));
    assert.ok(dirs.includes(path.join(home, ".codex", "agenthalo")));
    assert.ok(dirs.includes(path.join(home, ".claude", "agenthalo")));
    assert.ok(dirs.includes(path.join(home, ".workbuddy", "agenthalo")), "legacy WorkBuddy folder");
    assert.ok(dirs.includes(path.join(home, ".config", "opencode", "agenthalo")));
    assert.equal(new Set(dirs).size, dirs.length);
    assert.ok(!dirs.some((dir) => dir.includes("relative")));
  });

  it("puts the app's folder inside whichever tool folder the user authorized", () => {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
    fs.mkdirSync(path.join(home, ".workbuddy"), { recursive: true });
    sandboxAccess.saveAuthorized("claude-code", path.join(home, ".claude"), "bm", { userDataDir });
    // Chose the home folder rather than ~/.gemini; two tools share ~/.gemini.
    sandboxAccess.saveAuthorized("gemini-cli", home, "bm", { userDataDir });
    sandboxAccess.saveAuthorized("antigravity-cli", path.join(home, ".gemini"), "bm", { userDataDir });
    // Only the legacy WorkBuddy folder exists under the chosen home.
    sandboxAccess.saveAuthorized("workbuddy", home, "bm", { userDataDir });

    assert.equal(sandboxAccess.exchangeDir("claude-code", { userDataDir }), path.join(home, ".claude", "agenthalo"));
    assert.equal(sandboxAccess.exchangeDir("codex", { userDataDir }), null);
    assert.deepEqual(sandboxAccess.exchangeDirs({ userDataDir }), [
      path.join(home, ".claude", "agenthalo"),
      path.join(home, ".gemini", "agenthalo"),
      path.join(home, ".workbuddy", "agenthalo"),
    ]);
  });

  it("leaves out a folder whose bookmark went stale", () => {
    sandboxAccess.saveAuthorized("codex", path.join(home, ".codex"), "bm-old", { userDataDir });
    const electron = {
      app: { startAccessingSecurityScopedResource() { throw new Error("stale"); } },
    };
    sandboxAccess.retainAllAuthorized({ userDataDir, electron });
    assert.deepEqual(sandboxAccess.exchangeDirs({ userDataDir }), []);
    // Stale marks are process-wide; a bookmark that resolves again clears it.
    sandboxAccess.retainAllAuthorized({
      userDataDir,
      electron: { app: { startAccessingSecurityScopedResource: () => () => {} } },
    });
    assert.deepEqual(sandboxAccess.exchangeDirs({ userDataDir }), [path.join(home, ".codex", "agenthalo")]);
  });
});

describe("runtime.json through the authorized folders", () => {
  let root;
  let home;
  let container;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-runtime-mirror-"));
    home = path.join(root, "home");
    container = path.join(root, "container", ".clawd", "runtime.json");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mirrors = () => [path.join(home, ".claude", "agenthalo"), path.join(home, ".codex", "agenthalo")];

  it("lets a store hook read the port the sandboxed app wrote", () => {
    assert.equal(serverConfig.writeRuntimeConfig(23335, {
      runtimeConfigPath: container,
      ownerPid: process.pid,
      mirrorDirs: mirrors(),
    }), true);
    for (const dir of mirrors()) {
      const file = path.join(dir, "runtime.json");
      assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).port, 23335);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
    assert.equal(serverConfig.readRuntimePort({ env: STORE_ENV, homeDir: home }), 23335);
    assert.deepEqual(serverConfig.readRuntimeIdentity({ env: STORE_ENV, homeDir: home }), {
      ok: true, reason: null, port: 23335, ownerPid: process.pid,
    });
    // Outside the store build hooks keep reading ~/.clawd.
    assert.equal(serverConfig.readRuntimePort({ env: {}, homeDir: home }), null);
  });

  it("ignores a copy left by an app that has exited", () => {
    serverConfig.writeRuntimeConfig(23334, { runtimeConfigPath: container, ownerPid: 4242, mirrorDirs: mirrors() });
    const options = { env: STORE_ENV, homeDir: home, processAlive: (pid) => pid !== 4242 };
    assert.equal(serverConfig.readRuntimePort(options), null);
    // A live copy anywhere wins over the stale one.
    serverConfig.writeRuntimeConfig(23336, {
      runtimeConfigPath: container,
      ownerPid: process.pid,
      mirrorDirs: [path.join(home, ".codex", "agenthalo")],
    });
    assert.equal(serverConfig.readRuntimePort(options), 23336);
  });

  it("puts the app's port first when a hook picks where to post", () => {
    serverConfig.writeRuntimeConfig(23337, { runtimeConfigPath: container, ownerPid: process.pid, mirrorDirs: mirrors() });
    const saved = { HOME: process.env.HOME, STORE: process.env.AGENTHALO_STORE_HOOK, CLAUDE: process.env.CLAUDE_CONFIG_DIR };
    try {
      process.env.HOME = home;
      process.env.AGENTHALO_STORE_HOOK = "1";
      delete process.env.CLAUDE_CONFIG_DIR;
      assert.equal(serverConfig.getPortCandidates(null)[0], 23337);
    } finally {
      for (const [key, name] of [["HOME", "HOME"], ["STORE", "AGENTHALO_STORE_HOOK"], ["CLAUDE", "CLAUDE_CONFIG_DIR"]]) {
        if (saved[key] === undefined) delete process.env[name];
        else process.env[name] = saved[key];
      }
    }
  });

  it("removes only its own copies on quit", () => {
    serverConfig.writeRuntimeConfig(23333, { runtimeConfigPath: container, ownerPid: 111, mirrorDirs: mirrors() });
    const codexCopy = path.join(home, ".codex", "agenthalo", "runtime.json");
    serverConfig.writeRuntimeConfig(23334, { runtimeConfigPath: codexCopy, ownerPid: 222 });
    const claudeCopy = path.join(home, ".claude", "agenthalo", "runtime.json");
    assert.equal(JSON.parse(fs.readFileSync(claudeCopy, "utf8")).ownerPid, 111);
    assert.equal(serverConfig.clearRuntimeConfig(container, { ownerPid: 111, mirrorDirs: mirrors() }), true);
    assert.equal(fs.existsSync(container), false);
    assert.equal(fs.existsSync(claudeCopy), false);
    assert.equal(JSON.parse(fs.readFileSync(codexCopy, "utf8")).ownerPid, 222, "another instance's copy stays");
  });
});

describe("store app server", () => {
  function makeServer(mirrorDirs) {
    const writes = [];
    const clears = [];
    const api = require("../src/server")({
      createHttpServer() {
        const server = new EventEmitter();
        server.listening = true;
        server.listen = function () { this.emit("listening"); };
        server.close = () => {};
        server.address = () => ({ address: "127.0.0.1", port: 23334 });
        return server;
      },
      setImmediate: () => {},
      getPortCandidates: () => [23334],
      writeRuntimeConfig: (port, options) => { writes.push({ port, options }); return true; },
      clearRuntimeConfig: (filePath, options) => { clears.push({ filePath, options }); return true; },
      readRuntimePort: () => null,
      readRuntimeIdentity: () => ({ ok: false }),
      isWinHost: false,
      getRuntimeMirrorDirs: () => mirrorDirs.slice(),
    });
    return { api, writes, clears };
  }

  it("mirrors runtime.json when it starts listening, on refresh, and clears the mirrors on quit", async () => {
    const mirrorDirs = ["/Users/me/.claude/agenthalo"];
    const { api, writes, clears } = makeServer(mirrorDirs);
    assert.equal(api.refreshRuntimeConfig(), false, "nothing to write before listening");
    assert.equal(await api.startHttpServer(), 23334);
    assert.deepEqual(writes.map((w) => [w.port, w.options.mirrorDirs]), [[23334, ["/Users/me/.claude/agenthalo"]]]);
    mirrorDirs.push("/Users/me/.codex/agenthalo");
    assert.equal(api.refreshRuntimeConfig(), true);
    assert.deepEqual(writes[1].options.mirrorDirs, mirrorDirs);
    api.cleanup();
    assert.deepEqual(clears.map((c) => c.options.mirrorDirs), [mirrorDirs]);
  });
});

describe("Codex auto-start gate through the authorized folder", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-codex-gate-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("is written where store Codex hooks read it", () => {
    const home = path.join(root, "home");
    const containerGate = path.join(root, "container", ".clawd", "codex-auto-start.json");
    const codexExchange = path.join(home, ".codex", "agenthalo");
    assert.equal(serverConfig.writeCodexAutoStartGate(true, { gatePath: containerGate, mirrorDirs: [codexExchange] }), true);
    assert.equal(serverConfig.readCodexAutoStartGate({ env: STORE_ENV, homeDir: home }), true);
    assert.equal(serverConfig.readCodexAutoStartGate({ env: {}, homeDir: home }), false, "the real ~/.clawd has no gate");
    // CODEX_HOME moves the folder for the hook as it does for Codex.
    const moved = path.join(root, "codex-home");
    serverConfig.writeCodexAutoStartGate(true, { gatePath: containerGate, mirrorDirs: [path.join(moved, "agenthalo")] });
    assert.equal(serverConfig.readCodexAutoStartGate({ env: { ...STORE_ENV, CODEX_HOME: moved }, homeDir: home }), true);
    serverConfig.writeCodexAutoStartGate(false, { gatePath: containerGate, mirrorDirs: [codexExchange] });
    assert.equal(serverConfig.readCodexAutoStartGate({ env: STORE_ENV, homeDir: home }), false);
  });
});

describe("Claude recovery leases in the store build", () => {
  it("are kept in the Claude folder the app was allowed to read", () => {
    assert.equal(
      recoveryLease.getRecoveryDir({ env: { ...STORE_ENV, CLAUDE_CONFIG_DIR: "/Users/me/.claude" } }),
      path.join("/Users/me/.claude", "agenthalo", recoveryLease.LEASE_DIR_NAME)
    );
    assert.equal(
      recoveryLease.getRecoveryDir({ env: STORE_ENV, homeDir: "/Users/me" }),
      path.join("/Users/me", ".claude", "agenthalo", recoveryLease.LEASE_DIR_NAME)
    );
    assert.equal(
      recoveryLease.getRecoveryDir({ env: {} }),
      path.join(os.homedir(), ".clawd", recoveryLease.LEASE_DIR_NAME)
    );
  });

  it("are the ones the app restores from", () => {
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
    assert.match(main, /\.\.\.\(process\.mas \? storeRecoveryLeaseOptions\(\) : \{\}\)/);
    assert.match(main, /dirFor\("claude-code"\)[\s\S]{0,200}LEASE_DIR_NAME/);
    // The sandbox cannot run the setuid ps, so the helper vouches for the
    // processes behind each lease.
    assert.match(
      main,
      /function storeRecoveryLeaseOptions\(\) \{[\s\S]{0,600}require\("\.\/mac-proc-info"\)\.getProcessStartIdentities\(pids\)/
    );
  });
});

describe("exchange folders follow the connected tools", () => {
  const { clearExchangeDir, createStoreExchangeFolders } = require("../src/store-exchange-folders");
  let root;
  let home;
  let userDataDir;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-exchange-sync-"));
    home = path.join(root, "home");
    userDataDir = path.join(root, "userData");
    for (const folder of [".claude", ".codex"]) {
      fs.mkdirSync(path.join(home, folder), { recursive: true });
      sandboxAccess.saveAuthorized(folder === ".claude" ? "claude-code" : "codex", path.join(home, folder), "bm", { userDataDir });
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const exchange = (folder) => path.join(home, folder, "agenthalo");

  function fillExchange(dir) {
    serverConfig.writeRuntimeConfig(23333, { runtimeConfigPath: path.join(dir, "runtime.json"), ownerPid: process.pid });
    serverConfig.writeCodexAutoStartGate(true, { gatePath: path.join(dir, "codex-auto-start.json") });
    fs.mkdirSync(path.join(dir, recoveryLease.LEASE_DIR_NAME), { recursive: true });
    fs.writeFileSync(path.join(dir, recoveryLease.LEASE_DIR_NAME, "session-recovery-v1-x.json"), "{}");
  }

  it("removes the whole agenthalo folder and nothing next to it", () => {
    const dir = exchange(".claude");
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");
    fillExchange(dir);
    assert.equal(clearExchangeDir(dir), true);
    assert.equal(fs.existsSync(dir), false);

    // Whatever else ended up inside goes too, including a runtime.json whose
    // owner is some other process: the folder is AgentHalo's alone.
    fillExchange(dir);
    fs.writeFileSync(path.join(dir, "notes.txt"), "stray");
    serverConfig.writeRuntimeConfig(23334, { runtimeConfigPath: path.join(dir, "runtime.json"), ownerPid: 999999 });
    assert.equal(clearExchangeDir(dir), true);
    assert.equal(fs.existsSync(dir), false);
    assert.equal(clearExchangeDir(dir), true, "an absent folder is already clear");

    assert.equal(clearExchangeDir(path.join(home, ".claude")), false, "only an agenthalo folder is touched");
    assert.deepEqual(fs.readdirSync(path.join(home, ".claude")), ["settings.json"]);
  });

  it("removes a symlink named agenthalo without following it", () => {
    const target = path.join(root, "elsewhere");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "keep.txt"), "x");
    fs.symlinkSync(target, exchange(".claude"));
    assert.equal(clearExchangeDir(exchange(".claude")), true);
    assert.equal(fs.existsSync(exchange(".claude")), false);
    assert.ok(fs.existsSync(path.join(target, "keep.txt")));
  });

  it("sweeps a disconnected folder again after hooks that were already running", () => {
    const connected = new Set(["claude-code"]);
    const timers = [];
    const folders = createStoreExchangeFolders({
      userDataDir,
      isConnected: (agentId) => connected.has(agentId),
      isAuthoritative: () => true,
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; },
    });
    folders.sync();
    fillExchange(exchange(".claude"));
    connected.delete("claude-code");
    folders.sync();
    assert.equal(fs.existsSync(exchange(".claude")), false);
    assert.equal(timers.length, 1);
    assert.ok(timers[0].ms > 0);

    // A hook that passed its check just before the folder went writes a lease.
    const leaseDir = path.join(exchange(".claude"), recoveryLease.LEASE_DIR_NAME);
    fs.mkdirSync(leaseDir, { recursive: true });
    fs.writeFileSync(path.join(leaseDir, "late.json"), "{}");
    timers[0].fn();
    assert.equal(fs.existsSync(exchange(".claude")), false);

    // A tool connected again before the sweep keeps its folder.
    fillExchange(exchange(".codex"));
    connected.add("codex");
    const reconnect = createStoreExchangeFolders({
      userDataDir,
      isConnected: (agentId) => connected.has(agentId),
      isAuthoritative: () => true,
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return null; },
    });
    connected.delete("codex");
    reconnect.sync();
    connected.add("codex");
    fillExchange(exchange(".codex"));
    timers[timers.length - 1].fn();
    assert.ok(fs.existsSync(path.join(exchange(".codex"), "runtime.json")));
  });

  it("writes to connected tools only and clears a tool once it is disconnected", () => {
    const connected = new Set(["claude-code"]);
    let refreshes = 0;
    fillExchange(exchange(".codex")); // left by an earlier run
    const folders = createStoreExchangeFolders({
      userDataDir,
      isConnected: (agentId) => connected.has(agentId),
      isAuthoritative: () => true,
      refreshRuntimeConfig: () => { refreshes += 1; },
    });
    assert.deepEqual(folders.dirs(), [exchange(".claude")]);
    assert.equal(folders.dirFor("codex"), null);
    assert.equal(folders.sync(), true);
    assert.equal(fs.existsSync(exchange(".codex")), false, "the disconnected tool's folder is cleared on the first sync");
    assert.equal(refreshes, 1);

    fillExchange(exchange(".claude"));
    connected.delete("claude-code");
    connected.add("codex");
    folders.sync();
    assert.equal(fs.existsSync(exchange(".claude")), false);
    assert.deepEqual(folders.dirs(), [exchange(".codex")]);
    assert.equal(folders.dirFor("codex"), exchange(".codex"));
  });

  it("disconnecting Claude Code in Settings removes its folder and stops writing there", async () => {
    const { createSettingsController } = require("../src/settings-controller");
    const prefs = require("../src/prefs");
    const { isAgentIntegrationInstalled } = require("../src/agent-gate");
    const defaults = prefs.getDefaults();
    const uninstalled = [];
    const ctrl = createSettingsController({
      prefsPath: path.join(root, "prefs.json"),
      loadResult: {
        snapshot: {
          ...defaults,
          agents: {
            ...defaults.agents,
            "claude-code": { ...defaults.agents["claude-code"], integrationInstalled: true, enabled: true },
            codex: { ...defaults.agents.codex, integrationInstalled: false, enabled: false },
          },
        },
        locked: false,
      },
      injectedDeps: {
        uninstallIntegrationForAgent: async (agentId) => {
          uninstalled.push(agentId);
          return { status: "ok", removed: 14, changed: true };
        },
        stopIntegrationForAgent: () => true,
        writeCodexAutoStartGate: () => true,
      },
    });
    // What main.js wires up in the store build.
    const folders = createStoreExchangeFolders({
      userDataDir,
      isConnected: (agentId) => isAgentIntegrationInstalled(ctrl.getSnapshot(), agentId),
      isAuthoritative: () => true,
      refreshRuntimeConfig: () => serverConfig.writeRuntimeConfig(23334, {
        runtimeConfigPath: path.join(root, "container", ".clawd", "runtime.json"),
        ownerPid: process.pid,
        mirrorDirs: folders.dirs(),
      }),
      setTimeout: () => null,
    });
    ctrl.subscribeKey("agents", () => folders.sync());
    folders.sync();
    fillExchange(exchange(".claude"));
    assert.ok(fs.existsSync(path.join(exchange(".claude"), "runtime.json")));

    const result = await ctrl.applyCommand("uninstallAgentIntegration", { agentId: "claude-code" });
    assert.equal(result.status, "ok");
    assert.deepEqual(uninstalled, ["claude-code"]);
    const entry = ctrl.getSnapshot().agents["claude-code"];
    assert.equal(entry.integrationInstalled, false, "the row reads Connect again");
    assert.equal(entry.enabled, false, "and its switch is off");
    assert.equal(fs.existsSync(exchange(".claude")), false, "the whole agenthalo folder is gone");

    // Later syncs (another setting changing, a runtime refresh) leave it gone.
    await ctrl.applyCommand("setAgentFlag", { agentId: "claude-code", flag: "permissionsEnabled", value: false });
    folders.sync();
    assert.equal(fs.existsSync(exchange(".claude")), false);
    assert.deepEqual(fs.readdirSync(path.join(home, ".claude")), []);
  });

  it("touches nothing while the preferences cannot say what is connected", () => {
    fillExchange(exchange(".claude"));
    const folders = createStoreExchangeFolders({
      userDataDir,
      isConnected: () => false,
      isAuthoritative: () => false,
    });
    assert.deepEqual(folders.dirs(), []);
    assert.equal(folders.dirFor("claude-code"), null);
    assert.equal(folders.sync(), false);
    assert.ok(fs.existsSync(path.join(exchange(".claude"), "runtime.json")));
  });
});
