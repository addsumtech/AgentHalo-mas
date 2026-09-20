"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  hashIdentityEmail,
  githubHandleForIdentity,
  parseReleaseIdentities,
  previousReleaseTag,
} = require("../scripts/verify-release-contributors");

// 用例注入自己的映射表，真实贡献者邮箱不进测试文件。
const OVERRIDES = new Map([
  [hashIdentityEmail("bot@example.invalid"), null],
  [hashIdentityEmail("contributor@example.invalid"), "ExampleHandle"],
]);

test("release contributor audit selects the newest tag below the package version", () => {
  assert.strictEqual(
    previousReleaseTag("0.16.0", ["v0.14.0", "v0.15.0", "v0.16.0", "not-a-release"]),
    "v0.15.0",
  );
});

test("release contributor audit maps noreply, direct-email, and co-author identities", () => {
  const records = [
    "134911580+Cobb04@users.noreply.github.com\x00ShannonC\x00feature\x1e",
    "bot@example.invalid\x00Release Bot\x00merge\n\nCo-authored-by: Example <contributor@example.invalid>\x1e",
  ].join("");
  const identities = parseReleaseIdentities(records);
  assert.deepStrictEqual(
    identities.map((identity) => githubHandleForIdentity(identity.name, identity.email, OVERRIDES)),
    ["Cobb04", null, "ExampleHandle"],
  );
});

test("the override table stores hashes, never plaintext contributor emails", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "scripts", "verify-release-contributors.js"),
    "utf8",
  );
  const plaintext = source.match(/"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"/g) || [];
  assert.deepStrictEqual(plaintext, [], `plaintext emails must not ship: ${plaintext.join(", ")}`);
});

test("unknown direct-email authors cannot silently bypass contributor credit", () => {
  assert.strictEqual(githubHandleForIdentity("New Person", "new@example.com"), undefined);
});
