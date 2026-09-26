"use strict";

// Store build: which authorized tool folders hold the files AgentHalo shares
// with its hooks (hooks/store-exchange.js), and taking them out again when the
// user disconnects that tool. Only tools that are both authorized and
// connected get the folder, so a disconnected tool keeps nothing of ours.

const fs = require("fs");
const path = require("path");
const { clearRuntimeConfig, CODEX_AUTO_START_GATE_FILENAME } = require("../hooks/server-config");
const { LEASE_DIR_NAME } = require("../hooks/session-recovery-lease");
const sandboxAccess = require("./sandbox-access");

function exchangeDirFor(agentId, { isConnected, ...options } = {}) {
  if (typeof isConnected === "function" && !isConnected(agentId)) return null;
  return sandboxAccess.exchangeDir(agentId, options);
}

function connectedExchangeDirs({ isConnected, ...options } = {}) {
  return sandboxAccess.exchangeDirs({ ...options, include: isConnected });
}

// Removes what AgentHalo keeps in one exchange folder: its own runtime.json
// (another running instance may own the file), the Codex gate and the Claude
// recovery leases. The folder itself goes only when nothing else is in it.
function clearExchangeDir(dir, options = {}) {
  if (typeof dir !== "string" || path.basename(dir) !== "agenthalo") return false;
  const fsModule = options.fs || fs;
  clearRuntimeConfig(path.join(dir, "runtime.json"), { ownerPid: options.ownerPid });
  try { fsModule.unlinkSync(path.join(dir, CODEX_AUTO_START_GATE_FILENAME)); } catch {}
  try { fsModule.rmSync(path.join(dir, LEASE_DIR_NAME), { recursive: true, force: true }); } catch {}
  try {
    fsModule.rmdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

// Keeps the exchange folders in step with the connected tools. The first
// call starts from every authorized folder, so a folder written before its
// tool was disconnected (or by an older build) is cleared too.
function createStoreExchangeFolders({ isConnected, isAuthoritative, refreshRuntimeConfig, ...options } = {}) {
  let current = null;

  function dirs() {
    if (typeof isAuthoritative === "function" && !isAuthoritative()) return [];
    return connectedExchangeDirs({ ...options, isConnected });
  }

  function sync() {
    // Unreadable or recovered prefs cannot say which tools are connected;
    // leave every folder as it is rather than clear a connected one.
    if (typeof isAuthoritative === "function" && !isAuthoritative()) return false;
    const previous = current || sandboxAccess.exchangeDirs(options);
    const next = dirs();
    for (const dir of previous) {
      if (!next.includes(dir)) clearExchangeDir(dir, options);
    }
    current = next;
    if (typeof refreshRuntimeConfig === "function") refreshRuntimeConfig();
    return true;
  }

  return {
    dirs,
    dirFor: (agentId) => (
      typeof isAuthoritative === "function" && !isAuthoritative()
        ? null
        : exchangeDirFor(agentId, { ...options, isConnected })
    ),
    sync,
  };
}

module.exports = {
  exchangeDirFor,
  connectedExchangeDirs,
  clearExchangeDir,
  createStoreExchangeFolders,
};
