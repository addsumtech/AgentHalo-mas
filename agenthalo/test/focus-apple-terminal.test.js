const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadFocusWithMock } = require("./helpers/load-focus-with-mock");

const TERMINAL = "/System/Applications/Utilities/Terminal.app";

function setup(t, options = {}) {
  const calls = [];
  const logs = [];
  const pendingScripts = [];
  const bundle = options.bundle || TERMINAL;
  const { initFocus, cleanup } = loadFocusWithMock((cmd, args, opts, callback) => {
    calls.push({ cmd, args, opts });
    if (cmd === "ps") {
      if (args.includes("pid=,tty=")) {
        const output = typeof options.ttyOutput === "function"
          ? options.ttyOutput(args.at(-1))
          : options.ttyOutput ?? "600 ttys001\n700 ttys004\n";
        callback(options.psError || null, output, "");
      } else if (args.includes("pid=,comm=")) {
        callback(null, `500 ${bundle}/Contents/MacOS/Terminal\n`, "");
      } else {
        callback(null, `${bundle}/Contents/MacOS/Terminal\n`, "");
      }
    } else if (cmd === "osascript" && args[1].includes('application id "com.apple.Terminal"')) {
      if (options.deferScript) pendingScripts.push(callback);
      else callback(options.scriptError || null, options.scriptOutput ?? "ok-tty\n", options.stderr || "");
    } else callback(null, "", "");
  });
  const focus = initFocus({ focusLog: message => logs.push(message) });
  t.after(() => { focus.cleanup(); cleanup(); });
  return {
    focus, calls, logs, pendingScripts,
    scripts: () => calls.filter(c => c.cmd === "osascript" && c.args[1].includes('application id "com.apple.Terminal"')),
    opens: () => calls.filter(c => c.cmd === "/usr/bin/open"),
  };
}

describe("Apple Terminal session focus", () => {
  it("uses the session's TTY in process-chain order and restores its exact tab/window", t => {
    const ctx = setup(t);
    ctx.focus.focusTerminalWindow(500, "/same/project", null, [700, 600, 500]);
    const [call] = ctx.scripts();
    assert.ok(call);
    assert.equal(call.args.at(-1), "/dev/ttys004");
    assert.match(call.args[1], /tty of t is targetTty/);
    assert.match(call.args[1], /set selected tab of window id targetWindowId to t/);
    assert.match(call.args[1], /set miniaturized of window id targetWindowId to false/);
    assert.match(call.args[1], /tty of selected tab of front window is targetTty/);
    assert.equal(call.opts.timeout, 15000);
    assert.equal(ctx.opens().length, 0);
    assert.ok(ctx.logs.some(l => l.includes("branch=terminal-tab reason=ok-tty")));
  });

  it("uses surviving parent TTY output when a transient process has exited", t => {
    const ctx = setup(t, { ttyOutput: "600 /dev/ttys001\n", psError: new Error("partial ps output") });
    ctx.focus.focusTerminalWindow(500, "", null, [700, 600, 500]);
    assert.equal(ctx.scripts()[0].args.at(-1), "/dev/ttys001");
  });

  for (const [name, chain, output] of [
    ["missing process chain", null, ""],
    ["detached process", [700, 500], "700 ??\n"],
    ["malformed TTY", [700, 500], '700 ttys001";do shell script "bad"\n'],
  ]) {
    it(`keeps app activation as a fallback for a ${name}`, t => {
      const ctx = setup(t, { ttyOutput: output });
      ctx.focus.focusTerminalWindow(500, "", null, chain);
      assert.equal(ctx.scripts().length, 0);
      assert.deepEqual(ctx.opens().map(c => c.args), [[TERMINAL]]);
      assert.ok(!ctx.logs.some(l => l.includes("reason=ok-tty")));
    });
  }

  it("leaves other applications on their existing activation path", t => {
    const bundle = "/Applications/Visual Studio Code.app";
    const ctx = setup(t, { bundle });
    ctx.focus.focusTerminalWindow(500, "", null, [700, 600, 500]);
    assert.equal(ctx.scripts().length, 0);
    assert.deepEqual(ctx.opens().map(c => c.args), [[bundle]]);
  });

  it("reports a missing tab without claiming that app activation selected it", t => {
    const ctx = setup(t, { scriptOutput: "miss-tty\n" });
    ctx.focus.focusTerminalWindow(500, "", null, [700, 500]);
    assert.equal(ctx.opens().length, 1);
    assert.ok(ctx.logs.some(l => l.includes("branch=terminal-tab reason=miss-tty")));
    assert.ok(!ctx.logs.some(l => l.includes("reason=ok-tty")));
  });

  it("records denied Automation consent and preserves the previous app activation fallback", t => {
    const ctx = setup(t, {
      scriptError: Object.assign(new Error("osascript exited"), { code: 1 }),
      stderr: "Not authorized to send Apple events to Terminal. (-1743)",
    });
    ctx.focus.focusTerminalWindow(500, "", null, [700, 500]);
    assert.equal(ctx.opens().length, 1);
    assert.ok(ctx.logs.some(l => l.includes("branch=terminal-tab reason=automation-denied")));
  });

  it("serializes two sessions sharing the Terminal PID until the first tab switch finishes", t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
    const ctx = setup(t, {
      deferScript: true,
      ttyOutput: pids => pids.includes("800") ? "800 ttys001\n" : "700 ttys004\n",
    });
    ctx.focus.focusTerminalWindow({ sourcePid: 500, pidChain: [700, 500], sessionId: "first" });
    t.mock.timers.tick(2000);
    ctx.focus.focusTerminalWindow({ sourcePid: 500, pidChain: [800, 500], sessionId: "second" });
    assert.deepEqual(ctx.scripts().map(c => c.args.at(-1)), ["/dev/ttys004"]);
    ctx.pendingScripts.shift()(null, "ok-tty\n", "");
    assert.deepEqual(ctx.scripts().map(c => c.args.at(-1)), ["/dev/ttys004", "/dev/ttys001"]);
    ctx.pendingScripts.shift()(null, "ok-tty\n", "");
    assert.equal(ctx.opens().length, 0);
  });
});
