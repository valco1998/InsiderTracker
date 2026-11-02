// NYSE session calendar: weekends, holidays (incl. observed and special closures), early closes, entry timing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { holidays, isSession, isEarlyClose, entrySessionFor, lastClosedSession, nextSession, sessionsBetween } from "./sessionCalendar.js";

test("NYSE holidays 2025 and 2026 (published schedules)", () => {
  assert.deepEqual([...holidays(2026)].sort(), ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]);
  assert.deepEqual([...holidays(2025)].sort(), ["2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25"]);
  assert.equal(isSession("2025-01-09"), false, "National Day of Mourning (President Carter)");
  assert.equal(isSession("2021-12-31"), true, "New Year's Day on Saturday is not observed on Friday");
  assert.equal(isSession("2021-06-18"), true, "Juneteenth only from 2022");
  assert.equal(isSession("2026-10-12"), true, "Columbus Day: SEC closed, NYSE open");
  assert.equal(isSession("2026-11-11"), true, "Veterans Day: NYSE open");
});

test("weekends and early closes", () => {
  assert.equal(isSession("2026-03-07"), false);
  assert.equal(isSession("2026-03-08"), false);
  assert.equal(isEarlyClose("2026-11-27"), true);
  assert.equal(isEarlyClose("2026-12-24"), true);
  assert.equal(isEarlyClose("2026-11-25"), false);
  assert.equal(sessionsBetween("2026-12-21", "2027-01-04").join(","), "2026-12-21,2026-12-22,2026-12-23,2026-12-24,2026-12-28,2026-12-29,2026-12-30,2026-12-31,2027-01-04");
});

test("entry session: before the open → same day; intraday, after hours, weekend, holiday → next session", () => {
  assert.equal(entrySessionFor("2026-03-05 08:59:59 ET"), "2026-03-05");
  assert.equal(entrySessionFor("2026-03-05 09:30:00 ET"), "2026-03-06");
  assert.equal(entrySessionFor("2026-03-05 21:45:10 ET"), "2026-03-06");
  assert.equal(entrySessionFor("2026-03-06 17:30:00 ET"), "2026-03-09", "Friday evening → Monday");
  assert.equal(entrySessionFor("2026-01-16 18:00:00 ET"), "2026-01-20", "Friday before Martin Luther King Jr. Day → Tuesday");
  assert.equal(entrySessionFor("2026-04-03 07:00:00 ET"), "2026-04-06", "Good Friday morning (SEC open, NYSE closed)");
  assert.equal(entrySessionFor("garbage"), null);
  assert.equal(nextSession("2026-07-02"), "2026-07-06");
});

test("last closed session (prices the public could know at disclosure)", () => {
  assert.equal(lastClosedSession("2026-03-05 15:59:00 ET"), "2026-03-04");
  assert.equal(lastClosedSession("2026-03-05 16:00:00 ET"), "2026-03-05");
  assert.equal(lastClosedSession("2026-11-27 13:30:00 ET"), "2026-11-27", "early close at 13:00");
  assert.equal(lastClosedSession("2026-03-08 12:00:00 ET"), "2026-03-06");
});
