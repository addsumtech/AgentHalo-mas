"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildPackagedAppMenuTemplate,
  installApplicationMenu,
} = require("../src/app-menu");

function fakeMenu() {
  const calls = [];
  return {
    calls,
    buildFromTemplate: (template) => ({ template }),
    setApplicationMenu: (menu) => calls.push(menu),
  };
}

describe("application menu", () => {
  it("offers no reload or developer tools in a packaged build", () => {
    const roles = buildPackagedAppMenuTemplate().map((item) => item.role);
    assert.deepStrictEqual(roles, ["appMenu", "editMenu", "windowMenu"]);
    for (const role of ["viewMenu", "reload", "forceReload", "toggleDevTools"]) {
      assert.ok(!roles.includes(role), `${role} should not be in the packaged menu`);
    }
  });

  it("replaces Electron's default menu only for a packaged Mac build", () => {
    const packaged = fakeMenu();
    assert.strictEqual(installApplicationMenu({ Menu: packaged, isPackaged: true, platform: "darwin" }), true);
    assert.strictEqual(packaged.calls.length, 1);
    assert.deepStrictEqual(packaged.calls[0].template, buildPackagedAppMenuTemplate());

    for (const options of [
      { isPackaged: false, platform: "darwin" },
      { isPackaged: true, platform: "win32" },
      { isPackaged: true, platform: "linux" },
    ]) {
      const menu = fakeMenu();
      assert.strictEqual(installApplicationMenu({ Menu: menu, ...options }), false);
      assert.strictEqual(menu.calls.length, 0);
    }
  });
});
