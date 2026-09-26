"use strict";

// The Mac App Store build and the original AgentHalo (com.agenthalo.desktop,
// or any other clawd install) can both keep hooks in one tool config. The
// original app's matching rules are the default (non-store) rules of each
// hooks/*-install.js: every command that mentions its hook script
// (gemini-hook.js, cursor-hook.js, codex-hook.js, ...), the "clawd" hook name
// or Antigravity group, CodeWhale's "managed by clawd-on-desk" comment and
// every http://127.0.0.1:<23333-23337>/permission URL is its own. Two installs
// that both claim everything rewrote each other's entries on every sync,
// repair and uninstall. These tests run the other install's installer and the
// store build's against one config per tool. (Claude Code has its own suite:
// test/claude-store-coexistence.test.js.)

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildPermissionUrl,
  buildStorePermissionUrl,
  getBundledNodeLauncherPath,
  isManagedPermissionUrl,
} = require("../hooks/server-config");
const ownership = require("../hooks/store-hook-ownership");
const gemini = require("../hooks/gemini-install");
const antigravity = require("../hooks/antigravity-install");
const cursor = require("../hooks/cursor-install");
const copilot = require("../hooks/copilot-install");
const codebuddy = require("../hooks/codebuddy-install");
const workbuddy = require("../hooks/workbuddy-install");
const qwen = require("../hooks/qwen-code-install");
const zcode = require("../hooks/zcode-install");
const codewhale = require("../hooks/codewhale-install");
const codex = require("../hooks/codex-install");
const qoder = require("../hooks/qoder-install");
const reasonix = require("../hooks/reasonix-install");
const qoderwork = require("../hooks/qoderwork-install");
const traecode = require("../hooks/traecode-install");
const qwenwork = require("../hooks/qwenwork-install");
const { cleanupIntegrations } = require("../hooks/cleanup-integrations");

