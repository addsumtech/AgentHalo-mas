#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Qoder hook.
//
// Runs hooks/qoder-hook.js under a name only the store build writes into
// ~/.qoder/settings.json; another AgentHalo install claims every command that
// mentions qoder-hook.js (see hooks/store-hook-ownership.js).

require("./qoder-hook.js").runCli();
