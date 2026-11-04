// deep3/targets/stats.mjs — shared analysis helpers over events.json rows (no data access beyond OUT).
import { readOut, cstats, mean, median, quant, r4, TARGETS, HORIZONS, diffTest, companyStats } from "./common.mjs";

let _rows = null;
export function loadRows() { if (!_rows) _rows = readOut("events.json").rows; return _rows; }

// Event value of an outcome key (with the one-session-delay variant when delay = true).
export const evVal = (r, k, { delay = false } = {}) => { const o = delay ? r.oD : r.o; const v = o ? o[k] : null; return v == null || !Number.isFinite(v) ? null : v; };
// Control mean for a key from a control set: "cm" primary, "cg" gap-matched, "cv" volRich, or a chart flag (within-pattern).
export function ctlVal(r, k, ctl = "cm") {
  const c = ctl === "cm" || ctl === "cg" || ctl === "cv" ? r[ctl] : r.cf?.[ctl];
  const v = c ? c[k] : null; return v == null || !Number.isFinite(v) ? null : v;
}
export function diffRows(rows, k, ctl = "cm") {
  const out = [];
  for (const r of rows) { const e = evVal(r, k), c = ctlVal(r, k, ctl); if (e == null || c == null) continue; out.push({ issuer: r.issuer, x: e - c, e, c, r }); }
  return out;
}
export function absRows(rows, k, opt) { const out = []; for (const r of rows) { const e = evVal(r, k, opt); if (e == null) continue; out.push({ issuer: r.issuer, x: e, r }); } return out; }
export const slim = (cs) => (cs && cs.n ? { n: cs.n, issuers: cs.issuers, mean: cs.mean, median: cs.median, issuerMedianOfMeans: cs.issuerMedianOfMeans, issuersPositive: cs.issuersPositive, positive: cs.positive, t: cs.t, p: cs.p, meanExTop5Issuers: cs.meanExTop5Issuers, ci95: cs.ci95 } : { n: 0 });

// One registered test → result object (stats on x, plus event/control levels for context).
export function testResult(rows, t, ctl = "cm", opt = {}) {
  if (t.kind === "diff") {
    const d = diffRows(rows, t.k, ctl);
    const cs = cstats(d.map(({ issuer, x }) => ({ issuer, x })), opt);
    return { ...slim(cs), eventMean: r4(mean(d.map((x) => x.e))), controlMean: r4(mean(d.map((x) => x.c))) };
  }
  const a = absRows(rows, t.k, opt);
  const cs = cstats(a.map(({ issuer, x }) => ({ issuer, x })), opt);
  const c = rows.map((r) => ctlVal(r, t.k, ctl)).filter((v) => v != null);
  return { ...slim(cs), controlMean: r4(mean(c)) };
}

