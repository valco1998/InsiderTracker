// deep3/sequence/analyze.mjs — runs the pre-registered tests (tests.mjs), applies BH, records results, and writes the
// descriptive position tables.   node scripts/research/deep3/sequence/analyze.mjs
// Three lenses are kept strictly apart in every table:
//   touch     — historical: did a daily high reach entry×(1+X) within W sessions (entry session = session 1)? NOT a profit.
//   limitFill — the BRIEF approximation: resting sell limit at entry×(1+X), filled at max(open, target) on the first session
//               whose high >= target×1.005, else exit at the close of N. Approximate; needs intraday data to verify.
//   net       — executable: official open entry, official close exit, tier cost per side (×1/×2/×3), minus SPY.
import { readOut, writeOut, writePretty, recMany, myRegistry, clusteredMean, diffTest, rankSlope, companyStats, bhQ, r4, mean, median, quantile, TARGETS, TKEY, TOUCH_W, HORIZONS, TP_N, group, toCsv, bootCI } from "./common.mjs";
import { TESTS, METRICS, TEST_BUCKETS, tb, DESC_BUCKETS, db, matchSel, MIN_N, MIN_ISSUERS } from "./tests.mjs";

const t0 = Date.now();
const signals = readOut("signals.json"), fseq = readOut("filing-seq.json"), outc = readOut("outcomes.json"), ctl = readOut("controls.json");
const join = (s) => { const o = outc[s.acc]; return { ...s, ok: o?.status === "ok", out: o?.status === "ok" ? o : null, feat: o?.feat || null, pre: o?.pre || null, ctl: ctl[s.acc] || null }; };
const SIG = signals.map(join).filter((s) => s.ok && !(s.grouping === "roll" && s.windowTruncated));
const FSEQ = fseq.map(join).filter((s) => s.ok && !(s.grouping === "roll" && s.windowTruncated));
const pop = (src, g, u, p) => (src === "fseq" ? FSEQ : SIG).filter((s) => s.grouping === g && s.universe === u && s.period === p);

// ---- metric access ----
export function val(s, m, { variant = "o", mult = 1 } = {}) {
  const M = METRICS[m] || m; const O = s.out?.[variant]; if (!O) return null;
  if (M.type === "touch") { if (O.availTouchW < M.W) return null; const f = O.first[TKEY(M.X)]; return f != null && f <= M.W ? 1 : 0; }
  if (M.type === "net") { const x = O.x?.[M.N]; return x ? x[mult - 1] : null; }
  return null;
}
function ctlVal(s, m, set) { const C = s.ctl?.[set]; if (!C) return null; const M = METRICS[m] || m; if (M.type === "touch") return C.hit[`${TKEY(M.X)}w${M.W}`] ?? null; if (M.type === "net") return C.x[M.N] ?? null; return null; }
const okSample = (rows) => rows.length >= MIN_N && new Set(rows.map((r) => r.issuer)).size >= MIN_ISSUERS;

