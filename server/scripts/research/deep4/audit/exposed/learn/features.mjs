// deep4/learn/features.mjs — the pre-declared feature list (spec.json copies FEATURES verbatim) and point-in-time transforms.
// Every input is a panel feature field (meta.featureFields) known at decision time t, or a history.mjs track-record value
// computed at t (outcomes visible only if lib4.maturedBy(end, t)). gapEntry is NEVER a model feature (known only at the open).
import { createHistory } from "../panel/history.mjs";

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const clip = (x, lo, hi) => (x == null ? null : Math.min(hi, Math.max(lo, x)));
const log1pClip = (x, hi) => (x == null ? null : Math.log1p(Math.min(hi, Math.max(0, x))));
const flag = (x) => (x === 1 || x === true ? 1 : 0);

// group: P purchase, H person history, C cluster/issuer activity, TR track record (history.mjs), T technical, R regime.
// T and R exist for matched controls (identical definitions); P, H, C, TR exist only for insider events.
export const FEATURES = [
  // ---- purchase (P) ----
  { name: "lusd", group: "P", def: "log10(usd)", f: (r) => (num(r.usd) > 0 ? Math.log10(r.usd) : null) },
  { name: "lpct", group: "P", def: "log1p(min(pctHold,10)); new position (firstPosition=1) -> log1p(10); else null (imputed)", f: (r) => (r.firstPosition === 1 ? Math.log1p(10) : log1pClip(num(r.pctHold), 10)) },
  { name: "firstPos", group: "P", def: "firstPosition == 1", f: (r) => flag(r.firstPosition) },
  { name: "ceoCfo", group: "P", def: "isCEO or isCFO", f: (r) => (flag(r.isCEO) || flag(r.isCFO) ? 1 : 0) },
  { name: "otherOfficer", group: "P", def: "isOfficer and not CEO/CFO", f: (r) => (flag(r.isOfficer) && !flag(r.isCEO) && !flag(r.isCFO) ? 1 : 0) },
  { name: "directorOnly", group: "P", def: "isDirector and not isOfficer", f: (r) => (flag(r.isDirector) && !flag(r.isOfficer) ? 1 : 0) },
  { name: "tenPct", group: "P", def: "isTenPct", f: (r) => flag(r.isTenPct) },
  { name: "direct", group: "P", def: "ownD (any direct row)", f: (r) => flag(r.ownD) },
  { name: "plan", group: "P", def: "plan10b5", f: (r) => flag(r.plan10b5) },
  { name: "llag", group: "P", def: "log1p(clip(lagDays,0,365))", f: (r) => log1pClip(num(r.lagDays), 365) },
  { name: "pubRegular", group: "P", def: "window == regular_session", f: (r) => (r.window === "regular_session" ? 1 : 0) },
  { name: "pubPremarket", group: "P", def: "window == premarket_04_0930", f: (r) => (r.window === "premarket_04_0930" ? 1 : 0) },
  { name: "retTd", group: "P", def: "clip(retTdToDec,-0.5,0.5) (trade date -> decision close, public at t); null -> 0", f: (r) => clip(num(r.retTdToDec) ?? 0, -0.5, 0.5) },
  // ---- person history (H) ----
  { name: "lpPriorOm", group: "H", def: "log1p(pPriorOm)", f: (r) => Math.log1p(num(r.pPriorOm) ?? 0) },
  { name: "repeatCo", group: "H", def: "pPriorCo > 0", f: (r) => ((num(r.pPriorCo) ?? 0) > 0 ? 1 : 0) },
  { name: "lpComp", group: "H", def: "log(pCompanies)", f: (r) => Math.log(Math.max(1, num(r.pCompanies) ?? 1)) },
  { name: "avgDownF", group: "H", def: "avgDown == 1 (bought below own previous price at this issuer)", f: (r) => flag(r.avgDown) },
  { name: "lUsdRatio", group: "H", def: "log(clip(pUsdRatioMed,0.01,100)); no earlier valued purchase -> 0", f: (r) => (num(r.pUsdRatioMed) > 0 ? Math.log(clip(r.pUsdRatioMed, 0.01, 100)) : 0) },
  // ---- cluster / issuer activity (C) ----
  { name: "lOthers30", group: "C", def: "log1p(oBuyers30Om)", f: (r) => Math.log1p(num(r.oBuyers30Om) ?? 0) },
  { name: "lIBuysPrior", group: "C", def: "log1p(iBuysPrior)", f: (r) => Math.log1p(num(r.iBuysPrior) ?? 0) },
  { name: "lSellers30np", group: "C", def: "log1p(sellers30np)", f: (r) => Math.log1p(num(r.sellers30np) ?? 0) },
  // ---- track record (TR; history.mjs, horizon 30, outcome B xsNet, EB shrinkage with the point-in-time pool prior) ----
  { name: "trPersonEB", group: "TR", def: "person EB estimate minus pool mean (30d B xsNet, matured before t); none -> 0", f: (r, x) => x?.trPersonEB ?? 0 },
  { name: "trPersonLogN", group: "TR", def: "log1p(person matured 30d outcomes at t)", f: (r, x) => x?.trPersonLogN ?? 0 },
  { name: "trIssuerEB", group: "TR", def: "issuer EB estimate minus pool mean (30d B xsNet, other insiders' and own earlier buys at the issuer)", f: (r, x) => x?.trIssuerEB ?? 0 },
  // ---- technical (T; bars with date < entry date) ----
  { name: "r5", group: "T", def: "clip(r5,-0.5,0.5)", f: (r) => clip(num(r.r5), -0.5, 0.5) },
  { name: "r20", group: "T", def: "clip(r20,-0.8,1.5)", f: (r) => clip(num(r.r20), -0.8, 1.5) },
  { name: "dHi60", group: "T", def: "close / 60-session closing high - 1", f: (r) => num(r.dHi60) },
  { name: "ldLo60", group: "T", def: "log1p(clip(dLo60,0,5))", f: (r) => log1pClip(num(r.dLo60), 5) },
  { name: "lvol20", group: "T", def: "log(vol20)", f: (r) => (num(r.vol20) > 0 ? Math.log(r.vol20) : null) },
  { name: "ldv20", group: "T", def: "log(dv20)", f: (r) => (num(r.dv20) > 0 ? Math.log(r.dv20) : null) },
  { name: "lvolSurge", group: "T", def: "log(clip(volSurge,0.05,50))", f: (r) => (num(r.volSurge) > 0 ? Math.log(clip(r.volSurge, 0.05, 50)) : null) },
  { name: "bo20", group: "T", def: "decision close is the 20-session closing high", f: (r) => flag(r.bo20) },
  { name: "gapPrev", group: "T", def: "clip(gapPrev,-0.3,0.3) (decision bar's own opening gap)", f: (r) => clip(num(r.gapPrev), -0.3, 0.3) },
  { name: "mdd60", group: "T", def: "max drawdown of closes in the 60-session window", f: (r) => num(r.mdd60) },
  // ---- regime (R) ----
  { name: "spyR20", group: "R", def: "SPY 20-session return", f: (r) => num(r.spyR20) },
  { name: "lspyVol20", group: "R", def: "log(SPY 20-session vol)", f: (r) => (num(r.spyVol20) > 0 ? Math.log(r.spyVol20) : null) },
  { name: "breadth20", group: "R", def: "share of cached symbols above their 20-bar mean", f: (r) => num(r.breadth20) },
  { name: "spyDd60", group: "R", def: "SPY close / 60-session high - 1", f: (r) => num(r.spyDd60) },
];
export const FEATURE_NAMES = FEATURES.map((d) => d.name);
export const GROUPS = { P: [], H: [], C: [], TR: [], T: [], R: [] };
for (const d of FEATURES) GROUPS[d.group].push(d.name);
export const SETS = {
  M1: [...GROUPS.P],                                                  // purchase only ("insider activity alone")
  M2: [...GROUPS.P, ...GROUPS.H, ...GROUPS.C, ...GROUPS.TR],          // all insider information
  M3: [...GROUPS.T, ...GROUPS.R],                                     // technical + regime (exists for controls)
  M4: [...GROUPS.P, ...GROUPS.H, ...GROUPS.C, ...GROUPS.TR, ...GROUPS.T, ...GROUPS.R], // combined
};
export const INSIDER_ONLY = SETS.M2;
export const MARKET_SET = SETS.M3;

