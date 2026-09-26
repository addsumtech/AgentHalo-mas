#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Codex CLI hook.
//
// Runs hooks/codex-hook.js under a name only the store build writes into
// ~/.codex/hooks.json; another AgentHalo install claims every command that
// mentions codex-hook.js (see hooks/store-hook-ownership.js).

require("./codex-hook.js").runCli();
