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
