#!/usr/bin/env node
// AgentHalo (Mac App Store build) — CodeBuddy hook.
//
// Runs hooks/codebuddy-hook.js under a name only the store build writes into
// ~/.codebuddy/settings.json; another AgentHalo install claims every command that
// mentions codebuddy-hook.js (see hooks/store-hook-ownership.js).
// codebuddy-hook.js runs as soon as it is loaded.

require("./codebuddy-hook.js");
