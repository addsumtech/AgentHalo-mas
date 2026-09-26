"use strict";

// The Mac App Store build and the original AgentHalo (com.agenthalo.desktop,
// or any other clawd install) can both keep hooks in one
// ~/.claude/settings.json. The original app's matching rules are the default
// (non-store) rules of hooks/install.js, json-utils.js and server-config.js:
// every command mentioning clawd-hook.js / auto-start.js / claude-statusline.js
// and every http://127.0.0.1:<23333-23337>/permission URL is its own. Two
// installs that both claim everything rewrote settings.json once a second,
// forever, each through its fs watcher. These tests run both installers, and
// both settings watchers, against one file.

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const install = require("../hooks/install");
const {
  buildPermissionUrl,
  buildStorePermissionUrl,
  getBundledNodeLauncherPath,
  isManagedPermissionUrl,
  isStorePermissionUrl,
  SERVER_PORTS,
} = require("../hooks/server-config");
const {
  classifyManagedClaudeStateHookCommand,
  commandMatchesMarker,
  extractExistingNodeBin,
} = require("../hooks/json-utils");
const { createClaudeSettingsWatcher } = require("../src/claude-settings-watcher");

const VERSION = Object.freeze({ version: "2.1.283", source: "test", status: "known" });
const VERSIONED_EVENTS = ["PreCompact", "PostCompact", "StopFailure"];
const USER_HOOK = "bash ~/.claude/hooks/check-stale-copy.sh";
const OTHER_PORT = 23333;
const STORE_PORT = 23334;
// The original app runs hooks with a real Node; this one exists everywhere.
const OTHER_NODE = process.execPath;
const HOOKS_DIR = path.join(__dirname, "..", "hooks").replace(/\\/g, "/");

function commandsOf(settings, event) {
  const out = [];
  for (const entry of (settings.hooks && settings.hooks[event]) || []) {
    for (const hook of Array.isArray(entry.hooks) ? entry.hooks : [entry]) {
      if (hook && typeof hook.command === "string") out.push(hook.command);
    }
  }
  return out;
}

function urlsOf(settings, event) {
  const out = [];
  for (const entry of (settings.hooks && settings.hooks[event]) || []) {
    for (const hook of Array.isArray(entry.hooks) ? entry.hooks : [entry]) {
      if (hook && hook.type === "http") out.push(hook.url);
    }
  }
  return out;
}

