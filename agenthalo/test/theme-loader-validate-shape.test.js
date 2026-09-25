const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const themeLoader = require("../src/theme-loader");
const { checkThemeHealth } = require("../src/doctor-detectors/theme-health");
const { collectRequiredAssetFiles } = require("../src/theme-schema");

const tempDirs = [];
const REQUIRED_FILES = [
  "idle.svg",
  "yawning.svg",
  "dozing.svg",
  "collapsing.svg",
  "thinking.svg",
  "working.svg",
  "sleeping.svg",
  "waking.svg",
];

function validThemeJson(overrides = {}) {
  return {
    schemaVersion: 1,
    name: "Test",
    version: "1.0.0",
    viewBox: { x: 0, y: 0, width: 100, height: 100 },
    states: {
      idle: ["idle.svg"],
      yawning: ["yawning.svg"],
      dozing: ["dozing.svg"],
      collapsing: ["collapsing.svg"],
      thinking: ["thinking.svg"],
      working: ["working.svg"],
      sleeping: ["sleeping.svg"],
      waking: ["waking.svg"],
    },
    ...overrides,
  };
}

function makeFixture({ builtinThemes = [], userThemes = [], centralAssets = REQUIRED_FILES } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-theme-shape-"));
  tempDirs.push(tmp);
  const appDir = path.join(tmp, "src");
  const userData = path.join(tmp, "userData");
  fs.mkdirSync(path.join(tmp, "themes"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "assets", "svg"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "assets", "sounds"), { recursive: true });
  fs.mkdirSync(path.join(userData, "themes"), { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  for (const file of centralAssets) {
    fs.writeFileSync(path.join(tmp, "assets", "svg", file), "<svg/>", "utf8");
  }

  function writeTheme(baseRoot, theme) {
    const themeDir = path.join(baseRoot, theme.id);
    fs.mkdirSync(themeDir, { recursive: true });
    fs.writeFileSync(path.join(themeDir, "theme.json"), JSON.stringify(theme.json), "utf8");
    if (theme.assets) {
      const assetsDir = path.join(themeDir, "assets");
      fs.mkdirSync(assetsDir, { recursive: true });
      for (const [file, content] of Object.entries(theme.assets)) {
        fs.writeFileSync(path.join(assetsDir, file), content, "utf8");
      }
    }
  }

  for (const theme of builtinThemes) writeTheme(path.join(tmp, "themes"), theme);
  for (const theme of userThemes) writeTheme(path.join(userData, "themes"), theme);
  themeLoader.init(appDir, userData);
  return { tmp, appDir, userData };
}

function assetMap(files = REQUIRED_FILES) {
  return Object.fromEntries(files.map((file) => [file, "<svg/>"]));
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("validateThemeShape", () => {
  it("validates a built-in theme from its own assets without activating a theme", () => {
    makeFixture({
      builtinThemes: [
        { id: "halo", json: validThemeJson({ name: "Halo" }), assets: assetMap() },
        { id: "other", json: validThemeJson({ name: "Other" }), assets: assetMap() },
      ],
    });
    const loaded = themeLoader.loadTheme("halo", { strict: true });

    const result = themeLoader.validateThemeShape("other");

    assert.strictEqual(result.ok, true);
    assert.strictEqual(loaded._id, "halo");
    assert.strictEqual(themeLoader.getActiveTheme(), null);
  });

  it("does not let the upstream shared assets/svg folder satisfy a built-in theme", () => {
    // makeFixture still writes every required file into <tmp>/assets/svg.
    makeFixture({
      builtinThemes: [
        { id: "halo", json: validThemeJson({ name: "Halo" }), assets: assetMap() },
        { id: "bare", json: validThemeJson({ name: "Bare" }) },
      ],
    });

    const result = themeLoader.validateThemeShape("bare");

    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((error) => /missing asset: idle\.svg/.test(error)), result.errors.join("; "));
  });

  it("validates external theme assets from source without creating theme cache", () => {
    const fixture = makeFixture({
      builtinThemes: [{ id: "clawd", json: validThemeJson({ name: "Clawd" }) }],
      userThemes: [{
        id: "user-theme",
        json: validThemeJson({ name: "User Theme" }),
        assets: assetMap(),
      }],
    });
    const cacheDir = path.join(fixture.userData, "theme-cache");

    const result = themeLoader.validateThemeShape("user-theme");

    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.existsSync(cacheDir), false);
  });

  it("reports missing assets introduced by a variant", () => {
    makeFixture({
      builtinThemes: [{
        id: "clawd",
        json: validThemeJson({
          name: "Clawd",
          variants: {
            broken: {
              workingTiers: [{ minSessions: 2, file: "missing.svg" }],
            },
          },
        }),
      }],
    });

    const result = themeLoader.validateThemeShape("clawd", { variant: "broken" });

    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("missing.svg")));
  });

  it("reports override-introduced missing assets", () => {
    makeFixture({
      builtinThemes: [{ id: "clawd", json: validThemeJson({ name: "Clawd" }) }],
    });

    const result = themeLoader.validateThemeShape("clawd", {
      overrides: { states: { idle: { file: "missing-override.svg" } } },
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("missing-override.svg")));
  });
});

