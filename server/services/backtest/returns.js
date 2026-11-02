// server/services/backtest/returns.js
//
// Forward returns of point-in-time signals (signals.js) from DAILY bars of a
// configured price provider (services/stockData/stockDataProvider.js). Pure
// except for the provider calls. Nothing is estimated: a return that cannot be
// computed from real bars is reported as pending or excluded, with the reason.
//
// Rules
//   Sessions   The benchmark's bars define which sessions existed (fallback for
//              planning without prices: sessionCalendar.js).
//   Entry      OPEN of the first session that opens at or after the SEC
//              acceptance time (before 09:30 ET → same day; during the session,
//              after the close, weekend or holiday → next session).
//   Horizons   Counted in SESSIONS from the entry session (entry session = 1):
//              7D = 5, 30D = 21, 90D = 63, 180D = 126 sessions. Exit = CLOSE of
//              the last session of the horizon.
//   Prices     Split/dividend-adjusted: adjClose as delivered by the provider;
//              adjusted open = open × adjClose / close of the same bar.
//   Costs      Optional commission + slippage, in basis points PER SIDE:
//              net = exit×(1−c) / (entry×(1+c)) − 1.
//   Benchmark  Same entry open / exit close dates on the benchmark (no costs);
//              excess = net − benchmark.
//   Missing    No bar on the entry session → excluded (no_entry_price).
//              Exit session after the latest benchmark bar → pending (window not
//              complete yet). Stock bars ending before the exit session while the
//              benchmark continues → delisted_or_data_ended: excluded (default) or,
//              with delistingPolicy "last_close", valued at the last available
//              close and flagged. A missing bar on the exit date uses the latest
//              bar within 5 sessions before it, else missing_exit_price.
//   Drawdown   Per signal: worst peak-to-trough of adjusted closes from entry to
//              the longest complete horizon. Portfolio: of the equity curve.
//   Equity     Equal-weight, daily-rebalanced portfolio of all open positions for
//              the selected horizon (cash, 0 %, on days with none); costs charged
//              on entry and exit days. Benchmark curve = buy-and-hold over the
//              same sessions.

import { entrySessionFor, lastClosedSession } from "./sessionCalendar.js";

export const HORIZONS = [
  { key: "7d", label: "7D", sessions: 5 },
  { key: "30d", label: "30D", sessions: 21 },
  { key: "90d", label: "90D", sessions: 63 },
  { key: "180d", label: "180D", sessions: 126 },
];
const EXIT_STALE_SESSIONS = 5;
const round6 = (n) => (n == null ? null : Math.round(n * 1e6) / 1e6);
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// Keep only usable bars (sorted, unique dates, positive prices, adjClose present).
export function cleanBars(bars = []) {
  const flags = { dropped: 0, missingAdjusted: 0 };
  const byDate = new Map();
  for (const b of bars) {
    if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) { flags.dropped++; continue; }
    const ok = [b.open, b.close, b.adjClose].every((v) => Number.isFinite(v) && v > 0);
    if (!ok) { if (!(b.adjClose > 0)) flags.missingAdjusted++; flags.dropped++; continue; }
    byDate.set(b.date, b);
  }
  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { bars: out, flags };
}

const adjOpen = (b) => b.open * (b.adjClose / b.close);

function indexBars(bars) {
  const idx = new Map();
  bars.forEach((b, i) => idx.set(b.date, i));
  return idx;
}
// Latest bar with date <= d (binary search) → index or -1.
function floorBar(bars, d) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].date <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function maxDrawdown(values) {
  let peak = -Infinity, mdd = 0;
  for (const v of values) { if (v > peak) peak = v; if (peak > 0) mdd = Math.min(mdd, v / peak - 1); }
  return mdd;
}

