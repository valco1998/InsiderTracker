// server/services/backtest/form4History.js
//
// Historical SEC Form 4 store for the backtest — separate from the live ingest
// cache, never pruned, never written by the server (only by the backfill CLI).
//
//   server/.cache/backfill/form4/<YYYY-MM-DD>.json   one shard per SEC business day
//     { day, listed, noIndex, complete, accessions: [acc], records: { acc: record },
//       failed: { acc: { attempts, error, permanent } }, updatedAt }
//   server/.cache/backfill/form4/progress.json       last/current backfill run
//
// `record` has exactly the live ingest's filing shape (insiderIngest.js setFiling),
// so the same snapshot pipeline (price checks → Form 4/A linking → duplicate
// grouping) processes historical and live filings identically.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBusinessDay } from "../edgar/businessDays.js";

export const DEFAULT_STORE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "backfill", "form4");
const SHARD_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export const shardPath = (dir, day) => path.join(dir, `${day}.json`);

export function readShard(dir, day) {
  try { return JSON.parse(fs.readFileSync(shardPath(dir, day), "utf8")); } catch { return null; }
}

export function writeShard(dir, shard) {
  fs.mkdirSync(dir, { recursive: true });
  const f = shardPath(dir, shard.day), tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(shard));
  fs.renameSync(tmp, f);
}

export function readProgress(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "progress.json"), "utf8")); } catch { return null; }
}
export function writeProgress(dir, p) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "progress.json");
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(p));
  fs.renameSync(`${f}.tmp`, f);
}

export function shardStats(shard) {
  const listed = shard.accessions?.length ?? 0;
  const parsed = Object.keys(shard.records || {}).length;
  const failed = Object.values(shard.failed || {}).filter((f) => f.permanent || f.exhausted).length;
  return { day: shard.day, listed, parsed, failed, noIndex: !!shard.noIndex, complete: !!shard.complete };
}

// Short, stable failure reason for reporting ("HTTP 404", "not a Form 4", …).
export function failureReason(error) {
  const e = String(error || "");
  const http = /HTTP (\d{3})/.exec(e);
  if (http) return `HTTP ${http[1]}`;
  if (/not a Form 4/i.test(e)) return "not a Form 4";
  if (/no ownershipDocument/i.test(e)) return "no ownershipDocument";
  if (/timeout|timed out|abort/i.test(e)) return "timeout";
  return "other";
}

// Rich per-day stats for reporting (computed from the FULL shard before slimming).
export function shardReport(shard) {
  const st = shardStats(shard);
  const failedReasons = {};
  let pending = 0;
  for (const f of Object.values(shard.failed || {})) {
    if (f.permanent || f.exhausted) { const r = failureReason(f.error); failedReasons[r] = (failedReasons[r] || 0) + 1; } else pending++;
  }
  let withPurchases = 0, withPS = 0, amendments = 0;
  for (const rec of Object.values(shard.records || {})) {
    if (rec.formType === "4/A") amendments++;
    const codes = new Set((rec.transactions || []).map((t) => t.code));
    if (codes.has("P")) withPurchases++;
    if (codes.has("P") || codes.has("S")) withPS++;
  }
  return { ...st, notFetched: Math.max(0, st.listed - st.parsed - st.failed - pending), retryable: pending, failedReasons, withPurchases, withPS, amendments };
}

// A record is needed in memory only if it can affect signals: it has P/S transactions
// (the parser keeps only those) or it is a Form 4/A (amendment supersession). All others
// are still counted in the per-day stats — never treated as missing.
export const isSignalRelevant = (rec) => rec?.formType === "4/A" || (rec?.transactions?.length ?? 0) > 0;

