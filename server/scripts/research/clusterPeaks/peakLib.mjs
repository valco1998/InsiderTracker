// Cluster peak study — pure functions (no I/O). Separate from the monthly study.
//
// Question: when several insiders buy more than $250,000 in one company within a short
// period, how high does the stock go during the 180 calendar days after the cluster became
// public through SEC filings, and how long does it take to get there?
//
// Definitions (all on split-adjusted daily SIP bars; dividends not included):
//   publication   SEC acceptance time (ET) of the filing that first completed the cluster,
//                 reconstructed point in time (signals.detectSignals).
//   entry         official OPEN of the first session whose opening auction can be joined after
//                 publication + latency (exitRules.entryDateFor: 09:28 ET cut-off, NYSE calendar,
//                 DST) — the first executable price after disclosure on daily data.
//   window        sessions from the entry date through publication date + 180 calendar days.
//   peak (high)   highest daily HIGH in the window → gain vs entry, date, calendar days and
//                 trading sessions after the entry date (entry day = day 0 / session 0).
//   peak (close)  highest daily CLOSE in the window, reported separately.
//   end           close of the last session on or before the window end.
//   thresholds    first session whose high reached entry × (1 + x), x = 10/20/30/50/100 %.
// A peak is a historical maximum seen in hindsight — not an achievable trading profit.
//
// Status: complete      window end ≤ data cutoff and the series is observed to the end
//         incomplete    window end after the cutoff (newer cluster) — reported separately
//         series_ended  the symbol's bars stop > 5 sessions before min(window end, cutoff)
//                       (delisting, ticker change, data gap) — reported separately, never
//                       mixed into complete six-month statistics
//         no_ticker / no_price_series / no_entry_bar — no numbers, with the reason.

import { entryDateFor } from "../../../services/backtest/exitRules.js";
import { sessionsBetween, nextSession } from "../../../services/backtest/sessionCalendar.js";

export const HORIZON_DAYS = 180;
export const THRESHOLDS = [0.1, 0.2, 0.3, 0.5, 1.0];
const DAY = 86_400_000;
export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const calDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);

