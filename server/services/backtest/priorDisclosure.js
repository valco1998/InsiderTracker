// server/services/backtest/priorDisclosure.js
//
// INFORMATIONAL: was the purchase possibly public BEFORE the Form 4 that produced the signal?
// For each signal it lists the issuer's own SEC filings of disclosure types accepted between
// the start of the earliest purchase trade date and the Form 4 acceptance time:
//   8-K / 6-K (current reports, incl. press releases furnished as exhibits),
//   424B* (prospectus supplements — offerings and their pricing),
//   SC 13D / SC 13G / SCHEDULE 13D / 13G (beneficial-ownership reports),
//   S-1 / F-1 / S-3 / F-3 (registration statements), 425 (merger communications).
// The filings' CONTENT is not read: a hit is a "possible earlier public disclosure" with a
// link, never proof that the purchase itself was disclosed. Press releases that were not
// filed with the SEC are NOT detected — stated in the methodology.
//
// SEC access: its own throttled EDGAR client (2 req/s, SEC_USER_AGENT), submissions JSON
// (data.sec.gov) cached on disk for 24 h. EDGAR's `acceptanceDateTime` is UTC (verified
// 2026-11-05: RAPP Form 4 0001104659-26-120789 header 19:32:45 ET = 23:32:45Z); it is
// converted to America/New_York and re-checked per issuer against the signal's own Form 4
// acceptance time (filing header). If that check fails the result is "unknown", never a guess.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEdgarClient } from "../edgar/edgarClient.js";
import { etParts } from "./entrySelection.js";

const DEFAULT_CACHE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "prior-disclosure.v2.json");
const TTL_MS = 24 * 3_600_000;
export const DISCLOSURE_FORM_RE = /^(8-K|6-K|424B\d|SC 13[DG]|SCHEDULE 13[DG]|S-1|F-1|S-3|F-3|425)(\/A)?$/;

// UTC acceptanceDateTime → "YYYY-MM-DD HH:MM:SS" Eastern clock.
const etClock = (utc) => { const ms = Date.parse(String(utc || "")); if (!Number.isFinite(ms)) return ""; const p = etParts(new Date(ms).toISOString()); return `${p.date} ${p.time}`; };
// submissions JSON (recent filings) → [{ form, accessionNo, acceptedClock (ET), primaryDocument, description }]
export function filingsFromSubmissions(j) {
  const f = j?.filings?.recent || {};
  const out = [];
  for (let i = 0; i < (f.form || []).length; i++) {
    out.push({ form: f.form[i], accessionNo: f.accessionNumber?.[i], acceptedClock: etClock(f.acceptanceDateTime?.[i]), acceptedUtc: f.acceptanceDateTime?.[i] || null, filingDate: f.filingDate?.[i], primaryDocument: f.primaryDocument?.[i] || null, description: f.primaryDocDescription?.[i] || null });
  }
  return out;
}

// Pure: disclosure filings in [fromDay 00:00 ET, beforeEt) given the issuer's filing list.
// clockCheck: { accessionNo, acceptedAtET } of the signal's Form 4 — must match the list's
// clock for that accession, else → { status: "unknown", reason }.
export function priorFilings(list, { cik, fromDay, beforeEt, clockCheck }) {
  const own = list.find((x) => x.accessionNo === clockCheck?.accessionNo);
  const want = String(clockCheck?.acceptedAtET || "").replace(/\s*ET$/, "");
  if (!own) return { status: "unknown", reason: "form4_not_in_recent_submissions", filings: [] };
  if (own.acceptedClock !== want) return { status: "unknown", reason: "acceptance_clock_mismatch", filings: [] };
  const before = want;
  const hits = list.filter((x) => DISCLOSURE_FORM_RE.test(x.form || "") && x.acceptedClock >= `${fromDay} 00:00:00` && x.acceptedClock < before)
    .map((x) => ({
      form: x.form, accessionNo: x.accessionNo, acceptedAt: `${x.acceptedClock} ET`, description: x.description,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(x.accessionNo).replace(/-/g, "")}/${x.accessionNo}-index.htm`,
      offeringDocument: /^424B/.test(x.form || ""),
    }))
    .sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt));
  return { status: hits.length ? "possible" : "none", filings: hits, firstAt: hits[0]?.acceptedAt || null };
}

export function createPriorDisclosureService({
  getText = null,
  cacheFile = DEFAULT_CACHE,
  now = () => Date.now(),
  log = console,
} = {}) {
  let client = null;
  const fetchText = (url) => (getText ? getText(url) : (client ||= createEdgarClient({ maxRps: 2, log })).getText(url));
  let cache = null;
  const load = () => { if (!cache) { try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { cache = { issuers: {} }; } } return cache; };
  const save = () => {
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify(cache)); fs.renameSync(`${cacheFile}.tmp`, cacheFile); }
    catch (err) { log.warn(`[PRIOR_DISCLOSURE_CACHE] write failed: ${String(err?.message || err).slice(0, 120)}`); }
  };
  async function listFor(cik, needAccession) {
    const c = load();
    const key = String(Number(cik));
    const hit = c.issuers[key];
    // Refetch when stale or when the cached list predates the Form 4 we need to anchor on.
    if (hit && now() - Date.parse(hit.checkedAt) < TTL_MS && (!needAccession || hit.list.some((x) => x.accessionNo === needAccession))) return hit.list;
    const j = JSON.parse(await fetchText(`https://data.sec.gov/submissions/CIK${key.padStart(10, "0")}.json`));
    const list = filingsFromSubmissions(j).filter((x) => DISCLOSURE_FORM_RE.test(x.form || "") || /^4(\/A)?$/.test(x.form || ""));
    c.issuers[key] = { checkedAt: new Date(now()).toISOString(), list };
    save();
    return list;
  }

  // items: [{ id, issuerCik, fromDay, publishedAt (ET stamp), accessionNo }] → { [id]: result }
  async function check(items) {
    const out = {};
    for (const it of items) {
      try {
        const list = await listFor(it.issuerCik, it.accessionNo);
        out[it.id] = priorFilings(list, { cik: it.issuerCik, fromDay: it.fromDay, beforeEt: it.publishedAt, clockCheck: { accessionNo: it.accessionNo, acceptedAtET: it.publishedAt } });
      } catch (err) {
        log.warn(`[PRIOR_DISCLOSURE] issuer=${it.issuerCik} error=${String(err?.message || err).slice(0, 160)}`);
        out[it.id] = { status: "unknown", reason: "sec_lookup_failed", filings: [] };
      }
    }
    return out;
  }
  return { check };
}