const LAUNCHER = getBundledNodeLauncherPath();
const HOOKS_DIR = path.join(__dirname, "..", "hooks").replace(/\\/g, "/");
// The original app runs hooks with a real Node; this one exists everywhere.
const OTHER_NODE = process.execPath;
// A second claim-everything install, for the control runs.
const THIRD_NODE = "/opt/elsewhere/bin/node";
const OTHER_PORT = 23333;
const STORE_PORT = 23334;
const USER_COMMAND = "bash ~/bin/user-hook.sh";
const USER_URL = "https://approvals.example.com/hook";
const STORE_SCRIPT_PREFIX = `${HOOKS_DIR}/agenthalo-store-`;
// Every name another install matches as its own.
const OTHER_MARKERS = [
  "clawd-hook.js",
  "gemini-hook.js",
  "antigravity-hook.js",
  "antigravity-statusline.js",
  "cursor-hook.js",
  "copilot-hook.js",
  "codebuddy-hook.js",
  "workbuddy-hook.js",
  "qwen-code-hook.js",
  "zcode-hook.js",
  "codewhale-hook.js",
  "codex-hook.js",
  "qoder-hook.js",
  "reasonix-hook.js",
  "qoderwork-hook.js",
  "traecode-hook.js",
  "qwenwork-hook.js",
  "auto-start.js",
  "claude-statusline.js",
  codewhale.MANAGED_MARKER,
  codebuddy.CLAWD_PERMISSION_HOOK_NAME,
];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Every hook in a parsed config, as { text, name, group }: its command (or
// bash/powershell/url) with its arguments, its hook name, and the Antigravity
// group it sits in.
function hookRecords(value, out = [], group = null) {
  if (Array.isArray(value)) {
    for (const item of value) hookRecords(item, out, group);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const parts = ["command", "bash", "powershell", "url"]
    .filter((key) => typeof value[key] === "string")
    .map((key) => value[key]);
  if (parts.length) {
    if (Array.isArray(value.args)) parts.push(...value.args.filter((arg) => typeof arg === "string"));
    out.push({ text: parts.join(" "), name: typeof value.name === "string" ? value.name : null, group });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "args" || !child || typeof child !== "object") continue;
    hookRecords(child, out, group);
  }
  return out;
}

function jsonRecords(file) {
  return fs.existsSync(file) ? hookRecords(readJson(file)) : [];
}

function tomlRecords(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n")
    .filter((line) => /^\s*command\s*=/.test(line))
    .map((line) => ({ text: line, name: null, group: null }));
}

// One entry per tool: where its config lives, a config holding the user's own
// hooks, and both installs' register/unregister calls. `other` runs the
// default rules with a real Node, as the original app does; `store` runs the
// store build's rules with the bundled launcher.
const TOOLS = [
  {
    id: "gemini-cli",
    shared: ["gemini-hook.js"],
    counts: { other: 8, store: 8 },
    files: (home) => [path.join(home, ".gemini", "settings.json")],
    seed(home) {
      writeJson(this.files(home)[0], {
        hooks: { BeforeTool: [{ matcher: "*", hooks: [{ name: "user-hook", type: "command", command: USER_COMMAND }] }] },
        hooksConfig: { disabled: ["user-hook", "clawd"] },
      });
    },
    register: (home, options) => gemini.registerGeminiHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => gemini.unregisterGeminiHooks({ homeDir: home, silent: true, ...options }),
    records(home) { return jsonRecords(this.files(home)[0]); },
    check(home) {
      // Disabling another install's "clawd" hooks is the user's choice about
      // that install; the store build names its own hook apart.
      assert.deepEqual(readJson(this.files(home)[0]).hooksConfig.disabled, ["user-hook", "clawd"]);
    },
  },
  {
    id: "antigravity-cli",
    shared: ["antigravity-hook.js", "antigravity-statusline.js"],
    // Four hook events each; the one statusline slot goes to whoever takes it first.
    counts: { other: 5, store: 4 },
    files: (home) => [
      path.join(home, ".gemini", "config", "hooks.json"),
      path.join(home, ".gemini", "antigravity-cli", "settings.json"),
    ],
    seed(home) {
      const [hooksPath, settingsPath] = this.files(home);
      writeJson(hooksPath, { "user-group": { Stop: [{ type: "command", command: USER_COMMAND, timeout: 10 }] } });
      writeJson(settingsPath, { theme: "dark" });
    },
    register(home, options) {
      antigravity.registerAntigravityHooks({ homeDir: home, silent: true, ...options });
      antigravity.registerAntigravityStatusline({ homeDir: home, silent: true, ...options });
    },
    unregister(home, options) {
      antigravity.unregisterAntigravityHooks({ homeDir: home, silent: true, ...options });
      antigravity.unregisterAntigravityStatusline({ homeDir: home, silent: true, ...options });
    },
    records(home) {
      const [hooksPath, settingsPath] = this.files(home);
      const hooks = fs.existsSync(hooksPath) ? readJson(hooksPath) : {};
      const out = [];
      for (const [group, value] of Object.entries(hooks)) hookRecords(value, out, group);
      return [...out, ...jsonRecords(settingsPath)];
    },
    check(home) {
      const [hooksPath, settingsPath] = this.files(home);
      const groups = readJson(hooksPath);
      for (const record of this.records(home).filter((r) => r.text.includes(STORE_SCRIPT_PREFIX) && r.group)) {
        assert.equal(record.group, ownership.STORE_HOOK_NAME, "store hooks live in the store group");
      }
      assert.ok(!JSON.stringify(groups.clawd || {}).includes(STORE_SCRIPT_PREFIX));
      assert.equal(readJson(settingsPath).theme, "dark");
    },
  },
  {
    id: "cursor-agent",
    shared: ["cursor-hook.js"],
    counts: { other: 11, store: 11 },
    files: (home) => [path.join(home, ".cursor", "hooks.json")],
    seed(home) {
      writeJson(this.files(home)[0], { version: 1, hooks: { stop: [{ command: USER_COMMAND }] } });
    },
    register: (home, options) => cursor.registerCursorHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => cursor.unregisterCursorHooks({ homeDir: home, silent: true, ...options }),
    records(home) { return jsonRecords(this.files(home)[0]); },
  },
  {
    id: "copilot-cli",
    shared: ["copilot-hook.js"],
    // Copilot runs every permissionRequest hook it finds and the last answer
    // wins, so each install leaves that event to one it does not own.
    counts: { other: 11, store: 10 },
    files: (home) => [path.join(home, ".copilot", "hooks", "hooks.json")],
    seed(home) {
      writeJson(this.files(home)[0], {
        version: 1,
        hooks: { sessionStart: [{ type: "command", bash: USER_COMMAND, powershell: USER_COMMAND, timeoutSec: 5 }] },
      });
    },
    register: (home, options) => copilot.registerCopilotHooks({
      copilotHome: path.join(home, ".copilot"), env: {}, silent: true, ...options,
    }),
    unregister: (home, options) => copilot.unregisterCopilotHooks({
      copilotHome: path.join(home, ".copilot"), env: {}, silent: true, ...options,
    }),
    records(home) { return jsonRecords(this.files(home)[0]); },
    check(home) {
      const permission = hookRecords(readJson(this.files(home)[0]).hooks.permissionRequest || []);
      assert.equal(permission.length, 1, "one install answers permissionRequest");
    },
  },
  {
    id: "codebuddy",
    shared: ["codebuddy-hook.js"],
    counts: { other: 9, store: 9 },
    files: (home) => [path.join(home, ".codebuddy", "settings.json")],
    seed(home) {
      writeJson(this.files(home)[0], {
        hooks: {
          Stop: [{ matcher: "", hooks: [{ type: "command", command: USER_COMMAND }] }],
          PermissionRequest: [{ matcher: "", hooks: [{ name: "user-approval", type: "http", url: USER_URL }] }],
        },
      });
    },
    register: (home, options) => codebuddy.registerCodeBuddyHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => codebuddy.unregisterCodeBuddyHooks({ homeDir: home, silent: true, ...options }),
    records(home) { return jsonRecords(this.files(home)[0]); },
    check(home) {
      const urls = hookRecords(readJson(this.files(home)[0]).hooks.PermissionRequest || []).map((r) => r.text);
      for (const url of urls.filter((u) => u.includes("/agenthalo-store/"))) {
        assert.equal(url, buildStorePermissionUrl(STORE_PORT));
        assert.equal(isManagedPermissionUrl(url), false);
      }
    },
  },
  {
    id: "workbuddy",
    shared: ["workbuddy-hook.js"],
    counts: { other: 8, store: 8 },
    files: (home) => [path.join(home, ".workbuddy-ai", "settings.json")],
    seed(home) {
      writeJson(this.files(home)[0], {
        hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: USER_COMMAND }] }] },
      });
    },
    register: (home, options) => workbuddy.registerWorkBuddyHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => workbuddy.unregisterWorkBuddyHooks({
      settingsPaths: [path.join(home, ".workbuddy-ai", "settings.json")], silent: true, ...options,
    }),
    records(home) { return jsonRecords(this.files(home)[0]); },
  },
  {
    id: "qwen-code",
    shared: ["qwen-code-hook.js"],
    counts: { other: 8, store: 8 },
    files: (home) => [path.join(home, ".qwen", "settings.json")],
    seed(home) {
      writeJson(this.files(home)[0], {
        hooks: { Stop: [{ hooks: [{ name: "user-hook", type: "command", command: USER_COMMAND }] }] },
      });
    },
    register: (home, options) => qwen.registerQwenCodeHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => qwen.unregisterQwenCodeHooks({ homeDir: home, silent: true, ...options }),
    records(home) { return jsonRecords(this.files(home)[0]); },
  },
  {
    id: "zcode",
    shared: ["zcode-hook.js"],
    // ZCode runs same-event hooks serially and the last permission decision
    // wins, so each install leaves PermissionRequest to one it does not own.
    counts: { other: 7, store: 6 },
    // The store build cannot run ZCode hooks through its launcher (ZCode
    // wants a Node executable, see below); these runs give it one so its
    // ownership rules can be checked.
    storeNode: OTHER_NODE,
    noLegacy: true,
    files: (home) => [path.join(home, ".zcode", "cli", "config.json")],
    seed(home) {
      writeJson(this.files(home)[0], {
        hooks: { enabled: true, events: { Stop: [{ hooks: [{ type: "process", command: "/bin/echo", args: [USER_COMMAND] }] }] } },
      });
    },
    register: (home, options) => zcode.registerZcodeHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => zcode.unregisterZcodeHooks({ homeDir: home, silent: true, ...options }),
    records(home) { return jsonRecords(this.files(home)[0]); },
  },
  {
    id: "codewhale",
    shared: ["codewhale-hook.js"],
    counts: { other: 7, store: 7 },
    files: (home) => [path.join(home, ".codewhale", "config.toml")],
    seed(home) {
      const file = this.files(home)[0];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, [
        'model = "deepseek"',
        "",
        "[hooks]",
        "enabled = true",
        "",
        "[[hooks.hooks]]",
        'event = "session_start"',
        `command = "${USER_COMMAND}"`,
        "",
        "[tui]",
        'theme = "dark"',
        "",
      ].join("\n"));
    },
    register(home, options) {
      return codewhale.registerCodewhaleHooks({ configPath: this.files(home)[0], env: {}, silent: true, ...options });
    },
    unregister(home, options) {
      return codewhale.unregisterCodewhaleHooks({ configPath: this.files(home)[0], env: {}, silent: true, ...options });
    },
    records(home) { return tomlRecords(this.files(home)[0]); },
    check(home) {
      const text = fs.readFileSync(this.files(home)[0], "utf8");
      assert.ok(text.includes('model = "deepseek"') && text.includes('theme = "dark"'));
      const storeSections = text.split("[[hooks.hooks]]").filter((section) => section.includes(STORE_SCRIPT_PREFIX));
      for (const section of storeSections) {
        assert.ok(section.includes(`# ${codewhale.STORE_MANAGED_MARKER}`));
        assert.ok(!section.includes(codewhale.MANAGED_MARKER));
      }
    },
  },
  {
    id: "codex",
    shared: ["codex-hook.js"],
    counts: { other: 6, store: 6 },
    files: (home) => [path.join(home, ".codex", "hooks.json"), path.join(home, ".codex", "config.toml")],
    seed(home) {
      const [hooksPath, configPath] = this.files(home);
      writeJson(hooksPath, { hooks: { Stop: [{ hooks: [{ type: "command", command: USER_COMMAND, timeout: 30 }] }] } });
      fs.writeFileSync(configPath, 'model = "gpt-5"\n');
    },
    register: (home, options) => codex.registerCodexHooks({
      codexDir: path.join(home, ".codex"), stableLauncher: false, env: {}, silent: true, ...options,
    }),
    unregister: (home, options) => codex.unregisterCodexHooks({
      codexDir: path.join(home, ".codex"), env: {}, silent: true, ...options,
    }),
    records(home) { return jsonRecords(this.files(home)[0]); },
  },
  {
    id: "qoder",
    shared: ["qoder-hook.js"],
    counts: { other: 10, store: 10 },
    files: (home) => [path.join(home, ".qoder", "settings.json")],
    seed(home) {
      writeJson(this.files(home)[0], {
        hooks: { Stop: [{ matcher: "*", hooks: [{ name: "user-hook", type: "command", command: USER_COMMAND }] }] },
        hooksConfig: { disabled: ["user-hook", "clawd"] },
      });
    },
    register: (home, options) => qoder.registerQoderHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => qoder.unregisterQoderHooks({ homeDir: home, silent: true, ...options }),
    records(home) { return jsonRecords(this.files(home)[0]); },
    check(home) {
      assert.deepEqual(readJson(this.files(home)[0]).hooksConfig.disabled, ["user-hook", "clawd"]);
    },
  },
  {
    id: "reasonix",
    shared: ["reasonix-hook.js"],
    counts: { other: 9, store: 9 },
    files: (home) => [path.join(home, ".reasonix", "settings.json")],
    seed(home) {
      writeJson(this.files(home)[0], { hooks: { Stop: [{ match: "*", command: USER_COMMAND }] } });
    },
    register: (home, options) => reasonix.registerReasonixHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => reasonix.unregisterReasonixHooks({ homeDir: home, silent: true, ...options }),
    records(home) { return jsonRecords(this.files(home)[0]); },
  },
  {
    id: "qoderwork",
    shared: ["qoderwork-hook.js"],
    counts: { other: 10, store: 10 },
    files: (home) => [path.join(home, ".qoderwork", "settings.json")],
    seed(home) {
      writeJson(this.files(home)[0], {
        hooks: { Stop: [{ matcher: "*", hooks: [{ name: "user-hook", type: "command", command: USER_COMMAND }] }] },
        hooksConfig: { disabled: ["user-hook", "clawd"] },
      });
    },
    register: (home, options) => qoderwork.registerQoderWorkHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => qoderwork.unregisterQoderWorkHooks({ homeDir: home, silent: true, ...options }),
    records(home) { return jsonRecords(this.files(home)[0]); },
    check(home) {
      assert.deepEqual(readJson(this.files(home)[0]).hooksConfig.disabled, ["user-hook", "clawd"]);
    },
  },
  {
    id: "traecode",
    shared: ["traecode-hook.js"],
    counts: { other: 6, store: 6 },
    files: (home) => [path.join(home, ".trae-cn", "hooks.json")],
    seed(home) {
      writeJson(this.files(home)[0], {
        version: 1,
        hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: USER_COMMAND }] }] },
      });
    },
    register: (home, options) => traecode.registerTraeCodeHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => traecode.unregisterTraeCodeHooks({ homeDir: home, silent: true, ...options }),
    records(home) { return jsonRecords(this.files(home)[0]); },
  },
  {
    id: "qwenwork",
    shared: ["qwenwork-hook.js"],
    counts: { other: 10, store: 10 },
    files: (home) => [path.join(home, ".QwenWorkCN", "settings.json")],
    seed(home) {
      writeJson(this.files(home)[0], {
        hooks: { Stop: [{ matcher: "*", hooks: [{ name: "user-hook", type: "command", command: USER_COMMAND }] }] },
        hooksConfig: { disabled: ["user-hook", "clawd"] },
      });
    },
    register: (home, options) => qwenwork.registerQwenWorkHooks({ homeDir: home, silent: true, ...options }),
    unregister: (home, options) => qwenwork.unregisterQwenWorkHooks({ homeDir: home, silent: true, ...options }),
    records(home) { return jsonRecords(this.files(home)[0]); },
    check(home) {
      assert.deepEqual(readJson(this.files(home)[0]).hooksConfig.disabled, ["user-hook", "clawd"]);
    },
  },
];

