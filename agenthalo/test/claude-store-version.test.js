"use strict";

// Store build: PreCompact, PostCompact and StopFailure are only managed once
// the Claude Code version is known. The sandbox cannot run `claude --version`,
// so the version comes from the transcripts Claude Code writes into the
// authorized folder (<claude home>/projects/<project>/<session>.jsonl, every
// line stamped with "version").

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const install = require("../hooks/install");
const { createClaudeSettingsWatcher } = require("../src/claude-settings-watcher");

const {
  getClaudeVersionAsync,
  getStoreClaudeVersion,
  getClaudeVersionFromTranscriptsAsync,
  parseTranscriptTailVersion,
} = install.__test;

const VERSIONED_EVENTS = ["PreCompact", "PostCompact", "StopFailure"];

function line(fields) {
  return JSON.stringify({ type: "assistant", uuid: "u", sessionId: "s", ...fields });
}

describe("Claude Code version from transcripts (store build)", () => {
  let home;
  let claudeHome;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-store-version-"));
    claudeHome = path.join(home, ".claude");
    fs.mkdirSync(claudeHome, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  function writeTranscript(project, name, lines, mtimeSeconds) {
    const dir = path.join(claudeHome, "projects", project);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
    if (mtimeSeconds) fs.utimesSync(file, mtimeSeconds, mtimeSeconds);
    return file;
  }

  const storeOptions = () => ({ storeHooks: true, claudeHome, resetCache: true });

  it("reads the version from the newest transcript's last stamped line", async () => {
    writeTranscript("-Users-me-old", "a.jsonl", [line({ version: "2.1.50" })], 1_000);
    const newest = writeTranscript("-Users-me-new", "b.jsonl", [
      line({ version: "2.1.282" }),
      line({ version: "2.1.283" }),
      JSON.stringify({ type: "summary", summary: "no version on this one" }),
    ], 2_000);
    const expected = { version: "2.1.283", source: `transcript:${newest}`, status: "known" };
    assert.deepEqual(getStoreClaudeVersion({ claudeHome }), expected);
    assert.deepEqual(await getClaudeVersionFromTranscriptsAsync({ claudeHome }), expected);
  });

  it("takes only the top-level field, never a version quoted inside a message", () => {
    const text = [
      line({ version: "2.1.90" }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "{\"version\":\"9.9.9\"}" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", input: { version: "8.8.8" } }] } }),
    ].join("\n");
    assert.equal(parseTranscriptTailVersion(text, false), "2.1.90");
    // A tail read that starts mid-file skips its first, partial line.
    assert.equal(parseTranscriptTailVersion(`${line({ version: "7.7.7" })}\n`, true), null);
  });

  it("reads a bounded tail of a large transcript", async () => {
    const filler = line({ version: "2.0.1", message: { content: "x".repeat(400 * 1024) } });
    writeTranscript("-p", "big.jsonl", [line({ version: "1.0.0" }), filler, line({ version: "2.1.284" })]);
    const opened = [];
    const fsPromises = {
      ...fs.promises,
      open: async (file, flags) => {
        const handle = await fs.promises.open(file, flags);
        return {
          read: async (buffer, offset, length, position) => {
            opened.push({ length, position });
            return handle.read(buffer, offset, length, position);
          },
          close: () => handle.close(),
        };
      },
    };
    const info = await getClaudeVersionFromTranscriptsAsync({ claudeHome, fsPromises });
    assert.equal(info.version, "2.1.284");
    assert.equal(opened.length, 1);
    assert.ok(opened[0].length <= 256 * 1024);
    assert.ok(opened[0].position > 0);
  });

  it("never runs claude in the store build, and asks again while the version is unknown", async () => {
    const execFile = () => { throw new Error("the sandbox cannot run claude"); };
    const unknown = await getClaudeVersionAsync({ ...storeOptions(), execFile });
    assert.equal(unknown.status, "unknown");
    writeTranscript("-p", "s.jsonl", [line({ version: "2.1.283" })]);
    const known = await getClaudeVersionAsync({ storeHooks: true, claudeHome, execFile });
    assert.equal(known.status, "known");
    assert.equal(known.version, "2.1.283");
    assert.deepEqual(await install.getSupportedClaudeVersionedEventsAsync({ storeHooks: true, claudeHome }), VERSIONED_EVENTS);
    // Leave the module cache clean for other suites.
    await getClaudeVersionAsync({ storeHooks: true, claudeHome: path.join(home, "none"), resetCache: true });
  });

  it("keeps the unsandboxed build on `claude --version`", async () => {
    writeTranscript("-p", "s.jsonl", [line({ version: "2.1.283" })]);
    const info = await getClaudeVersionAsync({
      storeHooks: false,
      resetCache: true,
      candidates: ["/fake/claude"],
      execFile: async () => ({ stdout: "2.1.100 (Claude Code)\n" }),
      access: async () => { throw new Error("no package.json"); },
    });
    assert.equal(info.version, "2.1.100");
    assert.equal(info.source, "/fake/claude");
    await getClaudeVersionAsync({ storeHooks: true, claudeHome: path.join(home, "none"), resetCache: true });
  });

  it("installs the versioned hooks at connect time once a transcript exists", async () => {
    writeTranscript("-p", "s.jsonl", [line({ version: "2.1.283" })]);
    await getClaudeVersionAsync({ ...storeOptions() });
    const settingsPath = path.join(claudeHome, "settings.json");
    fs.writeFileSync(settingsPath, "{}");
    const result = await install.registerHooksAsync({ settingsPath, storeHooks: true, claudeHome, port: 23334, silent: true });
    assert.equal(result.versionStatus, "known");
    const hooks = JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks;
    for (const event of VERSIONED_EVENTS) {
      assert.ok(JSON.stringify(hooks[event]).includes("agenthalo-store-hook.js"), event);
    }
    await getClaudeVersionAsync({ storeHooks: true, claudeHome: path.join(home, "none"), resetCache: true });
  });

  it("adds the versioned hooks on a later health check when the version was unknown at connect", async () => {
    await getClaudeVersionAsync({ ...storeOptions() });
    const settingsPath = path.join(claudeHome, "settings.json");
    fs.writeFileSync(settingsPath, "{}");
    const sync = () => install.registerHooksAsync({ settingsPath, storeHooks: true, claudeHome, port: 23334, silent: true });
    const first = await sync();
    assert.equal(first.versionStatus, "unknown");
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks.PreCompact, undefined);

    const syncs = [];
    const watcher = createClaudeSettingsWatcher({
      storeHooks: true,
      claudeSettingsPath: settingsPath,
      claudeSettingsDir: claudeHome,
      getHookServerPort: () => 23334,
      getVersionedHookEvents: () => install.getSupportedClaudeVersionedEventsAsync({ storeHooks: true, claudeHome }),
      syncClawdHooks: async (options) => {
        syncs.push(options.source);
        return sync();
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {},
    });

    await watcher.checkNow("periodic-health");
    assert.deepEqual(syncs, [], "nothing to add while the version is unknown");
    assert.equal(watcher.getHealthStatus().status, "healthy");

    // Claude Code runs and writes its first transcript.
    writeTranscript("-p", "s.jsonl", [line({ version: "2.1.283" })]);
    await watcher.checkNow("periodic-health");
    assert.deepEqual(syncs, ["periodic-health"]);
    assert.equal(watcher.getHealthStatus().status, "healthy");
    const hooks = JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks;
    for (const event of VERSIONED_EVENTS) {
      assert.ok(JSON.stringify(hooks[event]).includes("agenthalo-store-hook.js"), event);
    }
    await watcher.checkNow("periodic-health");
    assert.deepEqual(syncs, ["periodic-health"], "settled");
    await getClaudeVersionAsync({ storeHooks: true, claudeHome: path.join(home, "none"), resetCache: true });
  });

  it("is wired into the store build's settings watcher", () => {
    const serverSource = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
    assert.match(serverSource, /getVersionedHookEvents:[\s\S]{0,300}isStoreClaudeInstall\(\)[\s\S]{0,200}getSupportedClaudeVersionedEventsAsync\(home\)/);
  });
});
