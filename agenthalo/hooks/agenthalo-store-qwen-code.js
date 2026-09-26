#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Qwen Code hook.
//
// Runs hooks/qwen-code-hook.js under a name only the store build writes into
// ~/.qwen/settings.json; another AgentHalo install claims every command that
// mentions qwen-code-hook.js (see hooks/store-hook-ownership.js).

require("./qwen-code-hook.js").runCli();
