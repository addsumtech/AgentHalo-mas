"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migrateUserData } = require("../src/user-data-migration");

test("profile migration preserves preferences, private files and a real themes directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, "clawd-on-desk");
  fs.mkdirSync(path.join(legacy, "themes", "custom"), { recursive: true });
  const bytes = Buffer.from('{"unknownSetting":"keep","theme":"pikachu"}\n');
  fs.writeFileSync(path.join(legacy, "clawd-prefs.json"), bytes);
  fs.writeFileSync(path.join(legacy, "private.env"), "private-test-value");
  fs.writeFileSync(path.join(legacy, "themes", "custom", "voice.mp3"), "voice-test-bytes");
  const result = migrateUserData(root);
  assert.deepEqual(fs.readFileSync(result.prefsPath), bytes);
  assert.equal(fs.readFileSync(path.join(result.userData, "private.env"), "utf8"), "private-test-value");
  assert.equal(fs.readFileSync(path.join(result.userData, "themes", "custom", "voice.mp3"), "utf8"), "voice-test-bytes");
  assert.equal(fs.lstatSync(path.join(result.userData, "themes")).isSymbolicLink(), false);
  assert.equal(fs.existsSync(legacy), false);
  assert.deepEqual(migrateUserData(root), result);
});

test("existing AgentHalo preferences win without changing the old profile", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ["AgentHalo", "clawd-on-desk"]) fs.mkdirSync(path.join(root, dir));
  fs.writeFileSync(path.join(root, "AgentHalo", "agenthalo-prefs.json"), "canonical");
  fs.writeFileSync(path.join(root, "clawd-on-desk", "clawd-prefs.json"), "legacy");
  const result = migrateUserData(root);
  assert.equal(fs.readFileSync(result.prefsPath, "utf8"), "canonical");
  assert.equal(fs.readFileSync(path.join(root, "clawd-on-desk", "clawd-prefs.json"), "utf8"), "legacy");
});
