"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const palette = require("../src/ui-color-theme");
const { createUiColorThemeRuntime } = require("../src/ui-color-theme-runtime");
const { createSettingsController } = require("../src/settings-controller");
const createSettingsEffectRouter = require("../src/settings-effect-router");

test("interface colors persist through the controller and reject unknown palettes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "halo-colors-"));
  try {
    const prefsPath = path.join(dir, "prefs.json");
    const controller = createSettingsController({ prefsPath });
    let applied = 0;
    createSettingsEffectRouter({ settingsController: controller, applyUiColorTheme: () => applied++ }).start();
    assert.equal(controller.get("uiColorTheme"), "moss");
    for (const theme of palette.THEMES) {
      assert.equal((await controller.applyUpdate("uiColorTheme", theme.id)).status, "ok");
      assert.equal(createSettingsController({ prefsPath }).get("uiColorTheme"), theme.id);
    }
    const before = applied;
    assert.equal((await controller.applyUpdate("uiColorTheme", "unknown")).status, "error");
    assert.equal(applied, before);
    assert.equal(controller.get("uiColorTheme"), "rose");
    assert.ok(applied > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("light and dark palettes keep semantic status colors independent", () => {
  assert.equal(palette.getTheme("invalid").id, "moss");
  for (const theme of palette.THEMES) {
    for (const dark of [false, true]) {
      const vars = palette.variables(theme.id, dark);
      for (const name of ["running", "idle", "done", "interrupted", "warning-action", "danger-action"]) {
        assert.equal(vars[name], undefined);
      }
      assert.notEqual(vars.bg, vars.text);
      assert.equal(vars.surface, vars["panel-bg"]);
      assert.ok(!palette.css(theme.id).includes("undefined"));
    }
    assert.notEqual(palette.variables(theme.id).bg, palette.variables(theme.id, true).bg);
  }
});

test("accent text and filled button labels remain readable in every palette", () => {
  function luminance(hex) {
    const rgb = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  for (const theme of palette.THEMES) for (const dark of [false, true]) {
    const vars = palette.variables(theme.id, dark);
    assert.ok(contrast(vars["accent-text"], vars.bg) >= 4.5, `${theme.id}/${dark}: accent text`);
    assert.ok(contrast(vars["accent"], vars["accent-contrast"]) >= 4.5, `${theme.id}/${dark}: filled button`);
  }
});

test("palette replacement follows the latest setting, reapplies after reload, and excludes other windows", async () => {
  const app = new EventEmitter();
  const sourceDir = path.resolve(__dirname, "../src");
  let selected = "classic";
  function windowFor(name, local = true) {
    const wc = new EventEmitter();
    const sheets = new Map();
    let count = 0;
    Object.assign(wc, {
      isDestroyed: () => false,
      getURL: () => local ? pathToFileURL(path.join(sourceDir, name)).href : "https://example.com/settings.html",
      insertCSS: async (css) => { await Promise.resolve(); const key = String(++count); sheets.set(key, css); return key; },
      removeInsertedCSS: async (key) => { sheets.delete(key); },
    });
    return { webContents: wc, isDestroyed: () => false, sheets };
  }
  const windows = [windowFor("settings.html"), windowFor("dashboard.html"), windowFor("session-hud.html"), windowFor("index.html"), windowFor("settings.html", false)];
  const runtime = createUiColorThemeRuntime({ app, BrowserWindow: { getAllWindows: () => windows }, getTheme: () => selected });
  await runtime.apply();
  const first = runtime.apply();
  selected = "rose";
  await Promise.all([first, runtime.apply()]);
  for (const win of windows.slice(0, 3)) {
    assert.deepEqual([...win.sheets.values()], [palette.css("rose")]);
  }
  assert.equal(windows[3].sheets.size, 0);
  assert.equal(windows[4].sheets.size, 0);
  const newWindow = windowFor("settings.html");
  windows.push(newWindow);
  app.emit("browser-window-created", {}, newWindow);
  newWindow.webContents.emit("did-finish-load");
  await runtime.apply();
  assert.deepEqual([...newWindow.sheets.values()], [palette.css("rose")]);
  newWindow.sheets.clear();
  newWindow.webContents.emit("did-finish-load");
  await runtime.apply();
  assert.deepEqual([...newWindow.sheets.values()], [palette.css("rose")]);
  runtime.dispose();
  assert.equal(app.listenerCount("browser-window-created"), 0);
});
