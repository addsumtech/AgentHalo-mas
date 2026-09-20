"use strict";

const HUD_MAX_EXPANDED_ROWS = 3;
const HUD_MAX_EXPANDED_ROWS_LABELS = 5;
const HUD_TITLE_MAX_UNITS = 15;
const RECENT_DONE_UNREAD_MS = 60 * 1000;
const HUD_BADGE_ORDER = { running: 0, interrupted: 1, done: 1, idle: 1 };

let snapshot = { sessions: [], orderedIds: [], hudTotalNonIdle: 0, hudLastTitle: null, hudShowStateLabels: true, hudShowElapsed: true, hudShowContextUsage: true, hudShowQuota: true, hudPinned: false, accountQuota: [] };
let i18nPayload = { lang: "en", translations: {} };

const unreadSessions = new Set();
const prevBadges = new Map();

const hudEl = document.getElementById("hud");

function isHudSession(session) {
  return !!session && !session.headless && session.state !== "sleeping" && !session.hiddenFromHud;
}

function t(key) {
  const dict = i18nPayload && i18nPayload.translations ? i18nPayload.translations : {};
  return dict[key] || key;
}

function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 5) return t("sessionJustNow");
  if (sec < 60) return t("sessionHudElapsedSec").replace("{n}", sec);
  const min = Math.floor(sec / 60);
  if (min < 5) {
    const secRem = sec % 60;
    return t("sessionHudElapsedMinSec")
      .replace("{m}", min)
      .replace("{s}", secRem);
  }
  if (min < 60) return t("sessionMinAgo").replace("{n}", min);
  const hr = Math.floor(min / 60);
  return t("sessionHrAgo").replace("{n}", hr);
}

function formatTokenCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n >= 1000000) {
    const formatted = (n / 1000000).toFixed(n >= 10000000 ? 0 : 1);
    return `${formatted.replace(/\.0$/, "")}m`;
  }
  if (n >= 1000) {
    const formatted = (n / 1000).toFixed(n >= 10000 ? 0 : 1);
    return `${formatted.replace(/\.0$/, "")}k`;
  }
  return String(Math.round(n));
}

function titleFor(session) {
  return session.displayTitle || session.sessionTitle || session.id || "";
}

function titleUnits(value) {
  let units = 0;
  for (const ch of String(value || "")) {
    if (/\s/.test(ch)) units += 0.5;
    else units += ch.charCodeAt(0) > 0x7F ? 2 : 1;
  }
  return units;
}

function shortenHudTitle(value) {
  const full = String(value || "").replace(/\s+/g, " ").trim();
  if (!full || titleUnits(full) <= HUD_TITLE_MAX_UNITS) return full;

  let units = 0;
  let out = "";
  for (const ch of full) {
    const nextUnits = /\s/.test(ch) ? 0.5 : (ch.charCodeAt(0) > 0x7F ? 2 : 1);
    if (units + nextUnits > HUD_TITLE_MAX_UNITS) break;
    out += ch;
    units += nextUnits;
  }

  let trimmed = out.trimEnd();
  const next = full[trimmed.length] || "";
  if (/[A-Za-z0-9]/.test(trimmed.slice(-1)) && /[A-Za-z0-9]/.test(next)) {
    const wordTrimmed = trimmed.replace(/\s+\S*$/, "").trimEnd();
    if (wordTrimmed && titleUnits(wordTrimmed) >= HUD_TITLE_MAX_UNITS * 0.55) {
      trimmed = wordTrimmed;
    }
  }
  return `${trimmed}\u2026`;
}

function orderedHudSessions(currentSnapshot) {
  const sessions = Array.isArray(currentSnapshot.sessions) ? currentSnapshot.sessions : [];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const ids = Array.isArray(currentSnapshot.orderedIds)
    ? currentSnapshot.orderedIds
    : sessions.map((session) => session.id);
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  const orderedIds = new Set(ordered.map((session) => session.id));
  const missing = sessions.filter((session) => !orderedIds.has(session.id));
  // Stable sorting keeps the existing recency order within each dot color.
  return ordered.concat(missing).filter(isHudSession).sort((a, b) =>
    (HUD_BADGE_ORDER[a.badge] ?? 1) - (HUD_BADGE_ORDER[b.badge] ?? 1)
  );
}

function stateChipInfo(session) {
  if (snapshot.hudShowStateLabels === false) return null;
  return session.badge === "running"
    ? { label: t("sessionBadgeRunning"), cls: "chip-working" }
    : { label: t("sessionBadgeIdle"), cls: "chip-sweeping" };
}

