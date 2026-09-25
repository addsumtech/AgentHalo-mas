#!/usr/bin/env node
"use strict";

// Static runtime reachability audit for the packaged app.
//
// build.files ships `src/**/*`, so a module is packaged whether or not the app
// can ever load it. This script follows what the app really loads, starting
// from the runtime entry points:
//
//   - src/main.js (package.json "main")
//   - every preload script (src/preload*.js)
//   - every <script src> in src/*.html
//   - agents/** and hooks/**, which run in external processes (hook runners,
//     installers, NSIS) and must stay packaged in full
//
// and walks the static `require()` graph. Anything that is not a literal
// require is handled conservatively:
//
//   - a non-literal `require(expr)` / `import(expr)` is listed in
//     `dynamicRequires`, and every src file it could name counts as
//     reachable: those under its static relative prefix
//     (`require(\`./plugins/${name}\`)`), or all of src/ when it has none;
//   - a string literal that names an existing file (".js", ".json", ".html",
//     ".css") counts as a reference — this is how preload scripts, worker
//     scripts and HTML pages are loaded (`path.join(__dirname, "x.js")`). A
//     bare file name that does not resolve next to the referencing file is
//     matched against every src file with that name;
//   - a template literal that builds such a name at run time
//     (`tab-${id}.js`) makes every src file matching its static parts
//     reachable.
//
// It reports src/** files no entry point can reach and production
// dependencies that reachable code never requires (plus the packages only
// those dependencies pull in). test/runtime-reachability.test.js uses the same
// analysis to prove every `!` exclude in build.files is safe.
//
// A `require("x")` that only appears as text (in a comment or a string) is
// still followed, marked textOnly, so a tokenizer mistake can only keep code.
//
// Usage: node scripts/audit-runtime-reachability.js [--json] [--check]
//   --json   print the full report as JSON
//   --check  exit 1 unless every `!` pattern in build.files is provably safe:
//            excluded src files are unreachable, excluded packages are not
//            needed by anything reachable, and no reachable file (or theme
//            manifest) names an excluded asset

const fs = require("fs");
const path = require("path");
const { builtinModules } = require("module");

const DEFAULT_ROOT = path.resolve(__dirname, "..");
const EXTERNAL_ENTRY_DIRS = ["agents", "hooks"];
// Provided by the Electron runtime, never packaged from node_modules.
const RUNTIME_PROVIDED_MODULES = new Set(["electron"]);
const RESOLVE_EXTENSIONS = [".js", ".cjs", ".mjs", ".json"];
const FILE_EXTENSION_RE = /\.(?:js|cjs|mjs|json|html|css)$/;
const REFERENCE_RE = /^(?:\.{1,2}\/)?(?:[\w@.-]+\/)*[\w@.-]*[\w-]\.(?:js|cjs|mjs|json|html|css)$/;
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, name.split("/")[0]]));
const KEYWORDS_BEFORE_EXPRESSION = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

function listFiles(root, relDir) {
  const out = [];
  const base = path.join(root, relDir);
  if (!fs.existsSync(base)) return out;
  (function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(toPosix(path.relative(root, full)));
    }
  })(base);
  return out;
}

