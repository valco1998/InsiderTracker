// Insider Tracker — which /insider routes consume the shared analytics dataset
// (pure; no React). The dataset pages up to 5,000 transactions (~5 MB raw), so
// InsiderContext loads it only where it is shown: Overview (KPI "Companies ·
// insiders", Activity chart, top companies), Transactions (KPI strip) and
// Analytics (all charts). Companies, company/owner pages, backtesting and
// sign-in never read `analytics` from the context.
const ANALYTICS_PATHS = new Set(["/insider", "/insider/transactions", "/insider/analytics"]);

export function needsInsiderAnalytics(pathname) {
  if (typeof pathname !== "string") return false;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return ANALYTICS_PATHS.has(p.toLowerCase());
}
