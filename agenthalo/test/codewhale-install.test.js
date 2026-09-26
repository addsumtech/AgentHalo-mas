const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  HOOK_ENTRIES,
  STORE_MANAGED_MARKER,
  registerCodewhaleHooks,
  unregisterCodewhaleHooks,
  __test,
} = require("../hooks/codewhale-install");

const tempDirs = [];

function makeTempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-codewhale-"));
  tempDirs.push(root);
  const configDir = path.join(root, ".codewhale");
  fs.mkdirSync(configDir, { recursive: true });
  return path.join(configDir, "config.toml");
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function countHookBlocks(text) {
  return (text.match(/^\s*\[\[hooks\.hooks\]\]/gm) || []).length;
}

function countManagedMarkers(text) {
  return (text.match(/managed by clawd-on-desk/g) || []).length;
}

function legacyManagedBlock(event) {
  return [
    "",
    "# managed by clawd-on-desk",
    "[[hooks.hooks]]",
    `event = "${event}"`,
    `command = '''"node" "/old/clawd/hooks/codewhale-hook.js" "${event}"'''`,
    "background = true",
  ].join("\n");
}

function legacyOrphanBlock(event) {
  return [
    "",
    "[[hooks.hooks]]",
    "background = true",
    `command = '"/usr/local/bin/node" "/old/clawd/hooks/codewhale-hook.js" ${event}'`,
    `event = "${event}"`,
    "timeout_secs = 5",
  ].join("\n");
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("CodeWhale hook installer", () => {
  it("formats Windows node paths with spaces through the shared hook command formatter", () => {
    const block = __test.buildHookEntry("session_start", true, "D:/app/hooks/codewhale-hook.js", {
      nodeBin: "C:\\Program Files\\nodejs\\node.exe",
      platform: "win32",
    });

    assert.match(
      block,
      /command = '''"C:\/Program Files\/nodejs\/node\.exe" "D:\/app\/hooks\/codewhale-hook\.js" "session_start"'''/
    );
    assert.doesNotMatch(block, /command = '''& /);
  });

  it("resolves a system Node path when registering from Electron", () => {
    const block = __test.buildHookEntry("session_start", true, "/app/hooks/codewhale-hook.js", {
      isElectron: true,
      platform: "darwin",
      homeDir: "/Users/tester",
      accessSync: (candidate) => {
        if (candidate === "/opt/homebrew/bin/node") return;
        throw new Error("not found");
      },
      execFileSync: () => "",
    });

    assert.match(
      block,
      /command = '''"\/opt\/homebrew\/bin\/node" "\/app\/hooks\/codewhale-hook\.js" "session_start"'''/
    );
  });

  it("preserves an existing absolute Node path when Electron node detection fails", () => {
    const configPath = makeTempConfig();
    const existingNode = "/Users/tester/.nvm/versions/node/v22.0.0/bin/node";
    fs.writeFileSync(configPath, [
      "[hooks]",
      "enabled = true",
      "",
      "[[hooks.hooks]]",
      "# managed by clawd-on-desk",
      "event = \"session_start\"",
      `command = '''"${existingNode}" "/old/clawd/hooks/codewhale-hook.js" "session_start"'''`,
      "background = true",
      "",
    ].join("\n"));

    const result = registerCodewhaleHooks({
      configPath,
      hookScriptPath: "/new/clawd/hooks/codewhale-hook.js",
      isElectron: true,
      platform: "darwin",
      homeDir: "/Users/tester",
      accessSync: () => { throw new Error("not found"); },
      execFileSync: () => "",
      silent: true,
    });

    const content = read(configPath);
    assert.strictEqual(result.added, HOOK_ENTRIES.length);
    assert.match(
      content,
      /command = '''"\/Users\/tester\/\.nvm\/versions\/node\/v22\.0\.0\/bin\/node" "\/new\/clawd\/hooks\/codewhale-hook\.js" "session_start"'''/
    );
    assert.doesNotMatch(content, /command = '''"node"/);
  });

  it("respects CodeWhale config path environment overrides", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-codewhale-env-"));
    tempDirs.push(root);
    const codewhalePath = path.join(root, "custom", "codewhale.toml");
    const deepseekPath = path.join(root, "legacy", "deepseek.toml");

    assert.strictEqual(
      __test.envConfigPath({ env: { CODEWHALE_CONFIG_PATH: codewhalePath } }),
      codewhalePath
    );
    assert.strictEqual(
      __test.envConfigPath({ env: { DEEPSEEK_CONFIG_PATH: deepseekPath } }),
      deepseekPath
    );
    assert.strictEqual(
      __test.envConfigPath({ env: { CODEWHALE_CONFIG_PATH: codewhalePath, DEEPSEEK_CONFIG_PATH: deepseekPath } }),
      codewhalePath
    );

    const result = registerCodewhaleHooks({
      silent: true,
      env: { CODEWHALE_CONFIG_PATH: codewhalePath },
      hookScriptPath: "/new/clawd/hooks/codewhale-hook.js",
      nodeBin: "/usr/local/bin/node",
      platform: "linux",
    });

    assert.strictEqual(result.added, HOOK_ENTRIES.length);
    assert.strictEqual(fs.existsSync(codewhalePath), true);
    assert.strictEqual(fs.existsSync(path.join(root, ".codewhale", "config.toml")), false);
  });

  it("registers hooks idempotently when upgrading legacy marker-before-header blocks", () => {
    const configPath = makeTempConfig();
    const legacyBlocks = HOOK_ENTRIES.map(([event]) => legacyManagedBlock(event)).join("\n");
    fs.writeFileSync(
      configPath,
      [
        "[hooks]",
        "enabled = true",
        "",
        "[[hooks.hooks]]",
        'event = "session_start"',
        'command = "echo user-hook"',
        legacyBlocks,
        "",
      ].join("\n"),
      "utf8"
    );

    for (let i = 0; i < 3; i++) {
      registerCodewhaleHooks({
        silent: true,
        configPath,
        hookScriptPath: "/new/clawd/hooks/codewhale-hook.js",
        nodeBin: "/usr/local/bin/node",
        platform: "linux",
      });
      const content = read(configPath);
      assert.strictEqual(countHookBlocks(content), HOOK_ENTRIES.length + 1);
      assert.strictEqual(countManagedMarkers(content), HOOK_ENTRIES.length);
      assert.strictEqual((content.match(/\/old\/clawd\/hooks\/codewhale-hook\.js/g) || []).length, 0);
      assert.ok(content.includes('command = "echo user-hook"'));
    }

    const result = unregisterCodewhaleHooks({ silent: true, configPath });
    assert.strictEqual(result.removed, HOOK_ENTRIES.length);

    const after = read(configPath);
    assert.strictEqual(countHookBlocks(after), 1);
    assert.strictEqual(countManagedMarkers(after), 0);
    assert.ok(after.includes('command = "echo user-hook"'));
    assert.strictEqual(after.includes("codewhale-hook.js"), false);
  });

  it("removes legacy orphan hook blocks whose marker was lost", () => {
    const configPath = makeTempConfig();
    const orphanBlocks = HOOK_ENTRIES.map(([event]) => legacyOrphanBlock(event)).join("\n");
    fs.writeFileSync(
      configPath,
      [
        "[hooks]",
        "enabled = true",
        "",
        "[[hooks.hooks]]",
        'event = "session_start"',
        'command = "echo user-hook"',
        orphanBlocks,
        legacyOrphanBlock("session_start"),
        "",
      ].join("\n"),
      "utf8"
    );

    const result = registerCodewhaleHooks({
      silent: true,
      configPath,
      hookScriptPath: "/new/clawd/hooks/codewhale-hook.js",
      nodeBin: "/usr/local/bin/node",
      platform: "linux",
    });

    const content = read(configPath);
    assert.strictEqual(result.removed, HOOK_ENTRIES.length + 1);
    assert.strictEqual(result.added, HOOK_ENTRIES.length);
    assert.strictEqual(countHookBlocks(content), HOOK_ENTRIES.length + 1);
    assert.strictEqual(countManagedMarkers(content), HOOK_ENTRIES.length);
    assert.strictEqual((content.match(/\/old\/clawd\/hooks\/codewhale-hook\.js/g) || []).length, 0);
    assert.ok(content.includes('command = "echo user-hook"'));

    const second = registerCodewhaleHooks({
      silent: true,
      configPath,
      hookScriptPath: "/new/clawd/hooks/codewhale-hook.js",
      nodeBin: "/usr/local/bin/node",
      platform: "linux",
    });

    assert.strictEqual(second.added, 0);
    assert.strictEqual(second.removed, 0);
    assert.strictEqual(second.updated, false);
    assert.strictEqual(countHookBlocks(read(configPath)), HOOK_ENTRIES.length + 1);

    const uninstall = unregisterCodewhaleHooks({ silent: true, configPath });
    assert.strictEqual(uninstall.removed, HOOK_ENTRIES.length);
    const after = read(configPath);
    assert.strictEqual(countHookBlocks(after), 1);
    assert.strictEqual(after.includes("codewhale-hook.js"), false);
    assert.ok(after.includes('command = "echo user-hook"'));
  });

  it("associates legacy leading managed markers with their hook section", () => {
    const text = `[hooks]\nenabled = true\n${legacyManagedBlock("session_start")}\n`;
    const sections = __test.parseTomlSections(text);
    const hookSections = sections.filter((section) => section.header === "hooks.hooks");

    assert.strictEqual(hookSections.length, 1);
    assert.strictEqual(__test.sectionHasMarker(hookSections[0]), true);
    assert.strictEqual(sections.find((section) => section.header === "hooks").lines.includes("# managed by clawd-on-desk"), false);
  });

  it("classifies markerless codewhale-hook.js commands as legacy managed hooks", () => {
    const sections = __test.parseTomlSections(`[hooks]\nenabled = true\n${legacyOrphanBlock("session_start")}\n`);
    const hookSection = sections.find((section) => section.header === "hooks.hooks");

    assert.strictEqual(__test.sectionHasMarker(hookSection), false);
    assert.strictEqual(__test.sectionHasClawdHookCommand(hookSection), true);
    assert.strictEqual(__test.sectionIsManagedHook(hookSection), true);
  });

  it("does not swallow unrelated TOML array tables into a managed hook section", () => {
    const configPath = makeTempConfig();
    fs.writeFileSync(
      configPath,
      [
        "[hooks]",
        "enabled = true",
        "",
        "[[hooks.hooks]]",
        "# managed by clawd-on-desk",
        'event = "session_start"',
        `command = '''"node" "/old/clawd/hooks/codewhale-hook.js" "session_start"'''`,
        "",
        "[[mcp.servers]]",
        'name = "keep-me"',
        'command = "mcp-server"',
        "",
      ].join("\n"),
      "utf8"
    );

    const result = unregisterCodewhaleHooks({ silent: true, configPath });
    const after = read(configPath);

    assert.strictEqual(result.removed, 1);
    assert.strictEqual(after.includes("[[mcp.servers]]"), true);
    assert.strictEqual(after.includes('name = "keep-me"'), true);
    assert.strictEqual(after.includes("codewhale-hook.js"), false);
  });

  it("replaces disabled hooks.enabled instead of writing a duplicate key", () => {
    const configPath = makeTempConfig();
    fs.writeFileSync(
      configPath,
      [
        "[hooks]",
        "enabled = false",
        "",
        "[projects.\"/repo\"]",
        'trust_level = "trusted"',
        "",
      ].join("\n"),
      "utf8"
    );

    registerCodewhaleHooks({
      silent: true,
      configPath,
      hookScriptPath: "/new/clawd/hooks/codewhale-hook.js",
      nodeBin: "/usr/local/bin/node",
      platform: "linux",
    });

    const after = read(configPath);
    assert.strictEqual((after.match(/^\s*enabled\s*=/gm) || []).length, 1);
    assert.match(after, /^\s*enabled\s*=\s*true$/m);
    assert.strictEqual(after.includes('trust_level = "trusted"'), true);
  });
});

