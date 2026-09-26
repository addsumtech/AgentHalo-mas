#!/usr/bin/env node
// Merge Clawd Codex official hooks into ~/.codex/hooks.json.
//
// PermissionRequest is registered in Phase 2. Keep its output path constrained
// to behavior/message only; Codex currently fail-closes on several future
// decision fields.

const {
  DEFAULT_PARENT_DIR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_FEATURES_CONFIG,
  CODEX_HOOK_EVENTS,
  buildCodexHookCommand,
  registerCodexCommandHooks,
  removeStableCodexHookLauncher,
  unregisterCodexCommandHooks,
} = require("./codex-install-utils");
const {
  STORE_HOOK_SCRIPTS,
  hookCommandOwner,
  isStoreHookInstall,
  storeNodeBin,
} = require("./store-hook-ownership");

const MARKER = "codex-hook.js";
const CODEX_OFFICIAL_HOOK_EVENTS = CODEX_HOOK_EVENTS;

function buildCodexStateHookCommand(nodeBin, hookScript, platform = process.platform) {
  return buildCodexHookCommand(nodeBin, hookScript, platform);
}

// Mac App Store build: its commands run its own entry script, and it only
// touches those (see hooks/store-hook-ownership.js); every other install owns
// the commands that mention codex-hook.js. It never writes the stable launcher
// into ~/.codex (App Review 2.4.5(ii)), so the one found there is not its own.
function getCodexStoreOptions(options = {}) {
  if (!isStoreHookInstall(options)) return null;
  return {
    nodeBin: storeNodeBin(options),
    ownsCommand: hookCommandOwner(options, { agentId: "codex", marker: MARKER }),
    scriptName: STORE_HOOK_SCRIPTS.codex,
  };
}

function registerCodexHooks(options = {}) {
  const store = getCodexStoreOptions(options);
  return registerCodexCommandHooks({
    ...options,
    ...(store ? { nodeBin: store.nodeBin, ownsCommand: store.ownsCommand } : {}),
    marker: MARKER,
    scriptName: store ? store.scriptName : MARKER,
    events: CODEX_OFFICIAL_HOOK_EVENTS,
    label: "Codex official hooks",
    // Codex trusts the resolved command shape. POSIX keeps a stable wrapper;
    // Windows uses a direct PowerShell call-operator command because Defender
    // flags the former inline data-sidecar dispatcher. In-place app upgrades
    // keep the direct path stable, while a real Node/hook path change requires
    // a fresh Codex /hooks review.
    stableLauncher: !store && options.remote !== true && options.stableLauncher !== false,
  });
}

function unregisterCodexHooks(options = {}) {
  const store = getCodexStoreOptions(options);
  const result = unregisterCodexCommandHooks({
    ...options,
    ...(store ? { ownsCommand: store.ownsCommand } : {}),
    marker: MARKER,
    events: CODEX_OFFICIAL_HOOK_EVENTS,
  });
  const stableLauncher = store
    ? { changed: false, launcherRemoved: 0, manifestRemoved: 0 }
    : removeStableCodexHookLauncher(options);
  return {
    ...result,
    changed: result.changed === true || stableLauncher.changed,
    stableLauncher,
  };
}

module.exports = {
  DEFAULT_PARENT_DIR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_FEATURES_CONFIG,
  CODEX_OFFICIAL_HOOK_EVENTS,
  CODEX_STATE_HOOK_EVENTS: CODEX_OFFICIAL_HOOK_EVENTS,
  buildCodexStateHookCommand,
  registerCodexHooks,
  unregisterCodexHooks,
};

if (require.main === module) {
  try {
    if (process.argv.includes("--uninstall")) unregisterCodexHooks({});
    else registerCodexHooks({ remote: process.argv.includes("--remote") });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
