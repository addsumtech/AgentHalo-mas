"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSystemAudioCheck } = require("../src/system-audio");

test("macOS mute is re-read for each playback and never changes output settings", async () => {
  const values = ["true\n", "false\n", "true\n"];
  const check = createSystemAudioCheck({ platform: "darwin", execFileImpl: (file, args, options, callback) => {
    assert.equal(file, "/usr/bin/osascript");
    assert.deepEqual(args, ["-e", "set currentOutput to get volume settings\nreturn (output muted of currentOutput) or ((output volume of currentOutput) = 0)"]);
    assert.equal(options.timeout, 1000);
    callback(null, values.shift());
  } });
  assert.equal(await check(), true);
  assert.equal(await check(), false);
  assert.equal(await check(), true);
});

test("failed or invalid system mute probes skip sound", async () => {
  for (const [error, output] of [[new Error("timeout"), ""], [null, "unknown"]]) {
    const check = createSystemAudioCheck({ platform: "darwin", execFileImpl: (_file, _args, _options, cb) => cb(error, output) });
    assert.equal(await check(), true);
  }
});
