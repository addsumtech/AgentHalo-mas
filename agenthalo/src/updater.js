"use strict";

// AgentHalo is maintained and installed from its own source repository.
// Preserve the runtime interface without creating timers, network requests,
// upstream release prompts, installers, or install-on-quit handlers.
function initUpdater() {
  const snapshot = () => ({ state: "idle", status: "manual-only" });
  const noop = () => {};
  return {
    setupAutoUpdater: noop,
    checkForUpdates: async () => snapshot(),
    getUpdateCheckSnapshot: snapshot,
    clearUpdateError: snapshot,
    getUpdateMenuItem: () => null,
    getUpdateMenuLabel: () => "",
    quietDiscover: async () => snapshot(),
    handlePendingVersion: async () => snapshot(),
    reconcilePendingOnStartup: noop,
    onSilentModeExit: noop,
    getPendingUpdateVersion: () => "",
    startUpdateScheduler: noop,
    stopUpdateScheduler: noop,
    isSchedulerRunning: () => false,
  };
}

module.exports = initUpdater;