// One signal × one horizon. sessions: benchmark dates; si: session index map.
function horizonResult({ entryIdx, entry, stock, bench, sessions, h, costRate, delistingPolicy }) {
  const exitIdx = entryIdx + h.sessions - 1;
  if (exitIdx >= sessions.length) return { status: "pending", exitDate: null };
  const exitDate = sessions[exitIdx];
  const stockLast = stock.bars[stock.bars.length - 1];
  let exitBar = null, flag = null;
  const fi = floorBar(stock.bars, exitDate);
  if (stockLast.date < exitDate) {
    // Stock data ends before the exit session while sessions continue.
    if (delistingPolicy !== "last_close") return { status: "excluded", reason: "delisted_or_data_ended", exitDate, lastPriceDate: stockLast.date };
    exitBar = stockLast; flag = "valued_at_last_close";
  } else if (fi >= 0 && stock.bars[fi].date === exitDate) {
    exitBar = stock.bars[fi];
  } else if (fi >= 0 && sessions.indexOf(stock.bars[fi].date) >= exitIdx - EXIT_STALE_SESSIONS) {
    exitBar = stock.bars[fi]; flag = "stale_exit_price";
  } else {
    return { status: "excluded", reason: "missing_exit_price", exitDate };
  }
  const gross = exitBar.adjClose / entry - 1;
  const net = (exitBar.adjClose * (1 - costRate)) / (entry * (1 + costRate)) - 1;
  const bEntry = bench.bars[bench.idx.get(sessions[entryIdx])];
  const bExit = bench.bars[bench.idx.get(exitDate)];
  const benchmark = bEntry && bExit ? bExit.adjClose / adjOpen(bEntry) - 1 : null;
  return {
    status: "complete", exitDate, exitPriceDate: exitBar.date, exitPrice: round6(exitBar.adjClose), flag,
    gross: round6(gross), net: round6(net), benchmark: round6(benchmark), excess: benchmark == null ? null : round6(net - benchmark),
  };
}

// Plan entries only (no prices): what the engine WOULD do.
export function planWithoutPrices(signals) {
  return signals.map((s) => ({ ...s, entryDate: entrySessionFor(s.publishedAt), entryBasis: "calendar", status: "price_data_required", entryPrice: null, horizons: {} }));
}

