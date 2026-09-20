"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Move the complete profile before Electron opens it. Never merge or overwrite
// a destination profile; a failed move must stop startup rather than reset it.
function migrateUserData(appData) {
  const userData = path.join(appData, "AgentHalo");
  const legacy = path.join(appData, "clawd-on-desk");
  if (!fs.existsSync(userData) && fs.existsSync(legacy)) {
    fs.renameSync(legacy, userData);
  }
  fs.mkdirSync(userData, { recursive: true });
  const prefsPath = path.join(userData, "agenthalo-prefs.json");
  const legacyPrefs = path.join(userData, "clawd-prefs.json");
  if (!fs.existsSync(prefsPath) && fs.existsSync(legacyPrefs)) {
    fs.renameSync(legacyPrefs, prefsPath);
  }
  return { userData, prefsPath };
}

module.exports = { migrateUserData };
