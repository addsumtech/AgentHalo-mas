"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migrateUserData } = require("../src/user-data-migration");

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function snapshotTree(dir) {
  const out = {};
  (function visit(current, rel) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(full, key);
      else if (entry.isSymbolicLink()) out[key] = `-> ${fs.readlinkSync(full)}`;
      else out[key] = fs.readFileSync(full, "utf8");
    }
  })(dir, "");
  return out;
}

test("profile migration copies preferences, private files and a real themes directory", (t) => {
  const root = makeRoot(t);
  const legacy = path.join(root, "clawd-on-desk");
  fs.mkdirSync(path.join(legacy, "themes", "custom"), { recursive: true });
  const bytes = Buffer.from('{"unknownSetting":"keep","theme":"pikachu"}\n');
  fs.writeFileSync(path.join(legacy, "clawd-prefs.json"), bytes);
  fs.writeFileSync(path.join(legacy, "private.env"), "private-test-value");
  fs.writeFileSync(path.join(legacy, "themes", "custom", "voice.mp3"), "voice-test-bytes");
  const before = snapshotTree(legacy);

  const result = migrateUserData(root);

  assert.deepEqual(fs.readFileSync(result.prefsPath), bytes);
  assert.equal(fs.readFileSync(path.join(result.userData, "private.env"), "utf8"), "private-test-value");
  assert.equal(fs.readFileSync(path.join(result.userData, "themes", "custom", "voice.mp3"), "utf8"), "voice-test-bytes");
  assert.equal(fs.lstatSync(path.join(result.userData, "themes")).isSymbolicLink(), false);
  assert.deepEqual(migrateUserData(root), result);
  assert.deepEqual(snapshotTree(legacy), before, "the legacy profile is copied, not moved");
  assert.deepEqual(fs.readdirSync(root).sort(), ["AgentHalo", "clawd-on-desk"], "no staging directory is left behind");
});

test("an installed Clawd on Desk keeps its own profile untouched", (t) => {
  const root = makeRoot(t);
  const legacy = path.join(root, "clawd-on-desk");
  fs.mkdirSync(path.join(legacy, "themes", "custom"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "clawd-prefs.json"), '{"theme":"calico"}\n');
  fs.writeFileSync(path.join(legacy, "themes", "custom", "theme.json"), "{}");
  const before = snapshotTree(legacy);

  const result = migrateUserData(root);

  assert.deepEqual(snapshotTree(legacy), before, "clawd-prefs.json must stay where Clawd on Desk reads it");
  // Later AgentHalo changes stay in AgentHalo's copy.
  fs.writeFileSync(result.prefsPath, '{"theme":"cloudling"}\n');
  fs.writeFileSync(path.join(result.userData, "themes", "custom", "theme.json"), '{"edited":true}');
  assert.deepEqual(snapshotTree(legacy), before);
});

test("the running Clawd on Desk's Chromium process locks are not copied", { skip: process.platform === "win32" }, (t) => {
  const root = makeRoot(t);
  const legacy = path.join(root, "clawd-on-desk");
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, "clawd-prefs.json"), "{}");
  fs.symlinkSync("other-host-4242", path.join(legacy, "SingletonLock"));
  fs.symlinkSync("/tmp/clawd-socket", path.join(legacy, "SingletonSocket"));
  fs.symlinkSync("12345", path.join(legacy, "SingletonCookie"));
  fs.symlinkSync("themes-target", path.join(legacy, "user-link"));

  const result = migrateUserData(root);

  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    assert.equal(fs.existsSync(path.join(result.userData, name)), false, name);
    assert.equal(fs.lstatSync(path.join(legacy, name)).isSymbolicLink(), true, `${name} stays with Clawd on Desk`);
  }
  assert.equal(fs.readlinkSync(path.join(result.userData, "user-link")), "themes-target");
});

test("a failed copy stops startup and leaves both profiles as they were", (t) => {
  const root = makeRoot(t);
  const legacy = path.join(root, "clawd-on-desk");
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, "clawd-prefs.json"), '{"theme":"calico"}\n');
  const before = snapshotTree(legacy);
  const failingFs = {
    ...fs,
    cpSync(source, destination, options) {
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, "partial"), "half");
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    },
  };

  assert.throws(() => migrateUserData(root, { fs: failingFs }), /no space left/);
  assert.equal(fs.existsSync(path.join(root, "AgentHalo")), false, "no half-copied profile may look migrated");
  assert.deepEqual(fs.readdirSync(root), ["clawd-on-desk"], "the staging copy is removed");
  assert.deepEqual(snapshotTree(legacy), before);

  // The next launch retries from the untouched legacy profile.
  const result = migrateUserData(root);
  assert.equal(fs.readFileSync(result.prefsPath, "utf8"), '{"theme":"calico"}\n');
});

test("a staging copy abandoned by a killed launch is discarded", (t) => {
  const root = makeRoot(t);
  fs.mkdirSync(path.join(root, "clawd-on-desk"));
  fs.writeFileSync(path.join(root, "clawd-on-desk", "clawd-prefs.json"), "{}");
  // PID 0 never names a live user process.
  const abandoned = path.join(root, ".AgentHalo-migrating-0");
  fs.mkdirSync(abandoned);
  fs.writeFileSync(path.join(abandoned, "partial"), "half");

  migrateUserData(root);

  assert.equal(fs.existsSync(abandoned), false);
  assert.equal(fs.existsSync(path.join(root, "AgentHalo", "agenthalo-prefs.json")), true);
});

test("existing AgentHalo preferences win without changing the old profile", (t) => {
  const root = makeRoot(t);
  for (const dir of ["AgentHalo", "clawd-on-desk"]) fs.mkdirSync(path.join(root, dir));
  fs.writeFileSync(path.join(root, "AgentHalo", "agenthalo-prefs.json"), "canonical");
  fs.writeFileSync(path.join(root, "clawd-on-desk", "clawd-prefs.json"), "legacy");
  const result = migrateUserData(root);
  assert.equal(fs.readFileSync(result.prefsPath, "utf8"), "canonical");
  assert.equal(fs.readFileSync(path.join(root, "clawd-on-desk", "clawd-prefs.json"), "utf8"), "legacy");
});