// → { results, stats, equity }
export async function evaluateSignals({ signals, provider, benchmarkSymbol, config = {}, onProgress = () => {} }) {
  const costRate = ((Number(config.commissionBps) || 0) + (Number(config.slippageBps) || 0)) / 10_000;
  const delistingPolicy = config.delistingPolicy === "last_close" ? "last_close" : "exclude";
  const equityHorizon = HORIZONS.find((h) => h.key === config.equityHorizon) || HORIZONS[2];
  if (!signals.length) return { results: [], stats: summarize([], costRate), equity: null, benchmark: { symbol: benchmarkSymbol } };

  const firstPub = signals[0].publishedDate;
  const lookback = Number(config.priorLookbackSessions) || 63;
  const from = addDays(firstPub, -Math.ceil(lookback * 1.6) - 10);
  const to = addDays(signals[signals.length - 1].publishedDate, 400);

  onProgress({ stage: "benchmark", done: 0, total: signals.length });
  const benchClean = cleanBars(await provider.getDailyBars(benchmarkSymbol, { from, to }));
  if (!benchClean.bars.length) {
    const err = new Error(`No benchmark bars for ${benchmarkSymbol}`); err.code = "NO_BENCHMARK"; throw err;
  }
  const bench = { bars: benchClean.bars, idx: indexBars(benchClean.bars) };
  const sessions = bench.bars.map((b) => b.date);
  const lastSession = sessions[sessions.length - 1];

  const symbolCache = new Map();
  const results = [];
  let done = 0;
  for (const s of signals) {
    done++;
    if (done % 10 === 0) onProgress({ stage: "prices", done, total: signals.length });
    const base = { ...s, entryDate: null, entryPrice: null, horizons: {}, drawdown: null, flags: [] };
    const plannedEntry = entrySessionFor(s.publishedAt);
    if (!plannedEntry) { results.push({ ...base, status: "excluded", reason: "no_acceptance_time" }); continue; }
    if (plannedEntry > lastSession) { results.push({ ...base, entryDate: plannedEntry, status: "pending", reason: "entry_after_price_data" }); continue; }
    const entryIdx = sessions.findIndex((d) => d >= plannedEntry);
    if (entryIdx < 0) { results.push({ ...base, status: "pending", reason: "entry_after_price_data" }); continue; }
    if (sessions[entryIdx] !== plannedEntry) base.flags.push("calendar_mismatch");
    const entryDate = sessions[entryIdx];

    let symbol = null;
    try { symbol = await provider.resolveSymbol({ cik: s.issuerCik, ticker: s.ticker, asOf: s.publishedDate }); } catch { symbol = null; }
    if (!symbol) { results.push({ ...base, entryDate, status: "excluded", reason: "no_price_symbol" }); continue; }
    if (!symbolCache.has(symbol)) {
      let raw = [];
      try { raw = await provider.getDailyBars(symbol, { from, to }); } catch { raw = []; }
      const c = cleanBars(raw);
      symbolCache.set(symbol, { bars: c.bars, idx: indexBars(c.bars), flags: c.flags });
    }
    const stock = symbolCache.get(symbol);
    base.symbol = symbol;
    if (!stock.bars.length) { results.push({ ...base, entryDate, status: "excluded", reason: "no_price_data" }); continue; }
    const eBar = stock.bars[stock.idx.get(entryDate)];
    if (!eBar) {
      const reason = stock.bars[stock.bars.length - 1].date < entryDate ? "delisted_before_entry" : "no_entry_price";
      results.push({ ...base, entryDate, status: "excluded", reason }); continue;
    }
    const entry = adjOpen(eBar);

    // Optional point-in-time filters (prices known at the disclosure time only).
    const closedDay = lastClosedSession(s.publishedAt);
    const ci = floorBar(stock.bars, closedDay);
    if (config.minPriorDecline != null) {
      const bi = sessions.findIndex((d) => d >= (stock.bars[ci]?.date || "9999"));
      const pastDate = bi - lookback >= 0 ? sessions[bi - lookback] : null;
      const pi = pastDate ? floorBar(stock.bars, pastDate) : -1;
      if (ci < 0 || pi < 0 || stock.bars[pi].date < addDays(pastDate, -10)) { results.push({ ...base, entryDate, status: "excluded", reason: "filter_data_missing:prior_decline" }); continue; }
      const prior = stock.bars[ci].adjClose / stock.bars[pi].adjClose - 1;
      base.priorReturn = round6(prior);
      if (!(prior <= -Math.abs(config.minPriorDecline))) { results.push({ ...base, entryDate, status: "filtered", reason: "prior_decline" }); continue; }
    }
    if (config.minMarketCap != null || config.maxMarketCap != null) {
      const mc = ci >= 0 ? stock.bars[ci].marketCap : null;
      if (!(mc > 0)) { results.push({ ...base, entryDate, status: "excluded", reason: "filter_data_missing:market_cap" }); continue; }
      base.marketCap = mc;
      if ((config.minMarketCap != null && mc < config.minMarketCap) || (config.maxMarketCap != null && mc > config.maxMarketCap)) {
        results.push({ ...base, entryDate, status: "filtered", reason: "market_cap" }); continue;
      }
    }

    const horizons = {};
    for (const h of HORIZONS) horizons[h.key] = horizonResult({ entryIdx, entry, stock, bench, sessions, h, costRate, delistingPolicy });
    // Drawdown to the longest complete horizon (or the last available price).
    const longest = [...HORIZONS].reverse().find((h) => horizons[h.key].status === "complete");
    const endDate = longest ? horizons[longest.key].exitPriceDate : null;
    let drawdown = null;
    if (endDate) {
      const path = [entry];
      for (let i = stock.idx.get(entryDate); i < stock.bars.length && stock.bars[i].date <= endDate; i++) path.push(stock.bars[i].adjClose);
      drawdown = round6(maxDrawdown(path));
    }
    results.push({ ...base, entryDate, entryPrice: round6(entry), entryRawOpen: eBar.open, status: "evaluated", horizons, drawdown, entryIdx });
  }
  onProgress({ stage: "metrics", done: signals.length, total: signals.length });

  const equity = equityCurve({ results, symbolCache, bench, sessions, horizon: equityHorizon, costRate });
  return {
    results: results.map(({ entryIdx, ...r }) => r),
    stats: summarize(results, costRate),
    equity,
    benchmark: { symbol: benchmarkSymbol, lastSession, firstSession: sessions[0], quality: benchClean.flags },
  };
}

