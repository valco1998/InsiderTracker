// server/services/backtest/sessionCalendar.js
//
// U.S. equity (NYSE) regular-session calendar, America/New_York.
//   Regular session 09:30–16:00 ET; early close 13:00 ET.
//   Holidays: New Year's Day (Sunday → Monday; Saturday → not observed),
//   Martin Luther King Jr. Day, Washington's Birthday, Good Friday, Memorial Day,
//   Juneteenth (from 2022), Independence Day, Labor Day, Thanksgiving, Christmas
//   (Saturday → Friday, Sunday → Monday), plus the special closures listed below.
//   Early closes: July 3, the day after Thanksgiving and December 24 when they
//   are sessions.
// When price data is configured, the BENCHMARK's daily bars are authoritative
// for which sessions existed; this calendar is the fallback and is used to plan
// entry dates when no price data is available (see returns.js).

const SPECIAL_CLOSURES = new Set([
  "2001-09-11", "2001-09-12", "2001-09-13", "2001-09-14", // September 11
  "2004-06-11", // President Reagan
  "2007-01-02", // President Ford
  "2012-10-29", "2012-10-30", // Hurricane Sandy
  "2018-12-05", // President G.H.W. Bush
  "2025-01-09", // President Carter
]);

const DAY = 86_400_000;
const toNum = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const toIso = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function nthWeekday(y, m, weekday, n) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return ymd(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}
function lastWeekday(y, m, weekday) {
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const wd = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return ymd(y, m, lastDay - ((wd - weekday + 7) % 7));
}
function easterSunday(y) { // anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}
// Saturday → Friday, Sunday → Monday.
function observed(iso) {
  const w = dow(iso);
  return w === 6 ? toIso(toNum(iso) - 1) : w === 0 ? toIso(toNum(iso) + 1) : iso;
}

const holidayCache = new Map();
export function holidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const s = new Set();
  const ny = ymd(y, 1, 1);
  if (dow(ny) === 0) s.add(ymd(y, 1, 2)); else if (dow(ny) !== 6) s.add(ny);
  if (y >= 1998) s.add(nthWeekday(y, 1, 1, 3));
  s.add(nthWeekday(y, 2, 1, 3));
  s.add(toIso(toNum(easterSunday(y)) - 2));
  s.add(lastWeekday(y, 5, 1));
  if (y >= 2022) s.add(observed(ymd(y, 6, 19)));
  s.add(observed(ymd(y, 7, 4)));
  s.add(nthWeekday(y, 9, 1, 1));
  s.add(nthWeekday(y, 11, 4, 4));
  s.add(observed(ymd(y, 12, 25)));
  holidayCache.set(y, s);
  return s;
}

export function isSession(iso) {
  const w = dow(iso);
  if (w === 0 || w === 6) return false;
  if (SPECIAL_CLOSURES.has(iso)) return false;
  return !holidays(Number(iso.slice(0, 4))).has(iso);
}

export function isEarlyClose(iso) {
  if (!isSession(iso)) return false;
  const y = Number(iso.slice(0, 4));
  return iso === ymd(y, 7, 3) || iso === toIso(toNum(nthWeekday(y, 11, 4, 4)) + 1) || iso === ymd(y, 12, 24);
}

export const closeTime = (iso) => (isEarlyClose(iso) ? "13:00:00" : "16:00:00");
export const OPEN_TIME = "09:30:00";

export function nextSession(iso) { let n = toNum(iso) + 1; while (!isSession(toIso(n))) n++; return toIso(n); }
export function previousSession(iso) { let n = toNum(iso) - 1; while (!isSession(toIso(n))) n--; return toIso(n); }
export const sessionOnOrAfter = (iso) => (isSession(iso) ? iso : nextSession(iso));

// "YYYY-MM-DD HH:MM:SS ET" → { date, time } or null.
export function parseEt(stamp) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(stamp || ""));
  return m ? { date: m[1], time: m[2] } : null;
}

// Earliest session whose OPEN is at or after the public disclosure time:
// before 09:30 on a session day → that day's open; during the session, after
// the close, or on a non-session day → the next session's open.
export function entrySessionFor(acceptedAtET) {
  const t = parseEt(acceptedAtET);
  if (!t) return null;
  if (isSession(t.date) && t.time < OPEN_TIME) return t.date;
  return nextSession(t.date);
}

// Most recent session whose CLOSE had happened by the disclosure time (the last
// closing price the public could know).
export function lastClosedSession(acceptedAtET) {
  const t = parseEt(acceptedAtET);
  if (!t) return null;
  if (isSession(t.date) && t.time >= closeTime(t.date)) return t.date;
  return previousSession(t.date);
}

// Sessions in [from, to] (inclusive).
export function sessionsBetween(from, to) {
  const out = [];
  for (let n = toNum(from), end = toNum(to); n <= end; n++) { const d = toIso(n); if (isSession(d)) out.push(d); }
  return out;
}
