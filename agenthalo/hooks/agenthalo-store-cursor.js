#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Cursor Agent hook.
//
// Runs hooks/cursor-hook.js under a name only the store build writes into
// ~/.cursor/hooks.json; another AgentHalo install claims every command that
// mentions cursor-hook.js (see hooks/store-hook-ownership.js).
// cursor-hook.js runs as soon as it is loaded.

require("./cursor-hook.js");
