"use strict";

// Sandboxed store build: tool folders are reached through the authorized
// home (or CODEX_HOME), never through os.homedir(), which is the container.

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { cleanupIntegrations } = require("../hooks/cleanup-integrations");
const { registerCodeBuddyHooks, unregisterCodeBuddyHooks } = require("../hooks/codebuddy-install");
const { resolveCodewhaleConfigPath } = require("../hooks/codewhale-install");
const CodexLogMonitor = require("../agents/codex-log-monitor");
const codexAgent = require("../agents/codex");

describe("store sandbox tool paths", () => {
  let root;
  let home;
  let previousCodexHome;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-store-paths-"));
    home = path.join(root, "home");
    fs.mkdirSync(home, { recursive: true });
    previousCodexHome = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
  });

  afterEach(() => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes CodeBuddy hooks under the given home", () => {
    const settingsPath = path.join(home, ".codebuddy", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, "{}\n");
    const result = registerCodeBuddyHooks({ silent: true, homeDir: home, nodeBin: "/usr/local/bin/node" });
    assert.ok(result.added > 0);
    assert.ok(Object.keys(JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks || {}).length > 0);
    unregisterCodeBuddyHooks({ homeDir: home });
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks || {}, {});
  });

  it("resolves the CodeWhale config under the given home", () => {
    assert.equal(
      resolveCodewhaleConfigPath({ homeDir: home, env: {} }),
      path.join(home, ".codewhale", "config.toml")
    );
  });

  it("cleans only the allowed agents", async () => {
    const result = await cleanupIntegrations({
      homeDir: home,
      agentIds: ["gemini-cli"],
      silent: true,
      claudeCleanupResult: { status: "ok", removed: 0, changed: false },
    });
    assert.deepEqual(result.agents.map((agent) => agent.agentId), ["gemini-cli"]);
  });

  it("reads Codex sessions from CODEX_HOME and follows it when it changes", () => {
    const monitor = new CodexLogMonitor(codexAgent, () => {});
    assert.equal(monitor._baseDir, path.join(os.homedir(), ".codex", "sessions"));
    process.env.CODEX_HOME = path.join(home, ".codex");
    monitor._followCodexHome();
    assert.equal(monitor._baseDir, path.join(home, ".codex", "sessions"));
    assert.equal(monitor._archivedDir, path.join(home, ".codex", "archived_sessions"));
  });
});

describe("store build hook launcher", () => {
  let root;
  let previousMas;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-launcher-"));
    previousMas = process.mas;
    process.mas = true;
  });

  afterEach(() => {
    process.mas = previousMas;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("points hook commands at the executable launcher bundled with the hooks", () => {
    const { resolveNodeBin, getBundledNodeLauncherPath } = require("../hooks/server-config");
    const launcher = getBundledNodeLauncherPath();
    assert.equal(resolveNodeBin({ isElectron: true }), launcher);
    assert.equal(path.basename(launcher), "node-launcher.sh");
    assert.ok(fs.statSync(launcher).mode & 0o111, "launcher must be executable");

    const { registerHooks } = require("../hooks/install");
    const home = path.join(root, "home");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    registerHooks({ silent: true, homeDir: home, port: 23333 });
    const settings = fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8");
    assert.ok(settings.includes("node-launcher.sh"));
  });

  it("keeps the launcher out of the per-process node memo", () => {
    const { resolveNodeBin, getBundledNodeLauncherPath } = require("../hooks/server-config");
    const options = {
      platform: "darwin",
      isElectron: true,
      cache: true,
      homeDir: path.join(root, "home"),
      env: { PATH: `/memo-test-${path.basename(root)}` },
      accessSync: (candidate) => {
        if (candidate !== "/opt/homebrew/bin/node") throw new Error("missing");
      },
    };
    process.mas = false;
    assert.equal(resolveNodeBin(options), "/opt/homebrew/bin/node");
    process.mas = true;
    assert.equal(resolveNodeBin(options), getBundledNodeLauncherPath());
    process.mas = false;
    assert.equal(resolveNodeBin(options), "/opt/homebrew/bin/node");
  });

  it("runs the hook script with node and passes stdin and arguments through", () => {
    const { execFileSync } = require("node:child_process");
    const { getBundledNodeLauncherPath } = require("../hooks/server-config");
    const script = path.join(root, "echo.js");
    fs.writeFileSync(script, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(process.argv.slice(2).join(',')+'|'+s.trim()));");
    const out = execFileSync(getBundledNodeLauncherPath(), [script, "PreToolUse", "x"], {
      input: '{"a":1}',
      encoding: "utf8",
      env: { ...process.env, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` },
    });
    assert.equal(out.trim(), 'PreToolUse,x|{"a":1}');
  });
});
