"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { installNavigationGuard, isAppPageUrl } = require("../src/navigation-guard");

const SRC_DIR = path.join(__dirname, "..", "src");
const pageUrl = (name) => pathToFileURL(path.join(SRC_DIR, name)).href;

function makeContents() {
  const contents = new EventEmitter();
  contents.windowOpenHandler = null;
  contents.setWindowOpenHandler = (handler) => { contents.windowOpenHandler = handler; };
  return contents;
}

function navigate(contents, url, { urlOnEvent = false } = {}) {
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  if (urlOnEvent) {
    event.url = url;
    contents.emit("will-navigate", event);
  } else {
    contents.emit("will-navigate", event, url);
  }
  return prevented;
}

function installed() {
  const app = new EventEmitter();
  const logs = [];
  installNavigationGuard(app, { pagesDir: SRC_DIR, log: (msg) => logs.push(msg) });
  const contents = makeContents();
  app.emit("web-contents-created", {}, contents);
  return { contents, logs };
}

describe("navigation guard", () => {
  it("recognizes only file pages inside the bundled pages directory", () => {
    assert.strictEqual(isAppPageUrl(pageUrl("settings.html"), SRC_DIR), true);
    assert.strictEqual(isAppPageUrl(`${pageUrl("dashboard.html")}#sessions`, SRC_DIR), true);
    for (const url of [
      "https://evil.example/",
      "http://127.0.0.1:23333/state",
      "data:text/html,<p>x</p>",
      "javascript:alert(1)",
      pathToFileURL(path.join(SRC_DIR, "..", "package.json")).href,
      pathToFileURL(`${SRC_DIR}-evil${path.sep}index.html`).href,
      pathToFileURL(path.join(SRC_DIR, "..", "..", "etc", "passwd")).href,
      "not a url",
      "",
      undefined,
    ]) {
      assert.strictEqual(isAppPageUrl(url, SRC_DIR), false, String(url));
    }
  });

  it("denies window.open by default on every new web contents", () => {
    const { contents } = installed();
    assert.strictEqual(typeof contents.windowOpenHandler, "function");
    assert.deepStrictEqual(contents.windowOpenHandler({ url: "https://evil.example/" }), { action: "deny" });
  });

  it("blocks renderer navigation away from the bundled pages", () => {
    const { contents, logs } = installed();
    assert.strictEqual(navigate(contents, "https://evil.example/phish"), true);
    assert.strictEqual(navigate(contents, "file:///etc/passwd", { urlOnEvent: true }), true);
    assert.strictEqual(logs.length, 2);
    assert.strictEqual(navigate(contents, pageUrl("tutorial.html")), false);
    assert.strictEqual(navigate(contents, pageUrl("bubble.html"), { urlOnEvent: true }), false);
  });

  it("is installed by main.js before the first window is created", () => {
    const source = fs.readFileSync(path.join(SRC_DIR, "main.js"), "utf8");
    const install = source.indexOf('require("./navigation-guard").installNavigationGuard(app, {');
    assert.ok(install > 0, "main.js must install the navigation guard");
    assert.match(source.slice(install, install + 200), /pagesDir: __dirname/);
    // Windows are only created once the app is ready; the guard is registered
    // synchronously while main.js is still being evaluated, ahead of that.
    const ready = source.indexOf("app.whenReady().then(");
    assert.ok(ready > 0 && install < ready, "guard must be installed before app.whenReady().then(...)");
  });
});
