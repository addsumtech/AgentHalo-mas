#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Claude Code statusline command.
//
// Runs hooks/claude-statusline.js under a name only the store build writes
// into ~/.claude/settings.json; another AgentHalo install claims a statusline
// that mentions claude-statusline.js (see "Mac App Store build" in
// hooks/install.js).

require("./claude-statusline.js").run();