// ── Minimal JavaScript tokenizer ──
//
// Enough of the lexical grammar to tell code from comments, strings, template
// literals and regular expressions, so a `require("x")` inside a comment or a
// string is not mistaken for a real one, and a string that names a file is
// seen even when it sits in a template literal.
function tokenize(source) {
  const tokens = [];
  const src = String(source);
  const n = src.length;
  let i = 0;
  let line = 1;
  let braceDepth = 0;
  const templateStack = [];

  if (src.startsWith("#!")) {
    while (i < n && src[i] !== "\n") i++;
  }

  function push(type, value, startLine, extra) {
    tokens.push({ type, value, line: startLine, ...extra });
  }

  function regexAllowed() {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.type === "punct") return !/^[)\]}]$/.test(prev.value);
    if (prev.type === "ident") return KEYWORDS_BEFORE_EXPRESSION.has(prev.value);
    return false;
  }

  function readEscape() {
    // src[i] === "\\"
    const next = src[i + 1];
    if (next === "\n") line++;
    i += 2;
    return next === undefined ? "" : next;
  }

  // Reads template characters up to "`" (end) or "${" (substitution).
  function readTemplateChunk(startLine, isHead) {
    let value = "";
    while (i < n) {
      const ch = src[i];
      if (ch === "\\") { value += readEscape(); continue; }
      if (ch === "`") {
        i++;
        push("template", value, startLine, { head: isHead, tail: true });
        return;
      }
      if (ch === "$" && src[i + 1] === "{") {
        i += 2;
        push("template", value, startLine, { head: isHead, tail: false });
        templateStack.push(braceDepth);
        braceDepth++;
        return;
      }
      if (ch === "\n") line++;
      value += ch;
      i++;
    }
    push("template", value, startLine, { head: isHead, tail: true });
  }

  while (i < n) {
    const ch = src[i];
    if (ch === "\n") { line++; i++; continue; }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v" || ch === " " || ch === "﻿") { i++; continue; }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      const startLine = line;
      let value = "";
      i++;
      while (i < n && src[i] !== ch && src[i] !== "\n") {
        if (src[i] === "\\") { value += readEscape(); continue; }
        value += src[i];
        i++;
      }
      i++;
      push("string", value, startLine);
      continue;
    }
    if (ch === "`") {
      i++;
      readTemplateChunk(line, true);
      continue;
    }
    if (ch === "}" && templateStack.length && braceDepth - 1 === templateStack[templateStack.length - 1]) {
      braceDepth--;
      templateStack.pop();
      i++;
      readTemplateChunk(line, false);
      continue;
    }
    if (ch === "/" && regexAllowed()) {
      const startLine = line;
      let inClass = false;
      i++;
      while (i < n) {
        const c = src[i];
        if (c === "\\") { i += 2; continue; }
        if (c === "\n") break;
        if (inClass) {
          if (c === "]") inClass = false;
        } else if (c === "[") {
          inClass = true;
        } else if (c === "/") {
          break;
        }
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      push("regex", "", startLine);
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < n && /[\w$]/.test(src[i])) i++;
      push("ident", src.slice(start, i), line);
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < n && /[\w.]/.test(src[i])) i++;
      push("number", src.slice(start, i), line);
      continue;
    }
    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    push("punct", ch, line);
    i++;
  }
  return tokens;
}

function isLiteral(token) {
  return !!token && (token.type === "string" || (token.type === "template" && token.head && token.tail));
}

