#!/usr/bin/env node
// AgentHalo (Mac App Store build) — TraeCode hook.
//
// Runs hooks/traecode-hook.js under a name only the store build writes into
// ~/.trae-cn/hooks.json; another AgentHalo install claims every command that
// mentions traecode-hook.js (see hooks/store-hook-ownership.js).

require("./traecode-hook.js").runCli();
