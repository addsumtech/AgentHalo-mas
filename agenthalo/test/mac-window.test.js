"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const macWindow = require("../src/mac-window");

const ROOT = path.join(__dirname, "..");
const MAC_WINDOW = path.join(ROOT, "src", "mac-window.js");
// App Review guideline 2.5.1: public APIs only. The upstream build loaded the
// private window-server framework and called its SLS* symbols.
const PRIVATE_API_PATTERNS = [
  /PrivateFrameworks/,
  /SkyLight/,
  /\bSLS[A-Z][A-Za-z]+/,
  /\bCGS[A-Z][A-Za-z]+/,
];

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

function makeWindow() {
  const calls = [];
  return {
    calls,
    isDestroyed: () => false,
    getNativeWindowHandle: () => {
      calls.push("getNativeWindowHandle");
      return Buffer.alloc(8);
    },
  };
}

describe("macOS window tweaks in the store build", () => {
  it("keeps only public AppKit calls in mac-window.js", () => {
    const source = fs.readFileSync(MAC_WINDOW, "utf8");
    for (const pattern of PRIVATE_API_PATTERNS) {
      assert.doesNotMatch(source, pattern);
    }
    assert.match(source, /\/usr\/lib\/libobjc\.A\.dylib/);
    assert.match(source, /setCollectionBehavior:/);
  });

  it("ships no private framework names in packaged source", () => {
    for (const dir of ["src", "hooks", "agents"]) {
      for (const file of listJsFiles(path.join(ROOT, dir))) {
        const source = fs.readFileSync(file, "utf8");
        for (const pattern of PRIVATE_API_PATTERNS) {
          assert.doesNotMatch(source, pattern, `${path.relative(ROOT, file)} matches ${pattern}`);
        }
      }
    }
  });

  it("reports de-delegation as unavailable without touching the window", () => {
    const win = makeWindow();
    assert.strictEqual(macWindow.deDelegateWindowFromStationarySpace(win, 0), false);
    assert.deepStrictEqual(win.calls, []);
  });

  it("does not report a native stationary Space for missing or destroyed windows", () => {
    assert.strictEqual(macWindow.applyStationaryCollectionBehavior(null), false);
    assert.strictEqual(macWindow.applyStationaryCollectionBehavior({ isDestroyed: () => true }), false);
  });

  it("exports only the two window helpers", () => {
    assert.deepStrictEqual(Object.keys(macWindow).sort(), [
      "applyStationaryCollectionBehavior",
      "deDelegateWindowFromStationarySpace",
    ]);
  });
});
