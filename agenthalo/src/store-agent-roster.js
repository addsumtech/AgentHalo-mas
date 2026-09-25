"use strict";

// Integrations the Mac App Store build leaves out. Each one either copies
// plugin code into another tool's folder or runs that tool's CLI (App Review
// 2.4.5(ii), 2.5.2), or needs folders a single sandbox authorization cannot
// cover (Kimi keeps config in both ~/.kimi and ~/.kimi-code).
const STORE_HIDDEN_AGENT_IDS = Object.freeze([
  "deepseek-harness",
  "opencode",
  "mimocode",
  "pi",
  "openclaw",
  "hermes",
  "kimi-cli",
  "kiro-cli",
]);

const HIDDEN = new Set(STORE_HIDDEN_AGENT_IDS);

function isStoreAgent(agentId) {
  return typeof agentId === "string" && agentId !== "" && !HIDDEN.has(agentId);
}

function filterStoreAgents(agents) {
  return (Array.isArray(agents) ? agents : []).filter((agent) => {
    const id = agent && (agent.id || agent.agentId);
    return isStoreAgent(id);
  });
}

module.exports = {
  STORE_HIDDEN_AGENT_IDS,
  isStoreAgent,
  filterStoreAgents,
};
