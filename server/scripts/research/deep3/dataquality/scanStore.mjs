// deep3/dataquality/scanStore.mjs — READ-ONLY scan of the SEC Form 4 history store and the live ingest cache.
//   node scripts/research/deep3/dataquality/scanStore.mjs   → .cache/research/deep3/dataquality/store-scan.json
// Never opens progress.json (only its file metadata via stat), never writes under .cache/backfill, no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBusinessDay } from "../../../../services/edgar/businessDays.js";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const STORE = path.join(SERVER, ".cache", "backfill", "form4");
const LIVE = path.join(SERVER, ".cache", "insider-filings.json");
const OUT = path.join(SERVER, ".cache", "research", "deep3", "dataquality");
fs.mkdirSync(OUT, { recursive: true });
const DAY = 86_400_000;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const inc = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; return m; };
const nextBusinessDay = (d) => { let x = addDays(d, 1); while (!isBusinessDay(x)) x = addDays(x, 1); return x; };
const ACC_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2}) ET$/;

// ---------- file inventory (metadata only) ----------
const names = fs.readdirSync(STORE).sort();
const files = names.map((n) => { const st = fs.statSync(path.join(STORE, n)); return { name: n, bytes: st.size, mtime: st.mtime.toISOString() }; });
const shardFiles = files.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name));
const otherFiles = files.filter((f) => !/^\d{4}-\d{2}-\d{2}\.json$/.test(f.name));
const lastShardWrite = [...shardFiles].sort((a, b) => (a.mtime < b.mtime ? 1 : -1))[0];

