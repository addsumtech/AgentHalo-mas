#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Claude Code state hook.
// Usage: node-launcher.sh agenthalo-store-hook.js <event_name>
//
// Runs hooks/clawd-hook.js under a name only the store build writes into
// ~/.claude/settings.json. Another AgentHalo install treats every command that
// mentions clawd-hook.js as its own and would rewrite this entry to itself
// (see "Mac App Store build" in hooks/install.js).

require("./clawd-hook.js").main();
