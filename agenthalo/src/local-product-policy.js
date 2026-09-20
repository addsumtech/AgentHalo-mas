"use strict";

// Retired remote features stay readable in old profiles, but cannot be
// activated by a settings mutation in the desktop companion product.
const RETIRED = /^(?:remoteSsh|tgApproval|tgMigration|telegram|discordPresence|feishuApproval|slackNotify|mobilePreview)/i;
function isRetiredSetting(name) { return typeof name === "string" && RETIRED.test(name); }
function localActionRegistry(registry) {
  return Object.fromEntries(Object.entries(registry).filter(([name]) => !isRetiredSetting(name)));
}
function localDiagnosticsSnapshot(snapshot) {
  return { ...snapshot, tgApproval: { enabled: false }, tgMigration: { transport: "off" },
    feishuApproval: { enabled: false }, slackNotify: { enabled: false },
    discordPresence: { enabled: false }, remoteSsh: { profiles: [] }, mobilePreviewEnabled: false };
}
module.exports = { isRetiredSetting, localActionRegistry, localDiagnosticsSnapshot };
