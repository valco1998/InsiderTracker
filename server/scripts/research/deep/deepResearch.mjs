// server/scripts/research/deep/deepResearch.mjs — staged, resumable deep study of insider buying
// and subsequent price behaviour. READ-ONLY on SEC data and cached market data. Outputs and
// checkpoints: server/.cache/research/deep/ (git-ignored).
//
//   node scripts/research/deep/deepResearch.mjs            run every stage not yet checkpointed
//   node scripts/research/deep/deepResearch.mjs --force=C  re-run stage C and everything after it
//
// Stages: A data audit · B insider behaviour · C chart features + point-in-time returns + event
// study · D discovery on TRAIN only (registry of every test) · E/F validation (train → validation
// → test, embargoed, FDR-controlled) + robustness · G report data.
//
// Pre-committed protocol (fixed before looking at validation/test):
//   splits      train: published < 2026-06-15 · validation: 2026-06-15 … 2026-08-31 · test: ≥ 2026-09-01
//   embargo     an event counts in train/validation only if its exit session is before the next split starts
//   primary     net excess return vs SPY (net of liquidity-tiered costs) at 10 and 20 sessions
//   promotion   train: BH q < 0.10 over ALL registered train tests, n ≥ 60, issuers ≥ 30
//               validation: same sign, issuer-clustered p < 0.05, n ≥ 30
//               test: reported once; "supported" only if same sign with p < 0.05
import fs from "node:fs";
import path from "node:path";
import { loadSec, purchaseItemsByIssuer, loadDailyBars, lastCompleteSession, priceEvent, clusteredT, pValue, bhQ, mean, median, r4, sym, OUT_DIR, entrySessionAfter, previousSession as prevSessionOf } from "../lib.mjs";
import { buildBehaviorEvents, toSeries, chartFeatures, lastIdxBefore } from "./features.mjs";

