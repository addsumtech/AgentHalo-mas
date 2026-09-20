"use strict";

// Regressions for defects an adversarial review found and the existing suite
// did not: a null permission body killed the process, multi-byte text was
// corrupted at chunk boundaries, and inherited Object.prototype keys passed as
// valid states. The request stub emits two data events so a body that arrives
// split mid-character is exercised without opening a socket.

const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { handleStatePost } = require("../src/server-route-state");
const prefs = require("../src/prefs");

// Splits the payload at a byte offset that lands inside a multi-byte
// character, which is what a real socket read does for anything sizeable.
function makeSplitReq(text) {
  const req = new EventEmitter();
  req.headers = {};
  const payload = Buffer.from(text, "utf8");
  const cut = Math.floor(payload.length / 2);
  setImmediate(() => {
    req.emit("data", payload.subarray(0, cut));
    req.emit("data", payload.subarray(cut));
    req.emit("end");
  });
  return req;
}

function makeRes(done) {
  return {
    statusCode: null,
    payload: "",
    writeHead(status) { this.statusCode = status; },
    end(text) { this.payload = text || ""; done(this); },
  };
}

function callState(req, onUpdate) {
  return new Promise((resolve) => {
    const ctx = {
      STATE_SVGS: {
        idle: "x.svg", thinking: "x.svg", working: "x.svg",
        juggling: "x.svg", error: "x.svg", attention: "x.svg",
        notification: "x.svg", sleeping: "x.svg",
      },
      pendingPermissions: [],
      sessions: new Map(),
      getCustomAgentIds: () => [],
      codexSubagentClassifier: { registerSession: () => "root" },
      isAgentEnabled: () => true,
      setState: () => {},
      updateSession: (...args) => onUpdate(...args),
      updateAccountQuota: () => {},
      resolvePermissionEntry: () => {},
      permLog: () => {},
      showCodexUserInputBubble: () => true,
      clearCodexUserInputBubbles: () => {},
      handleTestResult: () => {},
    };
    handleStatePost(req, makeRes(resolve), {
      ctx,
      createRequestHookRecorder: () => ({
        accepted() {}, acceptedUnlessDnd() {}, droppedByDisabled() {},
        droppedByDnd() {}, droppedInvalidAgent() {}, droppedUnsupported() {},
      }),
      shouldDropForDnd: () => false,
      codexOfficialTurns: new Map(),
    });
  });
}

test("a state body split mid-character survives intact", async () => {
  const seen = [];
  // Long enough that the halfway cut lands inside the CJK run.
  const cwd = `/Users/you/Desktop/${"桌面宠物项目".repeat(40)}`;
  const res = await callState(
    makeSplitReq(JSON.stringify({
      state: "working", session_id: "s", event: "PreToolUse", agent_id: "claude-code", cwd,
    })),
    (...args) => seen.push(args)
  );
  assert.strictEqual(res.statusCode, 200, res.payload);
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0][3].cwd, cwd);
  assert.ok(!seen[0][3].cwd.includes("\uFFFD"), "no replacement characters");
});

test("inherited Object.prototype keys are not valid states", async () => {
  for (const state of ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"]) {
    const seen = [];
    const res = await callState(
      makeSplitReq(JSON.stringify({
        state, session_id: "s", event: "PreToolUse", agent_id: "claude-code",
      })),
      (...args) => seen.push(args)
    );
    assert.strictEqual(res.statusCode, 400, `${state} should be rejected`);
    assert.deepStrictEqual(seen, [], `${state} must not reach the session map`);
  }
  // A real state still works, so the guard is not too tight.
  const ok = [];
  const res = await callState(
    makeSplitReq(JSON.stringify({
      state: "working", session_id: "s", event: "PreToolUse", agent_id: "claude-code",
    })),
    (...args) => ok.push(args[1])
  );
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(ok, ["working"]);
});

test("a permission body of null is rejected before any field is read", () => {
  // The crash was a TypeError escaping the request handler, so the guard has to
  // sit above the first property access rather than inside the later try block.
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "server-route-permission.js"), "utf8"
  );
  const guard = source.indexOf('if (!data || typeof data !== "object" || Array.isArray(data))');
  const firstRead = source.indexOf("data.hook_event_name");
  assert.ok(guard > 0, "null and non-object bodies are rejected");
  assert.ok(firstRead > guard, "the guard runs before any field is read");
});

test("neither route concatenates raw buffers into a string", () => {
  for (const file of ["server-route-state.js", "server-route-permission.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
    // Anchored to a statement so the comment explaining the fix does not match.
    assert.ok(!/^\s*body \+= chunk/m.test(source), `${file} must not decode chunks separately`);
    assert.ok(/Buffer\.concat\(bodyChunks\)/.test(source), `${file} decodes once at the end`);
  }
});

test("a field this build does not know about survives a save", () => {
  // An additive field does not force a CURRENT_VERSION bump, so a rollback saw
  // a file it also considered current and its first save dropped the value.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-prefs-"));
  const file = path.join(dir, "agenthalo-prefs.json");
  try {
    fs.writeFileSync(file, JSON.stringify({
      version: prefs.getDefaults().version,
      lang: "ja",
      futureFeatureEnabled: true,
    }));
    const loaded = prefs.load(file);
    assert.strictEqual(loaded.snapshot.futureFeatureEnabled, true, "kept on load");
    prefs.save(file, loaded.snapshot);
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(after.futureFeatureEnabled, true, "kept on save");
    assert.strictEqual(after.lang, "ja", "known fields still round-trip");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown __proto__ key cannot reach the prototype", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-prefs-"));
  const file = path.join(dir, "agenthalo-prefs.json");
  try {
    fs.writeFileSync(file, '{"version":19,"__proto__":{"polluted":true}}');
    prefs.load(file);
    assert.strictEqual({}.polluted, undefined, "Object.prototype is untouched");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saving preferences never truncates the file in place", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthalo-prefs-"));
  const file = path.join(dir, "agenthalo-prefs.json");
  try {
    prefs.save(file, { ...prefs.getDefaults(), lang: "ja" });
    assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).lang, "ja");
    // A tmp+rename writer leaves no siblings behind once it succeeds.
    assert.deepStrictEqual(
      fs.readdirSync(dir).filter((name) => name !== "agenthalo-prefs.json"),
      [],
      "no temp file is left behind"
    );
    prefs.save(file, { ...prefs.getDefaults(), lang: "ko" });
    assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).lang, "ko");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
