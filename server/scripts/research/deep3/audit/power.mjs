// deep3/audit/power.mjs — auditor (agent "audit3"): false-negative check (power / minimum detectable effects) for the
// buyer-position question, plus two pre-declared audit tests. Pre-holdout data only (holdout locked).
//   node --max-old-space-size=12288 scripts/research/deep3/audit/power.mjs
// Output: .cache/research/deep3/audit/power.json
//
// PRE-DECLARED (registered below, before any computation in this script):
//   C1  position x amount-rank x prior drawdown, ONE combined selection: calendar-month open-market buyer at position >= 2,
//       whose month-to-date dollar amount is the largest so far among the month's buyers (point in time, isLargestSoFar),
//       AND decision close >= 30% below the 60-session closing high (dd60 <= -0.30; same threshold as S8/L3, not tuned).
//       Primary sample: discovery + confirmation pooled (pre-holdout). Metrics: (a) touch +10% within 5 sessions (entry
//       session = 1) minus volMom controls > 0; (b) net excess vs SPY at the close of session 3 (tier x1) > 0.
//   E1  Is the entry-day touch advantage just the opening-gap news day? All calendar-month open-market signals, pooled
//       pre-holdout. (a) entry-day +10% touch minus GAP-matched (volMomGap) controls  [NOT BLIND: the same quantity by
//       period was computed in code-audit-evidence.json as a control-design sensitivity before this registration];
//       (b) entry-day DOWNSIDE touch (low <= open x 0.90) minus volMom controls (two-sided news-day volatility?);
//       (c) entry-day open->close net excess (tier x1) minus volMom controls (directional drift?);
//       (d) entry-day +10% touch excess (vs volMom) in the top entry-gap tercile minus the other two terciles;
//       (e) gap-INCLUSIVE touch: high >= last close before entry x 1.10 within 5 sessions, minus volMom controls,
//           for position 1 and for positions >= 2 (descriptive information content incl. the non-tradable gap).
import path from "node:path";
import * as V from "../dataquality/validate.mjs";
import { L, readSeq, readJson, writeOut, group, countBy, r4, mean, median, quantile, cm, seqTouch, seqNet, tbucket, BUCKETS, reg, rec } from "./common.mjs";

