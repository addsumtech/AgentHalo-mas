#!/usr/bin/env node
// Merge Clawd QwenWork hooks into ~/.QwenWorkCN/settings.json (append-only, idempotent).
//
// Phase 1 is state-only: the registered hook script posts state to Clawd and
// always returns `{}`, so QwenWork's native permission flow stays in control.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { resolveNodeBin } = require("./server-config");
const {
  readJsonFile,
  writeJsonAtomic,
  writeJsonAtomicWithBackup,
  asarUnpackedPath,
  extractExistingNodeBin,
  formatNodeHookCommand,
  decodeWindowsEncodedCommand,
} = require("./json-utils");
const {
  STORE_HOOK_NAME,
  STORE_HOOK_SCRIPTS,
  hookCommandOwner,
  isStoreHookInstall,
  storeHookScriptPath,
  storeNodeBin,
} = require("./store-hook-ownership");

const MARKER = "qwenwork-hook.js";
const HOOK_NAME = "clawd";
// QwenWork stores its user data home at ~/.QwenWorkCN (macOS; case-insensitive
// "~/.qwenworkcn"), NOT the ~/.qwenwork path its hooks docs mention. The app
// created ~/.QwenWorkCN with the same layout as QoderWork's ~/.qoderwork.
const DEFAULT_PARENT_DIR = path.join(os.homedir(), ".QwenWorkCN");
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_PARENT_DIR, "settings.json");

const QWENWORK_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "Notification",
  // Phase 1 state-only — observed as passive `working` state (they fire 40+
  // times per task as part of normal tool flow), never answered.
  "PermissionRequest",
  "PermissionDenied",
  "SessionEnd",
];

function isClawdHookCommand(command) {
  if (typeof command !== "string") return false;
  if (command.includes(MARKER)) return true;
  // Windows commands are wrapped as PowerShell -EncodedCommand, so the marker
  // lives inside the base64 blob — decode before matching.
  const decoded = decodeWindowsEncodedCommand(command);
  return !!(decoded && decoded.includes(MARKER));
}

// Which entries this install owns. Every clawd install owns the commands that
// mention qwenwork-hook.js and the hook name "clawd"; the Mac App Store build
// owns only its own (see hooks/store-hook-ownership.js).
const CLAWD_QWENWORK_OWNERSHIP = Object.freeze({
  store: false,
  hookName: HOOK_NAME,
  ownsCommand: isClawdHookCommand,
});

function getQwenWorkHookOwnership(options = {}) {
  if (!isStoreHookInstall(options)) return CLAWD_QWENWORK_OWNERSHIP;
  return {
    store: true,
    hookName: STORE_HOOK_NAME,
    ownsCommand: hookCommandOwner(options, { agentId: "qwenwork", marker: MARKER }),
  };
}

function buildQwenWorkHookEntry(command, hookName = HOOK_NAME) {
  return {
    matcher: "*",
    hooks: [{ name: hookName, type: "command", command }],
  };
}

// QwenWork uses its own hooks system that executes command hooks through a
// POSIX shell (Git Bash) on Windows. Use the portable form (unquoted
// forward-slash node token + double-quoted args), which parses under bash
// and cmd alike.
function buildQwenWorkHookCommand(nodeBin, hookScript, event, options = {}) {
  return formatNodeHookCommand(nodeBin, hookScript, {
    ...options,
    args: [event],
    windowsWrapper: "portable",
  });
}

