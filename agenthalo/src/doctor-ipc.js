const os = require("os");
const path = require("path");
const { runDoctorChecks } = require("./doctor");
const { getCodexHookHealth } = require("./codex-hook-health");
const { formatDiagnosticReport, redactDoctorResult } = require("./doctor-report");
const { createConnectionTestDeduper, runConnectionTest } = require("./doctor-hook-activity");
const { openClawdLog } = require("./doctor-logs");

function getDoctorRedactionOptions(app) {
  const appRoots = [path.resolve(path.join(__dirname, ".."))];
  try {
    const appPath = app.getAppPath();
    if (appPath) appRoots.push(path.resolve(appPath));
  } catch {}
  return { appRoots };
}

function normalizeDoctorObjectPayload(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

function normalizeDoctorConnectionTestPayload(payload) {
  return normalizeDoctorObjectPayload(payload);
}

function normalizeDoctorOpenLogPayload(payload) {
  const safePayload = normalizeDoctorObjectPayload(payload);
  return typeof safePayload.name === "string" ? { name: safePayload.name } : {};
}

function createDoctorRunChecksDeduper(runChecks, options = {}) {
  const onResult = typeof options.onResult === "function" ? options.onResult : null;
  let pending = null;
  return function runDedupedDoctorChecks() {
    // Single-flight: concurrent IPC calls share the first run's result.
    if (pending) return pending;
    try {
      pending = Promise.resolve(runChecks())
        .then((result) => {
          if (onResult) onResult(result);
          return result;
        })
        .finally(() => {
          pending = null;
        });
    } catch (err) {
      pending = Promise.reject(err)
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}

function getRecentConnectionActivity({ server, getSessionSnapshot, prefs = {}, now = Date.now(), resolveAgentDisplayName }) {
  const since = now - 5 * 60 * 1000;
  const enabled = (id) => typeof id === "string" && id && (!prefs.agents || !prefs.agents[id] || prefs.agents[id].enabled !== false);
  const recent = (at) => Number.isFinite(at) && at >= since && at <= now;
  const evidence = [];
  try {
    for (const event of server && typeof server.getRecentHookEvents === "function" ? server.getRecentHookEvents({ since }) : []) {
      if (event && event.outcome === "accepted" && recent(event.timestamp) && enabled(event.agentId)) {
        evidence.push({ agentId: event.agentId, at: event.timestamp });
      }
    }
  } catch {}
  try {
    const snapshot = typeof getSessionSnapshot === "function" ? getSessionSnapshot() : null;
    for (const session of snapshot && Array.isArray(snapshot.sessions) ? snapshot.sessions : []) {
      const at = session && session.lastEvent && session.lastEvent.at;
      if (session && !session.startupRecovered && recent(at) && enabled(session.agentId)) {
        evidence.push({ agentId: session.agentId, at });
      }
    }
  } catch {}
  if (!evidence.length) return null;
  const resolve = typeof resolveAgentDisplayName === "function" ? resolveAgentDisplayName : (id) => id;
  const agents = [...new Set(evidence.map((event) => resolve(event.agentId)))];
  return { status: "recent-activity", level: null, agents, lastEventAt: Math.max(...evidence.map((event) => event.at)) };
}

function registerDoctorIpc({
  ipcMain,
  app,
  shell,
  server,
  getPrefsSnapshot,
  getPrefsReadFailure,
  getPrefsRecovered,
  getPrefsRecoveryBackupFailed,
  getDoNotDisturb,
  getLocale,
  resolveAgentDisplayName,
  getSessionSnapshot,
}) {
  let lastDoctorResult = null;
  let lastDoctorConnectionTest = null;

  const runDedupedDoctorConnectionTest = createConnectionTestDeduper(
    (payload) => runConnectionTest({
      server,
      durationMs: payload && payload.durationMs,
      homeDir: os.homedir(),
      resolveAgentDisplayName,
      getCodexHookHealth: () => getCodexHookHealth({ prefs: getPrefsSnapshot() }),
    }),
    {
      onResult: (result) => {
        lastDoctorConnectionTest = result;
      },
    }
  );

  function buildDoctorResult() {
    lastDoctorResult = runDoctorChecks({
      server,
      prefs: getPrefsSnapshot(),
      prefsReadFailure: typeof getPrefsReadFailure === "function" && getPrefsReadFailure() === true,
      prefsRecovered: typeof getPrefsRecovered === "function" && getPrefsRecovered() === true,
      prefsRecoveryBackupFailed: typeof getPrefsRecoveryBackupFailed === "function"
        && getPrefsRecoveryBackupFailed() === true,
      doNotDisturb: getDoNotDisturb(),
    });
    lastDoctorResult.connectionActivity = getRecentConnectionActivity({
      server, getSessionSnapshot, prefs: getPrefsSnapshot(), resolveAgentDisplayName,
    });
    return lastDoctorResult;
  }

  function buildDoctorReportResult() {
    const result = lastDoctorResult || buildDoctorResult();
    if (!lastDoctorConnectionTest) return result;
    return {
      ...result,
      connectionTest: lastDoctorConnectionTest,
    };
  }

  const runDedupedDoctorChecks = createDoctorRunChecksDeduper(buildDoctorResult);

  ipcMain.handle("doctor:run-checks", async () => (
    redactDoctorResult(await runDedupedDoctorChecks(), getDoctorRedactionOptions(app))
  ));

  // Lightweight Codex-only hook-health probe for the Agents tab badge. Reuses
  // the same per-agent integration check the Doctor uses, but skips the full
  // doctor sweep so opening the Agents tab stays cheap. Returns a render-safe
  // subset (no raw fs paths — detailText/error stay main-side).
  ipcMain.handle("doctor:codex-hook-health", () => {
    const verdict = getCodexHookHealth({ prefs: getPrefsSnapshot() });
    return {
      available: verdict.available,
      healthy: verdict.healthy,
      signature: verdict.signature,
      reasonKey: verdict.reasonKey,
      status: verdict.status,
      fixAction: verdict.fixAction,
    };
  });

  ipcMain.handle("doctor:test-connection", async (_event, payload) => {
    const result = await runDedupedDoctorConnectionTest(normalizeDoctorConnectionTestPayload(payload));
    return redactDoctorResult(result, getDoctorRedactionOptions(app));
  });

  ipcMain.handle("doctor:open-clawd-log", async (_event, payload) => {
    const safePayload = normalizeDoctorOpenLogPayload(payload);
    return openClawdLog({
      requested: safePayload.name,
      homeDir: os.homedir(),
      userDataDir: app.getPath("userData"),
      shell,
    });
  });

  ipcMain.handle("doctor:get-report", () => {
    const result = buildDoctorReportResult();
    return formatDiagnosticReport(result, {
      version: app.getVersion(),
      platform: process.platform,
      release: os.release(),
      locale: getLocale(),
      ...getDoctorRedactionOptions(app),
    });
  });
}

module.exports = {
  registerDoctorIpc,
  __test: {
    getRecentConnectionActivity,
    createDoctorRunChecksDeduper,
    normalizeDoctorConnectionTestPayload,
    normalizeDoctorOpenLogPayload,
  },
};