function usageChipInfo(session) {
  if (snapshot.hudShowContextUsage === false) return null;
  const usage = session && session.contextUsage;
  if (!usage || !Number.isFinite(Number(usage.used))) return null;
  const usedLabel = formatTokenCount(usage.used);
  const percentKnown = Number.isFinite(Number(usage.percent));
  if (percentKnown) {
    const percent = Math.max(0, Math.min(100, Math.round(Number(usage.percent))));
    const hasLimit = Number.isFinite(Number(usage.limit));
    return {
      label: `${percent}%`,
      cls: percent >= 90 ? "usage-hot" : (percent >= 75 ? "usage-warm" : "usage-neutral"),
      title: hasLimit
        ? t("sessionHudContextUsageTooltip")
          .replace("{used}", usedLabel)
          .replace("{limit}", formatTokenCount(usage.limit))
          .replace("{percent}", percent)
        : t("sessionHudContextUsageTooltipUnknownLimit").replace("{used}", usedLabel),
    };
  }
  return {
    label: usedLabel,
    cls: "usage-neutral",
    title: t("sessionHudContextUsageTooltipUnknownLimit").replace("{used}", usedLabel),
  };
}

const BELL_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>`;
const PIN_SVG_FILLED = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 4l6 6-4 1-3 3 1 5-2 1-4-4-5 5-1-1 5-5-4-4 1-2 5 1 3-3 1-4z"/></svg>`;
const PIN_SVG_OUTLINE = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M14 4l6 6-4 1-3 3 1 5-2 1-4-4-5 5-1-1 5-5-4-4 1-2 5 1 3-3 1-4z"/></svg>`;

function updateUnread(sessions) {
  const now = Date.now();
  const currentIds = new Set(sessions.map((s) => s.id));
  for (const id of unreadSessions) {
    if (!currentIds.has(id)) unreadSessions.delete(id);
  }
  for (const session of sessions) {
    const prev = prevBadges.get(session.id);
    const curr = session.badge;
    if (curr !== "done") {
      unreadSessions.delete(session.id);
    } else if (prev !== undefined && prev !== "done") {
      unreadSessions.add(session.id);
    } else if (prev === undefined) {
      const updatedAt = Number(session.updatedAt);
      if (Number.isFinite(updatedAt) && now - updatedAt <= RECENT_DONE_UNREAD_MS) {
        unreadSessions.add(session.id);
      }
    }
    prevBadges.set(session.id, curr);
  }
  for (const id of prevBadges.keys()) {
    if (!currentIds.has(id)) prevBadges.delete(id);
  }
}

function splitHudLayout(sessions) {
  return { expanded: sessions, folded: [] };
}

function createRowForSession(session, now) {
  const row = document.createElement("div");
  row.className = "row";
  const canFocus = session.canFocus === true;
  if (!canFocus) {
    row.classList.add("row-unfocusable");
  }

  const left = document.createElement("div");
  left.className = "left";

  const dot = document.createElement("span");
  dot.className = `dot dot-${session.badge || "idle"}`;
  left.appendChild(dot);

  if (session.iconUrl) {
    const img = document.createElement("img");
    img.className = "agent-icon";
    img.alt = "";
    img.src = session.iconUrl;
    left.appendChild(img);
  }

  // Source marker for non-local sessions (compact emoji indicator)
  if (session.sourceType && session.sourceType !== "local") {
    const sourceMarker = document.createElement("span");
    sourceMarker.className = `hud-source hud-source-${session.sourceType}`;
    sourceMarker.title = session.sourceDisplayLabel || session.sourceLabel || "";
    sourceMarker.textContent = session.sourceType === "wsl" ? "🐧" : "🔗";
    left.appendChild(sourceMarker);
  }

  const title = document.createElement("span");
  const fullTitle = titleFor(session);
  const shortTitle = shortenHudTitle(fullTitle);
  // Nothing named this session, so the label is only its workspace folder.
  // Dimming keeps it from reading as a task title, without adding a second icon
  // beside the agent's own.
  title.className = session.titleIsFolder ? "title title-folder" : "title";
  title.textContent = shortTitle;
  if (shortTitle && shortTitle !== fullTitle) title.title = fullTitle;
  left.appendChild(title);

  const showElapsed = snapshot.hudShowElapsed !== false;
  const right = document.createElement("span");
  right.className = "right";
  let hasRightContent = false;

  if (session.badge === "done" && unreadSessions.has(session.id)) {
    const bell = document.createElement("span");
    bell.className = "completion-bell unread-bell";
    bell.innerHTML = BELL_SVG;
    bell.title = t("sessionBadgeDone");
    right.appendChild(bell);
    hasRightContent = true;

  }

  const chipInfo = stateChipInfo(session);
  if (chipInfo) {
    const chip = document.createElement("span");
    chip.className = `state-chip ${chipInfo.cls}`;
    chip.textContent = chipInfo.label;
    right.appendChild(chip);
    hasRightContent = true;
  }

  const usageInfo = usageChipInfo(session);
  if (usageInfo && usageInfo.label) {
    const chip = document.createElement("span");
    chip.className = `usage-chip ${usageInfo.cls}`;
    chip.textContent = usageInfo.label;
    chip.title = usageInfo.title;
    right.appendChild(chip);
    hasRightContent = true;
  }

  if (showElapsed) {
    const updatedAt = Number(session.updatedAt) || now;
    const elapsed = document.createElement("span");
    elapsed.className = "elapsed";
    elapsed.dataset.updatedAt = String(updatedAt);
    elapsed.textContent = formatElapsed(now - updatedAt);
    right.appendChild(elapsed);
    hasRightContent = true;
  }

  row.appendChild(left);
  if (hasRightContent) row.appendChild(right);

  row.addEventListener("click", () => {
    unreadSessions.delete(session.id);
    if (canFocus) {
      render();
      window.sessionHudAPI.focusSession(session.id);
    } else {
      console.info("AgentHalo: session focus unavailable", session.id);
      render();
    }
    // Fire-and-forget: the row click's primary intent is focus / unread
    // dismissal. ack failure shouldn't block the UI — the next snapshot
    // will reconcile the lifecycle flag.
    if (window.sessionHudAPI && typeof window.sessionHudAPI.ackCompletion === "function") {
      Promise.resolve(window.sessionHudAPI.ackCompletion(session.id)).catch((err) => {
        console.warn("ack completion threw:", err);
      });
    }
  });

  return row;
}