// ---- registered tests ----
function runTest(t) {
  const P = pop(t.source || "signals", t.grouping, t.universe, t.period);
  if (t.kind === "ctl") {
    const rows = []; const ev = [], cv = [];
    for (const s of P) { if (!matchSel(s, t.sel)) continue; const a = val(s, t.metric), b = ctlVal(s, t.metric, t.set); if (a == null || b == null) continue; rows.push({ issuer: s.cik, x: a - b }); ev.push(a); cv.push(b); }
    if (!okSample(rows)) return { status: "NA", n: rows.length, issuers: new Set(rows.map((r) => r.issuer)).size };
    const cm = clusteredMean(rows);
    return { status: "ok", n: cm.n, issuers: cm.issuers, event: r4(mean(ev)), control: r4(mean(cv)), estimate: cm.mean, ci95: cm.ci95, t: cm.t, p: cm.p, bootCI: bootCI(rows) };
  }
  if (t.kind === "level") {
    const rows = P.filter((s) => matchSel(s, t.sel)).map((s) => ({ issuer: s.cik, x: val(s, t.metric) })).filter((r) => Number.isFinite(r.x));
    if (!okSample(rows)) return { status: "NA", n: rows.length };
    const cs = companyStats(rows); const cm = clusteredMean(rows);
    return { status: "ok", n: cs.n, issuers: cs.issuers, estimate: cs.mean, median: cs.median, issuerMedianOfMeans: cs.issuerMedianOfMeans, positive: cs.positive, meanExTop5Issuers: cs.meanExTop5Issuers, ci95: cs.ci95, t: cm.t, p: cm.p };
  }
  if (t.kind === "diff" || t.kind === "diffAll") {
    const A = P.filter((s) => matchSel(s, t.A)).map((s) => ({ issuer: s.cik, x: val(s, t.metric), acc: s.acc, accs: s.accs })).filter((r) => Number.isFinite(r.x));
    let B;
    if (t.kind === "diffAll") {
      const inA = new Set(A.flatMap((r) => String(r.accs || r.acc).split("+")));
      B = pop("fseq", "cal", "om", t.period).filter((s) => !inA.has(s.acc)).map((s) => ({ issuer: s.cik, x: val(s, t.metric) })).filter((r) => Number.isFinite(r.x));
    } else B = P.filter((s) => matchSel(s, t.B)).map((s) => ({ issuer: s.cik, x: val(s, t.metric) })).filter((r) => Number.isFinite(r.x));
    if (!okSample(A) || !okSample(B)) return { status: "NA", nA: A.length, nB: B.length };
    const d = diffTest(A, B);
    return { status: d.p == null ? "NA" : "ok", n: d.nA, nB: d.nB, issuers: d.issuersA, meanA: d.meanA, meanB: d.meanB, estimate: d.diff, t: d.t, p: d.p };
  }
  if (t.kind === "slope") {
    const rows = P.filter((s) => matchSel(s, t.sel)).map((s) => ({ issuer: s.cik, x: val(s, t.metric), z: s[t.z] })).filter((r) => Number.isFinite(r.x) && Number.isFinite(r.z));
    if (!okSample(rows)) return { status: "NA", n: rows.length };
    const o = rankSlope(rows);
    return o ? { status: "ok", n: o.n, issuers: o.issuers, estimate: o.b, intercept: o.a, t: o.t, p: o.p } : { status: "NA", n: rows.length };
  }
  throw new Error(`unknown kind ${t.kind}`);
}
const regIds = new Set(myRegistry().map((x) => x.id));
for (const t of TESTS) if (!regIds.has(t.id)) throw new Error(`${t.id} is not registered`);
const results = TESTS.map((t) => ({ t, r: runTest(t) }));
const disc = results.filter((x) => x.t.period === "discover");
const q = bhQ(disc.map((x) => (x.r.status === "ok" ? x.r.p : null)));
disc.forEach((x, i) => { x.r.q = q[i] == null ? null : r4(q[i]); });
const conf = results.filter((x) => x.t.period === "confirm");
// Replication = the pre-specified discovery counterpart's sign AND p < 0.10 (sign-blind flags are wrong; fixed 2026-11-04).
const counterpart = (id) => id
  .replace(/^sequence-S11-cal-b(.+)-T10W5-ctl$/, "sequence-S1-cal-b$1-T10W5").replace(/^sequence-S11-cal-b(.+)-N3-level$/, "sequence-S2-cal-b$1-N3")
  .replace(/^sequence-S11-cal-b(.+)-N3-ctl$/, "sequence-S3-cal-b$1-N3").replace(/^sequence-S11-cal-largestSoFar-(.+)$/, "sequence-S7a-cal-largestSoFar-$1")
  .replace(/^sequence-S11-roll-b(.+)-T10W5-ctl$/, "sequence-S9-roll-b$1-T10W5-vsCtl");
