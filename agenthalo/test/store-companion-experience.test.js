"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const themeLoader = require("../src/theme-loader");
const createThemeContext = require("../src/theme-context");
const { collectRequiredAssetFiles } = require("../src/theme-schema");
const {
  buildStateBindings,
  resolveVisualBinding,
  getWorkingSvg,
  getJugglingSvg,
} = require("../src/state-visual-resolver");

const ROOT = path.join(__dirname, "..");
themeLoader.init(path.join(ROOT, "src"));

describe("store companions retain the full desktop interaction experience", () => {
  const companions = themeLoader.discoverThemes();

  it("loads all 18 companions with distinct task, recovery and walking visuals", () => {
    assert.equal(companions.length, 18);
    for (const { id } of companions) {
      const theme = themeLoader.loadTheme(id, { strict: true });
      const bindings = buildStateBindings(theme);
      const states = ["idle", "thinking", "working", "juggling", "error", "attention", "notification", "sleeping", "waking", "roam"];
      const files = states.map((state) => resolveVisualBinding(state, bindings));
      assert.equal(new Set(files).size, states.length, `${id}: task states must not collapse to idle or completion`);
      assert.ok(createThemeContext(theme).getRendererConfig().hasRoamVisual, `${id}: walking must use its own visual`);
    }
  });

  it("selects different visuals for one, two and three active tasks and for subagents", () => {
    for (const { id } of companions) {
      const theme = themeLoader.loadTheme(id, { strict: true });
      const taskFiles = [1, 2, 3].map((count) => getWorkingSvg({
        theme,
        stateSvgs: theme.states,
        sessions: new Map(Array.from({ length: count }, (_, index) => [index, { state: "working" }])),
      }));
      assert.equal(new Set(taskFiles).size, 3, `${id}: multi-task tiers should be visible`);
      const subagentFile = getJugglingSvg({
        theme,
        stateSvgs: theme.states,
        sessions: new Map([["parent", { state: "juggling" }]]),
      });
      assert.ok(!taskFiles.includes(subagentFile), `${id}: subagents need a separate visual`);
    }
  });

  it("exposes click, double-click and drag reactions to the input window and two timed idle actions", () => {
    for (const { id } of companions) {
      const theme = themeLoader.loadTheme(id, { strict: true });
      const context = createThemeContext(theme);
      const { reactions } = context.getHitRendererConfig();
      assert.equal(reactions.clickLeft.duration, 2500, id);
      assert.equal(reactions.clickRight.duration, 2500, id);
      assert.equal(reactions.double.duration, 3000, id);
      assert.equal(new Set([reactions.clickLeft.file, reactions.double.files[0], reactions.drag.file]).size, 3, id);
      assert.equal(context.getRendererConfig().dragSvg, reactions.drag.file, id);
      assert.deepEqual(theme.idleAnimations.map((entry) => entry.duration), [4000, 8000], id);
      assert.equal(new Set(theme.idleAnimations.map((entry) => entry.file)).size, 2, id);
    }
  });

  it("ships 17 distinct local SVGs per companion, with every runtime reference covered", () => {
    for (const { id } of companions) {
      const theme = themeLoader.loadTheme(id, { strict: true });
      const context = createThemeContext(theme);
      const assetsDir = path.join(ROOT, "themes", id, "assets");
      const assets = fs.readdirSync(assetsDir).filter((file) => file.endsWith(".svg"));
      assert.equal(assets.length, 17, id);
      const hashes = new Set();
      for (const file of collectRequiredAssetFiles(theme)) {
        assert.ok(fs.existsSync(context.resolveAssetPath(file)), `${id}: missing ${file}`);
      }
      for (const file of assets) {
        const svg = fs.readFileSync(path.join(assetsDir, file), "utf8");
        hashes.add(crypto.createHash("sha256").update(svg).digest("hex"));
        assert.match(svg, /viewBox="-15 -25 45 45"/, `${id}/${file}: consistent scale`);
        const parts = ["body-js", "shadow-js"];
        // Eye tracking runs on idle only; other full-edition poses can keep
        // their eyes inside an animated head rather than a tracking group.
        if (theme.states.idle.includes(file)) parts.push("eyes-js");
        for (const part of parts) {
          assert.match(svg, new RegExp(`id="${part}"`), `${id}/${file}: ${part}`);
        }
        assert.doesNotMatch(svg, /<script\b|<foreignObject\b|<image\b|<!DOCTYPE|\bon\w+\s*=|(?:href|xlink:href)\s*=|url\s*\(/i, `${id}/${file}: local declarative artwork only`);
      }
      assert.equal(hashes.size, 17, `${id}: animations must not be duplicate files`);
    }
  });
});
