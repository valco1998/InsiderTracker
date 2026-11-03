// Pre-computes Alpaca prices for every historical backtest signal so the Backtesting
// page never waits on the API rate limit (manual CLI; the server never runs it):
//   npm run backtest:alpaca -- --from 2025-11-03 --to 2026-11-03
// For each qualifying signal (same engine, same strategy defaults as the page):
//   • primary + regular-session entry trades (Alpaca SIP trades; cached permanently in
//     .cache/prices/_publication-entries.v1.json — the server picks them up live),
//   • split factors, split-adjusted SIP daily closes for the fixed horizons
//     (.cache/prices/alpaca-daily-split/), latest IEX trade.
// Read-only towards SEC, MongoDB and Firebase. Credentials only from server/.env.
import "dotenv/config";
import { createBacktestService } from "../services/backtest/backtestEngine.js";
import { loadLiveCacheFile } from "../services/backtest/form4History.js";
import { FIXED_HORIZONS, horizonStats } from "../services/backtest/horizonReturns.js";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const from = arg("from"), to = arg("to");
if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to) {
  console.error("usage: --from YYYY-MM-DD --to YYYY-MM-DD"); process.exit(2);
}
const live = loadLiveCacheFile();
const service = createBacktestService({ live: () => live });
const t0 = Date.now();
const cfg = service.normalize({ from, to });
if (cfg.error) { console.error(cfg.error); process.exit(2); }
const result = await service.run(cfg.config);
console.log(`[PRECOMPUTE] signals=${result.signals.length} range=${from}..${to} runMs=${Date.now() - t0}`);
const r = await service.publicationNow({ result, lookupBudget: Infinity });
const rows = Object.values(r.rows);
const count = (f) => rows.filter(f).length;
const statuses = (k) => rows.reduce((m, x) => { const s = x[k]?.status || x.status; m[s] = (m[s] || 0) + 1; return m; }, {});
console.log(`[PRECOMPUTE] primary=${JSON.stringify(statuses("primary"))} regular=${JSON.stringify(statuses("regular"))} latestOk=${count((x) => x.latest?.status === "ok")}`);
for (const n of FIXED_HORIZONS) {
  const s = horizonStats(rows.map((x) => x.primary?.horizons || {}), n);
  console.log(`[PRECOMPUTE] horizon=${n}d n=${s.n} avg=${s.average == null ? "-" : (s.average * 100).toFixed(2) + "%"} median=${s.median == null ? "-" : (s.median * 100).toFixed(2) + "%"} win=${s.winRate == null ? "-" : (s.winRate * 100).toFixed(0) + "%"} immature=${s.immature} noBar=${s.noBar}`);
}
const mem = process.memoryUsage();
console.log(`[PRECOMPUTE_DONE] durationS=${Math.round((Date.now() - t0) / 1000)} alpaca=${JSON.stringify(r.providers?.alpaca || null)} rssMB=${Math.round(mem.rss / 1048576)} heapUsedMB=${Math.round(mem.heapUsed / 1048576)}`);
