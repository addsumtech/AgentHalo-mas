"use strict";

const { scanRecoveryLeases } = require("../hooks/session-recovery-lease");

function restoreSessionsFromRecoveryLeases(state, options = {}) {
  return recoverSessionsFromLeases(state, options).restored;
}

// Restores what the leases allow and reports why the rest stayed down
// (summary.skipped by reason; summary.rejected counts leases the state
// refused), so a startup that brings nothing back can say why.
function recoverSessionsFromLeases(state, options = {}) {
  if (!state || typeof state.restoreSessionFromLease !== "function") {
    return { restored: [], summary: null };
  }
  const { leases, summary } = scanRecoveryLeases(options);
  const restored = [];
  for (const lease of leases) {
    if (state.restoreSessionFromLease(lease)) restored.push(lease.sessionId);
  }
  return {
    restored,
    summary: { ...summary, restored: restored.length, rejected: leases.length - restored.length },
  };
}

// "dir=ok files=3 candidates=2 restored=1 rejected=0 skipped=identity-unavailable:1"
function formatRecoverySummary(summary) {
  if (!summary) return "unavailable";
  const skipped = Object.keys(summary.skipped || {}).sort()
    .map((reason) => `${reason}:${summary.skipped[reason]}`)
    .join(",");
  return [
    `dir=${summary.dir}`,
    `files=${summary.files}`,
    `candidates=${summary.candidates}`,
    `restored=${summary.restored}`,
    `rejected=${summary.rejected}`,
    `skipped=${skipped || "none"}`,
  ].join(" ");
}

module.exports = {
  restoreSessionsFromRecoveryLeases,
  recoverSessionsFromLeases,
  formatRecoverySummary,
};
