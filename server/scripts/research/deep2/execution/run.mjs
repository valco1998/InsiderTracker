// server/scripts/research/deep2/execution/run.mjs — the execution study (agent "execution").
//   node scripts/research/deep2/execution/run.mjs --phase=discover   all registered tests on DISCOVERY only
//   node scripts/research/deep2/execution/run.mjs --freeze           hash the code + discovery results (after review)
//   node scripts/research/deep2/execution/run.mjs --phase=confirm    CONFIRMATION, once (refuses if the code changed)
//   --dry with --phase=confirm: runs the confirmation code path on DISCOVERY data into dry/ and records nothing.
// Every test / simulation evaluated here was registered first by register.mjs (grid.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as X from "./execLib.mjs";
import { TESTS, PORTFOLIOS, FAMILIES, AH_GROUP_LABELS, COSTS, ENTRIES } from "./grid.mjs";
const { L, r4, pct, mean, median } = X;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || null;
const FROZEN = path.join(X.OUT, "frozen-exec.json");
const CODE = ["execLib.mjs", "grid.mjs", "run.mjs"];
const hashes = () => Object.fromEntries(CODE.map((f) => [f, X.sha256File(path.join(HERE, f))]));
const t0 = Date.now();
const log = (m) => console.log(`[EXEC ${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

if (process.argv.includes("--freeze")) {
  const f = path.join(X.OUT, "results-discover.json");
  if (!fs.existsSync(f)) throw new Error("run --phase=discover first");
  fs.writeFileSync(FROZEN, JSON.stringify({ frozenAt: new Date().toISOString(), code: hashes(), discoveryResultsSha256: L.sha256(fs.readFileSync(f, "utf8")),
    tests: TESTS.length, portfolios: PORTFOLIOS.length, note: "Execution grid frozen after reviewing discovery; confirmation is evaluated once with this exact code." }, null, 1));
  console.log(`[EXEC] frozen → ${FROZEN}`);
  process.exit(0);
}
const phase = arg("phase"), dry = process.argv.includes("--dry");
if (!["discover", "confirm"].includes(phase)) throw new Error("usage: --phase=discover | --freeze | --phase=confirm [--dry]");
if (phase === "confirm" && !dry) {
  if (!fs.existsSync(FROZEN)) throw new Error("freeze first (--freeze) after reviewing discovery");
  const fz = JSON.parse(fs.readFileSync(FROZEN, "utf8")), now = hashes();
  const changed = Object.keys(now).filter((k) => now[k] !== fz.code[k]);
  if (changed.length && !process.argv.includes("--allow-code-change")) throw new Error(`code changed since the freeze: ${changed.join(", ")}`);
}
const PERIOD = phase === "confirm" && !dry ? "confirm" : "discover"; // statistics period
const CSV_PERIOD = phase === "confirm" && !dry ? null : "discover"; // event-level CSVs: discovery only until confirmation is run
const PREFIX = dry ? "dry/" : "";
const RECORD = !dry;
// Idempotent recording: a result identical to one already recorded for the same id is not appended again
// (a re-run after a descriptive-only change leaves the results registry unchanged; changed values ARE appended).
const RES_FILE = path.join(L.DEEP2, "registry-results.jsonl");
const recorded = new Map();
if (fs.existsSync(RES_FILE)) for (const line of fs.readFileSync(RES_FILE, "utf8").split("\n")) { if (!line.trim()) continue; try { const j = JSON.parse(line); if (j.agent === X.AGENT) (recorded.get(j.id) || recorded.set(j.id, new Set()).get(j.id)).add(JSON.stringify(j.result)); } catch { /* partial line from another agent */ } }
const recordOnce = (id, result) => { const k = JSON.stringify(result); if (recorded.get(id)?.has(k)) return false; X.record(id, result); (recorded.get(id) || recorded.set(id, new Set()).get(id)).add(k); return true; };

// ------------------------------------------------------------------------------------------------
const E = L.loadEvents();
const TRIG = Object.keys(X.TRIGGERS);
const trigEvents = Object.fromEntries(TRIG.map((k) => [k, E.filter(X.TRIGGERS[k].f)]));
const ahEvents = E.filter((e) => X.loadAh().trades.has(e.id));
const groupEvents = (g) => (g === "G0_pooled" ? ahEvents : ahEvents.filter((e) => X.ahStratum(e) === g));
const flags = (e) => Object.fromEntries(TRIG.map((k) => [k, X.TRIGGERS[k].f(e) ? 1 : 0]));
log(`phase ${phase}${dry ? " (dry)" : ""}: statistics period = ${PERIOD}; events ${E.length}; after-hours sample ${ahEvents.length}`);

const slim = (s) => (s && s.n ? { n: s.n, issuers: s.issuers, mean: s.mean, median: s.median, issuerMedianOfMeans: s.issuerMedianOfMeans, positive: s.positive, issuersPositive: s.issuersPositive,
  t: s.t, p: s.p, meanExTop5Issuers: s.meanExTop5Issuers, ci95: s.ci95, wmean: s.wmean, meanGross: s.meanGross, meanSpy: s.meanSpy, meanExcessGross: s.meanExcessGross, medianExcessGross: s.medianExcessGross,
  meanNet: s.meanNet, meanRoundTripCostBps: s.meanRoundTripCostBps, meanA: s.meanA, meanB: s.meanB } : { n: 0 });

function pairDelay(trig, N) {
  const a = X.evaluate(trigEvents[trig], { entry: "nextOpen", exitSessions: N, period: PERIOD });
  const b = X.evaluate(trigEvents[trig], { entry: "nextOpen", delaySessions: 1, exitSessions: N, period: PERIOD });
  const bm = new Map(b.ok.map((r) => [r.id, r]));
  const rows = a.ok.filter((r) => bm.has(r.id)).map((r) => ({ id: r.id, issuerCik: r.issuerCik, a: r.excess, b: bm.get(r.id).excess, x: r.excess - bm.get(r.id).excess }));
  const s = L.companyStats(rows.map((r) => ({ issuer: r.issuerCik, x: r.x })));
  return { stats: { ...s, meanA: r4(mean(rows.map((r) => r.a))), meanB: r4(mean(rows.map((r) => r.b))) }, rows };
}
function mocGapRows(trig, period) {
  const out = [], spy = X.series("SPY");
  for (const e of trigEvents[trig]) {
    const D = e.publishedAt.slice(0, 10), t = e.publishedAt.slice(11, 19);
    if (!X.isSession(D) || t < "09:30:00" || !(t < X.mocCutoff(D))) continue;
    const s = X.series(X.symOf(e.ticker)), bD = X.bar(s, D), bE = X.bar(s, e.entryDate), sD = X.bar(spy, D), sE = X.bar(spy, e.entryDate);
    if (!bD || !bE || !sD || !sE) continue;
    const row = { id: e.id, issuerCik: e.issuerCik, ticker: e.ticker, publishedAt: e.publishedAt, period: L.periodOf(e), exitDate: e.entryDate, closeD: bD.c, openNext: bE.o, gap: bE.o / bD.c - 1, spyGap: sE.o / sD.c - 1 };
    row.x = row.gap - row.spyGap;
    if (X.periodOk(row, period)) out.push(row);
  }
  return out;
}
function mocGap(trig) {
  const rows = mocGapRows(trig, PERIOD);
  return { stats: { ...L.companyStats(rows.map((r) => ({ issuer: r.issuerCik, x: r.x }))), meanA: r4(mean(rows.map((r) => r.gap))), meanB: r4(mean(rows.map((r) => r.spyGap))) }, rows };
}
function runTest(t) {
  if (t.kind === "eval") {
    const r = X.evaluate(trigEvents[t.trig], { ...t.opts, period: PERIOD });
    const s = r.stats;
    const breakEven = t.opts.costModel === "tier" && t.opts.costMultiplier === 1 && s.n && s.meanRoundTripCostBps > 0 ? r4(s.meanExcessGross / (s.meanRoundTripCostBps / 1e4)) : null;
    return { stats: s, statusCounts: r.statusCounts, belowCapacity: r.belowCapacity, breakEvenCostMultiple: breakEven, okRows: r.ok };
  }
  if (t.kind === "ah") { const r = X.evaluate(groupEvents(t.group), { ...t.opts, period: PERIOD }); return { stats: r.stats, statusCounts: r.statusCounts, okRows: r.ok }; }
  if (t.kind === "pairDelay") return pairDelay(t.trig, t.N);
  if (t.kind === "mocGap") return mocGap(t.trig);
  throw new Error(`unknown kind ${t.kind}`);
}

// ------------------------------------------------------------------------------------------------
// 1. All registered tests on the statistics period.
const results = [];
for (const t of TESTS) {
  const r = runTest(t);
  results.push({ id: t.id, family: t.family, kind: t.kind, trig: t.trig ?? null, group: t.group ?? null, N: t.N ?? t.opts?.exitSessions ?? null, opts: t.opts ?? null,
    stats: slim(r.stats), statusCounts: r.statusCounts ?? null, belowCapacity: r.belowCapacity ?? null, breakEvenCostMultiple: r.breakEvenCostMultiple ?? null, _rows: r.okRows || r.rows || [] });
}
const qAll = L.bhQ(results.map((r) => r.stats.p ?? null));
results.forEach((r, i) => (r.qAll = r4(qAll[i])));
for (const fam of new Set(results.map((r) => r.family))) {
  const rs = results.filter((r) => r.family === fam), q = L.bhQ(rs.map((r) => r.stats.p ?? null));
  rs.forEach((r, i) => (r.qFamily = r4(q[i])));
}
let newRecords = 0;
if (RECORD) for (const r of results) if (recordOnce(r.id, { period: PERIOD, ...r.stats, qAllExecutionTests: r.qAll, qFamily: r.qFamily, breakEvenCostMultiple: r.breakEvenCostMultiple, statusCounts: r.statusCounts })) newRecords++;
log(`tests evaluated: ${results.length}; with p-values: ${results.filter((r) => r.stats.p != null).length}`);
const R = Object.fromEntries(results.map((r) => [r.id, r]));

// 2. Portfolio simulations (descriptive).
const portfolios = [];
for (const p of PORTFOLIOS) {
  const events = p.ahOnly ? ahEvents.filter((e) => X.ahStratum(e) === "S1_ceoCfoOM250k") : trigEvents[p.trig];
  const r = X.evaluate(events, { ...p.opts, period: PERIOD, slots: p.sim.slots, accountSize: p.sim.accountSize ?? null });
  const pf = r.portfolio || { signals: 0, trades: 0 };
  portfolios.push({ id: p.id, trig: p.trig, opts: p.opts, sim: p.sim, ...pf });
  if (RECORD) { const { curve, months, ...rest } = pf; if (recordOnce(p.id, { period: PERIOD, descriptive: true, ...rest })) newRecords++; }
}
log(`portfolio simulations: ${portfolios.length}; new registry result records: ${newRecords}`);

// ------------------------------------------------------------------------------------------------
// 3. Descriptive tables (no new tests).
const desc = {};
// 3a. Capacity: share of events (statistics period, next-open entry, N = 2 usable) supporting a position size at 1% of ADV20.
desc.capacity = Object.fromEntries(TRIG.map((k) => {
  const rows = X.evaluate(trigEvents[k], { entry: "nextOpen", exitSessions: 2, period: PERIOD }).ok;
  const share = (usd) => r4(rows.filter((r) => (r.capacityUsd ?? 0) >= usd).length / rows.length);
  return [k, { n: rows.length, medianAdv20: Math.round(median(rows.map((r) => r.adv20 ?? 0))), medianMaxPositionUsd: Math.round(median(rows.map((r) => r.capacityUsd ?? 0))),
    support10k: share(1e4), support50k: share(5e4), support250k: share(2.5e5) }];
}));
// 3b. Spread model calibration: as-traded price buckets, tier vs spread-model cost, Abdi–Ranaldo half-spread estimate (60 sessions before entry).
{
  const rows = X.evaluate(E, { entry: "nextOpen", exitSessions: 2, costModel: "spread", period: PERIOD }).ok;
  const evById = new Map(E.map((e) => [e.id, e]));
  const buckets = [["< $1", 0, 1], ["$1–2", 1, 2], ["$2–5", 2, 5], ["$5–10", 5, 10], ["$10–20", 10, 20], ["$20–50", 20, 50], ["≥ $50", 50, Infinity]];
  desc.spreadCalibration = buckets.map(([label, lo, hi]) => {
    const rs = rows.filter((r) => r.asTradedEntry >= lo && r.asTradedEntry < hi);
    const ar = rs.map((r) => X.abdiRanaldoSpread(X.series(r.sym), r.entryDate, 60)).filter((x) => x != null);
    const adjBucket = rs.filter((r) => !(r.entryPrice >= lo && r.entryPrice < hi)).length;
    return { bucket: label, n: rs.length, shareOfEvents: r4(rs.length / rows.length), meanTierBpsPerSide: Math.round(mean(rs.map((r) => evById.get(r.id).costBpsPerSide)) || 0),
      spreadModelBpsPerSide: Math.round(mean(rs.map((r) => r.costIn * 1e4)) || 0), abdiRanaldoMedianHalfSpreadBps: ar.length ? Math.round((median(ar) / 2) * 1e4) : null, arN: ar.length,
      medianAdv20: Math.round(median(rs.map((r) => r.adv20 ?? 0)) || 0), bucketDiffersOnAdjustedPrice: adjBucket };
  });
}
// 3c. MOC entry split by publication time (descriptive, tier ×1).
desc.mocByBucket = Object.fromEntries(TRIG.map((k) => [k, Object.fromEntries(X.HORIZONS_B.map((N) => {
  const ok = X.evaluate(trigEvents[k], { entry: "sameDayClose", exitSessions: N, period: PERIOD }).ok;
  const by = (b) => { const xs = ok.filter((r) => r.pubBucket === b).map((r) => r.excessNet); return { n: xs.length, mean: r4(mean(xs)), median: r4(median(xs)) }; };
  return [N, { premarket: by("premarket_04_0930"), intraday: by("regular_0930_close") }];
}))]));
// 3d. After-hours: latency decay on the common subsample, liquidity limits, population-weighted estimate, first-trade timing.
{
  const LAT = [1, 5, 15, 30];
  const ahRows = (es, lat, ex) => new Map(X.evaluate(es, { entry: "ah", latencyMinutes: lat, exitSessions: ex, costModel: 0, period: PERIOD }).rows.map((r) => [r.id, r]));
  const decay = {}, capacity = {}, timing = {};
  for (const g of Object.keys(AH_GROUP_LABELS)) {
    const es = groupEvents(g);
    const M = {}; for (const lat of LAT) for (const ex of ["nextOpen", "nextClose"]) M[`${lat}|${ex}`] = ahRows(es, lat, ex);
    const usable = (r) => r && r.status === "ok" && X.periodOk(r, PERIOD);
    const common = es.filter((e) => LAT.every((lat) => usable(M[`${lat}|nextOpen`].get(e.id)) && usable(M[`${lat}|nextClose`].get(e.id))));
    decay[g] = { commonN: common.length, commonIssuers: new Set(common.map((e) => e.issuerCik)).size, byLatency: LAT.map((lat) => {
      const o = common.map((e) => M[`${lat}|nextOpen`].get(e.id)), c = common.map((e) => M[`${lat}|nextClose`].get(e.id));
      const all = es.map((e) => M[`${lat}|nextOpen`].get(e.id)).filter(usable);
      return { latencyMin: lat, medianMinutesAfterAcceptance: r4(median(o.map((r) => r.minutesAfterAcceptance))), entryVsCloseMean: r4(mean(o.map((r) => r.entryVsClose))), entryVsCloseMedian: r4(median(o.map((r) => r.entryVsClose))),
        nextOpenVsCloseMean: r4(mean(o.map((r) => r.nextOpenVsClose))), toOpenExcessMean: r4(mean(o.map((r) => r.excess))), toOpenExcessMedian: r4(median(o.map((r) => r.excess))),
        toCloseExcessMean: r4(mean(c.map((r) => r.excess))), toCloseExcessMedian: r4(median(c.map((r) => r.excess))), allAvailableN: all.length, allAvailableToOpenMean: r4(mean(all.map((r) => r.excess))),
        statusInPeriod: es.filter((e) => L.periodOf(e) === PERIOD).map((e) => M[`${lat}|nextOpen`].get(e.id)).reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}) };
    }) };
    const r1 = es.map((e) => M[`1|nextOpen`].get(e.id)).filter(usable);
    const sh = (k, usd) => r4(r1.filter((r) => (r[k] ?? 0) >= usd).length / r1.length);
    capacity[g] = { n: r1.length, medianAhUsd5: Math.round(median(r1.map((r) => r.ahUsd5 ?? 0))), medianAhUsd15: Math.round(median(r1.map((r) => r.ahUsd15 ?? 0))),
      medianBuyable5: Math.round(median(r1.map((r) => r.ahBuyable5 ?? 0))), medianBuyable15: Math.round(median(r1.map((r) => r.ahBuyable15 ?? 0))),
      buyable5AtLeast10k: sh("ahBuyable5", 1e4), buyable15AtLeast10k: sh("ahBuyable15", 1e4), buyable15AtLeast50k: sh("ahBuyable15", 5e4), lowerBoundWindows: r1.filter((r) => r.ahWindowLowerBound).length };
    const inPer = es.filter((e) => L.periodOf(e) === PERIOD);
    timing[g] = { sampledInPeriod: inPer.length, withAnyEligibleTrade: inPer.filter((e) => (X.loadAh().trades.get(e.id)?.trades || []).length > 0).length,
      medianMinutesToFirstTrade: r4(median(r1.map((r) => r.minutesAfterAcceptance))) };
  }
  // Population-weighted (inverse sampling fraction within the statistics period) gross capture, L = 1.
  const pool = E.filter((e) => X.inAhPool(e) && L.periodOf(e) === PERIOD);
  const w = {}; for (const s of ["S1_ceoCfoOM250k", "S2_otherOM", "S3_notOM"]) { const P = pool.filter((e) => X.ahStratum(e) === s).length, S = ahEvents.filter((e) => X.ahStratum(e) === s && L.periodOf(e) === PERIOD).length; w[s] = { pool: P, sample: S, weight: S ? P / S : null }; }
  const weighted = (ex) => { const rs = [...ahRows(ahEvents, 1, ex).values()].filter((r) => r.status === "ok" && X.periodOk(r, PERIOD)); let sw = 0, sx = 0; for (const r of rs) { const ww = w[r.ahStratum].weight || 0; sw += ww; sx += ww * r.excess; } return { n: rs.length, weightedMeanExcess: r4(sx / sw) }; };
  desc.afterHours = { decay, capacity, timing, strataWeights: w, populationWeightedGross: { toNextOpen: weighted("nextOpen"), toNextClose: weighted("nextClose") } };
}
// 3e. Track A variants that cannot be measured with cached data: event counts by publication time (statistics period).
{
  const inP = E.filter((e) => L.periodOf(e) === PERIOD);
  const pool = inP.filter(X.inAhPool), sampled = pool.filter((e) => X.loadAh().trades.has(e.id));
  const by = (f) => Object.fromEntries(TRIG.map((k) => [k, inP.filter((e) => X.TRIGGERS[k].f(e) && f(e)).length]));
  const B = (e) => X.pubBucket(e);
  desc.trackACoverage = {
    period: PERIOD, events: inP.length,
    measured_MOO_MOC_firstSession: by(() => true),
    measured_afterHours_cachedSample: by((e) => X.loadAh().trades.has(e.id)),
    needsTrades_afterClose_notSampled: by((e) => X.inAhPool(e) && !X.loadAh().trades.has(e.id)),
    needsTrades_afterClose_1955_2000: by((e) => B(e) === "afterClose_close_20" && e.publishedAt.slice(11) >= "19:55:00"),
    needsMinuteData_regularSessionEntry_intradayFilings: by((e) => B(e) === "regular_0930_close"),
    needsPremarketTrades_premarketFilings_0400_0930: by((e) => B(e) === "premarket_04_0930"),
    needsPremarketTrades_overnightFilings_20_24: by((e) => B(e) === "overnight_20_24"),
    needsPremarketTrades_nonSessionDayFilings: by((e) => B(e) === "nonSessionDay"),
    needsMinuteData_stopsTargets_allEvents: by(() => true),
    afterClosePool: pool.length, afterCloseSampled: sampled.length,
    bucketCountsAll: inP.reduce((m, e) => ((m[B(e)] = (m[B(e)] || 0) + 1), m), {}),
  };
}

// ------------------------------------------------------------------------------------------------
// 4. Event-level CSVs.
const csvOk = (r) => r && r.status === "ok" && X.periodOk(r, CSV_PERIOD);
const BASE_COLS = ["id", "issuerCik", "ticker", "issuerName", "insider", "role", "publishedAt", "period", "pubBucket", ...TRIG, "suspectSymbol", "costBpsTier", "adjFactorInferred"];
const baseOf = (e, r) => ({ id: e.id, issuerCik: e.issuerCik, ticker: e.ticker, issuerName: e.issuerName, insider: e.insider, role: e.role, publishedAt: e.publishedAt, period: r.period, pubBucket: r.pubBucket, ...flags(e),
  suspectSymbol: r.suspectSymbol ? 1 : 0, costBpsTier: e.costBpsPerSide, adjFactorInferred: r.adjFactorInferred ? 1 : 0 });
{ // Track B, one row per event × entry type; columns per horizon.
  const rows = [];
  for (const [ek, ev] of Object.entries(ENTRIES)) {
    const M = {}; for (const N of X.HORIZONS_B) for (const ck of Object.keys(COSTS)) M[`${N}|${ck}`] = new Map(X.evaluate(E, { entry: ev.entry, delaySessions: ev.delaySessions, exitSessions: N, ...COSTS[ck] }).rows.map((r) => [r.id, r]));
    for (const e of E) {
      const r0 = X.HORIZONS_B.map((N) => M[`${N}|tier1`].get(e.id)).find(csvOk);
      if (!r0) continue;
      const row = { entryType: ek, ...baseOf(e, r0), entryDate: r0.entryDate, entryWhen: r0.entryWhen, entryPrice: r0.entryPrice, asTradedEntry: r0.asTradedEntry, entryVolume: r0.entryVolume, adv20: r0.adv20, maxPositionUsd1pct: r0.capacityUsd };
      for (const N of X.HORIZONS_B) {
        const r = M[`${N}|tier1`].get(e.id); row[`usable_${N}`] = csvOk(r) ? 1 : 0; if (!csvOk(r)) continue;
        Object.assign(row, { [`exitDate_${N}`]: r.exitDate, [`exitPrice_${N}`]: r.exitPrice, [`exitVolume_${N}`]: r.exitVolume, [`gross_${N}`]: r.gross, [`spy_${N}`]: r.spyRet, [`excess_${N}`]: r.excess });
        for (const ck of Object.keys(COSTS)) row[`exNet_${ck}_${N}`] = M[`${N}|${ck}`].get(e.id).excessNet;
        const sp = M[`${N}|spread`].get(e.id); row[`spreadRoundTripBps_${N}`] = Math.round((sp.costIn + sp.costOut) * 1e4);
      }
      rows.push(row);
    }
  }
  const cols = ["entryType", ...BASE_COLS, "entryDate", "entryWhen", "entryPrice", "asTradedEntry", "entryVolume", "adv20", "maxPositionUsd1pct",
    ...X.HORIZONS_B.flatMap((N) => [`usable_${N}`, `exitDate_${N}`, `exitPrice_${N}`, `exitVolume_${N}`, `gross_${N}`, `spy_${N}`, `excess_${N}`, ...Object.keys(COSTS).map((ck) => `exNet_${ck}_${N}`), `spreadRoundTripBps_${N}`])];
  X.writeOut(`${PREFIX}events-trackB-${phase}.csv`, X.toCsv(rows, cols));
  log(`events-trackB CSV rows ${rows.length}`);
}
{ // Track A MOO→MOC.
  const M = Object.fromEntries(Object.keys(COSTS).map((ck) => [ck, new Map(X.evaluate(E, { entry: "mooMoc", ...COSTS[ck] }).rows.map((r) => [r.id, r]))]));
  const rows = [];
  for (const e of E) {
    const r = M.tier1.get(e.id); if (!csvOk(r)) continue;
    rows.push({ ...baseOf(e, r), entryDate: r.entryDate, open: r.entryPrice, close: r.exitPrice, asTradedEntry: r.asTradedEntry, volume: r.entryVolume, adv20: r.adv20, maxPositionUsd1pct: r.capacityUsd, gross: r.gross, spyOpenToClose: r.spyRet, excess: r.excess,
      ...Object.fromEntries(Object.keys(COSTS).map((ck) => [`exNet_${ck}`, M[ck].get(e.id).excessNet])) });
  }
  X.writeOut(`${PREFIX}events-trackA-mooMoc-${phase}.csv`, X.toCsv(rows, [...BASE_COLS, "entryDate", "open", "close", "asTradedEntry", "volume", "adv20", "maxPositionUsd1pct", "gross", "spyOpenToClose", "excess", ...Object.keys(COSTS).map((ck) => `exNet_${ck}`)]));
}
{ // Track A after-hours (cached sample; gross; subtract 2 × scenario cost for net).
  const LAT = [1, 5, 15, 30];
  const M = {}; for (const lat of LAT) for (const ex of ["nextOpen", "nextClose"]) M[`${lat}|${ex}`] = new Map(X.evaluate(ahEvents, { entry: "ah", latencyMinutes: lat, exitSessions: ex, costModel: 0 }).rows.map((r) => [r.id, r]));
  const rows = [];
  for (const e of ahEvents) {
    if (L.periodOf(e) === "holdout") continue;
    const r1 = M["1|nextOpen"].get(e.id);
    const anyOk = LAT.some((lat) => csvOk(M[`${lat}|nextOpen`].get(e.id)));
    if (!anyOk && !(CSV_PERIOD == null || L.periodOf(e) === CSV_PERIOD)) continue;
    const row = { ...baseOf(e, { period: L.periodOf(e), pubBucket: X.pubBucket(e), suspectSymbol: X.SUSPECT_SYMBOLS.has(X.symOf(e.ticker)), adjFactorInferred: false }), stratum: X.ahStratum(e), status_L1: r1.status };
    if (csvOk(r1)) Object.assign(row, { closePubRaw: r1.closePubRaw, splitFactor: r1.splitFactor, nextOpenVsClose: r1.nextOpenVsClose, nextDate: r1.exitDate, ahUsd5: r1.ahUsd5, ahUsd15: r1.ahUsd15, ahBuyable5: r1.ahBuyable5, ahBuyable15: r1.ahBuyable15, ahWindowLowerBound: r1.ahWindowLowerBound ? 1 : 0, adv20: r1.adv20 });
    for (const lat of LAT) {
      const o = M[`${lat}|nextOpen`].get(e.id), c = M[`${lat}|nextClose`].get(e.id);
      row[`status_L${lat}`] = o.status; if (!csvOk(o)) continue;
      Object.assign(row, { [`minutes_L${lat}`]: o.minutesAfterAcceptance, [`entryRaw_L${lat}`]: o.entryRaw, [`entryVsClose_L${lat}`]: o.entryVsClose, [`excessToOpen_L${lat}`]: o.excess, [`excessToClose_L${lat}`]: csvOk(c) ? c.excess : null, [`spyToOpen`]: o.spyRet });
    }
    rows.push(row);
  }
  X.writeOut(`${PREFIX}events-trackA-afterHours-${phase}.csv`, X.toCsv(rows, [...BASE_COLS, "stratum", "closePubRaw", "splitFactor", "nextOpenVsClose", "nextDate", "spyToOpen", "adv20", "ahUsd5", "ahUsd15", "ahBuyable5", "ahBuyable15", "ahWindowLowerBound",
    ...LAT.flatMap((lat) => [`status_L${lat}`, `minutes_L${lat}`, `entryRaw_L${lat}`, `entryVsClose_L${lat}`, `excessToOpen_L${lat}`, `excessToClose_L${lat}`])]));
}
{ // MOC overnight gap rows (paired family).
  const rows = []; for (const k of TRIG) for (const r of mocGapRows(k, CSV_PERIOD)) if (k === "T1_all") rows.push({ ...r, ...flags(E.find((e) => e.id === r.id)) });
  X.writeOut(`${PREFIX}events-mocGap-${phase}.csv`, X.toCsv(rows, ["id", "issuerCik", "ticker", "publishedAt", "period", "exitDate", "closeD", "openNext", "gap", "spyGap", "x", ...TRIG]));
}
{ // Portfolio summaries + equity curves.
  const cols = ["id", "trig", "signals", "trades", "skippedSlots", "skippedIssuerHeld", "skippedNoCash", "skippedBelowMinNotional", "start", "end", "sessions", "totalReturn", "cagrLike", "maxDrawdown", "worstMonth", "worstMonthRet", "worstDay",
    "meanConcurrency", "maxConcurrency", "demandMeanConcurrency", "demandMaxConcurrency", "meanExposure", "turnoverAnnualOneWay", "meanPositionWeight", "tradeWinRate", "meanTradePnl", "spyTotalReturn", "spyCagrLike", "spyMaxDrawdown", "spyWorstMonth", "excessVsSpy"];
  const flat = portfolios.map((p) => ({ ...p, skippedSlots: p.skipped?.slotsFull, skippedIssuerHeld: p.skipped?.issuerHeld, skippedNoCash: p.skipped?.noCash || 0, skippedBelowMinNotional: p.skipped?.belowMinNotional || 0, worstMonth: p.worstMonth?.month, worstMonthRet: p.worstMonth?.ret,
    spyTotalReturn: p.spy?.totalReturn, spyCagrLike: p.spy?.cagrLike, spyMaxDrawdown: p.spy?.maxDrawdown, spyWorstMonth: p.spy?.worstMonth?.ret }));
  X.writeOut(`${PREFIX}portfolio-summary-${phase}.csv`, X.toCsv(flat, cols));
  const curves = []; for (const p of portfolios) for (const [d, eq, n, spy] of p.curve || []) curves.push({ id: p.id, date: d, equity: eq, openPositions: n, spyBuyHold: spy });
  X.writeOut(`${PREFIX}portfolio-curves-${phase}.csv`, X.toCsv(curves, ["id", "date", "equity", "openPositions", "spyBuyHold"]));
}

// ------------------------------------------------------------------------------------------------
// 5. Case studies for the most promising positive tests (winners / losers with pre-entry chart context).
const evById = new Map(E.map((e) => [e.id, e]));
// Primary specifications only (tier ×1 / 50 bps), one per trigger-or-stratum × entry × size, robustness families excluded.
const seenCase = new Set();
const promising = results.filter((r) => ["execution-B-grid", "execution-A-mooMoc", "execution-A-ah", "execution-B-capacity"].includes(r.family))
  .filter((r) => (r.kind === "ah" ? r.opts.costModel === 50 : r.opts.costModel === "tier" && r.opts.costMultiplier === 1))
  .filter((r) => r.stats.n >= 20 && r.stats.mean > 0).sort((a, b) => (a.stats.p ?? 1) - (b.stats.p ?? 1))
  .filter((r) => { const k = `${r.trig ?? r.group}|${r.opts.entry}|${r.opts.delaySessions ?? 0}`; if (seenCase.has(k)) return false; seenCase.add(k); return true; }).slice(0, 6);
const cases = promising.map((r) => {
  const rows = [...r._rows].sort((a, b) => b.excessNet - a.excessNet);
  const view = (x) => { const e = evById.get(x.id); return { ticker: e.ticker, publishedAt: e.publishedAt, insider: e.insider, role: e.role, filingValue: Math.round(e.filingValue), venue: e.venue,
    ret20Before: r4(e.ret20), ret60Before: r4(e.ret60), dd60: r4(e.dd60), volSpike5_60: r4(e.volumeSpike5_60), entryGapVsPrevClose: e.decisionClose ? r4(x.entryWhen === "open" ? x.entryPrice / e.decisionClose - 1 : null) : null,
    asTradedEntry: r4(x.asTradedEntry), adv20: Math.round(x.adv20 || 0), gross: r4(x.gross), excessNet: r4(x.excessNet), exitDate: x.exitDate }; };
  return { id: r.id, stats: r.stats, winners: rows.slice(0, 10).map(view), losers: rows.slice(-10).reverse().map(view) };
});

// ------------------------------------------------------------------------------------------------
// 6. Save + markdown tables.
const clean = results.map(({ _rows, ...r }) => r);
const resultsFile = X.writeOut(`${PREFIX}results-${phase}.json`, { phase, dry, statisticsPeriod: PERIOD, generatedAt: new Date().toISOString(), families: FAMILIES, code: hashes(),
  tests: clean, portfolios: portfolios.map(({ curve, ...p }) => p), descriptive: desc, cases });
log(`saved ${resultsFile}`);

const fmtP = (p) => (p == null ? "—" : p < 0.001 ? "<0.001" : p.toFixed(3));
const md = [];
const T = (head, rows) => { md.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`), ""); };
const S = (id) => R[id]?.stats || { n: 0 };
md.push(`# Execution study — ${PERIOD.toUpperCase()} period tables (${new Date().toISOString().slice(0, 10)})`, "",
  `Statistic = per-event net excess return vs SPY (issuer-clustered t; q = Benjamini–Hochberg over all ${results.filter((r) => r.stats.p != null).length} execution tests). Discovery: published < 2026-06-15 with exit < 2026-06-15; confirmation: 2026-06-15 → 2026-08-31 with exit < 2026-09-01.`, "");
