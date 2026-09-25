"use strict";

const sandboxAccess = require("./sandbox-access");

function hasPositiveCount(value) {
  return Number.isFinite(value) && value > 0;
}

function asOk(result, fallback = {}) {
  if (result && typeof result === "object") {
    if (typeof result.status === "string") return result;
    return { status: "ok", ...result };
  }
  return { status: "ok", ...fallback };
}

function asSkipped(result, reason, message) {
  const base = result && typeof result === "object" ? result : {};
  return {
    status: "skipped",
    ...base,
    reason: (base.reason || reason),
    message: (base.message || message),
  };
}

function normalizeCountSyncResult(result, agentName, reason) {
  if (!result || typeof result !== "object") return { status: "ok" };
  if (typeof result.status === "string") return result;
  const changed =
    hasPositiveCount(result.added)
    || hasPositiveCount(result.updated)
    || hasPositiveCount(result.removed)
    || result.changed === true
    || result.created === true
    || result.configChanged === true;
  const alreadyCurrent = hasPositiveCount(result.skipped);
  if (!changed && !alreadyCurrent) {
    return asSkipped(result, reason, `${agentName} is not installed; skipped integration sync`);
  }
  return asOk(result);
}

function normalizeInstalledFlagResult(result, agentName, reason) {
  if (!result || typeof result !== "object") return { status: "ok" };
  if (typeof result.status === "string") return result;
  if (result.installed === false) {
    const skipReason = result.reason || reason;
    return asSkipped(result, skipReason, result.message || defaultInstalledFlagSkipMessage(agentName, skipReason));
  }
  return asOk(result);
}

function isNotInstalledReason(reason) {
  return reason === "not-found"
    || reason === "not-installed"
    || (typeof reason === "string" && (
      reason.endsWith("-not-found")
      || reason.endsWith("-not-installed")
    ));
}

function defaultInstalledFlagSkipMessage(agentName, reason) {
  if (isNotInstalledReason(reason)) {
    return `${agentName} is not installed; skipped integration sync`;
  }
  return reason
    ? `${agentName} integration sync skipped: ${reason}`
    : `${agentName} integration sync skipped`;
}

