"use strict";

(function (root) {
  // Theme-authored display text is either a plain string or a map keyed by
  // language. Both the main process and the Settings renderer read the same
  // fields, so the fallback order lives here instead of being reimplemented
  // on each side: exact language, then English, then Chinese, then whatever
  // the author did provide. A theme that names only one language still shows
  // that name rather than falling through to its raw id.
  function localizeField(value, lang) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value !== "object") return "";
    if (lang && value[lang]) return value[lang];
    if (value.en) return value.en;
    if (value.zh) return value.zh;
    for (const key of Object.keys(value)) {
      if (value[key]) return value[key];
    }
    return "";
  }

  if (typeof module === "object" && module.exports) module.exports = { localizeField };
  else root.AgentHaloLocalizedField = { localizeField };
})(typeof globalThis !== "undefined" ? globalThis : this);
