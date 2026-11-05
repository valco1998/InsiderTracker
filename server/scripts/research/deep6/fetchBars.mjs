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
import { alpacaCredentials, createAlpacaClient } from "../../../services/stockData/alpacaClient.js";
import "../lib.mjs"; // loads server/.env (Alpaca credentials) the same way every research script does
import { etParts } from "../../../services/backtest/entrySelection.js";

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
const creds = alpacaCredentials();
if (!creds) { console.error("[DEEP6_BARS] Alpaca credentials missing"); process.exit(2); }
const client = createAlpacaClient({ ...creds, perMinute: 100 });
const end = new Date(Date.now() - 16 * 60_000).toISOString();
const log = { invalid: skippedInvalid, invalidAtAlpaca: [], chunkErrors: [] };
console.log(`[DEEP6_BARS] symbols=${wantAll.length} toFetch=${want.length} from=${FROM} end=${end}`);
for (let i = 0; i < want.length; i += 100) {
  let chunk = want.slice(i, i + 100);
  for (let attempt = 0; attempt < 15 && chunk.length; attempt++) {
    try {
      const got = Object.fromEntries(chunk.map((s) => [s, []]));
      let token = null;
      do {
        const r = await client.barsMultiPage(chunk, { start: `${FROM}T00:00:00Z`, end, timeframe: "1Day", adjustment: "split", pageToken: token });
        for (const [s, bs] of Object.entries(r.bars || {})) for (const b of bs) got[s]?.push([etParts(b.t).date, b.o, b.h, b.l, b.c, b.v]);
        token = r.next;
      } while (token);
      Object.assign(out, got);
      break;
    } catch (err) {
      const m = /invalid symbol:\s*([A-Za-z0-9.\-/]+)/i.exec(String(err?.message || ""));
      if (!m) { log.chunkErrors.push({ at: i, error: String(err.message).slice(0, 160) }); console.warn(`[DEEP6_BARS] chunk failed: ${String(err.message).slice(0, 120)}`); break; }
      const bad = m[1].toUpperCase(); out[bad] = null; log.invalidAtAlpaca.push(bad); chunk = chunk.filter((s) => s !== bad);
    }
  }
  fs.writeFileSync(FILE, JSON.stringify(out)); // checkpoint after every chunk
  console.log(`[DEEP6_BARS] ${Math.min(i + 100, want.length)}/${want.length}`);
}
out.__meta.finishedAt = new Date().toISOString(); out.__meta.end = end;
fs.writeFileSync(FILE, JSON.stringify(out));
const syms = Object.keys(out).filter((k) => k !== "__meta");
const withBars = syms.filter((k) => out[k]?.length);
const summary = { symbols: syms.length, withBars: withBars.length, empty: syms.length - withBars.length, firstBar: withBars.map((k) => out[k][0][0]).sort()[0], lastBar: withBars.map((k) => out[k].at(-1)[0]).sort().at(-1), ...log };
fs.writeFileSync(path.join(OUT, "fetch-log.json"), JSON.stringify(summary, null, 1));
console.log("[DEEP6_BARS_DONE]", JSON.stringify(summary));