// Returns literal requires, non-literal requires and string values of one
// source file.
function scanSource(source) {
  const tokens = tokenize(source);
  const requires = [];
  const dynamic = [];
  const strings = [];
  const computed = [];
  const openTemplates = [];
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.type === "string" || token.type === "template") {
      strings.push({ value: token.value, line: token.line });
      // A template with substitutions, e.g. `settings-tab-${id}.js`, names a
      // file only at run time; keep its static parts for a wildcard match.
      if (token.type === "template" && !(token.head && token.tail)) {
        if (token.head) openTemplates.push({ parts: [token.value], line: token.line });
        else if (openTemplates.length) openTemplates[openTemplates.length - 1].parts.push(token.value);
        if (token.tail && openTemplates.length) computed.push(openTemplates.pop());
      }
      continue;
    }
    if (token.type !== "ident") continue;
    const prev = tokens[k - 1];
    const isMember = prev && prev.type === "punct" && prev.value === ".";
    let callIndex = null;
    let kind = null;
    if (token.value === "require" && !isMember) {
      const next = tokens[k + 1];
      if (next && next.type === "punct" && next.value === "(") {
        callIndex = k + 1;
        kind = "require";
      } else if (
        next && next.type === "punct" && next.value === "."
        && tokens[k + 2] && tokens[k + 2].type === "ident" && tokens[k + 2].value === "resolve"
        && tokens[k + 3] && tokens[k + 3].type === "punct" && tokens[k + 3].value === "("
      ) {
        callIndex = k + 3;
        kind = "require.resolve";
      }
    } else if (token.value === "import" && !isMember) {
      const next = tokens[k + 1];
      if (next && next.type === "punct" && next.value === "(") {
        callIndex = k + 1;
        kind = "import";
      }
    }
    if (callIndex === null) continue;
    const arg = tokens[callIndex + 1];
    const after = tokens[callIndex + 2];
    if (isLiteral(arg) && after && after.type === "punct" && (after.value === ")" || after.value === ",")) {
      requires.push({ specifier: arg.value, line: token.line, kind });
    } else {
      const parts = [];
      let depth = 0;
      for (let m = callIndex; m < tokens.length && parts.length < 24; m++) {
        const t = tokens[m];
        if (t.type === "punct" && t.value === "(") depth++;
        if (t.type === "punct" && t.value === ")") depth--;
        parts.push(t.type === "string" ? JSON.stringify(t.value) : t.type === "template" ? "`…`" : t.value);
        if (depth === 0) break;
      }
      // `require(\`./plugins/${name}\`)` or `require("./plugins/" + name)`
      // still pins the directory; anything else could load any file.
      let staticPrefix = null;
      if (arg && arg.type === "template" && arg.head && !arg.tail) staticPrefix = arg.value;
      else if (arg && arg.type === "string" && after && after.type === "punct" && after.value === "+") staticPrefix = arg.value;
      dynamic.push({ kind, line: token.line, expression: `${kind}${parts.join("")}`, staticPrefix });
    }
  }
  // Safety net: any `require("x")` text the tokenizer did not see as a call
  // (normally one inside a comment or a string) still counts, marked
  // textOnly. A tokenizer mistake can then only keep more code, never less.
  const seen = new Set(requires.map((r) => r.specifier));
  const naive = /\brequire\s*\(\s*(["'])([^"'\n$]+)\1\s*\)/g;
  let match;
  while ((match = naive.exec(source))) {
    if (seen.has(match[2])) continue;
    seen.add(match[2]);
    requires.push({ specifier: match[2], line: source.slice(0, match.index).split("\n").length, kind: "require", textOnly: true });
  }
  return { requires, dynamic, strings, computed };
}

function resolveFile(root, fromFile, specifier) {
  const base = path.resolve(root, path.dirname(fromFile), specifier);
  const candidates = [base, ...RESOLVE_EXTENSIONS.map((ext) => base + ext)];
  candidates.push(...RESOLVE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)));
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return toPosix(path.relative(root, candidate));
    } catch {}
  }
  try {
    const pkgPath = path.join(base, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg && typeof pkg.main === "string") return resolveFile(root, toPosix(path.relative(root, pkgPath)), `./${pkg.main}`);
  } catch {}
  return null;
}

