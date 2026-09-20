"use strict";

const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const RELEASES_URL = "https://api.github.com/repos/addsumtech/AgentHalo/releases?per_page=100";
const BRIDGE_NAME = /^(?:AgentHalo|Clawd) Web Bridge$/i;
const VERSION = /^\d+\.\d+\.\d+$/;

function browserRoots(platform, home, env = process.env) {
  if (platform === "darwin") return [
    ["Chrome", path.join(home, "Library/Application Support/Google/Chrome")],
    ["Edge", path.join(home, "Library/Application Support/Microsoft Edge")],
  ];
  if (platform === "win32") return [
    ["Chrome", path.join(env.LOCALAPPDATA || path.join(home, "AppData/Local"), "Google/Chrome/User Data")],
    ["Edge", path.join(env.LOCALAPPDATA || path.join(home, "AppData/Local"), "Microsoft/Edge/User Data")],
  ];
  return [
    ["Chrome", path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "google-chrome")],
    ["Edge", path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "microsoft-edge")],
  ];
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

async function boundedRead(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("read timed out"), { code: "ETIMEDOUT" })), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function detectInstallations({ roots = browserRoots(process.platform, os.homedir()), fileSystem = fs, readTimeoutMs = 1500 } = {}) {
  const installations = [];
  let unreadable = false;
  for (const [browser, root] of roots) {
    let profiles;
    try { profiles = await boundedRead(() => fileSystem.readdir(root), readTimeoutMs); }
    catch (error) { if (error.code !== "ENOENT") unreadable = true; continue; }
    for (const profile of profiles.filter((name) => name === "Default" || /^Profile \d+$/.test(name))) {
      const entries = {};
      for (const filename of ["Preferences", "Secure Preferences"]) {
        try {
          const prefs = JSON.parse(await boundedRead(() => fileSystem.readFile(path.join(root, profile, filename), "utf8"), readTimeoutMs));
          for (const [id, entry] of Object.entries(prefs.extensions?.settings || {})) entries[id] = { ...entries[id], ...entry };
        } catch (error) { if (error.code !== "ENOENT") unreadable = true; }
      }
      for (const entry of Object.values(entries)) {
        const knownPath = /(?:agenthalo|clawd)-web-bridge[\\/]extension(?:[\\/]?)$/i.test(entry.path || "");
        let manifest = entry.manifest;
        let fileStatus = null;
        if (!manifest && entry.path) {
          const manifestPath = path.join(path.isAbsolute(entry.path) ? entry.path : path.join(root, profile, entry.path), "manifest.json");
          try { manifest = JSON.parse(await boundedRead(() => fileSystem.readFile(manifestPath, "utf8"), readTimeoutMs)); }
          catch (error) {
            fileStatus = error.code === "ENOENT" ? "missing-files" : "unreadable";
            if (fileStatus === "unreadable") unreadable = true;
          }
        }
        if (!BRIDGE_NAME.test(manifest?.name || "") && !knownPath) continue;
        const version = VERSION.test(manifest?.version || "") ? manifest.version : null;
        installations.push({ browser, profile, version, status: !manifest ? fileStatus || "missing-files" : entry.state === 0 || (Array.isArray(entry.disable_reasons) && entry.disable_reasons.length > 0) ? "disabled" : "installed" });
      }
    }
  }
  return { installations, unreadable };
}

async function checkWebBridgeStatus({ fetchImpl = globalThis.fetch, timeoutMs = 8000, ...options } = {}) {
  const local = await detectInstallations(options);
  const controller = new AbortController();
  let timer;
  let latestVersion = null;
  const readLatest = async () => {
    const response = await fetchImpl(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "AgentHalo" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const releases = await response.json();
    let latest = null;
    for (const release of Array.isArray(releases) ? releases : []) {
      if (release.draft || release.prerelease || !release.assets?.some((asset) => asset.name === "AgentHalo-Web-Bridge.zip")) continue;
      const version = /^web-bridge-v(\d+\.\d+\.\d+)$/.exec(release.tag_name || "")?.[1];
      if (version && (!latest || compareVersions(version, latest) > 0)) latest = version;
    }
    return latest;
  };
  try {
    // Bound both the request and body read even if a transport ignores abort.
    latestVersion = await Promise.race([
      readLatest(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch { /* Keep local results when GitHub is unavailable. */ }
  finally { clearTimeout(timer); controller.abort(); }
  return { ...local, latestVersion, checkedAt: Date.now() };
}

module.exports = { browserRoots, compareVersions, detectInstallations, checkWebBridgeStatus };
