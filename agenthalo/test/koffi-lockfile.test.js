"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const pkg = require("../package.json");
const lock = require("../package-lock.json");

const EXPECTED_VERSION = "2.16.3";
const EXPECTED_INTEGRITY = "sha512-E9y1AsgYGlaxMhcZzHr8y96QF2U5XzA12GGVAfbWqIubTwPNMXQarfBzePNXHe0xtIEtNd6ifAv3GAKYGUeBAQ==";

test("Koffi native code is pinned exactly in package and lock metadata", () => {
  assert.equal(pkg.dependencies.koffi, EXPECTED_VERSION);
  assert.equal(lock.packages[""].dependencies.koffi, EXPECTED_VERSION);
  const entry = lock.packages["node_modules/koffi"];
  assert.equal(entry.version, EXPECTED_VERSION);
  assert.equal(entry.integrity, EXPECTED_INTEGRITY);
  assert.equal(entry.hasInstallScript, true);
  assert.match(entry.resolved, /^https:\/\/(?:registry\.npmjs\.org|registry\.npmmirror\.com)\/koffi\//);
});

test("the Mac App Store package leaves Koffi out instead of pruning it", () => {
  // The universal MAS build merges separate x64 and arm64 apps, so per-arch
  // pruning (and the afterPack call for the merged universal app) cannot
  // succeed there. On macOS Koffi only drives mac-window.js, whose calls sit
  // in try/catch, and that includes the private SkyLight API App Review
  // does not allow.
  assert.equal(pkg.build.afterPack, undefined);
  assert.ok(pkg.build.mas.files.includes("!**/node_modules/koffi{,/**/*}"));
  assert.equal(pkg.scripts["audit:native-package"], "node scripts/audit-packaged-native.js");
  assert.equal(pkg.scripts["verify:updater-metadata"], "node scripts/verify-updater-metadata.js");
});
