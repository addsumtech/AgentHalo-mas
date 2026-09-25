"use strict";

const fs = require("node:fs");
const path = require("node:path");

// On macOS a bundle is a directory, and shell.openPath hands it to Launch
// Services, which launches an .app (or installs a .prefPane, runs a
// .workflow...) instead of showing a folder. A session cwd comes from a hook
// payload, so it must never name a bundle: not by its own extension, not
// through a symlink's target, and not through the Contents/Info.plist layout
// Launch Services can also recognise by the bundle bit alone.
const BUNDLE_EXTENSIONS = new Set([
  "action", "app", "appex", "bundle", "component", "dext", "driver",
  "framework", "kext", "mdimporter", "mpkg", "osax", "pkg", "plugin",
  "prefpane", "qlgenerator", "saver", "service", "systemextension",
  "wdgt", "workflow", "xpc",
]);

function hasBundleExtension(folder) {
  return BUNDLE_EXTENSIONS.has(path.extname(path.resolve(folder)).slice(1).toLowerCase());
}

async function looksLikeBundle(cwd, realPath) {
  if (hasBundleExtension(cwd) || hasBundleExtension(realPath)) return true;
  try {
    await fs.promises.access(path.join(realPath, "Contents", "Info.plist"));
    return true;
  } catch {
    return false;
  }
}

function createSessionFolderOpener(options = {}) {
  const getSession = options.getSession;
  const openPath = options.openPath;
  if (typeof getSession !== "function") throw new Error("createSessionFolderOpener requires getSession");
  if (typeof openPath !== "function") throw new Error("createSessionFolderOpener requires openPath");

  return async function openSessionFolder(sessionId) {
    if (typeof sessionId !== "string" || !sessionId) {
      return { status: "error", message: "sessionId must be a non-empty string" };
    }
    const session = getSession(sessionId);
    if (!session) return { status: "not-found" };
    if ((session.host && session.host !== "local") || session.platform === "webui") {
      return { status: "not-available", reason: "non-local-session" };
    }
    const cwd = session.cwd;
    if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
      return { status: "not-available", reason: "invalid-cwd" };
    }
    let realPath;
    try {
      realPath = await fs.promises.realpath(cwd);
      if (!(await fs.promises.stat(realPath)).isDirectory()) {
        return { status: "not-available", reason: "invalid-cwd" };
      }
    } catch (_err) {
      return { status: "not-available", reason: "invalid-cwd" };
    }
    if (await looksLikeBundle(cwd, realPath)) {
      return { status: "not-available", reason: "bundle" };
    }
    try {
      // Open the resolved directory that was checked, so a symlink swapped
      // after the check cannot redirect the open to a bundle.
      const errorMessage = await openPath(realPath);
      if (errorMessage) return { status: "error", message: String(errorMessage) };
      return { status: "ok" };
    } catch (err) {
      return { status: "error", message: err && err.message ? err.message : String(err) };
    }
  };
}

module.exports = { createSessionFolderOpener, BUNDLE_EXTENSIONS };
