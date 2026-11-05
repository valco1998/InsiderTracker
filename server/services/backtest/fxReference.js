// server/services/backtest/fxReference.js
//
// Documented foreign-exchange reference rates for the monthly per-buyer study — used ONLY
// to convert a purchase whose Form 4 price is stated in a foreign currency into U.S.
// dollars before the threshold check (user decision 2026-11-05).
//
// Source: European Central Bank euro foreign exchange reference rates, served by the
// public Frankfurter API (https://api.frankfurter.app/{date}?from=XXX&to=USD). The ECB
// publishes one rate per TARGET business day (~16:00 CET); for a weekend/holiday trade date
// the API returns the latest earlier business day — the rate date actually used is stored
// with every conversion. Rates are cached on disk forever (a published reference rate for a
// past date does not change). A failed lookup is a status ("fx_unavailable"), never a guess.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FX_SOURCE = "ECB euro foreign exchange reference rate via api.frankfurter.app";
const DEFAULT_CACHE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "fx", "ecb-usd.v1.json");
const CODE_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createFxReferenceService({
  fetchJson = async (url) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "InsiderTracker-backtest/1.0" }, signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  },
  cacheFile = DEFAULT_CACHE,
  log = console,
} = {}) {
  let cache = null;
  const load = () => { if (!cache) { try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { cache = {}; } } return cache; };
  const save = () => {
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify(cache)); fs.renameSync(`${cacheFile}.tmp`, cacheFile); }
    catch (err) { log.warn(`[FX_CACHE] write failed: ${String(err?.message || err).slice(0, 120)}`); }
  };

  // needs: [{ code, date }] → Map("CODE|date" → { rate (USD per 1 unit), rateDate, source } | null)
  async function getRates(needs = []) {
    const c = load();
    const out = new Map();
    let changed = false;
    for (const { code, date } of needs) {
      const k = `${code}|${date}`;
      if (!CODE_RE.test(code || "") || !DATE_RE.test(date || "")) { out.set(k, null); continue; }
      if (c[k]) { out.set(k, c[k]); continue; }
      try {
        const j = await fetchJson(`https://api.frankfurter.app/${date}?from=${code}&to=USD`);
        const rate = Number(j?.rates?.USD);
        if (!(rate > 0) || !DATE_RE.test(j?.date || "")) throw new Error("no USD rate in response");
        c[k] = { rate, rateDate: j.date, source: FX_SOURCE };
        changed = true;
        out.set(k, c[k]);
        log.log?.(`[FX_RATE] code=${code} date=${date} rateDate=${j.date} usdPerUnit=${rate}`);
      } catch (err) {
        log.warn(`[FX_RATE_FAILED] code=${code} date=${date} error=${String(err?.message || err).slice(0, 120)}`);
        out.set(k, null);
      }
    }
    if (changed) save();
    return out;
  }

  // Synchronous lookup function for monthlyStudy.detectMonthlySignals.
  const lookupFrom = (table) => (code, date) => table.get(`${code}|${date}`) || null;
  return { getRates, lookupFrom };
}
