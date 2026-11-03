// server/services/backtest/entrySelection.js
//
// Which recorded trade is the entry after an SEC publication (pure, no I/O).
//
// Trade-level (Alpaca SIP trades, nanosecond timestamps — exact, not a bar):
//   PRIMARY  first eligible trade with timestamp ≥ the SEC acceptance time, in any
//            session (pre-market 04:00–09:30, regular, after-hours 16:00–20:00 ET).
//   REGULAR  first eligible trade inside the regular session (09:30–16:00 ET, early
//            closes and holidays per sessionCalendar.js) that is not flagged as an
//            extended-hours print, at or after the publication time.
//   Eligible = an actual execution that represents a market price. Rejected:
//     report-only / non-representative conditions (EXCLUDED_CONDITIONS) and, by
//     default, odd lots ("I": a 1-share print is not a representative price).
// Minute-bar fallback (Tiingo IEX, regular session only): a bar is accepted only if
//   it STARTS at or after the publication time (bars are labelled by start, so a
//   minute in progress at publication is never used) and has volume > 0 (no
//   forward-filled / synthetic minutes). Its open is the first trade of that minute
//   — reported as a minute-bar approximation, never as an exact executable trade.

import { isSession, closeTime } from "./sessionCalendar.js";

// SIP sale conditions that do not reflect a contemporaneous executable market price.
export const EXCLUDED_CONDITIONS = new Map([
  ["B", "average price / bunched"], ["W", "average price"], ["C", "cash sale"], ["N", "next day"], ["R", "seller"],
  ["P", "prior reference price"], ["Z", "sold out of sequence"], ["U", "extended hours sold out of sequence"], ["L", "sold last (late report)"],
  ["4", "derivatively priced"], ["7", "qualified contingent trade"], ["V", "contingent trade"], ["H", "price variation"],
  ["9", "corrected consolidated close"], ["M", "market center official close"], ["Q", "market center official open"],
]);
const EXTENDED_FLAGS = new Set(["T", "U"]);

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
export function etParts(iso) {
  const s = ET.format(new Date(iso)).replace(", ", " ");
  return { date: s.slice(0, 10), time: s.slice(11, 19) };
}

// "pre" | "regular" | "post" | "closed" (weekend/holiday or outside 04:00–20:00 ET).
export function sessionOf(iso) {
  const { date, time } = etParts(iso);
  if (!isSession(date)) return "closed";
  if (time >= "04:00:00" && time < "09:30:00") return "pre";
  if (time >= "09:30:00" && time < closeTime(date)) return "regular";
  if (time >= closeTime(date) && time < "20:00:00") return "post";
  return "closed";
}

export function isEligibleTrade(t, { includeOddLots = false } = {}) {
  if (!t || !(t.p > 0) || !(t.s > 0) || Number.isNaN(Date.parse(t.t))) return false;
  const c = Array.isArray(t.c) ? t.c : [];
  if (c.some((x) => EXCLUDED_CONDITIONS.has(x))) return false;
  if (!includeOddLots && c.includes("I")) return false;
  return true;
}

// Nanosecond-safe ordering: compare the ISO strings when both are UTC "Z" strings.
const atOrAfter = (tradeIso, atIso) => Date.parse(tradeIso) > Date.parse(atIso) || (Date.parse(tradeIso) === Date.parse(atIso) && tradeIso >= atIso);

// First eligible trade at/after `atIso`. regularOnly → regular-session, not extended-flagged.
export function firstEligibleTrade(trades, atIso, { regularOnly = false, includeOddLots = false } = {}) {
  for (const t of trades) {
    if (!atOrAfter(t.t, atIso)) continue;
    if (!isEligibleTrade(t, { includeOddLots })) continue;
    if (regularOnly && (sessionOf(t.t) !== "regular" || (t.c || []).some((x) => EXTENDED_FLAGS.has(x)))) continue;
    return t;
  }
  return null;
}

// Where the regular-hours search starts: the publication time if it falls inside a
// regular session, else the next regular-session open (09:30 ET, DST-aware).
export function regularSearchStart(publishedIso) {
  if (sessionOf(publishedIso) === "regular") return publishedIso;
  let { date, time } = etParts(publishedIso);
  if (!(isSession(date) && time < "09:30:00")) date = nextDate(date);
  while (!isSession(date)) date = nextDate(date);
  return etWallToIso(date, "09:30:00");
}
const nextDate = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
function etWallToIso(date, time) {
  for (const off of [4, 5]) {
    const iso = new Date(Date.parse(`${date}T${time}Z`) + off * 3_600_000).toISOString();
    const p = etParts(iso);
    if (p.date === date && p.time === time) return iso;
  }
  return null;
}

// Minute-bar fallback: first bar starting at/after `atIso` with volume > 0.
export function firstTradedMinute(bars, atIso, { regularOnly = true } = {}) {
  const at = Date.parse(atIso);
  for (const b of bars) {
    const t = Date.parse(b.time);
    if (!(t >= at)) continue;
    if (!(Number(b.volume) > 0)) continue; // zero-volume = forward-filled / no trade
    if (!(b.open > 0)) continue;
    if (regularOnly && sessionOf(b.time) !== "regular") continue;
    return b;
  }
  return null;
}
