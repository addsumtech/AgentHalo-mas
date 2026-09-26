#!/usr/bin/env node
// AgentHalo (Mac App Store build) — QwenWork hook.
//
// Runs hooks/qwenwork-hook.js under a name only the store build writes into
// ~/.QwenWorkCN/settings.json; another AgentHalo install claims every command that
// mentions qwenwork-hook.js (see hooks/store-hook-ownership.js).

require("./qwenwork-hook.js").runCli();
