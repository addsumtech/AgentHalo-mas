#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Copilot CLI hook.
//
// Runs hooks/copilot-hook.js under a name only the store build writes into
// <copilot home>/hooks/hooks.json; another AgentHalo install claims every command that
// mentions copilot-hook.js (see hooks/store-hook-ownership.js).

require("./copilot-hook.js").runCli();
