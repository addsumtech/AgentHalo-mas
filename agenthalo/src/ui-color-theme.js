"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgentHaloColorThemes = api;
})(globalThis, function () {
  // text/textDim carry each theme's own hue. A single hardcoded zinc-900 across
  // all five made every theme read as the same grey app with a different accent,
  // and on the warm backgrounds a blue-black label looks harder than it is.
  // These sit a few steps above pure near-black so a settings label stops
  // shouting at the description under it.
  const THEMES = Object.freeze([
    { id: "classic", key: "uiColorClassic", accent: "#d97757", textAccent: "#af5438", hover: "#c4684a", dark: "#e99b7c", bg: "#f5f5f7", sidebar: "#ececef", selected: "#ffffff", selectedText: "#0a0a0c", darkBg: "#1c1c1f", darkPanel: "#232327", darkSidebar: "#18181b", text: "#2a2725", textDim: "#6e6862", darkText: "#f5f2ef", darkTextDim: "#a8a19b" },
    { id: "moss", key: "uiColorMoss", accent: "#307e76", textAccent: "#286c65", hover: "#266a63", dark: "#79bfb2", bg: "#f6f5f1", sidebar: "#eeede7", selected: "#dfeee8", selectedText: "#215e57", darkBg: "#1b211f", darkPanel: "#242c28", darkSidebar: "#171d1a", text: "#232926", textDim: "#666f6b", darkText: "#eff3f1", darkTextDim: "#9fada8" },
    { id: "ocean", key: "uiColorOcean", accent: "#356da9", hover: "#295888", dark: "#86b7ec", bg: "#f3f6fa", sidebar: "#e8eef5", selected: "#dce9f8", selectedText: "#245487", darkBg: "#1a2029", darkPanel: "#232c38", darkSidebar: "#161c25", text: "#1f2630", textDim: "#626b76", darkText: "#eef2f7", darkTextDim: "#9aa5b2" },
    { id: "lavender", key: "uiColorLavender", accent: "#8060ad", hover: "#694c93", dark: "#bca0e6", bg: "#f7f4fa", sidebar: "#eee8f4", selected: "#e9dff5", selectedText: "#654389", darkBg: "#211d28", darkPanel: "#2c2635", darkSidebar: "#1b1822", text: "#272231", textDim: "#6a6474", darkText: "#f2eff6", darkTextDim: "#a59eb0" },
    { id: "rose", key: "uiColorRose", accent: "#a65270", hover: "#984b66", dark: "#e6a0b8", bg: "#faf4f6", sidebar: "#f3e7ec", selected: "#f5dfe8", selectedText: "#914260", darkBg: "#281e23", darkPanel: "#33272e", darkSidebar: "#21191e", text: "#2d2429", textDim: "#71666b", darkText: "#f7eff2", darkTextDim: "#b0a0a7" },
  ].map(Object.freeze));
  const DEFAULT_THEME = "moss";
  const isTheme = (id) => THEMES.some((theme) => theme.id === id);
  const getTheme = (id) => THEMES.find((theme) => theme.id === id) || THEMES.find((theme) => theme.id === DEFAULT_THEME);

  function variables(id, dark = false) {
    const p = getTheme(id);
    const bg = dark ? p.darkBg : p.bg;
    const panel = dark ? p.darkPanel : "#ffffff";
    const sidebar = dark ? p.darkSidebar : p.sidebar;
    const accent = dark ? p.dark : p.accent;
    return {
      "bg": bg, "panel-bg": panel, "surface": panel,
      "sidebar-bg": sidebar, "surface-alt": sidebar,
      "sidebar-active": dark ? p.darkPanel : p.selected,
      "sidebar-active-text": dark ? p.dark : p.selectedText,
      "accent": accent, "accent-hover": dark ? `color-mix(in srgb, ${p.dark} 86%, white)` : p.hover,
      "accent-contrast": dark || p.id === "classic" ? "#18181b" : "#ffffff",
      "accent-text": dark ? p.dark : (p.textAccent || p.accent),
      "switch-on": accent,
      "text": dark ? p.darkText : p.text,
      "text-primary": dark ? p.darkText : p.text,
      "text-secondary": dark ? p.darkTextDim : p.textDim,
      "muted": dark ? p.darkTextDim : p.textDim,
      "text-muted": dark ? p.darkTextDim : p.textDim,
      "hud-bg": `color-mix(in srgb, ${bg} 94%, transparent)`,
      "toast-text": p.bg,
    };
  }

  function css(id) {
    const rule = (dark) => `:root {${Object.entries(variables(id, dark)).map(([key, value]) => `--${key}: ${value} !important;`).join("")}}`;
    return `${rule(false)}\n@media (prefers-color-scheme: dark) {${rule(true)}}`;
  }
  return { THEMES, DEFAULT_THEME, isTheme, getTheme, variables, css };
});
