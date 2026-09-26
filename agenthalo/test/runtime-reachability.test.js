"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { minimatch } = require("minimatch");

const {
  REVIEWED_OPTIONAL_DEPENDENCY_EXCLUDES,
  analyzeRuntimeReachability,
  classifyBuildExcludes,
  isPackagedByBuildFiles,
  scanSource,
  verifyBuildExcludes,
} = require("../scripts/audit-runtime-reachability");

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const matchGlob = (file, glob) => minimatch(file, glob, { dot: true });

// Static assets excluded from the package after a manual review. The audit
// proves nothing reachable names them, but it cannot see a directory the
// runtime enumerates, so a new asset exclude must be reviewed and added here.
// pwa/ and assets/svg/ are never included in the store build, so the only
// asset exclude is the retired accessory inside an included folder.
const REVIEWED_ASSET_EXCLUDES = ["!assets/accessories/cigarette.svg"];

function writeFiles(root, files) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
}

function makeFixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reachability-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFiles(root, files);
  return root;
}

describe("runtime reachability of the packaged app", () => {
  const report = analyzeRuntimeReachability({ root: ROOT });

  it("starts from main, every preload, every HTML script and the external agents/hooks trees", () => {
    assert.ok(report.entryPoints.includes("src/main.js"));
    for (const file of fs.readdirSync(path.join(ROOT, "src"))) {
      if (/^preload.*\.js$/.test(file)) assert.ok(report.entryPoints.includes(`src/${file}`), file);
    }
    assert.ok(report.entryPoints.includes("src/settings-tab-general.js"), "settings.html <script src>");
    assert.ok(report.entryPoints.includes("hooks/clawd-hook.js"));
    assert.ok(report.entryPoints.includes("agents/codex-log-monitor.js"));
  });

  it("follows files the app loads by path rather than by require", () => {
    const reachable = new Set(report.reachableSrc);
    for (const file of [
      "src/web-bridge-check-worker.js", // utilityProcess.fork(path.join(__dirname, ...))
      "src/settings.html",
      "src/settings.css",
      "src/index.html",
      "src/user-data-migration.js",
    ]) {
      assert.ok(reachable.has(file), `${file} must be reachable`);
    }
  });

  it("proves every build.files exclude safe: no reachable src file, required package or referenced asset", () => {
    assert.ok(report.dependencies.nodeModulesPresent, "node_modules is required to check dependency excludes");
    for (const name of report.dependencies.used) {
      assert.ok(fs.existsSync(path.join(ROOT, "node_modules", name, "package.json")), `${name} must be installed`);
    }
    assert.deepEqual(verifyBuildExcludes(report, pkg.build, matchGlob), []);
  });

  it("keeps each exclude to a shape the audit understands", () => {
    const excludes = classifyBuildExcludes(pkg.build.files);
    assert.deepEqual(excludes.other.map((entry) => entry.pattern).sort(), [...REVIEWED_ASSET_EXCLUDES].sort());
    for (const { pattern, glob } of excludes.src) {
      assert.ok(!/[*?{[]/.test(glob), `${pattern} must name one file so a new module is never excluded by accident`);
    }
    const negated = pkg.build.files.filter((entry) => entry.startsWith("!"));
    const lastPositive = pkg.build.files.map((entry) => !entry.startsWith("!")).lastIndexOf(true);
    assert.ok(pkg.build.files.indexOf(negated[0]) > lastPositive, "excludes come after every include");
  });

  it("excludes exactly the unreachable retired-feature modules", () => {
    const excluded = classifyBuildExcludes(pkg.build.files).src.map((entry) => entry.glob).sort();
    // Build-time contract read by scripts/after-pack-koffi.js and the native
    // package audit; not a retired feature, so it stays packaged.
    const keptUnreachable = ["src/koffi-package-contract.js"];
    assert.deepEqual(excluded, report.unreachableSrc.filter((file) => !keptUnreachable.includes(file)));
    for (const file of excluded) {
      assert.match(
        file,
        /(?:remote-ssh|telegram|feishu|slack|discord|mobile|session-automation-remote)/,
        `${file} should belong to a retired feature`,
      );
      assert.equal(isPackagedByBuildFiles(file, pkg.build.files, matchGlob), false, `${file} must not be packaged`);
    }
  });

  it("drops the unused production dependencies but keeps them declared for retired-feature tests", () => {
    const excludedDeps = new Set(classifyBuildExcludes(pkg.build.files).dependencies.map((entry) => entry.name));
    for (const name of ["@larksuiteoapi/node-sdk", "electron-updater", "markdown-it", "ws"]) {
      assert.ok(report.dependencies.unused.includes(name), `${name} is not required by reachable code`);
      assert.ok(excludedDeps.has(name), `${name} should not be packaged`);
      assert.ok(pkg.dependencies[name], `${name} stays declared`);
    }
    for (const name of report.dependencies.used) {
      if (REVIEWED_OPTIONAL_DEPENDENCY_EXCLUDES[name]) {
        assert.ok(excludedDeps.has(name), `${name} is reviewed as left out of the store package`);
        continue;
      }
      assert.equal(excludedDeps.has(name), false, `${name} is required at run time`);
    }
    assert.deepEqual(report.dependencies.used, ["dom-serializer", "htmlparser2", "jsonc-parser", "koffi"]);
  });

  it("declares every package that reachable code requires", () => {
    // theme-sanitizer.js requires dom-serializer directly; relying on it
    // being hoisted from htmlparser2's tree breaks when that tree changes.
    assert.deepEqual(report.dependencies.undeclared, []);
  });
});

describe("runtime reachability scanner", () => {
  it("tells require calls from require text in comments, strings and regular expressions", () => {
    const scan = scanSource([
      "// require(\"./commented\")",
      "/* require('./blocked') */",
      "const text = \"require('./quoted')\";",
      "const re = /require\\(\"x\"\\)/g; const ratio = a / b / c;",
      "const tpl = `nested ${`inner`} require(\"./in-template\")`;",
      "const real = require(\"./real\");",
      "const lazy = () => require('../lazy');",
      "const resolved = require.resolve(\"./resolved\");",
    ].join("\n"));
    assert.deepEqual(scan.requires.filter((r) => !r.textOnly).map((r) => r.specifier).sort(), ["../lazy", "./real", "./resolved"]);
    // Text that only looks like a require still counts, conservatively.
    assert.deepEqual(
      scan.requires.filter((r) => r.textOnly).map((r) => r.specifier).sort(),
      ["./blocked", "./commented", "./in-template", "./quoted"],
    );
    assert.deepEqual(scan.dynamic, []);
  });

  it("lists non-literal requires and computed file names", () => {
    const scan = scanSource([
      "const name = pick();",
      "require(path.join(__dirname, name));",
      "require(`./tabs/${name}`);",
      "const file = `settings-tab-${name}.js`;",
    ].join("\n"));
    assert.equal(scan.dynamic.length, 2);
    assert.match(scan.dynamic[0].expression, /^require\(path\.join/);
    assert.deepEqual(scan.computed.map((c) => c.parts), [["./tabs/", ""], ["settings-tab-", ".js"]]);
  });

  it("treats non-literal requires, string paths and computed names conservatively", (t) => {
    const root = makeFixture(t, {
      "package.json": { main: "src/main.js", dependencies: {} },
      "src/main.js": [
        "require('./loader/index');",
        "const worker = path.join(__dirname, 'worker.js');",
        "const page = 'page.html';",
        "const tab = `tab-${id}.js`;",
        "const nested = path.join(__dirname, 'deep', 'by-name.js');",
      ].join("\n"),
      "src/loader/index.js": "module.exports = (name) => require(`./plugins/${name}`);",
      "src/loader/plugins/a.js": "",
      "src/worker.js": "",
      "src/page.html": "<script src=\"page-script.js\"></script><link rel=\"stylesheet\" href=\"page.css\">",
      "src/page-script.js": "",
      "src/page.css": "@import url('base.css');",
      "src/base.css": "",
      "src/tab-general.js": "",
      "src/deep/by-name.js": "",
      "src/dead.js": "require('./also-dead');",
      "src/also-dead.js": "",
    });
    const report = analyzeRuntimeReachability({ root });
    assert.deepEqual(report.unreachableSrc, ["src/also-dead.js", "src/dead.js"]);
    assert.equal(report.dynamicRequires.length, 1);
    assert.equal(report.dynamicRequires[0].file, "src/loader/index.js");
    assert.equal(report.dynamicRequires[0].staticPrefix, "./plugins/");
    assert.match(report.reachedVia["src/loader/plugins/a.js"], /non-literal require/);
    assert.match(report.reachedVia["src/tab-general.js"], /computed file name/);
    assert.match(report.reachedVia["src/deep/by-name.js"], /file name "by-name.js"/);
    assert.match(report.reachedVia["src/base.css"], /@import/);
  });

  it("keeps every src file when a require has no static prefix", (t) => {
    const root = makeFixture(t, {
      "package.json": { main: "src/main.js" },
      "src/main.js": "const load = (name) => require(name);",
      "src/anything.js": "",
      "src/deep/else.js": "",
    });
    const report = analyzeRuntimeReachability({ root });
    assert.deepEqual(report.unreachableSrc, []);
    assert.equal(report.dynamicRequires[0].staticPrefix, null);
    assert.deepEqual(
      verifyBuildExcludes(report, { files: ["src/**/*", "!src/anything.js"] }, matchGlob),
      ["!src/anything.js excludes src/anything.js, which is reachable (non-literal require in src/main.js:1)"],
    );
  });

  it("separates unused dependencies and the packages only they pull in", (t) => {
    const root = makeFixture(t, {
      "package.json": { main: "src/main.js", dependencies: { kept: "1", unused: "1" } },
      "src/main.js": "require('kept/sub'); require('electron'); require('node:fs'); require('fs/promises');",
      "node_modules/kept/package.json": { name: "kept", dependencies: { shared: "1" } },
      "node_modules/unused/package.json": { name: "unused", dependencies: { shared: "1", only: "1" } },
      "node_modules/unused/node_modules/nested-only/package.json": { name: "nested-only" },
      "node_modules/only/package.json": { name: "only", dependencies: { "nested-only": "1" } },
      "node_modules/shared/package.json": { name: "shared" },
    });
    const report = analyzeRuntimeReachability({ root });
    assert.deepEqual(report.dependencies.used, ["kept"]);
    assert.deepEqual(report.dependencies.unused, ["unused"]);
    assert.deepEqual(report.dependencies.exclusivelyTransitive, ["only"]);
    assert.ok(report.dependencies.usedClosure.includes("shared"));

    const problems = verifyBuildExcludes(report, {
      files: [
        "src/**/*",
        "!src/main.js",
        "!**/node_modules/unused{,/**/*}",
        "!**/node_modules/only{,/**/*}",
        "!**/node_modules/shared{,/**/*}",
        "!**/node_modules/kept{,/**/*}",
      ],
    }, matchGlob);
    assert.deepEqual(problems, [
      "!src/main.js excludes src/main.js, which is reachable (entry point)",
      "!**/node_modules/shared{,/**/*} excludes shared, which a shipped dependency needs",
      "!**/node_modules/kept{,/**/*} excludes kept, which reachable code requires (src/main.js:1)",
    ]);
  });

  it("refuses an asset exclude that reachable code still names", (t) => {
    const root = makeFixture(t, {
      "package.json": { main: "src/main.js" },
      "src/main.js": "const dir = path.join(__dirname, '..', 'pwa');\nconst icon = 'unique-icon.png';",
      "pwa/index.html": "",
      "assets/icons/unique-icon.png": "",
      "assets/icons/shared.png": "",
      "assets/other/shared.png": "",
    });
    const report = analyzeRuntimeReachability({ root });
    const build = { files: ["src/**/*", "pwa/**/*", "assets/**/*", "!pwa/**/*", "!assets/icons/**/*"] };
    assert.deepEqual(verifyBuildExcludes(report, build, matchGlob), [
      "!pwa/**/* excludes \"pwa\", referenced by src/main.js:1 (path)",
      "!assets/icons/**/* excludes \"unique-icon.png\", referenced by src/main.js:2 (file name)",
    ], "shared.png also ships from assets/other, so naming it proves nothing");
  });
});