// Loads every shard (cached by a cheap directory signature).
let memo = { sig: null, data: null };
const shardMemo = { dir: null, byName: new Map() };
export function loadHistoryStore(dir = DEFAULT_STORE_DIR) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => SHARD_RE.test(n)).sort(); } catch { names = []; }
  const mtimes = names.map((n) => { try { return fs.statSync(path.join(dir, n)).mtimeMs; } catch { return 0; } });
  const sig = `${dir}|${names.length}|${mtimes.join(",")}`;
  if (memo.sig === sig) return memo.data;
  // Per-shard cache: an unchanged shard (same mtime) is never parsed again — while a
  // backfill writes one shard every few seconds, only that shard is re-read.
  if (shardMemo.dir !== dir) { shardMemo.dir = dir; shardMemo.byName = new Map(); }
  const records = new Map(), days = new Map();
  const seen = new Set();
  names.forEach((n, i) => {
    seen.add(n);
    let c = shardMemo.byName.get(n);
    if (!c || c.mtime !== mtimes[i]) {
      const s = readShard(dir, n.slice(0, 10));
      if (!s) { shardMemo.byName.delete(n); return; }
      c = { mtime: mtimes[i], day: s.day, report: shardReport(s), recs: Object.entries(s.records || {}).filter(([, rec]) => isSignalRelevant(rec)) };
      shardMemo.byName.set(n, c);
    }
    days.set(c.day, c.report);
    for (const [acc, rec] of c.recs) records.set(acc, rec);
  });
  for (const n of [...shardMemo.byName.keys()]) if (!seen.has(n)) shardMemo.byName.delete(n);
  memo = { sig, data: { sig, records, days } };
  return memo.data;
}

// Merges historical records with the live ingest (live wins for the same accession).
// live: { transactions, amendmentFilings, coverage, noIndexDays } from insiderIngest.
export function buildHistoryDataset({ store, live = null }) {
  const liveAccs = new Set((live?.transactions || []).map((t) => t.accessionNo));
  for (const a of live?.amendmentFilings || []) liveAccs.add(a.accessionNo);
  const transactions = [...(live?.transactions || [])];
  const amendmentFilings = [...(live?.amendmentFilings || [])];
  for (const [acc, f] of store.records) {
    if (liveAccs.has(acc)) continue;
    for (const t of f.transactions || []) transactions.push(t);
    if (f.formType === "4/A") {
      amendmentFilings.push({
        accessionNo: acc, issuerCik: f.issuerCik ?? null, ownerCiks: f.ownerCiks ?? [],
        originalSubmissionDate: f.originalSubmissionDate ?? null, hasNonDerivativeTable: f.hasNonDerivativeTable ?? null,
        totalNonDerivative: f.totalNonDerivative ?? null, acceptedAtET: f.acceptedAtET ?? null, filingDate: f.filingDate ?? null,
      });
    }
  }
  const acceptedAtByAccession = new Map();
  for (const t of transactions) if (t.acceptedAtET && !acceptedAtByAccession.has(t.accessionNo)) acceptedAtByAccession.set(t.accessionNo, t.acceptedAtET);
  for (const a of amendmentFilings) if (a.acceptedAtET && !acceptedAtByAccession.has(a.accessionNo)) acceptedAtByAccession.set(a.accessionNo, a.acceptedAtET);
  return { transactions, amendmentFilings, acceptedAtByAccession };
}

// Coverage of SEC business days in [from, to]: every day must be held completely
// (historical shard complete, or live day fully parsed) or known to have no index.
export function historyCoverage({ from, to, store, live = null, today }) {
  const liveDays = new Map((live?.coverage || []).map((c) => [c.day, c]));
  const noIndex = new Set(live?.noIndexDays || []);
  const end = to < today ? to : today;
  const missing = [], partial = [];
  let total = 0, covered = 0;
  for (let d = from; d <= end; d = addDays(d, 1)) {
    if (!isBusinessDay(d)) continue;
    total++;
    const h = store.days.get(d), l = liveDays.get(d);
    const ok = noIndex.has(d) || h?.complete || h?.noIndex || (l && l.pending === 0 && l.parsed + l.failed >= l.listed && l.listed > 0);
    if (ok) { covered++; continue; }
    if (h || l) partial.push(d); else missing.push(d);
  }
  let coveredFrom = null;
  // Earliest day from which coverage is contiguous to `end`.
  for (let d = end; d >= from; d = addDays(d, -1)) {
    if (!isBusinessDay(d)) continue;
    if (missing.includes(d) || partial.includes(d)) break;
    coveredFrom = d;
  }
  return {
    from, to: end, businessDays: total, coveredDays: covered,
    complete: total > 0 && covered === total,
    ratio: total ? Math.round((covered / total) * 1000) / 1000 : 0,
    coveredFrom,
    missingDays: missing.length, partialDays: partial.length,
    firstMissing: missing.slice(0, 10), firstPartial: partial.slice(0, 10),
    historicalDaysHeld: store.days.size,
  };
}

