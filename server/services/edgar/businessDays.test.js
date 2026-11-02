// SEC business-day calendar and Form 4 filing-delay classification.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBusinessDay, businessDaysBetween, businessDaysBack, filingDelay } from "./businessDays.js";

test("US federal holidays (observed) are not business days", () => {
  const holidays2026 = ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"];
  for (const d of holidays2026) assert.equal(isBusinessDay(d), false, d);
  // 2028-01-01 is a Saturday → observed Friday 2027-12-31.
  assert.equal(isBusinessDay("2027-12-31"), false);
  // Weekends; ordinary weekdays.
  assert.equal(isBusinessDay("2026-10-31"), false);
  assert.equal(isBusinessDay("2026-11-01"), false);
  for (const d of ["2026-10-30", "2026-11-02", "2026-11-27", "2026-07-06"]) assert.equal(isBusinessDay(d), true, d);
});

test("businessDaysBetween / businessDaysBack skip weekends and holidays", () => {
  assert.equal(businessDaysBetween("2026-10-28", "2026-10-30"), 2);
  assert.equal(businessDaysBetween("2026-10-30", "2026-11-03"), 2); // Fri → Tue
  assert.equal(businessDaysBetween("2026-11-25", "2026-11-30"), 2); // Thanksgiving skipped
  assert.equal(businessDaysBetween("2026-10-30", "2026-10-30"), 0);
  assert.equal(businessDaysBetween("2026-10-30", "2026-10-29"), 0);
  assert.deepEqual(businessDaysBack("2026-11-30", 3), ["2026-11-30", "2026-11-27", "2026-11-25"]);
  assert.deepEqual(businessDaysBack("2026-11-13", 10, "2026-11-10"), ["2026-11-13", "2026-11-12", "2026-11-10"]); // 11-11 Veterans Day
});

test("filingDelay: on-time vs late, holiday-aware, trade date vs filing date kept distinct", () => {
  // Within the 2-business-day deadline.
  assert.deepEqual(filingDelay({ transactionDate: "2026-10-28", filingDate: "2026-10-30", formType: "4" }),
    { businessDays: 2, calendarDays: 2, measuredTo: "filing_date", late: false });
  // Thanksgiving: 5 calendar days but only 2 business days → on time.
  assert.equal(filingDelay({ transactionDate: "2026-11-25", filingDate: "2026-11-30", formType: "4" }).late, false);
  // Real case from the audit: NUAI traded 2025-09-26, Form 4 filed 2026-10-30.
  const nuai = filingDelay({ transactionDate: "2025-09-26", filingDate: "2026-10-30", formType: "4" });
  assert.equal(nuai.late, true);
  assert.equal(nuai.calendarDays, 399);
  // One day past the deadline.
  assert.equal(filingDelay({ transactionDate: "2026-10-27", filingDate: "2026-10-30", formType: "4" }).late, true);
});

test("filingDelay: amendments are measured from the original submission, not the amendment date", () => {
  // Real SCCO case: traded 2026-09-24, original filed 2026-09-25, 4/A filed 2026-10-30.
  const d = filingDelay({ transactionDate: "2026-09-24", filingDate: "2026-10-30", formType: "4/A", originalSubmissionDate: "2026-09-25" });
  assert.deepEqual(d, { businessDays: 1, calendarDays: 1, measuredTo: "original_submission", late: false });
  // Unknown original date → no claim either way.
  assert.equal(filingDelay({ transactionDate: "2026-09-24", filingDate: "2026-10-30", formType: "4/A", originalSubmissionDate: null }), null);
  assert.equal(filingDelay({ transactionDate: null, filingDate: "2026-10-30", formType: "4" }), null);
});

test("closed-form businessDaysBetween equals a day-by-day count (incl. Dec 31 observed New Year)", () => {
  const DAY = 86_400_000;
  const iso = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const num = (s) => Date.parse(`${s}T00:00:00Z`) / DAY;
  const naive = (a, b) => { let c = 0; for (let n = num(a) + 1; n <= num(b); n++) if (isBusinessDay(iso(n))) c++; return c; };
  const cases = [["2027-12-30", "2028-01-03"], ["2021-12-30", "2022-01-04"], ["2016-12-30", "2017-01-03"], ["2025-09-26", "2026-10-30"], ["2026-11-25", "2026-11-30"]];
  // Deterministic pseudo-random ranges 2001–2035, up to ~4 years long.
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let i = 0; i < 400; i++) { const a = num("2001-01-01") + Math.floor(rnd() * 12000); cases.push([iso(a), iso(a + Math.floor(rnd() * 1500))]); }
  for (const [a, b] of cases) assert.equal(businessDaysBetween(a, b), naive(a, b), `${a}..${b}`);
  assert.equal(isBusinessDay("2027-12-31"), false);
  assert.equal(isBusinessDay("2028-01-03"), true);
});

test("filingDelay is O(1): 10,000 multi-year spans well under 50 ms", () => {
  const t = performance.now();
  for (let i = 0; i < 10_000; i++) filingDelay({ transactionDate: "2022-01-03", filingDate: "2026-10-30", formType: "4" });
  assert.ok(performance.now() - t < 50, `${(performance.now() - t).toFixed(1)} ms`);
});
