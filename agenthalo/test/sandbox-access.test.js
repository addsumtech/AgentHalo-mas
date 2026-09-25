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

  function fakeScopedElectron() {
    const calls = [];
    return {
      calls,
      electron: {
        app: {
          // Electron's MAS API returns the stop function; there is no
          // app.stopAccessingSecurityScopedResource.
          startAccessingSecurityScopedResource(bookmark) {
            calls.push(`start:${bookmark}`);
            return () => calls.push(`stop:${bookmark}`);
          },
        },
      },
    };
  }

  it("stops security-scoped access with the function Electron returns", () => {
    const { calls, electron } = fakeScopedElectron();
    const record = { agentId: "codex", bookmark: "bm", homeDir: "/Users/me" };
    const value = sandboxAccess.withAccess(record, () => {
      calls.push("write");
      return "done";
    }, { electron });
    assert.strictEqual(value, "done");
    assert.deepStrictEqual(calls, ["start:bm", "write", "stop:bm"]);
  });

  it("keeps access open until an async sync settles", async () => {
    const { calls, electron } = fakeScopedElectron();
    const record = { agentId: "claude-code", bookmark: "bm", homeDir: "/Users/me" };
    let finishWrite;
    const pending = sandboxAccess.withAccess(record, () => new Promise((resolve) => {
      finishWrite = () => {
        calls.push("write");
        resolve({ status: "ok" });
      };
    }), { electron });
    assert.deepStrictEqual(calls, ["start:bm"]);
    finishWrite();
    assert.deepStrictEqual(await pending, { status: "ok" });
    assert.deepStrictEqual(calls, ["start:bm", "write", "stop:bm"]);
  });

  it("stops access when the sync throws", () => {
    const { calls, electron } = fakeScopedElectron();
    const record = { agentId: "codex", bookmark: "bm", homeDir: "/Users/me" };
    assert.throws(() => sandboxAccess.withAccess(record, () => {
      throw new Error("boom");
    }, { electron }), /boom/);
    assert.deepStrictEqual(calls, ["start:bm", "stop:bm"]);
  });

  it("opens the picker next to the real home folder with hidden folders visible", async () => {
    let seen = null;
    const parent = { isDestroyed: () => false };
    const result = await sandboxAccess.authorize("claude-code", {
      userDataDir,
      force: true,
      parentWindow: parent,
      os: {
        userInfo: () => ({ homedir: "/Users/me" }),
        homedir: () => "/Users/me/Library/Containers/com.addsum.agenthalo/Data",
      },
      electron: {
        dialog: {
          showOpenDialog: async (win, options) => {
            seen = { win, options };
            return { canceled: false, filePaths: [path.join(userDataDir, ".claude")], bookmarks: ["bm"] };
          },
        },
      },
    });
    assert.strictEqual(seen.win, parent);
    assert.strictEqual(seen.options.defaultPath, path.join("/Users/me", ".claude"));
    assert.ok(seen.options.properties.includes("showHiddenFiles"));
    assert.strictEqual(seen.options.securityScopedBookmarks, true);
    assert.strictEqual(result.status, "ok");
    assert.strictEqual(result.homeDir, userDataDir);
    assert.strictEqual(result.bookmark, "bm");
  });

  function pickerReturning(selected) {
    return {
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [selected], bookmarks: ["bm"] }),
      },
    };
  }

  it("rejects a folder that is not the tool's config folder and saves nothing", async () => {
    const unrelated = path.join(userDataDir, "Documents");
    fs.mkdirSync(unrelated, { recursive: true });
    const result = await sandboxAccess.authorize("claude-code", {
      userDataDir,
      force: true,
      electron: pickerReturning(unrelated),
    });
    assert.strictEqual(result.status, "error");
    assert.strictEqual(result.reason, "wrong-folder");
    assert.match(result.message, /~\/\.claude/);
    assert.strictEqual(sandboxAccess.getAuthorized("claude-code", { userDataDir }), null);
  });

  it("accepts the home folder when it contains the tool folder", async () => {
    const home = path.join(userDataDir, "home");
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    const result = await sandboxAccess.authorize("codex", {
      userDataDir,
      force: true,
      electron: pickerReturning(home),
    });
    assert.strictEqual(result.status, "ok");
    assert.strictEqual(result.homeDir, home);
  });

  it("maps nested and differently cased tool folders back to their home", () => {
    const home = path.join(userDataDir, "home");
    assert.strictEqual(
      sandboxAccess.resolveHomeDir("opencode", path.join(home, ".config", "opencode")),
      home
    );
    assert.strictEqual(
      sandboxAccess.resolveHomeDir("qwenwork", path.join(home, ".qwenworkcn")),
      home
    );
    assert.strictEqual(sandboxAccess.resolveHomeDir("kiro-cli", path.join(home, ".kiro")), home);
    assert.strictEqual(sandboxAccess.resolveHomeDir("workbuddy", path.join(home, ".workbuddy-ai")), home);
    assert.strictEqual(
      sandboxAccess.isConfigFolderSelection("opencode", path.join(home, ".opencode")),
      false
    );
  });

  it("still accepts the legacy WorkBuddy folder", () => {
    const home = path.join(userDataDir, "home");
    fs.mkdirSync(path.join(home, ".workbuddy"), { recursive: true });
    assert.strictEqual(sandboxAccess.resolveHomeDir("workbuddy", path.join(home, ".workbuddy")), home);
    assert.strictEqual(sandboxAccess.isConfigFolderSelection("workbuddy", path.join(home, ".workbuddy")), true);
    assert.strictEqual(sandboxAccess.isConfigFolderSelection("workbuddy", home), true);
  });

  it("uses the installed translator and falls back to English", () => {
    try {
      assert.match(sandboxAccess.unauthorizedMessage("codex"), /^~\/\.codex is not authorized yet/);
      sandboxAccess.setTranslator((key) => (key === "sandboxFolderNotAuthorized" ? "尚未授权 {folder}" : key));
      assert.strictEqual(sandboxAccess.unauthorizedMessage("codex"), "尚未授权 ~/.codex");
    } finally {
      sandboxAccess.setTranslator(null);
    }
  });
});