function otherOptions() {
  return { storeHooks: false, nodeBin: OTHER_NODE, port: OTHER_PORT };
}

function storeOptions(tool) {
  return { storeHooks: true, port: STORE_PORT, ...(tool.storeNode ? { nodeBin: tool.storeNode } : {}) };
}

// Entries the store build writes with no other install present: the ones the
// other install took first (a permission hook, a statusline slot) included.
function aloneCount(tool) {
  return Math.max(tool.counts.store, tool.counts.other);
}

function isStoreRecord(record) {
  return record.text.includes(STORE_SCRIPT_PREFIX) || record.text.includes("/agenthalo-store/");
}

function isOtherRecord(tool, record) {
  return !isStoreRecord(record) && (
    tool.shared.some((script) => record.text.includes(`${HOOKS_DIR}/${script}`))
    || record.text === buildPermissionUrl(OTHER_PORT)
  );
}

function isUserRecord(record) {
  return record.text.includes(USER_COMMAND) || record.text.includes(USER_URL);
}

function snapshot(tool, home) {
  return tool.files(home).map((file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null));
}

function sides(tool, home) {
  const records = tool.records(home);
  return {
    other: records.filter((record) => isOtherRecord(tool, record)).map((record) => record.text),
    store: records.filter(isStoreRecord).map((record) => record.text),
    user: records.filter(isUserRecord).map((record) => record.text),
    unknown: records.filter((record) => (
      !isOtherRecord(tool, record) && !isStoreRecord(record) && !isUserRecord(record)
    )).map((record) => record.text),
  };
}

