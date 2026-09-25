"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { minimatch } = require("minimatch");

const {
  analyzeRuntimeReachability,
  scanSource,
  verifyBuildExcludes,
} = require("../scripts/audit-runtime-reachability");

const matchGlob = (file, glob) => minimatch(file, glob, { dot: true });

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
