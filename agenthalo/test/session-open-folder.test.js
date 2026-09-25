"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createSessionFolderOpener } = require("../src/session-open-folder");

test("session folder opener re-resolves a local session and opens its existing cwd", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-session-folder-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const opened = [];
  const sessions = new Map([["s1", { cwd, host: null, platform: null, headless: false }]]);
  const openSessionFolder = createSessionFolderOpener({
    getSession: (id) => sessions.get(id),
    openPath: async (folder) => { opened.push(folder); return ""; },
  });

  assert.deepStrictEqual(await openSessionFolder("s1"), { status: "ok" });
  // The resolved path that was checked (macOS tmpdir lives behind /var).
  assert.deepStrictEqual(opened, [fs.realpathSync(cwd)]);
});

test("session folder opener rejects renderer-supplied paths and unsafe sessions", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-session-folder-"));
  const file = path.join(cwd, "file.txt");
  fs.writeFileSync(file, "x");
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const opened = [];
  const sessions = new Map([
    ["remote", { cwd, host: "server.example", platform: null }],
    ["webui", { cwd, host: null, platform: "webui" }],
    ["relative", { cwd: "relative/path", host: null, platform: null }],
    ["missing", { cwd: path.join(cwd, "missing"), host: null, platform: null }],
    ["file", { cwd: file, host: null, platform: null }],
  ]);
  const openSessionFolder = createSessionFolderOpener({
    getSession: (id) => sessions.get(id),
    openPath: async (folder) => { opened.push(folder); return ""; },
  });

  for (const payload of [
    { sessionId: "safe", cwd: cwd },
    "unknown",
    "remote",
    "webui",
    "relative",
    "missing",
    "file",
  ]) {
    const result = await openSessionFolder(payload);
    assert.notStrictEqual(result.status, "ok", `must reject ${JSON.stringify(payload)}`);
  }
  assert.deepStrictEqual(opened, []);
});

test("session folder opener reports shell.openPath failures", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-session-folder-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const openSessionFolder = createSessionFolderOpener({
    getSession: () => ({ cwd, host: null, platform: null }),
    openPath: async () => "No application is associated with the specified file",
  });

  const result = await openSessionFolder("s1");
  assert.strictEqual(result.status, "error");
  assert.match(result.message, /No application/);
});

test("session folder opener never hands a bundle to shell.openPath", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-session-folder-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "Calculator.app");
  const shouted = path.join(root, "Tool.APP");
  const prefPane = path.join(root, "Setting.prefPane");
  const workflow = path.join(root, "Run.workflow");
  const bareBundle = path.join(root, "no-extension");
  const project = path.join(root, "my.project");
  for (const dir of [app, shouted, prefPane, workflow, project]) fs.mkdirSync(dir);
  fs.mkdirSync(path.join(bareBundle, "Contents"), { recursive: true });
  fs.writeFileSync(path.join(bareBundle, "Contents", "Info.plist"), "<plist/>");
  const link = path.join(root, "innocent");
  fs.symlinkSync(app, link, "dir");

  const opened = [];
  const sessions = new Map([
    ["app", app],
    ["app-trailing-slash", `${app}${path.sep}`],
    ["uppercase", shouted],
    ["prefpane", prefPane],
    ["workflow", workflow],
    ["bundle-bit-layout", bareBundle],
    ["symlink-to-app", link],
    ["project", project],
  ].map(([id, cwd]) => [id, { cwd, host: null, platform: null }]));
  const openSessionFolder = createSessionFolderOpener({
    getSession: (id) => sessions.get(id),
    openPath: async (folder) => { opened.push(folder); return ""; },
  });

  for (const id of ["app", "app-trailing-slash", "uppercase", "prefpane", "workflow", "bundle-bit-layout", "symlink-to-app"]) {
    assert.deepStrictEqual(
      await openSessionFolder(id),
      { status: "not-available", reason: "bundle" },
      id
    );
  }
  assert.deepStrictEqual(opened, []);
  // A dotted project folder is still an ordinary folder.
  assert.deepStrictEqual(await openSessionFolder("project"), { status: "ok" });
  assert.deepStrictEqual(opened, [fs.realpathSync(project)]);
});
