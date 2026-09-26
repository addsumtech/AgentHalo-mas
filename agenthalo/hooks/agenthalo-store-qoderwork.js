#!/usr/bin/env node
// AgentHalo (Mac App Store build) — QoderWork hook.
//
// Runs hooks/qoderwork-hook.js under a name only the store build writes into
// ~/.qoderwork/settings.json; another AgentHalo install claims every command that
// mentions qoderwork-hook.js (see hooks/store-hook-ownership.js).

require("./qoderwork-hook.js").runCli();
