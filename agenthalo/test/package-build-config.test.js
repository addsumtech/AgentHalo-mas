const assert = require("node:assert");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { minimatch } = require("minimatch");

const pkg = require("../package.json");
const ROOT = path.join(__dirname, "..");

// This repository builds only the Mac App Store package: electron-builder
// `--mac mas`, one universal app, signed for the App Sandbox. The upstream
// Windows (NSIS/winget), Linux (AppImage/deb) and Developer ID (DMG/ZIP)
// pipelines are not part of it.

// electron-builder evaluates file patterns in order: a later "!pattern"
// excludes what earlier patterns included.
function matchedByAnyGlob(globs, target) {
  let matched = false;
  for (const glob of globs) {
    const negated = glob.startsWith("!");
    if (matched !== negated) continue;
    if (minimatch(target, negated ? glob.slice(1) : glob)) matched = !negated;
  }
  return matched;
}

// The universal MAS build merges the mac and mas `files` options, and applies
// their exclusions to node_modules as well as app files.
function isPackaged(target) {
  return matchedByAnyGlob([...pkg.build.files, ...(pkg.build.mas.files || [])], target);
}

function readPlistBooleans(relativePath) {
  const xml = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  const entries = {};
  for (const match of xml.matchAll(/<key>([^<]+)<\/key>\s*<(true|false)\/>/g)) {
    entries[match[1]] = match[2] === "true";
  }
  const keyCount = (xml.match(/<key>/g) || []).length;
  assert.strictEqual(Object.keys(entries).length, keyCount, `${relativePath} should hold only boolean entitlements`);
  return entries;
}

describe("Mac App Store configuration", () => {
  it("builds one universal mas target and nothing else", () => {
    assert.deepStrictEqual(pkg.build.mac.target, [{ target: "mas", arch: ["universal"] }]);
    for (const key of ["win", "nsis", "linux", "appImage", "deb", "dmg", "afterPack", "afterSign"]) {
      assert.strictEqual(pkg.build[key], undefined, `build.${key} belongs to a non-store pipeline`);
    }
    for (const script of ["build", "build:mac", "build:mas"]) {
      assert.strictEqual(pkg.scripts[script], "electron-builder --mac mas", script);
    }
    const buildScripts = Object.keys(pkg.scripts).filter((name) => /^build(?::|$)/.test(name));
    assert.deepStrictEqual(buildScripts.sort(), ["build", "build:mac", "build:mas"]);
    assert.match(pkg.devDependencies["@electron/asar"], /^\^3\./);
  });

  it("signs for distribution with the checked-in provisioning profile", () => {
    const mas = pkg.build.mas;
    assert.strictEqual(pkg.build.appId, "com.addsum.agenthalo");
    assert.strictEqual(mas.type, "distribution");
    assert.strictEqual(typeof mas.identity, "string");
    assert.ok(mas.identity.trim().length > 0, "mas.identity should name the distribution certificate");
    assert.strictEqual(mas.provisioningProfile, "build/embedded.provisionprofile");
    const profile = fs.readFileSync(path.join(ROOT, mas.provisioningProfile));
    assert.ok(profile.length > 0, "provisioning profile should not be empty");
    // A signed profile is a CMS blob that embeds the plist naming the app.
    assert.ok(profile.includes(Buffer.from("com.addsum.agenthalo")), "profile should be for com.addsum.agenthalo");
    assert.match(mas.artifactName, /-mas\.\$\{ext\}$/);
  });

  it("signs with minimal App Sandbox entitlements", () => {
    assert.strictEqual(pkg.build.mas.entitlements, "build/entitlements.mas.plist");
    assert.strictEqual(pkg.build.mas.entitlementsInherit, "build/entitlements.mas.inherit.plist");
    assert.deepStrictEqual(readPlistBooleans("build/entitlements.mas.plist"), {
      "com.apple.security.app-sandbox": true,
      // Agent hooks reach the local HTTP server, and the app checks the network.
      "com.apple.security.network.client": true,
      "com.apple.security.network.server": true,
      // Tool config folders the user picks, remembered as security-scoped bookmarks.
      "com.apple.security.files.user-selected.read-write": true,
      "com.apple.security.files.bookmarks.app-scope": true,
    });
    assert.deepStrictEqual(readPlistBooleans("build/entitlements.mas.inherit.plist"), {
      "com.apple.security.app-sandbox": true,
      "com.apple.security.inherit": true,
    });
  });

  it("does not request hardened-runtime or Apple Events exceptions the sandboxed build cannot use", () => {
    assert.strictEqual(pkg.build.mas.hardenedRuntime, false);
    const entitlements = readPlistBooleans("build/entitlements.mas.plist");
    for (const key of [
      "com.apple.security.cs.allow-jit",
      "com.apple.security.cs.allow-unsigned-executable-memory",
      "com.apple.security.cs.disable-library-validation",
      "com.apple.security.automation.apple-events",
      "com.apple.security.temporary-exception.apple-events",
    ]) {
      assert.strictEqual(entitlements[key], undefined, key);
    }
    assert.strictEqual(fs.existsSync(path.join(ROOT, "build", "entitlements.mac.plist")), false,
      "the unused Developer ID entitlements file should not linger next to the MAS ones");
  });

  it("declares only the Info.plist keys the store build needs", () => {
    assert.deepStrictEqual(pkg.build.mac.extendInfo, {
      LSUIElement: true,
      ITSAppUsesNonExemptEncryption: false,
    });
    assert.strictEqual(pkg.build.mac.category, "public.app-category.productivity");
    assert.deepStrictEqual(pkg.build.protocols.flatMap((entry) => entry.schemes), ["agenthalo"]);
  });

  it("updates only through the Mac App Store", () => {
    assert.deepStrictEqual(pkg.build.publish, []);
    assert.deepStrictEqual(pkg.build.extraResources, []);
  });
});

