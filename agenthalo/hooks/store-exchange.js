"use strict";

// Mac App Store build: the app runs in the App Sandbox, where os.homedir() is
// its container (~/Library/Containers/<bundle id>/Data), so the ~/.clawd the
// app writes is not the ~/.clawd its hooks read. Hooks run in the user's own
// session; reading the container instead would make macOS ask the terminal
// for "data from other apps". The tool folders the user authorized (such as
// ~/.claude) are the one place both sides can reach, so the store app and its
// hooks exchange the files that otherwise live in ~/.clawd under
// <tool folder>/agenthalo/.
//
// Store hooks are started by hooks/node-launcher.sh, which sets
// AGENTHALO_STORE_HOOK=1; everything here is inert without it.

const fs = require("fs");
const os = require("os");
const path = require("path");

const EXCHANGE_DIR_NAME = "agenthalo";
const STORE_HOOK_ENV = "AGENTHALO_STORE_HOOK";

// Each tool's config folder, relative to the home. src/sandbox-access.js uses
// the same table for the folder picker. Folder names follow what each
// installer writes: WorkBuddy AI keeps its settings in ~/.workbuddy-ai (older
// installs in ~/.workbuddy), Kiro in ~/.kiro, and the opencode family under
// ~/.config.
const TOOL_CONFIG_FOLDERS = Object.freeze({
  "claude-code": { folder: ".claude", label: "~/.claude" },
  codex: { folder: ".codex", label: "~/.codex" },
  "cursor-agent": { folder: ".cursor", label: "~/.cursor" },
  "gemini-cli": { folder: ".gemini", label: "~/.gemini" },
  "antigravity-cli": { folder: ".gemini", label: "~/.gemini" },
  "copilot-cli": { folder: ".copilot", label: "~/.copilot" },
  codebuddy: { folder: ".codebuddy", label: "~/.codebuddy" },
  workbuddy: { folder: ".workbuddy-ai", altFolders: [".workbuddy"], label: "~/.workbuddy-ai" },
  "kiro-cli": { folder: ".kiro", label: "~/.kiro" },
  "kimi-cli": { folder: ".kimi", label: "~/.kimi" },
  "qwen-code": { folder: ".qwen", label: "~/.qwen" },
  zcode: { folder: ".zcode", label: "~/.zcode" },
  codewhale: { folder: ".codewhale", label: "~/.codewhale" },
  "deepseek-harness": { folder: ".dsh", label: "~/.dsh" },
  opencode: { folder: ".config/opencode", label: "~/.config/opencode" },
  mimocode: { folder: ".config/mimocode", label: "~/.config/mimocode" },
  pi: { folder: ".pi", label: "~/.pi" },
  openclaw: { folder: ".openclaw", label: "~/.openclaw" },
  hermes: { folder: ".hermes", label: "~/.hermes" },
  qoder: { folder: ".qoder", label: "~/.qoder" },
  reasonix: { folder: ".reasonix", label: "~/.reasonix" },
  qoderwork: { folder: ".qoderwork", label: "~/.qoderwork" },
  traecode: { folder: ".trae-cn", label: "~/.trae-cn" },
  qwenwork: { folder: ".QwenWorkCN", label: "~/.QwenWorkCN" },
});

// Tools that move their folder through an environment variable. Hooks
// inherit it from the tool that runs them.
const TOOL_CONFIG_ENV = Object.freeze({
  "claude-code": "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME",
});

function folderSegments(folder) {
  return String(folder).split("/").filter(Boolean);
}

function acceptedFolders(spec) {
  return [spec.folder, ...(Array.isArray(spec.altFolders) ? spec.altFolders : [])];
}

function isStoreHook(env = process.env) {
  return !!env && env[STORE_HOOK_ENV] === "1";
}

// Hook side: the config folder of the tool that ran this hook.
function toolConfigDir(agentId, options = {}) {
  const env = options.env || process.env;
  const envName = TOOL_CONFIG_ENV[agentId];
  const fromEnv = envName && env && typeof env[envName] === "string" ? env[envName].trim() : "";
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  const spec = TOOL_CONFIG_FOLDERS[agentId];
  if (!spec) return null;
  return path.join(options.homeDir || os.homedir(), ...folderSegments(spec.folder));
}

function toolExchangeDir(agentId, options = {}) {
  const dir = toolConfigDir(agentId, options);
  return dir ? path.join(dir, EXCHANGE_DIR_NAME) : null;
}

// Hook side: the exchange folder of a tool the store app has connected, or
// null. The app creates the folder (with runtime.json) when the tool connects
// and removes all of it on disconnect, while hooks of sessions started before
// that keep running until those sessions end. So a hook never creates the
// folder: it writes only into one that holds the app's runtime.json or one of
// options.markers (files hooks wrote there before, which stay while the app is
// quit).
function connectedToolExchangeDir(agentId, options = {}) {
  const dir = toolExchangeDir(agentId, options);
  if (!dir) return null;
  const fsModule = options.fs || fs;
  try {
    const stat = fsModule.lstatSync(dir);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }
  const names = ["runtime.json", ...(Array.isArray(options.markers) ? options.markers : [])];
  const present = names.some((name) => {
    try {
      fsModule.lstatSync(path.join(dir, name));
      return true;
    } catch {
      return false;
    }
  });
  return present ? dir : null;
}

// Hook side: every exchange folder the store app may have written, the
// tools' environment overrides first. A hook does not need to know which
// tool it serves: the app writes the same runtime file into each authorized
// folder.
function hookExchangeDirs(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const dirs = [];
  const add = (dir) => {
    if (dir && !dirs.includes(dir)) dirs.push(dir);
  };
  for (const agentId of Object.keys(TOOL_CONFIG_ENV)) add(toolExchangeDir(agentId, { ...options, homeDir }));
  for (const spec of Object.values(TOOL_CONFIG_FOLDERS)) {
    for (const folder of acceptedFolders(spec)) {
      add(path.join(homeDir, ...folderSegments(folder), EXCHANGE_DIR_NAME));
    }
  }
  return dirs;
}

// App side: the exchange folder inside an authorized tool folder. The user
// may have chosen the tool folder itself or the home that holds it.
function authorizedToolDir(agentId, record, options = {}) {
  if (!record || typeof record.path !== "string" || !record.path) return null;
  const selected = path.resolve(record.path);
  const homeDir = typeof record.homeDir === "string" && record.homeDir ? path.resolve(record.homeDir) : null;
  if (!homeDir || selected !== homeDir) return selected;
  const spec = TOOL_CONFIG_FOLDERS[agentId];
  if (!spec) return null;
  const fsModule = options.fs || fs;
  const candidates = acceptedFolders(spec).map((folder) => path.join(homeDir, ...folderSegments(folder)));
  return candidates.find((dir) => {
    try {
      return fsModule.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  }) || candidates[0];
}

function authorizedExchangeDir(agentId, record, options = {}) {
  const dir = authorizedToolDir(agentId, record, options);
  return dir ? path.join(dir, EXCHANGE_DIR_NAME) : null;
}

// kill(pid, 0) is a syscall, not a spawn. EPERM means the process exists.
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !!err && err.code === "EPERM";
  }
}

module.exports = {
  EXCHANGE_DIR_NAME,
  STORE_HOOK_ENV,
  TOOL_CONFIG_FOLDERS,
  TOOL_CONFIG_ENV,
  acceptedFolders,
  folderSegments,
  isStoreHook,
  toolConfigDir,
  toolExchangeDir,
  connectedToolExchangeDir,
  hookExchangeDirs,
  authorizedToolDir,
  authorizedExchangeDir,
  pidAlive,
};