describe("store build and another AgentHalo install sharing a tool's hook config", () => {
  let home;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-store-coexist-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  for (const tool of TOOLS) {
    describe(tool.id, () => {
      it("writes store entries none of the other install's rules match", () => {
        tool.seed(home);
        tool.register(home, storeOptions(tool));
        const { store, other, user, unknown } = sides(tool, home);
        assert.equal(store.length, aloneCount(tool));
        assert.deepEqual(other, []);
        assert.equal(user.length > 0, true);
        assert.deepEqual(unknown, []);
        for (const text of store) {
          for (const marker of OTHER_MARKERS) {
            assert.equal(text.includes(marker), false, `${text} mentions ${marker}`);
          }
          if (!text.startsWith("http")) {
            assert.ok(text.includes(tool.storeNode || LAUNCHER), text);
          }
        }
        for (const record of tool.records(home).filter(isStoreRecord)) {
          assert.notEqual(record.name, "clawd");
          assert.notEqual(record.name, codebuddy.CLAWD_PERMISSION_HOOK_NAME);
        }
        if (tool.check) tool.check(home);
      });

      for (const order of ["other first", "store first"]) {
        it(`converges with no further writes when both keep syncing (${order})`, () => {
          tool.seed(home);
          const syncOther = () => tool.register(home, otherOptions());
          const syncStore = () => tool.register(home, storeOptions(tool));
          const [first, second] = order === "other first" ? [syncOther, syncStore] : [syncStore, syncOther];
          first();
          second();
          const converged = snapshot(tool, home);
          for (let round = 0; round < 4; round++) {
            syncOther();
            assert.deepEqual(snapshot(tool, home), converged, `the other install rewrote the config in round ${round}`);
            syncStore();
            assert.deepEqual(snapshot(tool, home), converged, `the store build rewrote the config in round ${round}`);
          }

          const { other, store, user, unknown } = sides(tool, home);
          const [firstCount, secondCount] = [tool.counts.other, tool.counts.store];
          assert.equal(order === "other first" ? other.length : store.length, firstCount);
          assert.equal(order === "other first" ? store.length : other.length, secondCount);
          assert.equal(user.length > 0, true, "the user's own hooks survive");
          assert.deepEqual(unknown, []);
          if (tool.check) tool.check(home);
        });
      }

      it("stays converged when the store app moves and rewrites its own entries", () => {
        tool.seed(home);
        tool.register(home, otherOptions());
        tool.register(home, storeOptions(tool));
        const before = sides(tool, home);

        // Only the store build's command changes (a moved app runs another
        // launcher); it updates its entries in place.
        const movedNode = tool.storeNode ? THIRD_NODE : "/Applications/Moved/AgentHalo.app/Contents/Resources/app.asar.unpacked/hooks/node-launcher.sh";
        tool.register(home, { ...storeOptions(tool), nodeBin: movedNode });
        const moved = snapshot(tool, home);
        const after = sides(tool, home);
        assert.equal(after.store.length, before.store.length);
        assert.ok(after.store.every((text) => text.startsWith("http") || text.includes(movedNode)));
        assert.deepEqual(after.other, before.other);
        assert.deepEqual(after.user, before.user);

        tool.register(home, otherOptions());
        assert.deepEqual(snapshot(tool, home), moved, "the other install leaves the moved entries alone");
      });

      it("disconnecting either side removes only that side's entries", () => {
        tool.seed(home);
        tool.register(home, otherOptions());
        tool.register(home, storeOptions(tool));
        const before = sides(tool, home);
        assert.equal(before.other.length, tool.counts.other);
        assert.equal(before.store.length, tool.counts.store);

        tool.unregister(home, storeOptions(tool));
        let after = sides(tool, home);
        assert.deepEqual(after.store, []);
        assert.deepEqual(after.other, before.other);
        assert.deepEqual(after.user, before.user);

        tool.register(home, storeOptions(tool));
        const storeBack = sides(tool, home).store;
        assert.ok(storeBack.length > 0);
        tool.unregister(home, otherOptions());
        after = sides(tool, home);
        assert.deepEqual(after.other, []);
        assert.deepEqual(after.store, storeBack);
        assert.deepEqual(after.user, before.user);
      });

      if (!tool.noLegacy) {
        it("migrates the entries an earlier store build wrote", () => {
          tool.seed(home);
          // An earlier store build: the default rules, run through this
          // bundle's launcher.
          tool.register(home, { storeHooks: false, nodeBin: LAUNCHER, port: STORE_PORT });
          const legacy = tool.records(home).filter((record) => record.text.includes(LAUNCHER));
          assert.ok(legacy.length > 0);

          tool.register(home, storeOptions(tool));
          const { other, store, user, unknown } = sides(tool, home);
          assert.deepEqual(other, [], "nothing of the earlier store format is left");
          assert.equal(store.length, aloneCount(tool));
          assert.ok(user.length > 0);
          assert.deepEqual(unknown, []);
          if (tool.check) tool.check(home);
        });
      }

      it("control: two installs that both claim every entry keep rewriting each other", () => {
        tool.seed(home);
        const syncA = () => tool.register(home, otherOptions());
        const syncB = () => tool.register(home, { storeHooks: false, nodeBin: THIRD_NODE, port: STORE_PORT });
        syncA();
        let previous = snapshot(tool, home);
        for (let round = 0; round < 3; round++) {
          for (const sync of [syncB, syncA]) {
            sync();
            const next = snapshot(tool, home);
            assert.notDeepEqual(next, previous, `round ${round}: a claim-everything sync left the config alone`);
            previous = next;
          }
        }
      });
    });
  }
});

