// InsiderTracker light / dark theme.
// • The theme lives on <html data-theme="light|dark">; every colour is a CSS token in
//   insider.css (light tokens by default, dark tokens under [data-theme="dark"]).
// • index.html sets the attribute BEFORE the first paint (no flash) from localStorage,
//   defaulting to light for first-time visitors.
// • useTheme() re-renders subscribers (e.g. charts) when the theme changes.
import { useSyncExternalStore } from "react";

export const THEME_KEY = "it.theme";
const META = { light: "#F8FAFC", dark: "#0B1120" };
const listeners = new Set();

export function getTheme() {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  const root = document.documentElement;
  // Short, subtle colour transition on switch only (never on load; off for reduced motion).
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!reduce) { root.classList.add("it-theme-switching"); setTimeout(() => root.classList.remove("it-theme-switching"), 260); }
  root.dataset.theme = t;
  root.style.colorScheme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META[t]);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage unavailable — theme still applies for this visit */ }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light");
  return [theme, setTheme];
}
