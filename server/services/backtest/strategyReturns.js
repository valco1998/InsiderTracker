// server/services/backtest/strategyReturns.js
//
// ACTIONABLE returns of a user-defined strategy over a user-selected horizon of N
// TRADING SESSIONS (pure — no I/O). The timestamps are kept distinct:
//
//   purchase dates     Form 4 trade dates — used only to GROUP purchases (signals.js),
//                      never as an entry.
//   SEC acceptance     signal.publishedAt — the acceptance time of the filing that first
//                      made the strategy's conditions true (point in time).
//   available / detected
//                      acceptance + executionLatencySeconds. SEC acceptance is NOT assumed
//                      to equal public availability: the latency covers EDGAR
//                      dissemination, feed polling, detection and order routing.
//   entry              the first ELIGIBLE recorded trade (Alpaca SIP, exact timestamps;
//                      entrySelection.js rules) at or after `available`:
//                        entrySession "regular"  → inside the regular session only (a
//                                                  filing after the close enters at the
//                                                  next session's opening trades)
//                        entrySession "extended" → pre-market / after-hours prints allowed
//   exit               the official CLOSE of the N-th NYSE session AFTER the entry trade's
//                      New York date (weekends, holidays and early closes per
//                      sessionCalendar.js). N trading sessions — never calendar days.
//   prices             entry split-adjusted to today's share terms; exits are split-
//                      adjusted daily closes (same terms). Price return only: dividends
//                      are not included.
//   costs              commission + slippage in basis points PER SIDE:
//                      net = exit×(1−c) ÷ (entry×(1+c)) − 1; gross has no costs.
//   benchmark          SPY bought at its first eligible trade at/after the stock's entry
//                      time (same session rule) and sold at its close on the same exit
//                      session; no costs. excess = net − SPY.
// Missing data is a STATUS, never a number: immature (exit session not closed),
// no_bar (no daily bar for the exit session), bars_unavailable (closes could not be
// loaded), or the entry's own status (no eligible trade yet, awaiting SIP, …).

import { etToUtcIso } from "./publicationStart.js";
import { regularSearchStart, etParts, sessionOf } from "./entrySelection.js";
import { closeTime } from "./sessionCalendar.js";
import { sessionAfter, sessionClosed } from "./horizonReturns.js";

export const STRATEGY_EXECUTION_DEFAULTS = Object.freeze({ horizonSessions: 20, executionLatencySeconds: 60, entrySession: "regular" });
export const ENTRY_SESSIONS = ["regular", "extended"];

const round6 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 1e6) / 1e6);

// Estimated public availability (UTC ISO) = SEC acceptance (ET) + latency.
export function availableAtIso(publishedAtET, latencySeconds = 0) {
  const acc = etToUtcIso(publishedAtET);
  if (!acc) return null;
  return new Date(Date.parse(acc) + Math.max(0, Number(latencySeconds) || 0) * 1000).toISOString();
}

// Where the entry search starts for the chosen session rule.
export function entrySearchStart(availableIso, entrySession = "regular") {
  if (!availableIso) return null;
  return entrySession === "extended" ? availableIso : regularSearchStart(availableIso);
}

// Exit session and its official close time for an entry trade.
export function exitFor(entryIso, n) {
  const entryDate = etParts(entryIso).date;
  const exitDate = sessionAfter(entryDate, n);
  return { entryDate, exitDate, exitTime: etToUtcIso(`${exitDate} ${closeTime(exitDate)} ET`) };
}

const priceOf = (e) => Number(e?.splitAdjustedPrice ?? e?.price);

