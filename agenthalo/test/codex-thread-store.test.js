"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  classifyCodexThread,
  createCodexThreadStore,
  findStateDbPath,
  isCodexMemoryMaintenanceThread,
} = require("../hooks/codex-thread-store");

function tmpCodexDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ah-codex-store-"));
}

// Rows keyed by id, mirroring the shape node:sqlite returns.
function fakeSqlite(rows, options = {}) {
  const state = { opens: 0, queries: 0, file: null };
  const sqlite = {
    DatabaseSync: class {
      constructor(file) {
        state.opens += 1;
        state.file = file;
        if (options.throwOnOpen) throw new Error("locked");
      }
      prepare() {
        return {
          get: (id) => {
            state.queries += 1;
            if (options.throwOnQuery) throw new Error("no such table: threads");
            return rows[id];
          },
        };
      }
      close() {}
    },
  };
  return { sqlite, state };
}

describe("codex thread store", () => {
  it("recognizes only unregistered tasks within the configured Codex memory directory", () => {
    const home = path.join(os.tmpdir(), "custom-codex-home");
    const absent = { available: true, found: false };
    for (const cwd of [path.join(home, "memories"), path.join(home, "memories", "extensions", "ad_hoc")]) {
      assert.strictEqual(isCodexMemoryMaintenanceThread(absent, cwd, home), true);
      assert.strictEqual(isCodexMemoryMaintenanceThread({ available: true, found: true, source: "user" }, cwd, home), false);
      assert.strictEqual(isCodexMemoryMaintenanceThread({ available: false, found: false }, cwd, home), false);
    }
    for (const cwd of ["memories", "", path.join(home, "memories-old"), path.join(home, "memories", "..", "project"), path.join(os.tmpdir(), "another-project", "memories")]) {
      assert.strictEqual(isCodexMemoryMaintenanceThread(absent, cwd, home), false, cwd);
    }
  });

  it("picks the highest state_<n>.sqlite, because Codex bumps the number on migration", () => {
    const dir = tmpCodexDir();
    for (const name of ["state_4.sqlite", "state_5.sqlite", "state_12.sqlite", "notes.sqlite"]) {
      fs.writeFileSync(path.join(dir, name), "");
    }
    assert.strictEqual(path.basename(findStateDbPath(dir)), "state_12.sqlite");
  });

  it("returns null when the directory has no state db at all", () => {
    assert.strictEqual(findStateDbPath(tmpCodexDir()), null);
  });

  it("reads a user thread's name, cwd and source", () => {
    const dir = tmpCodexDir();
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    const { sqlite } = fakeSqlite({
      "01a0a5a0-89bf-7af3-92d6-d860ff0e7c44": {
        name: "连接mac mini的方法",
        title: "连接mac mini的方法",
        cwd: "/Users/you/Projects/paper",
        thread_source: "user",
        archived: 0,
      },
    });
    const store = createCodexThreadStore({ codexDir: dir, sqlite });
    const record = store.lookup("codex:01a0a5a0-89bf-7af3-92d6-d860ff0e7c44");
    assert.strictEqual(record.available, true);
    assert.strictEqual(record.found, true);
    assert.strictEqual(record.name, "连接mac mini的方法");
    assert.strictEqual(record.source, "user");
    assert.strictEqual(classifyCodexThread(record), "visible");
  });

  // Observed 2026-09-16: an unnamed thread's `title` was a 5000-character
  // standing-order prompt. It is the first user message, not a title.
  it("never substitutes the title column for a missing name", () => {
    const dir = tmpCodexDir();
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    const { sqlite } = fakeSqlite({
      t1: {
        name: null,
        title: "# 每日英文历史视频维护\n\n这是一条很长的提示词".repeat(50),
        cwd: "/w",
        thread_source: "user",
        archived: 0,
      },
    });
    const store = createCodexThreadStore({ codexDir: dir, sqlite });
    const record = store.lookup("t1");
    assert.strictEqual(record.name, null);
    assert.strictEqual(classifyCodexThread(record), "visible");
  });

  it("classifies a subagent thread as hidden", () => {
    const dir = tmpCodexDir();
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    const { sqlite } = fakeSqlite({
      t1: { name: null, title: null, cwd: "/w", thread_source: "subagent", archived: 0 },
    });
    const store = createCodexThreadStore({ codexDir: dir, sqlite });
    assert.strictEqual(classifyCodexThread(store.lookup("t1")), "hidden");
  });

  it("classifies a session absent from the table as hidden (ChatGPT code-mode run)", () => {
    const dir = tmpCodexDir();
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    const { sqlite } = fakeSqlite({});
    const store = createCodexThreadStore({ codexDir: dir, sqlite });
    const record = store.lookup("01a0a78e-ef32-7943-a471-e032c17d6b73");
    assert.strictEqual(record.available, true);
    assert.strictEqual(record.found, false);
    assert.strictEqual(classifyCodexThread(record), "hidden");
  });

  // The safety property: a future Codex layout change must degrade to today's
  // behaviour, never empty the task list.
  it("reports unknown, not hidden, when the store cannot be opened", () => {
    const dir = tmpCodexDir();
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    const { sqlite } = fakeSqlite({}, { throwOnOpen: true });
    const store = createCodexThreadStore({ codexDir: dir, sqlite });
    assert.strictEqual(classifyCodexThread(store.lookup("t1")), "unknown");
  });

  it("reports unknown when there is no state db", () => {
    const store = createCodexThreadStore({ codexDir: tmpCodexDir(), sqlite: fakeSqlite({}).sqlite });
    assert.strictEqual(classifyCodexThread(store.lookup("t1")), "unknown");
  });

  it("reports unknown when node:sqlite is unavailable", () => {
    const dir = tmpCodexDir();
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    const store = createCodexThreadStore({ codexDir: dir, sqlite: null });
    assert.strictEqual(classifyCodexThread(store.lookup("t1")), "unknown");
  });

  it("reports unknown and drops the handle when a query throws on a changed schema", () => {
    const dir = tmpCodexDir();
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    const { sqlite, state } = fakeSqlite({}, { throwOnQuery: true });
    const store = createCodexThreadStore({ codexDir: dir, sqlite });
    assert.strictEqual(classifyCodexThread(store.lookup("t1")), "unknown");
    store.lookup("t1");
    assert.strictEqual(state.opens, 2, "a failed query must reopen rather than reuse a dead handle");
  });

  it("serves repeat lookups from cache within the TTL, then re-reads", () => {
    const dir = tmpCodexDir();
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    const { sqlite, state } = fakeSqlite({
      t1: { name: "n", title: null, cwd: "/w", thread_source: "user", archived: 0 },
    });
    let clock = 1000;
    const store = createCodexThreadStore({
      codexDir: dir,
      sqlite,
      now: () => clock,
      ttlMs: 50,
    });
    store.lookup("t1");
    store.lookup("t1");
    assert.strictEqual(state.queries, 1);
    clock += 100;
    store.lookup("t1");
    assert.strictEqual(state.queries, 2);
  });

  it("accepts a bare id or a codex:-prefixed one", () => {
    const dir = tmpCodexDir();
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    const { sqlite } = fakeSqlite({
      t1: { name: "n", title: null, cwd: "/w", thread_source: "user", archived: 0 },
    });
    const store = createCodexThreadStore({ codexDir: dir, sqlite });
    assert.strictEqual(store.lookup("t1").name, "n");
    assert.strictEqual(store.lookup("codex:t1").name, "n");
  });

  it("treats an empty or non-string id as unanswerable", () => {
    const store = createCodexThreadStore({ codexDir: tmpCodexDir(), sqlite: fakeSqlite({}).sqlite });
    for (const bad of ["", "   ", null, undefined, 42]) {
      assert.strictEqual(store.lookup(bad).available, false);
    }
  });
});
