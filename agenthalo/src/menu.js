"use strict";

const { app, BrowserWindow, screen, Menu, Tray, nativeImage } = require("electron");
const path = require("path");
const { keepOutOfTaskbar } = require("./taskbar");
const { loadTrayNormalIcon } = require("./tray-flash-icon");
const { createMacDockVisibilityCoordinator } = require("./mac-dock-visibility");
const { resolveRuntimeDockIconPolicy } = require("./mac-dock-icon-runtime");

const platform = process.platform;
const isMac = platform === "darwin";
const isWin = platform === "win32";
const isLinux = platform === "linux";

// Login-item / autostart helpers and the openAtLogin write path live in
// src/login-item.js + main.js's settings-actions effect. menu.js used to
// inline them but now just renders a checkbox bound to ctx.openAtLogin.

const WIN_TOPMOST_LEVEL = "pop-up-menu"; // above taskbar-level UI

// ── Window size presets (mirrored from main.js for resizeWindow) ──
const SIZES = {
  S: { width: 200, height: 200 },
  M: { width: 280, height: 280 },
  L: { width: 360, height: 360 },
};

// i18n string pool + translator factory live in src/i18n.js so the future
// settings panel can share them. menu.js binds the translator to ctx.lang.
const { createTranslator } = require("./i18n");

// Concatenate menu groups into one Electron template, inserting exactly one
// separator between non-empty groups. Empty groups are dropped entirely so no
// phantom/doubled separator is ever rendered (Electron leaves a visible gap for
// a stray separator). Doing the grouping here — instead of hand-placing a
// separator around almost every item — is what lets the menu read as a few
// labelled clusters (state / work / display / app) rather than one slice per
// row.
function joinGroups(groups) {
  const template = [];
  for (const group of groups) {
    if (!group || group.length === 0) continue;
    if (template.length > 0) template.push({ type: "separator" });
    template.push(...group);
  }
  return template;
}