// bars: array of [date, o, h, l, c, v] sorted ascending (research cache format) or null.
// cutoff: last session with final data in the price source.
export function peakWindow({ bars, publishedAt, cutoff, horizonDays = HORIZON_DAYS, latencySeconds = 60 }) {
  const t = entryDateFor(publishedAt, { latencySeconds });
  if (!t) return { status: "invalid_publication_time" };
  const pubDate = String(publishedAt).slice(0, 10);
  const windowEnd = addDays(pubDate, horizonDays);
  const base = { entryDate: t.entryDate, availableAt: t.availableEt, windowEnd };
  if (!Array.isArray(bars) || !bars.length) return { ...base, status: "no_price_series" };
  if (t.entryDate > cutoff) return { ...base, status: "incomplete", observedThrough: null, reason: "entry_after_cutoff" };
  const i0 = bars.findIndex((b) => b[0] === t.entryDate);
  if (i0 < 0) return { ...base, status: "no_entry_bar" };
  const win = [];
  for (let i = i0; i < bars.length && bars[i][0] <= windowEnd && bars[i][0] <= cutoff; i++) win.push(bars[i]);
  const entry = win[0][1];
  if (!(entry > 0)) return { ...base, status: "no_entry_bar" };
  const lastBar = bars.at(-1)[0];
  const observedThrough = win.at(-1)[0];
  const expectedEnd = windowEnd < cutoff ? windowEnd : cutoff;
  // Sessions the market was open but the symbol has no bar after its last one.
  const missingTail = lastBar < expectedEnd ? sessionsBetween(nextSession(lastBar), expectedEnd).length : 0;
  const status = missingTail > 5 ? "series_ended" : windowEnd <= cutoff ? "complete" : "incomplete";
  const sessionIndex = (d) => win.findIndex((b) => b[0] === d);
  let ph = -Infinity, phd = null, pc = -Infinity, pcd = null, lo = Infinity, loBeforePeak = Infinity;
  for (const b of win) {
    if (b[2] > ph) { ph = b[2]; phd = b[0]; }
    if (b[4] > pc) { pc = b[4]; pcd = b[0]; }
    if (b[3] < lo) lo = b[3];
  }
  for (const b of win) { if (b[0] > phd) break; if (b[3] < loBeforePeak) loBeforePeak = b[3]; }
  const thresholds = {};
  for (const x of THRESHOLDS) {
    const hit = win.find((b) => b[2] >= entry * (1 + x));
    thresholds[x] = hit ? { hit: true, date: hit[0], calendarDays: calDays(t.entryDate, hit[0]), sessions: sessionIndex(hit[0]) } : { hit: false };
  }
  const end = win.at(-1);
  return {
    ...base, status, observedThrough, sessionsObserved: win.length, entryPrice: entry,
    lastBarDate: lastBar, missingSessionsAtEnd: missingTail,
    peakHigh: ph, peakHighDate: phd, peakHighGain: r6(ph / entry - 1),
    daysToPeakHigh: calDays(t.entryDate, phd), sessionsToPeakHigh: sessionIndex(phd), daysPublicationToPeakHigh: calDays(pubDate, phd),
    peakClose: pc, peakCloseDate: pcd, peakCloseGain: r6(pc / entry - 1), daysToPeakClose: calDays(t.entryDate, pcd), sessionsToPeakClose: sessionIndex(pcd),
    endDate: end[0], endClose: end[4], endReturn: r6(end[4] / entry - 1),
    lowestLow: lo, maxDrawdown: r6(lo / entry - 1), drawdownBeforePeak: r6(loBeforePeak / entry - 1),
    thresholds,
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const dist = (xs) => ({ n: xs.length, mean: r6(mean(xs)), median: r6(quantile(xs, 0.5)), p25: r6(quantile(xs, 0.25)), p75: r6(quantile(xs, 0.75)), min: r6(xs.length ? Math.min(...xs) : null), max: r6(xs.length ? Math.max(...xs) : null) });

// rows: peakWindow results with status "complete" (caller filters). → category statistics.
export function summarizePeaks(rows) {
  const v = (k) => rows.map((r) => r[k]).filter((x) => x != null);
  const share = (f) => (rows.length ? r6(rows.filter(f).length / rows.length) : null);
  return {
    n: rows.length,
    peakHighGain: dist(v("peakHighGain")),
    peakCloseGain: dist(v("peakCloseGain")),
    daysToPeakHigh: dist(v("daysToPeakHigh")),
    sessionsToPeakHigh: dist(v("sessionsToPeakHigh")),
    daysToPeakClose: dist(v("daysToPeakClose")),
    endReturn: dist(v("endReturn")),
    drawdownBeforePeak: dist(v("drawdownBeforePeak")),
    maxDrawdown: dist(v("maxDrawdown")),
    endPositive: share((r) => r.endReturn > 0),
    peakOnEntryDay: share((r) => r.sessionsToPeakHigh === 0),
    neverAboveEntry: share((r) => r.peakHighGain <= 0),
    reached: Object.fromEntries(THRESHOLDS.map((x) => {
      const hits = rows.filter((r) => r.thresholds?.[x]?.hit);
      return [x, { share: share((r) => r.thresholds?.[x]?.hit), n: hits.length, medianDays: r6(quantile(hits.map((r) => r.thresholds[x].calendarDays), 0.5)), medianSessions: r6(quantile(hits.map((r) => r.thresholds[x].sessions), 0.5)) }];
    })),
    peakTiming: Object.fromEntries([30, 60, 90, 120, 150, 180].map((d) => [d, share((r) => r.daysToPeakHigh <= d)])),
  };
}
