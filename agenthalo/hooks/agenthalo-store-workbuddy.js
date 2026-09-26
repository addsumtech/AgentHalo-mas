#!/usr/bin/env node
// AgentHalo (Mac App Store build) — WorkBuddy hook.
//
// Runs hooks/workbuddy-hook.js under a name only the store build writes into
// the WorkBuddy settings.json; another AgentHalo install claims every command that
// mentions workbuddy-hook.js (see hooks/store-hook-ownership.js).

require("./workbuddy-hook.js").runCli();