describe("store build removes only its own entries on cleanup", () => {
  let home;
  let previousMas;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-store-cleanup-"));
    previousMas = process.mas;
  });

  afterEach(() => {
    process.mas = previousMas;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("leaves the other install's hooks, and its Codex launcher files, in every tool", async () => {
    for (const tool of TOOLS) {
      tool.seed(home);
      // The other install's Codex hooks go through its launcher in ~/.codex,
      // as `node hooks/codex-install.js` writes them.
      tool.register(home, { ...otherOptions(), ...(tool.id === "codex" ? { stableLauncher: true } : {}) });
      tool.register(home, storeOptions(tool));
    }
    const stableLauncher = path.join(home, ".codex", "clawd-hooks", "codex-hook.js.sh");
    assert.ok(fs.existsSync(stableLauncher));
    const before = new Map(TOOLS.map((tool) => [tool.id, tool.records(home)]));

    // Cleanup reads the build, as it does in the store app.
    process.mas = true;
    const result = await cleanupIntegrations({
      homeDir: home,
      env: {},
      agentIds: TOOLS.map((tool) => tool.id),
      silent: true,
      claudeCleanupResult: { status: "ok", removed: 0, changed: false },
    });
    assert.deepEqual(result.agents.filter((agent) => agent.status === "failed"), []);
    for (const tool of TOOLS) {
      const kept = before.get(tool.id).filter((record) => !isStoreRecord(record));
      assert.ok(kept.some((record) => isOtherRecord(tool, record) || record.text.includes("clawd-hooks")), tool.id);
      assert.deepEqual(tool.records(home), kept, tool.id);
    }
    assert.ok(fs.existsSync(stableLauncher), "the other install's Codex launcher stays");
  });
});