const byId = new Map(results.map((x) => [x.t.id, x]));
for (const x of conf) {
  const d = byId.get(counterpart(x.t.id)); x.r.passConfirm = undefined;
  x.r.discoveryId = d?.t.id ?? null; x.r.discoveryEstimate = d?.r.estimate ?? null; x.r.discoveryP = d?.r.p ?? null; x.r.discoveryQ = d?.r.q ?? null;
  x.r.replicates = x.r.status === "ok" && d?.r.status === "ok" ? Math.sign(x.r.estimate) === Math.sign(d.r.estimate) && x.r.p < 0.1 : null;
}
const recorded = recMany(results.map((x) => [x.t.id, { ...x.r, metric: x.t.metric, kind: x.t.kind, family: x.t.family }]));
const testsOut = results.map((x) => ({ id: x.t.id, family: x.t.family, familySize: x.t.familySize, kind: x.t.kind, metric: x.t.metric, set: x.t.set ?? null, statement: x.t.statement, ...x.r }));
writePretty("tests-results.json", { computedAt: new Date().toISOString(), discoveryTests: disc.length, discoveryWithP: disc.filter((x) => x.r.status === "ok").length,
  qBelow10: disc.filter((x) => x.r.q != null && x.r.q < 0.1).map((x) => x.t.id), confirmTests: conf.length, recorded, tests: testsOut });
console.log(`[tests] ${results.length} run; ${recorded} newly recorded; discovery with p: ${disc.filter((x) => x.r.status === "ok").length}; q<0.10: ${disc.filter((x) => x.r.q != null && x.r.q < 0.1).length}`);