md.push("## Track B — entry × horizon × cost", "");
for (const k of TRIG) {
  md.push(`### ${k}: ${X.TRIGGERS[k].label}`, "");
  const rows = [];
  for (const ek of Object.keys(ENTRIES)) for (const N of X.HORIZONS_B) {
    const b = `execution-B-${k}-${ek}-h${N}-`, s1 = S(`${b}tier1`);
    rows.push([ek, N, `${s1.n}/${s1.issuers ?? 0}`, pct(s1.meanExcessGross), `${pct(s1.mean)} (${pct(s1.median)})`, pct(s1.issuerMedianOfMeans), s1.t ?? "—", fmtP(s1.p), fmtP(R[`${b}tier1`]?.qAll), pct(s1.meanExTop5Issuers),
      s1.ci95 ? `[${pct(s1.ci95[0])}, ${pct(s1.ci95[1])}]` : "—", pct(S(`${b}tier2`).mean), pct(S(`${b}tier3`).mean), pct(S(`${b}spread`).mean), R[`${b}tier1`]?.breakEvenCostMultiple?.toFixed(2) ?? "—"]);
  }
  T(["entry", "N", "n/issuers", "gross excess", "net ×1 mean (median)", "issuer-median", "t", "p", "q(all)", "ex-top5", "CI95 ×1", "net ×2", "net ×3", "net spread", "break-even ×"], rows);
}
md.push("## Track B — paired execution comparisons", "", "Delay cost = gross excess(next open) − gross excess(one-session-delayed open), same events and N. MOC gap = intraday filings (09:30–15:30): stock − SPY return from the same-day close to the next open (what a MOC entry captures before the next-open entry).", "");
T(["trigger", "delay N=2", "N=3", "N=4", "N=5", "MOC gap mean (median) [n, t, p]"], TRIG.map((k) => [k, ...X.HORIZONS_B.map((N) => { const s = S(`execution-Bpair-${k}-delayCost-h${N}`); return `${pct(s.mean)} (t ${s.t ?? "—"})`; }),
  (() => { const s = S(`execution-Bpair-${k}-mocGap`); return `${pct(s.mean)} (${pct(s.median)}) [${s.n}, ${s.t ?? "—"}, ${fmtP(s.p)}]`; })()]));
