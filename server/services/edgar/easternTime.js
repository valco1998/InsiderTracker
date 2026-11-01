// server/services/edgar/easternTime.js
// EDGAR acceptance timestamps are US Eastern wall-clock time. Convert them to
// real instants with correct EST/EDT handling (no external tz library).

function nyOffsetMs(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime();
}

// "2026-10-30 21:35:06 ET" → Date (2026-10-31T01:35:06Z). Invalid → null.
export function parseAcceptedAtET(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ET$/);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, se);
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - nyOffsetMs(new Date(t));
  return Number.isFinite(t) ? new Date(t) : null;
}