function createFoldedRow(count) {
  const row = document.createElement("div");
  row.className = "row row-folded";

  const left = document.createElement("div");
  left.className = "left";

  const dot = document.createElement("span");
  dot.className = "dot dot-idle";
  left.appendChild(dot);

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = t("sessionHudOtherActive").replace("{n}", count);
  left.appendChild(title);

  row.appendChild(left);

  row.addEventListener("click", () => {
    window.sessionHudAPI.openDashboard();
  });

  return row;
}

function createPinButton(pinned) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = pinned ? "pin-btn pinned" : "pin-btn";
  btn.innerHTML = pinned ? PIN_SVG_FILLED : PIN_SVG_OUTLINE;
  const tipKey = pinned ? "sessionHudUnpinTooltip" : "sessionHudPinTooltip";
  btn.title = t(tipKey);
  btn.setAttribute("aria-label", t(tipKey));
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    window.sessionHudAPI.setPinned(!pinned);
  });
  return btn;
}

function render() {
  const sessions = orderedHudSessions(snapshot);
  updateUnread(sessions);
  const previousScrollTop = hudEl.scrollTop;
  hudEl.replaceChildren();
  hudEl.classList.add("has-pin");
  // The HUD shows sessions only; account quota now lives in the pet-attached
  // quota ring window (quota-ring.html).
  if (!sessions.length) return;

  const now = Date.now();
  const { expanded, folded } = splitHudLayout(sessions);

  const toolbar = document.createElement("div");
  toolbar.className = "hud-toolbar";
  const label = document.createElement("span");
  label.className = "hud-toolbar-title";
  label.textContent = t("dashboardWindowTitle");
  toolbar.appendChild(label);
  toolbar.appendChild(createPinButton(snapshot.hudPinned === true));
  hudEl.appendChild(toolbar);

  for (const session of expanded) {
    hudEl.appendChild(createRowForSession(session, now));
  }
  if (folded.length > 0) {
    hudEl.appendChild(createFoldedRow(folded.length));
  }

  hudEl.scrollTop = previousScrollTop;
}

function updateElapsedLabels() {
  const now = Date.now();
  for (const elapsed of document.querySelectorAll(".elapsed[data-updated-at]")) {
    const updatedAt = Number(elapsed.dataset.updatedAt);
    if (!Number.isFinite(updatedAt)) continue;
    elapsed.textContent = formatElapsed(now - updatedAt);
  }
}

async function init() {
  window.sessionHudAPI.onLangChange((payload) => {
    i18nPayload = payload || i18nPayload;
    render();
  });
  window.sessionHudAPI.onSessionSnapshot((nextSnapshot) => {
    snapshot = nextSnapshot || snapshot;
    render();
  });

  i18nPayload = await window.sessionHudAPI.getI18n() || i18nPayload;
  render();
  setInterval(updateElapsedLabels, 1000);
}

init().catch((err) => {
  console.error("AgentHalo HUD failed to initialize", err);
});
