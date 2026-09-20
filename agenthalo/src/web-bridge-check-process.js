"use strict";

const path = require("path");

function checkWebBridgeInProcess({ fork = (...args) => require("electron").utilityProcess.fork(...args), timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    let child;
    let timer;
    let settled = false;
    const finish = (report) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child) {
        child.removeAllListeners();
        // File access can remain blocked by the OS after our read deadline.
        // Retire the worker so repeated checks cannot occupy the app's threads.
        child.kill();
      }
      resolve(report && Array.isArray(report.installations)
        ? report : { installations: [], unreadable: true, latestVersion: null });
    };
    try {
      child = fork(path.join(__dirname, "web-bridge-check-worker.js"), [], { serviceName: "Browser extension check", stdio: "ignore" });
      child.once("message", finish);
      child.once("exit", () => finish(null));
      child.once("error", () => finish(null));
      timer = setTimeout(() => finish(null), timeoutMs);
    } catch { finish(null); }
  });
}

module.exports = { checkWebBridgeInProcess };
