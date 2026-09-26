#!/usr/bin/env node
// Register Clawd's CodeWhale hooks in the user's codewhale config.
//
// Strategy: append [[hooks.hooks]] entries into ~/.codewhale/config.toml.
// Idempotent — existing clawd-managed entries are updated, others preserved.
//
// CodeWhale hook config format ([[hooks.hooks]] TOML array of tables):
//
//   [hooks]
//   enabled = true
//
//   [[hooks.hooks]]
//   event = "session_start"
//   command = "node /path/to/codewhale-hook.js session_start"
//   background = true
//
// CodeWhale provides context via environment variables:
//   DEEPSEEK_SESSION_ID, DEEPSEEK_TOOL_NAME, DEEPSEEK_MODE,
//   DEEPSEEK_WORKSPACE, DEEPSEEK_MODEL, DEEPSEEK_ERROR, etc.

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  asarUnpackedPath,
  extractExistingNodeBinFromCommands,
  formatNodeHookCommand,
} = require("./json-utils");
const { resolveNodeBin } = require("./server-config");
const {
  STORE_HOOK_NAME,
  STORE_HOOK_SCRIPTS,
  isStoreHookInstall,
  isStoreOwnedCommand,
  storeHookScriptPath,
  storeNodeBin,
} = require("./store-hook-ownership");

const CODEWHALE_CONFIG_PATH = path.join(os.homedir(), ".codewhale", "config.toml");
const MANAGED_MARKER = "managed by clawd-on-desk";
// Mac App Store build: the comment on its own entries. Another AgentHalo
// install owns every entry carrying MANAGED_MARKER or a command that mentions
// codewhale-hook.js (see hooks/store-hook-ownership.js).
const STORE_MANAGED_MARKER = `managed by ${STORE_HOOK_NAME}`;
const HOOK_SCRIPT_MARKER = "codewhale-hook.js";
const TOML_HEADER_RE = /^\s*\[[^\]]+\]/;

// Hook events to register. Each entry: [event, background]
// session_end is NOT background — must await delivery.
// shell_env is excluded (not relevant for state animation).
const HOOK_ENTRIES = [
  ["session_start", true],
  ["session_end", false],
  ["message_submit", true],
  ["tool_call_before", true],
  ["tool_call_after", true],
  ["mode_change", true],
  ["on_error", true],
];

function resolveHookScriptPath(baseDir) {
  const dir = path.resolve(baseDir || __dirname, "codewhale-hook.js");
  return asarUnpackedPath(dir).replace(/\\/g, "/");
}

function normalizePath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function envConfigPath(options = {}) {
  const env = options.env || process.env;
  const value = env && (
    (typeof env.CODEWHALE_CONFIG_PATH === "string" && env.CODEWHALE_CONFIG_PATH.trim())
    || (typeof env.DEEPSEEK_CONFIG_PATH === "string" && env.DEEPSEEK_CONFIG_PATH.trim())
  );
  return value ? path.resolve(String(value).trim()) : null;
}

function resolveCodewhaleConfigPath(options = {}) {
  if (typeof options.configPath === "string" && options.configPath.trim()) {
    return path.resolve(options.configPath);
  }
  return envConfigPath(options)
    || (options.homeDir ? path.join(options.homeDir, ".codewhale", "config.toml") : CODEWHALE_CONFIG_PATH);
}

function hasExplicitConfigPath(options = {}) {
  return !!(typeof options.configPath === "string" && options.configPath.trim()) || !!envConfigPath(options);
}

function extractExistingCodewhaleNodeBin(sections) {
  const commands = [];
  for (const section of sections || []) {
    if (!section || section.header !== "hooks.hooks" || !Array.isArray(section.lines)) continue;
    for (const line of section.lines) {
      if (
        /^\s*command\s*=/.test(String(line || "")) &&
        String(line || "").includes(HOOK_SCRIPT_MARKER)
      ) {
        commands.push(String(line));
      }
    }
  }
  return extractExistingNodeBinFromCommands(commands, HOOK_SCRIPT_MARKER);
}

