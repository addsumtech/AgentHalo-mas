"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createSettingsController } = require("../src/settings-controller");
const { updateRegistry, commandRegistry } = require("../src/settings-actions");
const { localActionRegistry, localDiagnosticsSnapshot } = require("../src/local-product-policy");
const prefs = require("../src/prefs");

test("old remote profiles cannot enable services through product settings", async () => {
  const snapshot = prefs.getDefaults();
  snapshot.slackNotify = { ...snapshot.slackNotify, enabled: true };
  let sent = false;
  const controller = createSettingsController({ loadResult: { snapshot, locked: false },
    prefs: { save() {} }, updates: localActionRegistry(updateRegistry), commands: localActionRegistry(commandRegistry),
    injectedDeps: { sendSlackNotifyTest: () => { sent = true; } } });
  for (const key of ["slackNotify", "tgApproval", "discordPresence", "feishuApproval", "remoteSsh", "mobilePreviewEnabled"]) {
    assert.equal((await controller.applyUpdate(key, true)).status, "error", key);
  }
  for (const action of ["slackNotify.sendTest", "remoteSsh.add", "feishuApproval.saveManualApprover", "tgApproval.sendTest"]) {
    assert.equal((await controller.applyCommand(action, {})).status, "error", action);
  }
  assert.equal(sent, false);
  assert.equal(localDiagnosticsSnapshot(controller.getSnapshot()).slackNotify.enabled, false);
  assert.equal(controller.get("slackNotify").enabled, true, "retired saved preferences are preserved");
});

test("desktop composition contains no remote clients, tunnels or LAN listener startup", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  for (const factory of ["createSlackNotifyClient(", "createDiscordPresenceBridge(", "new FeishuApprovalClient(", "createTelegramMigrationController(", "createRemoteSshRuntime(", "registerRemoteSshIpc(", "initMobilePreviewServer("]) {
    assert.equal(main.includes(factory), false, factory);
  }
  const callback = main.slice(main.indexOf("onPermissionRequired:"), main.indexOf("// ── HTTP server"));
  assert.equal(callback.includes("isTrustedAccessibilityClient(true)"), false);
});
