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
  workbuddy: { folder: ".workbuddy", label: "~/.workbuddy" },
  "kiro-cli": { folder: ".kiro-cli", label: "~/.kiro-cli" },
  "kimi-cli": { folder: ".kimi", label: "~/.kimi" },
  "qwen-code": { folder: ".qwen", label: "~/.qwen" },
  zcode: { folder: ".zcode", label: "~/.zcode" },
  codewhale: { folder: ".codewhale", label: "~/.codewhale" },
  "deepseek-harness": { folder: ".dsh", label: "~/.dsh" },
  opencode: { folder: ".opencode", label: "~/.opencode" },
  mimocode: { folder: ".mimocode", label: "~/.mimocode" },
  pi: { folder: ".pi", label: "~/.pi" },
  openclaw: { folder: ".openclaw", label: "~/.openclaw" },
  hermes: { folder: ".hermes", label: "~/.hermes" },
  qoder: { folder: ".qoder", label: "~/.qoder" },
  reasonix: { folder: ".reasonix", label: "~/.reasonix" },
  qoderwork: { folder: ".qoderwork", label: "~/.qoderwork" },
  traecode: { folder: ".trae-cn", label: "~/.trae-cn" },
  qwenwork: { folder: ".QwenWorkCN", label: "~/.QwenWorkCN" },
});

function specFor(agentId) {
  return AGENT_CONFIG_DIRS[agentId] || {
    folder: String(agentId || "agent"),
    label: String(agentId || "this tool"),
  };
}

function unauthorizedMessage(agentId) {
  const spec = specFor(agentId);
  return `尚未授权 ${spec.label}。请先选择该工具的配置文件夹。`;
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

function resolveHomeDir(agentId, selectedPath) {
  const spec = specFor(agentId);
  const resolved = path.resolve(selectedPath);
  const base = path.basename(resolved);
  if (base === spec.folder) return path.dirname(resolved);
  try {
    if (fs.existsSync(path.join(resolved, spec.folder))) return resolved;
  } catch {}
  return resolved;
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

function startAccess(record, options = {}) {
  if (!record || !record.bookmark) return false;
  const electron = options.electron || require("electron");
  const app = electron && electron.app;
  if (!app || typeof app.startAccessingSecurityScopedResource !== "function") return false;
  try {
    return !!app.startAccessingSecurityScopedResource(record.bookmark);
  } catch {
    return false;
  }
}

function stopAccess(record, started, options = {}) {
  if (!started || !record || !record.bookmark) return;
  const electron = options.electron || require("electron");
  const app = electron && electron.app;
  if (!app || typeof app.stopAccessingSecurityScopedResource !== "function") return;
  try {
    app.stopAccessingSecurityScopedResource(record.bookmark);
  } catch {}
}

function withAccess(record, fn, options = {}) {
  const started = startAccess(record, options);
  try {
    return fn(record);
  } finally {
    stopAccess(record, started, options);
  }
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
    return { status: "error", message: "系统文件夹选择器不可用" };
  }
  const defaultPath = path.join(os.homedir(), spec.folder);
  const result = await dialog.showOpenDialog({
    title: `选择 ${spec.label}`,
    message: `请选中 ${spec.label} 文件夹。AgentHalo 只会在该目录写入 hook，不会读取对话内容。`,
    buttonLabel: "授权此目录",
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
    securityScopedBookmarks: true,
  });
  if (!result || result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
    return { status: "error", message: unauthorizedMessage(agentId) };
  }
  const selectedPath = result.filePaths[0];
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
  specFor,
  unauthorizedMessage,
  resolveStorePath,
  resolveHomeDir,
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
