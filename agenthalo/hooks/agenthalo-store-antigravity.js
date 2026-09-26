#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Antigravity CLI hook.
//
// Runs hooks/antigravity-hook.js from the store build's own hook group in
// ~/.gemini/config/hooks.json. Another AgentHalo install owns the "clawd" group
// there, and a name of its own also tells Doctor which commands are the store
// build's (see hooks/store-hook-ownership.js).

require("./antigravity-hook.js").runCli();
