#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Claude Code SessionStart auto-start hook.
//
// Runs hooks/auto-start.js under a name only the store build writes into
// ~/.claude/settings.json; another AgentHalo install claims every command that
// mentions auto-start.js (see "Mac App Store build" in hooks/install.js).

require("./auto-start.js").main();
