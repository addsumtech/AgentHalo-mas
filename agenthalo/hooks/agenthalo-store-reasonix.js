#!/usr/bin/env node
// AgentHalo (Mac App Store build) — Reasonix hook.
//
// Runs hooks/reasonix-hook.js under a name only the store build writes into
// the Reasonix settings.json; another AgentHalo install claims every command that
// mentions reasonix-hook.js (see hooks/store-hook-ownership.js).
// reasonix-hook.js runs as soon as it is loaded.

require("./reasonix-hook.js");
