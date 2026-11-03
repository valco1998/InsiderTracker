// server/services/backtest/horizonReturns.js
//
// FIXED-HORIZON returns for historical strategy evaluation (Backtesting only).
//
//   entry   the signal's PRIMARY entry: first eligible SIP trade at/after the SEC
//           publication (entrySelection.js), split-adjusted to today's share terms
//           (splitAdjustedPrice — the same price the "since signal" metric uses).
//   exit    the CLOSE of the N-th NYSE trading session AFTER the entry trade's
//           trading date (New York date of the trade; NYSE holiday calendar), from
//           Alpaca SIP daily bars with adjustment=split (also today's share terms).
//           N ∈ {1, 5, 10, 20, 60}. Pre-market / regular / after-hours entries on
//           date D all count sessions from D (exit 1 = close of the next session).
//   return  exit ÷ entry − 1. Dividends are not included (split adjustment only).
//
// Statuses — a missing value is never 0:
//   ok          exit close found
//   immature    the N-th session has not closed yet (or its SIP bar is not
//               accessible yet: Basic plan = no SIP data from the last 15 minutes)
//   no_bar      the session closed but Alpaca has no daily bar for it (halt,
//               delisting, symbol change) — never forward-filled
//   no_entry    no valid entry trade
//
// These are THEORETICAL returns: entry at the first eligible print (which can be
// small or in thin extended-hours trading), exit at the official close, no costs.

import { nextSession, closeTime } from "./sessionCalendar.js";

export const FIXED_HORIZONS = [1, 5, 10, 20, 60];
const SIP_DELAY_MS = 16 * 60_000;

const ET_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const etParts = (ms) => {
  const p = Object.fromEntries(ET_FMT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
};

// Is session `date`'s closing bar final and accessible at nowMs?
export function sessionClosed(date, nowMs) {
  const t = etParts(nowMs - SIP_DELAY_MS);
  return date < t.date || (date === t.date && t.time >= closeTime(date));
}

// N-th session after `date` (date itself excluded).
const afterMemo = new Map(); // pure: (date, n) → session (calendar is fixed)
export function sessionAfter(date, n) {
  const k = `${date}|${n}`;
  const hit = afterMemo.get(k);
  if (hit) return hit;
  let d = date;
  for (let i = 0; i < n; i++) d = nextSession(d);
  if (afterMemo.size > 100_000) afterMemo.clear();
  afterMemo.set(k, d);
  return d;
}

// entry: { time (ISO), splitAdjustedPrice } ; closes: Map(date → split-adjusted close)
export function horizonReturns({ entry, closes, nowMs, horizons = FIXED_HORIZONS }) {
  const out = {};
  const closedMemo = new Map(); // per call: exitDate → closed?
  const entryPrice = Number(entry?.splitAdjustedPrice ?? entry?.price);
  if (!entry?.time || !(entryPrice > 0)) { for (const n of horizons) out[n] = { status: "no_entry" }; return out; }
  const entryDate = etParts(Date.parse(entry.time)).date;
  for (const n of horizons) {
    const exitDate = sessionAfter(entryDate, n);
    if (!closedMemo.has(exitDate)) closedMemo.set(exitDate, sessionClosed(exitDate, nowMs));
    if (!closedMemo.get(exitDate)) { out[n] = { status: "immature", exitDate }; continue; }
    const c = closes?.get(exitDate);
    if (!(c > 0)) { out[n] = { status: "no_bar", exitDate }; continue; }
    out[n] = { status: "ok", exitDate, exitPrice: c, changePct: Math.round((c / entryPrice - 1) * 1e6) / 1e6 };
  }
  return out;
}

// Statistics for one horizon over many signals — only signals with status ok count.
export function horizonStats(results, n) {
  const xs = results.map((r) => r?.[n]).filter((x) => x?.status === "ok").map((x) => x.changePct).sort((a, b) => a - b);
  const k = xs.length;
  const count = (s) => results.filter((r) => r?.[n]?.status === s).length;
  return {
    horizon: n, n: k,
    average: k ? xs.reduce((a, b) => a + b, 0) / k : null,
    median: k ? (k % 2 ? xs[(k - 1) >> 1] : (xs[k / 2 - 1] + xs[k / 2]) / 2) : null,
    winRate: k ? xs.filter((x) => x > 0).length / k : null,
    immature: count("immature"), noBar: count("no_bar"), noEntry: count("no_entry"),
  };
}