// ---- descriptive position tables ----
const cm = (rows) => clusteredMean(rows);
function describe(evs) {
  const issuers = new Set(evs.map((s) => s.cik));
  const usd = evs.map((s) => s.usd).filter((v) => v > 0);
  const cnt = (f) => evs.reduce((m, s) => { const k = String(f(s)); m[k] = (m[k] || 0) + 1; return m; }, {});
  const d = {
    n: evs.length, issuers: issuers.size, months: [...new Set(evs.map((s) => s.month))].length,
    amountUsd: { median: r4(median(usd)), mean: r4(mean(usd)), p25: r4(quantile(usd, 0.25)), p75: r4(quantile(usd, 0.75)) },
    roles: cnt((s) => s.primaryRole), own: cnt((s) => s.own), cls: cnt((s) => s.cls), ties: evs.filter((s) => s.tieSize > 1).length,
    buyersKnownMedian: r4(median(evs.map((s) => s.buyersSoFar))), insidersKnownMedian: r4(median(evs.map((s) => s.insidersKnown))), buyers30dMedian: r4(median(evs.map((s) => s.buyers30d))),
    daysSinceFirstMedian: r4(median(evs.map((s) => s.daysSinceFirst).filter(Number.isFinite))), accumUsdMedian: r4(median(evs.map((s) => s.accumUsd).filter(Number.isFinite))),
    pctOfPriorMedian: r4(median(evs.map((s) => s.pctOfPrior).filter(Number.isFinite))), firstPositionShare: r4(mean(evs.filter((s) => s.holdValid).map((s) => (s.priorNearZero ? 1 : 0)))),
    delayDaysMedian: r4(median(evs.map((s) => s.delayDays).filter(Number.isFinite))),
    pre: { tradeToDecisionX: r4(median(evs.map((s) => s.pre?.tradeToDecisionX).filter(Number.isFinite))), pre20X: r4(median(evs.map((s) => s.pre?.pre20X).filter(Number.isFinite))),
      gapXmedian: r4(median(evs.map((s) => s.pre?.gapX).filter(Number.isFinite))), gapXmean: r4(mean(evs.map((s) => s.pre?.gapX).filter(Number.isFinite))),
      gapXvsCtl: cm(evs.filter((s) => Number.isFinite(s.pre?.gapX)).map((s) => ({ issuer: s.cik, x: s.pre.gapX }))).mean },
    touch: {}, limitFill: {}, net: {}, variants: {}, path: {},
  };
  // TOUCH (historical; not a profit)
  for (const X of TARGETS) {
    const k = TKEY(X); const row = {};
    for (const W of TOUCH_W) {
      const m = { type: "touch", X, W };
      const hits = evs.map((s) => ({ issuer: s.cik, x: val(s, m) })).filter((r) => r.x != null);
      const dif = evs.map((s) => { const a = val(s, m), b = ctlVal(s, m, "volMom"); return a == null || b == null ? null : { issuer: s.cik, x: a - b, b }; }).filter(Boolean);
      const dVo = evs.map((s) => { const a = val(s, m), b = ctlVal(s, m, "volOnly"); return a == null || b == null ? null : { issuer: s.cik, x: a - b }; }).filter(Boolean);
      const h = cm(hits), dd = cm(dif), dv = cm(dVo);
      row[`w${W}`] = { n: h.n, rate: h.mean, ci95: h.ci95, ctlVolMom: r4(mean(dif.map((r) => r.b))), diffVsVolMom: dd.mean, diffCi95: dd.ci95, diffT: dd.t, diffVsVolOnly: dv.mean };
    }
    // time to target and drawdown before it (hitters within 10 sessions, windows fully observable)
    const full = evs.filter((s) => s.out.o.availTouchW >= 10);
    const hit = full.filter((s) => s.out.o.first[k] != null && s.out.o.first[k] <= 10);
    const miss = full.filter((s) => !(s.out.o.first[k] != null && s.out.o.first[k] <= 10));
    row.timeToTarget = { nFull: full.length, hitters10: hit.length, medianSession: r4(median(hit.map((s) => s.out.o.first[k]))), meanSession: r4(mean(hit.map((s) => s.out.o.first[k]))),
      ctlMedianSession: r4(median(full.map((s) => s.ctl?.volMom?.ttm?.[k]).filter(Number.isFinite))) };
    row.drawdownBeforeTarget = { medianWorstCase: r4(median(hit.map((s) => s.out.o.ddBefore[k]))), p25WorstCase: r4(quantile(hit.map((s) => s.out.o.ddBefore[k]), 0.25)),
      medianStrict: r4(median(hit.map((s) => s.out.o.ddBeforeStrict[k]))), shareDeeperThan5pct: r4(mean(hit.map((s) => (s.out.o.ddBefore[k] <= -0.05 ? 1 : 0)))) };
    row.nonHittersMae10 = r4(median(miss.map((s) => s.out.o.mae[10]).filter(Number.isFinite)));
    d.touch[k] = row;
  }
  // LIMIT-FILL approximation (BRIEF) — clearly separate from touches and from close exits
  for (const X of TARGETS) for (const N of TP_N) {
    const key = `${TKEY(X)}n${N}`;
    const xs = evs.map((s) => s.out.o.tp?.[key]).filter(Boolean);
    const rows = evs.filter((s) => s.out.o.tp?.[key]).map((s) => ({ issuer: s.cik, x: s.out.o.tp[key].x1 }));
    const c = cm(rows);
    const cdiff = evs.filter((s) => s.out.o.tp?.[key] && s.ctl?.volMom?.tp?.[key] != null).map((s) => ({ issuer: s.cik, x: s.out.o.tp[key].x1 - s.ctl.volMom.tp[key] }));
    d.limitFill[key] = { n: xs.length, fillRate: r4(mean(xs.map((x) => (x.fillS != null ? 1 : 0)))), meanNetX1: c.mean, ci95: c.ci95, medianNetX1: r4(median(rows.map((r) => r.x))), meanNetX2: r4(mean(xs.map((x) => x.x2))), diffVsVolMom: cm(cdiff).mean };
  }
  // NET executable (official open → official close, costs, minus SPY)
  for (const N of HORIZONS) {
    const rows = evs.map((s) => ({ issuer: s.cik, x: val(s, { type: "net", N }) })).filter((r) => Number.isFinite(r.x));
    if (!rows.length) { d.net[`N${N}`] = { n: 0 }; continue; }
    const cs = companyStats(rows), c = cm(rows);
    const x2 = evs.map((s) => val(s, { type: "net", N }, { mult: 2 })).filter(Number.isFinite), x3 = evs.map((s) => val(s, { type: "net", N }, { mult: 3 })).filter(Number.isFinite);
    const dif = evs.map((s) => { const a = val(s, { type: "net", N }), b = s.ctl?.volMom?.x?.[N]; return a == null || b == null ? null : { issuer: s.cik, x: a - b, b }; }).filter(Boolean);
    const g = evs.map((s) => s.out.o.gross?.[N]).filter(Number.isFinite);
    d.net[`N${N}`] = { n: cs.n, issuers: cs.issuers, meanX1: cs.mean, medianX1: cs.median, positive: cs.positive, issuerMedianOfMeans: cs.issuerMedianOfMeans, t: c.t, p: c.p, ci95: cs.ci95, meanExTop5Issuers: cs.meanExTop5Issuers,
      meanX2: r4(mean(x2)), medianX2: r4(median(x2)), meanX3: r4(mean(x3)), meanGross: r4(mean(g)), ctlVolMom: r4(mean(dif.map((r) => r.b))), diffVsVolMom: cm(dif).mean, diffT: cm(dif).t };
  }
  // variants: one-session-delay open entry; same-day close entry (published before close − 30 min)
  for (const [vk, label] of [["od", "delay1Open"], ["oc", "sameDayClose"]]) {
    const vv = {}; const el = evs.filter((s) => s.out[vk]);
    for (const N of [1, 2, 3, 5, 10]) { const rows = el.map((s) => ({ issuer: s.cik, x: val(s, { type: "net", N }, { variant: vk }) })).filter((r) => Number.isFinite(r.x)); const c = cm(rows); vv[`N${N}`] = { n: rows.length, meanX1: c.mean, medianX1: r4(median(rows.map((r) => r.x))), t: c.t }; }
    vv.touchT10W5 = r4(mean(el.map((s) => val(s, METRICS.T10W5, { variant: vk })).filter((v) => v != null)));
    d.variants[label] = { eligible: el.length, ...vv };
  }
  // path: MFE / MAE / time to the 10-session high
  for (const W of TOUCH_W) d.path[`w${W}`] = { mfeMedian: r4(median(evs.map((s) => s.out.o.mfe[W]).filter(Number.isFinite))), maeMedian: r4(median(evs.map((s) => s.out.o.mae[W]).filter(Number.isFinite))),
    maeP10: r4(quantile(evs.map((s) => s.out.o.mae[W]).filter(Number.isFinite), 0.1)), ctlMfe: r4(mean(evs.map((s) => s.ctl?.volMom?.mfe?.[W]).filter(Number.isFinite))), ctlMae: r4(mean(evs.map((s) => s.ctl?.volMom?.mae?.[W]).filter(Number.isFinite))) };
  d.path.toMaxHigh10Median = r4(median(evs.map((s) => s.out.o.toMaxHigh10).filter(Number.isFinite)));
  return d;
}
// stability across months and companies (per target, W = 2 and 5)
function stability(evs) {
  const out = {};
  for (const X of TARGETS) for (const W of [2, 5]) {
    const m = { type: "touch", X, W };
    const rows = evs.map((s) => { const a = val(s, m), b = ctlVal(s, m, "volMom"); return a == null ? null : { s, a, b }; }).filter(Boolean);
    const byM = group(rows, (r) => r.s.month);
    const months = Object.fromEntries([...byM.entries()].sort().map(([k, xs]) => [k, { n: xs.length, rate: r4(mean(xs.map((r) => r.a))), ctl: r4(mean(xs.filter((r) => r.b != null).map((r) => r.b))) }]));
    const byI = group(rows, (r) => r.s.cik);
    const hitsBy = [...byI.entries()].map(([k, xs]) => [k, xs.reduce((a, r) => a + r.a, 0), xs.length]).sort((a, b) => b[1] - a[1]);
    const totalHits = hitsBy.reduce((a, x) => a + x[1], 0);
    const top5 = new Set(hitsBy.slice(0, 5).map((x) => x[0]));
    const rest = rows.filter((r) => !top5.has(r.s.cik));
    const restDiff = rest.filter((r) => r.b != null).map((r) => ({ issuer: r.s.cik, x: r.a - r.b }));
    out[`${TKEY(X)}w${W}`] = { months, monthsAboveCtl: Object.values(months).filter((v) => v.ctl != null && v.rate > v.ctl).length, monthsN: Object.keys(months).length,
      issuers: byI.size, issuersWithHit: hitsBy.filter((x) => x[1] > 0).length, top5ShareOfHits: totalHits ? r4(hitsBy.slice(0, 5).reduce((a, x) => a + x[1], 0) / totalHits) : null,
      rateExTop5: r4(mean(rest.map((r) => r.a))), diffExTop5: cm(restDiff).mean, issuerMedianRate: r4(median(hitsBy.map((x) => x[1] / x[2]))) };
  }
  return out;
}
const tables = {};
for (const g of ["cal", "roll"]) for (const u of ["om", "allp"]) for (const p of ["discover", "confirm"]) {
  const P = pop("signals", g, u, p);
  const key = `${g}|${u}|${p}`;
  tables[key] = { buckets: {}, testBuckets: {}, exact: {} };
  for (const b of DESC_BUCKETS) { const evs = P.filter((s) => db(s.position) === b); if (evs.length) tables[key].buckets[b] = { ...describe(evs), stability: u === "om" ? stability(evs) : undefined }; }
  tables[key].testBuckets["6+"] = describe(P.filter((s) => s.position >= 6).length ? P.filter((s) => s.position >= 6) : []);
  for (const [k, evs] of group(P, (s) => s.position)) if (evs.length >= 10 && k >= 5) tables[key].exact[k] = describe(evs);
  tables[key].all = describe(P);
  if (u === "om") {
    // all-purchase baseline (every open-market filing of the period, new buyers and repeat buys)
    const allF = pop("fseq", g, "om", p);
    tables[key].allPurchaseBaseline = describe(allF);
    tables[key].repeatFilings = describe(allF.filter((s) => !s.isNew));
  }
  if (u === "allp") tables[key].byClass = Object.fromEntries(["om", "entity", "offering", "unknown"].map((c) => [c, describe(P.filter((s) => (c === "unknown" ? s.cls === "unknown" || s.cls === "unclassified" : s.cls === c)))]));
  console.log(`[tables] ${key}: ${P.length} signals; ${Date.now() - t0} ms`);
  writePretty("position-tables.json", tables); // checkpoint
}

