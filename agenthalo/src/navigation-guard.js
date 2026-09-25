"use strict";

const path = require("node:path");
const { fileURLToPath } = require("node:url");

// Every AgentHalo window renders a page bundled under src/ (or a data: page it
// loads itself). Nothing is meant to leave that page: settings links go
// through shell.openExternal and no page calls window.open. Deny both by
// default for every web contents, so an injected link or script can never
// turn an app window, and the privileged preload it carries, into a browser
// for remote content. Programmatic loadFile/loadURL calls from the main
// process do not emit will-navigate and are unaffected. A window that installs
// its own setWindowOpenHandler replaces the default deny.

function isAppPageUrl(url, pagesDir) {
  let filePath;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return false;
    filePath = path.resolve(fileURLToPath(parsed));
  } catch {
    return false;
  }
  const root = path.resolve(pagesDir);
  return filePath.startsWith(root + path.sep);
}

function installNavigationGuard(app, { pagesDir, log = () => {} } = {}) {
  if (!app || typeof app.on !== "function") return;
  if (typeof pagesDir !== "string" || !pagesDir) {
    throw new TypeError("installNavigationGuard requires pagesDir");
  }
  const denyNavigation = (event, url) => {
    // Electron passes the target on the event itself; older builds only as
    // the second argument.
    const target = typeof url === "string" ? url : event && event.url;
    if (isAppPageUrl(target, pagesDir)) return;
    event.preventDefault();
    try { log(`blocked navigation to ${String(target).slice(0, 200)}`); } catch {}
  };
  app.on("web-contents-created", (_event, contents) => {
    if (!contents) return;
    if (typeof contents.setWindowOpenHandler === "function") {
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
    }
    if (typeof contents.on === "function") {
      contents.on("will-navigate", denyNavigation);
    }
  });
}

module.exports = { installNavigationGuard, isAppPageUrl };