function buildHookEntry(event, background, hookScriptPath, options = {}, managedMarker = MANAGED_MARKER) {
  const nodeBin = options.nodeBin !== undefined
    ? options.nodeBin
    : (resolveNodeBin(options) || options.existingNodeBin || "node");
  const nodePath = normalizePath(nodeBin);
  const hookPath = normalizePath(hookScriptPath);

  // Use the same node binary that runs Clawd, so the hook can require() our
  // shared modules (server-config, shared-process). Windows node.exe must be
  // quoted in TOML when the path contains spaces.
  const command = formatNodeHookCommand(nodePath, hookPath, {
    platform: options.platform || process.platform,
    windowsWrapper: "none",
    args: [event],
  });

  const lines = [];
  lines.push("");
  lines.push("[[hooks.hooks]]");
  lines.push(`# ${managedMarker}`);
  lines.push(`event = "${event}"`);
  lines.push(`command = '''${command}'''`);
  if (background) {
    lines.push("background = true");
  }
  // timeout_secs = 5 is safe for fire-and-forget; session_end gets 30s default
  if (!background) {
    lines.push("timeout_secs = 30");
    lines.push("continue_on_error = true");
  } else {
    lines.push("timeout_secs = 5");
  }
  return lines.join("\n");
}

// managedMarkers: the "managed by" comments that belong to the entry below
// them when a hand edit moved one above its [[hooks.hooks]] header.
function parseTomlSections(content, managedMarkers = [MANAGED_MARKER]) {
  // Minimal TOML parser: split into sections, preserving raw text.
  // We only need to find/replace [[hooks.hooks]] entries with the managed marker.
  const markers = Array.isArray(managedMarkers) ? managedMarkers : [MANAGED_MARKER];
  const sections = [];
  const lines = content.split("\n");
  let current = { header: null, startLine: 0, lines: [] };
  let inHooksTable = false;

  function takeTrailingManagedMarker(lines) {
    let markerIndex = lines.length - 1;
    while (markerIndex >= 0 && !String(lines[markerIndex] || "").trim()) markerIndex--;
    if (markerIndex < 0 || !markers.some((marker) => String(lines[markerIndex]).includes(marker))) return [];
    return lines.splice(markerIndex);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect [[hooks.hooks]] entries
    if (/^\[\[hooks\.hooks\]\]/.test(trimmed)) {
      const leadingMarker = takeTrailingManagedMarker(current.lines);
      if (current.lines.length > 0 || current.header) {
        sections.push({ ...current, endLine: i - 1 });
      }
      current = { header: "hooks.hooks", startLine: i - leadingMarker.length, lines: [...leadingMarker, line] };
      inHooksTable = true;
      continue;
    }

    // Detect [hooks] section header (without the double brackets)
    if (/^\[hooks\]/.test(trimmed) && !trimmed.startsWith("[[")) {
      if (current.lines.length > 0 || current.header) {
        sections.push({ ...current, endLine: i - 1 });
      }
      current = { header: "hooks", startLine: i, lines: [line] };
      inHooksTable = true;
      continue;
    }

    // End of hooks-related section when hitting any different TOML table.
    if (inHooksTable && TOML_HEADER_RE.test(trimmed)) {
      sections.push({ ...current, endLine: i - 1 });
      current = { header: null, startLine: i, lines: [line] };
      inHooksTable = false;
      continue;
    }

    current.lines.push(line);
  }
  if (current.lines.length > 0 || current.header) {
    sections.push({ ...current, endLine: lines.length - 1 });
  }

  return sections;
}

function sectionHasMarker(section) {
  return section.lines.some((line) => line.includes(MANAGED_MARKER));
}

function sectionHasClawdHookCommand(section) {
  return section.lines.some((line) => (
    /^\s*command\s*=/.test(String(line || "")) &&
    String(line || "").includes(HOOK_SCRIPT_MARKER)
  ));
}

