// Insider Tracker — Companies screener filters (pure; no React).
// Maps the UI filter state to GET /api/insider/companies query parameters and
// back. All counting happens server-side (server/services/edgar/companyScreener.js).

export const BUYER_OPTIONS = [1, 2, 3, 5, 10];
export const VALUE_OPTIONS = [
  { key: "any", label: "Any value", min: null },
  { key: "10k", label: "$10K+", min: 10_000 },
  { key: "50k", label: "$50K+", min: 50_000 },
  { key: "100k", label: "$100K+", min: 100_000 },
  { key: "500k", label: "$500K+", min: 500_000 },
  { key: "1m", label: "$1M+", min: 1_000_000 },
  { key: "5m", label: "$5M+", min: 5_000_000 },
  { key: "10m", label: "$10M+", min: 10_000_000 },
  { key: "custom", label: "Custom", min: null },
];
export const PERIOD_OPTIONS = [
  { key: "1d", label: "24H" },
  { key: "7d", label: "7D" },
  { key: "14d", label: "14D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "custom", label: "Custom" },
];
export const BASIS_OPTIONS = [
  { key: "transactionDate", label: "Trade date", hint: "when insiders bought" },
  { key: "filingDate", label: "SEC filing date", hint: "when the purchase was publicly reported" },
];
export const SORT_OPTIONS = [
  { key: "buyers", label: "Most unique buyers" },
  { key: "value", label: "Highest purchase value" },
  { key: "recent", label: "Most recent purchase" },
  { key: "transactions", label: "Most purchase transactions" },
];

export const DEFAULT_SCREENER_FILTERS = {
  minBuyers: 1, customBuyers: "",
  value: "any", minValue: "", maxValue: "",
  period: "30d", from: "", to: "",
  basis: "transactionDate",
  openMarket: false, clusterOnly: false,
  q: "",
  sort: "buyers", dir: "desc",
  showSales: false,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const digits = (s) => String(s ?? "").replace(/[^0-9.]/g, "");
const has = (list, k) => list.some((o) => o.key === k);

// Sanitize a stored / foreign object into a valid filter state.
export function normalizeScreenerFilters(v) {
  const d = DEFAULT_SCREENER_FILTERS;
  if (!v || typeof v !== "object") return { ...d };
  const minBuyers = v.minBuyers === "custom" || BUYER_OPTIONS.includes(v.minBuyers) ? v.minBuyers : d.minBuyers;
  return {
    minBuyers,
    customBuyers: String(v.customBuyers ?? "").replace(/\D/g, "").slice(0, 4),
    value: has(VALUE_OPTIONS, v.value) ? v.value : d.value,
    minValue: digits(v.minValue).slice(0, 14),
    maxValue: digits(v.maxValue).slice(0, 14),
    period: has(PERIOD_OPTIONS, v.period) ? v.period : d.period,
    from: DATE_RE.test(v.from || "") ? v.from : "",
    to: DATE_RE.test(v.to || "") ? v.to : "",
    basis: has(BASIS_OPTIONS, v.basis) ? v.basis : d.basis,
    openMarket: !!v.openMarket,
    clusterOnly: !!v.clusterOnly,
    q: String(v.q ?? "").slice(0, 80),
    sort: has(SORT_OPTIONS, v.sort) ? v.sort : d.sort,
    dir: v.dir === "asc" ? "asc" : "desc",
    showSales: !!v.showSales,
  };
}

// Effective minimum unique buyers (custom input falls back to 1 while empty/invalid).
export function effectiveMinBuyers(f) {
  if (f.minBuyers !== "custom") return f.minBuyers;
  const n = parseInt(f.customBuyers, 10);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 1000) : 1;
}

// Effective [min, max] purchase value (null = unbounded).
export function valueBounds(f) {
  if (f.value === "custom") {
    const lo = f.minValue === "" ? null : Number(f.minValue);
    const hi = f.maxValue === "" ? null : Number(f.maxValue);
    return [Number.isFinite(lo) ? lo : null, Number.isFinite(hi) ? hi : null];
  }
  return [VALUE_OPTIONS.find((o) => o.key === f.value)?.min ?? null, null];
}

// → { params } for the API, or { error } for an incomplete custom input.
export function screenerQuery(f, { limit = 100 } = {}) {
  const p = { basis: f.basis, sort: f.sort, dir: f.dir, limit };
  if (f.period === "custom") {
    if (!f.from) return { error: "Choose a start date for the custom range." };
    if (f.to && f.from > f.to) return { error: "The start date must be on or before the end date." };
    p.from = f.from;
    if (f.to) p.to = f.to;
  } else {
    p.period = f.period;
  }
  const mb = effectiveMinBuyers(f);
  if (mb > 1) p.minBuyers = mb;
  const [lo, hi] = valueBounds(f);
  if (lo != null && hi != null && lo > hi) return { error: "Minimum value must not exceed the maximum value." };
  if (lo != null) p.minValue = lo;
  if (hi != null) p.maxValue = hi;
  if (f.openMarket) p.openMarket = 1;
  if (f.clusterOnly) p.cluster = 1;
  if (f.q.trim()) p.q = f.q.trim();
  return { params: p };
}

// Number of filters that narrow the result (not sort / display options).
export function activeScreenerFilters(f) {
  const [lo, hi] = valueBounds(f);
  return [effectiveMinBuyers(f) > 1, lo != null || hi != null, f.openMarket, f.clusterOnly, !!f.q.trim()].filter(Boolean).length;
}

const compactMoney = (n) => (n >= 1e9 ? `$${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${+(n / 1e3).toFixed(1)}K` : `$${n}`);

// Plain-English description of the screen, e.g.
// "Companies with at least 3 different insiders who purchased a combined $1M or more · last 30 days by trade date".
export function describeScreen(f) {
  const mb = effectiveMinBuyers(f);
  const [lo, hi] = valueBounds(f);
  const who = mb > 1 ? `at least ${mb} different insiders who purchased` : "at least 1 insider purchase";
  const amount = lo != null && hi != null ? ` between ${compactMoney(lo)} and ${compactMoney(hi)} combined`
    : lo != null ? ` a combined ${compactMoney(lo)} or more` : hi != null ? ` up to ${compactMoney(hi)} combined` : "";
  const per = f.period === "custom" ? `${f.from || "…"} – ${f.to || "today"}` : `last ${PERIOD_OPTIONS.find((o) => o.key === f.period)?.label.replace("D", " days").replace("24H", "24 hours")}`;
  const basis = f.basis === "filingDate" ? "by SEC filing date" : "by trade date";
  const extra = [f.openMarket && "open-market purchases only", f.clusterOnly && "cluster buying only"].filter(Boolean);
  return `Companies with ${who}${mb > 1 ? amount : amount ? ` totalling${amount.replace(" a combined", "")}` : ""} · ${per} ${basis}${extra.length ? ` · ${extra.join(" · ")}` : ""}`;
}
