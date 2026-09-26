"use strict";

// Mac App Store build: which entries in another tool's hook config are ours.
//
// The store build can share each tool's config with the original AgentHalo
// (bundle com.agenthalo.desktop) or any other clawd install. Those treat
// every command that mentions their hook script (gemini-hook.js,
// cursor-hook.js, codex-hook.js, ...), every hook or Antigravity hook group
// named "clawd", every CodeWhale entry marked "managed by clawd-on-desk" and
// every http://127.0.0.1:<23333-23337>/permission URL as their own, and
// rewrite or delete it on every sync, repair and uninstall. Two installs
// doing that to each other take turns overwriting one another's entries.
//
// So the store build runs each tool's hook through an entry script of its
// own (STORE_HOOK_SCRIPTS below, thin wrappers around the shared hook
// scripts), uses STORE_HOOK_NAME where a tool keys hooks by name, and only
// ever touches entries carrying those names. Commands an
// earlier store build wrote (this bundle's node-launcher.sh running the shared
// script from this bundle's hooks folder) count as ours too, so updating the
// app migrates them. The Claude Code rules live in hooks/install.js.

const path = require("path");
const { asarUnpackedPath } = require("./json-utils");
const { getBundledNodeLauncherPath } = require("./server-config");

// Hook name (Gemini CLI, Qwen Code, Qoder, QoderWork, QwenWork), Antigravity
// hook group and CodeWhale section comment of the store build.
//
// None of these tools restricts the name: Gemini CLI, Qwen Code and Qoder
// declare it a plain string with no pattern, and Antigravity's hooks.json maps
// free-form hook names ("my-linter-hook" in its docs) to their events. It has
// to differ from the other install's "clawd": Qwen Code keeps one hook per
// name for an event and matcher, and Gemini CLI's hooksConfig.disabled lists
// names, so a shared name would drop or disable both installs' hooks together.
const STORE_HOOK_NAME = "agenthalo-store";

// Entry script the store build writes for each tool, next to the shared hook
// script it runs. None contains the name another install matches on.
const STORE_HOOK_SCRIPTS = Object.freeze({
  "claude-code": "agenthalo-store-hook.js",
  "gemini-cli": "agenthalo-store-gemini.js",
  "antigravity-cli": "agenthalo-store-antigravity.js",
  "antigravity-statusline": "agenthalo-store-antigravity-status.js",
  "cursor-agent": "agenthalo-store-cursor.js",
  "copilot-cli": "agenthalo-store-copilot.js",
  codebuddy: "agenthalo-store-codebuddy.js",
  workbuddy: "agenthalo-store-workbuddy.js",
  "qwen-code": "agenthalo-store-qwen-code.js",
  zcode: "agenthalo-store-zcode.js",
  codewhale: "agenthalo-store-codewhale.js",
  codex: "agenthalo-store-codex.js",
  qoder: "agenthalo-store-qoder.js",
  reasonix: "agenthalo-store-reasonix.js",
  qoderwork: "agenthalo-store-qoderwork.js",
  traecode: "agenthalo-store-traecode.js",
  qwenwork: "agenthalo-store-qwenwork.js",
});

// options.storeHooks overrides the build check (tests, and callers that
// compare both installs). Remote installs never run the store build.
function isStoreHookInstall(options = {}) {
  if (options && options.remote === true) return false;
  if (options && typeof options.storeHooks === "boolean") return options.storeHooks;
  return process.mas === true;
}

function storeHookScriptPath(name) {
  return asarUnpackedPath(path.resolve(__dirname, name).replace(/\\/g, "/"));
}

// The store build always runs its hooks through the bundled launcher: the
// sandboxed app cannot see the user's Node, and a Node path taken from another
// install's commands would run store hooks without their store environment.
function storeNodeBin(options = {}) {
  return typeof options.nodeBin === "string" && options.nodeBin ? options.nodeBin : getBundledNodeLauncherPath();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `script` as a whole path segment, so a longer name that merely ends with it
// is not ours.
function commandNamesScript(command, script) {
  return typeof command === "string"
    && new RegExp(`(^|[\\\\/"'\\s])${escapeRegExp(script)}(["'\\s]|$)`).test(command);
}

// `filePath` as a whole (quoted or bare) argument.
function commandNamesPath(command, filePath) {
  return typeof command === "string"
    && new RegExp(`(^|["'\\s])${escapeRegExp(filePath)}(["'\\s]|$)`).test(command);
}

// A command an earlier store build wrote: this bundle's launcher running the
// shared script from this bundle's hooks folder. Another install that took the
// launcher for its Node path still runs its own script, so it is not ours.
function isLegacyStoreCommand(command, legacyScript) {
  return !!legacyScript
    && commandNamesPath(command, getBundledNodeLauncherPath())
    && commandNamesPath(command, storeHookScriptPath(legacyScript));
}

function isStoreOwnedCommand(command, storeScript, legacyScript) {
  if (typeof command !== "string") return false;
  return commandNamesScript(command, storeScript) || isLegacyStoreCommand(command, legacyScript);
}

// Command predicate for one tool: the store build's own entries, or anything
// mentioning `marker` for every other install.
function hookCommandOwner(options, { agentId, marker, matchesMarker }) {
  if (isStoreHookInstall(options)) {
    const storeScript = STORE_HOOK_SCRIPTS[agentId];
    return (command) => isStoreOwnedCommand(command, storeScript, marker);
  }
  return typeof matchesMarker === "function"
    ? matchesMarker
    : (command) => typeof command === "string" && command.includes(marker);
}

module.exports = {
  STORE_HOOK_NAME,
  STORE_HOOK_SCRIPTS,
  hookCommandOwner,
  isLegacyStoreCommand,
  isStoreHookInstall,
  isStoreOwnedCommand,
  storeHookScriptPath,
  storeNodeBin,
};
