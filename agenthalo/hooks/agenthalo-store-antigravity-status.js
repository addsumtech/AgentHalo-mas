#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Antigravity CLI statusline command.
//
// Runs hooks/antigravity-statusline.js under a name only the store build
// writes into ~/.gemini/antigravity-cli/settings.json; another AgentHalo
// install claims a statusline that mentions antigravity-statusline.js (see
// hooks/store-hook-ownership.js).

require("./antigravity-statusline.js").runCli();
