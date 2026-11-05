// deep6/fetchBars.mjs — extended daily bars for deep study 6 (approved by the user 2026-11-05).
//   node scripts/research/deep6/fetchBars.mjs
// Writes ONLY .cache/research/deep6/daily-bars-ext.json (+ fetch-log.json). The original .cache/research/daily-bars.json is never
// written, so deep 2–5 and cluster-bollinger stay reproducible. Never calls lib.loadDailyBars (that rebuilds the shared cache).
// Symbols: every non-empty symbol of the existing cache + the new symbols listed in deep6/coverage.json (priceNeeds.newSymbols).
// Range: 2025-07-28 .. now-16min (Alpaca Basic: no SIP for the last 15 minutes). Alpaca SIP daily bars, adjustment=split.
// Rate: perMinute 100 (the live server shares the Alpaca budget). Resumable: symbols already in the output file are skipped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Alpaca is reached only through the research library (isolation guard: services/backtest/isolation.test.js).
import { fetchDailyBarsRange } from "../lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "..", "..");
const OUT = path.join(SERVER, ".cache", "research", "deep6");
const FILE = path.join(OUT, "daily-bars-ext.json");
const FROM = "2025-07-28";

const old = JSON.parse(fs.readFileSync(path.join(SERVER, ".cache", "research", "daily-bars.json"), "utf8"));
const cov = JSON.parse(fs.readFileSync(path.join(OUT, "coverage.json"), "utf8"));
const valid = (s) => /^[A-Z.]{1,7}$/.test(s);
const wantAll = [...new Set([...Object.keys(old).filter((k) => k !== "__meta" && old[k]?.length), ...cov.priceNeeds.newSymbols, "SPY"])].filter(valid).sort();
const skippedInvalid = [...new Set([...cov.priceNeeds.newSymbols])].filter((s) => !valid(s));

let out = {};
try { out = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { out = {}; }
out.__meta = { from: FROM, source: "Alpaca SIP daily bars, adjustment=split", startedAt: out.__meta?.startedAt || new Date().toISOString() };
const want = wantAll.filter((s) => !(s in out));
const end = new Date(Date.now() - 16 * 60_000).toISOString();
const log = { invalid: skippedInvalid, invalidAtAlpaca: [], chunkErrors: [] };
console.log(`[DEEP6_BARS] symbols=${wantAll.length} toFetch=${want.length} from=${FROM} end=${end}`);
if (want.length) {
  const { errors } = await fetchDailyBarsRange(want, {
    from: FROM, endIso: end, perMinute: 100,
    onChunk: (done, total, partial) => { // checkpoint after every chunk
      for (const [s, bs] of Object.entries(partial)) { if (!(s in out)) { out[s] = bs; if (bs === null) log.invalidAtAlpaca.push(s); } }
      fs.writeFileSync(FILE, JSON.stringify(out));
      console.log(`[DEEP6_BARS] ${done}/${total}`);
    },
  });
  log.chunkErrors.push(...errors);
}
out.__meta.finishedAt = new Date().toISOString(); out.__meta.end = end;
fs.writeFileSync(FILE, JSON.stringify(out));
const syms = Object.keys(out).filter((k) => k !== "__meta");
const withBars = syms.filter((k) => out[k]?.length);
const summary = { symbols: syms.length, withBars: withBars.length, empty: syms.length - withBars.length, firstBar: withBars.map((k) => out[k][0][0]).sort()[0], lastBar: withBars.map((k) => out[k].at(-1)[0]).sort().at(-1), ...log };
fs.writeFileSync(path.join(OUT, "fetch-log.json"), JSON.stringify(summary, null, 1));
console.log("[DEEP6_BARS_DONE]", JSON.stringify(summary));
