"use strict";

// Store build click-to-focus: store hooks report the bundle id of the app
// they run under, and the sandboxed app activates it with `open -b`.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { applySourceBundleId, normalizeBundleId } = require("../hooks/shared-process");
const { __test: focusTest } = require("../src/focus");

describe("store build click-to-focus", () => {
  it("reports the host app bundle id only from store-build hooks", () => {
    const env = { __CFBundleIdentifier: "com.apple.Terminal" };
    assert.deepEqual(applySourceBundleId({}, env), {});
    assert.deepEqual(
      applySourceBundleId({}, { ...env, AGENTHALO_STORE_HOOK: "1" }),
      { source_bundle_id: "com.apple.Terminal" }
    );
    assert.deepEqual(
      applySourceBundleId({}, { __CFBundleIdentifier: "not a bundle; rm -rf /", AGENTHALO_STORE_HOOK: "1" }),
      {}
    );
  });

  it("accepts only reverse-DNS bundle ids", () => {
    assert.equal(normalizeBundleId("com.googlecode.iterm2"), "com.googlecode.iterm2");
    assert.equal(normalizeBundleId("com.todesktop.230313mzl4w4u92"), "com.todesktop.230313mzl4w4u92");
    assert.equal(normalizeBundleId("Terminal"), null);
    assert.equal(normalizeBundleId("-b.evil"), null);
    assert.equal(normalizeBundleId(`com.${"a".repeat(300)}`), null);
    assert.equal(normalizeBundleId(42), null);
  });

  it("activates the reported app through LaunchServices", () => {
    const calls = [];
    const fakeExecFile = (file, args) => calls.push([file, ...args]);
    assert.equal(focusTest.activateMacAppByBundleId("com.apple.Terminal", fakeExecFile), "mas-open-bundle-submitted");
    assert.deepEqual(calls, [["/usr/bin/open", "-b", "com.apple.Terminal"]]);
    assert.equal(focusTest.activateMacAppByBundleId(null, fakeExecFile), "mas-no-bundle-id");
    assert.equal(calls.length, 1);
  });
});
