// deep4/panel/history.mjs — point-in-time insider / issuer / role track records (agent "panel").
//
//   import { createHistory } from "../panel/history.mjs";
//   import { loadPanel } from "../panel/data.mjs";
//   const H = createHistory(loadPanel({ agent: "behavior" }).rows);
//   H.historyAt(person, t, { horizon: 30 })                 // t = "YYYY-MM-DD HH:MM:SS" ET (decision time) or "YYYY-MM-DD"
//   H.historyForEvent(row, { horizon: 30 })                 // { person, issuer, role } as of row.decisionAt, excluding the event
//   H.issuerHistoryAt(cik, t, opts) / H.roleHistoryAt(primaryRole, t, opts) / H.poolPriorAt(t, opts)
//
// Rules (no leakage):
//   • "prior purchases" = rows with publishedAt < t (accepted before t; or < opts.priorBefore when given), minus
//     opts.excludeKey / opts.excludeDupKey; historyForEvent uses priorBefore = the event's own acceptance (= panel pPrior);
//   • an outcome is visible only if lib4.maturedBy(endDate, t): its end date (B_end{H} / A_end{H}, the exit session) is strictly
//     before date(t). An outcome ending ON date(t) or later is invisible (it is still "pending");
//   • outcomes with status != ok (embargo / censored / no bar) are never visible (counted as `unavailable`);
//   • the empirical-Bayes prior is estimated from the POOL of outcomes matured before date(t) (all persons / issuers), so it is
//     point in time too; pass opts.prior = { mu, sigma2, tau2 } to use a frozen prior (e.g. fitted on a training window).
// Statistics: values winsorized at the pool's 1st/99th percentiles (as of t) before averaging (fat tails); hit = touch of
// +10% within the horizon (B_hit10_{H}; outcome A has hits only for H = 30). One row per dupKey by default (dedupe).
import * as L4 from "../lib4.mjs";
import { loadPanel } from "./data.mjs";