md.push("## Capacity (1% of 20-session dollar volume)", "");
T(["trigger", "n", "median ADV20", "median max position", "≥ $10k", "≥ $50k", "≥ $250k"], TRIG.map((k) => { const c = desc.capacity[k]; return [k, c.n, `$${(c.medianAdv20 / 1e6).toFixed(2)}M`, `$${Math.round(c.medianMaxPositionUsd / 1e3)}k`, pct(c.support10k, 1), pct(c.support50k, 1), pct(c.support250k, 1)]; }));
T(["trigger", "size", ...X.HORIZONS_B.map((N) => `N=${N}: n, net ×1 (t)`)], TRIG.flatMap((k) => ["10k", "50k", "250k"].map((sz) => [k, sz, ...X.HORIZONS_B.map((N) => { const s = S(`execution-Bcap-${k}-${sz}-h${N}`); return `${s.n}, ${pct(s.mean)} (${s.t ?? "—"})`; })])));
md.push("## Track A — MOO→MOC on the first session", "");
T(["trigger", "n/issuers", "gross excess", "net ×1 mean (median)", "t", "p", "q(all)", "ex-top5", "net ×2", "net ×3", "net spread", "break-even ×"], TRIG.map((k) => {
  const b = `execution-Amoc-${k}-`, s = S(`${b}tier1`);
  return [k, `${s.n}/${s.issuers ?? 0}`, pct(s.meanExcessGross), `${pct(s.mean)} (${pct(s.median)})`, s.t ?? "—", fmtP(s.p), fmtP(R[`${b}tier1`]?.qAll), pct(s.meanExTop5Issuers), pct(S(`${b}tier2`).mean), pct(S(`${b}tier3`).mean), pct(S(`${b}spread`).mean), R[`${b}tier1`]?.breakEvenCostMultiple?.toFixed(2) ?? "—"];
}));
md.push("## Track A — after-hours entry (cached sample)", "");
T(["group", "latency", "exit", "n/issuers", "gross excess mean (median)", "net 25bps", "net 50bps (t, p, q)", "net 100bps"], Object.keys(AH_GROUP_LABELS).flatMap((g) => [1, 5, 15, 30].flatMap((lat) => ["nextOpen", "nextClose"].map((ex) => {
  const b = `execution-Aah-${g}-L${lat}-${ex}-c`, s25 = S(`${b}25`), s50 = S(`${b}50`), s100 = S(`${b}100`);
  return [g, `${lat} min`, ex, `${s50.n}/${s50.issuers ?? 0}`, `${pct(s50.meanExcessGross)} (${pct(s50.medianExcessGross)})`, pct(s25.mean), `${pct(s50.mean)} (${s50.t ?? "—"}, ${fmtP(s50.p)}, ${fmtP(R[`${b}50`]?.qAll)})`, pct(s100.mean)];
}))));
md.push("### Latency decay (gross, vs SPY; common subsample with a valid entry at every latency)", "");
T(["group", "common n", "latency", "median min after acceptance", "entry vs 16:00 close (mean)", "→ next open: mean (median)", "→ next close: mean (median)", "all-available n / mean → open"], Object.entries(desc.afterHours.decay).flatMap(([g, d]) => d.byLatency.map((x) => [g, d.commonN, `${x.latencyMin} min`, x.medianMinutesAfterAcceptance, pct(x.entryVsCloseMean),
  `${pct(x.toOpenExcessMean)} (${pct(x.toOpenExcessMedian)})`, `${pct(x.toCloseExcessMean)} (${pct(x.toCloseExcessMedian)})`, `${x.allAvailableN} / ${pct(x.allAvailableToOpenMean)}`])));