// ---------- shard scan ----------
const perDay = [];
const T = {
  records: 0, byForm: {}, parserVersion: {}, filingsWithP: 0, filingsWithS: 0, filingsWithPandS: 0, filingsWithNeither: 0, filingsNoTable: 0,
  pRows: 0, sRows: 0, otherCodeRows: 0, totalNonDerivRows: 0, byMonth: {},
  acceptance: { missing: 0, missingWithPS: 0, missingAmendNoPS: 0, malformed: 0, outside0622: 0, before0600: 0, after2200: 0, weekend: 0, holiday: 0, notShardDay: 0, byHour: {}, samplesOutside: [], samplesWeekend: [], samplesNotShardDay: [] },
  filingDate: { missing: 0, sameAsAcceptance: 0, nextBusinessDay: 0, other: 0, samplesOther: [], notShardDay: 0 },
  amendments: { count: 0, withOriginalDate: 0 },
  recordLevelMissing: { issuerCik: 0, acceptedAtET: 0, recoveredFromTransactions: 0, ownerCiks: 0, note: "records reused from the live ingest cache keep these fields only on their transactions" },
  tickers: { pFilingsNoTicker: 0, sFilingsNoTicker: 0, reportedDiffers: 0, samplesDiffers: [] },
};
const issuersAll = new Set(), issuersP = new Set(), issuersS = new Set(), tickersAll = new Set(), tickersP = new Set();
const ownersAll = new Set(), ownersP = new Set(), ownersS = new Set();
const accSeen = new Map(); // accession → day (duplicate listings across days)
let dupAcrossDays = 0; const dupList = [];
for (const f of shardFiles) {
  const s = JSON.parse(fs.readFileSync(path.join(STORE, f.name), "utf8"));
  const recs = Object.entries(s.records || {});
  const failed = Object.values(s.failed || {});
  const permanent = failed.filter((x) => x.permanent).length, exhausted = failed.filter((x) => !x.permanent && x.exhausted).length;
  const pending = failed.filter((x) => !x.permanent && !x.exhausted).length;
  const listed = s.accessions?.length ?? 0;
  const failReasons = {};
  for (const x of failed) inc(failReasons, /HTTP (\d{3})/.exec(x.error || "")?.[0] || (/not a Form 4/.test(x.error) ? "not a Form 4" : /no ownershipDocument/.test(x.error) ? "no ownershipDocument" : "other"));
  let dP = 0, dS = 0, dPF = 0, dSF = 0;
  for (const [acc, r] of recs) {
    if (accSeen.has(acc)) { dupAcrossDays++; dupList.push({ acc, firstDay: accSeen.get(acc), againOn: s.day, pRows: (r.transactions || []).filter((t) => t.code === "P").length, sRows: (r.transactions || []).filter((t) => t.code === "S").length }); continue; }
    accSeen.set(acc, s.day);
    T.records++; inc(T.byForm, r.formType || "?"); inc(T.parserVersion, String(r.parserVersion ?? "?"));
    const tx = r.transactions || [];
    const nP = tx.filter((t) => t.code === "P").length, nS = tx.filter((t) => t.code === "S").length;
    T.pRows += nP; T.sRows += nS; dP += nP; dS += nS;
    if (!r.hasNonDerivativeTable) T.filingsNoTable++;
    T.totalNonDerivRows += r.totalNonDerivative || 0; T.otherCodeRows += Math.max(0, (r.totalNonDerivative || 0) - tx.length);
    if (nP && nS) T.filingsWithPandS++;
    if (nP) { T.filingsWithP++; dPF++; } if (nS) { T.filingsWithS++; dSF++; } if (!nP && !nS) T.filingsWithNeither++;
    const m = (s.day || "").slice(0, 7); const bm = T.byMonth[m] || (T.byMonth[m] = { filings: 0, withP: 0, withS: 0, pRows: 0, sRows: 0, amendments: 0 });
    bm.filings++; if (nP) bm.withP++; if (nS) bm.withS++; bm.pRows += nP; bm.sRows += nS; if (r.formType === "4/A") bm.amendments++;
    if (r.formType === "4/A") { T.amendments.count++; if (r.originalSubmissionDate) T.amendments.withOriginalDate++; }
    const ik = (r.issuerCik || tx[0]?.issuerCik) ? Number(r.issuerCik || tx[0]?.issuerCik) : null;
    if (!r.issuerCik) T.recordLevelMissing.issuerCik++;
    if (!r.acceptedAtET) { T.recordLevelMissing.acceptedAtET++; if (tx[0]?.acceptedAtET) T.recordLevelMissing.recoveredFromTransactions++; }
    if (!r.ownerCiks) T.recordLevelMissing.ownerCiks++;
    if (ik) { issuersAll.add(ik); if (nP) issuersP.add(ik); if (nS) issuersS.add(ik); }
    if (r.ticker) { tickersAll.add(r.ticker); if (nP) tickersP.add(r.ticker); }
    if (nP && !r.ticker) T.tickers.pFilingsNoTicker++;
    if (nS && !r.ticker) T.tickers.sFilingsNoTicker++;
    if (r.ticker && r.tickerReported && r.ticker !== r.tickerReported) { T.tickers.reportedDiffers++; if (T.tickers.samplesDiffers.length < 25) T.tickers.samplesDiffers.push({ acc, reported: r.tickerReported, normalized: r.ticker }); }
    for (const o of r.ownerCiks || [...new Set(tx.flatMap((t) => (t.owners || []).map((x) => x.cik)).filter(Boolean))]) { const k = Number(o); ownersAll.add(k); if (nP) ownersP.add(k); if (nS) ownersS.add(k); }
    // acceptance timestamp
    const a = r.acceptedAtET || tx[0]?.acceptedAtET;
    if (!a) { T.acceptance.missing++; if (nP || nS) T.acceptance.missingWithPS++; else if (r.formType === "4/A") T.acceptance.missingAmendNoPS++; continue; }
    const mm = ACC_RE.exec(a);
    if (!mm) { T.acceptance.malformed++; continue; }
    const [, ad, hh, mi] = mm, hm = `${hh}:${mi}`;
    inc(T.acceptance.byHour, hh);
    const relevant = nP > 0 || nS > 0;
    if (hm < "06:00" || hm >= "22:00") { T.acceptance.outside0622++; if (hm < "06:00") T.acceptance.before0600++; else T.acceptance.after2200++; if (T.acceptance.samplesOutside.length < 40) T.acceptance.samplesOutside.push({ acc, acceptedAt: a, filingDate: r.filingDate, shardDay: s.day, hasP: nP > 0, hasS: nS > 0 }); }
    if (dow(ad) === 0 || dow(ad) === 6) { T.acceptance.weekend++; if (T.acceptance.samplesWeekend.length < 40) T.acceptance.samplesWeekend.push({ acc, acceptedAt: a, filingDate: r.filingDate, shardDay: s.day, relevant }); }
    else if (!isBusinessDay(ad)) T.acceptance.holiday++;
    if (ad !== s.day) { T.acceptance.notShardDay++; if (T.acceptance.samplesNotShardDay.length < 40) T.acceptance.samplesNotShardDay.push({ acc, acceptedAt: a, filingDate: r.filingDate, shardDay: s.day, form: r.formType, relevant }); }
    // filing date vs acceptance date
    const fd = r.filingDate;
    if (!fd) T.filingDate.missing++;
    else if (fd === ad) T.filingDate.sameAsAcceptance++;
    else if (fd === nextBusinessDay(ad)) T.filingDate.nextBusinessDay++;
    else { T.filingDate.other++; if (T.filingDate.samplesOther.length < 40) T.filingDate.samplesOther.push({ acc, acceptedAt: a, filingDate: fd, shardDay: s.day, form: r.formType, relevant }); }
    if (fd && fd !== s.day) T.filingDate.notShardDay++;
  }
  perDay.push({ day: s.day, file: f.name, bytes: f.bytes, mtime: f.mtime, updatedAt: s.updatedAt || null, complete: !!s.complete, noIndex: !!s.noIndex,
    listed, parsed: recs.length, failedPermanent: permanent, failedExhausted: exhausted, pendingRetry: pending, notFetched: Math.max(0, listed - recs.length - permanent - exhausted - pending),
    failReasons, pRows: dP, sRows: dS, pFilings: dPF, sFilings: dSF });
}

