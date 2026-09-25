"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const STORE_NAME = "authorized-dirs.json";

const AGENT_CONFIG_DIRS = Object.freeze({
  "claude-code": { folder: ".claude", label: "~/.claude" },
  codex: { folder: ".codex", label: "~/.codex" },
  "cursor-agent": { folder: ".cursor", label: "~/.cursor" },
  "gemini-cli": { folder: ".gemini", label: "~/.gemini" },
  "antigravity-cli": { folder: ".gemini", label: "~/.gemini" },
  "copilot-cli": { folder: ".copilot", label: "~/.copilot" },
  codebuddy: { folder: ".codebuddy", label: "~/.codebuddy" },
  // Folder names below follow what each installer writes: WorkBuddy AI keeps
  // its settings in ~/.workbuddy-ai, Kiro in ~/.kiro/agents, and the opencode
  // family under ~/.config.
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

const FALLBACK_TEXT = Object.freeze({
  sandboxPickFolderTitle: "Choose {folder}",
  sandboxPickFolderMessage: "Select the {folder} folder. AgentHalo only adds its connection entries inside this folder.",
  sandboxPickFolderButton: "Allow Folder",
  sandboxFolderNotAuthorized: "{folder} is not authorized yet. Choose this tool's config folder first.",
  sandboxPickerUnavailable: "The system folder picker is not available.",
  sandboxWrongFolder: "That folder is not {folder}. Choose {folder} or your home folder.",
});

let translateText = null;

// main.js installs its translator so dialog and status text follow the app
// language. Tests and early callers fall back to English.
function setTranslator(translate) {
  translateText = typeof translate === "function" ? translate : null;
}

function text(key, vars = {}) {
  let value = FALLBACK_TEXT[key] || key;
  if (translateText) {
    try {
      const translated = translateText(key);
      if (typeof translated === "string" && translated && translated !== key) value = translated;
    } catch {}
  }
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.split(`{${name}}`).join(String(replacement));
  }
  return value;
}

function specFor(agentId) {
  return AGENT_CONFIG_DIRS[agentId] || {
    folder: String(agentId || "agent"),
    label: String(agentId || "this tool"),
  };
}

function unauthorizedMessage(agentId) {
  return text("sandboxFolderNotAuthorized", { folder: specFor(agentId).label });
}

// Inside App Sandbox, HOME (and so os.homedir()) is the app container. The
// user database still reports the real home, where tools keep their config
// folders, so the picker can open next to them.
function realHomeDir(options = {}) {
  const osModule = options.os || os;
  try {
    const info = osModule.userInfo();
    if (info && typeof info.homedir === "string" && info.homedir) return info.homedir;
  } catch {}
  return osModule.homedir();
}

function resolveStorePath(options = {}) {
  if (options.storePath) return options.storePath;
  if (options.userDataDir) return path.join(options.userDataDir, STORE_NAME);
  try {
    const { app } = require("electron");
    if (app && typeof app.getPath === "function") {
      return path.join(app.getPath("userData"), STORE_NAME);
    }
  } catch {}
  return path.join(os.homedir(), "Library", "Application Support", "AgentHalo", STORE_NAME);
}

function readStore(options = {}) {
  const storePath = resolveStorePath(options);
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writeStore(store, options = {}) {
  const storePath = resolveStorePath(options);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, storePath);
}

function folderSegments(folder) {
  return String(folder).split("/").filter(Boolean);
}

// The main folder first, then any older layout the installer still accepts
// (legacy WorkBuddy keeps settings in ~/.workbuddy).
function acceptedFolders(spec) {
  return [spec.folder, ...(Array.isArray(spec.altFolders) ? spec.altFolders : [])];
}

// Returns the home that contains the tool folder when selectedPath is that
// folder (e.g. /Users/me/.config/opencode -> /Users/me), else null. Names are
// compared case-insensitively because macOS volumes usually are.
function homeAboveConfigFolder(spec, selectedPath) {
  const parts = path.resolve(selectedPath).split(path.sep);
  for (const folder of acceptedFolders(spec)) {
    const segments = folderSegments(folder);
    if (segments.length === 0 || parts.length <= segments.length) continue;
    const tail = parts.slice(-segments.length);
    const matches = tail.every((part, index) => part.toLowerCase() === segments[index].toLowerCase());
    if (matches) return parts.slice(0, -segments.length).join(path.sep) || path.sep;
  }
  return null;
}

function resolveHomeDir(agentId, selectedPath) {
  return homeAboveConfigFolder(specFor(agentId), selectedPath) || path.resolve(selectedPath);
}

// A selection is usable when it is the tool folder itself or a folder that
// contains it (usually the home folder). Anything else would make the
// installers create a stray config folder inside an unrelated directory.
function isConfigFolderSelection(agentId, selectedPath, options = {}) {
  const spec = specFor(agentId);
  if (homeAboveConfigFolder(spec, selectedPath)) return true;
  const fsModule = options.fs || fs;
  return acceptedFolders(spec).some((folder) => {
    try {
      return fsModule.existsSync(path.join(path.resolve(selectedPath), ...folderSegments(folder)));
    } catch {
      return false;
    }
  });
}

function getAuthorized(agentId, options = {}) {
  if (!agentId) return null;
  const entry = readStore(options)[agentId];
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.path !== "string" || !entry.path) return null;
  const homeDir = typeof entry.homeDir === "string" && entry.homeDir
    ? entry.homeDir
    : resolveHomeDir(agentId, entry.path);
  return {
    agentId,
    path: entry.path,
    homeDir,
    bookmark: typeof entry.bookmark === "string" ? entry.bookmark : "",
  };
}

