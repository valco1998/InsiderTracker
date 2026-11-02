// Insider Tracker — company-page transaction filters (pure; no React).
// Rows are compact economic rows from GET /api/insider/transactions; their
// `roleGroups` come from the server (server/services/edgar/insiderInsights.js
// rowRoleGroups), so role filtering uses the same rules as the 30-day statistics.

export const ROLE_OPTIONS = ["CEO", "CFO", "Director", "Officer", "10% Owner"];
export const PERIODS = [
  { key: "all", label: "All loaded" },
  { key: "7", label: "7D" },
  { key: "30", label: "30D" },
  { key: "90", label: "90D" },
  { key: "custom", label: "Custom" },
];
export const DEFAULT_COMPANY_FILTERS = { roles: [], name: "", type: "all", minValue: "", maxValue: "", period: "all", from: "", to: "" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Today's calendar date in New York (EDGAR's timezone), YYYY-MM-DD.
export function easternToday(nowMs = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Trade-date range of a filter, or null (no date limit). Inclusive.
export function periodRange(f, today = easternToday()) {
  if (["7", "30", "90"].includes(f.period)) return { from: addDays(today, -(Number(f.period) - 1)), to: today };
  if (f.period === "custom") {
    const from = DATE_RE.test(f.from) ? f.from : null;
    const to = DATE_RE.test(f.to) ? f.to : null;
    return from || to ? { from, to } : null;
  }
  return null;
}

const num = (s) => (s === "" || s == null || !Number.isFinite(Number(s)) ? null : Number(s));

// rows → rows matching every active filter (order preserved).
//   roles: a row matches if it has ANY selected role (multi-role insiders match each of their roles)
//   name:  case-insensitive match on the reporting insider(s), incl. related filers in reportedBy
//   value: reported value bounds; rows without a computable value are excluded once a bound is set
export function filterCompanyRows(rows, f, today = easternToday()) {
  const roles = new Set(f.roles || []);
  const name = String(f.name || "").trim().toLowerCase();
  const code = f.type === "purchase" ? "P" : f.type === "sale" ? "S" : null;
  const min = num(f.minValue), max = num(f.maxValue);
  const range = periodRange(f, today);
  return rows.filter((r) => {
    if (code && r.code !== code) return false;
    if (roles.size && !(r.roleGroups || []).some((g) => roles.has(g))) return false;
    if (name) {
      const names = [r.insiderName, ...(r.reportedBy || []).map((x) => x.insiderName)].filter(Boolean).join(" | ").toLowerCase();
      if (!names.includes(name)) return false;
    }
    if (min != null || max != null) {
      if (r.value == null || r.priceCheck?.status === "anomaly") return false;
      if (min != null && r.value < min) return false;
      if (max != null && r.value > max) return false;
    }
    if (range) {
      const d = r.transactionDate;
      if (!d) return false;
      if (range.from && d < range.from) return false;
      if (range.to && d > range.to) return false;
    }
    return true;
  });
}

export function activeFilterCount(f) {
  return (f.roles?.length ? 1 : 0) + (f.name?.trim() ? 1 : 0) + (f.type !== "all" ? 1 : 0)
    + (num(f.minValue) != null || num(f.maxValue) != null ? 1 : 0) + (f.period !== "all" ? 1 : 0);
}
