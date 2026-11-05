// Possible earlier public disclosure (EDGAR submissions) — fake data, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { filingsFromSubmissions, priorFilings, createPriorDisclosureService } from "./priorDisclosure.js";

// EDGAR acceptanceDateTime is UTC: 23:32:45Z on 2026-10-30 (EDT) = 19:32:45 ET.
const SUBMISSIONS = { filings: { recent: {
  form: ["4", "424B5", "8-K", "8-K", "10-Q"],
  accessionNumber: ["0000000000-26-000004", "0000000000-26-000003", "0000000000-26-000002", "0000000000-26-000001", "0000000000-26-000005"],
  acceptanceDateTime: ["2026-10-30T23:32:45.000Z", "2026-10-28T10:15:00.000Z", "2026-10-31T13:00:00.000Z", "2026-10-20T14:00:00.000Z", "2026-10-29T20:00:00.000Z"],
  filingDate: ["2026-10-30", "2026-10-28", "2026-10-31", "2026-10-20", "2026-10-29"],
  primaryDocument: ["f4.xml", "p.htm", "a.htm", "b.htm", "q.htm"],
  primaryDocDescription: ["4", "424B5", "8-K", "8-K", "10-Q"],
} } };

test("UTC acceptance times are converted to Eastern (DST) before comparing", () => {
  const list = filingsFromSubmissions(SUBMISSIONS);
  assert.equal(list[0].acceptedClock, "2026-10-30 19:32:45");
  assert.equal(list[1].acceptedClock, "2026-10-28 06:15:00");
});

test("disclosure filings between the first trade date and the Form 4 are listed; later ones and other forms are not", () => {
  const list = filingsFromSubmissions(SUBMISSIONS);
  const r = priorFilings(list, { cik: "123", fromDay: "2026-10-28", beforeEt: "2026-10-30 19:32:45 ET", clockCheck: { accessionNo: "0000000000-26-000004", acceptedAtET: "2026-10-30 19:32:45 ET" } });
  assert.equal(r.status, "possible");
  assert.deepEqual(r.filings.map((f) => f.form), ["424B5"], "the 8-K of 10-31 came after; the 8-K of 10-20 before the trade; 10-Q is not a disclosure type here");
  assert.equal(r.filings[0].offeringDocument, true);
  assert.equal(r.firstAt, "2026-10-28 06:15:00 ET");
  const none = priorFilings(list, { cik: "123", fromDay: "2026-10-29", beforeEt: "2026-10-30 19:32:45 ET", clockCheck: { accessionNo: "0000000000-26-000004", acceptedAtET: "2026-10-30 19:32:45 ET" } });
  assert.equal(none.status, "none");
});

test("if the signal's own Form 4 time does not match, the answer is unknown — never a guess", () => {
  const list = filingsFromSubmissions(SUBMISSIONS);
  assert.equal(priorFilings(list, { cik: "1", fromDay: "2026-10-01", beforeEt: "x", clockCheck: { accessionNo: "0000000000-26-000004", acceptedAtET: "2026-10-30 23:32:45 ET" } }).reason, "acceptance_clock_mismatch");
  assert.equal(priorFilings(list, { cik: "1", fromDay: "2026-10-01", beforeEt: "x", clockCheck: { accessionNo: "missing", acceptedAtET: "x" } }).reason, "form4_not_in_recent_submissions");
});

test("service: one request per issuer (cached), lookup failures are 'unknown'", async () => {
  const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pd-")), "c.json");
  let calls = 0;
  const svc = createPriorDisclosureService({ cacheFile, getText: async (url) => { calls++; if (url.includes("0000000999")) throw new Error("503"); return JSON.stringify(SUBMISSIONS); }, log: { warn() {} } });
  const it = { issuerCik: "0000000123", fromDay: "2026-10-28", publishedAt: "2026-10-30 19:32:45 ET", accessionNo: "0000000000-26-000004" };
  const r = await svc.check([{ id: "a", ...it }, { id: "b", ...it }, { id: "c", ...it, issuerCik: "0000000999" }]);
  assert.equal(r.a.status, "possible");
  assert.equal(r.b.status, "possible");
  assert.equal(r.c.status, "unknown");
  assert.equal(calls, 2);
});