describe("checkThemeHealth", () => {
  it("wraps validateThemeShape into a doctor check", () => {
    const result = checkThemeHealth({
      prefs: { theme: "clawd" },
      validateThemeShape: () => ({ ok: true, errors: [], resolvedVariant: "default" }),
    });

    assert.strictEqual(result.status, "pass");
    assert.strictEqual(result.level, null);
  });

  it("warns when validateThemeShape fails", () => {
    const result = checkThemeHealth({
      prefs: { theme: "bad" },
      validateThemeShape: () => ({ ok: false, errors: ["missing asset"] }),
    });

    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.level, "warning");
    assert.match(result.detail, /missing asset/);
    assert.strictEqual(result.fixAction, undefined);
    assert.match(result.textHint, /Settings -> Theme/);
    assert.match(result.textHint, /'halo'/);
  });

  it("checks the bundled halo theme when no theme is chosen", () => {
    let checked = null;
    const result = checkThemeHealth({
      prefs: {},
      validateThemeShape: (themeId) => {
        checked = themeId;
        return { ok: true, errors: [], resolvedVariant: "default" };
      },
    });

    assert.strictEqual(checked, "halo");
    assert.strictEqual(result.themeId, "halo");
  });
});

describe("built-in store themes", () => {
  const ROOT = path.join(__dirname, "..");

  it("load and validate from their own assets without the upstream Clawd artwork", () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-builtin-themes-"));
    tempDirs.push(userData);
    themeLoader.init(path.join(ROOT, "src"), userData);
    const builtins = themeLoader.discoverThemes().filter((theme) => theme.builtin);
    assert.ok(builtins.some((theme) => theme.id === themeLoader.DEFAULT_THEME_ID), "halo must ship");
    assert.ok(builtins.length > 1);

    for (const { id } of builtins) {
      const theme = themeLoader.loadTheme(id, { strict: true });
      const themeAssetsDir = path.join(ROOT, "themes", id, "assets");
      assert.strictEqual(theme._assetsDir, themeAssetsDir, id);
      const context = themeLoader.createThemeContext(theme);
      assert.strictEqual(context.getRendererConfig().assetsPath, `../themes/${id}/assets`, id);
      const validation = themeLoader.validateThemeShape(id);
      assert.deepStrictEqual(validation.errors, [], id);
      const required = collectRequiredAssetFiles(theme);
      assert.ok(required.length > 0, id);
      for (const file of required) {
        const resolved = context.resolveAssetPath(file);
        assert.ok(resolved.startsWith(themeAssetsDir + path.sep), `${id}: ${file} resolved to ${resolved}`);
        assert.ok(!/[\\/]assets[\\/]svg[\\/]/.test(resolved), `${id}: ${file} uses assets/svg`);
      }
    }
  });

  it("falls back to halo without an active theme", () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-builtin-themes-"));
    tempDirs.push(userData);
    themeLoader.init(path.join(ROOT, "src"), userData);
    assert.strictEqual(themeLoader.getRendererAssetsPath(), "../themes/halo/assets");
    assert.strictEqual(themeLoader.loadTheme("clawd")._id, "halo");
    const context = themeLoader.createThemeContext(null);
    const idle = context.resolveAssetPath("idle-follow.svg");
    assert.strictEqual(idle, path.join(ROOT, "themes", "halo", "assets", "idle-follow.svg"));
    assert.ok(fs.existsSync(idle));
  });
});
