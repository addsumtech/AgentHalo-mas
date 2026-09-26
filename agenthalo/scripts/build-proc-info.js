#!/usr/bin/env node
"use strict";

// Builds the proc-info helper (native/proc-info/proc-info.c) that the Mac App
// Store build runs in place of the setuid /bin/ps, which the App Sandbox
// refuses to exec. The npm build scripts run this before electron-builder,
// which copies the binary to Contents/Resources/bin/proc-info
// (build.extraResources) and signs it with build/entitlements.mas.inherit.plist.
// @electron/osx-sign signs the deepest files first; a helper beside the app
// executable in Contents/MacOS would still be unsigned when that executable is
// signed, and codesign refuses it as an unsigned subcomponent.
//
// It is built universal: electron-builder packs the x64 and arm64 apps
// separately, and @electron/universal keeps a Mach-O that is already universal
// in both as it is (an identical single-arch file would fail the merge).
//
// Usage: node scripts/build-proc-info.js

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "native", "proc-info", "proc-info.c");
const OUTPUT = path.join(ROOT, "native", "proc-info", "build", "proc-info");
const ARCHS = ["arm64", "x86_64"];
// Electron's own LSMinimumSystemVersion.
const MIN_MACOS = "12.0";

function main() {
  if (process.platform !== "darwin") {
    throw new Error("the proc-info helper builds only on macOS");
  }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  execFileSync("xcrun", [
    "clang", "-O2", "-Wall", "-Wextra", "-Werror",
    ...ARCHS.flatMap((arch) => ["-arch", arch]),
    `-mmacosx-version-min=${MIN_MACOS}`,
    "-o", OUTPUT, SOURCE,
  ], { stdio: "inherit" });
  const archs = execFileSync("xcrun", ["lipo", "-archs", OUTPUT], { encoding: "utf8" }).trim().split(/\s+/);
  if ([...archs].sort().join(" ") !== [...ARCHS].sort().join(" ")) {
    throw new Error(`proc-info has architectures "${archs.join(" ")}", expected "${ARCHS.join(" ")}"`);
  }
  process.stdout.write(`proc-info: built ${path.relative(ROOT, OUTPUT)} (${archs.join(" ")})\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`proc-info: ${err.message}\n`);
  process.exit(1);
}