// Month-by-month coverage of SEC business days in [from, to] (history shards + live
// ingest). A day counts as covered only when held completely; "missing" days are
// never treated as zero activity.
export function monthlyCoverage({ from, to, store, live = null, today }) {
  const liveDays = new Map((live?.coverage || []).map((c) => [c.day, c]));
  const noIndex = new Set(live?.noIndexDays || []);
  const end = to < today ? to : addDays(today, -1);
  const months = new Map();
  const m = (d) => {
    const k = d.slice(0, 7);
    if (!months.has(k)) months.set(k, { month: k, businessDays: 0, complete: 0, partial: 0, missing: 0, closed: 0, listed: 0, parsed: 0, failed: 0, notFetched: 0, withPurchases: 0, amendments: 0, failedReasons: {}, source: { history: 0, live: 0 } });
    return months.get(k);
  };
  for (let d = from; d <= end; d = addDays(d, 1)) {
    if (!isBusinessDay(d)) continue;
    const x = m(d);
    x.businessDays++;
    const h = store.days.get(d), l = liveDays.get(d);
    if (noIndex.has(d) || h?.noIndex) { x.closed++; continue; }
    const liveOk = l && l.pending === 0 && l.parsed + l.failed >= l.listed && l.listed > 0;
    if (h?.complete) {
      x.complete++; x.source.history++;
    } else if (liveOk) {
      x.complete++; x.source.live++;
    } else if (h || l) x.partial++; else { x.missing++; continue; }
    const s = h || { listed: l.listed, parsed: l.parsed, failed: l.failed, notFetched: Math.max(0, l.listed - l.parsed - l.failed), withPurchases: null, amendments: null, failedReasons: {} };
    x.listed += s.listed || 0; x.parsed += s.parsed || 0; x.failed += s.failed || 0; x.notFetched += s.notFetched || 0;
    if (s.withPurchases != null) x.withPurchases += s.withPurchases;
    if (s.amendments != null) x.amendments += s.amendments;
    for (const [r, n] of Object.entries(s.failedReasons || {})) x.failedReasons[r] = (x.failedReasons[r] || 0) + n;
  }
  return [...months.values()].map((x) => ({ ...x, ratio: x.businessDays ? Math.round(((x.complete + x.closed) / x.businessDays) * 1000) / 1000 : 0 }));
}

// Read-only view of the live ingest's cache file in the same shape as the
// running ingest provides (used by CLI tools that run without the server).
export const DEFAULT_LIVE_CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "insider-filings.json");
export function loadLiveCacheFile(file = DEFAULT_LIVE_CACHE) {
  let c;
  try { c = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  const transactions = [], amendmentFilings = [];
  for (const [acc, f] of Object.entries(c.filings || {})) {
    for (const t of f.transactions || []) transactions.push(t);
    if (f.formType === "4/A") {
      amendmentFilings.push({
        accessionNo: acc, issuerCik: f.issuerCik ?? null, ownerCiks: f.ownerCiks ?? [], originalSubmissionDate: f.originalSubmissionDate ?? null,
        hasNonDerivativeTable: f.hasNonDerivativeTable ?? null, totalNonDerivative: f.totalNonDerivative ?? null, acceptedAtET: f.acceptedAtET ?? null, filingDate: f.filingDate ?? null,
      });
    }
  }
  const coverage = Object.entries(c.indexes || {}).map(([day, accs]) => ({ day, listed: accs.length, parsed: accs.filter((a) => c.filings?.[a]).length, failed: 0, pending: 0 }));
  return { transactions, amendmentFilings, coverage, noIndexDays: c.noIndexDays || [], dataVersion: `file:${c.savedAt || ""}` };
}
