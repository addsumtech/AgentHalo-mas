#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Gemini CLI hook.
//
// Runs hooks/gemini-hook.js under a name only the store build writes into
// ~/.gemini/settings.json; another AgentHalo install claims every command that
// mentions gemini-hook.js (see hooks/store-hook-ownership.js).

require("./gemini-hook.js").runCli();