// ---------- business-day coverage ----------
const held = new Map(perDay.map((d) => [d.day, d]));
const first = perDay[0]?.day, last = perDay.at(-1)?.day;
const bdays = []; for (let d = first; d <= last; d = addDays(d, 1)) if (isBusinessDay(d)) bdays.push(d);
const missing = bdays.filter((d) => !held.has(d));
const partial = perDay.filter((d) => !d.complete && !d.noIndex);
const heldNonBusiness = perDay.filter((d) => !isBusinessDay(d.day)).map((d) => d.day);

// ---------- live ingest cache (read-only) ----------
let live = null;
try {
  const st = fs.statSync(LIVE);
  const c = JSON.parse(fs.readFileSync(LIVE, "utf8"));
  const days = Object.keys(c.indexes || {}).sort();
  const fil = Object.entries(c.filings || {});
  const notInStore = fil.filter(([acc]) => !accSeen.has(acc));
  const byDay = {};
  for (const d of days) { const accs = c.indexes[d] || []; byDay[d] = { listed: accs.length, parsed: accs.filter((a) => c.filings?.[a]).length, inStore: accs.filter((a) => accSeen.has(a)).length }; }
  const pOf = (r) => (r.transactions || []).filter((t) => t.code === "P").length, sOf = (r) => (r.transactions || []).filter((t) => t.code === "S").length;
  const accDays = {}; for (const [, r] of fil) inc(accDays, String(r.acceptedAtET || r.filingDate || "?").slice(0, 10));
  live = {
    file: ".cache/insider-filings.json", bytes: st.size, mtime: st.mtime.toISOString(), version: c.version, savedAt: c.savedAt,
    filings: fil.length, indexDays: days, byIndexDay: byDay, noIndexDays: c.noIndexDays || [], timelines: Object.keys(c.timelines || {}).length,
    filingsNotInStore: notInStore.length, notInStoreWithP: notInStore.filter(([, r]) => pOf(r) > 0).length, notInStoreWithS: notInStore.filter(([, r]) => sOf(r) > 0).length,
    notInStorePRows: notInStore.reduce((a, [, r]) => a + pOf(r), 0), notInStoreSRows: notInStore.reduce((a, [, r]) => a + sOf(r), 0),
    notInStoreByAcceptanceDay: Object.fromEntries(Object.entries(notInStore.reduce((m, [, r]) => inc(m, String(r.acceptedAtET || r.filingDate || "?").slice(0, 10)), {})).sort()),
    filingsByAcceptanceDay: Object.fromEntries(Object.entries(accDays).sort()),
  };
} catch (err) { live = { error: String(err.message).slice(0, 200) }; }