function replaceEntry(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function isDesiredQwenWorkHookEntry(entry, desiredCommand, hookName = HOOK_NAME) {
  return !!(
    entry
    && typeof entry === "object"
    && entry.matcher === "*"
    && Array.isArray(entry.hooks)
    && entry.hooks.length === 1
    && entry.hooks[0]
    && entry.hooks[0].name === hookName
    && entry.hooks[0].type === "command"
    && entry.hooks[0].command === desiredCommand
  );
}

function normalizeQwenWorkHookEntries(entries, desiredCommand, ownership = CLAWD_QWENWORK_OWNERSHIP) {
  if (!Array.isArray(entries)) return { matched: false, changed: false };

  const { hookName, ownsCommand } = ownership;
  let matched = false;
  let changed = false;
  let dedicatedIndex = -1;

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") continue;

    // Legacy flat Clawd entry ({ command }) — normalize into the nested shape.
    if (ownsCommand(entry.command)) {
      matched = true;
      if (dedicatedIndex === -1) {
        replaceEntry(entry, buildQwenWorkHookEntry(desiredCommand, hookName));
        dedicatedIndex = index;
        changed = true;
      } else {
        entries.splice(index, 1);
        index--;
        changed = true;
      }
      continue;
    }

    if (!Array.isArray(entry.hooks)) continue;
    const otherHooks = [];
    let clawdHookCount = 0;
    for (const hook of entry.hooks) {
      if (hook && ownsCommand(hook.command)) {
        clawdHookCount++;
      } else {
        otherHooks.push(hook);
      }
    }
    if (clawdHookCount === 0) continue;

    matched = true;
    // The entry mixes a Clawd hook with user hooks — strip ours, keep theirs.
    if (otherHooks.length > 0) {
      entry.hooks = otherHooks;
      changed = true;
      continue;
    }

    if (dedicatedIndex === -1) {
      if (!isDesiredQwenWorkHookEntry(entry, desiredCommand, hookName)) {
        replaceEntry(entry, buildQwenWorkHookEntry(desiredCommand, hookName));
        changed = true;
      }
      dedicatedIndex = index;
      continue;
    }

    entries.splice(index, 1);
    index--;
    changed = true;
  }

  if (!matched) return { matched: false, changed: false };

  if (dedicatedIndex === -1) {
    entries.push(buildQwenWorkHookEntry(desiredCommand, hookName));
    return { matched: true, changed: true };
  }

  const dedicatedEntry = entries[dedicatedIndex];
  if (!isDesiredQwenWorkHookEntry(dedicatedEntry, desiredCommand, hookName)) {
    replaceEntry(dedicatedEntry, buildQwenWorkHookEntry(desiredCommand, hookName));
    changed = true;
  }
  return { matched: true, changed };
}

// QwenWork's `hooksConfig.disabled` list can name a hook group by id ("clawd")
// or by raw command. Collapse Clawd command references into the "clawd" id and
// de-duplicate so Doctor can reliably see whether our group is disabled.
function normalizeQwenWorkDisabledHooks(settings, ownership = CLAWD_QWENWORK_OWNERSHIP) {
  const hooksConfig = settings && typeof settings === "object" ? settings.hooksConfig : null;
  if (!hooksConfig || typeof hooksConfig !== "object" || !Array.isArray(hooksConfig.disabled)) return false;

  const { hookName, ownsCommand } = ownership;
  let changed = false;
  let sawClawd = false;
  const nextDisabled = [];

  for (const entry of hooksConfig.disabled) {
    if (entry === hookName) {
      if (sawClawd) {
        changed = true;
        continue;
      }
      sawClawd = true;
      nextDisabled.push(entry);
      continue;
    }

    if (ownsCommand(entry)) {
      if (!sawClawd) {
        nextDisabled.push(hookName);
        sawClawd = true;
      }
      changed = true;
      continue;
    }

    nextDisabled.push(entry);
  }

  if (changed) hooksConfig.disabled = nextDisabled;
  return changed;
}

function readSettings(settingsPath) {
  try {
    return readJsonFile(settingsPath);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new Error(`Failed to read settings.json: ${err.message}`);
  }
}

/**
 * Register Clawd hooks into ~/.QwenWorkCN/settings.json
 * @param {object} [options]
 * @param {boolean} [options.silent]
 * @param {string} [options.settingsPath]
 * @param {string} [options.homeDir] internal override for tests
 * @param {string} [options.nodeBin] override node binary path
 * @param {string} [options.platform] override platform (tests)
 * @returns {{ added: number, skipped: number, updated: number }}
 */
