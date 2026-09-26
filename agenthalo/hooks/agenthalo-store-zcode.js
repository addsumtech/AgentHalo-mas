#!/usr/bin/env node
// AgentHalo (Mac App Store build) — ZCode hook.
//
// Runs hooks/zcode-hook.js under a name only the store build writes into
// ~/.zcode/cli/config.json; another AgentHalo install claims every command that
// mentions zcode-hook.js (see hooks/store-hook-ownership.js).

require("./zcode-hook.js").runCli();
