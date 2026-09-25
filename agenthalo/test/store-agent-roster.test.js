"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { STORE_HIDDEN_AGENT_IDS, isStoreAgent, filterStoreAgents } = require("../src/store-agent-roster");
const { getAllAgents } = require("../agents/registry");
const { AGENT_CONFIG_DIRS } = require("../src/sandbox-access");

describe("store agent roster", () => {
  it("hides integrations that copy code into other tools or need several folders", () => {
    for (const id of ["deepseek-harness", "opencode", "mimocode", "pi", "openclaw", "hermes", "kimi-cli", "kiro-cli"]) {
      assert.equal(isStoreAgent(id), false, id);
    }
    for (const id of ["claude-code", "codex", "cursor-agent", "gemini-cli", "copilot-cli", "codebuddy", "workbuddy"]) {
      assert.equal(isStoreAgent(id), true, id);
    }
  });

  it("only names registered agents, and every shown agent has a folder to authorize", () => {
    const registered = new Set(getAllAgents().map((agent) => agent.id));
    for (const id of STORE_HIDDEN_AGENT_IDS) assert.ok(registered.has(id), id);
    for (const agent of filterStoreAgents(getAllAgents())) {
      assert.ok(AGENT_CONFIG_DIRS[agent.id], `${agent.id} needs a config folder entry`);
    }
  });

  it("filters metadata and detection rows by id or agentId", () => {
    assert.deepEqual(
      filterStoreAgents([{ id: "claude-code" }, { id: "pi" }, { agentId: "codex" }, { agentId: "hermes" }, null]),
      [{ id: "claude-code" }, { agentId: "codex" }]
    );
  });
});
