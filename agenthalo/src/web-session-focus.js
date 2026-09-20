"use strict";

const { execFile } = require("child_process");
const { getSessionFocusTarget } = require("./session-focus");
const { sanitizeFocusError } = require("./session-focus-handoff");

// Run inside macOS's JXA runtime. URLs are argv data, never executable script.
// Only inspect running browsers; never launch one just to search its tabs.
const BROWSER_FOCUS_SCRIPT = String.raw`
function run(argv) {
  function key(url) {
    var raw = String(url || "");
    var base = raw.split(/[?#]/)[0].replace(/\/$/, "")
      .replace(/^https:\/\/chat\.openai\.com\//, "https://chatgpt.com/");
    var param = /^https:\/\/claude\.ai(?:\/|$)/.test(base) ? "incognito"
      : /^https:\/\/chatgpt\.com(?:\/|$)/.test(base) ? "temporary-chat" : null;
    var query = raw.split("?")[1];
    var match = param && query && query.split("#")[0].match(new RegExp("(?:^|&)" + param + "(?:=([^&]*))?(?:&|$)"));
    return base + (match ? "?" + param + "=" + (match[1] || "") : "");
  }
  var target = key(argv[0]);
  var preferredId = Number(argv[1]) || 0;
  var browserIds = ["com.google.Chrome", "com.microsoft.edgemac", "com.brave.Browser",
    "org.chromium.Chromium", "com.vivaldi.Vivaldi", "com.apple.Safari"];
  var errors = [];
  for (var b = 0; b < browserIds.length; b++) {
    var browser;
    try {
      browser = Application(browserIds[b]);
      if (!browser.running()) continue;
    } catch (_) { continue; }
    try {
      var windows = browser.windows();
      var match = null;
      for (var w = 0; w < windows.length; w++) {
        var tabs = windows[w].tabs();
        for (var t = 0; t < tabs.length; t++) {
          if (key(tabs[t].url()) !== target) continue;
          var candidate = { window: windows[w], tab: tabs[t], index: t + 1 };
          if (!match || (preferredId && Number(tabs[t].id()) === preferredId)) match = candidate;
        }
      }
      if (!match) continue;
      if (browserIds[b] === "com.apple.Safari") match.window.currentTab = match.tab;
      else match.window.activeTabIndex = match.index;
      try { match.window.minimized = false; } catch (_) {}
      match.window.index = 1;
      browser.activate();
      return JSON.stringify({ status: "focused", browser: browserIds[b] });
    } catch (error) {
      errors.push({ browser: browserIds[b], code: error.errorNumber || 0 });
    }
  }
  return JSON.stringify({ status: errors.length ? "unavailable" : "not-found", errors: errors });
}
`;

const inFlight = new Map();

function focusWebSessionTarget({
  url,
  sessionId = "",
  shell,
  platform = process.platform,
  execFileImpl = execFile,
  focusLog = () => {},
  onUnavailable = () => {},
}) {
  const target = getSessionFocusTarget({ id: "web-focus", platform: "webui", cwd: url });
  if (!target.canFocus || !shell || typeof shell.openExternal !== "function") {
    return Promise.resolve({ status: "invalid" });
  }
  if (inFlight.has(target.url)) return inFlight.get(target.url);
  const pending = (async () => {
    try {
      if (platform === "darwin") {
        const tabId = String(sessionId).match(/(?:^|:)web-(\d+)-/);
        const result = await new Promise((resolve, reject) => {
          execFileImpl("/usr/bin/osascript", ["-l", "JavaScript", "-e", BROWSER_FOCUS_SCRIPT,
            "--", target.url, tabId ? tabId[1] : "0"],
          { timeout: 20000, encoding: "utf8", maxBuffer: 16384 }, (err, stdout) => {
            if (err) return reject(err);
            try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
          });
        });
        if (result.status === "focused") {
          focusLog(`focus result branch=web-chat reason=existing-tab browser=${result.browser} sid=${sessionId}`);
          return result;
        }
        // Failed enumeration is not evidence that no tab exists. Avoid opening
        // duplicate tabs when Automation permission is denied or a probe fails.
        if (result.status !== "not-found") throw new Error(`browser-search-${result.status}`);
      }
      await shell.openExternal(target.url);
      focusLog(`focus result branch=web-chat reason=opened sid=${sessionId}`);
      return { status: "opened" };
    } catch (error) {
      focusLog(`focus result branch=web-chat reason=unavailable sid=${sessionId} error=${sanitizeFocusError(error)}`);
      onUnavailable(error);
      return { status: "unavailable" };
    }
  })();
  inFlight.set(target.url, pending);
  pending.finally(() => inFlight.delete(target.url));
  return pending;
}

module.exports = { focusWebSessionTarget, BROWSER_FOCUS_SCRIPT };