// ---- largest purchase, interactions and trade-order (descriptive cross-tabs) ----
const calOmD = pop("signals", "cal", "om", "discover"), calOmC = pop("signals", "cal", "om", "confirm");
const lens = (evs) => ({ n: evs.length, issuers: new Set(evs.map((s) => s.cik)).size, T5W2: r4(mean(evs.map((s) => val(s, "T5W2")).filter((v) => v != null))), T10W5: r4(mean(evs.map((s) => val(s, "T10W5")).filter((v) => v != null))),
  T10W5ctl: r4(mean(evs.map((s) => ctlVal(s, "T10W5", "volMom")).filter((v) => v != null))), T20W10: r4(mean(evs.map((s) => val(s, "T20W10")).filter((v) => v != null))),
  N1: r4(mean(evs.map((s) => val(s, "N1")).filter(Number.isFinite))), N3: r4(mean(evs.map((s) => val(s, "N3")).filter(Number.isFinite))), N3med: r4(median(evs.map((s) => val(s, "N3")).filter(Number.isFinite))),
  N5: r4(mean(evs.map((s) => val(s, "N5")).filter(Number.isFinite))), gapX: r4(median(evs.map((s) => s.pre?.gapX).filter(Number.isFinite))), usdMedian: r4(median(evs.map((s) => s.usd).filter((v) => v > 0))) });