function createIntegrationSyncRuntime(options = {}) {
  const ctx = options.ctx || {};
  const getHookServerPort = options.getHookServerPort;
  const shouldManageClaudeHooks = options.shouldManageClaudeHooks;
  const isAgentEnabled = typeof options.isAgentEnabled === "function" ? options.isAgentEnabled : (() => true);
  const shouldSyncAgentIntegration = typeof options.shouldSyncAgentIntegration === "function"
    ? options.shouldSyncAgentIntegration
    : isAgentEnabled;
  const getAgentIntegrationOptions = typeof options.getAgentIntegrationOptions === "function"
    ? options.getAgentIntegrationOptions
    : (() => ({}));
  const startClaudeSettingsWatcher = options.startClaudeSettingsWatcher;
  const stopClaudeSettingsWatcher = options.stopClaudeSettingsWatcher;

  function readAgentIntegrationOptions(agentId) {
    try {
      const result = getAgentIntegrationOptions(agentId);
      return result && typeof result === "object" ? result : {};
    } catch (err) {
      console.warn(`AgentHalo: failed to read ${agentId} integration options:`, err && err.message);
      return {};
    }
  }

  function syncClawdHooks(options = {}) {
    const source = typeof options.source === "string" ? options.source : null;
    const automatic = options.automatic !== false;
    try {
      if (typeof ctx.syncClawdHooksImpl === "function") {
        return ctx.syncClawdHooksImpl({
          autoStart: ctx.autoStartWithClaude,
          port: getHookServerPort(),
          source,
          automatic,
          ...(options.homeDir ? { homeDir: options.homeDir } : {}),
        });
      }
      const {
        registerHooks,
        registerClaudeStatusline,
        unregisterClaudeStatusline,
      } = require("../hooks/install.js");
      const { added, updated, removed } = registerHooks({
        silent: true,
        autoStart: ctx.autoStartWithClaude,
        port: getHookServerPort(),
        homeDir: options.homeDir,
      });
      if (added > 0 || updated > 0 || removed > 0) {
        console.log(`AgentHalo: synced hooks (added ${added}, updated ${updated}, removed ${removed})`);
      }
      // Statusline registration is best-effort and reported separately: it only
      // takes the slot when empty/already ours (never overwrites a user's own
      // statusline), so a skip here is expected and must not affect the
      // hooks-sync status returned below.
      try {
        if (ctx.claudeQuotaCollectionEnabled === true) {
          const statuslineResult = registerClaudeStatusline({ silent: true, homeDir: options.homeDir });
          if (statuslineResult.changed) {
            console.log("AgentHalo: registered Claude Code statusline (rate limit quota)");
          }
        } else {
          unregisterClaudeStatusline({ backup: true, silent: true, homeDir: options.homeDir });
        }
      } catch (statuslineErr) {
        console.warn("AgentHalo: failed to sync Claude Code statusline:", statuslineErr.message);
      }
      return { status: "ok", added, updated, removed };
    } catch (err) {
      console.warn("AgentHalo: failed to sync hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Claude hooks" };
    }
  }

  function syncGeminiHooks(options = {}) {
    try {
      if (typeof ctx.syncGeminiHooksImpl === "function") return ctx.syncGeminiHooksImpl(options);
      const { registerGeminiHooks } = require("../hooks/gemini-install.js");
      const result = registerGeminiHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced Gemini hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "Gemini CLI", "gemini-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Gemini hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Gemini hooks" };
    }
  }

  function syncAntigravityHooks(options = {}) {
    try {
      if (typeof ctx.syncAntigravityHooksImpl === "function") return ctx.syncAntigravityHooksImpl(options);
      const { registerAntigravityHooks, registerAntigravityStatusline } = require("../hooks/antigravity-install.js");
      const result = registerAntigravityHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced Antigravity hooks (added ${result.added}, updated ${result.updated})`);
      }
      // Statusline registration is best-effort and reported separately: it only
      // takes the slot when empty/already ours (never overwrites a user's own
      // statusline), so a skip here is expected and must not affect the
      // hooks-sync status returned below.
      try {
        const statuslineResult = registerAntigravityStatusline({ silent: true, homeDir: options.homeDir });
        if (statuslineResult.changed) {
          console.log("AgentHalo: registered Antigravity statusline (context usage)");
        }
      } catch (statuslineErr) {
        console.warn("AgentHalo: failed to sync Antigravity statusline:", statuslineErr.message);
      }
      return normalizeInstalledFlagResult(result, "Antigravity CLI", "antigravity-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Antigravity hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Antigravity hooks" };
    }
  }

  function syncCodeBuddyHooks(options = {}) {
    try {
      const permissionTarget = options.permissionTarget && typeof options.permissionTarget === "object"
        ? options.permissionTarget
        : { mode: "local" };
      const syncOptions = { ...options, permissionTarget };
      if (typeof ctx.syncCodeBuddyHooksImpl === "function") return ctx.syncCodeBuddyHooksImpl(syncOptions);
      const { registerCodeBuddyHooks } = require("../hooks/codebuddy-install.js");
      const result = registerCodeBuddyHooks({ silent: true, permissionTarget, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced CodeBuddy hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "CodeBuddy", "codebuddy-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync CodeBuddy hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync CodeBuddy hooks" };
    }
  }

  function syncWorkBuddyHooks(options = {}) {
    try {
      if (typeof ctx.syncWorkBuddyHooksImpl === "function") return ctx.syncWorkBuddyHooksImpl(options);
      const { registerWorkBuddyHooks } = require("../hooks/workbuddy-install.js");
      const result = registerWorkBuddyHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced WorkBuddy hooks (added ${result.added}, updated ${result.updated})`);
      }
      for (const warning of result.warnings || []) console.warn(`AgentHalo: ${warning}`);
      return normalizeCountSyncResult(result, "WorkBuddy", "workbuddy-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync WorkBuddy hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync WorkBuddy hooks" };
    }
  }

  function syncTraeCodeHooks(options = {}) {
    try {
      if (typeof ctx.syncTraeCodeHooksImpl === "function") return ctx.syncTraeCodeHooksImpl(options);
      const { registerTraeCodeHooks } = require("../hooks/traecode-install.js");
      const result = registerTraeCodeHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced TraeCode hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "TraeCode", "traecode-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync TraeCode hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync TraeCode hooks" };
    }
  }

  function syncKiroHooks(options = {}) {
    try {
      if (typeof ctx.syncKiroHooksImpl === "function") return ctx.syncKiroHooksImpl(options);
      const { registerKiroHooks } = require("../hooks/kiro-install.js");
      const result = registerKiroHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced Kiro hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "Kiro CLI", "kiro-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Kiro hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Kiro hooks" };
    }
  }

  function syncKimiHooks(options = {}) {
    try {
      if (typeof ctx.syncKimiHooksImpl === "function") return ctx.syncKimiHooksImpl(options);
      const { registerKimiHooks } = require("../hooks/kimi-install.js");
      const result = registerKimiHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced Kimi hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "Kimi Code", "kimi-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Kimi hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Kimi hooks" };
    }
  }

  function syncQwenHooks(options = {}) {
    try {
      if (typeof ctx.syncQwenHooksImpl === "function") return ctx.syncQwenHooksImpl(options);
      const { registerQwenCodeHooks } = require("../hooks/qwen-code-install.js");
      const result = registerQwenCodeHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced Qwen hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "Qwen Code", "qwen-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Qwen hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Qwen hooks" };
    }
  }

  function syncZcodeHooks(options = {}) {
    try {
      if (typeof ctx.syncZcodeHooksImpl === "function") return ctx.syncZcodeHooksImpl(options);
      const { registerZcodeHooks } = require("../hooks/zcode-install.js");
      const result = registerZcodeHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced ZCode hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "ZCode", "zcode-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync ZCode hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync ZCode hooks" };
    }
  }

  function syncCodexHooks(options = {}) {
    try {
      if (typeof ctx.syncCodexHooksImpl === "function") return ctx.syncCodexHooksImpl(options);
      const { registerCodexHooks } = require("../hooks/codex-install.js");
      // stableLauncher false: the store build must not write an executable
      // launcher script into ~/.codex (App Review 2.4.5(ii)).
      const result = registerCodexHooks({ silent: true, homeDir: options.homeDir, stableLauncher: false });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced Codex hooks (added ${result.added}, updated ${result.updated})`);
      }
      if (Array.isArray(result.warnings)) {
        for (const warning of result.warnings) console.warn(`AgentHalo: Codex hook sync warning: ${warning}`);
      }
      return normalizeCountSyncResult(result, "Codex CLI", "codex-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Codex hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Codex hooks" };
    }
  }

  function repairCodexHooks(options = {}) {
    try {
      if (typeof ctx.repairCodexHooksImpl === "function") return ctx.repairCodexHooksImpl(options);
      const { registerCodexHooks } = require("../hooks/codex-install.js");
      const { added, updated, configChanged, warnings } = registerCodexHooks({
        silent: true,
        homeDir: options && options.homeDir,
        stableLauncher: false,
        forceCodexHooksFeature: options && options.forceCodexHooksFeature === true,
      });
      if (added > 0 || updated > 0 || configChanged) {
        console.log(`AgentHalo: repaired Codex hooks (added ${added}, updated ${updated}, configChanged=${!!configChanged})`);
      }
      if (Array.isArray(warnings)) {
        for (const warning of warnings) console.warn(`AgentHalo: Codex hook repair warning: ${warning}`);
        if (warnings.length > 0) {
          return {
            status: "error",
            message: `Codex hooks were repaired, but ${warnings.join("; ")}`,
          };
        }
      }
      return {
        status: "ok",
        added,
        updated,
        configChanged,
        message: configChanged
          ? "Codex hooks repaired and [features].hooks updated"
          : "Codex hooks repaired",
      };
    } catch (err) {
      console.warn("AgentHalo: failed to repair Codex hooks:", err.message);
      return { status: "error", message: err && err.message };
    }
  }

  function syncCursorHooks(options = {}) {
    try {
      if (typeof ctx.syncCursorHooksImpl === "function") return ctx.syncCursorHooksImpl(options);
      const { registerCursorHooks } = require("../hooks/cursor-install.js");
      const result = registerCursorHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced Cursor hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "Cursor Agent", "cursor-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Cursor hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Cursor hooks" };
    }
  }

  function syncCopilotHooks(options = {}) {
    try {
      if (typeof ctx.syncCopilotHooksImpl === "function") return ctx.syncCopilotHooksImpl(options);
      const { registerCopilotHooks } = require("../hooks/copilot-install.js");
      const result = registerCopilotHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced Copilot hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "Copilot CLI", "copilot-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Copilot hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Copilot hooks" };
    }
  }

  async function syncDeepSeekHarnessPlugin(options = {}) {
    try {
      const operation = options.operation
        || (options.source === "settings-agent-install"
          ? "install"
          : (options.automatic === false ? "explicit-repair" : "startup-sync"));
      const normalizedOptions = { ...options, silent: true, operation };
      if (typeof ctx.syncDeepSeekHarnessPluginImpl === "function") {
        return await ctx.syncDeepSeekHarnessPluginImpl(normalizedOptions);
      }
      const { syncDeepSeekHarnessIntegration } = require("../hooks/dsh-install.js");
      return await syncDeepSeekHarnessIntegration(normalizedOptions);
    } catch (err) {
      console.warn("AgentHalo: failed to sync DeepSeek Harness plugin:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync DeepSeek Harness plugin" };
    }
  }

  function repairDeepSeekHarnessPlugin(options = {}) {
    return syncDeepSeekHarnessPlugin({ ...options, operation: "explicit-repair", automatic: false });
  }

  function syncOpencodePlugin(options = {}) {
    try {
      if (typeof ctx.syncOpencodePluginImpl === "function") return ctx.syncOpencodePluginImpl(options);
      const { registerOpencodePlugin } = require("../hooks/opencode-install.js");
      const result = registerOpencodePlugin({ silent: true, homeDir: options.homeDir });
      if (result.added || result.created) {
        console.log(`AgentHalo: synced opencode plugin (added=${result.added}, created=${result.created})`);
      }
      if (result && result.reason === "opencode-not-found") {
        return asSkipped(result, "opencode-not-found", "opencode is not installed; skipped plugin sync");
      }
      return asOk(result);
    } catch (err) {
      console.warn("AgentHalo: failed to sync opencode plugin:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync opencode plugin" };
    }
  }

  function syncMimocodePlugin(options = {}) {
    try {
      if (typeof ctx.syncMimocodePluginImpl === "function") return ctx.syncMimocodePluginImpl(options);
      const { registerMimocodePlugin } = require("../hooks/mimocode-install.js");
      const result = registerMimocodePlugin({ silent: true, homeDir: options.homeDir });
      if (result.added || result.created) {
        console.log(`AgentHalo: synced mimocode plugin (added=${result.added}, created=${result.created})`);
      }
      if (result && result.reason === "mimocode-not-found") {
        return asSkipped(result, "mimocode-not-found", "mimocode is not installed; skipped plugin sync");
      }
      return asOk(result);
    } catch (err) {
      console.warn("AgentHalo: failed to sync mimocode plugin:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync mimocode plugin" };
    }
  }

  function syncPiExtension(options = {}) {
    try {
      if (typeof ctx.syncPiExtensionImpl === "function") return ctx.syncPiExtensionImpl(options);
      const { registerPiExtension } = require("../hooks/pi-install.js");
      const result = registerPiExtension({ silent: true, homeDir: options.homeDir });
      if (result.installed && result.updated) {
        console.log("AgentHalo: synced Pi extension");
      }
      return normalizeInstalledFlagResult(result, "Pi", "pi-not-found");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Pi extension:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Pi extension" };
    }
  }

  function syncOpenClawPlugin(options = {}) {
    try {
      if (typeof ctx.syncOpenClawPluginImpl === "function") return ctx.syncOpenClawPluginImpl(options);
      const { registerOpenClawPlugin } = require("../hooks/openclaw-install.js");
      const result = registerOpenClawPlugin({ silent: true, homeDir: options.homeDir });
      if (result.installed && result.updated) {
        console.log("AgentHalo: synced OpenClaw plugin");
      }
      return normalizeInstalledFlagResult(result, "OpenClaw", "openclaw-not-found");
    } catch (err) {
      console.warn("AgentHalo: failed to sync OpenClaw plugin:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync OpenClaw plugin" };
    }
  }

  function repairOpenClawPlugin(options = {}) {
    try {
      if (typeof ctx.repairOpenClawPluginImpl === "function") return ctx.repairOpenClawPluginImpl(options);
      const { registerOpenClawPlugin } = require("../hooks/openclaw-install.js");
      const result = registerOpenClawPlugin({ silent: true, homeDir: options.homeDir, useCliFallback: true });
      if (result.status === "error" || result.installed === false) {
        return {
          status: "error",
          message: result.message || result.reason || "Failed to repair OpenClaw plugin",
        };
      }
      return { status: "ok", ...result, message: "OpenClaw plugin repaired" };
    } catch (err) {
      console.warn("AgentHalo: failed to repair OpenClaw plugin:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to repair OpenClaw plugin" };
    }
  }

  function syncHermesPlugin(options = {}) {
    try {
      if (typeof ctx.syncHermesPluginImpl === "function") return ctx.syncHermesPluginImpl(options);
      const { isHermesInstalled, registerHermesPlugin } = require("../hooks/hermes-install.js");
      const installed = typeof ctx.isHermesInstalledImpl === "function"
        ? ctx.isHermesInstalledImpl()
        : isHermesInstalled({ homeDir: options.homeDir });
      if (!installed) {
        return {
          status: "skipped",
          reason: "hermes-not-installed",
          message: "Hermes Agent is not installed; skipped plugin sync",
        };
      }
      const result = registerHermesPlugin({ silent: true, homeDir: options.homeDir });
      if (result && result.status === "error") {
        console.warn("AgentHalo: failed to sync Hermes plugin:", result.message);
        return result;
      }
      if (result && (result.installed > 0 || result.updated > 0)) {
        console.log(`AgentHalo: synced Hermes plugin (installed=${result.installed}, updated=${result.updated})`);
      }
      return asOk(result);
    } catch (err) {
      console.warn("AgentHalo: failed to sync Hermes plugin:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Hermes plugin" };
    }
  }

  function syncQoderHooks(options = {}) {
    try {
      if (typeof ctx.syncQoderHooksImpl === "function") return ctx.syncQoderHooksImpl(options);
      const { registerQoderHooks } = require("../hooks/qoder-install.js");
      const result = registerQoderHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced Qoder hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "Qoder", "qoder-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Qoder hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Qoder hooks" };
    }
  }

  function syncCodewhaleHooks(options = {}) {
    try {
      if (typeof ctx.syncCodewhaleHooksImpl === "function") return ctx.syncCodewhaleHooksImpl(options);
      const { registerCodewhaleHooks } = require("../hooks/codewhale-install.js");
      const result = registerCodewhaleHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced CodeWhale hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "CodeWhale", "codewhale-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync CodeWhale hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync CodeWhale hooks" };
    }
  }

  function syncReasonixHooks(options = {}) {
    try {
      if (typeof ctx.syncReasonixHooksImpl === "function") return ctx.syncReasonixHooksImpl(options);
      const { registerReasonixHooks } = require("../hooks/reasonix-install.js");
      const result = registerReasonixHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced Reasonix hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "Reasonix", "reasonix-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync Reasonix hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Reasonix hooks" };
    }
  }

  function syncQoderWorkHooks(options = {}) {
    try {
      if (typeof ctx.syncQoderWorkHooksImpl === "function") return ctx.syncQoderWorkHooksImpl(options);
      const { registerQoderWorkHooks } = require("../hooks/qoderwork-install.js");
      const result = registerQoderWorkHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced QoderWork hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "QoderWork", "qoderwork-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync QoderWork hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync QoderWork hooks" };
    }
  }

  function syncQwenWorkHooks(options = {}) {
    try {
      if (typeof ctx.syncQwenWorkHooksImpl === "function") return ctx.syncQwenWorkHooksImpl(options);
      const { registerQwenWorkHooks } = require("../hooks/qwenwork-install.js");
      const result = registerQwenWorkHooks({ silent: true, homeDir: options.homeDir });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`AgentHalo: synced QwenWork hooks (added ${result.added}, updated ${result.updated})`);
      }
      return normalizeCountSyncResult(result, "QwenWork", "qwenwork-not-installed");
    } catch (err) {
      console.warn("AgentHalo: failed to sync QwenWork hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync QwenWork hooks" };
    }
  }

  const AGENT_INTEGRATION_SYNCERS = Object.freeze({
    "gemini-cli": syncGeminiHooks,
    "antigravity-cli": syncAntigravityHooks,
    "cursor-agent": syncCursorHooks,
    "copilot-cli": syncCopilotHooks,
    codebuddy: syncCodeBuddyHooks,
    workbuddy: syncWorkBuddyHooks,
    "kiro-cli": syncKiroHooks,
    "kimi-cli": syncKimiHooks,
    "qwen-code": syncQwenHooks,
    zcode: syncZcodeHooks,
    codewhale: syncCodewhaleHooks,
    codex: syncCodexHooks,
    "deepseek-harness": syncDeepSeekHarnessPlugin,
    opencode: syncOpencodePlugin,
    mimocode: syncMimocodePlugin,
    pi: syncPiExtension,
    openclaw: syncOpenClawPlugin,
    hermes: syncHermesPlugin,
    qoder: syncQoderHooks,
    reasonix: syncReasonixHooks,
    qoderwork: syncQoderWorkHooks,
    traecode: syncTraeCodeHooks,
    qwenwork: syncQwenWorkHooks,
  });

  const AGENT_INTEGRATION_REPAIRERS = Object.freeze({
    ...AGENT_INTEGRATION_SYNCERS,
    codex: repairCodexHooks,
    "deepseek-harness": repairDeepSeekHarnessPlugin,
    openclaw: repairOpenClawPlugin,
  });

  function isClaudeSyncErrorResult(result) {
    return !!(result && typeof result === "object" && result.status === "error");
  }

  function runSandboxed(agentId, sync, options = {}, gateOptions = {}) {
    if (process.env.NODE_TEST_CONTEXT) {
      return sync(options);
    }
    if (options.homeDir && !sandboxAccess.getAuthorized(agentId)) {
      return sync(options);
    }
    const gate = sandboxAccess.requireAuthorized(agentId, {
      automatic: gateOptions.automatic !== undefined ? gateOptions.automatic : options.automatic,
    });
    if (gate.status !== "ok") return gate;
    return sandboxAccess.withAccess(gate.record, () => sync({
      ...options,
      homeDir: options.homeDir || gate.record.homeDir,
    }));
  }

  function syncIntegrationForAgent(agentId, options = {}) {
    if (agentId === "claude-code") {
      if (!shouldManageClaudeHooks()) return false;
      const result = runSandboxed("claude-code", syncClawdHooks, options);
      // Claude watcher baseline seeding reads settings.json, so it must not run
      // until this sync has actually settled — an in-flight (queued) async sync
      // must not be mistaken for a completed one. Synchronous/test-injected
      // seams (no .then) keep the prior immediate-start behavior.
      //
      // The watcher only starts when the sync actually succeeded: Settings
      // Agent Install/Enable call this path with the agent's installed/enabled
      // state still contingent on THIS result — starting the watcher on
      // failure would leave it running for an agent prefs still show as
      // disabled/uninstalled. (Doctor Fix's repairIntegrationForAgent()
      // below starts the watcher unconditionally instead, since by the time
      // it runs, enabled is already an established precondition independent
      // of this particular repair's outcome.)
      if (result && typeof result === "object" && typeof result.then === "function") {
        return result.then((resolved) => {
          if (!isClaudeSyncErrorResult(resolved)) startClaudeSettingsWatcher();
          return resolved;
        });
      }
      if (!isClaudeSyncErrorResult(result)) startClaudeSettingsWatcher();
      return result && typeof result === "object" ? result : true;
    }
    const sync = AGENT_INTEGRATION_SYNCERS[agentId];
    if (typeof sync !== "function") return false;
    const result = runSandboxed(agentId, sync, options);
    return result && typeof result === "object" ? result : true;
  }

  function repairIntegrationForAgent(agentId, options = {}) {
    if (agentId === "claude-code") {
      // Doctor Fix only runs once claude-code is already confirmed installed
      // and enabled (checked by the caller before invoking repair) — that
      // state does not depend on this repair's outcome, so the watcher
      // belongs running regardless of whether this specific attempt verifies
      // healthy. start() is idempotent, so this is a no-op if it's already up.
      const result = syncIntegrationForAgent(agentId, { source: "doctor", automatic: false });
      if (result && typeof result === "object" && typeof result.then === "function") {
        return result.then((resolved) => {
          startClaudeSettingsWatcher();
          return resolved;
        });
      }
      startClaudeSettingsWatcher();
      return result;
    }
    const repair = AGENT_INTEGRATION_REPAIRERS[agentId];
    if (typeof repair !== "function") return false;
    // Doctor Fix writes the same folders as a sync, so it needs the same
    // authorized home and folder access.
    const result = runSandboxed(agentId, repair, options, { automatic: false });
    // Async installers are themselves structured results in flight. Returning
    // true here used to let Settings/Doctor commit success before DSH's
    // plugin mutation and post-verification had even settled.
    return result && typeof result === "object" ? result : true;
  }

  function stopIntegrationForAgent(agentId) {
    if (agentId !== "claude-code") return false;
    return stopClaudeSettingsWatcher();
  }

  function uninstallIntegrationForAgent(agentId) {
    try {
      const authorized = sandboxAccess.getAuthorized(agentId);
      const runUninstall = () => {
        if (
          ctx.uninstallIntegrationImpls
          && typeof ctx.uninstallIntegrationImpls === "object"
          && typeof ctx.uninstallIntegrationImpls[agentId] === "function"
        ) {
          if (agentId === "claude-code") stopClaudeSettingsWatcher();
          return ctx.uninstallIntegrationImpls[agentId]({
            silent: true,
            ...(authorized && authorized.homeDir ? { homeDir: authorized.homeDir } : {}),
          });
        }
        const {
          AGENT_CLEANERS,
          buildCleanupOptionsForHome,
        } = require("../hooks/cleanup-integrations.js");
        const uninstall = AGENT_CLEANERS && AGENT_CLEANERS[agentId];
        if (typeof uninstall !== "function") return false;
        if (agentId === "claude-code") stopClaudeSettingsWatcher();
        const cleanupOptions = ctx.cleanupOptions && typeof ctx.cleanupOptions === "object"
          ? ctx.cleanupOptions
          : {};
        const cleanupHome = (authorized && authorized.homeDir)
          || ctx.cleanupHomeDir
          || ctx.homeDir;
        if (!cleanupHome) {
          return {
            status: "skipped",
            reason: "not-authorized",
            message: sandboxAccess.unauthorizedMessage(agentId),
          };
        }
        const plan = buildCleanupOptionsForHome(cleanupHome, cleanupOptions);
        const agentOptions = plan.byAgent && plan.byAgent[agentId];
        if (!agentOptions) return false;
        return uninstall({ ...agentOptions, silent: true, homeDir: cleanupHome });
      };
      if (authorized) return sandboxAccess.withAccess(authorized, runUninstall);
      return runUninstall();
    } catch (err) {
      console.warn(`AgentHalo: failed to uninstall ${agentId} integration:`, err.message);
      return {
        status: "error",
        message: err && err.message ? err.message : `Failed to uninstall ${agentId} integration`,
      };
    }
  }

  function syncEnabledStartupIntegrations() {
    if (shouldManageClaudeHooks() && shouldSyncAgentIntegration("claude-code")) {
      const result = runSandboxed("claude-code", syncClawdHooks, { source: "startup", automatic: true });
      if (result && typeof result === "object" && result.status === "skipped") {
        // Store build: do not write ~/.claude until the user authorizes the folder.
      } else if (result && typeof result === "object" && typeof result.then === "function") {
        result.then(() => startClaudeSettingsWatcher());
      } else {
        startClaudeSettingsWatcher();
      }
    }
    // Other agents' syncs are independent files and run in parallel — they do
    // not wait for Claude's (possibly queued/async) sync to settle.
    for (const [agentId, sync] of Object.entries(AGENT_INTEGRATION_SYNCERS)) {
      if (shouldSyncAgentIntegration(agentId)) {
        runSandboxed(agentId, sync, readAgentIntegrationOptions(agentId));
      }
    }
  }

  return {
    syncClawdHooks,
    syncGeminiHooks,
    syncAntigravityHooks,
    syncCursorHooks,
    syncCopilotHooks,
    syncCodeBuddyHooks,
    syncWorkBuddyHooks,
    syncKiroHooks,
    syncKimiHooks,
    syncQwenHooks,
    syncZcodeHooks,
    syncCodewhaleHooks,
    syncCodexHooks,
    syncDeepSeekHarnessPlugin,
    syncOpencodePlugin,
    syncMimocodePlugin,
    syncPiExtension,
    syncOpenClawPlugin,
    syncHermesPlugin,
    syncQoderHooks,
    syncReasonixHooks,
    syncQoderWorkHooks,
    syncTraeCodeHooks,
    repairCodexHooks,
    repairOpenClawPlugin,
    syncIntegrationForAgent,
    repairIntegrationForAgent,
    stopIntegrationForAgent,
    uninstallIntegrationForAgent,
    syncEnabledStartupIntegrations,
  };
}

module.exports = {
  createIntegrationSyncRuntime,
};
