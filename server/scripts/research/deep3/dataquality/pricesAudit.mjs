// deep3/dataquality/pricesAudit.mjs — price-side inventory and quality audit (READ-ONLY, cache only, no network).
//   node --max-old-space-size=6144 scripts/research/deep3/dataquality/pricesAudit.mjs
// Needs p-filings.json from secAudit.mjs. Holdout filings (published ≥ 2026-09-01): only bar AVAILABILITY is checked
// (inventory); no returns, no stage-C fields, no split inference, no after-hours trade content.
// Outputs: prices-audit.json (checkpoint), unpriced.json (deliverable).
import fs from "node:fs";
import path from "node:path";
import { loadBars, loadEvents, loadSecRows } from "../../deep2/lib2.mjs";
import { entrySessionAfter, sym, isSession, previousSession, nextSession } from "../../lib.mjs";

const CWD = process.cwd();
const OUT = path.join(CWD, ".cache", "research", "deep3", "dataquality");
const RES = path.join(CWD, ".cache", "research");
const t0 = Date.now(); const log = (m) => console.log(`[DQ-PX ${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const inc = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; return m; };
const cnt = (arr, f) => arr.reduce((m, x) => inc(m, f(x)), {});
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);
const COMPLETE_THROUGH = "2026-11-03"; // deep-1 stage C: lastCompleteSession() at its run (2026-11-04 05:11 ET)
const SYM_RE = /^[A-Z.]{1,7}$/;       // lib.loadDailyBars only requested symbols matching this
const NICE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 16, 20, 25, 30, 35, 40, 50, 60, 70, 75, 80, 100, 120, 150, 200, 250, 300, 400, 500];
const niceRatio = (x) => { for (const k of NICE) { if (Math.abs(x * k - 1) < 0.06) return `1:${k}`; if (Math.abs(x / k - 1) < 0.06) return `${k}:1`; } for (const [a, b] of [[3, 2], [5, 4], [4, 3], [5, 2], [5, 3]]) { if (Math.abs(x / (a / b) - 1) < 0.03) return `${a}:${b}`; if (Math.abs(x * (a / b) - 1) < 0.03) return `${b}:${a}`; } return null; };

// ---------------- load ----------------
const P = JSON.parse(fs.readFileSync(path.join(OUT, "p-filings.json"), "utf8")).rows;
const rawBars = JSON.parse(fs.readFileSync(path.join(RES, "daily-bars.json"), "utf8"));
const bars = loadBars();
const spy = bars.get("SPY");
const spyDays = spy.arr.map((b) => b.d), spyIdx = new Map(spyDays.map((d, i) => [d, i]));
const secList = JSON.parse(fs.readFileSync(path.join(CWD, ".cache", "company_tickers_exchange.json"), "utf8"));
const secByCik = new Map(); for (const [cik, name, ticker, exch] of secList.data) (secByCik.get(Number(cik)) || secByCik.set(Number(cik), []).get(Number(cik))).push({ name, ticker, exch: exch || "none" });
const secByTicker = new Map(secList.data.map(([cik, , t, x]) => [sym(t), { cik: Number(cik), exch: x || "none" }]));
const evNH = new Map(loadEvents({ includeUnpriced: true }).map((e) => [e.accessionNo, e])); // non-holdout only
log(`p-filings ${P.length}, bar symbols ${bars.size}, SEC ticker rows ${secList.data.length}`);

// ---------------- 1. daily-bar cache inventory and quality ----------------
const symKeys = Object.keys(rawBars).filter((k) => k !== "__meta");
const nonEmpty = symKeys.filter((k) => Array.isArray(rawBars[k]) && rawBars[k].length);
let totalBars = 0, zeroVol = 0, badOhlc = 0, nonPositive = 0; const zeroVolSyms = new Map(), gapSyms = [];
const firsts = [], lasts = [];
const extreme = [];
for (const k of nonEmpty) {
  const s = bars.get(k); const a = s.arr; totalBars += a.length;
  firsts.push(a[0].d); lasts.push(a.at(-1).d);
  let zv = 0;
  for (let i = 0; i < a.length; i++) {
    const b = a[i];
    if (!(b.v > 0)) zv++;
    if (!(b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0)) nonPositive++;
    else if (b.h < b.l || b.o > b.h * 1.0001 || b.o < b.l * 0.9999 || b.c > b.h * 1.0001 || b.c < b.l * 0.9999) badOhlc++;
    if (i > 0 && a[i - 1].c > 0 && Math.abs(b.c / a[i - 1].c - 1) > 0.75) extreme.push({ symbol: k, date: b.d, move: r4(b.c / a[i - 1].c - 1), next: a[i + 1] ? r4(a[i + 1].c / b.c - 1) : null });
  }
  if (zv) { zeroVol += zv; zeroVolSyms.set(k, zv); }
  // gaps: sessions (SPY calendar) between the first and last bar with no bar
  const i0 = spyIdx.get(a[0].d), i1 = spyIdx.get(a.at(-1).d);
  if (i0 != null && i1 != null) { const expected = i1 - i0 + 1, missing = expected - a.filter((b) => spyIdx.has(b.d)).length; if (missing > 0) { let longest = 0, run = 0; for (let j = i0; j <= i1; j++) { if (!s.idx.has(spyDays[j])) { run++; longest = Math.max(longest, run); } else run = 0; } gapSyms.push({ symbol: k, missingSessions: missing, longestRun: longest, bars: a.length }); } }
}
const suspect = extreme.filter((e) => e.next != null && Math.abs(e.next) > 0.4);
const stageA = JSON.parse(fs.readFileSync(path.join(RES, "deep", "stageA.json"), "utf8"));
const barsQuality = {
  meta: rawBars.__meta, symbols: symKeys.length, nullSymbols: symKeys.filter((k) => rawBars[k] === null).length, emptySeries: symKeys.length - nonEmpty.length, withBars: nonEmpty.length,
  firstBarRange: [firsts.sort()[0], firsts.at(-1)], lastBarRange: [lasts.sort()[0], lasts.at(-1)], spySessions: spyDays.length, spyRange: [spyDays[0], spyDays.at(-1)],
  seriesStartingAfter20251010: firsts.filter((d) => d > "2025-10-10").length, seriesEndingBefore20261103: lasts.filter((d) => d < "2026-11-03").length,
  totalBars, zeroVolumeBars: zeroVol, symbolsWithZeroVolumeBars: zeroVolSyms.size, topZeroVolume: [...zeroVolSyms].sort((a, b) => b[1] - a[1]).slice(0, 10),
  nonPositivePriceBars: nonPositive, inconsistentOhlcBars: badOhlc,
  symbolsWithGaps: gapSyms.length, missingSymbolSessions: gapSyms.reduce((a, g) => a + g.missingSessions, 0), gapRunsOver5Sessions: gapSyms.filter((g) => g.longestRun > 5).length,
  worstGaps: gapSyms.sort((a, b) => b.missingSessions - a.missingSessions).slice(0, 12),
  extremeMoves: { count: extreme.length, symbols: new Set(extreme.map((e) => e.symbol)).size, suspectReversals: suspect.length, suspectSymbols: [...new Set(suspect.map((e) => e.symbol))].length,
    matchesStageA: extreme.length === stageA.prices.extremeMoves && new Set(extreme.map((e) => e.symbol)).size === stageA.prices.extremeSymbols,
    stageA: { extremeMoves: stageA.prices.extremeMoves, extremeSymbols: stageA.prices.extremeSymbols, suspectSymbols: stageA.prices.suspectSymbols.length, zeroVolumeSymbols: stageA.prices.zeroVolumeSymbols } },
};
log("bars quality done");

// ---------------- 2. price-status reproduction (all stage-C filings; availability only) ----------------
const statusOf = (p) => {
  if (!p.ticker) return { status: "no_ticker" };
  const s = sym(p.ticker);
  if (!SYM_RE.test(s)) return { status: "no_price_data", sub: "symbol_not_requested_malformed", symbol: s };
  if (!(s in rawBars)) return { status: "no_price_data", sub: "symbol_not_in_cache", symbol: s };
  if (rawBars[s] === null) return { status: "unsupported_symbol", symbol: s };
  const entry = entrySessionAfter(p.publishedAt, 60);
  if (entry > COMPLETE_THROUGH) return { status: "entry_pending", symbol: s, entry };
  const ser = bars.get(s);
  if (!ser.arr.length) return { status: "no_entry_bar", sub: "empty_series", symbol: s, entry };
  if (!ser.idx.has(entry) || !spy.idx.has(entry)) {
    const sub = entry < ser.arr[0].d ? "entry_before_first_bar" : entry > ser.arr.at(-1).d ? "entry_after_last_bar" : "gap_on_entry_date";
    return { status: "no_entry_bar", sub, symbol: s, entry, firstBar: ser.arr[0].d, lastBar: ser.arr.at(-1).d };
  }
  return { status: "ok", symbol: s, entry };
};
const C = P.filter((p) => p.inStageC);
let mismatch = 0; const mismatches = [];
for (const p of C) {
  p.px = statusOf(p);
  if (p.period !== "holdout") { const ev = evNH.get(p.acc); if (ev && ev.priceStatus !== p.px.status) { mismatch++; if (mismatches.length < 10) mismatches.push({ acc: p.acc, lib2: ev.priceStatus, reproduced: p.px.status }); } }
}
log(`status reproduction: mismatches vs lib2 (non-holdout) = ${mismatch}`);

// ---------------- 3. unpriced taxonomy and recoverability ----------------
const exchListed = (x) => ["Nasdaq", "NYSE", "CBOE", "TXSE"].includes(x);
const hasEntryBar = (s, entry) => { const ser = bars.get(s); return !!(ser && ser.idx.has(entry)); };
const looksForeign = (t) => /\d/.test(t) || /\.(TO|V|L|HK|AX|SA|MX|PA|DE|SW|T)$/i.test(t);
const looksClass = (t) => /^[A-Z]{1,5}[.\-/ ][A-Z]{1,2}$/.test(String(t).toUpperCase().trim());
function classify(p) {
  const st = p.px, secRows = secByCik.get(p.cik) || [];
  const listed = secRows.filter((x) => exchListed(x.exch)), otc = secRows.filter((x) => x.exch === "OTC");
  const tags = [];
  if (p.ticker && looksClass(p.tickerReported || p.ticker)) tags.push("class_share_symbol");
  if (p.ticker && looksForeign(p.ticker)) tags.push("foreign_looking_symbol");
  // prefer common-stock-like alternatives (no class suffix); preferred / unit / warrant tickers are a class mismatch
  // unless the reported security itself is that class
  const isCommonLike = (t) => !/[.-]/.test(t);
  // the reported security decides the class: preferred / depositary / unit / warrant / right, or a ticker-like title ending in P (e.g. "SQFTP")
  const prefSecurity = /prefer|depositary|units?|warrant|right/i.test(p.security || "") || /^[A-Z]{3,6}P[A-Z]?$/.test(String(p.security || "").trim());
  const altAll = listed.map((x) => sym(x.ticker)).filter((t) => t !== (p.ticker ? sym(p.ticker) : null));
  const alt = altAll.filter((t) => (prefSecurity ? !isCommonLike(t) : isCommonLike(t)));
  const classMismatch = altAll.length > 0 && alt.length === 0;
  const entry = st.entry || entrySessionAfter(p.publishedAt, 60);
  const altWithBar = alt.find((t) => hasEntryBar(t, entry)) || null;
  const altInCache = alt.find((t) => t in rawBars) || null;
  let reason, recover;
  if (st.status === "no_ticker") {
    if (listed.length) { reason = "no_ticker:issuer_has_exchange_listed_SEC_ticker"; recover = altWithBar ? "map_ticker_bars_already_cached" : "map_ticker_then_download_daily_bars"; }
    else if (otc.length) { reason = "no_ticker:issuer_ticker_is_OTC"; recover = "not_on_alpaca_sip"; }
    else if (secRows.length) { reason = "no_ticker:issuer_ticker_no_exchange"; recover = "not_on_alpaca_sip"; }
    else { reason = "no_ticker:issuer_not_in_SEC_ticker_list (non-traded fund/BDC/REIT/LLC or delisted)"; recover = "unrecoverable"; }
  } else if (st.status === "no_price_data") {
    if (altWithBar) { reason = `${st.sub}:issuer_has_other_cached_ticker`; recover = "map_ticker_bars_already_cached"; }
    else if (listed.length) { reason = `${st.sub}:issuer_has_exchange_listed_SEC_ticker`; recover = "map_ticker_then_download_daily_bars"; }
    else if (otc.length) { reason = `${st.sub}:issuer_ticker_is_OTC`; recover = "not_on_alpaca_sip"; }
    else { reason = `${st.sub}:no_SEC_ticker`; recover = "unrecoverable"; }
  } else if (st.status === "no_entry_bar") {
    if (st.sub === "empty_series") {
      const tx = secByTicker.get(st.symbol);
      if (altWithBar) { reason = "empty_series:issuer_has_other_cached_ticker (ticker change)"; recover = "map_ticker_bars_already_cached"; }
      else if (tx && tx.exch === "OTC") { reason = "empty_series:symbol_is_OTC"; recover = "not_on_alpaca_sip"; }
      else if (!tx && otc.length && !listed.length) { reason = "empty_series:issuer_ticker_is_OTC"; recover = "not_on_alpaca_sip"; }
      else if (listed.length && alt.length) { reason = "empty_series:issuer_listed_under_other_ticker (ticker change)"; recover = "map_ticker_then_download_daily_bars"; }
      else if (tx && exchListed(tx.exch)) { reason = "empty_series:exchange_listed_symbol_without_alpaca_bars"; recover = "investigate_symbol"; }
      else if (looksForeign(st.symbol)) { reason = "empty_series:foreign_symbol"; recover = "not_on_alpaca_sip"; }
      else { reason = "empty_series:symbol_not_in_SEC_list (delisted before Oct 2025 or non-traded)"; recover = "unrecoverable"; }
    } else if (st.sub === "entry_before_first_bar") {
      const days = Math.round((Date.parse(st.firstBar) - Date.parse(entry)) / 86_400_000);
      reason = days <= 45 ? "series_starts_after_entry:new_listing_within_45d" : "series_starts_after_entry:later_listing_or_symbol_reuse"; recover = "needs_entry_rule (first tradable session) not data";
      p.listingGapDays = days;
    } else if (st.sub === "entry_after_last_bar") {
      if (altWithBar) { reason = "series_ends_before_entry:issuer_has_other_cached_ticker (ticker change)"; recover = "map_ticker_bars_already_cached"; }
      else if (listed.length && alt.length) { reason = "series_ends_before_entry:issuer_listed_under_other_ticker (ticker change)"; recover = "map_ticker_then_download_daily_bars"; }
      else if (otc.length) { reason = "series_ends_before_entry:moved_to_OTC"; recover = "not_on_alpaca_sip"; }
      else { reason = "series_ends_before_entry:delisted_or_acquired"; recover = "unrecoverable"; }
    } else { reason = "gap_on_entry_date:halted_or_no_trade"; recover = "use_next_bar_rule_or_minute_data"; }
  } else if (st.status === "entry_pending") { reason = "entry_pending"; recover = "time"; }
  else if (st.status === "unsupported_symbol") { reason = "unsupported_symbol"; recover = "unrecoverable"; }
  if (classMismatch && (recover === "map_ticker_bars_already_cached" || recover === "map_ticker_then_download_daily_bars")) { recover = "class_mismatch_check_security_title"; reason += " [only preferred/other-class tickers listed]"; }
  return { reason, recover, tags, security: p.security || null, altTicker: altWithBar || alt[0] || null, altInCache, secExchanges: [...new Set(secRows.map((x) => x.exch))] };
}
const unpriced = [];
for (const p of C) if (p.px.status !== "ok") { const c = classify(p); unpriced.push({ acc: p.acc, period: p.period, publishedAt: p.publishedAt, cik: p.cik, issuer: p.issuer, ticker: p.ticker, tickerReported: p.tickerReported, form: p.form, cls: p.cls, filingValue: p.filingValue, status: p.px.status, sub: p.px.sub || null, symbol: p.px.symbol || null, entry: p.px.entry || null, firstBar: p.px.firstBar || null, lastBar: p.px.lastBar || null, ...c }); }
const classShare = C.filter((p) => p.ticker && looksClass(p.tickerReported || p.ticker));
const byPeriodStatus = {}; for (const p of C) inc(byPeriodStatus[p.period] || (byPeriodStatus[p.period] = {}), p.px.status);
const priceCoverage = {
  stageCFilings: C.length, priced: C.filter((p) => p.px.status === "ok").length, unpriced: unpriced.length, shareOfStageCPriced: r4(C.filter((p) => p.px.status === "ok").length / C.length),
  shareOfAllPFilingsPriced: r4(C.filter((p) => p.px.status === "ok").length / P.length), byPeriodStatus,
  statusReproduction: { nonHoldoutMismatchesVsLib2: mismatch, examples: mismatches },
  unpricedByStatus: cnt(unpriced, (u) => u.status), unpricedBySub: cnt(unpriced, (u) => `${u.status}${u.sub ? ":" + u.sub : ""}`), unpricedByReason: cnt(unpriced, (u) => u.reason), unpricedByRecovery: cnt(unpriced, (u) => u.recover),
  unpricedTags: cnt(unpriced.flatMap((u) => u.tags), (t) => t),
  classShareFilings: { total: classShare.length, priced: classShare.filter((p) => p.px.status === "ok").length, examples: [...new Set(classShare.map((p) => p.tickerReported || p.ticker))].slice(0, 15) },
  unpricedByClassV2: cnt(unpriced.filter((u) => u.period !== "holdout"), (u) => u.cls || "unclassified"),
  unpricedSymbolsDistinct: new Set(unpriced.map((u) => u.symbol).filter(Boolean)).size,
};
log("unpriced taxonomy done");

// ---------------- 4. corporate actions: splits (exact, from raw caches) ----------------
const rawSources = [];
try { const a = JSON.parse(fs.readFileSync(path.join(RES, "deep", "ah-raw-daily.json"), "utf8")); for (const [s, v] of Object.entries(a)) rawSources.push({ src: "deep/ah-raw-daily.json", s, closes: new Map(v.map(([d, x]) => [d, x.c])) }); } catch { /* none */ }
for (const dir of ["alpaca-daily-raw"]) { const D = path.join(CWD, ".cache", "prices", dir); if (!fs.existsSync(D)) continue; for (const f of fs.readdirSync(D)) { try { const j = JSON.parse(fs.readFileSync(path.join(D, f), "utf8")); rawSources.push({ src: `prices/${dir}`, s: sym(j.symbol || f.replace(/\.json$/, "")), closes: new Map(Object.entries(j.closes || {})) }); } catch { /* skip */ } } }
const exact = new Map(); // symbol → { src, dates, splits: [{after, before, ratio}], factorByDate }
for (const r of rawSources) {
  const ser = bars.get(r.s); if (!ser || !ser.arr.length) continue;
  const pts = []; for (const b of ser.arr) { const rc = r.closes.get(b.d); if (rc > 0 && b.c > 0) pts.push([b.d, rc / b.c]); }
  if (pts.length < 5) continue;
  const splits = []; for (let i = 1; i < pts.length; i++) { const q = pts[i][1] / pts[i - 1][1]; if (Math.abs(q - 1) > 0.04) splits.push({ lastDateOldBasis: pts[i - 1][0], firstDateNewBasis: pts[i][0], factorBefore: r4(pts[i - 1][1]), factorAfter: r4(pts[i][1]), ratio: niceRatio(pts[i - 1][1] / pts[i][1]) || r4(pts[i - 1][1] / pts[i][1]) }); }
  const prev = exact.get(r.s);
  if (!prev || pts.length > prev.n) exact.set(r.s, { src: r.src, n: pts.length, from: pts[0][0], to: pts.at(-1)[0], splits, factor: new Map(pts), lastFactor: pts.at(-1)[1] });
}
const exactSyms = [...exact.values()];
const splitsExact = { rawSymbolsCompared: exact.size, symbolsWithSplitInWindow: exactSyms.filter((x) => x.splits.length).length,
  splitEvents: exactSyms.flatMap((x) => x.splits.map((s) => ({ symbol: [...exact.entries()].find(([, v]) => v === x)[0], ...s }))).slice(0, 60),
  reverseSplits: exactSyms.flatMap((x) => x.splits).filter((s) => s.factorBefore < s.factorAfter).length, forwardSplits: exactSyms.flatMap((x) => x.splits).filter((s) => s.factorBefore > s.factorAfter).length,
  lastFactorNot1: exactSyms.filter((x) => Math.abs(x.lastFactor - 1) > 0.02).length };

// ---------------- 5. split contamination of stage-C level fields (non-holdout only) ----------------
const NH = C.filter((p) => p.period !== "holdout" && p.px.status === "ok");
const inferRatio = (p) => { const ser = bars.get(p.px.symbol); if (!ser || !(p.price > 0)) return null; let i = ser.idx.get(p.tradeDate); if (i == null) i = (() => { let lo = 0, hi = ser.arr.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (ser.arr[m].d < p.tradeDate) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; })(); return i < 0 ? null : ser.arr[i].c / p.price; };
const fields = ["priceVsTradePrevClose", "insiderPremium", "priceLevel", "prevClose", "priceVsPrevClose", "entryPrice", "spyEntry"];
let inferRev = 0, inferFwd = 0, inferNone = 0, inferNA = 0; const fieldAffected = Object.fromEntries(fields.map((f) => [f, 0]));
const confusion = { exactSplitAfterTrade_inferred: 0, exactSplitAfterTrade_missed: 0, noExactSplit_inferred: 0, noExactSplit_notInferred: 0, missedRatios: {} };
const affectedList = [];
for (const p of NH) {
  const r = inferRatio(p); const ev = evNH.get(p.acc);
  let grp = r == null ? "na" : r > 1.8 ? "futureReverseSplit" : r < 0.55 ? "futureForwardSplit" : "none";
  if (grp === "na") inferNA++; else if (grp === "futureReverseSplit") inferRev++; else if (grp === "futureForwardSplit") inferFwd++; else inferNone++;
  const ex = exact.get(p.px.symbol);
  let exactF = null;
  if (ex) { exactF = ex.factor.get(p.tradeDate) ?? null; if (exactF == null) { const ds = [...ex.factor.keys()].filter((d) => d <= p.tradeDate); exactF = ds.length ? ex.factor.get(ds.at(-1)) : null; } }
  if (exactF != null && ex.from <= p.tradeDate) {
    const split = Math.abs(exactF / ex.lastFactor - 1) > 0.04, inferred = grp === "futureReverseSplit" || grp === "futureForwardSplit";
    if (split && inferred) confusion.exactSplitAfterTrade_inferred++; else if (split) { confusion.exactSplitAfterTrade_missed++; inc(confusion.missedRatios, niceRatio(exactF / ex.lastFactor) || String(r4(exactF / ex.lastFactor))); }
    else if (inferred) confusion.noExactSplit_inferred++; else confusion.noExactSplit_notInferred++;
  }
  if (grp === "futureReverseSplit" || grp === "futureForwardSplit") {
    for (const f of fields) if (ev && ev[f] != null) fieldAffected[f]++;
    if (affectedList.length < 40) affectedList.push({ acc: p.acc, ticker: p.ticker, tradeDate: p.tradeDate, reportedPrice: p.price, adjustedCloseOnTradeDate: r4(r * p.price), ratio: r4(r), group: grp, priceLevel: ev?.priceLevel ?? null });
  }
}
const splitContamination = {
  scope: "non-holdout priced stage-C events (holdout not evaluated)", n: NH.length,
  inferredFromInsiderPrice: { futureReverseSplit: inferRev, futureForwardSplit: inferFwd, noSplit: inferNone, notComputable: inferNA, rule: "ratio = split-adjusted close on the trade date ÷ reported price; > 1.8 reverse, < 0.55 forward (deep-2 audit A5 / execLib.adjFactor)" },
  inferenceVsExactRawData: confusion,
  stageCFieldsMixingRawAndAdjusted: {
    priceVsTradePrevClose: "reported (raw) price ÷ split-adjusted prior close: encodes future splits",
    insiderPremium: "split-adjusted last close ÷ raw filing VWAP: encodes future splits",
    priceVsPrevClose: "lib.priceEvent: raw price ÷ split-adjusted prevClose: encodes future splits",
    priceLevel: "split-adjusted level in Nov-2026 share terms (not as traded)",
    prevClose: "split-adjusted level (not as traded)",
    entryPrice: "split-adjusted level; returns (ratios) are correct, the level is not as traded",
    "h[N].exitPrice": "split-adjusted level; ratios correct",
    unaffected: "all returns (gross/net/excess/maxDrawdown/maxFavorable), dollar volume (price×volume invariant), ret5/ret20/vol20 and other ratio features",
  },
  eventsWithNonNullFieldAmongSplitInferred: fieldAffected, examples: affectedList,
};
log("split audit done");

// ---------------- 6. holdings breaks consistent with a split (P and S rows, same owner/issuer/direct line) ----------------
const sec = await loadSecRows();
const lines = new Map();
for (const r of sec.rows) { if (r.own !== "D" || !(r.after >= 0) || !(r.shares > 0) || r.amend === "superseded") continue; const k = `${r.insiderCik}|${r.cik}`; (lines.get(k) || lines.set(k, []).get(k)).push(r); }
let pairs = 0, breaks = 0; const breakList = [], breakRatios = {};
for (const [k, rs] of lines) {
  rs.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.acceptedAt.localeCompare(b.acceptedAt) || a.id.localeCompare(b.id));
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1], b = rs[i]; if (a.tradeDate === b.tradeDate) continue;
    const expected = a.after + (b.code === "P" ? b.shares : -b.shares); pairs++;
    if (!(expected > 0) || !(b.after > 0)) continue;
    const q = b.after / expected, lab = niceRatio(q);
    if (lab && (q > 1.9 || q < 0.52)) { breaks++; inc(breakRatios, lab); if (breakList.length < 30) breakList.push({ line: k, ticker: b.ticker, from: a.tradeDate, to: b.tradeDate, prevAfter: a.after, shares: b.shares, code: b.code, after: b.after, expected, ratio: lab }); }
  }
}
const holdings = { method: "consecutive direct-ownership rows of one owner CIK at one issuer (P and S, not superseded): after_next vs after_prev ± shares_next; a split-like ratio (≥ 1.9× or ≤ 0.52×, matching a common split ratio) flags an unreported corporate action or a reporting break",
  linePairsChecked: pairs, splitLikeBreaks: breaks, ratios: breakRatios, examples: breakList,
  pRowsAfterLessThanShares: sec.rows.filter((r) => r.code === "P" && r.after != null && r.shares > 0 && r.after < r.shares * 0.999).length,
  pRowsAfterEqualsShares: sec.rows.filter((r) => r.code === "P" && r.after != null && Math.abs(r.after - r.shares) < 0.5).length, pRowsWithAfter: sec.rows.filter((r) => r.code === "P" && r.after != null).length };

// ---------------- 7. ticker changes (issuers reporting several tickers) ----------------
const tByCik = new Map();
for (const r of sec.rows) { if (!r.ticker) continue; const m = tByCik.get(r.cik) || tByCik.set(r.cik, new Map()).get(r.cik); const t = m.get(r.ticker) || m.set(r.ticker, { first: r.acceptedAt, last: r.acceptedAt, rows: 0 }).get(r.ticker); t.rows++; if (r.acceptedAt < t.first) t.first = r.acceptedAt; if (r.acceptedAt > t.last) t.last = r.acceptedAt; }
const multi = [...tByCik].filter(([, m]) => m.size > 1);
const tcat = {}; const tex = [];
for (const [cik, m] of multi) {
  const ts = [...m.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first));
  const roots = new Set(ts.map(([t]) => t.split(/[.\-]/)[0]));
  let cat;
  if (roots.size === 1) cat = "share_class_variants";
  else if (ts.every(([, v], i) => i === 0 || ts[i - 1][1].last <= v.first)) cat = "sequential (ticker change)";
  else cat = "overlapping (inconsistent reporting or several listed classes)";
  inc(tcat, cat);
  const cur = (secByCik.get(cik) || []).map((x) => x.ticker);
  const covered = ts.map(([t]) => { const s = bars.get(sym(t)); return { ticker: t, rows: m.get(t).rows, first: m.get(t).first.slice(0, 10), last: m.get(t).last.slice(0, 10), bars: s?.arr.length || 0, barFrom: s?.arr[0]?.d || null, barTo: s?.arr.at(-1)?.d || null }; });
  if (cat.startsWith("sequential") && tex.length < 25) tex.push({ cik, secCurrent: cur, tickers: covered });
}
const tickerChanges = { issuersWithSeveralTickers: multi.length, byCategory: tcat, sequentialExamples: tex,
  note: "Bars are keyed by the ticker printed on each Form 4. After a ticker change, older filings use the old symbol; Alpaca serves history under the symbol requested, so a series can end at the change (entry_after_last_bar) or start at it (entry_before_first_bar)." };

// ---------------- 8. after-hours trade cache (non-holdout content only) ----------------
const ah = JSON.parse(fs.readFileSync(path.join(RES, "deep", "ah-trades-cache.json"), "utf8"));
const pByAcc = new Map(P.map((p) => [p.acc, p]));
const ahEntries = Object.entries(ah).map(([acc, v]) => ({ acc, v, p: pByAcc.get(acc) }));
const nh = ahEntries.filter((x) => x.p && x.p.period !== "holdout");
const tradeCounts = nh.filter((x) => !x.v.error).map((x) => x.v.trades.length).sort((a, b) => a - b);
const q = (arr, f) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(f * (arr.length - 1)))] : null;
const ahInventory = { entries: ahEntries.length, byPeriod: cnt(ahEntries, (x) => x.p?.period || "unknown"), byWindow: cnt(ahEntries, (x) => x.p?.window || "unknown"),
  nonHoldout: { entries: nh.length, errors: nh.filter((x) => x.v.error).length, emptyTrades: nh.filter((x) => !x.v.error && !x.v.trades.length).length, truncatedAt3Pages: nh.filter((x) => x.v.truncated).length,
    eligibleTradesTotal: tradeCounts.reduce((a, b) => a + b, 0), eligibleTradesPerFiling: { p25: q(tradeCounts, 0.25), median: q(tradeCounts, 0.5), p75: q(tradeCounts, 0.75), p90: q(tradeCounts, 0.9), max: tradeCounts.at(-1) },
    publishedRange: [nh.map((x) => x.p.publishedAt).sort()[0], nh.map((x) => x.p.publishedAt).sort().at(-1)] },
  holdoutEntries: ahEntries.filter((x) => x.p?.period === "holdout").length,
  note: "trades are stored after the eligibility filter (no odd lots, no excluded conditions); fetch was capped at 3 pages × 1,000 trades; holdout entries counted only" };

// ---------------- 9. .cache/prices inventory (read-only) ----------------
const PR = path.join(CWD, ".cache", "prices");
const prFiles = fs.readdirSync(PR);
const dirInv = (d) => { const D = path.join(PR, d); const fs_ = fs.readdirSync(D); let from = null, to = null, n = 0; for (const f of fs_) { try { const j = JSON.parse(fs.readFileSync(path.join(D, f), "utf8")); const ks = Object.keys(j.closes || {}).sort(); n += ks.length; if (ks.length) { if (!from || ks[0] < from) from = ks[0]; if (!to || ks.at(-1) > to) to = ks.at(-1); } } catch { /* skip */ } } return { files: fs_.length, closes: n, from, to }; };
const pubEntries = JSON.parse(fs.readFileSync(path.join(PR, "_publication-entries.v1.json"), "utf8"));
const pricesDir = { csvTiingo: prFiles.filter((f) => f.endsWith(".csv")).length, metaTiingo: prFiles.filter((f) => f.endsWith(".meta.json")).length, licence: "Tiingo — internal use only (per _fetch-manifest.json)",
  alpacaDailyRaw: dirInv("alpaca-daily-raw"), alpacaDailySplit: dirInv("alpaca-daily-split"),
  publicationEntriesV1: { keys: Object.keys(pubEntries).length, statuses: cnt(Object.values(pubEntries), (v) => v.primary?.status || v.status || "?") },
  otherFiles: prFiles.filter((f) => f.startsWith("_")) };

const out = { builtAt: new Date().toISOString(), completeThrough: COMPLETE_THROUGH, barsQuality, priceCoverage, splitsExact, splitContamination, holdings, tickerChanges, ahInventory, pricesDir };
fs.writeFileSync(path.join(OUT, "prices-audit.json"), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(OUT, "unpriced.json"), JSON.stringify({ builtAt: out.builtAt, note: "one row per unpriced stage-C purchase filing (all periods; holdout rows show bar availability only)", summary: priceCoverage, rows: unpriced }, null, 1));
// per-filing price status checkpoint for the download-scope step
fs.writeFileSync(path.join(OUT, "p-status.json"), JSON.stringify(C.map((p) => ({ acc: p.acc, status: p.px.status, sub: p.px.sub || null, symbol: p.px.symbol || null, entry: p.px.entry || null }))));
log(`done: priced ${priceCoverage.priced}/${C.length}; unpriced ${JSON.stringify(priceCoverage.unpricedByStatus)}`);
