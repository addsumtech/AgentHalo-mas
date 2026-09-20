"use strict";

(function initSettingsTabAbout(root) {
  let helpers = null;
  let ops = null;
  const t = (key) => helpers.t(key);

  function linkRow(label, url, text) {
    const row = document.createElement("div");
    row.className = "about-info-row";
    const name = document.createElement("div");
    name.className = "about-info-label";
    name.textContent = label;
    const value = document.createElement(url ? "a" : "span");
    value.className = "about-info-value";
    value.textContent = text;
    if (url) {
      value.href = "#";
      value.addEventListener("click", (event) => {
        event.preventDefault();
        helpers.openExternalSafe(url);
      });
    }
    row.appendChild(name);
    row.appendChild(value);
    return row;
  }

  // Same shape as linkRow, but reopens the in-app welcome guide instead of a URL.
  function tutorialRow() {
    const row = document.createElement("div");
    row.className = "about-info-row";
    const name = document.createElement("div");
    name.className = "about-info-label";
    name.textContent = t("aboutTutorialLabel");
    const value = document.createElement("a");
    value.className = "about-info-value";
    value.href = "#";
    value.textContent = t("aboutTutorialAction");
    value.addEventListener("click", (event) => {
      event.preventDefault();
      if (window.settingsAPI && typeof window.settingsAPI.command === "function") {
        void window.settingsAPI.command("openTutorial");
      }
    });
    row.appendChild(name);
    row.appendChild(value);
    return row;
  }

  function formatCleanupSummary(result) {
    const summary = result && result.cleanup && result.cleanup.summary;
    if (!summary) return t("aboutCleanupSuccess");
    const failed = Number(summary.failed || 0);
    let text = t("aboutCleanupSuccess")
      .replace("{removed}", String(Number(summary.entriesRemoved || 0)))
      .replace("{affected}", String(Number(summary.agentsAffected || 0)))
      .replace("{failed}", String(failed));
    const hasKiroNote = Array.isArray(result.cleanup.agents)
      && result.cleanup.agents.some((agent) =>
        agent
        && agent.agentId === "kiro-cli"
        && Array.isArray(agent.notes)
        && agent.notes.length > 0
      );
    if (hasKiroNote) text += " " + t("aboutCleanupKiroNote");
    return text;
  }

  function createCleanupFooterAction() {
    const wrap = document.createElement("div");
    wrap.className = "about-footer-action-wrap";
    const button = document.createElement("button");
    button.className = "about-footer-action-button about-cleanup-button";
    button.type = "button";
    button.textContent = t("aboutCleanupButton");
    const status = document.createElement("div");
    status.className = "about-cleanup-status";
    let confirmationPending = false;

    function resetCleanupButton() {
      button.disabled = false;
      button.textContent = t("aboutCleanupButton");
    }

    function runCleanup() {
      button.disabled = true;
      button.textContent = t("aboutCleanupRunning");
      status.textContent = "";
      return Promise.resolve()
        .then(() => window.settingsAPI.command("cleanupIntegrations"))
        .then((result) => {
          if (!result || result.status !== "ok") {
            throw new Error((result && result.message) || t("aboutCleanupFailed"));
          }
          const message = formatCleanupSummary(result);
          status.textContent = message;
          ops.showToast(message, { ttl: 7000 });
        })
        .catch((err) => {
          const message = t("aboutCleanupFailed") + (err && err.message ? ": " + err.message : "");
          status.textContent = message;
          ops.showToast(message, { ttl: 7000 });
        })
        .finally(resetCleanupButton);
    }

    button.addEventListener("click", () => {
      if (!window.settingsAPI || typeof window.settingsAPI.command !== "function") return;
      if (confirmationPending || button.disabled) return;
      if (!helpers || typeof helpers.showSettingsConfirmModal !== "function") {
        status.textContent = t("aboutCleanupFailed");
        return;
      }
      confirmationPending = true;
      Promise.resolve()
        .then(() => helpers.showSettingsConfirmModal({
          title: t("aboutCleanupConfirmTitle"),
          detail: t("aboutCleanupConfirmDetail"),
          actions: [
            { id: "cancel", label: t("aboutCleanupConfirmCancel"), tone: "neutral", defaultFocus: true },
            { id: "confirm", label: t("aboutCleanupConfirmAction"), tone: "danger" },
          ],
        }))
        .then((actionId) => {
          if (actionId !== "confirm") return null;
          return runCleanup();
        })
        .catch((err) => {
          const message = t("aboutCleanupFailed") + (err && err.message ? ": " + err.message : "");
          status.textContent = message;
          ops.showToast(message, { ttl: 7000 });
        })
        .finally(() => {
          confirmationPending = false;
        });
    });

    wrap.appendChild(button);
    wrap.appendChild(status);
    return wrap;
  }

  function render(parent) {
    const hero = document.createElement("div");
    hero.className = "about-hero";
    const icon = document.createElement("img");
    icon.className = "about-app-icon";
    icon.src = "../assets/icon.png";
    icon.alt = "AgentHalo";
    const title = document.createElement("h2");
    title.className = "about-title";
    title.textContent = "AgentHalo";
    const tagline = document.createElement("p");
    tagline.className = "about-tagline";
    tagline.textContent = t("aboutTagline");
    hero.appendChild(icon);
    hero.appendChild(title);
    hero.appendChild(tagline);
    parent.appendChild(hero);

    const infoSection = document.createElement("section");
    infoSection.className = "section";
    parent.appendChild(infoSection);
    const credits = document.createElement("div");
    credits.className = "about-credits";
    parent.appendChild(credits);

    const load = window.settingsAPI && window.settingsAPI.getAboutInfo;
    Promise.resolve(typeof load === "function" ? load() : {}).then((info) => {
      if (!document.body.contains(parent)) return;
      const safe = info || {};
      infoSection.appendChild(linkRow(t("aboutVersionLabel"), null, "v" + (safe.version || "1.0.0")));
      infoSection.appendChild(linkRow(t("aboutRepositoryLabel"), safe.repoUrl, "addsumtech / AgentHalo"));
      infoSection.appendChild(linkRow(t("aboutFeedbackLabel"), safe.issuesUrl, t("aboutFeedbackAction")));
      infoSection.appendChild(linkRow(t("aboutPrivacyLabel"),
        t("aboutPrivacyUrl"), t("aboutPrivacyAction")));
      infoSection.appendChild(linkRow(t("aboutSupportLabel"),
        t("aboutSupportUrl"), t("aboutSupportAction")));
      infoSection.appendChild(tutorialRow());
      infoSection.appendChild(linkRow(t("webBridgeLabel"),
        t("webBridgeDownloadUrl"), t("webBridgeDownload")));
      infoSection.appendChild(linkRow(t("aboutUpdateLabel"), null, t("aboutManualUpdates")));
      infoSection.appendChild(linkRow(t("aboutLicenseLabel"),
        "https://github.com/addsumtech/AgentHalo/blob/main/agenthalo/LICENSE",
        safe.license || "AGPL-3.0-only"));
      const thankYou = document.createElement("p");
      thankYou.textContent = t("aboutUpstreamThanks");
      credits.appendChild(thankYou);
      credits.appendChild(linkRow(t("aboutUpstreamLabel"), safe.upstreamUrl, "Clawd on Desk"));
      const copyright = document.createElement("p");
      copyright.textContent = safe.copyright || "© 2026 Addsum";
      credits.appendChild(copyright);
      const upstreamCopyright = document.createElement("p");
      upstreamCopyright.textContent = safe.upstreamCopyright || "© 2026 Ruller_Lulu and contributors";
      credits.appendChild(upstreamCopyright);
    }).catch((err) => console.warn("AgentHalo: could not load About details", err));
  }

  function init(core) {
    helpers = core.helpers;
    ops = core.ops;
    core.tabs.about = { render };
  }

  root.ClawdSettingsTabAbout = { init };
})(globalThis);