describe("sandbox-access lifetime scopes and tool environment", () => {
  let userDataDir;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-mas-scope-"));
  });

  afterEach(() => {
    sandboxAccess.releaseAllAccess();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  function scopedElectron(calls, { fail = false } = {}) {
    return {
      app: {
        startAccessingSecurityScopedResource(bookmark) {
          if (fail) throw new Error("bookmarkDataIsStale - try recreating the bookmark");
          calls.push(`start:${bookmark}`);
          return () => calls.push(`stop:${bookmark}`);
        },
      },
    };
  }

  it("holds each authorized folder open once until released", () => {
    const home = path.join(userDataDir, "home");
    sandboxAccess.saveAuthorized("claude-code", path.join(home, ".claude"), "bm-claude", { userDataDir });
    sandboxAccess.saveAuthorized("codex", path.join(home, ".codex"), "bm-codex", { userDataDir });
    const calls = [];
    const electron = scopedElectron(calls);
    assert.equal(sandboxAccess.retainAllAuthorized({ userDataDir, electron }), 2);
    assert.equal(sandboxAccess.retainAllAuthorized({ userDataDir, electron }), 2);
    assert.deepEqual(calls.sort(), ["start:bm-claude", "start:bm-codex"]);
    sandboxAccess.releaseAllAccess();
    assert.deepEqual(calls.filter((c) => c.startsWith("stop:")).sort(), ["stop:bm-claude", "stop:bm-codex"]);
  });

  it("marks a bookmark that no longer resolves as stale and not authorized", () => {
    const home = path.join(userDataDir, "home");
    sandboxAccess.saveAuthorized("codex", path.join(home, ".codex"), "bm-old", { userDataDir });
    assert.equal(sandboxAccess.retainAllAuthorized({ userDataDir, electron: scopedElectron([], { fail: true }) }), 0);
    assert.equal(sandboxAccess.getAuthorized("codex", { userDataDir }).stale, true);
    assert.equal(sandboxAccess.authorizedHomeDir("codex", { userDataDir }), null);
    assert.equal(sandboxAccess.requireAuthorized("codex", { userDataDir }).reason, "stale-authorization");
    assert.equal(sandboxAccess.listAuthorized({ userDataDir }).codex.stale, true);
    sandboxAccess.retainAllAuthorized({ userDataDir, electron: scopedElectron([]) });
    assert.equal(sandboxAccess.authorizedHomeDir("codex", { userDataDir }), home);
  });

  it("points CLAUDE_CONFIG_DIR and CODEX_HOME at authorized folders and undoes only its own values", () => {
    const home = path.join(userDataDir, "home");
    const env = { CODEX_HOME: "/custom/codex" };
    sandboxAccess.saveAuthorized("claude-code", path.join(home, ".claude"), "bm", { userDataDir });
    sandboxAccess.applyToolEnvironment(env, { userDataDir });
    assert.equal(env.CLAUDE_CONFIG_DIR, path.join(home, ".claude"));
    assert.equal(env.CODEX_HOME, "/custom/codex");
    sandboxAccess.forgetAuthorized("claude-code", { userDataDir });
    sandboxAccess.applyToolEnvironment(env, { userDataDir });
    assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
    assert.equal(env.CODEX_HOME, "/custom/codex");
  });
});
