"use strict";

// Mac App Store build: the App Sandbox refuses to exec setuid binaries and
// /bin/ps is setuid root, so every ps the app spawns fails ("deny(1)
// forbidden-exec-sugid"). The bundled proc-info helper (native/proc-info)
// reads the same facts through calls the sandbox allows. This module finds
// the helper, runs it, and parses its one-JSON-object-per-pid output.

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { darwinStartIdentity } = require("../hooks/session-recovery-lease");

const HELPER_NAME = "proc-info";
// The helper refuses more arguments than this.
const MAX_PIDS = 64;
const DEFAULT_TIMEOUT_MS = 1000;

// build.extraResources copies the helper to Contents/Resources/bin.
function resolveHelperPath(options = {}) {
  const resourcesPath = typeof options.resourcesPath === "string" ? options.resourcesPath : process.resourcesPath;
  if (typeof resourcesPath !== "string" || !resourcesPath) return null;
  const candidate = path.join(resourcesPath, "bin", HELPER_NAME);
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function normalizePids(pids) {
  const ids = [];
  for (const value of Array.isArray(pids) ? pids : []) {
    const pid = Number(value);
    if (Number.isInteger(pid) && pid > 0 && !ids.includes(pid)) ids.push(pid);
  }
  return ids.slice(0, MAX_PIDS);
}

function optionalString(value) {
  return typeof value === "string" && value ? value : null;
}

// Returns Map<pid, { pid, ppid, startSec, startUsec, tty, comm, path, argv0 }>.
// Pids the helper reported missing, and malformed lines, are left out.
function parseProcInfoOutput(stdout) {
  const infoByPid = new Map();
  for (const line of String(stdout || "").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== "object" || row.missing === true) continue;
    if (!Number.isInteger(row.pid) || row.pid <= 0) continue;
    infoByPid.set(row.pid, {
      pid: row.pid,
      ppid: Number.isInteger(row.ppid) && row.ppid >= 0 ? row.ppid : null,
      startSec: Number.isSafeInteger(row.start) && row.start > 0 ? row.start : null,
      startUsec: Number.isInteger(row.startUsec) && row.startUsec >= 0 ? row.startUsec : null,
      tty: optionalString(row.tty),
      comm: optionalString(row.comm),
      path: optionalString(row.path),
      argv0: optionalString(row.argv0),
    });
  }
  return infoByPid;
}

function helperUnavailableError() {
  const err = new Error("proc-info helper not found");
  err.code = "ENOENT";
  return err;
}

function queryProcInfo(pids, options, callback) {
  const ids = normalizePids(pids);
  if (!ids.length) return callback(null, new Map());
  const helperPath = options.helperPath || resolveHelperPath(options);
  if (!helperPath) return callback(helperUnavailableError(), new Map());
  const run = typeof options.execFile === "function" ? options.execFile : childProcess.execFile;
  run(helperPath, ids.map(String), {
    encoding: "utf8",
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
  }, (err, stdout) => {
    if (err) return callback(err, new Map());
    callback(null, parseProcInfoOutput(stdout));
  });
}

function queryProcInfoSync(pids, options = {}) {
  const ids = normalizePids(pids);
  if (!ids.length) return new Map();
  const helperPath = options.helperPath || resolveHelperPath(options);
  if (!helperPath) return new Map();
  const run = typeof options.execFileSync === "function" ? options.execFileSync : childProcess.execFileSync;
  try {
    return parseProcInfoOutput(run(helperPath, ids.map(String), {
      encoding: "utf8",
      timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    }));
  } catch {
    return new Map();
  }
}

// Same identities hooks/session-recovery-lease.js derives from ps lstart.
function getProcessStartIdentities(pids, options = {}) {
  const identities = new Map();
  for (const [pid, info] of queryProcInfoSync(pids, options)) {
    const identity = darwinStartIdentity(info.startSec);
    if (identity) identities.set(pid, identity);
  }
  return identities;
}

// ps -o comm= prints argv[0] as the process started it, or the kernel's short
// name when the arguments are out of reach; ps -o tty= prints "??" without a
// controlling terminal.
const PS_COLUMNS = {
  pid: (info) => String(info.pid),
  ppid: (info) => (info.ppid === null ? "" : String(info.ppid)),
  tty: (info) => info.tty || "??",
  comm: (info) => info.argv0 || info.path || info.comm || "",
};

// Stands in for execFile("ps", ["-o", columns, "-p", pids.join(",")], ...)
// for the columns the focus paths read (pid, ppid, tty, comm), one row per live
// pid in the order asked. Like BSD ps, it reports an error when any pid is gone
// but still prints the live rows.
function execPsColumns(columns, pids, options, callback) {
  const fields = String(columns || "").split(",").map((column) => column.trim().replace(/=$/, ""));
  if (!fields.length || fields.some((field) => !PS_COLUMNS[field])) {
    const err = new Error(`proc-info cannot print ps columns "${columns}"`);
    err.code = "EINVAL";
    return callback(err, "", "");
  }
  const ids = normalizePids(pids);
  queryProcInfo(ids, options || {}, (err, infoByPid) => {
    if (err) return callback(err, "", "");
    const lines = [];
    for (const pid of ids) {
      const info = infoByPid.get(pid);
      if (info) lines.push(fields.map((field) => PS_COLUMNS[field](info)).join(" "));
    }
    const stdout = lines.length ? `${lines.join("\n")}\n` : "";
    if (lines.length === ids.length && ids.length > 0) return callback(null, stdout, "");
    const missing = new Error("proc-info: no such process");
    missing.code = 1;
    callback(missing, stdout, "");
  });
}

module.exports = {
  HELPER_NAME,
  MAX_PIDS,
  resolveHelperPath,
  parseProcInfoOutput,
  queryProcInfo,
  queryProcInfoSync,
  getProcessStartIdentities,
  execPsColumns,
};