function sectionIsManagedHook(section) {
  if (!section || section.header !== "hooks.hooks") return false;
  return sectionHasMarker(section) || sectionHasClawdHookCommand(section);
}

function ensureHooksEnabled(section) {
  if (!section || section.header !== "hooks") return false;
  const enabledIdx = section.lines.findIndex((line) => /^\s*enabled\s*=/.test(String(line || "")));
  if (enabledIdx >= 0) {
    if (/^\s*enabled\s*=\s*true(?:\s*(?:#.*)?)?$/.test(String(section.lines[enabledIdx] || ""))) {
      return false;
    }
    section.lines[enabledIdx] = "enabled = true";
    return true;
  }
  section.lines.splice(1, 0, "enabled = true");
  return true;
}

function buildClawdHookSections(hookScriptPath, options = {}, managedMarker = MANAGED_MARKER) {
  const sections = [];
  for (const [event, background] of HOOK_ENTRIES) {
    sections.push(buildHookEntry(event, background, hookScriptPath, options, managedMarker));
  }
  return sections;
}

// Store build: its own entries are the ones with its marker comment or its
// entry script, plus those an earlier store build wrote (this bundle's launcher
// running this bundle's codewhale-hook.js, under MANAGED_MARKER).
function sectionIsStoreManagedHook(section) {
  if (!section || section.header !== "hooks.hooks") return false;
  if (section.lines.some((line) => String(line || "").includes(STORE_MANAGED_MARKER))) return true;
  return section.lines.some((line) => (
    /^\s*command\s*=/.test(String(line || ""))
    && isStoreOwnedCommand(String(line), STORE_HOOK_SCRIPTS.codewhale, HOOK_SCRIPT_MARKER)
  ));
}

function sectionText(lines) {
  return lines.map((line) => String(line || "").trimEnd()).filter((line) => line.trim()).join("\n");
}

function hooksSectionEnabled(section) {
  return !!section && section.lines.some((line) => /^\s*enabled\s*=\s*true(?:\s*(?:#.*)?)?$/.test(String(line || "")));
}

// Store build: another install puts its entries back just below [hooks] on
// every sync, so the store build never inserts above them (that install would
// then rewrite the file each time). New entries go after the existing
// [[hooks.hooks]] entries, changed ones stay where they were, and current ones
// are left untouched.
function placeStoreHookSections(sections, newEntries) {
  const managed = [];
  for (let i = 0; i < sections.length; i++) {
    if (sectionIsStoreManagedHook(sections[i])) managed.push(i);
  }
  let hooksIdx = sections.findIndex((section) => section.header === "hooks");
  const current = managed.map((i) => sectionText(sections[i].lines));
  const desired = newEntries.map((entry) => sectionText(entry.split("\n")));
  if (
    hooksIdx >= 0
    && hooksSectionEnabled(sections[hooksIdx])
    && current.length === desired.length
    && current.every((text, i) => text === desired[i])
  ) {
    return { changed: false, removed: 0 };
  }

  let insertIdx = managed.length ? managed[0] : -1;
  for (const idx of [...managed].reverse()) sections.splice(idx, 1);
  hooksIdx = sections.findIndex((section) => section.header === "hooks");
  if (hooksIdx < 0) {
    sections.push({ header: "hooks", startLine: -1, lines: ["[hooks]", "enabled = true"] });
    hooksIdx = sections.length - 1;
    insertIdx = hooksIdx + 1;
  } else {
    ensureHooksEnabled(sections[hooksIdx]);
    if (insertIdx < 0) {
      // After [hooks] and the entries that follow it.
      insertIdx = hooksIdx + 1;
      while (insertIdx < sections.length && sections[insertIdx].header === "hooks.hooks") insertIdx++;
    }
  }
  for (const entry of newEntries) {
    // A trailing blank line keeps whatever follows apart, as the parsed entry
    // it replaces did (reconstructToml collapses repeated blank lines).
    sections.splice(insertIdx, 0, { header: "hooks.hooks", startLine: -1, lines: [...entry.split("\n"), ""] });
    insertIdx++;
  }
  return { changed: true, removed: managed.length };
}

function registerCodewhaleHooks(options = {}) {
  const store = isStoreHookInstall(options);
  const managedMarker = store ? STORE_MANAGED_MARKER : MANAGED_MARKER;
  const hookScriptPath = options.hookScriptPath
    || (store ? storeHookScriptPath(STORE_HOOK_SCRIPTS.codewhale) : resolveHookScriptPath());
  const storeEntryOptions = store ? { ...options, nodeBin: storeNodeBin(options) } : null;
  const configPath = resolveCodewhaleConfigPath(options);
  const explicitConfigPath = hasExplicitConfigPath(options);

  // Check if ~/.codewhale/ exists
  const configDir = path.dirname(configPath);
  let configDirExists = false;
  try {
    configDirExists = fs.statSync(configDir).isDirectory();
  } catch {}
  if (!configDirExists && !explicitConfigPath) {
    if (!options.silent) {
      console.log("AgentHalo: ~/.codewhale/ not found — skipping CodeWhale hook registration");
    }
    return { added: 0, removed: 0, updated: 0, skipped: true };
  }

  let content;
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      content = "";
    } else {
      throw new Error(`Failed to read ${configPath}: ${err.message}`);
    }
  }

  // If config doesn't exist or is empty → bootstrap with [hooks] + entries
  if (!content.trim()) {
    const hookSections = store
      ? buildClawdHookSections(hookScriptPath, storeEntryOptions, managedMarker)
      : buildClawdHookSections(hookScriptPath, options);
    const newContent = [
      "# codewhale Configuration",
      "",
      "[hooks]",
      "enabled = true",
      ...hookSections,
      "",
    ].join("\n");

    const dir = path.dirname(configPath);
    if (!configDirExists) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, newContent, "utf8");

    if (!options.silent) {
      console.log(`Clawd CodeWhale hooks → ${configPath}`);
      console.log(`  Created config with ${HOOK_ENTRIES.length} hooks`);
    }
    return { added: HOOK_ENTRIES.length, removed: 0, updated: 0, skipped: false };
  }

  if (store) {
    const sections = parseTomlSections(content, [MANAGED_MARKER, STORE_MANAGED_MARKER]);
    const placed = placeStoreHookSections(
      sections,
      buildClawdHookSections(hookScriptPath, storeEntryOptions, managedMarker)
    );
    const newContent = placed.changed ? reconstructToml(sections) : content;
    return writeRegisteredCodewhaleHooks(configPath, content, newContent, placed.removed, options);
  }

  // Parse existing config
  const sections = parseTomlSections(content);
  const existingNodeBin = extractExistingCodewhaleNodeBin(sections);
  const entryOptions = existingNodeBin
    ? { ...options, existingNodeBin }
    : options;

  // Find existing clawd-managed hook entries
  const managedHookIndices = [];
  for (let i = 0; i < sections.length; i++) {
    if (sectionIsManagedHook(sections[i])) {
      managedHookIndices.push(i);
    }
  }

  // Build new managed entries
  const newEntries = buildClawdHookSections(hookScriptPath, entryOptions);

  // Remove old managed entries
  const matchedManagedHooks = managedHookIndices.length;
  for (const idx of managedHookIndices.reverse()) {
    sections.splice(idx, 1);
  }

  // Insert new entries after [hooks] section or at end
  let hooksIdx = sections.findIndex((s) => s.header === "hooks");

  // If no [hooks] section, add one
  if (hooksIdx < 0) {
    sections.push({ header: "hooks", startLine: -1, lines: ["[hooks]", "enabled = true"] });
    hooksIdx = sections.length - 1;
  } else {
    ensureHooksEnabled(sections[hooksIdx]);
  }

  // Insert managed entries (as raw strings — we insert them into the sections array)
  let insertIdx = hooksIdx + 1;
  for (const entry of newEntries) {
    const entryLines = entry.split("\n");
    sections.splice(insertIdx, 0, {
      header: "hooks.hooks",
      startLine: -1,
      lines: entryLines,
    });
    insertIdx++;
  }

  // Reconstruct TOML
  const newContent = reconstructToml(sections);
  return writeRegisteredCodewhaleHooks(configPath, content, newContent, matchedManagedHooks, options);
}

function reconstructToml(sections) {
  const newLines = [];
  for (const section of sections) {
    for (const line of section.lines) {
      if (line || newLines.length === 0 || newLines[newLines.length - 1] !== "") {
        newLines.push(line);
      }
    }
  }
  return newLines.join("\n").trim() + "\n";
}

function writeRegisteredCodewhaleHooks(configPath, content, newContent, matchedManagedHooks, options = {}) {
  const configDir = path.dirname(configPath);
  const updated = newContent !== content;
  const removed = updated ? matchedManagedHooks : 0;

  if (updated) {
    // Atomic write
    const tmpPath = path.join(configDir, `.config.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmpPath, newContent, "utf8");
    fs.renameSync(tmpPath, configPath);
  }

  const added = updated ? HOOK_ENTRIES.length : 0;
  if (!options.silent) {
    console.log(`Clawd CodeWhale hooks → ${configPath}`);
    if (updated) {
      console.log(`  Registered ${added} hooks (removed ${removed} old entries)`);
    } else {
      console.log(`  Already up to date (${HOOK_ENTRIES.length} hooks)`);
    }
  }

  return { added, removed, updated, skipped: !updated };
}

function unregisterCodewhaleHooks(options = {}) {
  const configPath = resolveCodewhaleConfigPath(options);

  let content;
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      if (!options.silent) console.log("AgentHalo: CodeWhale config not found");
      return { removed: 0, skipped: true };
    }
    throw err;
  }

  const store = isStoreHookInstall(options);
  const sections = store
    ? parseTomlSections(content, [MANAGED_MARKER, STORE_MANAGED_MARKER])
    : parseTomlSections(content);
  const isManaged = store ? sectionIsStoreManagedHook : sectionIsManagedHook;
  let removed = 0;

  for (let i = sections.length - 1; i >= 0; i--) {
    if (isManaged(sections[i])) {
      sections.splice(i, 1);
      removed++;
    }
  }

  if (removed === 0) {
    if (!options.silent) console.log("AgentHalo: no managed CodeWhale hooks found");
    return { removed: 0, skipped: true };
  }

  const newLines = [];
  for (const section of sections) {
    for (const line of section.lines) {
      if (line || newLines.length === 0 || newLines[newLines.length - 1] !== "") {
        newLines.push(line);
      }
    }
  }

  const newContent = newLines.join("\n").trim() + "\n";
  const configDir = path.dirname(configPath);
  const tmpPath = path.join(configDir, `.config.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, newContent, "utf8");
  fs.renameSync(tmpPath, configPath);

  if (!options.silent) {
    console.log(`Clawd CodeWhale hooks removed: ${removed}`);
  }

  return { removed, skipped: false };
}

module.exports = {
  CODEWHALE_CONFIG_PATH,
  HOOK_ENTRIES,
  MANAGED_MARKER,
  STORE_MANAGED_MARKER,
  parseTomlSections,
  registerCodewhaleHooks,
  resolveCodewhaleConfigPath,
  unregisterCodewhaleHooks,
  // Exposed for tests
  __test: {
    buildHookEntry,
    parseTomlSections,
    sectionHasMarker,
    sectionHasClawdHookCommand,
    sectionIsManagedHook,
    ensureHooksEnabled,
    buildClawdHookSections,
    extractExistingCodewhaleNodeBin,
    envConfigPath,
    hasExplicitConfigPath,
    resolveHookScriptPath,
    normalizePath,
  },
};

if (require.main === module) {
  try {
    if (process.argv.includes("--uninstall")) {
      unregisterCodewhaleHooks({});
    } else {
      registerCodewhaleHooks({});
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