const xtab = (evs, rowF, colF) => { const out = {}; for (const [rk, xs] of group(evs, rowF)) { out[rk] = {}; for (const [ck, ys] of group(xs, colF)) out[rk][ck] = lens(ys); } return out; };
const pb3 = (s) => (s.position >= 3 ? "3+" : String(s.position));
const cross = {};
for (const [p, evs] of [["discover", calOmD], ["confirm", calOmC]]) {
  cross[p] = {
    largestSoFar: xtab(evs.filter((s) => s.position >= 2), pb3, (s) => (s.isLargestSoFar ? "largestSoFar" : "notLargest")),
    eventualLargest: xtab(evs.filter((s) => s.eventualBuyers >= 2), pb3, (s) => (s.isEventualLargest ? "eventualLargest" : "other")),
    role: xtab(evs, pb3, (s) => s.primaryRole),
    own: xtab(evs, pb3, (s) => s.own),
    escalation: xtab(evs.filter((s) => s.position >= 2), pb3, (s) => (s.ratioPrevMax >= 2 ? ">=2x prevMax" : s.ratioPrevMax >= 1 ? "1-2x" : s.ratioPrevMax >= 0.5 ? "0.5-1x" : "<0.5x")),
    pctOfPrior: xtab(evs, pb3, (s) => (!s.holdValid ? "invalid" : s.priorNearZero ? "firstPosition" : s.pctOfPrior >= 0.25 ? ">=25%" : s.pctOfPrior >= 0.05 ? "5-25%" : "<5%")),
    accumUsd: xtab(evs, pb3, (s) => (s.accumUsd >= 1e6 ? ">=1M" : s.accumUsd >= 2.5e5 ? "250k-1M" : s.accumUsd >= 5e4 ? "50-250k" : "<50k")),
    chart: xtab(evs, pb3, (s) => (s.feat == null ? "na" : s.feat.dd60 <= -0.3 ? "dd>=30%" : s.feat.breakout20 ? "breakout20" : s.feat.tight != null && s.feat.tight <= 1.2 ? "consolidation" : "other")),
    speed: xtab(evs.filter((s) => s.position >= 2), pb3, (s) => (s.daysSinceFirst <= 1 ? "<=1d" : s.daysSinceFirst <= 3 ? "1-3d" : s.daysSinceFirst <= 10 ? "3-10d" : ">10d")),
    gapCoverage: xtab(evs, pb3, (s) => (s.gapDaysInWindow ? "gapDayInWindow" : "clean")),
    insidersKnown: xtab(evs, pb3, (s) => (s.insidersKnown >= 10 ? ">=10" : s.insidersKnown >= 5 ? "5-9" : "<5")),
  };
}
// filing-level "largest single filing so far" including repeat buys
cross.filingLevel = Object.fromEntries(["discover", "confirm"].map((p) => [p, xtab(pop("fseq", "cal", "om", p).filter((s) => s.seqIndex >= 2), (s) => (s.isNew ? "newBuyer" : "repeatBuy"), (s) => (s.largestFilingSoFar ? "largestFilingSoFar" : "not"))]));
// trade-date order (descriptive, NOT tradable): outcome at the publication of each buyer's first filing in the trade month
const tro = readOut("trade-order.json").map((x) => ({ ...x, ...join(x) })).filter((x) => x.ok && x.period !== "holdout");
cross.tradeOrder = Object.fromEntries(["discover", "confirm"].map((p) => [p, { byTradePos: Object.fromEntries([...group(tro.filter((x) => x.period === p), (x) => db(x.tradePos)).entries()].map(([k, xs]) => [k, lens(xs)])),
  disagree: lens(tro.filter((x) => x.period === p && x.tradePos !== x.pubPos)), agree: lens(tro.filter((x) => x.period === p && x.buyers >= 2 && x.tradePos === x.pubPos)) }]));
