#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

function hashIdentityEmail(email) {
  return crypto.createHash("sha256")
    .update(String(email || "").trim().toLowerCase())
    .digest("hex");
}

// 键是邮箱的 SHA-256，不是明文。这张表只需要把提交邮箱归到 GitHub
// 用户名，哈希一样能做到；而明文放在公开仓库里，等于替贡献者把他们的
// 私人邮箱挂出去让人爬。值为 null 表示这个身份不计入贡献者（机器人、
// 上游作者本人）。
//
// 新增条目：
//   node -e 'console.log(require("node:crypto").createHash("sha256").update("邮箱".toLowerCase()).digest("hex"))'
const IDENTITY_OVERRIDES = new Map(Object.entries({
  // Addsum's public maintenance identity is not an external contributor.
  "b649cc55e0c0a8a90201392300457ad7e43c3543370ce19dfeb3766b642dd3cd": null,
  "29773bb4e96017104e88562bec5d9c3d40f2a730f21f6680e2284fe884386ee0": null,
  "0b4a1ece3482458a77bfec095ff93dc3b5fb8fe4ec391415daff6f6ed222ad2b": null,
  "c4c9cc242c936acbd2b31fee72627ac05d0a1622eda8b1447fede08c3092c06d": null,
  "cd29c5ac348a026a3ec5286890908fffb5bf6ab77f20672171be323a70c95026": null,
  "977b50ebc846e49381bac70991fac4cc5630d3a2d6d33db7b39d6c5163afc9ff": "CheeseAgent",
  "0bfde9b91c4b10c54d4347d26741fc397d0c489b35e0da9129119d5e539b42a8": "wang4433",
  "cd26c972804b238fb9368c577825d8a554b8659f001fc03cc5810b80eb80cfca": "shengmai-justin",
  "164aa36d1a53c64b731dac3da8852a1bd97fa8fbba1993abcf8ff548873a1563": "liugou27",
  "7061b7ae98e3e073efdc1359cf034ca61188744246e0b5597ee5ac92605c663d": "chrono-meta",
  "827e643f58432917abec31f351f05b7c8fe0db294ee28ec9a4e5beb9c90bb514": "Zamaniego",
  "ca88c76230c48c0435b80f94dd575144033052ce991834faf589fb898e4030ff": "KaiC5504",
  "d5f32fe83d6d77fd3af4f98abff126f51c3da505bec836c83f8d002fc01c1311": "YOIMIYA66",
  "a16c9c8f22c6f72878db4091e87d2d1e4c2c09c13af14572cf9c9fd46cf79396": "xiaoshidefeng",
  "a723461d724977fde7d34fefa98a9af29c8d5b86a39cc43fd364222674942dc6": "draintovmasyan783-creator",
  "ed7a970736e6a1c9c75a89de896b0167b7dcf84187ad7e0cfb0a468310f53a3d": "draintovmasyan783-creator",
}));

function parseVersion(value) {
  const match = String(value || "").match(/^v?(\d+)\.(\d+)\.(\d+)(?:-|$)/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function previousReleaseTag(version, tags) {
  const current = parseVersion(version);
  if (!current) return "";
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => ({ tag: String(tag).trim(), version: parseVersion(tag) }))
    .filter((entry) => entry.tag && entry.version && compareVersion(entry.version, current) < 0)
    .sort((left, right) => compareVersion(right.version, left.version))[0]?.tag || "";
}

// overrides 可注入，测试因此不必把真实邮箱写进用例里。
function githubHandleForIdentity(name, email, overrides = IDENTITY_OVERRIDES) {
  const rawEmail = String(email || "").trim();
  const key = hashIdentityEmail(rawEmail);
  if (overrides.has(key)) return overrides.get(key);
  const noreply = rawEmail.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
  if (noreply) return noreply[1];
  return undefined;
}

function parseReleaseIdentities(logText) {
  const identities = [];
  for (const record of String(logText || "").split("\x1e")) {
    if (!record.trim()) continue;
    const [email = "", name = "", ...bodyParts] = record.replace(/^\n/, "").split("\x00");
    identities.push({ name: name.trim(), email: email.trim(), source: "author" });
    const body = bodyParts.join("\x00");
    for (const match of body.matchAll(/^Co-Authored-By:\s*(.*?)\s*<([^>]+)>\s*$/gim)) {
      identities.push({ name: match[1].trim(), email: match[2].trim(), source: "co-author" });
    }
  }
  return identities;
}

function loadSettingsContributors(root) {
  const source = fs.readFileSync(path.join(root, "src", "settings-i18n.js"), "utf8");
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "settings-i18n.js" });
  return Array.from(context.ClawdSettingsI18n.CONTRIBUTORS || []);
}

function verifyReleaseContributors(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const version = options.version || JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const runGit = options.runGit || ((args) => execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
  const errors = [];
  let tags = [];
  try {
    tags = runGit(["tag", "--list", "v*"]).split(/\r?\n/).filter(Boolean);
  } catch (err) {
    return { ok: false, version, previousTag: "", handles: [], errors: [`could not read release tags: ${err.message}`] };
  }
  const previousTag = previousReleaseTag(version, tags);
  if (!previousTag) {
    return { ok: false, version, previousTag: "", handles: [], errors: [`no previous release tag found before v${version}`] };
  }

  let logText = "";
  try {
    logText = runGit(["log", `${previousTag}..HEAD`, "--format=%aE%x00%aN%x00%B%x1e"]);
  } catch (err) {
    return { ok: false, version, previousTag, handles: [], errors: [`could not inspect ${previousTag}..HEAD: ${err.message}`] };
  }

  const handles = new Set();
  for (const identity of parseReleaseIdentities(logText)) {
    const handle = githubHandleForIdentity(identity.name, identity.email);
    if (handle === undefined) {
      errors.push(`unmapped ${identity.source} identity: ${identity.name} <${identity.email}>`);
    } else if (handle) {
      handles.add(handle);
    }
  }

  const contributors = new Set(loadSettingsContributors(root).map((value) => String(value).toLowerCase()));
  for (const handle of handles) {
    if (!contributors.has(handle.toLowerCase())) {
      errors.push(`release contributor @${handle} is missing from Settings About / README contributor lists`);
    }
  }

  return {
    ok: errors.length === 0,
    version,
    previousTag,
    handles: [...handles].sort((left, right) => left.localeCompare(right)),
    errors,
  };
}

function main() {
  const result = verifyReleaseContributors();
  if (!result.ok) {
    for (const error of result.errors) console.error(`Release contributor verification failed: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Release contributor contract OK: ${result.previousTag}..HEAD (${result.handles.length} external contributors)`,
  );
}

if (require.main === module) main();

module.exports = {
  hashIdentityEmail,
  githubHandleForIdentity,
  parseReleaseIdentities,
  previousReleaseTag,
  verifyReleaseContributors,
};
