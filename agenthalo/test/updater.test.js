"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const initUpdater = require("../src/updater");

test("AgentHalo update entry points cannot download, install, fetch git or start timers", async () => {
  const fail = () => { throw new Error("Updater side effect is forbidden"); };
  const context = {
    module: { exports: {} }, require: fail, setTimeout: fail, setInterval: fail,
    process: { env: {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/updater.js"), "utf8"), context);
  const updater = context.module.exports(new Proxy({}, { get: fail }), new Proxy({}, { get: fail }));
  for (const method of ["setupAutoUpdater", "checkForUpdates", "quietDiscover", "handlePendingVersion",
    "reconcilePendingOnStartup", "onSilentModeExit", "startUpdateScheduler", "stopUpdateScheduler"]) {
    await updater[method]("9.9.9", { intent: "download", trigger: "manual" });
  }
  assert.equal(updater.isSchedulerRunning(), false);
  assert.equal(updater.getPendingUpdateVersion(), "");
  assert.equal(updater.getUpdateMenuItem(), null);
});

test("old pending-update preferences cannot re-enable upstream installation", async () => {
  const updater = initUpdater({ getPref: () => true, pendingUpdateVersion: "9.9.9" });
  assert.deepEqual(await updater.checkForUpdates({ intent: "download" }), { state: "idle", status: "manual-only" });
  const snapshot = updater.getUpdateCheckSnapshot();
  snapshot.state = "ready";
  assert.equal(updater.getUpdateCheckSnapshot().state, "idle");
  assert.equal(updater.getUpdateMenuItem(), null);
});

test("new packages contain no upstream publishing feed", () => {
  const pkg = require("../package.json");
  assert.deepEqual(pkg.build.publish, []);
  assert.equal(pkg.build.productName, "AgentHalo");
});