describe("store build and another AgentHalo install sharing settings.json", () => {
  let dir;
  let settingsPath;

  const read = () => JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const backups = () => fs.readdirSync(dir).filter((name) => name.includes(".clawd-cleanup-"));

  const otherSync = () => install.registerHooksAsync({
    settingsPath,
    storeHooks: false,
    port: OTHER_PORT,
    nodeBin: OTHER_NODE,
    autoStart: true,
    claudeVersionInfo: VERSION,
    silent: true,
  });
  const storeSync = () => install.registerHooksAsync({
    settingsPath,
    storeHooks: true,
    port: STORE_PORT,
    autoStart: true,
    claudeVersionInfo: VERSION,
    silent: true,
  });

  function watcherFor({ store, port, sync, versioned = [] }) {
    const syncs = [];
    const watcher = createClaudeSettingsWatcher({
      storeHooks: store,
      claudeSettingsPath: settingsPath,
      claudeSettingsDir: dir,
      autoStartWithClaude: true,
      getHookServerPort: () => port,
      getVersionedHookEvents: () => versioned,
      syncClawdHooks: async (options) => {
        syncs.push(options.source);
        return sync();
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {},
    });
    return { watcher, syncs };
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-coexist-"));
    settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ matcher: "", hooks: [{ type: "command", command: USER_HOOK }] }],
      },
    }, null, 2));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes store entries none of the other install's rules match", async () => {
    await storeSync();
    const settings = read();
    const storeCommands = Object.keys(settings.hooks).flatMap((event) => (
      commandsOf(settings, event).filter((command) => command !== USER_HOOK)
    ));
    assert.equal(storeCommands.length, 15, "11 core + 3 versioned events and auto-start");
    for (const command of storeCommands) {
      for (const marker of ["clawd-hook.js", "auto-start.js", "auto-start.sh", "claude-statusline.js"]) {
        assert.equal(commandMatchesMarker(command, marker), false, `${command} mentions ${marker}`);
      }
      assert.ok(command.startsWith(`"${getBundledNodeLauncherPath()}" "${HOOKS_DIR}/agenthalo-store-`), command);
    }
    for (const [event] of Object.entries(settings.hooks)) {
      for (const command of commandsOf(settings, event)) {
        assert.equal(classifyManagedClaudeStateHookCommand(command, settings, event), null);
      }
    }
    assert.equal(
      commandsOf(settings, "PreToolUse")[0],
      `"${getBundledNodeLauncherPath()}" "${HOOKS_DIR}/agenthalo-store-hook.js" PreToolUse`
    );
    assert.equal(
      commandsOf(settings, "SessionStart")[0],
      `"${getBundledNodeLauncherPath()}" "${HOOKS_DIR}/agenthalo-store-autostart.js"`
    );
    // The other install takes a Node path only from its own marker commands,
    // so it can no longer pick up the store launcher.
    assert.equal(extractExistingNodeBin(settings, "clawd-hook.js", { nested: true }), null);

    const url = urlsOf(settings, "PermissionRequest")[0];
    assert.equal(url, `http://127.0.0.1:${STORE_PORT}/agenthalo-store/approval`);
    assert.equal(isManagedPermissionUrl(url), false);
    assert.ok(!url.includes("/permission"));
    for (const port of SERVER_PORTS) {
      assert.equal(isManagedPermissionUrl(buildStorePermissionUrl(port)), false);
      assert.equal(isStorePermissionUrl(buildStorePermissionUrl(port)), true);
      assert.equal(isStorePermissionUrl(buildPermissionUrl(port)), false);
    }
  });

  it("converges with no further writes when both sides keep syncing", async () => {
    await otherSync();
    await storeSync();
    const converged = fs.readFileSync(settingsPath, "utf8");
    const backupCount = backups().length;

    for (let round = 0; round < 4; round++) {
      for (const result of [await otherSync(), await storeSync()]) {
        assert.equal(result.added + result.updated + result.removed, 0, `round ${round}`);
      }
    }
    assert.equal(fs.readFileSync(settingsPath, "utf8"), converged);
    assert.equal(backups().length, backupCount);

    const settings = read();
    assert.deepEqual(commandsOf(settings, "UserPromptSubmit"), [
      USER_HOOK,
      `"${OTHER_NODE}" "${HOOKS_DIR}/clawd-hook.js" UserPromptSubmit`,
      `"${getBundledNodeLauncherPath()}" "${HOOKS_DIR}/agenthalo-store-hook.js" UserPromptSubmit`,
    ]);
    for (const event of [...install.CLAUDE_CORE_HOOK_EVENTS, ...VERSIONED_EVENTS]) {
      const commands = commandsOf(settings, event);
      assert.equal(commands.filter((command) => command.includes("/clawd-hook.js")).length, 1, event);
      assert.equal(commands.filter((command) => command.includes("/agenthalo-store-hook.js")).length, 1, event);
    }
    assert.deepEqual(urlsOf(settings, "PermissionRequest"), [
      buildPermissionUrl(OTHER_PORT),
      buildStorePermissionUrl(STORE_PORT),
    ]);
  });

  it("settles both settings watchers after one repair each", async () => {
    const other = watcherFor({ store: false, port: OTHER_PORT, sync: otherSync });
    const store = watcherFor({ store: true, port: STORE_PORT, sync: storeSync, versioned: VERSIONED_EVENTS });

    for (let round = 0; round < 6; round++) {
      await other.watcher.checkNow("settings-event");
      await store.watcher.checkNow("settings-event");
    }
    assert.deepEqual(other.syncs, ["settings-watch"]);
    assert.deepEqual(store.syncs, ["settings-watch"]);
    assert.equal(other.watcher.getHealthStatus().status, "healthy");
    assert.equal(store.watcher.getHealthStatus().status, "healthy");
    assert.ok(commandsOf(read(), "UserPromptSubmit").includes(USER_HOOK));
  });

  it("control: two installs that both claim every entry never settle", async () => {
    const secondSync = () => install.registerHooksAsync({
      settingsPath,
      storeHooks: false,
      port: STORE_PORT,
      nodeBin: OTHER_NODE,
      claudeVersionInfo: VERSION,
      silent: true,
    });
    const first = watcherFor({
      store: false,
      port: OTHER_PORT,
      sync: () => install.registerHooksAsync({
        settingsPath, storeHooks: false, port: OTHER_PORT, nodeBin: OTHER_NODE, claudeVersionInfo: VERSION, silent: true,
      }),
    });
    const second = watcherFor({ store: false, port: STORE_PORT, sync: secondSync });
    for (let round = 0; round < 6; round++) {
      await first.watcher.checkNow("settings-event");
      await second.watcher.checkNow("settings-event");
    }
    // Every check finds the other side's port in the permission URL and
    // rewrites it; each rewrite verifies, so the retry limit never trips.
    assert.ok(first.syncs.length >= 6 && second.syncs.length >= 6, `${first.syncs.length}/${second.syncs.length}`);
  });

  it("disconnecting either side removes only that side's entries", async () => {
    await otherSync();
    await storeSync();
    install.registerClaudeStatusline({ settingsPath, storeHooks: true, silent: true });

    const storeRemoved = await install.unregisterHooksAsync({ settingsPath, storeHooks: true, port: STORE_PORT });
    assert.equal(storeRemoved.removed, 16, "15 commands and the permission hook");
    install.unregisterClaudeStatusline({ settingsPath, storeHooks: true, silent: true });
    let settings = read();
    assert.equal(settings.statusLine, undefined);
    assert.ok(!JSON.stringify(settings).includes("agenthalo-store"));
    assert.deepEqual(commandsOf(settings, "UserPromptSubmit"), [
      USER_HOOK,
      `"${OTHER_NODE}" "${HOOKS_DIR}/clawd-hook.js" UserPromptSubmit`,
    ]);
    assert.deepEqual(urlsOf(settings, "PermissionRequest"), [buildPermissionUrl(OTHER_PORT)]);
    assert.equal(commandsOf(settings, "SessionStart").length, 2, "the other install's auto-start and state hook");

    await storeSync();
    await install.unregisterHooksAsync({ settingsPath, storeHooks: false });
    settings = read();
    assert.ok(!JSON.stringify(settings).includes("clawd-hook.js"));
    assert.ok(!JSON.stringify(settings).includes("/permission"));
    assert.deepEqual(commandsOf(settings, "UserPromptSubmit"), [
      USER_HOOK,
      `"${getBundledNodeLauncherPath()}" "${HOOKS_DIR}/agenthalo-store-hook.js" UserPromptSubmit`,
    ]);
    assert.deepEqual(urlsOf(settings, "PermissionRequest"), [buildStorePermissionUrl(STORE_PORT)]);
  });

  it("leaves the other install's statusline alone, and the other install leaves the store's", () => {
    install.registerClaudeStatusline({ settingsPath, storeHooks: false, nodeBin: OTHER_NODE, silent: true });
    const theirs = read().statusLine;
    const storeTry = install.registerClaudeStatusline({ settingsPath, storeHooks: true, silent: true });
    assert.equal(storeTry.skippedExisting, true);
    assert.equal(install.unregisterClaudeStatusline({ settingsPath, storeHooks: true, silent: true }).removed, 0);
    assert.deepEqual(read().statusLine, theirs);

    install.unregisterClaudeStatusline({ settingsPath, storeHooks: false, silent: true });
    install.registerClaudeStatusline({ settingsPath, storeHooks: true, silent: true });
    const ours = read().statusLine;
    assert.equal(ours.command, `"${getBundledNodeLauncherPath()}" "${HOOKS_DIR}/agenthalo-store-statusline.js"`);
    assert.equal(
      install.registerClaudeStatusline({ settingsPath, storeHooks: false, nodeBin: OTHER_NODE, silent: true }).skippedExisting,
      true
    );
    assert.equal(install.unregisterClaudeStatusline({ settingsPath, storeHooks: false, silent: true }).removed, 0);
    assert.deepEqual(read().statusLine, ours);
  });

  it("migrates entries an earlier store build wrote from this bundle, and nothing else", async () => {
    const launcher = getBundledNodeLauncherPath();
    const legacyOwn = (event) => `"${launcher}" "${HOOKS_DIR}/clawd-hook.js" ${event}`;
    // Another install once took the store launcher for its Node path; that
    // entry runs the other install's script and stays the other install's.
    const foreignOnLauncher = `"${launcher}" "/Applications/AgentHalo.app/Contents/Resources/app.asar.unpacked/hooks/clawd-hook.js" Stop`;
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: legacyOwn("PreToolUse"), async: true, timeout: 5 }] }],
        Stop: [{ matcher: "", hooks: [{ type: "command", command: foreignOnLauncher }] }],
        SessionStart: [{ matcher: "", hooks: [{ type: "command", command: `"${launcher}" "${HOOKS_DIR}/auto-start.js"` }] }],
        PermissionRequest: [{ matcher: "", hooks: [{ type: "http", url: buildPermissionUrl(STORE_PORT), timeout: 600 }] }],
      },
    }, null, 2));

    await storeSync();
    let settings = read();
    assert.deepEqual(commandsOf(settings, "PreToolUse"), [
      `"${launcher}" "${HOOKS_DIR}/agenthalo-store-hook.js" PreToolUse`,
    ]);
    assert.deepEqual(commandsOf(settings, "Stop"), [
      foreignOnLauncher,
      `"${launcher}" "${HOOKS_DIR}/agenthalo-store-hook.js" Stop`,
    ]);
    assert.equal(commandsOf(settings, "SessionStart").filter((c) => c.includes("/auto-start.js")).length, 0);
    // The shared-form URL stays: another install's state hook (the Stop
    // entry above) is present, so it may be that install's.
    assert.deepEqual(urlsOf(settings, "PermissionRequest"), [
      buildPermissionUrl(STORE_PORT),
      buildStorePermissionUrl(STORE_PORT),
    ]);

    // With no other install's hooks left, the old store URL on the store's
    // own port can only be the earlier store build's.
    settings.hooks.Stop = settings.hooks.Stop.filter((entry) => !JSON.stringify(entry).includes("/Applications/"));
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    await storeSync();
    assert.deepEqual(urlsOf(read(), "PermissionRequest"), [buildStorePermissionUrl(STORE_PORT)]);
  });

  it("recognises an old-format store entry only inside this app's own bundle", () => {
    const ownership = install.getClaudeHookOwnership({ storeHooks: true });
    const launcher = getBundledNodeLauncherPath();
    assert.equal(ownership.stateHookKind(`"${launcher}" "${HOOKS_DIR}/clawd-hook.js" Stop`), "literal");
    assert.equal(ownership.stateHookKind(`"/Other.app/hooks/node-launcher.sh" "/Other.app/hooks/clawd-hook.js" Stop`), null);
    assert.equal(ownership.stateHookKind(`"${OTHER_NODE}" "${HOOKS_DIR}/clawd-hook.js" Stop`), null);
    // Moved or updated store app: the entry script name is the marker.
    assert.equal(ownership.stateHookKind(`"/Moved.app/hooks/node-launcher.sh" "/Moved.app/hooks/agenthalo-store-hook.js" Stop`), "literal");
    assert.equal(ownership.stateHookKind(`"/x/node" "/x/my-agenthalo-store-hook.js" Stop`), null);
    assert.equal(ownership.isAutoStartCommand(`"/Moved.app/hooks/node-launcher.sh" "/Moved.app/hooks/agenthalo-store-autostart.js"`), true);
    assert.equal(ownership.isAutoStartCommand(`"${OTHER_NODE}" "/Applications/AgentHalo.app/hooks/auto-start.js"`), false);
    assert.equal(ownership.isPermissionUrl(buildPermissionUrl(STORE_PORT)), false);
    assert.equal(ownership.isPermissionUrl(buildStorePermissionUrl(STORE_PORT)), true);
  });
});

