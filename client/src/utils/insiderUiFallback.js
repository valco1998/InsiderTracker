// Pure helpers for the InsiderTracker page-level error boundary and Suspense
// fallback. No React / DOM imports so they are testable with node:test.

// Literal mirrors of the insider.css tokens. Used as var() fallbacks when the
// fallback renders outside .it-root (or before insider.css has loaded).
const PALETTES = {
  light: {
    bg: "#F8FAFC", panel: "#FFFFFF", surface: "#F1F5F9", line: "#E2E8F0",
    text: "#0F172A", text2: "#475569", accent: "#2563EB", accentLine: "rgba(37, 99, 235, 0.25)",
    sell: "#DC2626", sellSoft: "rgba(220, 38, 38, 0.07)", sellLine: "rgba(220, 38, 38, 0.22)",
  },
  dark: {
    bg: "#0B1120", panel: "#111827", surface: "#172033", line: "#273449",
    text: "#F8FAFC", text2: "#CBD5E1", accent: "#60A5FA", accentLine: "rgba(96, 165, 250, 0.32)",
    sell: "#FB7185", sellSoft: "rgba(251, 113, 133, 0.11)", sellLine: "rgba(251, 113, 133, 0.30)",
  },
};

/** Normalise any theme value to "light" | "dark" (light is the insider default). */
export function normalizeTheme(theme) {
  return theme === "dark" ? "dark" : "light";
}

/** Theme palette for fallbacks. Unknown/missing theme → light. */
export function fallbackPalette(theme) {
  return PALETTES[normalizeTheme(theme)];
}

/** Read the active theme from <html data-theme>, safely (SSR / test → "light"). */
export function currentTheme() {
  try {
    return normalizeTheme(globalThis.document?.documentElement?.dataset?.theme);
  } catch {
    return "light";
  }
}

/** True when a boundary that is in the error state should clear because resetKey changed. */
export function shouldResetOnKeyChange(hasError, prevKey, nextKey) {
  return Boolean(hasError) && !Object.is(prevKey, nextKey);
}

/** True for routes owned by the InsiderTracker UI. */
export function isInsiderPath(pathname) {
  return typeof pathname === "string" && (pathname === "/insider" || pathname.startsWith("/insider/"));
}