md.push("### After-hours liquidity (10% of the dollar volume traded in the first 5 / 15 minutes after acceptance + 60 s)", "");
T(["group", "n", "median AH $ 5 min", "median AH $ 15 min", "median buyable 5 min", "median buyable 15 min", "buyable5 ≥ $10k", "buyable15 ≥ $10k", "buyable15 ≥ $50k", "truncated windows"], Object.entries(desc.afterHours.capacity).map(([g, c]) => [g, c.n, `$${c.medianAhUsd5}`, `$${c.medianAhUsd15}`, `$${c.medianBuyable5}`, `$${c.medianBuyable15}`, pct(c.buyable5AtLeast10k, 1), pct(c.buyable15AtLeast10k, 1), pct(c.buyable15AtLeast50k, 1), c.lowerBoundWindows]));
md.push(`Population-weighted gross capture of all after-close filings (L = 1 min): → next open ${pct(desc.afterHours.populationWeightedGross.toNextOpen.weightedMeanExcess)} (n ${desc.afterHours.populationWeightedGross.toNextOpen.n}); → next close ${pct(desc.afterHours.populationWeightedGross.toNextClose.weightedMeanExcess)}. Strata weights: ${JSON.stringify(desc.afterHours.strataWeights)}.`, "");
md.push("## Execution traps — what changes", "");
T(["trigger", "spec", "baseline net ×1 (n)", "suspects excluded", "09:28 MOO cut-off", "all traps fixed (t, p)"], TRIG.flatMap((k) => [...X.HORIZONS_B.map((N) => [k, `next open N=${N}`, `${pct(S(`execution-B-${k}-nextOpen-h${N}-tier1`).mean)} (${S(`execution-B-${k}-nextOpen-h${N}-tier1`).n})`,
  `${pct(S(`execution-traps-noSuspect-${k}-h${N}`).mean)} (${S(`execution-traps-noSuspect-${k}-h${N}`).n})`, `${pct(S(`execution-traps-mooCutoff-${k}-h${N}`).mean)} (${S(`execution-traps-mooCutoff-${k}-h${N}`).n})`,
  `${pct(S(`execution-trapsClean-${k}-h${N}`).mean)} (${S(`execution-trapsClean-${k}-h${N}`).n}; ${S(`execution-trapsClean-${k}-h${N}`).t ?? "—"}, ${fmtP(S(`execution-trapsClean-${k}-h${N}`).p)})`]),
  [k, "MOO→MOC", `${pct(S(`execution-Amoc-${k}-tier1`).mean)} (${S(`execution-Amoc-${k}-tier1`).n})`, `${pct(S(`execution-traps-noSuspect-${k}-mooMoc`).mean)} (${S(`execution-traps-noSuspect-${k}-mooMoc`).n})`,
    `${pct(S(`execution-traps-mooCutoff-${k}-mooMoc`).mean)} (${S(`execution-traps-mooCutoff-${k}-mooMoc`).n})`, `${pct(S(`execution-trapsClean-${k}-mooMoc`).mean)} (${S(`execution-trapsClean-${k}-mooMoc`).n}; ${S(`execution-trapsClean-${k}-mooMoc`).t ?? "—"}, ${fmtP(S(`execution-trapsClean-${k}-mooMoc`).p)})`]]));
