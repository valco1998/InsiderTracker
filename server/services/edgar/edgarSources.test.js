// Tests for EDGAR discovery parsers. Inputs are SYNTHETIC snippets in the
// documented SEC formats — never served as data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeedForm4, parseDailyFormIndex, dailyIndexUrl } from "./edgarSources.js";

const entry = (term, cik, acc) => `<entry>
<title>${term} - Example (000${cik}) (Reporting)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/${acc}-index.htm"/>
<category scheme="https://www.sec.gov/" label="form type" term="${term}"/>
<id>urn:tag:sec.gov,2008:accession-number=${acc}</id></entry>`;

test("feed: the type=4 prefix noise (424B2, 497, 40-F, ...) is rejected; only 4 and 4/A kept", () => {
  const atom = "<feed>" + [
    entry("4", 111, "0000000111-26-000001"),
    entry("4", 222, "0000000111-26-000001"), // same filing, other filer → de-duplicated
    entry("4/A", 333, "0000000333-26-000002"),
    entry("424B2", 444, "0000000444-26-000003"),
    entry("497", 555, "0000000555-26-000004"),
    entry("497K", 556, "0000000556-26-000005"),
    entry("485BXT", 557, "0000000557-26-000006"),
    entry("40-F", 558, "0000000558-26-000007"),
    entry("425", 559, "0000000559-26-000008"),
  ].join("\n") + "</feed>";
  const r = parseFeedForm4(atom);
  assert.equal(r.entries, 9);
  assert.deepEqual(r.form4.map((f) => [f.accessionNo, f.formType]), [["0000000111-26-000001", "4"], ["0000000333-26-000002", "4/A"]]);
});

test("daily index: Form 4 / 4/A rows only, one entry per accession", () => {
  const idx = [
    "Form Type   Company Name                                                  CIK         Date Filed  File Name",
    "-".repeat(140),
    "4           Example Issuer Inc                                            1111111     20261030    edgar/data/1111111/0001111111-26-000010.txt",
    "4           Doe Jane                                                      2222222     20261030    edgar/data/2222222/0001111111-26-000010.txt",
    "4/A         Example Issuer Inc                                            1111111     20261030    edgar/data/1111111/0001111111-26-000011.txt",
    "424B2       Some Bank                                                     3333333     20261030    edgar/data/3333333/0003333333-26-000001.txt",
    "40-F        Foreign Co                                                    4444444     20261030    edgar/data/4444444/0004444444-26-000001.txt",
    "497K        Fund Trust                                                    5555555     20261030    edgar/data/5555555/0005555555-26-000001.txt",
  ].join("\n");
  const r = parseDailyFormIndex(idx);
  assert.deepEqual(r.map((e) => [e.accessionNo, e.formType]), [["0001111111-26-000011", "4/A"], ["0001111111-26-000010", "4"]]);
});

test("daily index URL uses the correct quarter", () => {
  assert.match(dailyIndexUrl("20261030"), /\/2026\/QTR4\/form\.20261030\.idx$/);
  assert.match(dailyIndexUrl("20260331"), /\/2026\/QTR1\/form\.20260331\.idx$/);
  assert.match(dailyIndexUrl("20260701"), /\/2026\/QTR3\/form\.20260701\.idx$/);
});
