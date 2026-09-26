"use strict";

// Without an application menu Electron installs its default one, whose View
// menu offers Reload, Force Reload and Toggle Developer Tools. A packaged
// build keeps only the app, Edit and Window menus: Edit carries the
// copy/paste shortcuts the Settings text fields rely on. Development runs keep
// Electron's default menu so the developer tools stay reachable.
const PACKAGED_MAC_MENU_ROLES = Object.freeze(["appMenu", "editMenu", "windowMenu"]);

function buildPackagedAppMenuTemplate() {
  return PACKAGED_MAC_MENU_ROLES.map((role) => ({ role }));
}

function installApplicationMenu({ Menu, isPackaged, platform = process.platform } = {}) {
  if (!Menu || isPackaged !== true || platform !== "darwin") return false;
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildPackagedAppMenuTemplate()));
  return true;
}

module.exports = {
  PACKAGED_MAC_MENU_ROLES,
  buildPackagedAppMenuTemplate,
  installApplicationMenu,
};
