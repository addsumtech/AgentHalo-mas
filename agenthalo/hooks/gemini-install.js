#!/usr/bin/env node
// Merge Clawd Gemini CLI hooks into ~/.gemini/settings.json (append-only, idempotent)

const fs = require("fs");
const path = require("path");
const os = require("os");
const { resolveNodeBin } = require("./server-config");
const {
  readJsonFile,
  writeJsonAtomic,
  writeJsonAtomicWithBackup,
  asarUnpackedPath,
  commandMatchesMarker,
  extractExistingNodeBin,
  formatNodeHookCommand,
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
const MARKER = "gemini-hook.js";
const HOOK_NAME = "clawd";
const DEFAULT_PARENT_DIR = path.join(os.homedir(), ".gemini");
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_PARENT_DIR, "settings.json");

const GEMINI_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "BeforeAgent",
  "AfterAgent",
  "BeforeTool",
  "AfterTool",
  "Notification",
  "PreCompress",
];

function isClawdHookCommand(command) {
  return typeof command === "string" && command.includes(MARKER);
}

// Which entries this install owns. Every clawd install owns the commands that
// mention gemini-hook.js and the hook name "clawd"; the Mac App Store build
// owns only its own (see hooks/store-hook-ownership.js).
const CLAWD_GEMINI_OWNERSHIP = Object.freeze({
  store: false,
  hookName: HOOK_NAME,
  ownsCommand: isClawdHookCommand,
});

function getGeminiHookOwnership(options = {}) {
  if (!isStoreHookInstall(options)) return CLAWD_GEMINI_OWNERSHIP;
  return {
    store: true,
    hookName: STORE_HOOK_NAME,
    ownsCommand: hookCommandOwner(options, { agentId: "gemini-cli", marker: MARKER }),
  };
}

function buildGeminiHookEntry(command, hookName = HOOK_NAME) {
  return {
    matcher: "*",
    hooks: [{ name: hookName, type: "command", command }],
  };
}

function buildGeminiHookCommand(nodeBin, hookScript, event, options = {}) {
  return formatNodeHookCommand(nodeBin, hookScript, { ...options, args: [event] });
}

function replaceEntry(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function isDesiredGeminiHookEntry(entry, desiredCommand, hookName = HOOK_NAME) {
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

function normalizeGeminiHookEntries(entries, desiredCommand, ownership = CLAWD_GEMINI_OWNERSHIP) {
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
        replaceEntry(entry, buildGeminiHookEntry(desiredCommand, hookName));
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
    if (otherHooks.length > 0) {
      entry.hooks = otherHooks;
      changed = true;
      continue;
    }

    if (dedicatedIndex === -1) {
      if (!isDesiredGeminiHookEntry(entry, desiredCommand, hookName)) {
        replaceEntry(entry, buildGeminiHookEntry(desiredCommand, hookName));
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
    entries.push(buildGeminiHookEntry(desiredCommand, hookName));
    return { matched: true, changed: true };
  }

  const dedicatedEntry = entries[dedicatedIndex];
  if (!isDesiredGeminiHookEntry(dedicatedEntry, desiredCommand, hookName)) {
    replaceEntry(dedicatedEntry, buildGeminiHookEntry(desiredCommand, hookName));
    changed = true;
  }
  return { matched: true, changed };
}

function normalizeGeminiDisabledHooks(settings, ownership = CLAWD_GEMINI_OWNERSHIP) {
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

/**
 * Register Clawd hooks into ~/.gemini/settings.json
 * @param {object} [options]
 * @param {boolean} [options.silent]
 * @param {string} [options.settingsPath]
 * @param {string} [options.homeDir] internal override for tests
 * @returns {{ added: number, skipped: number, updated: number }}
 */
function registerGeminiHooks(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const settingsPath = options.settingsPath || path.join(homeDir, ".gemini", "settings.json");

  // Skip if ~/.gemini/ doesn't exist (Gemini CLI not installed)
  const geminiDir = path.dirname(settingsPath);
  if (!options.settingsPath && !fs.existsSync(geminiDir)) {
    if (!options.silent) console.log("AgentHalo: ~/.gemini/ not found — skipping Gemini hook registration");
    return { added: 0, skipped: 0, updated: 0 };
  }

  const ownership = getGeminiHookOwnership(options);
  const hookScript = ownership.store
    ? storeHookScriptPath(STORE_HOOK_SCRIPTS["gemini-cli"])
    : asarUnpackedPath(path.resolve(__dirname, "gemini-hook.js").replace(/\\/g, "/"));

  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw new Error(`Failed to read settings.json: ${err.message}`);
    }
  }

  // Resolve node path; if detection fails, preserve existing absolute path
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

  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  if (normalizeGeminiDisabledHooks(settings, ownership)) changed = true;

  for (const event of GEMINI_HOOK_EVENTS) {
    const desiredCommand = buildGeminiHookCommand(nodeBin, hookScript, event);
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
      changed = true;
    }

    const arr = settings.hooks[event];
    const result = normalizeGeminiHookEntries(arr, desiredCommand, ownership);
    const found = result.matched;
    const entryChanged = result.changed;
    if (entryChanged) changed = true;

    if (found) {
      if (entryChanged) {
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    arr.push(buildGeminiHookEntry(desiredCommand, ownership.hookName));
    added++;
    changed = true;
  }

  if (added > 0 || changed) {
    writeJsonAtomic(settingsPath, settings);
  }

  if (!options.silent) {
    console.log(`Clawd Gemini hooks → ${settingsPath}`);
    console.log(`  Added: ${added}, updated: ${updated}, skipped: ${skipped}`);
  }

  return { added, skipped, updated };
}

function unregisterGeminiHooks(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const settingsPath = options.settingsPath || path.join(homeDir, ".gemini", "settings.json");

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

  const ownership = getGeminiHookOwnership(options);
  const ownsCommand = ownership.store
    ? ownership.ownsCommand
    : (command) => commandMatchesMarker(command, MARKER);
  let removed = 0;
  let changed = false;
  for (const event of GEMINI_HOOK_EVENTS) {
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
  if (!options.silent) console.log(`Clawd Gemini hooks removed: ${removed}`);
  const result = { removed, changed, settingsPath };
  if (options.backup === true) result.backupPath = backupPath;
  return result;
}

module.exports = {
  DEFAULT_PARENT_DIR,
  DEFAULT_CONFIG_PATH,
  registerGeminiHooks,
  unregisterGeminiHooks,
  GEMINI_HOOK_EVENTS,
  __test: { buildGeminiHookCommand },
};

if (require.main === module) {
  try {
    if (process.argv.includes("--uninstall")) unregisterGeminiHooks({});
    else registerGeminiHooks({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
