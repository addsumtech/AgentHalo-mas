"use strict";

// Store build: the sandbox only reaches the ~/.claude folder the user
// authorized, so every Claude hook write and check must use that folder's
// home, and nothing may land in os.homedir() (the app container).

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const initServer = require("../src/server");

function fakeHttpServerFactory() {
  return () => {
    const server = new EventEmitter();
    server.listen = () => server.emit("listening");
    server.close = () => {};
    return server;
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

describe("Claude hooks in the authorized home", () => {
  let root;
  let authorizedHome;
  let containerHome;
  let previousHome;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-claude-home-"));
    authorizedHome = path.join(root, "real-home");
    containerHome = path.join(root, "container-home");
    fs.mkdirSync(path.join(authorizedHome, ".claude"), { recursive: true });
    fs.mkdirSync(containerHome, { recursive: true });
    previousHome = process.env.HOME;
    // os.homedir() stands in for the sandbox container here.
    process.env.HOME = containerHome;
  });

  afterEach(() => {
    process.env.HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function createServer(getClaudeHomeDir) {
    return initServer({
      createHttpServer: fakeHttpServerFactory(),
      getClaudeHomeDir,
      autoStartWithClaude: false,
      manageClaudeHooksAutomatically: true,
      isAgentEnabled: () => true,
      shouldSyncAgentIntegration: () => true,
      sessions: new Map(),
      pendingPermissions: [],
    });
  }

  it("writes and verifies hooks in the authorized ~/.claude", async () => {
    const api = createServer(() => authorizedHome);
    const result = await api.syncClawdHooks({ source: "test", automatic: false });
    assert.equal(result && result.status, "ok", JSON.stringify(result));

    const settings = readJson(path.join(authorizedHome, ".claude", "settings.json"));
    assert.ok(settings.hooks && Object.keys(settings.hooks).length > 0);
    assert.equal(fs.existsSync(path.join(containerHome, ".claude")), false);

    const removed = await api.uninstallClaudeHooks({ source: "test" });
    assert.equal(removed.status, "ok");
    const after = readJson(path.join(authorizedHome, ".claude", "settings.json"));
    assert.equal(Object.keys(after.hooks || {}).length, 0);
    assert.equal(fs.existsSync(path.join(containerHome, ".claude")), false);
  });

  it("skips instead of writing the container when nothing is authorized", async () => {
    const api = createServer(() => null);
    const result = await api.syncClawdHooks({ source: "test", automatic: false });
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "not-authorized");
    assert.equal(fs.existsSync(path.join(containerHome, ".claude")), false);

    const autoStart = await api.setClaudeAutoStart({ enabled: true });
    assert.equal(autoStart.status, "skipped");
    const quota = await api.setClaudeQuotaCollectionEnabled({ enabled: true });
    assert.equal(quota.status, "skipped");
    assert.equal(api.startClaudeSettingsWatcher(), false);
    assert.equal(fs.existsSync(path.join(containerHome, ".claude")), false);
  });
});