const DIR = path.join(OUT_DIR, "deep");
fs.mkdirSync(DIR, { recursive: true });
const HORIZONS = [1, 2, 3, 5, 10, 20, 40, 60];
const PRIMARY = [10, 20];
const VAL_START = "2026-06-15", TEST_START = "2026-09-01";
const force = (process.argv.find((a) => a.startsWith("--force=")) || "").split("=")[1] || null;
const STAGES = ["A", "B", "C", "D", "E", "G"];
const mustRun = (st) => !fs.existsSync(path.join(DIR, `stage${st}.json`)) || (force && STAGES.indexOf(st) >= STAGES.indexOf(force));
const save = (st, data) => { fs.writeFileSync(path.join(DIR, `stage${st}.json`), JSON.stringify(data)); console.log(`[DEEP] stage ${st} saved`); };
const load = (st) => JSON.parse(fs.readFileSync(path.join(DIR, `stage${st}.json`), "utf8"));
const t0 = Date.now();
const log = (m) => console.log(`[DEEP ${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

let sec = null;
const getSec = () => (sec ||= loadSec());
const completeThrough = lastCompleteSession();

// ============ STAGE A — data audit ============
if (mustRun("A")) {
  log("stage A: data audit");
  const s = getSec();
  const raw = s.snap.raw, econ = s.snap.economic;
  const byForm = raw.reduce((m, r) => ((m[r.formType || "?"] = (m[r.formType || "?"] || 0) + 1), m), {});
  const byCode = raw.reduce((m, r) => ((m[r.code || "?"] = (m[r.code || "?"] || 0) + 1), m), {});
  const P = raw.filter((r) => r.code === "P");
  const amend = P.reduce((m, r) => ((m[r.amendment?.status || "none"] = (m[r.amendment?.status || "none"] || 0) + 1), m), {});
  const dedupe = econ.filter((r) => r.code === "P").reduce((m, r) => ((m[r.dedupe?.status || "?"] = (m[r.dedupe?.status || "?"] || 0) + 1), m), {});
  const priceChecks = P.reduce((m, r) => ((m[r.priceCheck?.status || "none"] = (m[r.priceCheck?.status || "none"] || 0) + 1), m), {});
  const venue = P.reduce((m, r) => ((m[r.purchaseContext || "unspecified"] = (m[r.purchaseContext || "unspecified"] || 0) + 1), m), {});
  const lateP = P.filter((r) => r.filingDelay?.late).length;
  const noTicker = P.filter((r) => !r.ticker).length;
  const filingsP = new Set(P.map((r) => r.accessionNo)).size;
  const monthDays = {};
  for (const d of s.days) monthDays[d.slice(0, 7)] = (monthDays[d.slice(0, 7)] || 0) + 1;
  const missingDays = s.coverage.missing || [];
  // Price data quality: extreme daily moves (possible bad adjustment) and zero-volume days.
  const bars = await loadDailyBars([...new Set(P.map((r) => r.ticker).filter(Boolean)), "SPY", "IWM"]);
  const extreme = [], zeroVol = [];
  for (const [symb, b] of bars) {
    if (!b) continue;
    const ds = [...b.keys()].sort();
    let zv = 0;
    for (let i = 1; i < ds.length; i++) {
      const p = b.get(ds[i - 1]).c, x = b.get(ds[i]);
      if (p > 0 && Math.abs(x.c / p - 1) > 0.75) extreme.push({ symbol: symb, date: ds[i], move: r4(x.c / p - 1) });
      if (!(x.v > 0)) zv++;
    }
    if (zv) zeroVol.push({ symbol: symb, days: zv });
  }
  // Reversal check: an extreme move undone the next day suggests a bad print / adjustment.
  const suspect = extreme.filter((e) => { const b = bars.get(e.symbol); const ds = [...b.keys()].sort(); const i = ds.indexOf(e.date); const n = ds[i + 1]; return n && Math.abs(b.get(n).c / b.get(e.date).c - 1) > 0.4; });
  save("A", {
    generatedAt: new Date().toISOString(), completeThrough,
    sec: { heldDays: s.days.length, from: s.days[0], to: s.days.at(-1), coverage: s.coverage, monthDays, missingDays: missingDays.slice(0, 60), rawRows: raw.length, byForm, byCode,
      purchases: { rows: P.length, filings: filingsP, amendmentStatus: amend, economicDedupe: dedupe, priceChecks, venue, late: lateP, noTicker } },
    prices: { symbols: [...bars.keys()].length, unsupported: [...bars].filter(([, b]) => b === null).length, source: "Alpaca SIP daily bars, split-adjusted (no dividends)",
      extremeMoves: extreme.length, extremeSymbols: new Set(extreme.map((e) => e.symbol)).size, suspectReversals: suspect.slice(0, 50), suspectSymbols: [...new Set(suspect.map((e) => e.symbol))],
      zeroVolumeSymbols: zeroVol.length },
    notAvailable: ["market capitalization (no shares-outstanding data)", "sector / industry (not stored; would need new EDGAR requests)", "intraday bars for all events (only RAPP fetched)", "dividends (split-adjusted closes only)"],
  });
}

// ============ STAGE B — insider behaviour, company by company ============
if (mustRun("B")) {
  log("stage B: insider behaviour");
  const s = getSec();
  const events = buildBehaviorEvents({ itemsByIssuer: purchaseItemsByIssuer(s), acc: s.acc });
  // Company histories: sequence archetypes per issuer (purchase filings ordered by SEC publication).
  const byIssuer = new Map();
  for (const e of events) (byIssuer.get(e.issuerCik) || byIssuer.set(e.issuerCik, []).get(e.issuerCik)).push(e);
  const companies = [...byIssuer].map(([cik, es]) => ({
    issuerCik: cik, ticker: es.at(-1).ticker, filings: es.length, insiders: new Set(es.map((e) => e.insider)).size, totalUsd: Math.round(es.reduce((a, e) => a + e.filingValue, 0)),
    firstPublished: es[0].publishedAt, lastPublished: es.at(-1).publishedAt,
    archetypes: {
      repeatSingleInsider: es.some((e) => e.sameInsiderPrior90 >= 2), cluster3: es.some((e) => e.buyers30 >= 3), ceoAfterOthers: es.some((e) => e.ceoAfterOthers),
      escalation: es.some((e) => e.sizesIncreasing), deescalation: es.some((e) => e.sizesDecreasing), averagingDown: es.some((e) => e.pricesFalling), buyingUp: es.some((e) => e.pricesRising),
      bigAfterSmall: es.some((e) => e.ratioToMaxPrior30 >= 10), offering: es.some((e) => e.venue === "offering_or_private"),
    },
  }));
  const multi = companies.filter((c) => c.filings >= 3);
  const archetypeCounts = Object.fromEntries(Object.keys(multi[0]?.archetypes || {}).map((k) => [k, multi.filter((c) => c.archetypes[k]).length]));
  save("B", { events, companies: { total: companies.length, withAtLeast3Filings: multi.length, archetypeCounts, top: companies.sort((a, b) => b.filings - a.filings).slice(0, 40) } });
}

// ============ STAGE C — chart features, point-in-time returns, event study ============
if (mustRun("C")) {
  log("stage C: chart features + returns");
  const { events } = load("B");
  const bars = await loadDailyBars([...events.map((e) => e.ticker), "SPY", "IWM"]);
  const spyMap = bars.get("SPY"), iwmMap = bars.get("IWM");
  const spyS = toSeries(spyMap);
  const seriesCache = new Map();
  const seriesOf = (t) => { const k = sym(t); if (!seriesCache.has(k)) seriesCache.set(k, toSeries(bars.get(k))); return seriesCache.get(k); };
  const EV_LO = -20, EV_HI = 60;
  for (const e of events) {
    const s = e.ticker ? seriesOf(e.ticker) : null;
    Object.assign(e, s ? chartFeatures(e, s, spyS) : { chartStatus: e.ticker ? "no_bars" : "no_ticker" });
    priceEvent(e, { bars: bars.get(sym(e.ticker)), spy: spyMap, iwm: iwmMap, completeThrough, horizons: HORIZONS });
    // Event study: cumulative excess (close-to-close, vs SPY) from the decision close, days −20…+60;
    // and from the trade-date close (to see what happened BEFORE publication).
    if (e.priceStatus === "ok" && s) {
      const i0 = lastIdxBefore(s, e.entryDate), j0 = lastIdxBefore(spyS, e.entryDate);
      const path = [];
      for (let k = EV_LO; k <= EV_HI; k++) {
        const i = i0 + k, j = j0 + k;
        if (i < 0 || j < 0 || i >= s.c.length || j >= spyS.c.length || s.dates[i] > completeThrough) { path.push(null); continue; }
        path.push(r4((s.c[i] / s.c[i0] - 1) - (spyS.c[j] / spyS.c[j0] - 1)));
      }
      e.evPath = path;
      const ti = s.idx.get(e.tradeDate) ?? lastIdxBefore(s, e.tradeDate);
      const tj = lastIdxBefore(spyS, e.tradeDate) + (spyS.idx.has(e.tradeDate) ? 1 : 0);
      e.tradeToDecisionExcess = ti >= 0 && tj >= 0 && ti <= i0 ? r4((s.c[i0] / s.c[ti] - 1) - (spyS.c[j0] / spyS.c[tj] - 1)) : null;
      e.sessionsTradeToEntry = ti >= 0 ? i0 - ti + 1 : null;
    }
  }
  save("C", { events, evRange: [EV_LO, EV_HI], horizons: HORIZONS });
}

// ============ shared: splits and statistics ============
const split = (e) => (e.publishedAt < VAL_START ? "train" : e.publishedAt < TEST_START ? "validation" : "test");
const usable = (e, H, sp) => {
  const h = e.h?.[H];
  if (h?.status !== "ok" || split(e) !== sp) return false;
  if (sp === "train" && h.exitDate >= VAL_START) return false;       // embargo
  if (sp === "validation" && h.exitDate >= TEST_START) return false;  // embargo
  return true;
};
// REGIME CONTROL. The whole universe of insider purchases drifted from ≈SPY (train) to far below
// SPY (test). Judging patterns only against SPY therefore "validates" anything negative. Each
// event is also measured against the mean net excess of ALL priced insider-purchase events that
// entered in the same calendar month (same horizon): "abnormal vs other insider buys".
// Promotion uses this abnormal measure; SPY-relative (tradable) results are reported alongside.
let MONTH_MEAN = null; // H → Map(YYYY-MM → mean net excess)
function setMonthMeans(E) {
  MONTH_MEAN = {};
  for (const H of HORIZONS) {
    const by = new Map();
    for (const e of E) if (e.h?.[H]?.status === "ok") { const k = e.entryDate.slice(0, 7); const a = by.get(k) || by.set(k, [0, 0]).get(k); a[0] += e.h[H].excessNet; a[1]++; }
    MONTH_MEAN[H] = new Map([...by].map(([k, [s, n]]) => [k, s / n]));
  }
}
function stat(es, H, sp, { costMult = 1 } = {}) {
  const rows = es.filter((e) => usable(e, H, sp)).map((e) => {
    const h = e.h[H], c = (e.costBpsPerSide * costMult) / 1e4;
    const net = ((1 + h.gross) * (1 - c)) / (1 + c) - 1;
    const abn = MONTH_MEAN ? h.excessNet - MONTH_MEAN[H].get(e.entryDate.slice(0, 7)) : null;
    return { issuer: e.issuerCik, net, excess: net - h.spy, abn, gross: h.gross, dd: h.maxDrawdown, fav: h.maxFavorable };
  });
  const ta = MONTH_MEAN ? clusteredT(rows, "abn") : null;
  const abnStats = MONTH_MEAN ? { meanAbn: r4(mean(rows.map((r) => r.abn))), medianAbn: r4(median(rows.map((r) => r.abn))), tAbn: r4(ta), pAbn: r4(pValue(ta)) } : {};
  const x = rows.map((r) => r.excess), t = clusteredT(rows, "excess");
  const gains = rows.filter((r) => r.net > 0).reduce((a, r) => a + r.net, 0), losses = -rows.filter((r) => r.net < 0).reduce((a, r) => a + r.net, 0);
  const sorted = [...x].sort((a, b) => a - b);
  return { n: rows.length, issuers: new Set(rows.map((r) => r.issuer)).size, meanNet: r4(mean(rows.map((r) => r.net))), medianNet: r4(median(rows.map((r) => r.net))),
    meanExcess: r4(mean(x)), medianExcess: r4(median(x)), win: rows.length ? r4(rows.filter((r) => r.net > 0).length / rows.length) : null,
    beatSpy: rows.length ? r4(x.filter((v) => v > 0).length / rows.length) : null, t: r4(t), p: r4(pValue(t)),
    profitFactor: losses > 0 ? r4(gains / losses) : null, worst5: sorted.length >= 20 ? r4(sorted[Math.floor(sorted.length * 0.05)]) : null,
    medianDD: r4(median(rows.map((r) => r.dd))), medianFav: r4(median(rows.map((r) => r.fav))), ...abnStats };
}
function bootstrapCI(es, H, sp, reps = 1000) {
  const rows = es.filter((e) => usable(e, H, sp)).map((e) => ({ issuer: e.issuerCik, x: e.h[H].excessNet }));
  const by = new Map(); for (const r of rows) (by.get(r.issuer) || by.set(r.issuer, []).get(r.issuer)).push(r.x);
  const groups = [...by.values()]; if (groups.length < 10) return null;
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const means = [];
  for (let b = 0; b < reps; b++) { let s = 0, n = 0; for (let k = 0; k < groups.length; k++) { const g = groups[Math.floor(rnd() * groups.length)]; for (const v of g) { s += v; n++; } } means.push(s / n); }
  means.sort((a, b) => a - b);
  return [r4(means[Math.floor(reps * 0.025)]), r4(means[Math.floor(reps * 0.975)])];
}

// ============ STAGE D — discovery on TRAIN only; every test registered ============
const NUM = ["filingValue", "largestTxUsd", "buyers30", "priorOtherBuyers30", "priorTx30", "value30", "ratioToMaxPrior30", "shareOfWindow30", "buyers90", "sameInsiderPrior90", "sameInsiderSizeRatio",
  "buyerPriceCv", "buyingSurge", "issuerPurchases30", "daysSinceIssuerLastBuy", "filingDelayDays",
  "ret1", "ret5", "ret20", "ret60", "rs20", "rs60", "dd60", "up60", "smaRatio20", "smaRatio50", "vol20", "volRatio10_60", "range20", "volumeSpike5_60", "dollarVol20", "priceLevel", "gaps20",
  "postTradeMove", "postTradeVolRatio", "insiderPremium", "priceVsTradePrevClose", "tradeToDecisionExcess", "sessionsTradeToEntry", "spyRet20"];
const BOOL = ["isCeo", "isCfo", "isOfficer", "isDirectorOnly", "isTenPct", "is10b5_1", "firstBuyInHistory", "sizesIncreasing", "sizesDecreasing", "pricesFalling", "pricesRising",
  "ceoAfterOthers", "ceoOrCfoAfterDirectors", "directorsAfterCeoCfo", "nearLow60", "atHigh60", "above50", "consolidation", "spyAbove50"];
const CAT = { ownership: ["D", "I"], venue: ["open_market", "offering_or_private", "unspecified"], role: ["CEO", "CFO", "Director", "10% Owner", "Other officer", "VP", "Other"] };
// Pre-registered hypotheses from the brief (fixed rules; thresholds from the brief or round numbers).
const HYP = [
  ["H01 one insider buying repeatedly (≥2 earlier buys in 90d)", (e) => e.sameInsiderPrior90 >= 2],
  ["H02 several insiders in 30d (≥3 distinct)", (e) => e.buyers30 >= 3],
  ["H03 CEO buys after other insiders", (e) => e.ceoAfterOthers],
  ["H04 directors buy after CEO/CFO", (e) => e.directorsAfterCeoCfo],
  ["H05 CEO/CFO buys after directors", (e) => e.ceoOrCfoAfterDirectors],
  ["H06 increasing purchase sizes (same insider, ≥3)", (e) => e.sizesIncreasing],
  ["H07 decreasing purchase sizes (same insider, ≥3)", (e) => e.sizesDecreasing],
  ["H08 small then exceptionally large (≥10× earlier max, 30d)", (e) => e.ratioToMaxPrior30 >= 10],
  ["H09 large purchase followed by more accumulation (≥1 earlier buy ≥ $1M, this buy smaller)", (e) => e.priorValue30 >= 1e6 && e.ratioToMaxPrior30 != null && e.ratioToMaxPrior30 < 1],
  ["H10 averaging down: same insider at progressively lower prices", (e) => e.pricesFalling],
  ["H11 buying up: same insider at progressively higher prices", (e) => e.pricesRising],
  ["H12 buying after a ≥30% 60-day drawdown", (e) => e.dd60 != null && e.dd60 <= -0.3],
  ["H13 buying near a 60-day low (within 5%)", (e) => e.nearLow60 === true],
  ["H14 buying during a recovery (≥20% above 60-day low, still ≥20% below high)", (e) => e.up60 >= 0.2 && e.dd60 <= -0.2],
  ["H15 sudden surge in issuer buying (30d ≥ 3× prior pace)", (e) => e.buyingSurge >= 3],
  ["H16 different insiders at similar prices (CV < 3%, ≥2 buyers)", (e) => e.buyerPriceCv != null && e.buyerPriceCv < 0.03],
  ["H17 insiders buying while the stock falls (20d return ≤ −10%)", (e) => e.ret20 != null && e.ret20 <= -0.1],
  ["H18 cluster (≥3 buyers) after a ≥30% drawdown", (e) => e.buyers30 >= 3 && e.dd60 <= -0.3],
  ["H19 cluster (≥3 buyers) during an uptrend (above 50-day average)", (e) => e.buyers30 >= 3 && e.above50 === true],
  ["H20 repeated CEO buying during consolidation (20d range < 15%)", (e) => e.isCeo && e.sameInsiderPrior90 >= 1 && e.consolidation === true],
  ["H21 very large after several smaller (≥2 earlier buys, ≥5× max)", (e) => e.priorTx30 >= 2 && e.ratioToMaxPrior30 >= 5],
  ["H22 open-market CEO/CFO personal buy ≥ $250k", (e) => (e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5],
  ["H23 fund / entity buy at offering price (≥5% below prior close)", (e) => e.ownership === "I" && e.priceVsTradePrevClose != null && e.priceVsTradePrevClose <= -0.05],
  ["H24 RAPP-like: ≥2 earlier buyers, ≥10× larger, indirect, at ≥5% discount", (e) => e.priorOtherBuyers30 >= 2 && e.ratioToMaxPrior30 >= 10 && e.ownership === "I" && e.priceVsTradePrevClose <= -0.05],
  ["H25 stock already ran ≥10% between trade and decision", (e) => e.postTradeMove != null && e.postTradeMove >= 0.1],
  ["H26 stock fell ≥10% between trade and decision (below insider's price)", (e) => e.insiderPremium != null && e.insiderPremium <= -0.1],
  ["H27 unusual volume between trade and filing (≥2× normal)", (e) => e.postTradeVolRatio >= 2],
  ["H28 breakout: decision close at 60-day high", (e) => e.atHigh60 === true],
  ["H29 first purchase by this insider in held history, ≥ $100k, open market", (e) => e.firstBuyInHistory && e.filingValue >= 1e5 && e.venue === "open_market"],
  ["H30 10b5-1 plan purchases", (e) => e.is10b5_1],
];
const priceable = (e) => e.priceStatus === "ok";
if (mustRun("D")) {
  log("stage D: discovery (train only)");
  const { events } = load("C");
  const E = events.filter(priceable);
  setMonthMeans(E);
  const train = E.filter((e) => split(e) === "train");
  const registry = [];
  const reg = (family, name, rule, filterFn, extra = {}) => {
    for (const H of [5, ...PRIMARY]) {
      const es = E.filter(filterFn);
      const st = stat(es, H, "train");
      registry.push({ id: `${family}|${name}|${H}`, family, name, rule, horizon: H, train: st, ...extra });
    }
  };
  // 1) pre-registered hypotheses
  for (const [name, f] of HYP) reg("hypothesis", name, f.toString(), f);
  // 2) univariate: numeric features in TRAIN quintiles (edges from train only); booleans; categories
  const edges = {};
  for (const k of NUM) {
    const xs = train.map((e) => e[k]).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    if (xs.length < 200) continue;
    const q = [0.2, 0.4, 0.6, 0.8].map((p) => xs[Math.floor(p * (xs.length - 1))]);
    if (new Set(q).size < 2) continue;
    edges[k] = q;
    const bin = (v) => (v == null || !Number.isFinite(v) ? null : q.filter((x) => v > x).length);
    for (let b = 0; b < 5; b++) reg("univariate", `${k} Q${b + 1}`, `${k} in train quintile ${b + 1} (edges ${q.map((x) => r4(x)).join(", ")})`, (e) => bin(e[k]) === b, { feature: k, bin: b });
  }
  for (const k of BOOL) reg("univariate", `${k} = true`, `${k} === true`, (e) => e[k] === true, { feature: k });
  for (const [k, vals] of Object.entries(CAT)) for (const v of vals) reg("univariate", `${k} = ${v}`, `${k} === "${v}"`, (e) => e[k] === v, { feature: k });
  // 3) interactions: the 12 numeric features with the largest train |t| spread at 20d, tertiles × tertiles
  const spread = Object.keys(edges).map((k) => {
    const lo = registry.find((r) => r.id === `univariate|${k} Q1|20`)?.train, hi = registry.find((r) => r.id === `univariate|${k} Q5|20`)?.train;
    return { k, s: Math.max(Math.abs(lo?.t || 0), Math.abs(hi?.t || 0)) };
  }).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.k);
  const terc = {};
  for (const k of spread) { const xs = train.map((e) => e[k]).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b); terc[k] = [xs[Math.floor(xs.length / 3)], xs[Math.floor((2 * xs.length) / 3)]]; }
  const tb = (k, v) => (v == null || !Number.isFinite(v) ? null : terc[k].filter((x) => v > x).length);
  for (let a = 0; a < spread.length; a++) for (let b = a + 1; b < spread.length; b++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const ka = spread[a], kb = spread[b];
    const f = (e) => tb(ka, e[ka]) === i && tb(kb, e[kb]) === j;
    if (train.filter(f).length < 60) continue;
    reg("interaction", `${ka} T${i + 1} × ${kb} T${j + 1}`, `${ka} tertile ${i + 1} and ${kb} tertile ${j + 1} (train tertiles)`, f, { features: [ka, kb], cells: [i, j] });
  }
  // 4) interpretable model: regression tree (depth 3) on train net excess at 20 sessions
  const target = (e) => (usable(e, 20, "train") ? e.h[20].excessNet : null);
  const trainT = train.filter((e) => target(e) != null);
  const featsTree = [...NUM, ...BOOL];
  function bestSplit(rows) {
    let best = null; const tot = rows.reduce((a, e) => a + target(e), 0), n = rows.length;
    for (const k of featsTree) {
      const vals = rows.map((e) => (typeof e[k] === "boolean" ? (e[k] ? 1 : 0) : e[k])).filter((v) => v != null && Number.isFinite(v));
      if (vals.length < n * 0.8) continue;
      const cand = [...new Set(vals)].length <= 2 ? [0.5] : [0.2, 0.4, 0.5, 0.6, 0.8].map((p) => [...vals].sort((x, y) => x - y)[Math.floor(p * (vals.length - 1))]);
      for (const thr of cand) {
        const L = rows.filter((e) => { const v = typeof e[k] === "boolean" ? (e[k] ? 1 : 0) : e[k]; return v != null && v <= thr; });
        const R = rows.filter((e) => { const v = typeof e[k] === "boolean" ? (e[k] ? 1 : 0) : e[k]; return v != null && v > thr; });
        if (L.length < 150 || R.length < 150 || new Set(L.map((e) => e.issuerCik)).size < 60 || new Set(R.map((e) => e.issuerCik)).size < 60) continue;
        const sl = L.reduce((a, e) => a + target(e), 0), sr = R.reduce((a, e) => a + target(e), 0);
        const gain = (sl * sl) / L.length + (sr * sr) / R.length - (tot * tot) / n;
        if (!best || gain > best.gain) best = { k, thr, gain };
      }
    }
    return best;
  }
  const leaves = [];
  (function grow(rows, depth, conds) {
    const b = depth < 3 ? bestSplit(rows) : null;
    if (!b) { leaves.push(conds); return; }
    const val = (e) => (typeof e[b.k] === "boolean" ? (e[b.k] ? 1 : 0) : e[b.k]);
    grow(rows.filter((e) => val(e) != null && val(e) <= b.thr), depth + 1, [...conds, [b.k, "<=", b.thr]]);
    grow(rows.filter((e) => val(e) != null && val(e) > b.thr), depth + 1, [...conds, [b.k, ">", b.thr]]);
  })(trainT, 0, []);
  for (const conds of leaves) {
    const f = (e) => conds.every(([k, op, thr]) => { const v = typeof e[k] === "boolean" ? (e[k] ? 1 : 0) : e[k]; return v != null && (op === "<=" ? v <= thr : v > thr); });
    reg("tree", conds.map(([k, op, thr]) => `${k} ${op} ${r4(thr)}`).join(" & "), "depth-3 regression tree leaf (train, target = 20d net excess)", f, { conds });
  }
  // 5) linear score (ridge on standardized, winsorized features; train only) → score quintiles
  const rk = NUM.filter((k) => edges[k]);
  const stats = Object.fromEntries(rk.map((k) => { const xs = trainT.map((e) => e[k]).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    const lo = xs[Math.floor(0.01 * xs.length)], hi = xs[Math.floor(0.99 * xs.length)], med = xs[Math.floor(xs.length / 2)];
    const w = xs.map((v) => Math.min(hi, Math.max(lo, v))), m = mean(w), s = Math.sqrt(mean(w.map((v) => (v - m) ** 2))) || 1; return [k, { lo, hi, med, m, s }]; }));
  const vec = (e) => rk.map((k) => { const st = stats[k]; let v = e[k]; if (v == null || !Number.isFinite(v)) v = st.med; v = Math.min(st.hi, Math.max(st.lo, v)); return (v - st.m) / st.s; });
  const X = trainT.map(vec), y = trainT.map(target), p = rk.length, lambda = 50;
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((a, r) => a + r[i] * r[j], 0) + (i === j ? lambda : 0)));
  const Xty = Array.from({ length: p }, (_, i) => X.reduce((a, r, n) => a + r[i] * y[n], 0));
  // Solve (XtX) w = Xty by Gaussian elimination.
  const M = XtX.map((r, i) => [...r, Xty[i]]);
  for (let c = 0; c < p; c++) { let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k]; } }
  const wts = M.map((r, i) => r[p] / r[i]);
  const ybar = mean(y);
  for (const e of E) e.ridgeScore = ybar + vec(e).reduce((a, v, i) => a + v * wts[i], 0);
  const sc = trainT.map((e) => e.ridgeScore).sort((a, b) => a - b), sq = [0.2, 0.4, 0.6, 0.8].map((q) => sc[Math.floor(q * (sc.length - 1))]);
  for (let b = 0; b < 5; b++) reg("ridge", `ridge score Q${b + 1}`, `ridge score in train quintile ${b + 1}`, (e) => sq.filter((x) => e.ridgeScore > x).length === b, { bin: b });
  // FDR over ALL registered train tests — on the abnormal measure (promotion) and vs SPY (context).
  const qA = bhQ(registry.map((r) => r.train.pAbn)), qS = bhQ(registry.map((r) => r.train.p));
  registry.forEach((r, i) => { r.train.qAbn = r4(qA[i]); r.train.q = r4(qS[i]); });
  fs.writeFileSync(path.join(DIR, "registry.jsonl"), registry.map((r) => JSON.stringify(r)).join("\n"));
  const ridgeWeights = rk.map((k, i) => ({ feature: k, weight: r4(wts[i]) })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  save("D", { tests: registry.length, edges, terc, leaves, ridgeWeights, ridgeEdges: sq, trainEvents: train.length, ridgeScores: Object.fromEntries(E.map((e) => [e.id, r4(e.ridgeScore)])) });
}

// ============ STAGE E/F — validation, test, robustness ============
if (mustRun("E")) {
  log("stage E/F: validation");
  const { events } = load("C");
  const D = load("D");
  const E = events.filter(priceable);
  setMonthMeans(E);
  for (const e of E) e.ridgeScore = D.ridgeScores[e.id];
  const registry = fs.readFileSync(path.join(DIR, "registry.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  // Rebuild every rule from its recorded definition (the registry is the single source of truth).
  const ruleFor = (r) => {
    if (r.family === "hypothesis") return HYP.find(([n]) => n === r.name)[1];
    if (r.family === "univariate" && r.bin != null) { const q = D.edges[r.feature]; return (e) => { const v = e[r.feature]; return v != null && Number.isFinite(v) && q.filter((x) => v > x).length === r.bin; }; }
    if (r.family === "univariate" && CAT[r.feature]) { const v = r.name.split(" = ")[1]; return (e) => e[r.feature] === v; }
    if (r.family === "univariate") return (e) => e[r.feature] === true;
    if (r.family === "interaction") { const [ka, kb] = r.features, [i, j] = r.cells; const tb = (k, v) => (v == null || !Number.isFinite(v) ? null : D.terc[k].filter((x) => v > x).length); return (e) => tb(ka, e[ka]) === i && tb(kb, e[kb]) === j; }
    if (r.family === "tree") return (e) => r.conds.every(([k, op, thr]) => { const v = typeof e[k] === "boolean" ? (e[k] ? 1 : 0) : e[k]; return v != null && (op === "<=" ? v <= thr : v > thr); });
    if (r.family === "ridge") return (e) => D.ridgeEdges.filter((x) => e.ridgeScore > x).length === r.bin;
    throw new Error(`no rule for ${r.id}`);
  };
  const results = [];
  for (const r of registry) {
    const passTrain = r.train.qAbn != null && r.train.qAbn < 0.1 && r.train.n >= 60 && r.train.issuers >= 30 && PRIMARY.includes(r.horizon);
    const out = { ...r, passTrain };
    if (passTrain) {
      const es = E.filter(ruleFor(r));
      out.validation = stat(es, r.horizon, "validation");
      out.passValidation = out.validation.n >= 30 && out.validation.pAbn != null && out.validation.pAbn < 0.05 && Math.sign(out.validation.meanAbn) === Math.sign(r.train.meanAbn);
      if (out.passValidation) {
        out.test = stat(es, r.horizon, "test");
        out.supported = out.test.n >= 30 && out.test.pAbn != null && out.test.pAbn < 0.05 && Math.sign(out.test.meanAbn) === Math.sign(r.train.meanAbn);
        // Tradable view: does the same direction also hold against SPY in the test period?
        out.supportedVsSpy = out.test.n >= 30 && out.test.p != null && out.test.p < 0.05 && Math.sign(out.test.meanExcess) === Math.sign(r.train.meanAbn);
      }
    }
    results.push(out);
  }
  // Robustness for everything that passed validation (and for the strongest train results, to show decay).
  const promoted = results.filter((r) => r.passValidation);
  const decay = results.filter((r) => PRIMARY.includes(r.horizon) && r.train.n >= 60 && r.train.issuers >= 30).sort((a, b) => (b.train.tAbn ?? 0) - (a.train.tAbn ?? 0));
  const showDecay = [...decay.slice(0, 15), ...decay.slice(-15)];
  const robust = (r) => {
    const es = E.filter(ruleFor(r)), H = r.horizon, all = ["train", "validation", "test"];
    const by = (pred) => Object.fromEntries(all.map((sp) => [sp, stat(es.filter(pred), H, sp)]));
    const firstPerIssuer = (() => { const seen = new Map(); return es.filter((e) => { const last = seen.get(e.issuerCik); if (last && Date.parse(e.publishedAt) - Date.parse(last) < 30 * 86400000) return false; seen.set(e.issuerCik, e.publishedAt); return true; }); })();
    return {
      horizons: Object.fromEntries(HORIZONS.map((h) => [h, Object.fromEntries(all.map((sp) => [sp, stat(es, h, sp)]))])),
      costs: Object.fromEntries([0, 1, 2, 3].map((m) => [`${m}x`, Object.fromEntries(all.map((sp) => [sp, stat(es, H, sp, { costMult: m })]))])),
      liquidity: { "≥$50M/day": by((e) => e.dollarVol20 >= 50e6), "$5–50M": by((e) => e.dollarVol20 >= 5e6 && e.dollarVol20 < 50e6), "$1–5M": by((e) => e.dollarVol20 >= 1e6 && e.dollarVol20 < 5e6), "<$1M": by((e) => e.dollarVol20 < 1e6) },
      role: { officer: by((e) => e.isOfficer), directorOnly: by((e) => e.isDirectorOnly), tenPct: by((e) => e.isTenPct) },
      ownership: { direct: by((e) => e.ownership === "D"), indirect: by((e) => e.ownership === "I") },
      venue: { openMarket: by((e) => e.venue === "open_market"), offering: by((e) => e.venue === "offering_or_private"), unspecified: by((e) => e.venue === "unspecified") },
      market: { spyAbove50: by((e) => e.spyAbove50 === true), spyBelow50: by((e) => e.spyAbove50 === false) },
      onePerIssuer30d: Object.fromEntries(all.map((sp) => [sp, stat(firstPerIssuer, H, sp)])),
      bootstrapCI: Object.fromEntries(all.map((sp) => [sp, bootstrapCI(es, H, sp)])),
      examples: es.filter((e) => e.h?.[H]?.status === "ok").sort((a, b) => b.h[H].excessNet - a.h[H].excessNet).filter((_, i, arr) => i < 4 || i >= arr.length - 4)
        .map((e) => ({ ticker: e.ticker, publishedAt: e.publishedAt, insider: e.insider, role: e.role, filingValue: Math.round(e.filingValue), venue: e.venue, entryDate: e.entryDate, excessNet: e.h[H].excessNet, net: e.h[H].net })),
    };
  };
  for (const r of promoted) r.robustness = robust(r);
  for (const r of showDecay) if (!r.robustness) { const es = E.filter(ruleFor(r)); r.decay = { validation: stat(es, r.horizon, "validation"), test: stat(es, r.horizon, "test") }; }
  // Baselines (same machinery) for context.
  const baseline = Object.fromEntries(HORIZONS.map((h) => [h, Object.fromEntries(["train", "validation", "test"].map((sp) => [sp, stat(E, h, sp)]))]));
  const coverage = Object.fromEntries(HORIZONS.map((h) => [h, { ok: E.filter((e) => e.h?.[h]?.status === "ok").length, pending: E.filter((e) => e.h?.[h]?.status === "pending").length, noExitBar: E.filter((e) => e.h?.[h]?.status === "no_exit_bar").length }]));
  const splitCounts = Object.fromEntries(["train", "validation", "test"].map((sp) => [sp, E.filter((e) => split(e) === sp).length]));
  fs.writeFileSync(path.join(DIR, "registry-results.jsonl"), results.map((r) => JSON.stringify(r)).join("\n"));
  save("E", { promoted, decay: showDecay, baseline, coverage, splitCounts, counts: { tests: results.length, passTrain: results.filter((r) => r.passTrain).length, passValidation: promoted.length, supported: promoted.filter((r) => r.supported).length, supportedPositive: promoted.filter((r) => r.supported && r.train.meanAbn > 0).length, supportedNegative: promoted.filter((r) => r.supported && r.train.meanAbn < 0).length } });
}

// ============ STAGE G — report data (event study aggregates, hypothesis table, cases) ============
if (mustRun("G")) {
  log("stage G: report data");
  const A = load("A"), B = load("B"), C = load("C"), D = load("D"), Ex = load("E");
  const E = C.events.filter(priceable);
  setMonthMeans(E);
  const results = fs.readFileSync(path.join(DIR, "registry-results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  // Event study: mean cumulative excess path by group (decision close = day 0).
  const groups = {
    "All purchases": () => true,
    "Open market (stated)": (e) => e.venue === "open_market",
    "Offering price (≥5% below prior close)": (e) => e.priceVsTradePrevClose != null && e.priceVsTradePrevClose <= -0.05,
    "Cluster ≥3 buyers": (e) => e.buyers30 >= 3,
    "Same insider repeating (≥2 earlier in 90d)": (e) => e.sameInsiderPrior90 >= 2,
    "After ≥30% drawdown": (e) => e.dd60 <= -0.3,
    "CEO/CFO personal open-market ≥ $250k": (e) => (e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5,
    "Very liquid (≥ $50M/day)": (e) => e.dollarVol20 >= 50e6,
  };
  const [lo, hi] = C.evRange;
  // Medians and winsorized means (±50%): penny stocks falling 90% otherwise dominate plain means.
  const wmean = (xs) => mean(xs.map((v) => Math.max(-0.5, Math.min(0.5, v))));
  const eventStudy = Object.fromEntries(Object.entries(groups).map(([g, f]) => {
    const es = E.filter(f).filter((e) => e.evPath);
    const curve = []; for (let k = 0; k <= hi - lo; k++) { const xs = es.map((e) => e.evPath[k]).filter((v) => v != null); curve.push({ day: lo + k, median: r4(median(xs)), wmean: r4(wmean(xs)), n: xs.length }); }
    return [g, { events: es.length, curve }];
  }));
  // The opening gap: from the last close before entry to the entry open (vs SPY's gap). A filing
  // follower buys AT this open, so any reaction inside the gap is already gone.
  const spyB = (await loadDailyBars(["SPY"])).get("SPY");
  const gapOf = (e) => { const sb = spyB.get(e.entryDate), sp = spyB.get(prevSessionOf(e.entryDate)); return e.decisionClose > 0 && e.entryPrice > 0 && sb && sp ? (e.entryPrice / e.decisionClose - 1) - (sb.o / sp.c - 1) : null; };
  const gaps = Object.fromEntries(Object.entries(groups).map(([g, f]) => { const xs = E.filter(f).map(gapOf).filter((v) => v != null);
    const afterHours = E.filter(f).filter((e) => { const t = e.publishedAt.slice(11); return t >= "16:00:00" || t < "09:30:00"; }).map(gapOf).filter((v) => v != null);
    return [g, { n: xs.length, medianGap: r4(median(xs)), wmeanGap: r4(wmean(xs)), afterHoursMedianGap: r4(median(afterHours)), afterHoursShare: r4(afterHours.length / Math.max(1, xs.length)) }]; }));
  // Pre-publication drift: what happened between the trade date and the decision close.
  const drift = Object.fromEntries(Object.entries(groups).map(([g, f]) => { const xs = E.filter(f).map((e) => e.tradeToDecisionExcess).filter((v) => v != null); return [g, { n: xs.length, mean: r4(mean(xs)), median: r4(median(xs)), sessions: r4(median(E.filter(f).map((e) => e.sessionsTradeToEntry).filter((v) => v != null))) }]; }));
  const hyp = results.filter((r) => r.family === "hypothesis");
  // EXPLORATORY (not a decision basis): every pre-registered hypothesis in all three periods, so
  // decay is visible. Promotion decisions above used train only.
  const hypothesesAllSplits = HYP.map(([name, f]) => { const es = E.filter(f); return { name, byH: Object.fromEntries([5, 10, 20].map((H) => [H, Object.fromEntries(["train", "validation", "test"].map((sp) => [sp, stat(es, H, sp)]))])) }; });
  const famCounts = results.reduce((m, r) => ((m[r.family] = (m[r.family] || 0) + 1), m), {});
  const topTrain = results.filter((r) => PRIMARY.includes(r.horizon) && r.train.n >= 60 && r.train.issuers >= 30).sort((a, b) => (a.train.pAbn ?? 1) - (b.train.pAbn ?? 1)).slice(0, 25)
    .map((r) => ({ id: r.id, family: r.family, name: r.name, horizon: r.horizon, train: r.train, passTrain: r.passTrain, validation: r.validation || null, passValidation: !!r.passValidation, test: r.test || null, supported: !!r.supported, supportedVsSpy: !!r.supportedVsSpy }));
  const rapp = C.events.filter((e) => e.ticker === "RAPP").map((e) => ({ publishedAt: e.publishedAt, insider: e.insider, filingValue: Math.round(e.filingValue), ownership: e.ownership, venue: e.venue, priceVsTradePrevClose: r4(e.priceVsTradePrevClose), dd60: r4(e.dd60), ratioToMaxPrior30: r4(e.ratioToMaxPrior30), priorOtherBuyers30: e.priorOtherBuyers30, postTradeMove: r4(e.postTradeMove), tradeToDecisionExcess: e.tradeToDecisionExcess, entryDate: e.entryDate, h: e.h }));
  const h24 = E.filter(HYP.find(([n]) => n.startsWith("H24"))[1]).map((e) => ({ ticker: e.ticker, publishedAt: e.publishedAt, filingValue: Math.round(e.filingValue), h10: e.h?.[10], h20: e.h?.[20] }));
  const featureCoverage = Object.fromEntries([...NUM, ...BOOL].map((k) => [k, r4(E.filter((e) => e[k] != null && (typeof e[k] !== "number" || Number.isFinite(e[k]))).length / E.length)]));
  save("G", { audit: A, companies: B.companies, counts: Ex.counts, famCounts, splitCounts: Ex.splitCounts, coverage: Ex.coverage, baseline: Ex.baseline, promoted: Ex.promoted, decay: Ex.decay,
    hypotheses: hyp.map((r) => ({ name: r.name, horizon: r.horizon, train: r.train, passTrain: r.passTrain, validation: r.validation || null, passValidation: !!r.passValidation, test: r.test || null, supported: !!r.supported })),
    topTrain, eventStudy, gaps, hypothesesAllSplits, drift, ridgeWeights: D.ridgeWeights, treeLeaves: D.leaves, rapp, rappLike: h24, featureCoverage,
    protocol: { HORIZONS, PRIMARY, VAL_START, TEST_START, promotion: "train BH q<0.10 (all tests), n≥60, issuers≥30 → validation same sign p<0.05 n≥30 → test once", costs: "liquidity-tiered per side (5/15/35/75/100 bps)", entry: "first regular-session open ≥ SEC acceptance + 60 s" },
    events: { total: C.events.length, priced: E.length } });
}
log("done");
