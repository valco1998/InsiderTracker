// scripts/research/datasetStats12m.mjs — READ-ONLY statistics + coverage audit of the historical
// SEC Form 4 dataset (open-market purchases, code P) for a filing-date window.
//   node --max-old-space-size=4096 scripts/research/datasetStats12m.mjs [--from 2025-11-01] [--to 2026-10-31]
//   → .cache/research/dataset-12m/{stats.json, purchases.csv} (git-ignored) + console tables
// No network, no MongoDB, never writes under .cache/backfill. Uses the SAME pipeline as the live
// snapshot (insiderSnapshot.checkRows → transactionGroups.groupTransactions → computeTotals):
//   price checks → Form 4/A supersession (amendments.js) → economic de-duplication of joint filings.
// Period basis = SEC filing (acceptance) day. Amendments filed after `to` that are already held are
// still applied, so an in-period original restated later is counted as restated (as of today).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_STORE_DIR, loadHistoryStore, buildHistoryDataset, loadLiveCacheFile, monthlyCoverage, readShard, failureReason } from "../../services/backtest/form4History.js";
import { checkRows } from "../../services/edgar/insiderSnapshot.js";
import { groupTransactions, computeTotals } from "../../services/edgar/transactionGroups.js";
import { isSuperseded } from "../../services/edgar/amendments.js";
import { isBusinessDay } from "../../services/edgar/businessDays.js";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg("from", "2025-11-01"), TO = arg("to", "2026-10-31");
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(SERVER, ".cache", "research", "dataset-12m");
fs.mkdirSync(OUT, { recursive: true });
const DAY = 86_400_000;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const r2 = (x) => Math.round(x * 100) / 100;
// As-filed values include obvious filer errors (price entered as the aggregate amount, ADS price × ordinary
// shares, …) that pass the existing price checks. Screened totals exclude any single row above this amount;
// every excluded row is listed in stats.json → outliersExcluded. As-filed totals are always reported too.
const OUTLIER_USD = Number(arg("outlier-usd", 1e9));
const filedDay = (t) => (t.acceptedAtET ? t.acceptedAtET.slice(0, 10) : t.filingDate) || null;
const inPeriod = (d) => d && d >= FROM && d <= TO;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

// ---------- load (history shards + live cache; live wins per accession, so no accession counts twice) ----------
const store = loadHistoryStore(DEFAULT_STORE_DIR);
const lc = loadLiveCacheFile();
const { transactions, amendmentFilings } = buildHistoryDataset({ store, live: lc ? { transactions: lc.transactions, amendmentFilings: lc.amendmentFilings } : null });
const rowIds = new Set(); let dupRowIds = 0;
const uniqueTx = transactions.filter((t) => (rowIds.has(t.id) ? (dupRowIds++, false) : rowIds.add(t.id)));

// ---------- same pipeline as the live snapshot ----------
const checked = checkRows(uniqueTx, amendmentFilings);
const economic = groupTransactions(checked);

// ---------- amendment audit (in-period 4/A filings) ----------
const amendStatus = {};
const seenAmend = new Set();
for (const r of checked) {
  if (r.formType !== "4/A" || !inPeriod(filedDay(r)) || seenAmend.has(r.accessionNo)) continue;
  seenAmend.add(r.accessionNo);
  const s = r.amendment?.status || "none"; amendStatus[s] = (amendStatus[s] || 0) + 1;
}

// ---------- purchase statistics ----------
const rawP = checked.filter((t) => t.code === "P" && inPeriod(filedDay(t)));
const afterAmendP = rawP.filter((t) => !isSuperseded(t));
const econP = economic.filter((e) => e.code === "P" && inPeriod(filedDay(e)) && !isSuperseded(e));

