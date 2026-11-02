// node --test src/utils/insiderCompanyFilters.test.js   (runs under Node, not the browser)
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCompanyRows, periodRange, activeFilterCount, easternToday, DEFAULT_COMPANY_FILTERS } from "./insiderCompanyFilters.js";

const TODAY = "2026-11-02";
const r = (id, extra) => ({ id, code: "P", value: 1000, transactionDate: "2026-10-28", insiderName: "Doe Jane", roleGroups: ["Other"], ...extra });
const rows = [
  r("ceo-dir", { roleGroups: ["CEO", "Director"], insiderName: "Doe Jane", value: 50_000 }),
  r("cfo", { roleGroups: ["CFO"], insiderName: "Roe Rick", code: "S", value: 20_000 }),
  r("fund", { roleGroups: ["10% Owner"], insiderName: "Big Fund LP", value: 5_000_000, transactionDate: "2026-08-01" }),
  r("officer-noprice", { roleGroups: ["Officer"], insiderName: "Vee Pee", value: null, transactionDate: "2026-10-27" }),
  r("anomaly", { roleGroups: ["Director"], insiderName: "Poe Pat", value: 9e9, priceCheck: { status: "anomaly" } }),
  r("related", { roleGroups: ["10% Owner"], insiderName: "Trust A", reportedBy: [{ insiderName: "Trust A" }, { insiderName: "Smith John" }] }),
];
const ids = (f) => filterCompanyRows(rows, { ...DEFAULT_COMPANY_FILTERS, ...f }, TODAY).map((x) => x.id);

test("no filters → every row, order preserved", () => {
  assert.deepEqual(ids({}), rows.map((x) => x.id));
  assert.equal(activeFilterCount(DEFAULT_COMPANY_FILTERS), 0);
});

test("roles: any selected role matches; a multi-role insider matches each of its roles", () => {
  assert.deepEqual(ids({ roles: ["CEO"] }), ["ceo-dir"]);
  assert.deepEqual(ids({ roles: ["Director"] }), ["ceo-dir", "anomaly"]);
  assert.deepEqual(ids({ roles: ["CFO", "10% Owner"] }), ["cfo", "fund", "related"]);
});

test("type, name (incl. related filers), value range (unpriced / anomalies excluded once bounded)", () => {
  assert.deepEqual(ids({ type: "sale" }), ["cfo"]);
  assert.deepEqual(ids({ name: "jane" }), ["ceo-dir"]);
  assert.deepEqual(ids({ name: "smith" }), ["related"], "a related filer named in reportedBy matches");
  assert.deepEqual(ids({ minValue: "10000", maxValue: "100000" }), ["ceo-dir", "cfo"]);
  assert.deepEqual(ids({ minValue: "1" }), ["ceo-dir", "cfo", "fund", "related"]);
  assert.equal(ids({ minValue: "abc" }).length, rows.length, "non-numeric bound ignored");
});

test("periods use the TRADE date, inclusive, ending today (ET)", () => {
  assert.deepEqual(periodRange({ period: "30" }, TODAY), { from: "2026-10-04", to: "2026-11-02" });
  assert.deepEqual(periodRange({ period: "7" }, TODAY), { from: "2026-10-27", to: "2026-11-02" });
  assert.equal(periodRange({ period: "all" }, TODAY), null);
  assert.deepEqual(ids({ period: "7" }), ["ceo-dir", "cfo", "officer-noprice", "anomaly", "related"]);
  assert.deepEqual(periodRange({ period: "90" }, TODAY), { from: "2026-08-05", to: "2026-11-02" });
  assert.deepEqual(ids({ period: "90" }), ["ceo-dir", "cfo", "officer-noprice", "anomaly", "related"], "Aug 1 is 93 days back — outside 90D");
  assert.deepEqual(ids({ period: "custom", from: "2026-08-01", to: "2026-08-01" }), ["fund"]);
  assert.equal(ids({ period: "custom", from: "", to: "" }).length, rows.length, "empty custom range = no limit");
  assert.equal(activeFilterCount({ ...DEFAULT_COMPANY_FILTERS, roles: ["CEO"], period: "30", minValue: "5" }), 3);
  assert.equal(easternToday(Date.parse("2026-11-03T03:30:00Z")), "2026-11-02");
});