function packageNameOf(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isBuiltin(specifier) {
  if (specifier.startsWith("node:")) return true;
  return BUILTINS.has(specifier) || BUILTINS.has(specifier.split("/")[0]);
}

function htmlReferences(source) {
  const refs = [];
  const re = /<(script|link)\b[^>]*?\b(src|href)\s*=\s*(["'])([^"']+)\3/gi;
  let match;
  while ((match = re.exec(source))) {
    refs.push({ tag: match[1].toLowerCase(), value: match[4] });
  }
  return refs;
}

function cssReferences(source) {
  const refs = [];
  const re = /@import\s+(?:url\()?\s*(["'])([^"']+)\1/gi;
  let match;
  while ((match = re.exec(source))) refs.push(match[2]);
  return refs;
}

function isLocalRef(value) {
  return !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//") && !value.startsWith("#");
}

// ── Dependency closure (name based, conservative) ──
function readPackageJson(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function findPackageDir(root, fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.resolve(dir) === path.resolve(root)) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Every package name the given packages can load, following dependencies,
// optionalDependencies and peerDependencies through node_modules the way
// Node resolves them. `installed` holds the names actually present on disk.
function dependencyClosure(root, names) {
  const seenDirs = new Set();
  const seenNames = new Set();
  const installed = new Set();
  const queue = names.map((name) => ({ name, fromDir: root }));
  while (queue.length) {
    const { name, fromDir } = queue.shift();
    seenNames.add(name);
    const dir = findPackageDir(root, fromDir, name);
    if (!dir) continue;
    installed.add(name);
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    const pkg = readPackageJson(dir) || {};
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const dep of Object.keys(pkg[field] || {})) queue.push({ name: dep, fromDir: dir });
    }
  }
  return { names: seenNames, installed };
}

function analyzeRuntimeReachability(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const pkg = options.packageJson || JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const srcFiles = listFiles(root, "src");
  const srcSet = new Set(srcFiles);
  const byBasename = new Map();
  for (const file of srcFiles) {
    const name = path.posix.basename(file);
    if (!byBasename.has(name)) byBasename.set(name, []);
    byBasename.get(name).push(file);
  }

  const entryPoints = new Set();
  const mainEntry = toPosix(path.normalize(pkg.main || "src/main.js"));
  entryPoints.add(mainEntry);
  for (const file of srcFiles) {
    if (/^src\/preload[^/]*\.js$/.test(file)) entryPoints.add(file);
  }
  for (const file of srcFiles) {
    if (!/^src\/[^/]+\.html$/.test(file)) continue;
    for (const ref of htmlReferences(fs.readFileSync(path.join(root, file), "utf8"))) {
      if (ref.tag !== "script" || !isLocalRef(ref.value)) continue;
      const resolved = resolveFile(root, file, ref.value.split(/[?#]/)[0]);
      if (resolved) entryPoints.add(resolved);
    }
  }
  for (const dir of EXTERNAL_ENTRY_DIRS) {
    for (const file of listFiles(root, dir)) {
      if (/\.(?:c|m)?js$/.test(file)) entryPoints.add(file);
    }
  }

  const reachable = new Set();
  const via = new Map();
  const dynamicRequires = [];
  const unresolved = [];
  const packageRequires = new Map(); // package name -> [{file, specifier}]
  const nameMatchedReferences = [];
  const computedReferences = [];
  const queue = [];

  function mark(file, reason) {
    if (reachable.has(file)) return;
    reachable.add(file);
    via.set(file, reason);
    queue.push(file);
  }

  for (const file of [...entryPoints].sort()) mark(file, "entry point");

  while (queue.length) {
    const file = queue.shift();
    const full = path.join(root, file);
    let source;
    try {
      source = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (/\.html$/.test(file)) {
      for (const ref of htmlReferences(source)) {
        if (!isLocalRef(ref.value)) continue;
        const resolved = resolveFile(root, file, ref.value.split(/[?#]/)[0]);
        if (resolved) mark(resolved, `<${ref.tag}> in ${file}`);
      }
      continue;
    }
    if (/\.css$/.test(file)) {
      for (const ref of cssReferences(source)) {
        if (!isLocalRef(ref)) continue;
        const resolved = resolveFile(root, file, ref);
        if (resolved) mark(resolved, `@import in ${file}`);
      }
      continue;
    }
    if (!/\.(?:c|m)?js$/.test(file)) continue;

    const scan = scanSource(source);
    for (const req of scan.requires) {
      const spec = req.specifier;
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const resolved = resolveFile(root, file, spec);
        if (resolved) mark(resolved, `${req.kind}("${spec}") in ${file}`);
        else unresolved.push({ file, line: req.line, specifier: spec });
        continue;
      }
      if (isBuiltin(spec) || RUNTIME_PROVIDED_MODULES.has(packageNameOf(spec))) continue;
      const name = packageNameOf(spec);
      if (!packageRequires.has(name)) packageRequires.set(name, []);
      packageRequires.get(name).push({ file, line: req.line, specifier: spec });
    }
    for (const dyn of scan.dynamic) {
      dynamicRequires.push({ file, ...dyn });
      // Conservative: a computed require keeps everything it could name. With
      // a relative static prefix that is the files under that prefix; without
      // one it is every src file, which makes any src exclude fail the check
      // until a human has looked at the new require.
      let scope = "";
      if (dyn.staticPrefix && dyn.staticPrefix.startsWith(".")) {
        scope = toPosix(path.relative(root, path.resolve(root, path.dirname(file), dyn.staticPrefix)));
        if (dyn.staticPrefix.endsWith("/")) scope += "/";
      }
      for (const candidate of srcFiles) {
        if (!scope || candidate.startsWith(scope)) mark(candidate, `non-literal ${dyn.kind} in ${file}:${dyn.line}`);
      }
    }
    for (const tpl of scan.computed) {
      const joined = tpl.parts.join("\0"); // \0 marks a substitution
      if (!FILE_EXTENSION_RE.test(joined)) continue;
      const basenamePattern = joined.slice(joined.lastIndexOf("/") + 1);
      const template = tpl.parts.join("${…}");
      let matches;
      if (!basenamePattern.replace(FILE_EXTENSION_RE, "").replace(/\0/g, "")) {
        // `${somePath}.js`: the whole name is computed. It may name anything
        // under the referencing file's own tree — for a file in src/ that is
        // all of src/, so any src exclude then needs a human review; for the
        // external hooks/ and agents/ trees it stays inside those trees.
        const dir = path.posix.dirname(file);
        matches = srcFiles.filter((candidate) => candidate.startsWith(`${dir}/`));
      } else {
        const pattern = new RegExp(`(?:^|/)${basenamePattern.split("\0").map(escapeRegExp).join("[^/]*")}$`);
        matches = srcFiles.filter((candidate) => pattern.test(candidate));
      }
      for (const candidate of matches) {
        computedReferences.push({ file, line: tpl.line, template, target: candidate });
        mark(candidate, `computed file name \`${template}\` in ${file}:${tpl.line}`);
      }
    }
    for (const str of scan.strings) {
      const value = str.value.trim();
      if (!REFERENCE_RE.test(value)) continue;
      const resolved = resolveFile(root, file, value.startsWith(".") ? value : `./${value}`);
      if (resolved && srcSet.has(resolved)) {
        mark(resolved, `string "${value}" in ${file}:${str.line}`);
        continue;
      }
      if (resolved) continue;
      for (const candidate of byBasename.get(path.posix.basename(value)) || []) {
        if (!reachable.has(candidate)) nameMatchedReferences.push({ file, line: str.line, value, target: candidate });
        mark(candidate, `file name "${value}" in ${file}:${str.line}`);
      }
    }
  }

  const reachableSrc = srcFiles.filter((file) => reachable.has(file));
  const unreachableSrc = srcFiles.filter((file) => !reachable.has(file));
  const declared = Object.keys(pkg.dependencies || {}).sort();
  const used = declared.filter((name) => packageRequires.has(name));
  const unused = declared.filter((name) => !packageRequires.has(name));
  const undeclared = [...packageRequires.keys()].filter((name) => !declared.includes(name)).sort();
  // Everything reachable code requires, declared or not (an undeclared
  // package still has to be present at run time).
  const usedClosure = dependencyClosure(root, [...used, ...undeclared]).names;
  const unusedClosure = dependencyClosure(root, unused);
  const exclusivelyTransitive = [...unusedClosure.installed]
    .filter((name) => !usedClosure.has(name) && !declared.includes(name))
    .sort();

  return {
    root,
    entryPoints: [...entryPoints].sort(),
    reachableSrc,
    unreachableSrc,
    reachableFiles: [...reachable].sort(),
    reachedVia: Object.fromEntries([...via.entries()].filter(([file]) => file.startsWith("src/")).sort()),
    dynamicRequires,
    computedReferences,
    nameMatchedReferences,
    unresolved,
    dependencies: {
      declared,
      used,
      unused,
      exclusivelyTransitive,
      undeclared,
      requiredBy: Object.fromEntries([...packageRequires.entries()].sort().map(([name, refs]) => [name, refs.map((r) => `${r.file}:${r.line}`)])),
      usedClosure: [...usedClosure].sort(),
      nodeModulesPresent: fs.existsSync(path.join(root, "node_modules")),
    },
  };
}

// ── build.files excludes ──
//
// electron-builder evaluates build.files in order: a later `!pattern` removes
// what earlier patterns added. Only the two exclude shapes this repository
// uses are understood here; anything else is reported, never guessed at.
const NODE_MODULES_EXCLUDE_RE = /^!\*\*\/node_modules\/((?:@[^/{}]+\/)?[^/{}]+)\{,\/\*\*\/\*\}$/;

function classifyBuildExcludes(files) {
  const src = [];
  const dependencies = [];
  const other = [];
  for (const pattern of files || []) {
    if (typeof pattern !== "string" || !pattern.startsWith("!")) continue;
    const dep = NODE_MODULES_EXCLUDE_RE.exec(pattern);
    if (dep) dependencies.push({ pattern, name: dep[1] });
    else if (pattern.startsWith("!src/")) src.push({ pattern, glob: pattern.slice(1) });
    else other.push({ pattern, glob: pattern.slice(1) });
  }
  return { src, dependencies, other };
}

function staticGlobPrefix(glob) {
  const segments = [];
  for (const segment of glob.split("/")) {
    if (/[*?{}[\]!]/.test(segment)) break;
    segments.push(segment);
  }
  return segments.join("/");
}

// electron-builder semantics for build.files: patterns apply in order and the
// last one that matches a path decides (`!` removes, anything else adds).
function isPackagedByBuildFiles(file, files, matchGlob) {
  let included = false;
  for (const pattern of files || []) {
    if (typeof pattern !== "string") continue;
    if (pattern.startsWith("!")) {
      if (included && matchGlob(file, pattern.slice(1))) included = false;
    } else if (!included && matchGlob(file, pattern)) {
      included = true;
    }
  }
  return included;
}

// Base names the packaged app can still find somewhere else: every file
// build.files keeps plus everything copied through extraResources.
function packagedBasenames(root, build, matchGlob) {
  const names = new Set();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
    const files = entry.isDirectory() ? listFiles(root, entry.name) : entry.isFile() ? [entry.name] : [];
    for (const file of files) {
      if (isPackagedByBuildFiles(file, build.files, matchGlob)) names.add(path.posix.basename(file));
    }
  }
  for (const resource of build.extraResources || []) {
    const from = resource && typeof resource.from === "string" ? path.resolve(root, resource.from) : null;
    if (!from || !fs.existsSync(from)) continue;
    if (fs.statSync(from).isFile()) names.add(path.basename(from));
    else for (const file of listFiles(from, ".")) names.add(path.posix.basename(file));
  }
  return names;
}

// Non-code excludes (static assets such as pwa/**): prove that no reachable
// file names anything inside them. A string literal counts when it resolves
// into the excluded tree relative to its file or to the app root (the latter
// also catches the `path.join(__dirname, "..", "pwa")` shape), or when it ends
// in a file name that only the excluded tree has. Theme manifests are data the runtime
// reads, so their strings count too. What this cannot see is a directory the
// runtime enumerates (readdir) — asset excludes still need a human review.
function verifyAssetExcludes(report, build, excludes, matchGlob) {
  const problems = [];
  const root = report.root;
  if (!excludes.length) return problems;
  const sources = report.reachableFiles
    .filter((file) => /\.(?:c|m)?js$/.test(file))
    .map((file) => ({ file, strings: scanSource(fs.readFileSync(path.join(root, file), "utf8")).strings }));
  for (const file of listFiles(root, "themes").filter((f) => /\.json$/.test(f))) {
    const strings = [];
    (function collect(value) {
      if (typeof value === "string") strings.push({ value, line: 0 });
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    })(readJsonSafe(path.join(root, file)));
    sources.push({ file, strings });
  }
  const elsewhere = packagedBasenames(root, build, matchGlob);
  for (const { pattern, glob } of excludes) {
    const prefix = staticGlobPrefix(glob);
    if (!prefix) {
      problems.push(`${pattern} has no static directory prefix; the audit cannot prove it safe`);
      continue;
    }
    const excludedFiles = listFiles(root, prefix).filter((file) => matchGlob(file, glob));
    if (!excludedFiles.length) problems.push(`${pattern} matches no file`);
    const uniqueNames = new Set(excludedFiles.map((file) => path.posix.basename(file)).filter((name) => !elsewhere.has(name)));
    const prefixAbs = path.join(root, prefix);
    for (const { file, strings } of sources) {
      if (file === prefix || file.startsWith(`${prefix}/`)) continue; // excluded along with the tree
      for (const { value, line } of strings) {
        const text = value.trim();
        if (!text || text.length > 512) continue;
        let reason = null;
        for (const base of [path.join(root, path.dirname(file)), root]) {
          const resolved = path.resolve(base, text);
          if (resolved === prefixAbs || resolved.startsWith(prefixAbs + path.sep)) reason = "path";
        }
        if (!reason && uniqueNames.has(path.posix.basename(text))) reason = "file name";
        if (reason) problems.push(`${pattern} excludes "${text}", referenced by ${file}${line ? `:${line}` : ""} (${reason})`);
      }
    }
  }
  return problems;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// Returns human-readable problems; empty when every `!` pattern in
// build.files is provably safe for the runtime.
function verifyBuildExcludes(report, build, matchGlob) {
  const problems = [];
  const excludes = classifyBuildExcludes(build.files);
  const reachable = new Set(report.reachableSrc);
  const allSrc = [...report.reachableSrc, ...report.unreachableSrc];
  for (const { pattern, glob } of excludes.src) {
    const matched = allSrc.filter((file) => matchGlob(file, glob));
    if (!matched.length) problems.push(`${pattern} matches no src file`);
    for (const file of matched) {
      if (reachable.has(file)) problems.push(`${pattern} excludes ${file}, which is reachable (${report.reachedVia[file]})`);
    }
  }
  const removable = new Set([...report.dependencies.unused, ...report.dependencies.exclusivelyTransitive]);
  const usedClosure = new Set(report.dependencies.usedClosure);
  const requiredBy = report.dependencies.requiredBy;
  for (const { pattern, name } of excludes.dependencies) {
    if (requiredBy[name]) {
      problems.push(`${pattern} excludes ${name}, which reachable code requires (${requiredBy[name][0]})`);
    } else if (usedClosure.has(name)) {
      problems.push(`${pattern} excludes ${name}, which a shipped dependency needs`);
    } else if (!removable.has(name)) {
      problems.push(`${pattern} excludes ${name}, which is neither an unused dependency nor installed only for one`);
    }
  }
  if (excludes.dependencies.length && !report.dependencies.nodeModulesPresent) {
    problems.push("node_modules is missing, so dependency excludes cannot be checked (run npm ci)");
  }
  problems.push(...verifyAssetExcludes(report, build, excludes.other, matchGlob));
  return problems;
}

function formatReport(report) {
  const lines = [];
  lines.push(`Entry points: ${report.entryPoints.length}`);
  lines.push(`Reachable src files: ${report.reachableSrc.length}`);
  lines.push(`Unreachable src files (${report.unreachableSrc.length}):`);
  for (const file of report.unreachableSrc) lines.push(`  ${file}`);
  lines.push(`Non-literal requires (${report.dynamicRequires.length}; their directory trees count as reachable):`);
  for (const dyn of report.dynamicRequires) lines.push(`  ${dyn.file}:${dyn.line}  ${dyn.expression}`);
  if (report.computedReferences.length) {
    lines.push(`Reached through a computed file name (${report.computedReferences.length}):`);
    for (const ref of report.computedReferences) lines.push(`  ${ref.target}  <- \`${ref.template}\` ${ref.file}:${ref.line}`);
  }
  if (report.nameMatchedReferences.length) {
    lines.push(`Reached only through a bare file name (${report.nameMatchedReferences.length}):`);
    for (const ref of report.nameMatchedReferences) lines.push(`  ${ref.target}  <- "${ref.value}" ${ref.file}:${ref.line}`);
  }
  if (report.unresolved.length) {
    lines.push(`Unresolved relative requires (${report.unresolved.length}):`);
    for (const ref of report.unresolved) lines.push(`  ${ref.file}:${ref.line}  ${ref.specifier}`);
  }
  const deps = report.dependencies;
  lines.push(`Production dependencies used by reachable code: ${deps.used.join(", ") || "(none)"}`);
  lines.push(`Production dependencies NOT required by reachable code: ${deps.unused.join(", ") || "(none)"}`);
  lines.push(`Packages only those dependencies pull in: ${deps.exclusivelyTransitive.join(", ") || "(none)"}`);
  if (deps.undeclared.length) lines.push(`Required but not declared in dependencies: ${deps.undeclared.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const report = analyzeRuntimeReachability();
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatReport(report));
  if (argv.includes("--check")) {
    const { minimatch } = require("minimatch");
    const pkg = JSON.parse(fs.readFileSync(path.join(report.root, "package.json"), "utf8"));
    const problems = verifyBuildExcludes(report, pkg.build || {}, (file, glob) => minimatch(file, glob, { dot: true }));
    if (problems.length) {
      process.stderr.write(`build.files excludes are unsafe:\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
      return 1;
    }
    process.stdout.write("build.files excludes: ok\n");
  }
  return 0;
}

module.exports = {
  analyzeRuntimeReachability,
  classifyBuildExcludes,
  isPackagedByBuildFiles,
  staticGlobPrefix,
  formatReport,
  scanSource,
  tokenize,
  verifyBuildExcludes,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
