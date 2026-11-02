// Historical SEC Form 4 backfill for the backtest (resumable; Ctrl+C stops safely).
//   npm run backtest:backfill -- --from 2024-01-01 --to 2024-12-31 [--rps 2] [--max-filings 500]
// Needs SEC_USER_AGENT in server/.env ("Name contact@example.com").
// SEC fair access allows at most 10 requests/second per user IN TOTAL: the live
// server already uses up to EDGAR_MAX_RPS (default 5), so keep --rps low (default 2).
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEdgarClient } from "../services/edgar/edgarClient.js";
import { createForm4Backfill } from "../services/backtest/form4Backfill.js";
import { DEFAULT_STORE_DIR } from "../services/backtest/form4History.js";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const from = arg("from"), to = arg("to");
const rps = Math.min(Math.max(Number(arg("rps", 2)) || 2, 1), 5);
const maxFilings = arg("max-filings") ? Math.max(1, Number(arg("max-filings"))) : Infinity;
if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to) {
  console.error("usage: --from YYYY-MM-DD --to YYYY-MM-DD [--rps 1-5] [--max-filings N]"); process.exit(2);
}

// Read-only reuse of filings the live ingest already downloaded.
const liveCache = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".cache", "insider-filings.json");
const knownRecords = new Map();
try { for (const [acc, rec] of Object.entries(JSON.parse(fs.readFileSync(liveCache, "utf8")).filings || {})) knownRecords.set(acc, rec); } catch { /* no live cache */ }

const client = createEdgarClient({ maxRps: rps });
let aborted = false;
process.on("SIGINT", () => { if (aborted) process.exit(130); aborted = true; console.log("\n[BACKFILL] stopping after the current filing (Ctrl+C again to force)…"); });

console.log(`[BACKFILL] ${from}..${to} rps=${rps} maxFilings=${maxFilings} store=${DEFAULT_STORE_DIR} reusable=${knownRecords.size}`);
const t0 = Date.now();
let last = 0;
const result = await createForm4Backfill({ storeDir: DEFAULT_STORE_DIR, client, knownRecords }).run({
  from, to, maxFilings, isAborted: () => aborted,
  onProgress: (p) => { if (Date.now() - last > 10_000) { last = Date.now(); console.log(`[BACKFILL_PROGRESS] day=${p.currentDay || "-"} days=${p.daysComplete}/${p.daysTotal} downloaded=${p.downloaded} reused=${p.reused} failed=${p.failed}`); } },
});
console.log(`[BACKFILL_DONE] state=${result.state} reason=${result.stoppedReason || "-"} days=${result.daysComplete}/${result.daysTotal} downloaded=${result.downloaded} reused=${result.reused} failed=${result.failed} durationS=${Math.round((Date.now() - t0) / 1000)}`);