const months = new Map();
const M = (k) => months.get(k) || months.set(k, { month: k, rawPRows: 0, afterAmendmentRows: 0, purchases: 0, insiders: new Set(), companies: new Set(), tickers: new Set(), filings: new Set(), valueUsd: 0, valueScreenedUsd: 0, outliers: 0, values: [], valueAnomalyExcluded: 0, valueMissing: 0, currencyUnverified: 0, currencyUnverifiedValue: 0, confirmedDuplicateGroups: 0, needsReview: 0 }).get(k);
const T = M("TOTAL");
for (const t of rawP) { M(filedDay(t).slice(0, 7)).rawPRows++; T.rawPRows++; }
for (const t of afterAmendP) { M(filedDay(t).slice(0, 7)).afterAmendmentRows++; T.afterAmendmentRows++; }
const quality = { noTicker: 0, noInsiderCik: 0, noTransactionDate: 0, zeroOrMissingPrice: 0, zeroOrMissingShares: 0, priceAnomaly: 0, transactionAfterFiling: 0 };
const insiderOf = (e) => [...new Set([...(e.owners || []).map((o) => o.cik), e.insiderCik].filter(Boolean).map((c) => String(Number(c))))];
const csv = [["filedDay", "acceptedAtET", "accessionNo", "formType", "issuerCik", "ticker", "issuerName", "insiderCik", "insiderName", "role", "transactionDate", "shares", "price", "valueUsd", "ownership", "priceCheck", "currency", "dedupe", "reportedByFilings", "amendment", "filingUrl"].join(",")];
const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
for (const e of econP) {
  const m = M(filedDay(e).slice(0, 7));
  for (const x of [m, T]) {
    x.purchases++;
    for (const c of insiderOf(e)) x.insiders.add(c);
    if (e.issuerCik) x.companies.add(String(Number(e.issuerCik)));
    if (e.ticker) x.tickers.add(e.ticker);
    for (const rb of e.reportedBy || []) x.filings.add(rb.accessionNo);
    if (e.priceCheck?.status === "anomaly") x.valueAnomalyExcluded += e.value || 0;
    else if (e.value == null) x.valueMissing++;
    else { x.valueUsd += e.value; if (e.value > OUTLIER_USD) x.outliers++; else { x.valueScreenedUsd += e.value; x.values.push(e.value); } }
    if (e.currency?.code !== "USD") { x.currencyUnverified++; x.currencyUnverifiedValue += e.value || 0; }
    if (e.dedupe?.status === "confirmed") x.confirmedDuplicateGroups++;
    if (e.dedupe?.status === "needs_review") x.needsReview++;
  }
  if (!e.ticker) quality.noTicker++;
  if (!e.insiderCik) quality.noInsiderCik++;
  if (!e.transactionDate) quality.noTransactionDate++;
  if (!(e.price > 0)) quality.zeroOrMissingPrice++;
  if (!(e.shares > 0)) quality.zeroOrMissingShares++;
  if (e.priceCheck?.status === "anomaly") quality.priceAnomaly++;
  if (e.transactionDate && e.transactionDate > filedDay(e)) quality.transactionAfterFiling++;
  csv.push([filedDay(e), e.acceptedAtET, e.accessionNo, e.formType, e.issuerCik, e.ticker, e.issuerName, e.insiderCik, e.insiderName, e.role, e.transactionDate, e.shares, e.price, e.value, e.ownership, e.priceCheck?.status, e.currency?.code || "unverified", e.dedupe?.status, (e.reportedBy || []).length, e.amendment?.status || "", e.filingUrl].map(q).join(","));
}
const median = (a) => { if (!a.length) return null; const b = [...a].sort((p, q) => p - q), k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };
const finalize = (x) => ({ ...x, values: undefined, medianValueUsd: r2(median(x.values) ?? 0), valueScreenedUsd: r2(x.valueScreenedUsd), insiders: x.insiders.size, companies: x.companies.size, tickers: x.tickers.size, filingsWithP: x.filings.size, filings: undefined, valueUsd: r2(x.valueUsd), valueAnomalyExcluded: r2(x.valueAnomalyExcluded), currencyUnverifiedValue: r2(x.currencyUnverifiedValue) });
const monthRows = [...months.values()].filter((x) => x.month !== "TOTAL").sort((a, b) => a.month.localeCompare(b.month)).map(finalize);
const total = finalize(T);
const outliersExcluded = econP.filter((e) => e.priceCheck?.status !== "anomaly" && e.value > OUTLIER_USD).sort((a, b) => b.value - a.value)
  .map((e) => ({ filedDay: filedDay(e), ticker: e.ticker, issuer: e.issuerName, insider: e.insiderName, shares: e.shares, price: e.price, valueUsd: e.value, accessionNo: e.accessionNo, url: e.filingUrl }));