md.push("## Portfolio simulations (20 slots, equal notional, one position per issuer, idle cash at 0%)", "", "CAGR-like = (1 + total)^(252/sessions) − 1 from a SHORT history — illustrative only.", "");
T(["simulation", "signals → trades", "conc mean/max (demand)", "exposure", "turnover/yr", "total", "CAGR-like", "max DD", "worst month", "SPY total", "SPY max DD", "SPY worst month"], portfolios.map((p) => [p.id.replace("execution-pf-", ""), `${p.signals} → ${p.trades}`,
  `${p.meanConcurrency?.toFixed(1) ?? "—"}/${p.maxConcurrency ?? "—"} (${p.demandMeanConcurrency?.toFixed(1) ?? "—"}/${p.demandMaxConcurrency ?? "—"})`, pct(p.meanExposure, 0), p.turnoverAnnualOneWay?.toFixed(1) ?? "—", pct(p.totalReturn), pct(p.cagrLike, 1), pct(p.maxDrawdown), p.worstMonth ? `${p.worstMonth.month} ${pct(p.worstMonth.ret)}` : "—",
  pct(p.spy?.totalReturn), pct(p.spy?.maxDrawdown), p.spy?.worstMonth ? `${p.spy.worstMonth.month} ${pct(p.spy.worstMonth.ret)}` : "—"]));