const day = (s) => String(s).slice(0, 10);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const varS = (xs) => { if (xs.length < 2) return null; const m = mean(xs); return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1); };
const quant = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] : null);
const normT = (t) => { const s = String(t); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s} 00:00:00` : s.replace("T", " ").slice(0, 19); };

export const METRICS = {
  B: { xsNet: (H) => `B_xsNet${H}`, xs: (H) => `B_xs${H}`, net: (H) => `B_net${H}`, xsNet2x: (H) => `B_xsNet2x${H}`, gross: (H) => `B_gross${H}` },
  A: { xs: (H) => `A_xs${H}`, ret: (H) => `A_ret${H}` },
};
const endField = (outcome, H) => `${outcome}_end${H}`;
const hitField = (outcome, H) => (outcome === "B" ? `B_hit10_${H}` : H === 30 ? "A_hit10_30" : null);
const DEFAULTS = { horizon: 30, outcome: "B", metric: "xsNet", dedupe: true, filter: null, prior: "pit", minPool: 30, detail: false };

export function createHistory(rows, baseOpts = {}) {
  const all = [...rows].sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : a.key < b.key ? -1 : 1));
  const byPerson = new Map(), byIssuer = new Map(), byRole = new Map();
  for (const r of all) {
    (byPerson.get(r.person) || byPerson.set(r.person, []).get(r.person)).push(r);
    (byIssuer.get(r.cik) || byIssuer.set(r.cik, []).get(r.cik)).push(r);
    (byRole.get(r.primaryRole) || byRole.set(r.primaryRole, []).get(r.primaryRole)).push(r);
  }
  const O = (o) => ({ ...DEFAULTS, ...baseOpts, ...o });
  const metricField = (o) => { const m = METRICS[o.outcome]?.[o.metric]; if (!m) throw new Error(`history: unknown metric ${o.outcome}.${o.metric}`); return m(o.horizon); };
  const keep = (r, o) => (!o.dedupe || r.isPrimary === 1 || r.isPrimary === true) && (!o.filter || o.filter(r));
  // visible outcome value of row r at decision time t (null when not matured / unavailable)
  function visibleValue(r, t, o) {
    const end = r[endField(o.outcome, o.horizon)], v = r[metricField(o)];
    if (!L4.maturedBy(end, t)) return { state: "pending" };
    if (v == null || !Number.isFinite(v)) return { state: "unavailable" };
    const hf = hitField(o.outcome, o.horizon);
    return { state: "ok", v, hit: hf ? r[hf] : null, end };
  }
  // ---- point-in-time pool prior (cached per date(t) and option set) ----
  const priorMemo = new Map();
  function poolPriorAt(t, opts = {}) {
    const o = O(opts); t = normT(t);
    const memoKey = `${day(t)}|${o.outcome}|${o.metric}|${o.horizon}|${o.dedupe}|${o.filter ? "f" : ""}|${o.groupBy || "person"}`;
    if (!o.filter && priorMemo.has(memoKey)) return priorMemo.get(memoKey);
    const groupKey = o.groupBy === "issuer" ? (r) => r.cik : (r) => r.person;
    const vals = [], groups = new Map();
    for (const r of all) {
      if (r.publishedAt >= t) break; // rows are sorted; later rows can not have matured before t (end >= publish date)
      if (!keep(r, o)) continue;
      const vv = visibleValue(r, t, o); if (vv.state !== "ok") continue;
      vals.push(vv.v);
      const g = groupKey(r); (groups.get(g) || groups.set(g, []).get(g)).push(vv.v);
    }
    const sorted = [...vals].sort((a, b) => a - b);
    const lo = quant(sorted, 0.01), hi = quant(sorted, 0.99);
    const w = (x) => Math.min(hi, Math.max(lo, x));
    let res;
    if (vals.length < o.minPool) res = { n: vals.length, groups: groups.size, mu: null, sigma2: null, tau2: null, lo, hi, ok: false };
    else {
      const wv = vals.map(w), mu = mean(wv);
      const within = [], gm = [], gn = [];
      for (const xs of groups.values()) { const ws = xs.map(w); gm.push(mean(ws)); gn.push(ws.length); if (ws.length >= 2) within.push(varS(ws)); }
      const sigma2 = within.length >= 10 ? mean(within) : varS(wv);
      const between = varS(gm) ?? 0;
      const tau2 = Math.max(between - mean(gn.map((n) => sigma2 / n)), 1e-6);
      res = { n: vals.length, groups: groups.size, mu, sigma2, tau2, k: sigma2 / tau2, lo, hi, ok: true };
    }
    if (!o.filter) priorMemo.set(memoKey, res);
    return res;
  }
  // ---- summary of a list of candidate history rows at t ----
  function summarize(list, t, o, priorObj) {
    // o.priorBefore (optional, <= t): acceptance cutoff for the "prior purchases" set; maturity is always judged at date(t)
    const pb = o.priorBefore ? normT(o.priorBefore) : t;
    if (pb > t) throw new Error("history: priorBefore must not be after t");
    const prior = list.filter((r) => r.publishedAt < pb && r.key !== o.excludeKey && (!o.excludeDupKey || r.dupKey !== o.excludeDupKey));
    const kept = prior.filter((r) => keep(r, o));
    const vals = [], hits = [], items = []; let pending = 0, unavailable = 0;
    for (const r of kept) {
      const vv = visibleValue(r, t, o);
      if (vv.state === "pending") { pending++; continue; }
      if (vv.state === "unavailable") { unavailable++; continue; }
      vals.push(vv.v); if (vv.hit != null) hits.push(vv.hit);
      if (o.detail) items.push({ key: r.key, publishedAt: r.publishedAt, end: vv.end, value: vv.v, hit: vv.hit });
    }
    const P = priorObj && priorObj.mu != null ? priorObj : null;
    const w = P && P.lo != null ? (x) => Math.min(P.hi, Math.max(P.lo, x)) : (x) => x;
    const wv = vals.map(w), m = mean(wv), n = wv.length;
    let eb = null;
    if (P) { const k = P.sigma2 / P.tau2, weight = n / (n + k); eb = { estimate: n ? P.mu + (m - P.mu) * weight : P.mu, weight, k, mu: P.mu, sigma2: P.sigma2, tau2: P.tau2, poolN: P.n ?? null }; }
    return {
      prior: { n: prior.length, nKept: kept.length, issuers: new Set(prior.map((r) => r.cik)).size, firstAt: prior[0]?.publishedAt ?? null, lastAt: prior.at(-1)?.publishedAt ?? null },
      matured: { n, mean: m, meanRaw: mean(vals), median: median(vals), winRate: n ? vals.filter((x) => x > 0).length / n : null, hit10: hits.length ? mean(hits) : null, nHit: hits.length, pending, unavailable, ...(o.detail ? { items } : {}) },
      eb,
    };
  }
  const priorFor = (t, o, groupBy) => (o.prior && typeof o.prior === "object" ? o.prior : o.prior === "pit" ? poolPriorAt(t, { ...o, groupBy }) : null);
  function historyAt(person, t, opts = {}) {
    const o = O(opts); t = normT(t);
    return { person, t, horizon: o.horizon, outcome: o.outcome, metric: o.metric, ...summarize(byPerson.get(person) || [], t, o, priorFor(t, o, "person")) };
  }
  function issuerHistoryAt(cik, t, opts = {}) {
    const o = O(opts); t = normT(t);
    return { cik, t, horizon: o.horizon, outcome: o.outcome, metric: o.metric, ...summarize(byIssuer.get(cik) || [], t, o, priorFor(t, o, "issuer")) };
  }
  function roleHistoryAt(role, t, opts = {}) {
    const o = O(opts); t = normT(t);
    const s = summarize(byRole.get(role) || [], t, o, null);
    return { role, t, horizon: o.horizon, outcome: o.outcome, metric: o.metric, ...s };
  }
  // Everything known about an event's buyer, issuer and role at its decision time (the event itself and its dupKey excluded).
  // "Prior" = accepted strictly before the event's own acceptance (same as the panel's pPrior); maturity judged at decisionAt.
  function historyForEvent(row, opts = {}) {
    const o = { ...opts, excludeKey: row.key, excludeDupKey: row.dupKey, priorBefore: row.publishedAt };
    return { person: historyAt(row.person, row.decisionAt, o), issuer: issuerHistoryAt(row.cik, row.decisionAt, o), role: roleHistoryAt(row.primaryRole, row.decisionAt, o) };
  }
  return { historyAt, issuerHistoryAt, roleHistoryAt, historyForEvent, poolPriorAt, rows: all };
}

// Convenience: design-segment panel (no guard needed for design rows).
let _default = null;
export function historyAt(person, t, opts = {}) {
  if (!_default) _default = createHistory(loadPanel({ agent: "panel", segments: ["design"] }).rows);
  return _default.historyAt(person, t, opts);
}
