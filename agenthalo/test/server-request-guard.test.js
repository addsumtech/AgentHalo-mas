"use strict";

// The local hook server must turn away browser pages (simple cross-origin
// POSTs) and DNS-rebinding hosts while every first-party client keeps working.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const initServer = require("../src/server");
const { inspectLocalRequest } = require("../src/server-request-guard");
const { postStateToPort, probePort } = require("../hooks/server-config");

const PORT = 23333;
const EXTENSION_ORIGIN = `chrome-extension://${"abcdefghijklmnop".repeat(2)}`;

function req(method, headers = {}, rawHeaders = null) {
  return {
    method,
    headers,
    rawHeaders: rawHeaders || Object.entries(headers).flat(),
  };
}

const nativePost = (extra = {}) => req("POST", {
  host: `127.0.0.1:${PORT}`,
  "content-type": "application/json",
  ...extra,
});

describe("inspectLocalRequest", () => {
  it("accepts a native hook POST and GET, with or without a charset", () => {
    assert.strictEqual(inspectLocalRequest(nativePost(), { port: PORT }), null);
    assert.strictEqual(inspectLocalRequest(nativePost({ "content-type": "Application/JSON; charset=utf-8" }), { port: PORT }), null);
    assert.strictEqual(inspectLocalRequest(req("GET", { host: `127.0.0.1:${PORT}` }), { port: PORT }), null);
  });

  it("accepts every literal loopback authority on the server's own port", () => {
    for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `LocalHost:${PORT}`, `[::1]:${PORT}`]) {
      assert.strictEqual(inspectLocalRequest(nativePost({ host }), { port: PORT }), null, host);
    }
  });

  it("rejects rebound, foreign, portless and missing Host authorities with 403", () => {
    for (const host of [
      `evil.example:${PORT}`,
      `127.0.0.1.evil.example:${PORT}`,
      `127.0.0.1:${PORT + 1}`,
      "127.0.0.1",
      "localhost",
      `127.0.0.1:${PORT}@evil.example`,
      `0.0.0.0:${PORT}`,
      "",
      undefined,
    ]) {
      const headers = { "content-type": "application/json" };
      if (host !== undefined) headers.host = host;
      assert.deepStrictEqual(
        inspectLocalRequest(req("POST", headers), { port: PORT }),
        { status: 403, reason: "host" },
        String(host)
      );
    }
    // Before the server knows its port nothing can match.
    assert.deepStrictEqual(inspectLocalRequest(nativePost(), { port: null }), { status: 403, reason: "host" });
  });

  it("rejects every Origin except a browser extension's with 403", () => {
    for (const origin of [
      "https://evil.example",
      `http://127.0.0.1:${PORT}`,
      "null",
      "",
      "chrome-extension://short",
      `${EXTENSION_ORIGIN}.evil.example`,
      `moz-extension://${"a".repeat(32)}`,
    ]) {
      assert.deepStrictEqual(
        inspectLocalRequest(nativePost({ origin }), { port: PORT }),
        { status: 403, reason: "origin" },
        origin
      );
    }
    assert.strictEqual(inspectLocalRequest(nativePost({ origin: EXTENSION_ORIGIN }), { port: PORT }), null);
    assert.strictEqual(
      inspectLocalRequest(req("GET", { host: `127.0.0.1:${PORT}`, origin: EXTENSION_ORIGIN }), { port: PORT }),
      null
    );
  });

  it("rejects POST bodies a page can send without a preflight with 415", () => {
    for (const type of [
      "text/plain",
      "text/plain; charset=utf-8",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "application/json-patch+json",
      "",
      undefined,
    ]) {
      const headers = { host: `127.0.0.1:${PORT}` };
      if (type !== undefined) headers["content-type"] = type;
      assert.deepStrictEqual(
        inspectLocalRequest(req("POST", headers), { port: PORT }),
        { status: 415, reason: "content-type" },
        String(type)
      );
    }
  });

  it("rejects a repeated Host or Content-Type instead of trusting the first copy", () => {
    const host = `127.0.0.1:${PORT}`;
    assert.deepStrictEqual(
      inspectLocalRequest(req("POST", { host, "content-type": "application/json" },
        ["Host", host, "Host", `evil.example:${PORT}`, "Content-Type", "application/json"]), { port: PORT }),
      { status: 400, reason: "duplicate-host" }
    );
    assert.deepStrictEqual(
      inspectLocalRequest(req("POST", { host, "content-type": "application/json" },
        ["Host", host, "Content-Type", "application/json", "content-type", "text/plain"]), { port: PORT }),
      { status: 400, reason: "duplicate-content-type" }
    );
  });
});