const out = {
  builtAt: new Date().toISOString(), store: STORE,
  files: { shards: shardFiles.length, other: otherFiles, bytes: files.reduce((a, f) => a + f.bytes, 0),
    lastShardWritten: lastShardWrite ? { name: lastShardWrite.name, mtime: lastShardWrite.mtime } : null,
    progressJson: otherFiles.find((f) => f.name === "progress.json") ? { mtime: otherFiles.find((f) => f.name === "progress.json").mtime, bytes: otherFiles.find((f) => f.name === "progress.json").bytes, note: "metadata only (stat); contents not read" } : null,
    shardMtimeRange: [shardFiles.map((f) => f.mtime).sort()[0], shardFiles.map((f) => f.mtime).sort().at(-1)] },
  coverage: { first, last, secBusinessDays: bdays.length, held: perDay.length, heldNonBusinessDays: heldNonBusiness, complete: perDay.filter((d) => d.complete && !d.noIndex).length, noIndex: perDay.filter((d) => d.noIndex).map((d) => d.day),
    missingDays: missing, partialDays: partial.map((d) => ({ day: d.day, listed: d.listed, parsed: d.parsed, failedPermanent: d.failedPermanent, failedExhausted: d.failedExhausted, pendingRetry: d.pendingRetry, notFetched: d.notFetched, failReasons: d.failReasons })),
    listedTotal: perDay.reduce((a, d) => a + d.listed, 0), parsedTotal: perDay.reduce((a, d) => a + d.parsed, 0),
    unparsedTotal: perDay.reduce((a, d) => a + d.failedPermanent + d.failedExhausted + d.pendingRetry + d.notFetched, 0),
    failReasonsTotal: perDay.reduce((m, d) => { for (const [k, v] of Object.entries(d.failReasons)) inc(m, k, v); return m; }, {}) },
  totals: { ...T, accessionsListedOnTwoDays: dupAcrossDays, duplicateListings: dupList, distinctIssuers: issuersAll.size, distinctIssuersWithP: issuersP.size, distinctIssuersWithS: issuersS.size,
    distinctTickers: tickersAll.size, distinctTickersWithP: tickersP.size, distinctOwnerCiks: ownersAll.size, distinctOwnerCiksWithP: ownersP.size, distinctOwnerCiksWithS: ownersS.size },
  perDay, live,
};
fs.writeFileSync(path.join(OUT, "store-scan.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ shards: shardFiles.length, first, last, businessDays: bdays.length, missing, partial: partial.length, records: T.records, pRows: T.pRows, sRows: T.sRows,
  acceptance: { missing: T.acceptance.missing, malformed: T.acceptance.malformed, outside: T.acceptance.outside0622, weekend: T.acceptance.weekend, notShardDay: T.acceptance.notShardDay },
  filingDate: { same: T.filingDate.sameAsAcceptance, next: T.filingDate.nextBusinessDay, other: T.filingDate.other }, live: { filings: live?.filings, notInStore: live?.filingsNotInStore, days: live?.indexDays } }, null, 1));