function listAuthorized(options = {}) {
  const store = readStore(options);
  const out = {};
  for (const agentId of Object.keys(store)) {
    const record = getAuthorized(agentId, options);
    if (record) {
      out[agentId] = {
        path: record.path,
        homeDir: record.homeDir,
        label: specFor(agentId).label,
      };
    }
  }
  return out;
}

function forgetAuthorized(agentId, options = {}) {
  const store = readStore(options);
  if (!Object.prototype.hasOwnProperty.call(store, agentId)) return false;
  delete store[agentId];
  writeStore(store, options);
  return true;
}

function saveAuthorized(agentId, selectedPath, bookmark, options = {}) {
  const store = readStore(options);
  store[agentId] = {
    path: path.resolve(selectedPath),
    homeDir: resolveHomeDir(agentId, selectedPath),
    bookmark: bookmark || "",
    updatedAt: new Date().toISOString(),
  };
  writeStore(store, options);
  return getAuthorized(agentId, options);
}

// Returns the stop function Electron hands back, or null when there is no
// bookmark or the build is not sandboxed. Every returned function must be
// called once; a missed call leaks a kernel resource, and enough leaks cut the
// app off from every folder outside its container until it relaunches.
function startAccess(record, options = {}) {
  if (!record || !record.bookmark) return null;
  const electron = options.electron || require("electron");
  const app = electron && electron.app;
  if (!app || typeof app.startAccessingSecurityScopedResource !== "function") return null;
  try {
    const stop = app.startAccessingSecurityScopedResource(record.bookmark);
    return typeof stop === "function" ? stop : null;
  } catch {
    return null;
  }
}

function stopAccess(stop) {
  if (typeof stop !== "function") return;
  try {
    stop();
  } catch {}
}

// Keeps the folder reachable until fn has finished, including async syncs
// whose writes land after fn returns (Claude Code hooks go through a queue).
function withAccess(record, fn, options = {}) {
  const stop = startAccess(record, options);
  let result;
  try {
    result = fn(record);
  } catch (err) {
    stopAccess(stop);
    throw err;
  }
  if (result && typeof result.then === "function") {
    return Promise.resolve(result).finally(() => stopAccess(stop));
  }
  stopAccess(stop);
  return result;
}

async function authorize(agentId, options = {}) {
  if (!agentId) {
    return { status: "error", message: "authorizeAgentConfigDir requires agentId" };
  }
  const existing = getAuthorized(agentId, options);
  if (existing && options.force !== true) {
    return { status: "ok", ...existing, reused: true };
  }
  const spec = specFor(agentId);
  const electron = options.electron || require("electron");
  const dialog = electron && electron.dialog;
  if (!dialog || typeof dialog.showOpenDialog !== "function") {
    return { status: "error", message: text("sandboxPickerUnavailable") };
  }
  const dialogOptions = {
    title: text("sandboxPickFolderTitle", { folder: spec.label }),
    message: text("sandboxPickFolderMessage", { folder: spec.label }),
    buttonLabel: text("sandboxPickFolderButton"),
    defaultPath: path.join(realHomeDir(options), ...folderSegments(spec.folder)),
    // Tool config folders such as ~/.claude are hidden; without this the
    // panel does not list them. No createDirectory: an empty new folder is
    // never a tool's real config folder.
    properties: ["openDirectory", "showHiddenFiles"],
    securityScopedBookmarks: true,
  };
  const parent = options.parentWindow;
  const result = parent && typeof parent.isDestroyed === "function" && !parent.isDestroyed()
    ? await dialog.showOpenDialog(parent, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (!result || result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
    return { status: "error", message: unauthorizedMessage(agentId) };
  }
  const selectedPath = result.filePaths[0];
  if (!isConfigFolderSelection(agentId, selectedPath, options)) {
    return {
      status: "error",
      reason: "wrong-folder",
      message: text("sandboxWrongFolder", { folder: spec.label }),
    };
  }
  const bookmark = Array.isArray(result.bookmarks) ? (result.bookmarks[0] || "") : "";
  const record = saveAuthorized(agentId, selectedPath, bookmark, options);
  return { status: "ok", ...record, reused: false };
}

function requireAuthorized(agentId, options = {}) {
  const record = getAuthorized(agentId, options);
  if (!record) {
    return {
      status: options.automatic === false ? "error" : "skipped",
      reason: "not-authorized",
      message: unauthorizedMessage(agentId),
    };
  }
  return { status: "ok", record };
}

module.exports = {
  AGENT_CONFIG_DIRS,
  STORE_NAME,
  setTranslator,
  specFor,
  unauthorizedMessage,
  realHomeDir,
  resolveStorePath,
  resolveHomeDir,
  isConfigFolderSelection,
  getAuthorized,
  listAuthorized,
  forgetAuthorized,
  saveAuthorized,
  startAccess,
  stopAccess,
  withAccess,
  authorize,
  requireAuthorized,
};
