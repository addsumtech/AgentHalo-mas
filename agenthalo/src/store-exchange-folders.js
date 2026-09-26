"use strict";

// Store build: which authorized tool folders hold the files AgentHalo shares
// with its hooks (hooks/store-exchange.js), and taking them out again when the
// user disconnects that tool. Only tools that are both authorized and
// connected get the folder, so a disconnected tool keeps nothing of ours.

const fs = require("fs");
const path = require("path");
const sandboxAccess = require("./sandbox-access");

// Hooks of sessions that started before a disconnect keep running until those
// sessions end. They never create the folder (hooks/store-exchange.js
// connectedToolExchangeDir), but one already past that check when the folder
// went can still land a file; a second sweep a little later takes it out.
const RESWEEP_DELAY_MS = 5000;

function exchangeDirFor(agentId, { isConnected, ...options } = {}) {
  if (typeof isConnected === "function" && !isConnected(agentId)) return null;
  return sandboxAccess.exchangeDir(agentId, options);
}

function connectedExchangeDirs({ isConnected, ...options } = {}) {
  return sandboxAccess.exchangeDirs({ ...options, include: isConnected });
}

function pathExists(target, fsModule) {
  try {
    fsModule.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

// Removes an exchange folder with everything in it: runtime.json, the Codex
// gate, the Claude recovery leases and anything else. It is AgentHalo's own
// folder inside the tool folder, and disconnecting a tool removes it (as the
// App Review notes say). A symlink named agenthalo is removed, not followed.
function clearExchangeDir(dir, options = {}) {
  if (typeof dir !== "string" || path.basename(dir) !== "agenthalo") return false;
  const fsModule = options.fs || fs;
  try {
    fsModule.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
  } catch {}
  return !pathExists(dir, fsModule);
}

// Keeps the exchange folders in step with the connected tools. The first
// call starts from every authorized folder, so a folder written before its
// tool was disconnected (or by an older build) is cleared too.
function createStoreExchangeFolders({
  isConnected,
  isAuthoritative,
  refreshRuntimeConfig,
  setTimeout: setTimeoutFn = setTimeout,
  resweepDelayMs = RESWEEP_DELAY_MS,
  ...options
} = {}) {
  let current = null;

  function authoritative() {
    return typeof isAuthoritative !== "function" || !!isAuthoritative();
  }

  function dirs() {
    if (!authoritative()) return [];
    return connectedExchangeDirs({ ...options, isConnected });
  }

  function resweepLater(cleared) {
    if (!cleared.length || !(resweepDelayMs >= 0)) return;
    const timer = setTimeoutFn(() => {
      if (!authoritative()) return;
      const connected = dirs();
      for (const dir of cleared) {
        if (!connected.includes(dir)) clearExchangeDir(dir, options);
      }
    }, resweepDelayMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function sync() {
    // Unreadable or recovered prefs cannot say which tools are connected;
    // leave every folder as it is rather than clear a connected one.
    if (!authoritative()) return false;
    const previous = current || sandboxAccess.exchangeDirs(options);
    const next = dirs();
    const cleared = [];
    for (const dir of previous) {
      if (next.includes(dir)) continue;
      // Only a folder that was there can have hooks still writing into it.
      if (pathExists(dir, options.fs || fs)) cleared.push(dir);
      clearExchangeDir(dir, options);
    }
    current = next;
    if (typeof refreshRuntimeConfig === "function") refreshRuntimeConfig();
    resweepLater(cleared);
    return true;
  }

  return {
    dirs,
    dirFor: (agentId) => (
      authoritative() ? exchangeDirFor(agentId, { ...options, isConnected }) : null
    ),
    sync,
  };
}

module.exports = {
  RESWEEP_DELAY_MS,
  exchangeDirFor,
  connectedExchangeDirs,
  clearExchangeDir,
  createStoreExchangeFolders,
};