describe("Doctor in the store build", () => {
  let home;
  let previousMas;
  let descriptors;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-store-doctor-"));
    previousMas = process.mas;
    process.mas = true;
    // Descriptors pick their markers when the module loads, as in the app.
    const modulePath = require.resolve("../src/doctor-detectors/agent-descriptors");
    delete require.cache[modulePath];
    descriptors = require(modulePath).getAgentDescriptors();
    delete require.cache[modulePath];
  });

  afterEach(() => {
    process.mas = previousMas;
    fs.rmSync(home, { recursive: true, force: true });
  });

  // The descriptor with its config moved into the test home.
  function descriptorFor(tool) {
    const descriptor = descriptors.find((entry) => entry.agentId === tool.id);
    const configPath = tool.files(home)[0];
    const moved = { ...descriptor, parentDir: path.dirname(configPath), configPath };
    delete moved.configTargets;
    if (tool.id === "codex") moved.supplementary = { key: "hooks", configPath: tool.files(home)[1] };
    if (tool.id === "copilot-cli") moved.settingsPath = path.join(home, ".copilot", "settings.json");
    return moved;
  }

  function check(tool) {
    const { checkAgentIntegrations } = require("../src/doctor-detectors/agent-integrations");
    return checkAgentIntegrations({ descriptors: [descriptorFor(tool)], prefs: {} }).details[0];
  }

  const CHECKED = ["gemini-cli", "antigravity-cli", "cursor-agent", "copilot-cli", "codebuddy", "workbuddy",
    "qwen-code", "codewhale", "codex", "qoder", "reasonix", "qoderwork", "traecode", "qwenwork"];

  for (const id of CHECKED) {
    it(`${id}: judges the store build's entries, not the other install's`, () => {
      const tool = TOOLS.find((entry) => entry.id === id);
      tool.seed(home);
      tool.register(home, otherOptions());
      const otherOnly = check(tool);
      assert.equal(otherOnly.status, "not-connected", JSON.stringify(otherOnly));

      tool.register(home, storeOptions(tool));
      const both = check(tool);
      if (id === "codex") {
        // Codex asks the user to review new hooks; only the store's six count.
        assert.equal(both.status, "needs-review", JSON.stringify(both));
        assert.equal(both.codexHookTrust.totalCount, 6);
      } else {
        assert.equal(both.status, "ok", JSON.stringify(both));
        if (both.scriptPath) assert.ok(both.scriptPath.startsWith(STORE_SCRIPT_PREFIX), both.scriptPath);
      }
    });
  }
});