describe("Electron fuses", () => {
  it("locks the packaged binary to the bundled app", () => {
    assert.deepStrictEqual(pkg.build.electronFuses, {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      onlyLoadAppFromAsar: true,
      enableEmbeddedAsarIntegrityValidation: true,
    });
    // onlyLoadAppFromAsar and asar integrity both need an asar archive.
    assert.notStrictEqual(pkg.build.asar, false);
  });

  it("never runs the packaged app binary as Node", () => {
    // Hooks run under the user's own node through hooks/node-launcher.sh, so
    // runAsNode can be off. Any shipped file that sets the variable would now
    // silently start the GUI instead.
    const offenders = [];
    const visit = (dir) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) { visit(rel); continue; }
        if (!/\.(?:c?js|mjs|ts|py|sh)$/.test(entry.name)) continue;
        fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n").forEach((line, index) => {
          if (!line.includes("ELECTRON_RUN_AS_NODE")) return;
          if (/^\s*(?:\/\/|\*|#)/.test(line) || /\bdelete\b/.test(line)) return;
          offenders.push(`${rel}:${index + 1}`);
        });
      }
    };
    for (const dir of ["src", "hooks", "agents", "extensions"]) visit(dir);
    assert.deepStrictEqual(offenders, []);
  });
});

describe("store package contents", () => {
  it("ships project window icons, agent session icons and notices", () => {
    for (const glob of ["assets/icons/**/*", "assets/icons/agents/**/*", "NOTICE.md", "LICENSE"]) {
      assert.ok(pkg.build.files.includes(glob), `build.files should include ${glob}`);
    }
    assert.ok(isPackaged("assets/icons/256x256.png"));
    assert.ok(isPackaged("assets/icons/agents/claude-code.png"));
  });

  it("unpacks built-in themes and accessories so their folders can be opened from settings", () => {
    for (const glob of ["assets/accessories/**/*", "themes/**/*"]) {
      assert.ok(pkg.build.files.includes(glob), `build.files should include ${glob}`);
      assert.ok(pkg.build.asarUnpack.includes(glob), `asarUnpack should include ${glob}`);
    }
    assert.ok(isPackaged("themes/halo/theme.json"));
    assert.ok(isPackaged("themes/halo/assets/idle-follow.svg"));
  });

  it("ships and unpacks runtime files required by external hook scripts", () => {
    for (const glob of ["hooks/**/*", "agents/**/*"]) {
      assert.ok(pkg.build.files.includes(glob), `build.files should include ${glob}`);
      assert.ok(pkg.build.asarUnpack.includes(glob), `asarUnpack should include ${glob}`);
    }
    // Unpacked hooks (the OpenCode-family JSONC helpers) require jsonc-parser
    // from app.asar.unpacked, outside the archive.
    assert.ok(pkg.build.asarUnpack.includes("node_modules/jsonc-parser/**/*"));
  });

  it("keeps the upstream Clawd artwork out of the store package", () => {
    // assets/svg is Anthropic's Clawd character (fan art; assets/LICENSE forbids
    // commercial use). Built-in store themes ship their own assets.
    for (const file of ["assets/svg/clawd-idle-follow.svg", "assets/svg/clawd-about-hero.svg"]) {
      assert.strictEqual(isPackaged(file), false, `${file} must not be packaged`);
      assert.strictEqual(matchedByAnyGlob(pkg.build.asarUnpack, file), false, `${file} must not be unpacked`);
    }
  });

  it("keeps the retired cigarette accessory out for the 4+ age rating", () => {
    assert.strictEqual(isPackaged("assets/accessories/cigarette.svg"), false);
    assert.strictEqual(isPackaged("assets/accessories/halo.svg"), true);
  });

  it("does not package the VS Code/Cursor extension (App Review 2.4.5(ii), 2.5.2)", () => {
    for (const file of ["extensions/vscode/extension.js", "extensions/vscode/package.json"]) {
      assert.strictEqual(isPackaged(file), false, `${file} must not be packaged`);
      assert.strictEqual(matchedByAnyGlob(pkg.build.asarUnpack, file), false, `${file} must not be unpacked`);
    }
  });

  it("keeps Windows-only and source artwork out", () => {
    assert.strictEqual(isPackaged("assets/icon.ico"), false, "the Windows icon is not part of the MAS package");
    assert.strictEqual(isPackaged("assets/source/dock-icon-fullbleed.png"), false, "assets/source/** is never packaged");
    assert.strictEqual(isPackaged("assets/hero.gif"), false);
  });

  it("pins the reviewed Koffi line but keeps it out of the universal MAS package", () => {
    assert.strictEqual(pkg.dependencies.koffi, "2.16.3");
    assert.strictEqual(pkg.build.afterPack, undefined);
    const masExcludes = (pkg.build.mas.files || []).filter((glob) => glob.startsWith("!"));
    for (const packaged of [
      "node_modules/koffi",
      "node_modules/koffi/package.json",
      "node_modules/koffi/build/koffi/darwin_arm64/koffi.node",
      "node_modules/koffi/build/koffi/darwin_x64/koffi.node",
    ]) {
      assert.ok(
        masExcludes.some((glob) => minimatch(packaged, glob.slice(1))),
        `${packaged} must be excluded from the MAS package`
      );
    }
    assert.ok(!masExcludes.some((glob) => minimatch("node_modules/ws/index.js", glob.slice(1))));
    assert.strictEqual(pkg.scripts["audit:native-package"], "node scripts/audit-packaged-native.js");
    assert.strictEqual(pkg.scripts["verify:updater-metadata"], "node scripts/verify-updater-metadata.js");
  });
});

