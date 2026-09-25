"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Chromium's per-profile process locks. They name the process that owns the
// SOURCE profile (a still-running Clawd on Desk); copied across, they would
// make AgentHalo's single-instance check believe that process owns our
// profile too. Chromium recreates them on launch.
const PROFILE_LOCK_NAMES = new Set(["SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"]);
const STAGING_PREFIX = ".AgentHalo-migrating-";

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !!err && err.code === "EPERM";
  }
}

// A staging directory is left behind only when a copy was killed mid-way.
// Remove those whose owner is gone; never touch one a concurrent first launch
// is still filling.
function removeAbandonedStaging(appData, fsImpl) {
  let names;
  try {
    names = fsImpl.readdirSync(appData);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(STAGING_PREFIX)) continue;
    const pid = Number(name.slice(STAGING_PREFIX.length));
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isProcessAlive(pid)) continue;
    try { fsImpl.rmSync(path.join(appData, name), { recursive: true, force: true }); } catch {}
  }
}

function shouldCopyEntry(source, fsImpl) {
  if (PROFILE_LOCK_NAMES.has(path.basename(source))) return false;
  let stat;
  try {
    stat = fsImpl.lstatSync(source);
  } catch {
    return true; // let cpSync report the real error
  }
  // Sockets and FIFOs are live IPC endpoints of the other app, not data.
  return !stat.isSocket() && !stat.isFIFO();
}

// Copy the legacy profile into a private staging directory, then publish it
// with one rename so AgentHalo never starts on a half-copied profile.
function copyLegacyProfile(legacy, userData, appData, fsImpl) {
  const staging = path.join(appData, `${STAGING_PREFIX}${process.pid}`);
  fsImpl.rmSync(staging, { recursive: true, force: true });
  try {
    fsImpl.cpSync(legacy, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      filter: (source) => shouldCopyEntry(source, fsImpl),
    });
    // A concurrent first launch may have published its copy while this one
    // was running; its profile wins and ours is discarded.
    if (fsImpl.existsSync(userData)) {
      fsImpl.rmSync(staging, { recursive: true, force: true });
      return;
    }
    fsImpl.renameSync(staging, userData);
  } catch (err) {
    try { fsImpl.rmSync(staging, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

// Seed AgentHalo's profile from a Clawd on Desk profile before Electron opens
// it. The legacy profile is COPIED, never moved: Clawd on Desk may still be
// installed and must keep its own settings. Never merge into or overwrite an
// existing AgentHalo profile. A failed copy throws, so startup stops instead
// of continuing on a fresh profile that would reset the user's preferences.
function migrateUserData(appData, options = {}) {
  const fsImpl = options.fs || fs;
  const userData = path.join(appData, "AgentHalo");
  const legacy = path.join(appData, "clawd-on-desk");
  if (!fsImpl.existsSync(userData)) {
    removeAbandonedStaging(appData, fsImpl);
    if (fsImpl.existsSync(legacy)) copyLegacyProfile(legacy, userData, appData, fsImpl);
  }
  fsImpl.mkdirSync(userData, { recursive: true });
  const prefsPath = path.join(userData, "agenthalo-prefs.json");
  // Only ever renames inside AgentHalo's own profile (the copy above).
  const legacyPrefs = path.join(userData, "clawd-prefs.json");
  if (!fsImpl.existsSync(prefsPath) && fsImpl.existsSync(legacyPrefs)) {
    fsImpl.renameSync(legacyPrefs, prefsPath);
  }
  return { userData, prefsPath };
}

module.exports = { migrateUserData };