if (process.env.DEEP2_HOLDOUT) throw new Error("run with the holdout locked");
const t0 = Date.now(); const log = (...a) => console.log(`[audit3 power ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------------------------------------------------------------- registration FIRST ------------------------------
const FAM_C = "audit3-C1 position x amount-rank x drawdown (combined, pre-declared)";
const FAM_E = "audit3-E1 entry-day touch decomposition (news-day test)";
const H = [
  { id: "audit3-C1-T10W5-ctl", family: FAM_C, familySize: 2, statement: "Pre-holdout pooled: cal-month open-market buyer position >= 2 AND largest-so-far month-to-date amount (point in time) AND dd60 <= -0.30: touch +10% within 5 sessions (entry = session 1) minus volMom controls > 0.", rationale: "User's combined question (position x amount x price behaviour) as ONE pre-declared cell; not tested by the specialists in this form." },
  { id: "audit3-C1-N3-level", family: FAM_C, familySize: 2, statement: "Same selection: net excess vs SPY at the close of session 3 after the MOO entry, tier cost x1, > 0.", rationale: "Executable counterpart of C1." },
  { id: "audit3-E1a-day0-T10-vsGapCtl", family: FAM_E, familySize: 6, statement: "NOT BLIND (by-period values computed in the code audit before registration). Pooled pre-holdout cal/om signals: entry-day +10% touch minus volMomGap (entry-gap-matched) controls = 0.", rationale: "If gap-matched non-event stock-days touch as often, the entry-day advantage is a property of gap/news days." },
  { id: "audit3-E1b-day0-down10-vsCtl", family: FAM_E, familySize: 6, statement: "Pooled pre-holdout cal/om signals: entry-day low <= open x 0.90 minus volMom controls (> 0 means two-sided news-day volatility, not direction).", rationale: "Two-sided check of the entry-day effect." },
  { id: "audit3-E1c-day0-net-vsCtl", family: FAM_E, familySize: 6, statement: "Pooled pre-holdout cal/om signals: entry-day open->close net excess vs SPY (tier x1) minus volMom controls (same cost) = 0.", rationale: "Is there a directional drift on the entry day?" },
  { id: "audit3-E1d-day0-T10-topGapTercile", family: FAM_E, familySize: 6, statement: "Pooled pre-holdout cal/om signals: entry-day +10% touch excess vs volMom controls, top entry-gap (gapX) tercile minus the other two terciles.", rationale: "News-day hypothesis predicts the excess concentrates in large opening gaps." },
  { id: "audit3-E1e-gapIncl-T10W5-pos1", family: FAM_E, familySize: 6, statement: "Pooled pre-holdout, position 1: gap-inclusive touch (high >= last close before entry x 1.10 within sessions 1..5) minus volMom controls (descriptive; not tradable).", rationale: "Does the insider information show up as >=10% moves once the opening gap is included?" },
  { id: "audit3-E1e-gapIncl-T10W5-pos2plus", family: FAM_E, familySize: 6, statement: "Pooled pre-holdout, positions >= 2: gap-inclusive touch minus volMom controls (descriptive; not tradable).", rationale: "Same, later buyers." },
];
let nNew = 0; for (const h of H) nNew += reg({ ...h, preRegistered: !h.id.startsWith("audit3-E1a") }) ? 1 : 0;
log(`registered ${nNew} new ids (${H.length} in this script)`);

// ---------------------------------------------------------------- data ---------------------------------------------
const signals = readSeq("signals.json"), outc = readSeq("outcomes.json"), ctl = readSeq("controls.json");
const S = signals.filter((s) => s.grouping === "cal" && s.universe === "om").map((s) => ({ ...s, out: outc[s.acc]?.status === "ok" ? outc[s.acc] : null, ctl: ctl[s.acc] || null })).filter((s) => s.out);
const PER = { discover: (s) => s.period === "discover", confirm: (s) => s.period === "confirm", pooled: () => true };
log(`cal/om priced signals ${S.length}`);

// ---------------------------------------------------------------- 1. power / MDE per position ---------------------
const DELTAS_TOUCH = [0.03, 0.05, 0.08, 0.10, 0.15], DELTAS_NET = [0.005, 0.01, 0.02];
function powerCell(evs) {
  const d = [], n3 = [];
  for (const s of evs) {
    const a = seqTouch(s.out.o, 0.10, 5), c = s.ctl?.volMom?.hit?.t10w5;
    if (a != null && c != null) d.push({ issuer: s.cik, x: a - c, c, a });
    const x3 = seqNet(s.out.o, 3); if (x3 != null) n3.push({ issuer: s.cik, x: x3 });
  }
  const out = {};
  if (d.length >= 5) {
    const c = V.clusteredMean(d, { value: "x", cluster: "issuer" }); const deff = Math.max(1, c.deff || 1);
    const p0 = mean(d.map((r) => r.c));
    const mdeP = V.mdeProportionDiff({ p0, n1: d.length, n2: Infinity, deff1: deff });
    out.touch10w5 = { n: d.length, issuers: c.clusters, eventRate: r4(mean(d.map((r) => r.a))), controlRate: r4(p0), diff: r4(c.mean), ci95: [r4(c.mean - 1.96 * c.se), r4(c.mean + 1.96 * c.se)], t: r4(c.t), p: r4(c.p),
      sdDiff: r4(c.sd), deff: r4(deff), effectiveN: Math.round(d.length / deff), mde80Paired: r4(V.mdeMean({ n: d.length, sd: c.sd, deff })), mde80Proportion: mdeP ? r4(mdeP.delta) : null,
      power: Object.fromEntries(DELTAS_TOUCH.map((dl) => [`+${Math.round(dl * 100)}pt`, r4(V.powerMean({ delta: dl, sd: c.sd, n: d.length, deff }))])) };
  } else out.touch10w5 = { n: d.length };
  if (n3.length >= 5) {
    const c = V.clusteredMean(n3, { value: "x", cluster: "issuer" }); const deff = Math.max(1, c.deff || 1);
    out.net3 = { n: n3.length, issuers: c.clusters, mean: r4(c.mean), ci95: [r4(c.mean - 1.96 * c.se), r4(c.mean + 1.96 * c.se)], t: r4(c.t), p: r4(c.p), sd: r4(c.sd), deff: r4(deff), mde80: r4(V.mdeMean({ n: n3.length, sd: c.sd, deff })),
      power: Object.fromEntries(DELTAS_NET.map((dl) => [`+${(dl * 100).toFixed(1)}%`, r4(V.powerMean({ delta: dl, sd: c.sd, n: n3.length, deff }))])) };
  } else out.net3 = { n: n3.length };
  return out;
}
const power = {};
for (const [p, f] of Object.entries(PER)) {
  power[p] = {};
  for (const b of BUCKETS) power[p][b] = powerCell(S.filter((s) => f(s) && tbucket(s.position) === b));
  power[p]["2+"] = powerCell(S.filter((s) => f(s) && s.position >= 2));
  power[p]["3+"] = powerCell(S.filter((s) => f(s) && s.position >= 3));
}
log("MDE tables done");

// ---------------------------------------------------------------- 2. C1 combined test -------------------------------
const C1sel = (s) => s.position >= 2 && s.isLargestSoFar === true && s.out.feat?.dd60 != null && s.out.feat.dd60 <= -0.30;
function c1Stats(evs) {
  const d = [], n3 = [];
  for (const s of evs) { const a = seqTouch(s.out.o, 0.10, 5), c = s.ctl?.volMom?.hit?.t10w5; if (a != null && c != null) d.push({ issuer: s.cik, x: a - c, a, c }); const x3 = seqNet(s.out.o, 3); if (x3 != null) n3.push({ issuer: s.cik, x: x3 }); }
  const a = V.clusteredMean(d, { value: "x", cluster: "issuer" }), b = L.companyStats(n3), bt = V.clusteredMean(n3, { value: "x", cluster: "issuer" });
  return { touch: { n: d.length, issuers: a.clusters, event: r4(mean(d.map((r) => r.a))), control: r4(mean(d.map((r) => r.c))), estimate: r4(a.mean), ci95: a.se ? [r4(a.mean - 1.96 * a.se), r4(a.mean + 1.96 * a.se)] : null, t: r4(a.t), p: r4(a.p), pNormal: r4(a.pNormal) },
    net3: { n: b.n, issuers: b.issuers, estimate: b.mean, median: b.median, issuerMedianOfMeans: b.issuerMedianOfMeans, meanExTop5Issuers: b.meanExTop5Issuers, ci95: b.ci95, t: r4(bt.t), p: r4(bt.p), pNormal: b.p == null ? null : r4(b.p) } };
}
const C1 = { selection: "position >= 2 AND isLargestSoFar AND dd60 <= -0.30 (cal/om)", pooled: c1Stats(S.filter(C1sel)), discover: c1Stats(S.filter((s) => s.period === "discover" && C1sel(s))), confirm: c1Stats(S.filter((s) => s.period === "confirm" && C1sel(s))),
  context_pos2plus_notC1: c1Stats(S.filter((s) => s.position >= 2 && !C1sel(s))),
  events: S.filter(C1sel).map((s) => ({ sym: s.sym, T: s.T, period: s.period, position: s.position, usd: Math.round(s.usd || 0), dd60: r4(s.out.feat.dd60), t10w5: seqTouch(s.out.o, 0.10, 5), ctlT10w5: s.ctl?.volMom?.hit?.t10w5 ?? null, n3: r4(seqNet(s.out.o, 3)) })) };
rec("audit3-C1-T10W5-ctl", { ...C1.pooled.touch, period: "pooled pre-holdout", byPeriod: { discover: C1.discover.touch, confirm: C1.confirm.touch } });
rec("audit3-C1-N3-level", { ...C1.pooled.net3, period: "pooled pre-holdout", byPeriod: { discover: C1.discover.net3, confirm: C1.confirm.net3 } });
log("C1 done", JSON.stringify(C1.pooled));

// ---------------------------------------------------------------- 3. E1 entry-day decomposition -------------------
const bars = L.loadBars(); const spy = bars.get("SPY"); const days = spy.arr.map((b) => b.d); const jOf = new Map(days.map((d, i) => [d, i]));
const COMPLETE = readJson(path.join(L.DEEP1, "stageA.json")).completeThrough;
const perEnd = (d) => (d < L.DISCOVER_END ? L.DISCOVER_END : L.HOLDOUT_START);
// day-0 and gap-inclusive metrics for one (symbol, entry date); costBps applied to the open->close net.
function m0(sym, D0, costBps, endDate) {
  const ser = bars.get(sym); if (!ser) return null; const k = ser.idx.get(D0); const j0 = jOf.get(D0);
  if (k == null || j0 == null || k < 1) return null; const b = ser.arr[k]; if (!(b.o > 0 && b.c > 0)) return null;
  const prevC = ser.arr[k - 1].c; const S0 = spy.arr[j0]; const c = costBps / 1e4;
  const up10 = b.h >= b.o * 1.10 ? 1 : 0, dn10 = b.l <= b.o * 0.90 ? 1 : 0;
  const net0 = (b.c * (1 - c)) / (b.o * (1 + c)) - 1 - (S0.c / S0.o - 1);
  let gi = null; // gap-inclusive +10% within sessions 1..5 (entry = 1)
  if (j0 + 4 < days.length && days[j0 + 4] < endDate && days[j0 + 4] <= COMPLETE) { gi = 0; for (let t = 0; t <= 4; t++) { const kk = ser.idx.get(days[j0 + t]); if (kk != null && ser.arr[kk].h >= prevC * 1.10) { gi = 1; break; } } }
  return { up10, dn10, net0, gi, gapRaw: b.o / prevC - 1 };
}
const evRows = [];
for (const s of S) {
  const D0 = s.out.entryDate, end = s.period === "discover" ? L.DISCOVER_END : L.HOLDOUT_START; if (!(D0 < end)) continue;
  const e = m0(s.sym, D0, s.out.costBps, end); if (!e) continue;
  const cs = {};
  for (const set of ["volMom", "volMomGap"]) {
    const refs = s.ctl?.[set]?.refs || []; const vals = [];
    for (const ref of refs) { const [cs_, cd] = ref.split("|"); const v = m0(cs_, cd, s.out.costBps, perEnd(cd)); if (v) vals.push(v); }
    if (vals.length) cs[set] = { up10: mean(vals.map((v) => v.up10)), dn10: mean(vals.map((v) => v.dn10)), net0: mean(vals.map((v) => v.net0)), gi: vals.some((v) => v.gi != null) ? mean(vals.filter((v) => v.gi != null).map((v) => v.gi)) : null, n: vals.length };
  }
  evRows.push({ issuer: s.cik, period: s.period, position: s.position, gapX: s.out.pre?.gapX ?? null, e, cs });
}
log(`E1 rows ${evRows.length}`);
const diffStats = (rows, f) => { const d = rows.map((r) => { const v = f(r); return v == null || !Number.isFinite(v) ? null : { issuer: r.issuer, x: v }; }).filter(Boolean); const c = V.clusteredMean(d, { value: "x", cluster: "issuer" }); return { n: c.n, issuers: c.clusters, estimate: r4(c.mean), ci95: c.se ? [r4(c.mean - 1.96 * c.se), r4(c.mean + 1.96 * c.se)] : null, t: r4(c.t), p: r4(c.p), pNormal: r4(c.pNormal) }; };
const has = (r, set) => r.cs[set] != null;
const fUpGap = (r) => (has(r, "volMomGap") ? r.e.up10 - r.cs.volMomGap.up10 : null);
const fUpMom = (r) => (has(r, "volMom") ? r.e.up10 - r.cs.volMom.up10 : null);
const fDn = (r) => (has(r, "volMom") ? r.e.dn10 - r.cs.volMom.dn10 : null);
const fNet0 = (r) => (has(r, "volMom") ? r.e.net0 - r.cs.volMom.net0 : null);
const fGi = (r) => (has(r, "volMom") && r.e.gi != null && r.cs.volMom.gi != null ? r.e.gi - r.cs.volMom.gi : null);
const gx = evRows.map((r) => r.gapX).filter(Number.isFinite); const g67 = quantile(gx, 2 / 3), g33 = quantile(gx, 1 / 3);
const top = evRows.filter((r) => Number.isFinite(r.gapX) && r.gapX >= g67), rest = evRows.filter((r) => Number.isFinite(r.gapX) && r.gapX < g67);
const toX = (rows, f) => rows.map((r) => { const v = f(r); return v == null ? null : { issuer: r.issuer, x: v }; }).filter(Boolean);
const tsd = V.twoSampleDiff(toX(top, fUpMom), toX(rest, fUpMom), { value: "x", cluster: "issuer", B: 2000, seed: 7 });
const byPer = (f) => Object.fromEntries(["discover", "confirm"].map((p) => [p, diffStats(evRows.filter((r) => r.period === p), f)]));
const E1 = {
  a_day0Up10_vsGapCtl: { pooled: diffStats(evRows, fUpGap), byPeriod: byPer(fUpGap), note: "NOT BLIND" },
  ref_day0Up10_vsVolMom: { pooled: diffStats(evRows, fUpMom), byPeriod: byPer(fUpMom) },
  b_day0Down10_vsVolMom: { pooled: diffStats(evRows, fDn), byPeriod: byPer(fDn), eventRate: r4(mean(evRows.map((r) => r.e.dn10))), eventUpRate: r4(mean(evRows.map((r) => r.e.up10))) },
  c_day0Net_vsVolMom: { pooled: diffStats(evRows, fNet0), byPeriod: byPer(fNet0), eventMeanNet0: r4(mean(evRows.map((r) => r.e.net0))) },
  d_topGapTercile: { cutGapX67: r4(g67), cutGapX33: r4(g33), top: diffStats(top, fUpMom), middle: diffStats(evRows.filter((r) => Number.isFinite(r.gapX) && r.gapX >= g33 && r.gapX < g67), fUpMom), bottom: diffStats(evRows.filter((r) => Number.isFinite(r.gapX) && r.gapX < g33), fUpMom),
    topMinusRest: { diff: r4(tsd.diff), ci95: [r4(tsd.ci[0]), r4(tsd.ci[1])], z: r4(tsd.z), p: r4(tsd.p) },
    downsideByTercile: { top: diffStats(top, fDn), rest: diffStats(rest, fDn) } },
  e_gapInclusive_T10W5: { pos1: { pooled: diffStats(evRows.filter((r) => r.position === 1), fGi), byPeriod: Object.fromEntries(["discover", "confirm"].map((p) => [p, diffStats(evRows.filter((r) => r.position === 1 && r.period === p), fGi)])) },
    pos2plus: { pooled: diffStats(evRows.filter((r) => r.position >= 2), fGi), byPeriod: Object.fromEntries(["discover", "confirm"].map((p) => [p, diffStats(evRows.filter((r) => r.position >= 2 && r.period === p), fGi)])) },
    byBucketPooled: Object.fromEntries(BUCKETS.map((b) => [b, diffStats(evRows.filter((r) => tbucket(r.position) === b), fGi)])) },
};
rec("audit3-E1a-day0-T10-vsGapCtl", { ...E1.a_day0Up10_vsGapCtl.pooled, byPeriod: E1.a_day0Up10_vsGapCtl.byPeriod, notBlind: true });
rec("audit3-E1b-day0-down10-vsCtl", { ...E1.b_day0Down10_vsVolMom.pooled, byPeriod: E1.b_day0Down10_vsVolMom.byPeriod });
rec("audit3-E1c-day0-net-vsCtl", { ...E1.c_day0Net_vsVolMom.pooled, byPeriod: E1.c_day0Net_vsVolMom.byPeriod });
rec("audit3-E1d-day0-T10-topGapTercile", { estimate: E1.d_topGapTercile.topMinusRest.diff, ci95: E1.d_topGapTercile.topMinusRest.ci95, z: E1.d_topGapTercile.topMinusRest.z, p: E1.d_topGapTercile.topMinusRest.p, top: E1.d_topGapTercile.top, bottom: E1.d_topGapTercile.bottom });
rec("audit3-E1e-gapIncl-T10W5-pos1", { ...E1.e_gapInclusive_T10W5.pos1.pooled, byPeriod: E1.e_gapInclusive_T10W5.pos1.byPeriod });
rec("audit3-E1e-gapIncl-T10W5-pos2plus", { ...E1.e_gapInclusive_T10W5.pos2plus.pooled, byPeriod: E1.e_gapInclusive_T10W5.pos2plus.byPeriod });
log("E1 done");

// ---------------------------------------------------------------- 4. plain-language detectability statements -------
const say = [];
for (const b of [...BUCKETS, "2+"]) {
  const c = power.pooled[b]?.touch10w5; if (!c?.n) continue;
  const det = Object.entries(c.power).filter(([, pw]) => pw >= 0.8).map(([k]) => k), not = Object.entries(c.power).filter(([, pw]) => pw < 0.8).map(([k, pw]) => `${k} (power ${Math.round(pw * 100)}%)`);
  say.push(`Position ${b} (pre-holdout pooled, n ${c.n}, effective n ${c.effectiveN}): MDE80 of the +10%/5-session touch edge vs controls = ${(c.mde80Paired * 100).toFixed(1)} points; detected with >= 80% power: ${det.join(", ") || "none of the listed"}; not reliably detected: ${not.join(", ") || "none"}. Observed ${(c.diff * 100).toFixed(1)} pt [${(c.ci95[0] * 100).toFixed(1)}, ${(c.ci95[1] * 100).toFixed(1)}].`);
  const n = power.pooled[b]?.net3; if (n?.n) say.push(`Position ${b}: MDE80 of the 3-session net excess = ${(n.mde80 * 100).toFixed(2)}% (observed ${(n.mean * 100).toFixed(2)}%, CI [${(n.ci95[0] * 100).toFixed(2)}, ${(n.ci95[1] * 100).toFixed(2)}]).`);
}
writeOut("power.json", { generatedAt: new Date().toISOString(), conventions: { touch: "sequence convention: +10% within sessions 1..5, entry session = 1 (= entry day + 4 sessions)", controls: "volMom matched non-event stock-days (10 per event), per-event difference", alpha: "0.05 two-sided, 80% power, issuer design effect (floored at 1)", mde: "validate.mjs mdeMean on the paired difference (sd and issuer deff observed); mdeProportionDiff with the control rate as a known baseline" },
  power, statements: say, C1, E1, registered: H.map((h) => h.id) });
log("written power.json");
for (const s of say) console.log(s);
console.log("C1", JSON.stringify(C1.pooled), "\nE1", JSON.stringify({ a: E1.a_day0Up10_vsGapCtl.pooled, ref: E1.ref_day0Up10_vsVolMom.pooled, b: E1.b_day0Down10_vsVolMom.pooled, c: E1.c_day0Net_vsVolMom.pooled, d: E1.d_topGapTercile.topMinusRest, dTop: E1.d_topGapTercile.top, dMid: E1.d_topGapTercile.middle, dBot: E1.d_topGapTercile.bottom, e1: E1.e_gapInclusive_T10W5.pos1.pooled, e2: E1.e_gapInclusive_T10W5.pos2plus.pooled }));