module.exports = function initMenu(ctx) {
  // ── Translation helper (bound to ctx.lang via the shared i18n module) ──
  const t = createTranslator(() => ctx.lang);
  const macDockVisibility = isMac ? createMacDockVisibilityCoordinator({
    app,
    dock: app.dock,
    dockIconPath: path.join(__dirname, "../assets/dock-icon.png"),
    shouldInstallDockIcon: () => resolveRuntimeDockIconPolicy({
      platform,
      isPackaged: app.isPackaged === true,
      getSystemVersion: () => {
        if (typeof ctx.getSystemVersion === "function") return ctx.getSystemVersion();
        if (typeof process.getSystemVersion === "function") return process.getSystemVersion();
        return "";
      },
    }),
    getSettingsWindow: ctx.getSettingsWindow,
    reapplyMacVisibility: ctx.reapplyMacVisibility,
  }) : null;

  function createTray() {
    if (ctx.tray) return;
    // Shared with the completion flash so both frames keep the same size (#722).
    const icon = loadTrayNormalIcon({
      nativeImage,
      platform: process.platform,
      templatePath: path.join(__dirname, "../assets/tray-iconTemplate.png"),
      iconPath: path.join(__dirname, "../assets/icon.png"),
    });
    ctx.tray = new Tray(icon);
    ctx.tray.setToolTip("AgentHalo");
    buildTrayMenu();
  }

  function destroyTray() {
    if (!ctx.tray) return;
    ctx.tray.destroy();
    ctx.tray = null;
  }

  function applyDockVisibility() {
    if (!isMac) return;
    return macDockVisibility.apply(ctx.showDock);
  }

  function buildCompanionMenuItems() {
    // Capture visibility intent so a concurrent fullscreen change cannot
    // invert the action the user selected from an already open menu.
    const petHiddenAtBuild = ctx.petHidden;
    return joinGroups([
      [{ label: t("openDashboard"), click: () => {
        if (typeof ctx.openDashboard === "function") ctx.openDashboard();
      } }],
      [
        { label: t("doNotDisturb"), type: "checkbox", checked: !!ctx.doNotDisturb,
          click: (item) => item.checked ? ctx.enableDoNotDisturb() : ctx.disableDoNotDisturb() },
        { label: t("settings"), click: () => ctx.openSettingsWindow() },
        { label: petHiddenAtBuild ? t("showPet") : t("hidePet"),
          click: () => ctx.setPetVisibility(petHiddenAtBuild) },
      ],
      [{ label: t("quit"), click: () => requestAppQuit() }],
    ]);
  }

  function buildTrayMenu() {
    if (!ctx.tray) return;
    ctx.tray.setContextMenu(Menu.buildFromTemplate(buildCompanionMenuItems()));
  }

  function rebuildAllMenus() {
    buildTrayMenu();
    buildContextMenu();
  }

  function requestAppQuit() {
    ctx.isQuitting = true;
    app.quit();
  }

  function ensureContextMenuOwner() {
    if (ctx.contextMenuOwner && !ctx.contextMenuOwner.isDestroyed()) return ctx.contextMenuOwner;
    if (!ctx.win || ctx.win.isDestroyed()) return null;

    ctx.contextMenuOwner = new BrowserWindow({
      parent: ctx.win,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focusable: !isMac,
      closable: false,
      minimizable: false,
      maximizable: false,
      hasShadow: false,
    });

    // Chromium reclaims empty (about:blank) hidden renderers, which defeats
    // the "persistent helper window" design — every right-click ends up
    // re-spawning a renderer process. Load a minimal data: URL so the
    // renderer has a real document and stays alive across menu invocations.
    ctx.contextMenuOwner.loadURL("data:text/html,%3C!doctype%20html%3E");

    // macOS: ensure owner can appear on fullscreen Spaces
    ctx.reapplyMacVisibility();

    ctx.contextMenuOwner.on("close", (event) => {
      if (!ctx.isQuitting) {
        event.preventDefault();
        ctx.contextMenuOwner.hide();
      }
    });

    ctx.contextMenuOwner.on("closed", () => {
      ctx.contextMenuOwner = null;
    });

    return ctx.contextMenuOwner;
  }

  function popupMenuAt(menu) {
    if (ctx.menuOpen) return;
    const owner = ensureContextMenuOwner();
    if (!owner) return;

    const cursor = screen.getCursorScreenPoint();
    owner.setBounds({ x: cursor.x, y: cursor.y, width: 1, height: 1 });
    // macOS native menus can track without activating their owner. Focusing
    // this helper activates the whole app and can raise an existing settings
    // or dashboard window when the helper hides after a menu action.
    if (isMac) owner.showInactive();
    else owner.show();
    keepOutOfTaskbar(owner);
    if (!isMac) owner.focus();

    ctx.menuOpen = true;
    menu.popup({
      window: owner,
      callback: () => {
        ctx.menuOpen = false;
        if (owner && !owner.isDestroyed()) owner.hide();
        // ctx.petHidden guard: the menu's own Hide item may have just hidden
        // the pet, and the click handler can fire on either side of this close
        // callback — an unconditional showInactive() would resurrect a window
        // setPetHidden() just hid. Skipping is safe: showPetWindows() re-asserts
        // taskbar/mac flags on the next show, and Windows topmost is held by
        // the window's alwaysOnTop flag plus the topmost-runtime watchdog, not
        // by this callback.
        if (ctx.win && !ctx.win.isDestroyed() && !ctx.petHidden) {
          ctx.win.showInactive();
          keepOutOfTaskbar(ctx.win);
          if (isMac) {
            ctx.reapplyMacVisibility();
          } else if (isWin) {
            ctx.win.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
          }
        }
      },
    });
  }

  function buildContextMenu() {
    ctx.contextMenu = Menu.buildFromTemplate(buildCompanionMenuItems());
  }

  function showPetContextMenu() {
    if (!ctx.win || ctx.win.isDestroyed()) return;
    buildContextMenu();
    popupMenuAt(ctx.contextMenu);
  }

  function resizeWindow(sizeKey, options = {}) {
    const mode = options.mode || (options.persist === false ? "preview" : "commit");
    const persist = mode !== "preview";
    // Setter routes through controller.applyUpdate("size", ...) — subscriber
    // rebuilds menus on commit. We still need to physically resize the
    // window and capture the new bounds at the end.
    if (persist) ctx.currentSize = sizeKey;
    const size = (typeof ctx.getPixelSizeFor === "function")
      ? ctx.getPixelSizeFor(sizeKey)
      : (SIZES[sizeKey] || ctx.getCurrentPixelSize());
    if (!ctx.miniHandleResize(sizeKey)) {
      if (ctx.win && !ctx.win.isDestroyed()) {
        const { x, y } = ctx.getPetWindowBounds();
        const clamped = ctx.clampToScreenVisual(x, y, size.width, size.height);
        ctx.applyPetWindowBounds({ ...clamped, width: size.width, height: size.height });
      }
    }
    if (mode !== "preview") {
      ctx.syncHitWin();
      ctx.repositionBubbles();
      if (persist) ctx.flushRuntimeStateToPrefs();
    }
  }

  return {
    t,
    buildContextMenu,
    buildTrayMenu,
    rebuildAllMenus,
    createTray,
    destroyTray,
    getTray: () => ctx.tray,
    applyDockVisibility,
    ensureContextMenuOwner,
    popupMenuAt,
    showPetContextMenu,
    resizeWindow,
    requestAppQuit,
  };
};
