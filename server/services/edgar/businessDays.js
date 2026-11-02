// server/services/edgar/businessDays.js
//
// SEC business-day calendar (weekdays minus US federal holidays, with the
// federal observed-date rule) and Form 4 filing-delay classification.
// Pure functions over "YYYY-MM-DD" strings — no I/O, no time zones.

const DAY_MS = 86_400_000;

const toNum = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const toIso = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const weekday = (n) => new Date(n * DAY_MS).getUTCDay();

// nth (1-based) weekday `wd` of month m (0-11); n = -1 → last.
function nthWeekday(y, m, wd, n) {
  if (n > 0) {
    const first = toNum(`${y}-${String(m + 1).padStart(2, "0")}-01`);
    return first + ((wd - weekday(first) + 7) % 7) + (n - 1) * 7;
  }
  const last = toNum(new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10));
  return last - ((weekday(last) - wd + 7) % 7);
}

// Fixed-date holiday falling on Saturday → Friday, Sunday → Monday.
function observed(y, m, d) {
  const n = toNum(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  const wd = weekday(n);
  return wd === 6 ? n - 1 : wd === 0 ? n + 1 : n;
}

const holidayCache = new Map();
function holidaysOf(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const set = new Set([
    observed(y, 0, 1),            // New Year's Day
    nthWeekday(y, 0, 1, 3),       // Martin Luther King Jr. Day
    nthWeekday(y, 1, 1, 3),       // Washington's Birthday
    nthWeekday(y, 4, 1, -1),      // Memorial Day
    ...(y >= 2021 ? [observed(y, 5, 19)] : []), // Juneteenth
    observed(y, 6, 4),            // Independence Day
    nthWeekday(y, 8, 1, 1),       // Labor Day
    nthWeekday(y, 9, 1, 2),       // Columbus Day
    observed(y, 10, 11),          // Veterans Day
    nthWeekday(y, 10, 4, 4),      // Thanksgiving
    observed(y, 11, 25),          // Christmas
  ]);
  // New Year's Day on a Saturday is observed on Dec 31 of the prior year.
  if (weekday(toNum(`${y + 1}-01-01`)) === 6) set.add(toNum(`${y}-12-31`));
  // Keep only dates inside year y (observed(y, 0, 1) may land on Dec 31 of y-1),
  // so every holiday belongs to exactly one year's set.
  const lo = toNum(`${y}-01-01`), hi = toNum(`${y}-12-31`);
  for (const n of set) if (n < lo || n > hi) set.delete(n);
  holidayCache.set(y, set);
  return set;
}

export function isBusinessDay(iso) {
  const n = toNum(iso);
  const wd = weekday(n);
  if (wd === 0 || wd === 6) return false;
  return !holidaysOf(Number(iso.slice(0, 4))).has(n);
}

// Weekdays among epoch days [0, n). Epoch day 0 (1970-01-01) is a Thursday;
// WEEKDAY_PREFIX[r] = weekdays among the first r days of a week starting Thursday.
const WEEKDAY_PREFIX = [0, 1, 2, 2, 2, 3, 4];
const weekdaysBefore = (n) => Math.floor(n / 7) * 5 + WEEKDAY_PREFIX[((n % 7) + 7) % 7];

// Business days after `fromIso` up to and including `toIso` (0 if same day or earlier).
// O(years): weekday arithmetic minus the (always weekday, observed) holidays in range.
export function businessDaysBetween(fromIso, toIso_) {
  const a = toNum(fromIso);
  const b = toNum(toIso_);
  if (!(b > a)) return 0;
  let count = weekdaysBefore(b + 1) - weekdaysBefore(a + 1);
  const y0 = Number(fromIso.slice(0, 4)), y1 = Number(toIso_.slice(0, 4));
  for (let y = y0; y <= y1; y++) for (const h of holidaysOf(y)) if (h > a && h <= b) count--;
  return count;
}

// Up to `count` business days ending at `endIso` (inclusive), newest first,
// never earlier than `notBeforeIso` when given.
export function businessDaysBack(endIso, count, notBeforeIso = null) {
  const out = [];
  const floor = notBeforeIso ? toNum(notBeforeIso) : -Infinity;
  for (let n = toNum(endIso); out.length < count && n >= floor; n--) {
    const iso = toIso(n);
    if (isBusinessDay(iso)) out.push(iso);
  }
  return out;
}

export const previousDay = (iso) => toIso(toNum(iso) - 1);

// Form 4 is due within two business days of the transaction (Exchange Act §16(a)).
export const FORM4_DEADLINE_BUSINESS_DAYS = 2;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Filing delay of one transaction row. Amendments (4/A) are measured from the
// original submission date when known — a later amendment is not a late filing.
// → null when either date is missing/invalid.
export function filingDelay({ transactionDate, filingDate, formType, originalSubmissionDate } = {}) {
  const filedIso = formType === "4/A" ? originalSubmissionDate : filingDate;
  if (!ISO_RE.test(transactionDate || "") || !ISO_RE.test(filedIso || "")) return null;
  const businessDays = businessDaysBetween(transactionDate, filedIso);
  const calendarDays = Math.max(toNum(filedIso) - toNum(transactionDate), 0);
  return {
    businessDays,
    calendarDays,
    measuredTo: formType === "4/A" ? "original_submission" : "filing_date",
    late: businessDays > FORM4_DEADLINE_BUSINESS_DAYS,
  };
}