md.push("## Spread model calibration (as-traded price level)", "");
T(["as-traded price", "n", "share", "tier bps/side", "spread model bps/side", "Abdi–Ranaldo median half-spread bps (n)", "median ADV20", "bucket differs on adjusted price"], desc.spreadCalibration.map((b) => [b.bucket, b.n, pct(b.shareOfEvents, 1), b.meanTierBpsPerSide, b.spreadModelBpsPerSide, `${b.abdiRanaldoMedianHalfSpreadBps ?? "—"} (${b.arN})`, `$${(b.medianAdv20 / 1e6).toFixed(2)}M`, b.bucketDiffersOnAdjustedPrice]));
md.push("## MOC entry by publication time (descriptive, tier ×1)", "");
T(["trigger", ...X.HORIZONS_B.map((N) => `N=${N} premarket n / mean`), ...X.HORIZONS_B.map((N) => `N=${N} intraday n / mean`)], TRIG.map((k) => [k, ...X.HORIZONS_B.map((N) => `${desc.mocByBucket[k][N].premarket.n} / ${pct(desc.mocByBucket[k][N].premarket.mean)}`), ...X.HORIZONS_B.map((N) => `${desc.mocByBucket[k][N].intraday.n} / ${pct(desc.mocByBucket[k][N].intraday.mean)}`)]));
md.push("## Track A coverage: measurable vs not (event counts, statistics period)", "");
const cov = desc.trackACoverage;
T(["variant", ...TRIG], Object.entries(cov).filter(([, v]) => v && typeof v === "object" && "T1_all" in v).map(([k, v]) => [k, ...TRIG.map((t) => v[t])]));
md.push(`After-close pool (16:00–19:55, session days): ${cov.afterClosePool}; cached sample: ${cov.afterCloseSampled}. Publication buckets: ${JSON.stringify(cov.bucketCountsAll)}.`, "");
md.push("## Case studies (most promising positive tests in this period)", "");
for (const c of cases) {
  md.push(`### ${c.id} — n ${c.stats.n}, mean ${pct(c.stats.mean)}, median ${pct(c.stats.median)}, t ${c.stats.t}`, "");
  T(["", "ticker", "published", "role", "value", "ret20 before", "ret60 before", "dd60", "vol spike", "entry gap", "as-traded px", "ADV20", "net excess"], [...c.winners.map((w) => ["W", w.ticker, w.publishedAt, w.role, w.filingValue, pct(w.ret20Before, 0), pct(w.ret60Before, 0), pct(w.dd60, 0), w.volSpike5_60, pct(w.entryGapVsPrevClose, 1), w.asTradedEntry, w.adv20, pct(w.excessNet)]),
    ...c.losers.map((w) => ["L", w.ticker, w.publishedAt, w.role, w.filingValue, pct(w.ret20Before, 0), pct(w.ret60Before, 0), pct(w.dd60, 0), w.volSpike5_60, pct(w.entryGapVsPrevClose, 1), w.asTradedEntry, w.adv20, pct(w.excessNet)])]);
}
X.writeOut(`${PREFIX}tables-${phase}.md`, md.join("\n"));
log(`saved tables-${phase}.md`);

