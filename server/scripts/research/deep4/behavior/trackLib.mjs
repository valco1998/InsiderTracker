// deep4/behavior/trackLib.mjs — point-in-time track records for family C, computed ONLY with panel/history.mjs.
// For each event e (decision time t = e.decisionAt): person / issuer / role records over open-market valued purchases
// (history dedupe = isPrimary), excluding e and its dupKey, "prior" = accepted before e.publishedAt, outcome visible only if
// its window ended before date(t) (lib4.maturedBy). Pool EB priors are computed by history.poolPriorAt at the decision DAY
// (identical to history's "pit" prior; memoised per day because the filter option disables history's own memo).
import { createHistory } from "../panel/history.mjs";
import { C_FILTER } from "./defs.mjs";

export const CONFIGS = {
  pB30: { level: "person", outcome: "B", metric: "xsNet", horizon: 30 },
  pB5: { level: "person", outcome: "B", metric: "xsNet", horizon: 5 },
  pA30: { level: "person", outcome: "A", metric: "xs", horizon: 30 },
  iB30: { level: "issuer", outcome: "B", metric: "xsNet", horizon: 30 },
  iB5: { level: "issuer", outcome: "B", metric: "xsNet", horizon: 5 },
  rB30: { level: "role", outcome: "B", metric: "xsNet", horizon: 30 },
};
const day = (s) => String(s).slice(0, 10);

// records for events: Map(key → { cfgName: { n, est, mean, pending } }); cfgNames default all.
export function computeRecords(H, events, { cfgNames = Object.keys(CONFIGS), extraFilter = null, priorOverride = null } = {}) {
  const priorMemo = new Map();
  const priorOf = (cfg, name, d) => {
    if (priorOverride && priorOverride[name]) return priorOverride[name];
    const k = `${name}|${d}`;
    if (!priorMemo.has(k)) priorMemo.set(k, H.poolPriorAt(`${d} 00:00:00`, { outcome: cfg.outcome, metric: cfg.metric, horizon: cfg.horizon, filter: C_FILTER, groupBy: cfg.level === "issuer" ? "issuer" : "person" }));
    return priorMemo.get(k);
  };
  // role records: matured items depend only on (role, decision day) — an item published on date(t) cannot have matured by t,
  // and the event / its dupKey are never matured at their own decision time — so the role summary is memoised per day
  // (history.roleHistoryAt called at the day start; matured n / mean identical; only `pending` counts may differ).
  const roleMemo = new Map();
  const out = new Map();
  for (const e of events) {
    const rec = {};
    const t = e.decisionAt, d = day(t);
    for (const name of cfgNames) {
      const cfg = CONFIGS[name];
      const filter = extraFilter ? (r) => C_FILTER(r) && extraFilter(r, e) : C_FILTER;
      const base = { outcome: cfg.outcome, metric: cfg.metric, horizon: cfg.horizon, filter, excludeKey: e.key, excludeDupKey: e.dupKey, priorBefore: e.publishedAt };
      let h;
      if (cfg.level === "person") h = H.historyAt(e.person, t, { ...base, prior: priorOf(cfg, name, d) });
      else if (cfg.level === "issuer") h = H.issuerHistoryAt(e.cik, t, { ...base, prior: priorOf(cfg, name, d) });
      else if (!extraFilter) { const k = `${name}|${e.primaryRole}|${d}`; if (!roleMemo.has(k)) roleMemo.set(k, H.roleHistoryAt(e.primaryRole, `${d} 00:00:00`, { outcome: cfg.outcome, metric: cfg.metric, horizon: cfg.horizon, filter: C_FILTER, prior: null })); h = roleMemo.get(k); }
      else h = H.roleHistoryAt(e.primaryRole, t, { ...base, prior: null });
      const est = cfg.level === "role" ? h.matured.mean : h.eb ? h.eb.estimate : null;
      rec[name] = { n: h.matured.n, est, mean: h.matured.mean, pending: h.matured.pending, weight: h.eb ? h.eb.weight : null };
    }
    out.set(e.key, rec);
  }
  return out;
}
export { createHistory };

// Joint within-stratum permutation of outcome fields across rows (strata = decision month x availability pattern).
// Only rows with isPrimary = 1 AND C_FILTER (the rows history actually uses) are permuted; identity / date fields stay.
export const PERM_FIELDS = ["B_xsNet5", "B_xsNet30", "B_hit10_5", "B_hit10_30", "A_xs30", "A_hit10_30"];
export function permuteRows(rows, rnd) {
  const out = rows.map((r) => ({ ...r }));
  const strata = new Map();
  out.forEach((r, i) => {
    if (!(r.isPrimary === 1 && C_FILTER(r))) return;
    const pat = ["B_xsNet5", "B_xsNet30", "A_xs30"].map((f) => (typeof r[f] === "number" && Number.isFinite(r[f]) ? 1 : 0)).join("");
    if (pat === "000") return;
    const k = `${r.month}|${pat}`; (strata.get(k) || strata.set(k, []).get(k)).push(i);
  });
  for (const idx of strata.values()) {
    const vals = idx.map((i) => PERM_FIELDS.map((f) => out[i][f]));
    for (let a = vals.length - 1; a > 0; a--) { const b = Math.floor(rnd() * (a + 1)); [vals[a], vals[b]] = [vals[b], vals[a]]; }
    idx.forEach((i, k) => PERM_FIELDS.forEach((f, j) => { out[i][f] = vals[k][j]; }));
  }
  return out;
}