describe("Doctor's command parser reads every command the store build writes", () => {
  const install = require("../hooks/install");
  const {
    parseHookCommand,
    validateHookCommand,
    validateHookTarget,
  } = require("../src/doctor-detectors/agent-node-bin-parser");
  const CLAUDE = {
    id: "claude-code",
    files: (home) => [path.join(home, ".claude", "settings.json")],
    seed(home) { writeJson(this.files(home)[0], {}); },
    async register(home, options) {
      const settingsPath = this.files(home)[0];
      await install.registerHooksAsync({
        settingsPath,
        autoStart: true,
        claudeVersionInfo: { version: "2.1.283", source: "test", status: "known" },
        silent: true,
        ...options,
      });
      install.registerClaudeStatusline({ settingsPath, silent: true, ...options });
    },
  };
  // The entry scripts each tool's commands run.
  const SCRIPTS = {
    "claude-code": [install.STORE_HOOK_SCRIPT, install.STORE_AUTO_START_SCRIPT, install.STORE_STATUSLINE_SCRIPT],
    "antigravity-cli": [ownership.STORE_HOOK_SCRIPTS["antigravity-cli"], ownership.STORE_HOOK_SCRIPTS["antigravity-statusline"]],
  };
  let home;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-store-parse-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  // Every command in the tool's config files that runs a store entry script:
  // the shell command string, or the argv of a process hook.
  function storeCommands(tool) {
    const out = [];
    const visit = (value) => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (!value || typeof value !== "object") return;
      if (typeof value.command === "string" && Array.isArray(value.args)) {
        out.push({ argv: [value.command, ...value.args] });
      } else {
        // Copilot keeps the POSIX command under "bash".
        for (const key of ["command", "bash"]) {
          if (typeof value[key] === "string") out.push({ command: value[key] });
        }
      }
      for (const child of Object.values(value)) visit(child);
    };
    for (const file of tool.files(home)) {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      if (file.endsWith(".toml")) {
        for (const match of text.matchAll(/^\s*command\s*=\s*'''(.*)'''\s*$/gm)) out.push({ command: match[1] });
      } else {
        visit(JSON.parse(text));
      }
    }
    return out.filter((entry) => (entry.command || entry.argv.join(" ")).includes(STORE_SCRIPT_PREFIX));
  }

  // The store build writes no ZCode hooks yet (see "leave ZCode alone" below).
  for (const tool of [CLAUDE, ...TOOLS.filter((entry) => entry.id !== "zcode")]) {
    it(`${tool.id}: every store command runs the launcher with a store entry script`, async () => {
      const scripts = SCRIPTS[tool.id] || [ownership.STORE_HOOK_SCRIPTS[tool.id]];
      tool.seed(home);
      await tool.register(home, { storeHooks: true, port: STORE_PORT });
      const commands = storeCommands(tool);
      assert.ok(commands.length > 0, "the store build wrote no commands");

      const seen = new Set();
      for (const entry of commands) {
        let target;
        if (entry.argv) {
          // A process hook: the tool runs argv[0] with the rest as arguments,
          // and Doctor holds argv[0] to be a Node it can run.
          target = { nodeBin: entry.argv[0], scriptPath: entry.argv[1] };
          assert.deepEqual(validateHookTarget(target, { requireAbsoluteNode: true, requireNodeExecutable: true }), {
            ok: true, ...target,
          }, entry.argv.join(" "));
        } else {
          target = parseHookCommand(entry.command);
          assert.equal(target.ok, true, entry.command);
          assert.deepEqual(validateHookCommand(entry.command), {
            ok: true, nodeBin: target.nodeBin, scriptPath: target.scriptPath,
          }, entry.command);
        }
        assert.equal(target.nodeBin, LAUNCHER, entry.command || entry.argv.join(" "));
        const script = path.basename(target.scriptPath);
        assert.equal(target.scriptPath, `${HOOKS_DIR}/${script}`);
        assert.ok(scripts.includes(script), `${script} is not one of ${scripts.join(", ")}`);
        seen.add(script);
      }
      assert.deepEqual([...seen].sort(), [...scripts].sort(), "every entry script is written");
    });
  }
});

describe("store entry scripts", () => {
  const { createSpawnedHookHarness } = require("./helpers/spawned-hook");
  const SESSION = "s-store-entry";
  const state = (event) => ({ hook_event_name: event, session_id: SESSION, cwd: "/tmp" });
  // [entry script, shared script, argv, stdin payload, env]
  const ENTRIES = [
    ["gemini-cli", "gemini-hook.js", ["BeforeTool"], state("BeforeTool")],
    ["antigravity-cli", "antigravity-hook.js", ["PostToolUse"], { ...state("PostToolUse"), tool_name: "run_command" }],
    ["antigravity-statusline", "antigravity-statusline.js", [], { conversation_id: SESSION, model: { display_name: "Gemini" } }],
    ["cursor-agent", "cursor-hook.js", [], { hook_event_name: "preToolUse", conversation_id: SESSION, cwd: "/tmp" }],
    ["copilot-cli", "copilot-hook.js", ["sessionStart"], { sessionId: SESSION, cwd: "/tmp" }],
    ["codebuddy", "codebuddy-hook.js", [], state("PreToolUse")],
    ["workbuddy", "workbuddy-hook.js", [], state("PreToolUse")],
    ["qwen-code", "qwen-code-hook.js", ["PreToolUse"], state("PreToolUse")],
    ["zcode", "zcode-hook.js", ["PreToolUse"], state("PreToolUse")],
    ["codewhale", "codewhale-hook.js", ["message_submit"], {}, { DEEPSEEK_SESSION_ID: SESSION }],
    ["codex", "codex-hook.js", [], state("UserPromptSubmit")],
    ["qoder", "qoder-hook.js", ["PreToolUse"], state("PreToolUse")],
    ["reasonix", "reasonix-hook.js", [], { event: "PostToolUse", sessionId: SESSION, cwd: "/tmp", toolName: "bash" }],
    ["qoderwork", "qoderwork-hook.js", ["PreToolUse"], state("PreToolUse")],
    ["traecode", "traecode-hook.js", [], state("PreToolUse")],
    ["qwenwork", "qwenwork-hook.js", ["PreToolUse"], state("PreToolUse")],
  ];
  let harness;

  beforeEach(() => {
    harness = createSpawnedHookHarness({ prefix: "agenthalo-store-entry-" });
  });

  afterEach(() => harness.cleanup());

  // What a run sent to AgentHalo, without the per-process fields.
  function sent(result) {
    return (result.attempts || []).filter((attempt) => attempt.kind === "request").map((attempt) => {
      let body = null;
      try { body = JSON.parse(attempt.body); } catch { body = attempt.body; }
      const keep = body && typeof body === "object"
        ? Object.fromEntries(["state", "event", "session_id", "agent_id", "hook_source"].map((key) => [key, body[key]]))
        : body;
      return { method: attempt.method, path: attempt.path, body: keep };
    });
  }

  for (const [agentId, shared, args, payload, env] of ENTRIES) {
    it(`${ownership.STORE_HOOK_SCRIPTS[agentId]} runs ${shared} as \`node ${shared}\` does`, () => {
      const script = ownership.STORE_HOOK_SCRIPTS[agentId];
      const source = fs.readFileSync(path.join(__dirname, "..", "hooks", script), "utf8");
      assert.match(source, new RegExp(`^require\\("\\./${shared.replace(/[.]/g, "\\.")}"\\)(\\.runCli\\(\\))?;$`, "m"));

      const run = (file) => harness.run({
        script: path.join(__dirname, "..", "hooks", file),
        args,
        payload,
        httpContract: "expect-attempt",
        env: { CLAWD_POST_RECORDER_SUCCEED: "1", ...(env || {}) },
      });
      const direct = run(shared);
      const viaEntry = run(script);
      assert.equal(viaEntry.status, direct.status, viaEntry.stderr);
      assert.equal(viaEntry.stdout, direct.stdout);
      assert.deepEqual(sent(viaEntry), sent(direct));
      assert.ok(sent(direct).length > 0, `${shared} posted nothing, so this comparison proves nothing`);
    });
  }
});

