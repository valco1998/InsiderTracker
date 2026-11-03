// Historical SEC Form 4 backfill for the backtest (resumable; Ctrl+C stops safely).
//   npm run backtest:backfill -- --from 2024-01-01 --to 2024-12-31 [--rps 4] [--concurrency 2] [--max-filings 500]
//   npm run backtest:backfill -- --report --from 2025-11-03 --to 2026-11-03     (coverage by month; no SEC requests)
// Needs SEC_USER_AGENT in server/.env ("Name contact@example.com").
// SEC fair access allows at most 10 requests/second per user IN TOTAL: the live
// server already uses up to EDGAR_MAX_RPS (default 5), so keep --rps low (default 2).
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEdgarClient } from "../services/edgar/edgarClient.js";
import { createForm4Backfill } from "../services/backtest/form4Backfill.js";
import { DEFAULT_STORE_DIR, loadHistoryStore, monthlyCoverage } from "../services/backtest/form4History.js";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const from = arg("from"), to = arg("to");
const rps = Math.min(Math.max(Number(arg("rps", 2)) || 2, 1), 5);
const maxFilings = arg("max-filings") ? Math.max(1, Number(arg("max-filings"))) : Infinity;
const concurrency = Math.min(Math.max(Number(arg("concurrency", 1)) || 1, 1), 4);
if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to) {
  console.error("usage: --from YYYY-MM-DD --to YYYY-MM-DD [--rps 1-5] [--concurrency 1-4] [--max-filings N] | --report --from … --to …"); process.exit(2);
}

// --report: coverage by month from what is on disk (history shards + live cache). No SEC requests.
if (process.argv.includes("--report")) {
  const { loadLiveCacheFile } = await import("../services/backtest/form4History.js");
  const lc = loadLiveCacheFile();
  const live = lc ? { coverage: lc.coverage || [], noIndexDays: lc.noIndexDays || [] } : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const rows = monthlyCoverage({ from, to, store: loadHistoryStore(DEFAULT_STORE_DIR), live, today });
  console.log("month    days complete partial missing closed   listed   parsed failed notFetched withP  4/A  coverage  failure reasons");
  for (const r of rows) console.log(`${r.month}  ${String(r.businessDays).padStart(4)} ${String(r.complete).padStart(8)} ${String(r.partial).padStart(7)} ${String(r.missing).padStart(7)} ${String(r.closed).padStart(6)} ${String(r.listed).padStart(8)} ${String(r.parsed).padStart(8)} ${String(r.failed).padStart(6)} ${String(r.notFetched).padStart(10)} ${String(r.withPurchases).padStart(5)} ${String(r.amendments).padStart(4)}  ${(r.ratio * 100).toFixed(1).padStart(6)}%  ${JSON.stringify(r.failedReasons)}`);
  process.exit(0);
}

// Read-only reuse of filings the live ingest already downloaded.
const liveCache = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".cache", "insider-filings.json");
const knownRecords = new Map();
try { for (const [acc, rec] of Object.entries(JSON.parse(fs.readFileSync(liveCache, "utf8")).filings || {})) knownRecords.set(acc, rec); } catch { /* no live cache */ }

const client = createEdgarClient({ maxRps: rps });
let aborted = false;
process.on("SIGINT", () => { if (aborted) process.exit(130); aborted = true; console.log("\n[BACKFILL] stopping after the current filing (Ctrl+C again to force)…"); });

console.log(`[BACKFILL] ${from}..${to} rps=${rps} concurrency=${concurrency} maxFilings=${maxFilings} store=${DEFAULT_STORE_DIR} reusable=${knownRecords.size}`);
const t0 = Date.now();
let last = 0;
const result = await createForm4Backfill({ storeDir: DEFAULT_STORE_DIR, client, knownRecords }).run({
  from, to, maxFilings, concurrency, isAborted: () => aborted,
  onProgress: (p) => { if (Date.now() - last > 10_000) { last = Date.now(); console.log(`[BACKFILL_PROGRESS] day=${p.currentDay || "-"} days=${p.daysComplete}/${p.daysTotal} downloaded=${p.downloaded} reused=${p.reused} failed=${p.failed}`); } },
});
const mem = process.memoryUsage();
console.log(`[BACKFILL_MEMORY] rssMB=${Math.round(mem.rss / 1048576)} heapUsedMB=${Math.round(mem.heapUsed / 1048576)}`);
console.log(`[BACKFILL_DONE] state=${result.state} reason=${result.stoppedReason || "-"} days=${result.daysComplete}/${result.daysTotal} downloaded=${result.downloaded} reused=${result.reused} failed=${result.failed} durationS=${Math.round((Date.now() - t0) / 1000)}`);
