import { test } from "node:test";
import assert from "node:assert/strict";
import { etToIso, roleChips, evolutionPoints, holdingsLabel } from "./companiesEvidence.js";
import { logoFor, cik10, initialsOf } from "./issuerLogos.js";

test("etToIso: New York wall clock → UTC, DST-aware", () => {
  assert.equal(etToIso("2026-11-02 06:39:13"), "2026-11-02T11:39:13.000Z", "EST (UTC-5) after Nov 1");
  assert.equal(etToIso("2026-10-30 16:00:00 ET"), "2026-10-30T20:00:00.000Z", "EDT (UTC-4)");
  assert.equal(etToIso("nonsense"), null);
});

test("roleChips: server role groups → ordered chips; zero-buyer roles dropped", () => {
  assert.deepEqual(roleChips([{ role: "Director", buyers: 6 }, { role: "CFO", buyers: 1 }, { role: "Other", buyers: 1 }, { role: "CEO", buyers: 0 }]), ["CFO", "Dir"]);
  assert.deepEqual(roleChips(["10% Owner", "CEO"]), ["CEO", "10%"]);
});

test("evolutionPoints: cumulative buyers by first purchase date", () => {
  const p = evolutionPoints([{ name: "B", firstDate: "2026-10-22", value: 1 }, { name: "A", firstDate: "2026-10-20", value: 5 }, { name: "C", firstDate: null }]);
  assert.deepEqual(p.map((x) => [x.name, x.cumulative]), [["A", 1], ["B", 2]]);
});

test("holdingsLabel and logos", () => {
  assert.equal(holdingsLabel(0.0712), "+7.1%");
  assert.equal(holdingsLabel(2.5), "+250%");
  assert.equal(holdingsLabel(null), null);
  assert.equal(cik10("1739016"), "0001739016");
  assert.deepEqual(logoFor("1739016", { "0001739016": { bg: "dark" } }), { src: "/logos/0001739016.webp", bg: "dark" });
  assert.equal(logoFor("123", {}), null, "no manifest entry → initials");
  assert.equal(initialsOf("BRK.B", "Berkshire"), "BR");
  assert.equal(initialsOf(null, "John Hancock GA Senior Loan Trust"), "JH");
});
