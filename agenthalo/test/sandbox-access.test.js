"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sandboxAccess = require("../src/sandbox-access");

describe("sandbox-access", () => {
  let userDataDir;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-mas-auth-"));
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it("treats a selected .claude folder as that tool's home parent", () => {
    const selected = path.join(userDataDir, "home", ".claude");
    fs.mkdirSync(selected, { recursive: true });
    const homeDir = sandboxAccess.resolveHomeDir("claude-code", selected);
    assert.strictEqual(homeDir, path.join(userDataDir, "home"));
  });

  it("persists and reads an authorized directory", () => {
    const selected = path.join(userDataDir, "home", ".codex");
    fs.mkdirSync(selected, { recursive: true });
    const saved = sandboxAccess.saveAuthorized("codex", selected, "bookmark-1", { userDataDir });
    assert.strictEqual(saved.homeDir, path.join(userDataDir, "home"));
    const loaded = sandboxAccess.getAuthorized("codex", { userDataDir });
    assert.strictEqual(loaded.path, path.resolve(selected));
    assert.strictEqual(loaded.bookmark, "bookmark-1");
    const listed = sandboxAccess.listAuthorized({ userDataDir });
    assert.strictEqual(listed.codex.path, path.resolve(selected));
  });

  it("skips automatic sync when no folder has been authorized", () => {
    const gate = sandboxAccess.requireAuthorized("cursor-agent", {
      userDataDir,
      automatic: true,
    });
    assert.strictEqual(gate.status, "skipped");
    assert.strictEqual(gate.reason, "not-authorized");
  });

  it("returns an error for explicit install when no folder has been authorized", () => {
    const gate = sandboxAccess.requireAuthorized("cursor-agent", {
      userDataDir,
      automatic: false,
    });
    assert.strictEqual(gate.status, "error");
  });

  it("cancelling the picker does not write a bookmark", async () => {
    const result = await sandboxAccess.authorize("claude-code", {
      userDataDir,
      force: true,
      electron: {
        dialog: {
          showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        },
      },
    });
    assert.strictEqual(result.status, "error");
    assert.strictEqual(sandboxAccess.getAuthorized("claude-code", { userDataDir }), null);
  });
});
