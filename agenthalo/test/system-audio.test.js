"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSystemAudioCheck } = require("../src/system-audio");

const SCRIPT = "set currentOutput to get volume settings\nreturn (output muted of currentOutput) or ((output volume of currentOutput) = 0)";

test("macOS mute is read once per cache window and never changes output settings", async () => {
  const values = ["true\n", "false\n", "true\n"];
  let clock = 1000;
  let spawns = 0;
  const check = createSystemAudioCheck({
    platform: "darwin",
    now: () => clock,
    execFileImpl: (file, args, options, callback) => {
      spawns += 1;
      assert.equal(file, "/usr/bin/osascript");
      assert.deepEqual(args, ["-e", SCRIPT]);
      assert.equal(options.timeout, 1000);
      callback(null, values.shift());
    },
  });
  assert.equal(await check(), true);
  clock += 2999;
  assert.equal(await check(), true, "a burst of sounds reuses the answer");
  assert.equal(spawns, 1);
  clock += 1;
  assert.equal(await check(), false, "the state is re-read after the cache window");
  clock += 3000;
  assert.equal(await check(), true);
  assert.equal(spawns, 3);
});

test("concurrent checks share one osascript probe", async () => {
  const callbacks = [];
  const check = createSystemAudioCheck({
    platform: "darwin",
    execFileImpl: (_file, _args, _options, callback) => callbacks.push(callback),
  });
  const first = check();
  const second = check();
  assert.equal(callbacks.length, 1);
  callbacks[0](null, "false\n");
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
});

test("failed or invalid system mute probes skip sound", async () => {
  for (const [error, output] of [[new Error("timeout"), ""], [null, "unknown"]]) {
    const check = createSystemAudioCheck({ platform: "darwin", execFileImpl: (_file, _args, _options, cb) => cb(error, output) });
    assert.equal(await check(), true);
  }
});

test("other platforms leave mute to the system mixer without probing", async () => {
  const check = createSystemAudioCheck({
    platform: "linux",
    execFileImpl: () => assert.fail("must not spawn"),
  });
  assert.equal(await check(), false);
});