describe("local hook server over real HTTP", () => {
  let api = null;
  let port = null;
  const updateSessionCalls = [];
  const logs = [];
  const pendingPermissions = [];

  before(async () => {
    // Borrow a free port so the server's own Host check sees the real one.
    port = await new Promise((resolve, reject) => {
      const probe = http.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address();
        probe.close(() => resolve(free));
      });
    });
    api = initServer({
      setImmediate: () => {},
      getPortCandidates: () => [port],
      writeRuntimeConfig: () => true,
      clearRuntimeConfig: () => true,
      readRuntimePort: () => null,
      syncClawdHooksImpl: () => {},
      STATE_SVGS: { idle: "x.svg", working: "x.svg", thinking: "x.svg", attention: "x.svg" },
      pendingPermissions,
      isAgentEnabled: () => true,
      isAgentPermissionsEnabled: () => true,
      setState: () => {},
      updateSession: (...args) => updateSessionCalls.push(args),
      resolvePermissionEntry: () => {},
      permLog: () => {},
      debugLog: (msg) => logs.push(msg),
    });
    assert.strictEqual(await api.startHttpServer(), port);
  });

  after(() => {
    if (api) api.cleanup();
  });

  function send({ method = "POST", path = "/state", headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port, method, path, headers }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      request.on("error", reject);
      request.end(body);
    });
  }

  const stateBody = (sessionId) => JSON.stringify({
    agent_id: "claude-code",
    session_id: sessionId,
    state: "working",
    event: "PreToolUse",
  });

  it("still serves the shipped hook client's probe and state POST", async () => {
    const options = { env: {}, sshSecure: false };
    const probed = await new Promise((resolve) => probePort(port, 2000, resolve, options));
    assert.strictEqual(probed, true);
    const before = updateSessionCalls.length;
    const posted = await new Promise((resolve) => postStateToPort(port, stateBody("native"), 2000, resolve, options));
    assert.strictEqual(posted, true);
    assert.strictEqual(updateSessionCalls.length, before + 1);
  });

  it("accepts the web bridge extension's JSON POST", async () => {
    const res = await send({
      headers: { "Content-Type": "application/json", Origin: EXTENSION_ORIGIN },
      body: stateBody("extension"),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["x-clawd-server"], "clawd-on-desk");
  });

  it("turns away a page's text/plain state POST before it reaches a session", async () => {
    const before = updateSessionCalls.length;
    const res = await send({
      headers: { "Content-Type": "text/plain", Origin: "https://evil.example" },
      body: stateBody("page-origin"),
    });
    assert.strictEqual(res.status, 403);
    const opaque = await send({ headers: { "Content-Type": "text/plain" }, body: stateBody("page-opaque") });
    assert.strictEqual(opaque.status, 415);
    assert.strictEqual(opaque.headers["x-clawd-server"], undefined);
    assert.strictEqual(updateSessionCalls.length, before);
    assert.ok(logs.some((line) => /status=415 reason=content-type/.test(line)));
  });

  it("turns away a forged permission request without opening a bubble", async () => {
    const res = await send({
      path: "/permission",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ hook_event_name: "PermissionRequest", tool_name: "Bash", session_id: "forged" }),
    });
    assert.strictEqual(res.status, 415);
    assert.strictEqual(pendingPermissions.length, 0);
  });

  it("does not answer GET routes for a rebound hostname", async () => {
    for (const path of ["/state", "/web-bridge"]) {
      const res = await send({ method: "GET", path, headers: { Host: `evil.example:${port}` } });
      assert.strictEqual(res.status, 403, path);
      assert.strictEqual(res.headers["x-clawd-server"], undefined, path);
    }
    const ok = await send({ method: "GET", path: "/web-bridge", headers: { Host: `localhost:${port}` } });
    assert.strictEqual(ok.status, 200);
  });
});
