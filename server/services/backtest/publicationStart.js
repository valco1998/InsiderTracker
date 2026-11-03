// server/services/backtest/publicationStart.js
//
// "SEC signal published → NOW": pure helpers (no I/O).
//   START  the first IEX intraday bar that STARTS at or after the SEC acceptance
//          time of the qualifying signal; its OPEN is the start price. Tiingo IEX
//          bars are labelled by their start time (verified), so the open is the
//          first IEX trade at/after that moment — never a pre-disclosure price.
//          The feed has regular-session data only: a signal published pre-market,
//          after hours, on a weekend or holiday starts at the first regular-session
//          minute after publication (labelled).
//   END    the latest authorized quote (liveQuote.js), with its timestamp.

import { isSession, closeTime, OPEN_TIME } from "./sessionCalendar.js";

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

// "YYYY-MM-DD HH:MM:SS ET" (New York wall time) → ISO UTC. DST-aware.
const ET_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const etIsoMemo = new Map(); // pure: stamp → ISO (bounded)
export function etToUtcIso(stamp) {
  const key = String(stamp || "");
  if (etIsoMemo.has(key)) return etIsoMemo.get(key);
  const v = etToUtcIsoUncached(key);
  if (etIsoMemo.size > 50_000) etIsoMemo.clear();
  etIsoMemo.set(key, v);
  return v;
}
function etToUtcIsoUncached(stamp) {
  const m = WALL_RE.exec(String(stamp || ""));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const fmt = ET_FMT;
  const wall = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  for (const offsetH of [4, 5]) { // EDT (UTC−4), EST (UTC−5)
    const t = Date.UTC(y, mo - 1, d, h + offsetH, mi, s);
    if (fmt.format(new Date(t)).replace(", ", " ") === wall) return new Date(t).toISOString();
  }
  return null; // non-existent wall time (DST gap)
}

// Where in the trading day was the signal published?
export function publicationSession(stamp) {
  const m = WALL_RE.exec(String(stamp || ""));
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`, time = `${m[4]}:${m[5]}:${m[6]}`;
  if (!isSession(date)) return "non_trading_day";
  if (time < OPEN_TIME) return "pre_market";
  if (time >= closeTime(date)) return "after_hours";
  return "regular_session";
}

// bars: [{ time ISO UTC (bar START), open, volume }] → first bar starting at/after
// `atIso` that contains real trades. Zero-volume (or volume-less) bars are
// forward-filled minutes with no trade — never a start price (bug fixed 2026-11-03:
// NXG, NPB, STC, DSM, NMCO had carried-forward pre-publication prices).
export function firstPriceAtOrAfter(bars = [], atIso) {
  const at = Date.parse(atIso);
  if (!Number.isFinite(at)) return null;
  let best = null;
  for (const b of bars) {
    const t = Date.parse(b.time);
    if (t >= at && Number(b.volume) > 0 && b.open > 0 && (!best || t < Date.parse(best.time))) best = b;
  }
  return best ? { price: best.open, time: best.time, volume: best.volume } : null;
}

// Bar size used for the start lookup: 1-minute for recent signals, 5-minute for
// older ones (the response runs from startDate to now — keeps bandwidth bounded).
export const resampleFor = (publishedIso, nowMs) => (nowMs - Date.parse(publishedIso) <= 31 * 86_400_000 ? "1min" : "5min");

export const START_BASIS_TEXT = {
  regular_session: "first IEX trade minute at/after publication",
  pre_market: "published pre-market — first regular-session IEX minute (feed has no pre-market data)",
  after_hours: "published after hours — first regular-session IEX minute of the next session (feed has no after-hours data)",
  non_trading_day: "published on a weekend/holiday — first regular-session IEX minute of the next session",
};

// Percentage change start → end, with elapsed time since publication.
export function publicationToNow({ publishedIso, start, quote, nowMs }) {
  const elapsedMs = Math.max(0, nowMs - Date.parse(publishedIso));
  if (!start || start.status !== "ok") return { status: start?.status || "unavailable", elapsedMs };
  if (!quote || quote.status !== "ok") {
    // Say why (quota / key / rate limit) instead of a generic "no quote".
    const qs = quote?.status || null;
    return { status: ["quota", "no_key", "invalid_key", "rate_limited"].includes(qs) ? qs : "no_quote", quoteStatus: qs, elapsedMs, start };
  }
  // A quote older than the start observation cannot measure anything after it.
  if (Date.parse(quote.timestamp) < Date.parse(start.time)) return { status: "awaiting_first_trade", elapsedMs, start };
  const startPrice = start.splitAdjustedPrice ?? start.price;
  return {
    status: "ok", elapsedMs, start,
    end: { price: quote.price, timestamp: quote.timestamp, source: quote.source, stale: !!quote.stale },
    changePct: Math.round((quote.price / startPrice - 1) * 1e6) / 1e6,
  };
}