// entry / benchEntry: { status, price, splitAdjustedPrice?, time (ISO), session?, ... }
// closes / benchCloses: Map(date → split-adjusted close) | null (could not load).
export function strategyReturn({ entry, closes, benchEntry = null, benchCloses = null, n, costBps = 0, nowMs = Date.now() }) {
  if (!entry || entry.status !== "ok") return { status: entry?.status || "no_entry", horizonSessions: n };
  const entryPrice = priceOf(entry);
  if (!(entryPrice > 0) || !entry.time) return { status: "no_entry", horizonSessions: n };
  const { entryDate, exitDate, exitTime } = exitFor(entry.time, n);
  const ent = { ...entry, adjustedPrice: round6(entryPrice), date: entryDate, session: entry.session || sessionOf(entry.time) };
  const base = { horizonSessions: n, entry: ent, exit: { date: exitDate, time: exitTime } };
  if (!sessionClosed(exitDate, nowMs)) return { ...base, status: "immature" };
  if (!closes) return { ...base, status: "bars_unavailable" };
  const exitPrice = Number(closes.get(exitDate));
  if (!(exitPrice > 0)) return { ...base, status: "no_bar" };
  const c = Math.max(0, Number(costBps) || 0) / 10_000;
  const gross = exitPrice / entryPrice - 1;
  const net = (exitPrice * (1 - c)) / (entryPrice * (1 + c)) - 1;

  let benchmark = null, benchmarkStatus = "ok", bench = null;
  const bp = priceOf(benchEntry);
  if (!benchEntry || benchEntry.status !== "ok" || !(bp > 0)) benchmarkStatus = benchEntry?.status || "no_benchmark_entry";
  else if (!benchCloses) benchmarkStatus = "bars_unavailable";
  else {
    const bx = Number(benchCloses.get(exitDate));
    if (!(bx > 0)) benchmarkStatus = "no_bar";
    else {
      benchmark = bx / bp - 1;
      bench = { entry: { price: round6(bp), time: benchEntry.time, session: benchEntry.session || sessionOf(benchEntry.time) }, exit: { date: exitDate, time: exitTime, price: bx } };
    }
  }
  return {
    ...base, status: "ok", exit: { ...base.exit, price: exitPrice },
    gross: round6(gross), net: round6(net), costPerSideBps: Number(costBps) || 0,
    benchmark: round6(benchmark), benchmarkStatus, benchmarkTrade: bench,
    excess: benchmark == null ? null : round6(net - benchmark),
  };
}

// Can these numbers be read as a statistically meaningful result? Never claims more than
// "indicative": a historical sample is not a prediction. Any listed reason → not reliable.
//   coverage: run.coverage (SEC days held vs business days, incl. warm-up)
//   summary:  strategySummary(...)
export const MIN_RELIABLE_SAMPLE = 30;
export function assessReliability({ coverage = null, summary }) {
  const reasons = [];
  if (!coverage || !coverage.complete) reasons.push("sec_coverage_incomplete");
  if (!summary || summary.n < MIN_RELIABLE_SAMPLE) reasons.push("small_sample");
  const total = summary?.signals || 0;
  const missing = total - (summary?.n || 0);
  const immature = summary?.missing?.immature || 0;
  if (total && (missing - immature) / total > 0.2) reasons.push("many_missing_prices");
  if (total && immature / total > 0.5) reasons.push("most_horizons_immature");
  if (summary && summary.n && summary.benchmarkN < summary.n) reasons.push("benchmark_incomplete");
  return {
    verdict: reasons.length ? "not_reliable" : "indicative",
    reasons, minSample: MIN_RELIABLE_SAMPLE,
    priceCoverage: total ? Math.round(((summary.n || 0) / total) * 1e4) / 1e4 : null,
    secCoverage: coverage?.ratio ?? null,
  };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Statistics over the per-signal results of ONE run (one horizon). Only status "ok"
// contributes to returns; every other status is counted, never averaged as 0.
export function strategySummary(results = []) {
  const ok = results.filter((r) => r?.status === "ok");
  const gross = ok.map((r) => r.gross), net = ok.map((r) => r.net);
  const withBench = ok.filter((r) => r.benchmark != null);
  const bench = withBench.map((r) => r.benchmark), excess = withBench.map((r) => r.excess);
  const missing = {};
  for (const r of results) if (r?.status !== "ok") { const k = r?.status || "unknown"; missing[k] = (missing[k] || 0) + 1; }
  const benchMissing = {};
  for (const r of ok) if (r.benchmark == null) benchMissing[r.benchmarkStatus || "unknown"] = (benchMissing[r.benchmarkStatus || "unknown"] || 0) + 1;
  return {
    signals: results.length, n: ok.length,
    grossMean: round6(mean(gross)), grossMedian: round6(median(gross)),
    netMean: round6(mean(net)), netMedian: round6(median(net)),
    winRate: net.length ? round6(net.filter((v) => v > 0).length / net.length) : null,
    best: net.length ? round6(Math.max(...net)) : null, worst: net.length ? round6(Math.min(...net)) : null,
    // SPY figures and excess cover ONLY signals with a SPY comparison (benchmarkN); the
    // strategy's own net mean over that same subset is given so they are read together.
    benchmarkN: withBench.length, benchmarkMean: round6(mean(bench)), benchmarkMedian: round6(median(bench)),
    netMeanWithBenchmark: round6(mean(withBench.map((r) => r.net))),
    excessMean: round6(mean(excess)), excessMedian: round6(median(excess)),
    excessWinRate: excess.length ? round6(excess.filter((v) => v > 0).length / excess.length) : null,
    missing, benchmarkMissing: benchMissing,
  };
}