describe("repository asset audit", () => {
  it("exposes the npm audit command", () => {
    assert.strictEqual(pkg.scripts["audit:assets"], "node scripts/audit-repository-assets.js");
  });

  it("runs in pull-request CI and uploads stable JSON manifests", () => {
    const workflowPath = path.join(ROOT, ".github", "workflows", "repository-asset-audit.yml");
    assert.ok(fs.existsSync(workflowPath), "repository asset audit workflow should exist");
    const workflow = fs.readFileSync(workflowPath, "utf8");
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /npm run audit:assets/);
    assert.match(workflow, /test\/preload-settings\.test\.js/);
    assert.match(workflow, /test\/state-agent-icons\.test\.js/);
    for (const testFile of [
      "test/mac-dock-icon-runtime.test.js",
      "test/mac-dock-visibility.test.js",
      "test/mac-tray-icon-assets.test.js",
      "test/main-mac-dock-icon.test.js",
      "test/menu-hide-pet.test.js",
      "test/tray-flash-icon.test.js",
    ]) {
      assert.ok(workflow.includes(testFile), `repository asset audit should run ${testFile}`);
    }
    assert.match(workflow, /dist\/repository-asset-audit\/\*\.json/);
    assert.match(
      workflow,
      /^permissions:\r?\n\s+contents: read$/m,
      "repository asset audit should use a read-only GitHub token",
    );
  });

  it("keeps only store-relevant workflows", () => {
    const workflows = fs.readdirSync(path.join(ROOT, ".github", "workflows")).sort();
    assert.deepStrictEqual(workflows, ["repository-asset-audit.yml"]);
  });
});

describe("retired Telegram sidecar", () => {
  it("starts directly without fetching a retired executable", () => {
    assert.strictEqual(pkg.scripts.start, "node launch.js");
  });

  it("contains no retired scripts, prebuild hooks, or extraResources", () => {
    for (const key of [
      "fetch:sidecars",
      "verify:sidecars",
      "assert:packaged-sidecar",
      "prebuild",
      "prebuild:mac",
      "prebuild:all",
    ]) {
      assert.equal(pkg.scripts[key], undefined, key);
    }
    for (const platform of ["mac", "mas"]) {
      assert.equal(pkg.build[platform].extraResources, undefined, `${platform} should not package a Telegram sidecar`);
    }
  });
});
