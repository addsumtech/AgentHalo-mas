#!/usr/bin/env node
// Merge Clawd Qwen Code hooks into ~/.qwen/settings.json.

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
  removeMatchingCommandHooks,
} = require("./json-utils");
const {
  STORE_HOOK_NAME,
  STORE_HOOK_SCRIPTS,
  hookCommandOwner,
  isStoreHookInstall,
  storeHookScriptPath,
  storeNodeBin,
} = require("./store-hook-ownership");

const MARKER = "qwen-code-hook.js";
const HOOK_NAME = "clawd";
const DEFAULT_PARENT_DIR = path.join(os.homedir(), ".qwen");
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_PARENT_DIR, "settings.json");

const QWEN_CODE_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "Notification",
  "PermissionRequest",
];

const MATCHERLESS_EVENTS = new Set(["UserPromptSubmit", "Stop"]);

function timeoutForQwenCodeEvent(event) {
  return event === "PermissionRequest" ? 600000 : 30000;
}

function matcherForQwenCodeEvent(event) {
  return MATCHERLESS_EVENTS.has(event) ? null : "*";
}

function isClawdHookCommand(command) {
  if (typeof command !== "string") return false;
  if (command.includes(MARKER)) return true;
  const decoded = decodeWindowsEncodedCommand(command);
  return !!(decoded && decoded.includes(MARKER));
}

// Qwen Code 0.16.1 runs hook commands via `cmd.exe /d /s /c <command>` on
// Windows (chunk-BAZDG3QU.js:99770 / :118463). cmd's /s flag strips the
// outer quotes off the command string, which mangles any path containing
// a space (e.g. `"C:\Program Files\nodejs\node.exe"` → `C:\Program`).
// Mirror the Antigravity Windows fix (c2f2bfd): wrap the command as
// PowerShell -EncodedCommand so cmd just hands the base64 blob to
// powershell.exe and the parser never sees our node path.
function buildQwenCodeHookCommand(nodeBin, hookScript, event, options = {}) {
  return formatNodeHookCommand(nodeBin, hookScript, {
    ...options,
    args: [event],
    windowsWrapper: "encoded",
  });
}

// Which entries this install owns. Every clawd install owns the commands that
// mention qwen-code-hook.js; the Mac App Store build owns only its own, and
// names them apart (see hooks/store-hook-ownership.js).
const CLAWD_QWEN_CODE_OWNERSHIP = Object.freeze({
  store: false,
  hookName: HOOK_NAME,
  ownsCommand: isClawdHookCommand,
});

function getQwenCodeHookOwnership(options = {}) {
  if (!isStoreHookInstall(options)) return CLAWD_QWEN_CODE_OWNERSHIP;
  return {
    store: true,
    hookName: STORE_HOOK_NAME,
    ownsCommand: hookCommandOwner(options, { agentId: "qwen-code", marker: MARKER }),
  };
}

function buildQwenCodeHookEntry(command, event, hookName = HOOK_NAME) {
  const matcher = matcherForQwenCodeEvent(event);
  const entry = {
    hooks: [{
      name: hookName,
      type: "command",
      command,
      timeout: timeoutForQwenCodeEvent(event),
    }],
  };
  if (matcher !== null) entry.matcher = matcher;
  return entry;
}

