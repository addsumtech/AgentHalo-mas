"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { minimatch } = require("minimatch");

const repoRoot = path.resolve(__dirname, "..");

test("terminal-focus extension activates on startup and focuses terminal input", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, "extensions", "vscode", "package.json"),
    "utf8"
  ));
  const source = fs.readFileSync(
    path.join(repoRoot, "extensions", "vscode", "extension.js"),
    "utf8"
  );

  assert.equal(manifest.version, "0.1.2");
  assert.ok(manifest.activationEvents.includes("onStartupFinished"));
  assert.ok(manifest.activationEvents.includes("onUri"));
  assert.match(source, /terminal\.show\(false\)/);
  assert.doesNotMatch(source, /terminal\.show\(true\)/);
});

// App Review guidelines 2.4.5(ii) and 2.5.2: the store app must not install
// code into other apps, so it neither copies the extension into VS Code or
// Cursor nor ships the extension files.
test("the store app never installs the extension into other editors", () => {
  const main = fs.readFileSync(path.join(repoRoot, "src", "main.js"), "utf8");
  assert.doesNotMatch(main, /installTerminalFocusExtension/);
  assert.doesNotMatch(main, /EXT_VERSION/);
  assert.doesNotMatch(main, /["']\.vscode["'], ["']extensions["']/);
  assert.doesNotMatch(main, /["']\.cursor["'], ["']extensions["']/);
});

test("the extension is not packaged", () => {
  const { build } = require("../package.json");
  for (const file of ["extensions/vscode/package.json", "extensions/vscode/extension.js"]) {
    assert.ok(!build.files.some((glob) => minimatch(file, glob)), `${file} must not be packaged`);
    assert.ok(!build.asarUnpack.some((glob) => minimatch(file, glob)), `${file} must not be unpacked`);
  }
});
