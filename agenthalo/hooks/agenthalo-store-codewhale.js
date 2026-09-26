#!/usr/bin/env node
// AgentHalo (Mac App Store build) — CodeWhale hook.
//
// Runs hooks/codewhale-hook.js under a name only the store build writes into
// ~/.codewhale/config.toml; another AgentHalo install claims every command that
// mentions codewhale-hook.js (see hooks/store-hook-ownership.js).

require("./codewhale-hook.js").runCli();
