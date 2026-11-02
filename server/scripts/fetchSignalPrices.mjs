// Targeted historical daily prices for the Backtesting page and the purchase
// tracking timelines: ONLY the tickers that have signals, from shortly before
// each company's first qualifying purchase through today, plus the benchmark.
//   npm run backtest:prices -- [--from 2025-01-01] [--to 2026-11-02] [--per-hour 45] [--dry-run] [--allow-name-mismatch]
// Source: Tiingo end-of-day API (documented endpoints). Needs TIINGO_API_KEY in
// server/.env (server-side only; never sent to the browser). Tiingo Starter is
// "Internal Use Only — your own personal use"; keep STOCK_DATA_LICENSE=internal
// (default) unless your Tiingo licence permits public display.
// Quotas (defaults keep a margin under the Starter plan): TIINGO_REQUESTS_PER_HOUR (45),
// TIINGO_REQUESTS_PER_DAY (950), TIINGO_SYMBOLS_PER_MONTH (450).
// Output: STOCK_DATA_DIR (default server/.cache/prices) in the CSV provider format.
import "dotenv/config";
import path from "node:path";
import { createBacktestService, normalizeRunConfig } from "../services/backtest/backtestEngine.js";
import { loadLiveCacheFile } from "../services/backtest/form4History.js";
import { planPriceRequests, runPriceFetch } from "../services/backtest/priceFetch.js";
import { createTiingoClient, STARTER_LIMITS } from "../services/stockData/tiingoClient.js";
import { DEFAULT_PRICE_DIR, priceLicence } from "../services/stockData/stockDataProvider.js";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes(`--${name}`);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const dir = process.env.STOCK_DATA_DIR || DEFAULT_PRICE_DIR;
const benchmark = (process.env.STOCK_DATA_BENCHMARK || "SPY").toUpperCase();

// 1. Real signals from the stored SEC data (no prices needed for this step).
const live = loadLiveCacheFile();
const service = createBacktestService({ live: () => live, getProvider: () => ({ available: false, name: null, reason: "planning" }) });
// Default: every stored signal (the run range is limited to 15 years).
const fifteenYearsAgo = `${Number(today.slice(0, 4)) - 15}${today.slice(4)}`;
const cfg = normalizeRunConfig({ from: arg("from", fifteenYearsAgo), to: arg("to", today) });
if (cfg.error) { console.error(cfg.error); process.exit(2); }
const run = await service.run(cfg.config);

const plan = planPriceRequests(run.signals, { today, benchmarkSymbol: benchmark });
console.log(`[PRICE_FETCH] signals=${run.signals.length} tickers=${plan.requests.length - (plan.requests.length ? 1 : 0)} +benchmark=${benchmark} skipped=${plan.skipped.length} dir=${dir}`);
for (const r of plan.requests) console.log(`  ${r.benchmark ? "[benchmark] " : ""}${r.symbol.padEnd(8)} ${r.from} .. ${r.to}${r.issuers[0] ? `  ${r.issuers[0].name || ""}` : ""}`);
for (const s of plan.skipped) console.log(`  skipped: ${s.symbol || s.issuerName || s.issuerCik} (${s.reason})`);
if (flag("dry-run")) { console.log("[PRICE_FETCH] dry run — nothing downloaded."); process.exit(0); }

// 2. Download (rate-limited) into the CSV folder.
const token = (process.env.TIINGO_API_KEY || "").trim();
if (!token) {
  console.error("[PRICE_FETCH] TIINGO_API_KEY is not set in server/.env — create a Tiingo account (free Starter plan = internal use only) and add the key. Nothing downloaded.");
  process.exit(3);
}
let aborted = false;
process.on("SIGINT", () => { if (aborted) process.exit(130); aborted = true; console.log("\n[PRICE_FETCH] stopping after the current symbol…"); });
const perHour = Math.max(1, Math.min(Number(arg("per-hour", process.env.TIINGO_REQUESTS_PER_HOUR || 45)) || 45, 10000));
const limits = {
  requestsPerDay: Math.max(2, Number(process.env.TIINGO_REQUESTS_PER_DAY) || STARTER_LIMITS.requestsPerDay - 50),
  symbolsPerMonth: Math.max(1, Number(process.env.TIINGO_SYMBOLS_PER_MONTH) || STARTER_LIMITS.symbolsPerMonth - 50),
};
const client = createTiingoClient({ token, perHour });
const manifest = await runPriceFetch({
  plan, client, dir, allowNameMismatch: flag("allow-name-mismatch"), isAborted: () => aborted, limits,
  licence: priceLicence() === "public" ? "Tiingo — licensed for public display (per STOCK_DATA_LICENSE)" : "Tiingo Starter — personal/internal use only",
});
const by = {};
for (const r of manifest.results) by[r.status] = (by[r.status] || 0) + 1;
console.log(`[PRICE_FETCH_DONE] ${JSON.stringify(by)} requests=${client.stats().requests} stopped=${manifest.stoppedReason || "-"} monthSymbols=${manifest.usage.uniqueSymbolsThisMonth}/${limits.symbolsPerMonth} todayRequests=${manifest.usage.requestsToday}/${limits.requestsPerDay} manifest=${path.join(dir, "_fetch-manifest.json")}`);
console.log("Next: set STOCK_DATA_PROVIDER=csv in server/.env (STOCK_DATA_DIR defaults to server/.cache/prices) and restart the server.");