// ---------------- the user's 10 questions for one event set ----------------
// Keeps the three notions separate: (A) touch statistics, (B) limit-fill approximation, (C) executable close exits.
export function tenQuestions(rows, ctl = "cm", { allBaseline = null } = {}) {
  const out = { n: rows.length, issuers: new Set(rows.map((r) => r.issuer)).size };
  const vals = rows.map((r) => r.filingValue).filter((v) => v > 0);
  out.purchaseAmount = { median: Math.round(median(vals) || 0), p25: Math.round(quant(vals, 0.25) || 0), p75: Math.round(quant(vals, 0.75) || 0), mean: Math.round(mean(vals) || 0) };
  out.ceoCfoShare = r4(rows.filter((r) => r.isCeo || r.isCfo).length / Math.max(1, rows.length));
  out.medianVol20 = r4(median(rows.map((r) => r.vol20).filter(Number.isFinite)));
  out.medianDollarVol20 = Math.round(median(rows.map((r) => r.dv20).filter(Number.isFinite)) || 0);
  // (A) TOUCH (descriptive probability of the daily high reaching the target; NOT a profit)
  out.touch = {};
  for (const X of TARGETS) {
    const T = { hit: {}, control: {}, diff: {} };
    for (const N of HORIZONS) {
      const d = diffRows(rows, `hit${X}_${N}`, ctl);
      const cs = cstats(d.map(({ issuer, x }) => ({ issuer, x })), { boot: 200 });
      T.hit[N] = r4(mean(d.map((x) => x.e))); T.control[N] = r4(mean(d.map((x) => x.c))); T.diff[N] = { mean: cs.mean, t: cs.t, p: cs.p, ci95: cs.ci95, n: cs.n, issuers: cs.issuers };
      if (allBaseline) T.allInsider = T.allInsider || {}, (T.allInsider[N] = allBaseline.touch?.[X]?.hit?.[N] ?? null);
    }
    // time to target among events with a complete 10-session window
    const full = rows.filter((r) => r.o && r.o.last >= 10);
    const hits = full.filter((r) => r.o[`ttt${X}`] != null);
    T.n10 = full.length; T.hit10 = r4(hits.length / Math.max(1, full.length));
    T.medianSessionsToTargetAmongHits = median(hits.map((r) => r.o[`ttt${X}`]));
    T.meanSessionsToTargetAmongHits = r4(mean(hits.map((r) => r.o[`ttt${X}`])));
    T.cumulativeBySession = Array.from({ length: 11 }, (_, t) => r4(full.filter((r) => r.o[`ttt${X}`] != null && r.o[`ttt${X}`] <= t).length / Math.max(1, full.length)));
    const cc = full.map((r) => (ctl === "cm" || ctl === "cg" || ctl === "cv" ? r[ctl] : r.cf?.[ctl])?.cum?.[X]).filter(Boolean);
    T.controlCumulativeBySession = cc.length ? Array.from({ length: 11 }, (_, t) => r4(mean(cc.map((a) => a[t])))) : null;
    T.sharesOfHitsBySession = { s0: r4(hits.filter((r) => r.o[`ttt${X}`] === 0).length / Math.max(1, hits.length)), s1: r4(hits.filter((r) => r.o[`ttt${X}`] <= 1).length / Math.max(1, hits.length)), s2: r4(hits.filter((r) => r.o[`ttt${X}`] <= 2).length / Math.max(1, hits.length)), s3: r4(hits.filter((r) => r.o[`ttt${X}`] <= 3).length / Math.max(1, hits.length)), s5: r4(hits.filter((r) => r.o[`ttt${X}`] <= 5).length / Math.max(1, hits.length)) };
    // largest drawdown before the target (among hits): MAE from the entry until the touch session (incl. its low = conservative)
    const dd = hits.map((r) => r.o[`maeBI${X}`]).filter(Number.isFinite), ddS = hits.map((r) => r.o[`maeB${X}`]).filter(Number.isFinite);
    T.drawdownBeforeTarget = { medianInclTouchSession: r4(median(dd)), p10InclTouchSession: r4(quant(dd, 0.1)), worst: r4(Math.min(...dd)), medianStrictlyBefore: r4(median(ddS)), shareBelowMinus10: r4(dd.filter((v) => v <= -0.1).length / Math.max(1, dd.length)) };
    out.touch[X] = T;
  }
  // tMax and MFE/MAE
  const f10 = rows.filter((r) => r.o && r.o.tMax10 != null);
  out.sessionsToMax10 = { median: median(f10.map((r) => r.o.tMax10)), mean: r4(mean(f10.map((r) => r.o.tMax10))) };
  out.mfeMae = {};
  for (const N of [5, 10]) {
    const a = rows.filter((r) => r.o && r.o[`mfe${N}`] != null);
    out.mfeMae[N] = { medianMFE: r4(median(a.map((r) => r.o[`mfe${N}`]))), medianMAE: r4(median(a.map((r) => r.o[`mae${N}`]))), pMAEle10: r4(mean(a.map((r) => r.o[`dd10_${N}`]))), pMAEle20: r4(mean(a.map((r) => r.o[`dd20_${N}`]))),
      controlPMAEle10: r4(mean(a.map((r) => ctlVal(r, `dd10_${N}`, ctl)).filter((v) => v != null))) };
  }
  // (B) LIMIT-FILL APPROXIMATION (net of tier cost, minus SPY)
  out.limitFill = {};
  for (const k of ["tp5s5n5", "tp10s10n5", "tp10s0n10", "tp15s10n10", "tp20s10n10"]) {
    const a = absRows(rows, k); if (!a.length) continue;
    const cs = cstats(a.map(({ issuer, x }) => ({ issuer, x })), { boot: 200 });
    const why = (w) => r4(rows.filter((r) => r.o?.[`${k}_why`] === w).length / Math.max(1, a.length));
    out.limitFill[k] = { ...slim(cs), control: r4(mean(rows.map((r) => ctlVal(r, k, ctl)).filter((v) => v != null))), fillShare: why("tp"), stopShare: why("stop"), timeShare: why("time"),
      meanHoldSessions: r4(mean(rows.map((r) => r.o?.[`${k}_t`]).filter(Number.isFinite))) };
  }
  // (C) EXECUTABLE close exits (net of tier cost, minus SPY)
  out.executable = {};
  for (const N of HORIZONS) {
    const a = absRows(rows, `x${N}`); const cs = cstats(a.map(({ issuer, x }) => ({ issuer, x })), { boot: 200 });
    out.executable[N] = { ...slim(cs), control: r4(mean(rows.map((r) => ctlVal(r, `x${N}`, ctl)).filter((v) => v != null))), winRate: r4(a.filter((x) => x.x > 0).length / Math.max(1, a.length)) };
  }
  return out;
}