// Track-record context for every event row (computed once per history object; point in time at row.decisionAt).
// History items = earlier PRIMARY panel rows (open-market, valued, priced; one per dupKey), outcome B 30d net excess.
export const TR_FILTER = (r) => r.primary === 1;
export function trackRecords(rows, histRows = rows) {
  const H = createHistory(histRows);
  const out = new Map();
  for (const r of rows) {
    const h = H.historyForEvent(r, { horizon: 30, outcome: "B", metric: "xsNet", filter: TR_FILTER });
    const pe = h.person.eb, ie = h.issuer.eb;
    out.set(r.key, {
      trPersonEB: pe ? pe.estimate - pe.mu : 0, trPersonLogN: Math.log1p(h.person.matured.n || 0), trIssuerEB: ie ? ie.estimate - ie.mu : 0,
      trPersonN: h.person.matured.n || 0, trIssuerN: h.issuer.matured.n || 0, poolN: pe?.poolN ?? null,
    });
  }
  return out;
}
// Raw (un-standardised) feature object for an insider event row. tr = trackRecords(...).get(row.key).
export function eventFeatures(row, tr) {
  const o = {}; for (const d of FEATURES) o[d.name] = d.f(row, tr); return o;
}
// Control stock-day: only T and R exist; insider features are undefined (null).
export function controlFeatures(c) {
  const o = {}; for (const d of FEATURES) o[d.name] = d.group === "T" || d.group === "R" ? d.f(c) : null; return o;
}