describe("store ownership rules", () => {
  const { STORE_HOOK_SCRIPTS, isStoreOwnedCommand, isLegacyStoreCommand } = ownership;
  const gemini = STORE_HOOK_SCRIPTS["gemini-cli"];

  it("name no script another install matches", () => {
    for (const script of Object.values(STORE_HOOK_SCRIPTS)) {
      for (const marker of OTHER_MARKERS) assert.equal(script.includes(marker), false, `${script} / ${marker}`);
      assert.ok(fs.existsSync(path.join(__dirname, "..", "hooks", script)), script);
    }
    assert.equal(STORE_HOOK_SCRIPTS["claude-code"], require("../hooks/install").STORE_HOOK_SCRIPT);
  });

  it("recognise an earlier store entry only inside this app's own bundle", () => {
    const own = `"${LAUNCHER}" "${HOOKS_DIR}/gemini-hook.js" "BeforeTool"`;
    assert.equal(isLegacyStoreCommand(own, "gemini-hook.js"), true);
    assert.equal(isStoreOwnedCommand(own, gemini, "gemini-hook.js"), true);
    // Another install that took the launcher for its Node path runs its own script.
    const foreign = `"${LAUNCHER}" "/Applications/AgentHalo.app/Contents/Resources/app.asar.unpacked/hooks/gemini-hook.js" "BeforeTool"`;
    assert.equal(isStoreOwnedCommand(foreign, gemini, "gemini-hook.js"), false);
    assert.equal(isStoreOwnedCommand(`"${OTHER_NODE}" "${HOOKS_DIR}/gemini-hook.js" "BeforeTool"`, gemini, "gemini-hook.js"), false);
    // Moved or updated store app: the entry script name is the marker.
    assert.equal(isStoreOwnedCommand(`"/Moved.app/hooks/node-launcher.sh" "/Moved.app/hooks/${gemini}" "Stop"`, gemini, "gemini-hook.js"), true);
    assert.equal(isStoreOwnedCommand(`"/x/node" "/x/my-${gemini}"`, gemini, "gemini-hook.js"), false);
  });

  it("follow the build unless told otherwise", () => {
    const previous = process.mas;
    try {
      process.mas = true;
      assert.equal(ownership.isStoreHookInstall(), true);
      assert.equal(ownership.isStoreHookInstall({ storeHooks: false }), false);
      assert.equal(ownership.isStoreHookInstall({ remote: true }), false);
      process.mas = undefined;
      assert.equal(ownership.isStoreHookInstall(), false);
      assert.equal(ownership.isStoreHookInstall({ storeHooks: true }), true);
    } finally {
      process.mas = previous;
    }
  });

  it("keep another install's permission hooks, even on the store build's port", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-store-permission-"));
    try {
      // The other install once ran on the port the store build has now.
      const cb = TOOLS.find((entry) => entry.id === "codebuddy");
      cb.seed(home);
      cb.register(home, { ...otherOptions(), port: STORE_PORT });
      cb.register(home, storeOptions(cb));
      const urls = () => hookRecords(readJson(cb.files(home)[0]).hooks.PermissionRequest).map((r) => r.text);
      assert.deepEqual(urls(), [USER_URL, buildPermissionUrl(STORE_PORT), buildStorePermissionUrl(STORE_PORT)]);
      cb.unregister(home, storeOptions(cb));
      assert.deepEqual(urls(), [USER_URL, buildPermissionUrl(STORE_PORT)]);

      // WorkBuddy no longer registers one; a leftover belongs to whoever wrote it.
      const wb = TOOLS.find((entry) => entry.id === "workbuddy");
      wb.seed(home);
      const settingsPath = wb.files(home)[0];
      const settings = readJson(settingsPath);
      settings.hooks.PermissionRequest = [{ matcher: "", hooks: [{ type: "http", url: buildPermissionUrl(OTHER_PORT) }] }];
      writeJson(settingsPath, settings);
      wb.register(home, storeOptions(wb));
      wb.unregister(home, storeOptions(wb));
      assert.deepEqual(hookRecords(readJson(settingsPath).hooks.PermissionRequest).map((r) => r.text), [
        buildPermissionUrl(OTHER_PORT),
      ]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("leave ZCode alone when the store build has no Node executable to run its hooks", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-store-zcode-"));
    try {
      const tool = TOOLS.find((entry) => entry.id === "zcode");
      tool.seed(home);
      tool.register(home, otherOptions());
      const before = snapshot(tool, home);
      assert.throws(() => tool.register(home, { storeHooks: true }), /absolute Node executable/);
      assert.deepEqual(snapshot(tool, home), before);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