// Stability: by month and by SPY regime, for a per-event diff key and an absolute key.
export function stability(rows, { diffKey = "hit10_5", absKey = "x5", ctl = "cm" } = {}) {
  const by = (f) => { const m = new Map(); for (const r of rows) { const k = f(r); (m.get(k) || m.set(k, []).get(k)).push(r); } return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))); };
  const cell = (rs) => { const d = diffRows(rs, diffKey, ctl); const a = absRows(rs, absKey); return { n: rs.length, issuers: new Set(rs.map((r) => r.issuer)).size, event: r4(mean(d.map((x) => x.e))), control: r4(mean(d.map((x) => x.c))), diff: r4(mean(d.map((x) => x.x))), [`mean_${absKey}`]: r4(mean(a.map((x) => x.x))), [`median_${absKey}`]: r4(median(a.map((x) => x.x))) }; };
  const firstPerIssuer = []; const seen = new Set(); for (const r of [...rows].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) { if (seen.has(r.issuer)) continue; seen.add(r.issuer); firstPerIssuer.push(r); }
  const d = diffRows(rows, diffKey, ctl); const dcs = companyStats(d.map(({ issuer, x }) => ({ issuer, x })), { boot: 0 });
  const a = absRows(rows, absKey); const acs = companyStats(a.map(({ issuer, x }) => ({ issuer, x })), { boot: 0 });
  // top-5 issuers by event count
  const cnt = new Map(); for (const r of rows) cnt.set(r.issuer, (cnt.get(r.issuer) || 0) + 1);
  const top5 = [...cnt.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map((x) => x[0]);
  const exTop = rows.filter((r) => !top5.includes(r.issuer));
  return {
    byMonth: by((r) => r.m).map(([k, rs]) => ({ month: k, ...cell(rs) })),
    bySpyRegime: by((r) => (r.spyAbove50 == null ? "unknown" : r.spyAbove50 ? "SPY>50d" : "SPY<50d")).map(([k, rs]) => ({ regime: k, ...cell(rs) })),
    companies: { issuers: dcs.issuers, issuersPositiveDiff: dcs.issuersPositive, issuerMedianDiff: dcs.issuerMedianOfMeans, meanDiffExTop5Contributors: dcs.meanExTop5Issuers, issuersPositiveAbs: acs.issuersPositive, absExTop5Contributors: acs.meanExTop5Issuers,
      top5ByCount: top5.map((i) => ({ issuer: i, events: cnt.get(i), ticker: rows.find((r) => r.issuer === i)?.ticker })), exTop5ByCount: cell(exTop) },
    onePerCompany: cell(firstPerIssuer),
  };
}
export { mean, median, r4, quant, diffTest };