export function summarize(results, costRate = 0) {
  const byHorizon = {};
  for (const h of HORIZONS) {
    const complete = results.filter((r) => r.horizons?.[h.key]?.status === "complete");
    const nets = complete.map((r) => r.horizons[h.key].net);
    const benches = complete.map((r) => r.horizons[h.key].benchmark).filter((v) => v != null);
    const excess = complete.map((r) => r.horizons[h.key].excess).filter((v) => v != null);
    const excluded = {};
    for (const r of results) {
      const x = r.horizons?.[h.key];
      if (x?.status === "excluded") excluded[x.reason] = (excluded[x.reason] || 0) + 1;
    }
    byHorizon[h.key] = {
      label: h.label, sessions: h.sessions, n: complete.length,
      pending: results.filter((r) => r.horizons?.[h.key]?.status === "pending").length,
      excluded,
      winRate: nets.length ? round6(nets.filter((v) => v > 0).length / nets.length) : null,
      mean: round6(mean(nets)), median: round6(median(nets)),
      benchmarkMean: round6(mean(benches)), excessMean: round6(mean(excess)), excessMedian: round6(median(excess)),
      excessWinRate: excess.length ? round6(excess.filter((v) => v > 0).length / excess.length) : null,
      best: nets.length ? round6(Math.max(...nets)) : null, worst: nets.length ? round6(Math.min(...nets)) : null,
      flagged: complete.filter((r) => r.horizons[h.key].flag).length,
    };
  }
  const reasons = {};
  for (const r of results) if (r.status !== "evaluated") reasons[`${r.status}:${r.reason}`] = (reasons[`${r.status}:${r.reason}`] || 0) + 1;
  const dds = results.map((r) => r.drawdown).filter((v) => v != null);
  return {
    signals: results.length,
    evaluated: results.filter((r) => r.status === "evaluated").length,
    notEvaluated: reasons,
    costPerSideBps: round6(costRate * 10_000 / 1),
    byHorizon,
    signalDrawdown: { median: round6(median(dds)), worst: dds.length ? round6(Math.min(...dds)) : null },
  };
}

// Equal-weight, daily-rebalanced portfolio of open positions for one horizon.
function equityCurve({ results, symbolCache, bench, sessions, horizon, costRate }) {
  const pos = [];
  for (const r of results) {
    if (r.status !== "evaluated") continue;
    const hr = r.horizons[horizon.key];
    if (hr.status !== "complete") continue; // only closed positions (no partial windows)
    const stock = symbolCache.get(r.symbol);
    pos.push({ r, stock, startIdx: r.entryIdx, endIdx: sessions.indexOf(hr.exitDate) });
  }
  if (!pos.length) return null;
  const start = Math.min(...pos.map((p) => p.startIdx)), end = Math.max(...pos.map((p) => p.endIdx));
  const points = [];
  let value = 1, benchValue = 1;
  const bStart = bench.bars[bench.idx.get(sessions[start])];
  for (let t = start; t <= end; t++) {
    const d = sessions[t];
    const rets = [];
    for (const p of pos) {
      if (t < p.startIdx || t > p.endIdx) continue;
      const bi = p.stock.idx.get(d);
      let r = 0;
      if (bi != null) {
        const b = p.stock.bars[bi];
        if (t === p.startIdx) r = (b.adjClose / adjOpen(b)) / (1 + costRate) - 1;
        else {
          const prev = p.stock.bars[floorBar(p.stock.bars, sessions[t - 1])];
          r = prev ? b.adjClose / prev.adjClose - 1 : 0;
        }
      } // no bar (halt / data ended): 0 % that day
      if (t === p.endIdx) r = (1 + r) * (1 - costRate) - 1;
      rets.push(r);
    }
    if (rets.length) value *= 1 + mean(rets);
    const bb = bench.bars[bench.idx.get(d)];
    benchValue = bb && bStart ? bb.adjClose / adjOpen(bStart) : benchValue;
    points.push({ date: d, value: round6(value), benchmark: round6(benchValue), open: rets.length });
  }
  return {
    horizon: horizon.key, positions: pos.length, points,
    totalReturn: round6(value - 1), benchmarkReturn: round6(benchValue - 1),
    maxDrawdown: round6(maxDrawdown(points.map((p) => p.value))),
    benchmarkMaxDrawdown: round6(maxDrawdown(points.map((p) => p.benchmark))),
    daysInvested: points.filter((p) => p.open > 0).length,
  };
}