describe("CodeWhale hook installer in the Mac App Store build", () => {
  const LAUNCHER = "/Applications/AgentHalo.app/Contents/Resources/app.asar.unpacked/hooks/node-launcher.sh";
  const MOVED_LAUNCHER = "/Applications/Tools/AgentHalo.app/Contents/Resources/app.asar.unpacked/hooks/node-launcher.sh";

  function registerStore(configPath, nodeBin = LAUNCHER) {
    return registerCodewhaleHooks({ silent: true, configPath, env: {}, storeHooks: true, nodeBin });
  }

  function registerOther(configPath) {
    return registerCodewhaleHooks({
      silent: true,
      configPath,
      env: {},
      storeHooks: false,
      hookScriptPath: "/Applications/Other.app/Contents/Resources/app.asar.unpacked/hooks/codewhale-hook.js",
      nodeBin: "/usr/local/bin/node",
      platform: "darwin",
    });
  }

  function countStoreMarkers(text) {
    return text.split(`# ${STORE_MANAGED_MARKER}`).length - 1;
  }

  // The calls that write, rename or copy files while fn runs.
  function recordWrites(fn) {
    const writes = [];
    const originals = {};
    for (const name of ["writeFileSync", "renameSync", "copyFileSync", "appendFileSync"]) {
      originals[name] = fs[name];
      fs[name] = function recordedWrite(...args) {
        writes.push([name, String(args[0])]);
        return originals[name].apply(this, args);
      };
    }
    try {
      return { result: fn(), writes };
    } finally {
      Object.assign(fs, originals);
    }
  }

  function seed(configPath) {
    fs.writeFileSync(
      configPath,
      [
        'model = "deepseek"',
        "",
        "[hooks]",
        "enabled = true",
        "",
        "[[hooks.hooks]]",
        'event = "session_start"',
        'command = "echo user-hook-before"',
        "",
      ].join("\n"),
      "utf8"
    );
  }

  it("updates its own entries where they are when its launcher moves", () => {
    const configPath = makeTempConfig();
    seed(configPath);
    registerStore(configPath);
    // The user adds a hook after the store build's, and a table after that.
    fs.appendFileSync(configPath, [
      "",
      "[[hooks.hooks]]",
      'event = "session_end"',
      'command = "echo user-hook-after"',
      "",
      "[tui]",
      'theme = "dark"',
      "",
    ].join("\n"), "utf8");
    registerOther(configPath);
    const before = read(configPath);
    assert.strictEqual(countStoreMarkers(before), HOOK_ENTRIES.length);
    assert.ok(before.includes(LAUNCHER));

    const result = registerStore(configPath, MOVED_LAUNCHER);

    const after = read(configPath);
    assert.strictEqual(result.updated, true);
    assert.strictEqual(result.removed, HOOK_ENTRIES.length);
    // Only the launcher path changed: every entry stayed where it was, the
    // other install's and the user's included.
    assert.strictEqual(after, before.split(LAUNCHER).join(MOVED_LAUNCHER));
    assert.strictEqual(countStoreMarkers(after), HOOK_ENTRIES.length);

    // The other install finds nothing of its own to change.
    assert.deepStrictEqual(recordWrites(() => registerOther(configPath)).writes, []);
    assert.strictEqual(read(configPath), after);
  });

  it("leaves current entries alone and writes nothing", () => {
    const configPath = makeTempConfig();
    seed(configPath);
    registerStore(configPath);
    // The other install puts its entries just below [hooks], above the store
    // build's; the store build's stay current wherever they end up.
    registerOther(configPath);
    const before = read(configPath);
    const statBefore = fs.statSync(configPath);
    assert.strictEqual(countStoreMarkers(before), HOOK_ENTRIES.length);
    assert.ok(before.indexOf("managed by clawd-on-desk") < before.indexOf(`# ${STORE_MANAGED_MARKER}`));

    for (let round = 0; round < 3; round++) {
      const { result, writes } = recordWrites(() => registerStore(configPath));
      assert.deepStrictEqual(result, { added: 0, removed: 0, updated: false, skipped: true });
      assert.deepStrictEqual(writes, [], `round ${round} wrote ${JSON.stringify(writes)}`);
    }
    assert.strictEqual(read(configPath), before);
    const statAfter = fs.statSync(configPath);
    assert.strictEqual(statAfter.ino, statBefore.ino);
    assert.strictEqual(statAfter.mtimeMs, statBefore.mtimeMs);
  });
});