const top = [...econP].filter((e) => e.priceCheck?.status !== "anomaly" && e.value != null).sort((a, b) => b.value - a.value).slice(0, 15)
  .map((e) => ({ filedDay: filedDay(e), ticker: e.ticker, issuer: e.issuerName, insider: e.insiderName, shares: e.shares, price: e.price, valueUsd: e.value, accessionNo: e.accessionNo, url: e.filingUrl }));

// ---------- coverage + explicit gaps (full shards read for failure detail) ----------
const coverage = monthlyCoverage({ from: FROM, to: TO, store, live: lc ? { coverage: lc.coverage, noIndexDays: lc.noIndexDays } : null, today });
const gaps = { missingDays: [], partialDays: [], unavailableFilings: [] };
for (let d = FROM; d <= TO && d < today; d = addDays(d, 1)) {
  if (!isBusinessDay(d)) continue;
  const rep = store.days.get(d);
  if (!rep) { gaps.missingDays.push(d); continue; }
  if (rep.noIndex) continue;
  const s = readShard(DEFAULT_STORE_DIR, d);
  for (const [acc, f] of Object.entries(s?.failed || {})) gaps.unavailableFilings.push({ day: d, accessionNo: acc, attempts: f.attempts, final: !!(f.permanent || f.exhausted), reason: failureReason(f.error) });
  if (!rep.complete) gaps.partialDays.push({ day: d, listed: rep.listed, parsed: rep.parsed, failed: rep.failed, retryable: rep.retryable });
}

const stats = {
  generatedAt: new Date().toISOString(), period: { from: FROM, to: TO, basis: "SEC filing (acceptance) day" },
  pipeline: "insiderSnapshot.checkRows (price checks + Form 4/A supersession) → transactionGroups.groupTransactions (joint-filing de-dup); code P only; superseded rows excluded",
  input: { transactionRows: transactions.length, duplicateRowIdsDropped: dupRowIds, amendmentFilingsHeld: amendmentFilings.length },
  amendmentsInPeriod: amendStatus,
  purchaseRows: { raw: rawP.length, afterAmendments: afterAmendP.length, economicPurchases: econP.length },
  outlierRule: `single economic purchase > ${OUTLIER_USD.toLocaleString("en-US")} excluded from valueScreenedUsd`,
  total, months: monthRows, quality, topPurchases: top, outliersExcluded, coverage, gaps,
  totalsCrossCheck: computeTotals(econP),
};
fs.writeFileSync(path.join(OUT, "stats.json"), JSON.stringify(stats, null, 1));
fs.writeFileSync(path.join(OUT, "purchases.csv"), csv.join("\n"));

// ---------- console ----------
const fmt = (n) => Math.round(n).toLocaleString("en-US");
console.log(`Period ${FROM}..${TO} (filing day). P rows raw=${rawP.length} afterAmendments=${afterAmendP.length} economic=${econP.length}`);
console.log("month    purch  rawP  insiders compan tickers filings  screened USD   median USD  outl  as-filed USD          anomExcl USD  curUnv dupGrp review");
for (const r of [...monthRows, total]) console.log(`${r.month.padEnd(8)} ${String(r.purchases).padStart(5)} ${String(r.rawPRows).padStart(5)} ${String(r.insiders).padStart(8)} ${String(r.companies).padStart(6)} ${String(r.tickers).padStart(7)} ${String(r.filingsWithP).padStart(7)} ${fmt(r.valueScreenedUsd).padStart(15)} ${fmt(r.medianValueUsd).padStart(11)} ${String(r.outliers).padStart(5)}  ${fmt(r.valueUsd).padEnd(21)} ${fmt(r.valueAnomalyExcluded).padStart(13)} ${String(r.currencyUnverified).padStart(7)} ${String(r.confirmedDuplicateGroups).padStart(6)} ${String(r.needsReview).padStart(6)}`);
console.log("amendments (in-period 4/A filings):", JSON.stringify(amendStatus));
console.log("quality:", JSON.stringify(quality));
console.log(`gaps: missingDays=${gaps.missingDays.length} ${JSON.stringify(gaps.missingDays)} partialDays=${gaps.partialDays.length} failedFilings=${gaps.unavailableFilings.length} (final=${gaps.unavailableFilings.filter((g) => g.final).length})`);
console.log(`wrote ${path.join(OUT, "stats.json")} and purchases.csv`);