describe("store entry scripts", () => {
  it("run the shared Claude hook, auto-start and statusline code", () => {
    const { runSpawnedHook } = require("./helpers/spawned-hook");
    const statusline = runSpawnedHook({
      script: path.join(__dirname, "..", "hooks", install.STORE_STATUSLINE_SCRIPT),
      payload: { model: { display_name: "Opus" }, workspace: { current_dir: "/tmp" } },
    });
    assert.equal(statusline.status, 0, statusline.stderr);
    assert.ok(statusline.stdout.trim().length > 0, "the statusline prints a line");

    // Each entry script hands over to the entry point the shared script runs
    // when started directly.
    const read = (name) => fs.readFileSync(path.join(__dirname, "..", "hooks", name), "utf8");
    assert.match(read(install.STORE_HOOK_SCRIPT), /require\("\.\/clawd-hook\.js"\)\.main\(\);/);
    assert.match(read(install.STORE_AUTO_START_SCRIPT), /require\("\.\/auto-start\.js"\)\.main\(\);/);
    assert.match(read(install.STORE_STATUSLINE_SCRIPT), /require\("\.\/claude-statusline\.js"\)\.run\(\);/);
    assert.equal(typeof require("../hooks/clawd-hook").main, "function");
    assert.equal(typeof require("../hooks/auto-start").main, "function");
    assert.equal(typeof require("../hooks/claude-statusline").run, "function");
  });
});

describe("store hook launcher", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-launcher-env-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function runThroughLauncher(launcher, script) {
    fs.writeFileSync(script, "console.log(process.env.AGENTHALO_STORE_HOOK || 'unset');");
    const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
    delete env.AGENTHALO_STORE_HOOK;
    return execFileSync(launcher, [script], { encoding: "utf8", env }).trim();
  }

  it("marks only scripts bundled next to it as store hooks", () => {
    const bundle = path.join(root, "hooks");
    fs.mkdirSync(bundle);
    const launcher = path.join(bundle, "node-launcher.sh");
    fs.copyFileSync(getBundledNodeLauncherPath(), launcher);
    fs.chmodSync(launcher, 0o755);
    assert.equal(runThroughLauncher(launcher, path.join(bundle, "own-hook.js")), "1");
    // Another install that took this launcher for its Node path keeps its
    // own hooks' behaviour.
    assert.equal(runThroughLauncher(launcher, path.join(root, "clawd-hook.js")), "unset");
  });
});
