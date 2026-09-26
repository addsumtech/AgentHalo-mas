"use strict";

// The store build's stand-in for /bin/ps, which the App Sandbox refuses to
// exec: the bundled proc-info helper (native/proc-info/proc-info.c) and the
// module that runs it (src/mac-proc-info.js).

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const procInfo = require("../src/mac-proc-info");
const { getProcessStartIdentity } = require("../hooks/session-recovery-lease");
const { loadFocusWithMock } = require("./helpers/load-focus-with-mock");

const ROOT = path.join(__dirname, "..");

function row(pid, overrides = {}) {
  return JSON.stringify({
    pid,
    ppid: 1,
    start: 1790426214,
    startUsec: 119217,
    tty: null,
    comm: "zsh",
    path: "/bin/zsh",
    argv0: "-zsh",
    ...overrides,
  });
}

describe("proc-info output", () => {
  it("parses one object per live pid and leaves out missing and malformed lines", () => {
    const stdout = [
      row(100, { tty: "ttys003" }),
      JSON.stringify({ pid: 101, missing: true }),
      JSON.stringify({ missing: true }),
      "not json",
      JSON.stringify({ pid: -3, start: 1 }),
      row(102, { path: null, argv0: null, start: 0, ppid: "x" }),
      "",
    ].join("\n");
    const infoByPid = procInfo.parseProcInfoOutput(stdout);
    assert.deepEqual([...infoByPid.keys()], [100, 102]);
    assert.deepEqual(infoByPid.get(100), {
      pid: 100,
      ppid: 1,
      startSec: 1790426214,
      startUsec: 119217,
      tty: "ttys003",
      comm: "zsh",
      path: "/bin/zsh",
      argv0: "-zsh",
    });
    assert.deepEqual(infoByPid.get(102), {
      pid: 102,
      ppid: null,
      startSec: null,
      startUsec: 119217,
      tty: null,
      comm: "zsh",
      path: null,
      argv0: null,
    });
    assert.equal(procInfo.parseProcInfoOutput(undefined).size, 0);
  });

  it("finds the helper in Contents/Resources/bin", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-proc-info-"));
    try {
      assert.equal(procInfo.resolveHelperPath({ resourcesPath: dir }), null);
      fs.mkdirSync(path.join(dir, "bin"));
      fs.writeFileSync(path.join(dir, "bin", "proc-info"), "");
      assert.equal(procInfo.resolveHelperPath({ resourcesPath: dir }), path.join(dir, "bin", "proc-info"));
      // Plain Node (tests, the hook) has no resources path.
      if (process.resourcesPath === undefined) assert.equal(procInfo.resolveHelperPath(), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns no identities when the helper is missing or fails", () => {
    const missingHelper = path.join(os.tmpdir(), `agenthalo-no-helper-${process.pid}`);
    assert.equal(procInfo.getProcessStartIdentities([100], { resourcesPath: missingHelper }).size, 0);
    const failing = procInfo.getProcessStartIdentities([100], {
      helperPath: "/fake/proc-info",
      execFileSync: () => { throw Object.assign(new Error("killed"), { signal: "SIGTERM" }); },
    });
    assert.equal(failing.size, 0);
  });

  it("derives the same darwin:<epoch seconds> identity the hook writes", () => {
    const calls = [];
    const identities = procInfo.getProcessStartIdentities([100, 100, 0, "x", 101, 102], {
      helperPath: "/fake/proc-info",
      execFileSync: (file, args, options) => {
        calls.push({ file, args, options });
        return [row(100), JSON.stringify({ pid: 101, missing: true }), row(102, { start: 0 })].join("\n");
      },
    });
    assert.deepEqual([...identities], [[100, "darwin:1790426214"]]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, "/fake/proc-info");
    assert.deepEqual(calls[0].args, ["100", "101", "102"]);
    assert.equal(calls[0].options.encoding, "utf8");
    assert.ok(calls[0].options.timeout > 0);
  });

  it("asks for at most as many pids as the helper accepts", () => {
    let seen = null;
    procInfo.queryProcInfoSync(Array.from({ length: 100 }, (_, index) => index + 1), {
      helperPath: "/fake/proc-info",
      execFileSync: (_file, args) => { seen = args; return ""; },
    });
    assert.equal(seen.length, procInfo.MAX_PIDS);
  });
});

describe("ps columns from proc-info", () => {
  function run(columns, pids, stdout) {
    return new Promise((resolve) => {
      procInfo.execPsColumns(columns, pids, {
        helperPath: "/fake/proc-info",
        timeout: 500,
        execFile: (file, args, options, callback) => callback(null, stdout, ""),
      }, (err, out) => resolve({ err, out }));
    });
  }

  it("prints comm the way ps does: argv[0], else the executable path, else the short name", async () => {
    const stdout = [
      row(100, { argv0: "claude", path: "/opt/homebrew/bin/claude.exe" }),
      row(200, { argv0: null, path: "/Applications/iTerm.app/Contents/MacOS/iTerm2", comm: "iTerm2" }),
      row(300, { argv0: null, path: null, comm: "tmux" }),
    ].join("\n");
    const { err, out } = await run("pid=,comm=", [100, 200, 300], stdout);
    assert.equal(err, null);
    assert.equal(out, "100 claude\n200 /Applications/iTerm.app/Contents/MacOS/iTerm2\n300 tmux\n");
  });

  it("prints ?? without a controlling terminal and keeps the order asked", async () => {
    const stdout = [row(100, { tty: "ttys003" }), row(200)].join("\n");
    const { err, out } = await run("pid=,tty=", [200, 100], stdout);
    assert.equal(err, null);
    assert.equal(out, "200 ??\n100 ttys003\n");
  });

  it("reports a gone pid like ps: an error, with the live rows still printed", async () => {
    const stdout = [row(100, { tty: "ttys003" }), JSON.stringify({ pid: 200, missing: true })].join("\n");
    const { err, out } = await run("pid=,tty=", [100, 200], stdout);
    assert.equal(err.code, 1);
    assert.equal(out, "100 ttys003\n");
  });

  it("refuses columns the helper cannot answer, and fails without the helper", async () => {
    const { err } = await run("pid=,lstart=", [100], "");
    assert.equal(err.code, "EINVAL");
    const missing = await new Promise((resolve) => {
      procInfo.execPsColumns("comm=", [100], {
        resourcesPath: path.join(os.tmpdir(), `agenthalo-no-helper-${process.pid}`),
        execFile: () => assert.fail("nothing to run"),
      }, (error, out) => resolve({ error, out }));
    });
    assert.equal(missing.error.code, "ENOENT");
    assert.equal(missing.out, "");
  });
});

describe("focus lookups in the store build", () => {
  let dir;
  let savedResourcesPath;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-focus-proc-info-"));
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin", "proc-info"), "");
    savedResourcesPath = process.resourcesPath;
  });

  after(() => {
    process.resourcesPath = savedResourcesPath;
    delete process.mas;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("asks the helper instead of the setuid ps", (t, done) => {
    const helper = path.join(dir, "bin", "proc-info");
    const calls = [];
    const { initFocus, cleanup } = loadFocusWithMock((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      calls.push({ cmd, args: [...args] });
      if (cmd === helper) {
        cb(null, [row(100), row(200, { argv0: "tmux" }), row(300, { argv0: "/Applications/Ghostty.app/Contents/MacOS/ghostty" })].join("\n"), "");
        return;
      }
      if (cmd === "/fake/tmux" && args.includes("list-panes")) {
        cb(null, "100 @3 %7 work\n", "");
        return;
      }
      if (cb) cb(null, "", "");
    });
    const focus = initFocus({});
    focus.__test.__setTmuxBin("/fake/tmux");
    process.resourcesPath = dir;
    process.mas = true;
    try {
      focus.__test.scheduleTmuxPaneFocus([100, 200, 300]);
      assert.equal(focus.captureGhosttyTerminalId({ sourcePid: 300, cwd: "/tmp" }), false,
        "the store build cannot script Ghostty, so it does not probe for its terminal id");
    } finally {
      process.resourcesPath = savedResourcesPath;
      delete process.mas;
    }

    setTimeout(() => {
      cleanup();
      assert.equal(calls.some((call) => call.cmd === "ps"), false, "ps must not be spawned");
      const helperCall = calls.find((call) => call.cmd === helper);
      assert.deepEqual(helperCall.args, ["100", "200", "300"]);
      assert.ok(calls.some((call) => call.cmd === "/fake/tmux" && call.args.includes("select-pane")),
        "the tmux pane found through the helper is focused");
      done();
    }, 700);
  });

  it("keeps spawning ps outside the store build", (t, done) => {
    const calls = [];
    const { initFocus, cleanup } = loadFocusWithMock((cmd, args, opts, cb) => {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      calls.push({ cmd, args: [...args] });
      if (cb) cb(null, "", "");
    });
    const focus = initFocus({});
    focus.__test.__setTmuxBin("/fake/tmux");
    focus.__test.scheduleTmuxPaneFocus([100, 200]);
    setTimeout(() => {
      cleanup();
      assert.deepEqual(calls[0], { cmd: "ps", args: ["-o", "pid=,comm=", "-p", "100,200"] });
      done();
    }, 50);
  });
});

describe("the proc-info helper on this Mac", { skip: process.platform !== "darwin" }, () => {
  let dir;
  let helper;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-proc-info-build-"));
    helper = path.join(dir, "proc-info");
    execFileSync("xcrun", [
      "clang", "-O2", "-Wall", "-Wextra", "-Werror",
      "-o", helper, path.join(ROOT, "native", "proc-info", "proc-info.c"),
    ], { stdio: "pipe" });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("agrees with ps on start time, terminal and command name", () => {
    const pids = [process.pid, process.ppid];
    const infoByPid = procInfo.queryProcInfoSync(pids, { helperPath: helper });
    const identities = procInfo.getProcessStartIdentities(pids, { helperPath: helper });
    for (const pid of pids) {
      assert.equal(identities.get(pid), getProcessStartIdentity(pid, { platform: "darwin" }), `start of ${pid}`);
      const ps = (column) => execFileSync("ps", ["-o", `${column}=`, "-p", String(pid)], { encoding: "utf8" }).trim();
      assert.equal(infoByPid.get(pid).tty || "??", ps("tty"), `tty of ${pid}`);
      assert.equal(infoByPid.get(pid).argv0, ps("comm"), `comm of ${pid}`);
      assert.equal(infoByPid.get(pid).ppid, Number(ps("ppid")), `ppid of ${pid}`);
    }
    assert.equal(infoByPid.get(process.pid).path, fs.realpathSync(process.execPath));
  });

  it("marks pids it cannot read and rejects unusable arguments", () => {
    const out = execFileSync(helper, ["99999999", "abc", "-5"], { encoding: "utf8" });
    assert.deepEqual(out.trim().split("\n").map((line) => JSON.parse(line)), [
      { pid: 99999999, missing: true },
      { missing: true },
      { missing: true },
    ]);
    assert.equal(spawnSync(helper, []).status, 2);
    assert.equal(spawnSync(helper, Array.from({ length: 65 }, () => "1")).status, 2);
  });
});