// ------------------------------------------------------------------------------------------------
// 7. Confirmation phase: candidate criteria (STAGE0 §4) on frozen discovery results vs this run.
if (phase === "confirm") {
  const disc = JSON.parse(fs.readFileSync(path.join(X.OUT, "results-discover.json"), "utf8"));
  const D = Object.fromEntries(disc.tests.map((t) => [t.id, t]));
  const cand = [];
  for (const r of clean) {
    if (!(r.kind === "eval" || r.kind === "ah")) continue; // paired comparisons are not strategies
    const d = D[r.id]; if (!d) continue;
    const ds = d.stats, cs = r.stats;
    const checks = {
      discoveryQ: d.qAll != null && d.qAll < 0.1, discoveryN: ds.n >= 40, discoveryIssuers: (ds.issuers ?? 0) >= 25, discoveryPositive: ds.mean > 0, discoveryExTop5: ds.meanExTop5Issuers > 0,
      confirmSameSign: cs.mean > 0, confirmP: cs.p != null && cs.p < 0.1, confirmIssuerMedian: cs.issuerMedianOfMeans > 0, confirmExTop5: cs.meanExTop5Issuers > 0,
    };
    const pass = Object.values(checks).every(Boolean);
    if (checks.discoveryQ && checks.discoveryPositive) cand.push({ id: r.id, pass, checks, discovery: ds, confirmation: cs, qAllDiscovery: d.qAll, spec: TESTS.find((t) => t.id === r.id) });
  }
  const passing = cand.filter((c) => c.pass).sort((a, b) => a.qAllDiscovery - b.qAllDiscovery).slice(0, 5);
  X.writeOut(`${PREFIX}candidate-screen-${phase}.json`, { generatedAt: new Date().toISOString(), screened: cand.length, passing: passing.length, all: cand });
  X.writeOut(`${PREFIX}candidates.json`, passing.map((c) => ({ id: c.id, rule: { trigger: c.spec.trig ? X.TRIGGERS[c.spec.trig].label : AH_GROUP_LABELS[c.spec.group], triggerId: c.spec.trig ?? c.spec.group, execution: c.spec.opts },
    entry: c.spec.opts.entry, exit: c.spec.opts.entry === "mooMoc" ? "same-session close" : c.spec.opts.entry === "ah" ? c.spec.opts.exitSessions : `close of session ${c.spec.opts.exitSessions} after entry`,
    horizon: c.spec.opts.exitSessions, discovery: c.discovery, confirmation: c.confirmation, notes: c.spec.statement })));
  log(`candidate screen: ${cand.length} discovery-significant positive tests, ${passing.length} pass all criteria`);
}