function replaceEntry(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function isDesiredQwenCodeHookEntry(entry, desiredCommand, event, hookName = HOOK_NAME) {
  if (!entry || typeof entry !== "object") return false;
  const matcher = matcherForQwenCodeEvent(event);
  if (matcher === null) {
    if (Object.prototype.hasOwnProperty.call(entry, "matcher")) return false;
  } else if (entry.matcher !== matcher) {
    return false;
  }
  return !!(
    Array.isArray(entry.hooks)
    && entry.hooks.length === 1
    && entry.hooks[0]
    && entry.hooks[0].name === hookName
    && entry.hooks[0].type === "command"
    && entry.hooks[0].command === desiredCommand
    && entry.hooks[0].timeout === timeoutForQwenCodeEvent(event)
  );
}

function normalizeQwenCodeHookEntries(entries, desiredCommand, event, ownership = CLAWD_QWEN_CODE_OWNERSHIP) {
  if (!Array.isArray(entries)) return { matched: false, changed: false };

  const { hookName, ownsCommand } = ownership;
  let matched = false;
  let changed = false;
  let dedicatedIndex = -1;

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") continue;

    if (ownsCommand(entry.command)) {
      matched = true;
      if (dedicatedIndex === -1) {
        replaceEntry(entry, buildQwenCodeHookEntry(desiredCommand, event, hookName));
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
      if (hook && ownsCommand(hook.command)) clawdHookCount++;
      else otherHooks.push(hook);
    }
    if (clawdHookCount === 0) continue;

    matched = true;
    if (otherHooks.length > 0) {
      entry.hooks = otherHooks;
      changed = true;
      continue;
    }

    if (dedicatedIndex === -1) {
      if (!isDesiredQwenCodeHookEntry(entry, desiredCommand, event, hookName)) {
        replaceEntry(entry, buildQwenCodeHookEntry(desiredCommand, event, hookName));
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
    entries.push(buildQwenCodeHookEntry(desiredCommand, event, hookName));
    return { matched: true, changed: true };
  }

  const dedicatedEntry = entries[dedicatedIndex];
  if (!isDesiredQwenCodeHookEntry(dedicatedEntry, desiredCommand, event, hookName)) {
    replaceEntry(dedicatedEntry, buildQwenCodeHookEntry(desiredCommand, event, hookName));
    changed = true;
  }
  return { matched: true, changed };
}

function readSettings(settingsPath) {
  try {
    return readJsonFile(settingsPath);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new Error(`Failed to read settings.json: ${err.message}`);
  }
}

function registerQwenCodeHooks(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const settingsPath = options.settingsPath || path.join(homeDir, ".qwen", "settings.json");
  const qwenDir = path.dirname(settingsPath);

  if (!options.settingsPath && !fs.existsSync(qwenDir)) {
    if (!options.silent) console.log("AgentHalo: ~/.qwen/ not found - skipping Qwen hook registration");
    return { added: 0, skipped: 0, updated: 0, warnings: [] };
  }

  const settings = readSettings(settingsPath);
  const warnings = [];
  if (settings && settings.disableAllHooks === true) {
    warnings.push("settings.json has disableAllHooks=true; Clawd Qwen hooks will not fire until that flag is removed.");
  }

  const ownership = getQwenCodeHookOwnership(options);
  const hookScript = ownership.store
    ? storeHookScriptPath(STORE_HOOK_SCRIPTS["qwen-code"])
    : asarUnpackedPath(path.resolve(__dirname, MARKER).replace(/\\/g, "/"));
  const resolved = ownership.store
    ? storeNodeBin(options)
    : (options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin());
  const nodeBin = resolved
    || extractExistingNodeBin(settings, MARKER, { nested: true })
    || "node";

  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};

  let added = 0;
  let skipped = 0;
  let updated = 0;
  let changed = false;

  for (const event of QWEN_CODE_HOOK_EVENTS) {
    const desiredCommand = buildQwenCodeHookCommand(
      nodeBin,
      hookScript,
      event,
      { platform: options.platform || process.platform }
    );

    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
      changed = true;
    }

    const result = normalizeQwenCodeHookEntries(settings.hooks[event], desiredCommand, event, ownership);
    if (result.changed) changed = true;

    if (result.matched) {
      if (result.changed) updated++;
      else skipped++;
      continue;
    }

    settings.hooks[event].push(buildQwenCodeHookEntry(desiredCommand, event, ownership.hookName));
    added++;
    changed = true;
  }

  if (changed) writeJsonAtomic(settingsPath, settings);

  if (!options.silent) {
    console.log(`Clawd Qwen hooks -> ${settingsPath}`);
    console.log(`  Added: ${added}, updated: ${updated}, skipped: ${skipped}`);
    for (const warning of warnings) console.warn(`  Warning: ${warning}`);
  }

  return { added, skipped, updated, warnings };
}

function unregisterQwenCodeHooks(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const settingsPath = options.settingsPath || path.join(homeDir, ".qwen", "settings.json");

  let settings = {};
  try {
    settings = readJsonFile(settingsPath);
  } catch (err) {
    if (err.code === "ENOENT") return { removed: 0, changed: false, settingsPath };
    throw new Error(`Failed to read settings.json: ${err.message}`);
  }

  if (!settings.hooks || typeof settings.hooks !== "object") {
    return { removed: 0, changed: false, settingsPath };
  }

  const { ownsCommand } = getQwenCodeHookOwnership(options);
  let removed = 0;
  let changed = false;
  for (const event of QWEN_CODE_HOOK_EVENTS) {
    const entries = settings.hooks[event];
    if (!Array.isArray(entries)) continue;
    const result = removeMatchingCommandHooks(entries, ownsCommand);
    if (!result.changed) continue;
    removed += result.removed;
    changed = true;
    if (result.entries.length > 0) settings.hooks[event] = result.entries;
    else delete settings.hooks[event];
  }

  let backupPath = null;
  if (changed) backupPath = writeJsonAtomicWithBackup(settingsPath, settings, options);
  if (!options.silent) console.log(`Clawd Qwen hooks removed: ${removed}`);
  const result = { removed, changed, settingsPath };
  if (options.backup === true) result.backupPath = backupPath;
  return result;
}

module.exports = {
  DEFAULT_PARENT_DIR,
  DEFAULT_CONFIG_PATH,
  MARKER,
  QWEN_CODE_HOOK_EVENTS,
  buildQwenCodeHookCommand,
  matcherForQwenCodeEvent,
  registerQwenCodeHooks,
  unregisterQwenCodeHooks,
  timeoutForQwenCodeEvent,
};

if (require.main === module) {
  try {
    if (process.argv.includes("--uninstall")) unregisterQwenCodeHooks({});
    else registerQwenCodeHooks({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