function registerQwenWorkHooks(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const settingsPath = options.settingsPath || path.join(homeDir, ".QwenWorkCN", "settings.json");

  // Skip if ~/.QwenWorkCN/ doesn't exist (QwenWork not installed / not initialized).
  const qwenworkDir = path.dirname(settingsPath);
  if (!options.settingsPath && !fs.existsSync(qwenworkDir)) {
    if (!options.silent) console.log("AgentHalo: ~/.QwenWorkCN/ not found — skipping QwenWork hook registration");
    return { added: 0, skipped: 0, updated: 0 };
  }

  const settings = readSettings(settingsPath);
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    throw new Error("Invalid QwenWork settings.json: top level must be an object");
  }
  const ownership = getQwenWorkHookOwnership(options);
  const hookScript = ownership.store
    ? storeHookScriptPath(STORE_HOOK_SCRIPTS.qwenwork)
    : asarUnpackedPath(path.resolve(__dirname, MARKER).replace(/\\/g, "/"));

  // Resolve node path; if detection fails, preserve any existing absolute path.
  const resolved = ownership.store
    ? storeNodeBin(options)
    : (options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin());
  const nodeBin = resolved
    || extractExistingNodeBin(settings, MARKER, { nested: true })
    || "node";

  let added = 0;
  let skipped = 0;
  let updated = 0;
  let changed = false;

  if (settings.hooks == null) {
    settings.hooks = {};
  } else if (typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
    throw new Error("Invalid QwenWork settings.json: hooks must be an object keyed by event name");
  }
  if (normalizeQwenWorkDisabledHooks(settings, ownership)) changed = true;

  for (const event of QWENWORK_HOOK_EVENTS) {
    const desiredCommand = buildQwenWorkHookCommand(nodeBin, hookScript, event, {
      platform: options.platform || process.platform,
    });
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
      changed = true;
    }

    const result = normalizeQwenWorkHookEntries(settings.hooks[event], desiredCommand, ownership);
    if (result.changed) changed = true;

    if (result.matched) {
      if (result.changed) updated++;
      else skipped++;
      continue;
    }

    settings.hooks[event].push(buildQwenWorkHookEntry(desiredCommand, ownership.hookName));
    added++;
    changed = true;
  }

  if (changed) writeJsonAtomic(settingsPath, settings);

  if (!options.silent) {
    console.log(`Clawd QwenWork hooks → ${settingsPath}`);
    console.log(`  Added: ${added}, updated: ${updated}, skipped: ${skipped}`);
  }

  return { added, skipped, updated };
}

/**
 * Remove Clawd hook entries from ~/.QwenWorkCN/settings.json
 * @param {object} [options]
 * @param {boolean} [options.silent]
 * @param {string} [options.settingsPath]
 * @param {string} [options.homeDir] internal override for tests
 * @returns {{ removed: number, changed: boolean, settingsPath: string, backupPath?: string|null }}
 */
function unregisterQwenWorkHooks(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const settingsPath = options.settingsPath || path.join(homeDir, ".QwenWorkCN", "settings.json");

  let settings;
  try {
    settings = readJsonFile(settingsPath);
  } catch (err) {
    if (err.code === "ENOENT") {
      const result = { removed: 0, changed: false, settingsPath };
      if (options.backup === true) result.backupPath = null;
      return result;
    }
    throw new Error(`Failed to read settings.json: ${err.message}`);
  }

  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
    const result = { removed: 0, changed: false, settingsPath };
    if (options.backup === true) result.backupPath = null;
    return result;
  }

  const { ownsCommand } = getQwenWorkHookOwnership(options);
  let removed = 0;
  let changed = false;

  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;

    const next = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") {
        next.push(entry);
        continue;
      }
      // Flat command format.
      if (ownsCommand(entry.command)) {
        removed++;
        changed = true;
        continue;
      }
      // Nested hooks format.
      if (Array.isArray(entry.hooks)) {
        const otherHooks = entry.hooks.filter(
          (hook) => !(hook && typeof hook === "object" && ownsCommand(hook.command))
        );
        removed += entry.hooks.length - otherHooks.length;
        if (otherHooks.length !== entry.hooks.length) {
          changed = true;
          if (otherHooks.length === 0) continue; // drop the whole entry
          entry.hooks = otherHooks;
        }
      }
      next.push(entry);
    }

    if (next.length !== arr.length) {
      settings.hooks[event] = next;
      changed = true;
    }
  }

  let backupPath = null;
  if (changed) backupPath = writeJsonAtomicWithBackup(settingsPath, settings, options);
  if (!options.silent) console.log(`Clawd QwenWork hooks removed: ${removed}`);
  const result = { removed, changed, settingsPath };
  if (options.backup === true) result.backupPath = backupPath;
  return result;
}

module.exports = {
  MARKER,
  DEFAULT_PARENT_DIR,
  DEFAULT_CONFIG_PATH,
  QWENWORK_HOOK_EVENTS,
  buildQwenWorkHookCommand,
  registerQwenWorkHooks,
  unregisterQwenWorkHooks,
};

if (require.main === module) {
  try {
    if (process.argv.includes("--uninstall")) unregisterQwenWorkHooks({});
    else registerQwenWorkHooks({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