writePretty("cross-tabs.json", cross);

// ---- event-level CSV (one row per position signal; both groupings, both universes, discovery + confirmation) ----
const hitCols = []; for (const X of TARGETS) for (const W of [1, 2, 3, 5, 10]) hitCols.push([`hit_${TKEY(X)}_w${W}`, X, W]);
const rowsCsv = signals.map(join).map((s) => {
  const o = s.out?.o; const r = { ...s, status: s.out ? "ok" : outc[s.acc]?.status || "missing", descBucket: db(s.position), testBucket: tb(s.position) };
  if (s.out) {
    Object.assign(r, { entryPrice: o.entry, costBps: s.out.costBps, capacityUsd: s.out.capacityUsd, asTradedEntry: s.out.asTradedEntry, splitInferred: s.out.splitInferred, suspect: s.out.suspect, availTouchW: o.availTouchW, toMaxHigh10: o.toMaxHigh10 });
    for (const [k, v] of Object.entries(s.feat || {})) r[`f_${k}`] = v;
    for (const [k, v] of Object.entries(s.pre || {})) r[`pre_${k}`] = v;
    for (const X of TARGETS) { r[`first_${TKEY(X)}`] = o.first[TKEY(X)]; r[`ddBefore_${TKEY(X)}`] = o.ddBefore[TKEY(X)]; }
    for (const [c, X, W] of hitCols) r[c] = val(s, { type: "touch", X, W });
    for (const W of [1, 3, 5, 10]) { r[`mfe_w${W}`] = o.mfe[W]; r[`mae_w${W}`] = o.mae[W]; }
    for (const N of HORIZONS) { r[`net1_N${N}`] = o.x[N]?.[0]; r[`net2_N${N}`] = o.x[N]?.[1]; r[`net3_N${N}`] = o.x[N]?.[2]; r[`gross_N${N}`] = o.gross?.[N]; r[`spy_N${N}`] = o.spyR?.[N]; }
    for (const X of TARGETS) for (const N of [2, 5, 10]) { const tp = o.tp?.[`${TKEY(X)}n${N}`]; r[`limitFill_${TKEY(X)}_N${N}_net1`] = tp?.x1; r[`limitFill_${TKEY(X)}_N${N}_fillSession`] = tp?.fillS; }
    for (const N of [1, 3, 5]) { r[`delay1_net1_N${N}`] = s.out.od?.x?.[N]?.[0]; r[`closeEntry_net1_N${N}`] = s.out.oc?.x?.[N]?.[0]; }
    for (const set of ["volMom", "volOnly", "volMomGap"]) { const C = s.ctl?.[set]; if (!C) continue; r[`ctl_${set}_n`] = C.n; r[`ctl_${set}_T5W2`] = C.hit.t5w2; r[`ctl_${set}_T10W5`] = C.hit.t10w5; r[`ctl_${set}_T20W10`] = C.hit.t20w10; for (const N of [1, 3, 5]) r[`ctl_${set}_net1_N${N}`] = C.x[N]; }
  }
  return r;
});
const baseCols = ["grouping", "universe", "period", "status", "cik", "sym", "acc", "accs", "T", "month", "position", "descBucket", "testBucket", "tieSize", "tieRank", "nBefore", "buyersSoFar", "buyers30d", "buyersHist", "insidersKnown", "prevMonthBuyers",
  "primaryRole", "roles", "role", "names", "insiderCik", "own", "cls", "clsAll", "omBasis", "plan10b5", "usd", "usdMissing", "shares", "pctOfPrior", "priorNearZero", "holdValid", "holdingsAfter",
  "ratioPrevMax", "ratioPrevMean", "prevMaxUsd", "prevMeanUsd", "accumUsdBefore", "accumUsd", "isLargestSoFar", "largestInTie", "isEventualLargest", "eventualRankUsd", "eventualBuyers", "eventualMaxPosition", "eventualBuyerMonthUsd", "eventualAccumUsd",
  "daysSinceFirst", "firstAt", "delayDays", "delayDaysFirst", "tradeDateMin", "tradeDateMax", "gapDaysInWindow", "windowTruncated", "entryDate", "entryPrice", "costBps", "capacityUsd", "asTradedEntry", "splitInferred", "suspect", "availTouchW", "toMaxHigh10"];
const extra = [...new Set(rowsCsv.flatMap((r) => Object.keys(r)).filter((k) => /^(f_|pre_|first_|ddBefore_|hit_|mfe_|mae_|net[123]_|gross_|spy_|limitFill_|delay1_|closeEntry_|ctl_)/.test(k)))];
writeOut("sequence-events.csv", toCsv(rowsCsv, [...baseCols, ...extra]));
console.log(`[csv] ${rowsCsv.length} rows × ${baseCols.length + extra.length} columns; done in ${Date.now() - t0} ms`);
