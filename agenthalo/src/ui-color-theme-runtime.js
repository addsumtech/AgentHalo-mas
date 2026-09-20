"use strict";

const path = require("path");
const { fileURLToPath } = require("url");
const { css } = require("./ui-color-theme");

// Only these local app surfaces share the interface palette. Pet artwork and
// state/permission semantics are independent of the selected interface color.
const SURFACES = new Set(["settings.html", "dashboard.html", "session-hud.html"]);

function createUiColorThemeRuntime({ app, BrowserWindow, getTheme, sourceDir = __dirname, logWarn = console.warn }) {
  const records = new WeakMap();
  function applyWindow(win) {
    if (!win || win.isDestroyed()) return Promise.resolve();
    const wc = win.webContents;
    let file;
    try { file = fileURLToPath(wc.getURL()); } catch { return Promise.resolve(); }
    if (path.dirname(file) !== sourceDir || !SURFACES.has(path.basename(file))) return Promise.resolve();
    let record = records.get(wc);
    if (!record) {
      record = { queue: Promise.resolve(), key: null };
      records.set(wc, record);
    }
    // Serialize replacement so rapid changes cannot leave an older palette
    // overriding the most recently committed preference.
    record.queue = record.queue.then(async () => {
      if (wc.isDestroyed()) return;
      const nextKey = await wc.insertCSS(css(getTheme()));
      const oldKey = record.key;
      record.key = nextKey;
      if (oldKey) {
        // A document reload invalidates previously injected stylesheet keys.
        try { await wc.removeInsertedCSS(oldKey); } catch {}
      }
    }).catch((err) => {
      if (!wc.isDestroyed()) logWarn("AgentHalo: interface palette failed:", err.message);
    });
    return record.queue;
  }
  function onWindow(_event, win) {
    win.webContents.on("did-finish-load", () => { void applyWindow(win); });
  }
  app.on("browser-window-created", onWindow);
  return {
    apply: () => Promise.all(BrowserWindow.getAllWindows().map(applyWindow)),
    dispose: () => app.removeListener("browser-window-created", onWindow),
  };
}

module.exports = { createUiColorThemeRuntime };
