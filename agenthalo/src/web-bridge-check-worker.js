"use strict";

require("./web-bridge-status").checkWebBridgeStatus()
  .then((report) => process.parentPort.postMessage(report))
  .catch(() => process.parentPort.postMessage({ installations: [], unreadable: true, latestVersion: null }));
