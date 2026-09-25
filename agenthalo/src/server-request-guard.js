"use strict";

// ── Local hook server request guard ──
//
// The hook server binds 127.0.0.1, but a loopback bind does not keep browsers
// out. Any web page can send a "simple" cross-origin POST (text/plain, no CORS
// preflight) to 127.0.0.1 and fake task cards, permission bubbles or denials,
// and a DNS-rebinding page can read the GET routes once its own hostname
// resolves to 127.0.0.1. Native hooks look nothing like either: they address
// the literal loopback authority, send JSON, and never send Origin. A page can
// only match that with a preflighted request, which this server never answers.
// The one browser client is the web bridge extension, whose service worker
// sends Origin: chrome-extension://<id>.
//
// This is not authentication: any process of the same user can still reach the
// server. Remote SSH ingress traffic is authenticated by its routing nonce and
// carries the tunnel's remote Host, so only the local main server applies this.

const LOOPBACK_HOST_RE = /^(?:127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/i;
// Chrome, Edge and other Chromium browsers derive every extension ID, packed or
// unpacked, as 32 characters from a-p.
const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;
const JSON_MEDIA_TYPE = "application/json";

function isAllowedHost(host, port) {
  if (typeof host !== "string") return false;
  const match = LOOPBACK_HOST_RE.exec(host);
  return !!match && Number.isInteger(port) && Number(match[1]) === port;
}

function isAllowedOrigin(headers) {
  if (!Object.prototype.hasOwnProperty.call(headers, "origin")) return true;
  return typeof headers.origin === "string" && EXTENSION_ORIGIN_RE.test(headers.origin);
}

function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  return value.split(";", 1)[0].trim().toLowerCase() === JSON_MEDIA_TYPE;
}

// Node keeps only the first Host / Content-Type when a request repeats them.
// Reject the ambiguity instead of validating whichever copy Node retained.
function findDuplicateHeader(rawHeaders) {
  if (!Array.isArray(rawHeaders)) return null;
  const seen = new Set();
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = String(rawHeaders[i] || "").toLowerCase();
    if (name !== "host" && name !== "content-type") continue;
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}

// Returns null for an acceptable request, otherwise the { status, reason } to
// reject it with before any route reads the body.
function inspectLocalRequest(req, { port } = {}) {
  const headers = req && req.headers && typeof req.headers === "object" ? req.headers : {};
  const duplicate = findDuplicateHeader(req && req.rawHeaders);
  if (duplicate) return { status: 400, reason: `duplicate-${duplicate}` };
  if (!isAllowedOrigin(headers)) return { status: 403, reason: "origin" };
  if (!isAllowedHost(headers.host, port)) return { status: 403, reason: "host" };
  if (req.method === "POST" && !isJsonContentType(headers["content-type"])) {
    return { status: 415, reason: "content-type" };
  }
  return null;
}

module.exports = {
  inspectLocalRequest,
  __test: { isAllowedHost, isAllowedOrigin, isJsonContentType, findDuplicateHeader },
};
