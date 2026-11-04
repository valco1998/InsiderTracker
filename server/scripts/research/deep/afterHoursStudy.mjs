// server/scripts/research/deep/afterHoursStudy.mjs — can the post-filing repricing be captured by
// trading in EXTENDED HOURS right after an after-close Form 4 publication?
// Sample: purchase filings published 16:00–19:55 ET on a trading day (after-hours session open),
// stratified: all CEO/CFO personal open-market ≥ $250k, plus fixed-seed random samples of other
// open-market filings and of all other filings. Per event (Alpaca SIP trades, cached):
//   entry   first eligible (non-odd-lot, representative) trade ≥ acceptance + 60 s, before 20:00 ET
//   liquidity  eligible shares / dollars traded from that moment to 20:00 ET
//   exits   next regular open, next close (1 session), 5 and 20 session closes (daily bars)
// Costs: extended-hours spreads are wide — reported at 50 / 100 / 200 bps per side.
//   node scripts/research/deep/afterHoursStudy.mjs
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR, fetchTrades, fetchRawDaily, lastCompleteSession, loadDailyBars, sym, median, mean, r4, clusteredT, pValue, sessionAfter, isSession } from "../lib.mjs";
import { etToUtcIso } from "../../../services/backtest/publicationStart.js";
import { isEligibleTrade, etParts } from "../../../services/backtest/entrySelection.js";

const DIR = path.join(OUT_DIR, "deep");
const CACHE = path.join(DIR, "ah-trades-cache.json");
const C = JSON.parse(fs.readFileSync(path.join(DIR, "stageC.json"), "utf8"));
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const saveCache = () => fs.writeFileSync(CACHE, JSON.stringify(cache));
const t = (e) => e.publishedAt.slice(11);
const pool = C.events.filter((e) => e.priceStatus === "ok" && e.ticker && isSession(e.publishedAt.slice(0, 10)) && t(e) >= "16:00:00" && t(e) < "19:55:00");
let seed = 20261104; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const sample = (arr, n) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
const ceo = pool.filter((e) => (e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5);
const om = sample(pool.filter((e) => e.venue === "open_market" && !ceo.includes(e)), 250);
const other = sample(pool.filter((e) => e.venue !== "open_market"), 250);
const strata = [["CEO/CFO personal open-market ≥ $250k", ceo], ["Other open-market purchases (random 250)", om], ["Venue not open market (random 250)", other]];
console.log(`[AH] pool ${pool.length} after-close filings; sampled ${strata.map(([n, a]) => `${n}: ${a.length}`).join(", ")}`);

let fetched = 0;
for (const [, es] of strata) for (const e of es) {
  if (cache[e.id]) continue;
  const startIso = new Date(Date.parse(etToUtcIso(`${e.publishedAt} ET`)) + 60_000).toISOString();
  const endIso = etToUtcIso(`${e.publishedAt.slice(0, 10)} 20:00:00 ET`);
  try { const r = await fetchTrades(sym(e.ticker), startIso, endIso); cache[e.id] = { startIso, endIso, truncated: r.truncated, trades: r.trades.filter((x) => isEligibleTrade(x)).map((x) => [x.t, x.p, x.s]) }; }
  catch (err) { cache[e.id] = { error: String(err.message).slice(0, 120) }; }
  if (++fetched % 25 === 0) { saveCache(); console.log(`[AH] fetched ${fetched}`); }
}
saveCache();

const bars = await loadDailyBars([...new Set(pool.map((e) => e.ticker)), "SPY"]);
const spy = bars.get("SPY");
// After-hours trades are RAW prices; daily bars are split-adjusted. Put everything on the raw basis
// of the publication day: factor = raw close ÷ split-adjusted close on that day.
const RAW_FILE = path.join(DIR, "ah-raw-daily.json");
let raw;
if (fs.existsSync(RAW_FILE)) raw = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(RAW_FILE, "utf8"))).map(([k, v]) => [k, new Map(v)]));
else { raw = await fetchRawDaily(strata.flatMap(([, es]) => es.map((e) => e.ticker)), "2025-11-15", lastCompleteSession()); fs.writeFileSync(RAW_FILE, JSON.stringify(Object.fromEntries(Object.entries(raw).map(([k, m]) => [k, [...m]])))); }
const rows = [];
for (const [stratum, es] of strata) for (const e of es) {
  const c = cache[e.id]; const b = bars.get(sym(e.ticker));
  if (!c || c.error || !b) { rows.push({ stratum, id: e.id, status: c?.error ? "fetch_error" : "no_data" }); continue; }
  const tr = c.trades;
  const pubDay = e.publishedAt.slice(0, 10), next = e.entryDate;
  const rb = raw[sym(e.ticker)];
  const closePub = rb?.get(pubDay)?.c, nextRaw = rb?.get(next), sPub = spy.get(pubDay), sNext = spy.get(next);
  const factor = closePub && b.get(pubDay)?.c ? closePub / b.get(pubDay).c : null; // split-adjusted → raw (pub-day terms)
  // Next open on the SAME basis as the after-hours trades (split-adjusted × pub-day factor), so a
  // split between the publication day and the next session cannot distort the comparison.
  const nb = b.get(next) && factor ? { o: b.get(next).o * factor } : nextRaw;
  const base = { stratum, id: e.id, ticker: e.ticker, publishedAt: e.publishedAt, insider: e.insider, filingValue: Math.round(e.filingValue), dollarVol20: e.dollarVol20 };
  if (!tr.length) { rows.push({ ...base, status: "no_after_hours_trade" }); continue; }
  const [t0, p0] = tr[0];
  const shares = tr.reduce((a, x) => a + x[2], 0), dollars = tr.reduce((a, x) => a + x[1] * x[2], 0);
  const first15 = tr.filter((x) => Date.parse(x[0]) < Date.parse(t0) + 15 * 60_000);
  const vw15 = first15.reduce((a, x) => a + x[1] * x[2], 0) / first15.reduce((a, x) => a + x[2], 0);
  if (!closePub || !nb || !sPub || !sNext || !factor) { rows.push({ ...base, status: "no_daily_bars" }); continue; }
  const exit = (N) => { const d = N === 0 ? next : sessionAfter(next, N); const x = b.get(d), s = spy.get(d); return x && s ? { stock: x.c * factor, spy: s.c } : null; };
  const spyRef = sPub.c; // SPY's 16:00 close is the reference for an after-close entry
  const r = (px, x, sx) => (px > 0 && x ? x / px - 1 - (sx / spyRef - 1) : null);
  rows.push({
    ...base, status: "ok", splitFactor: r4(factor), ahFirstTime: t0, minutesAfterAcceptance: r4((Date.parse(t0) - Date.parse(etToUtcIso(`${e.publishedAt} ET`))) / 60000),
    ahTrades: tr.length, ahShares: shares, ahDollars: Math.round(dollars), truncated: c.truncated,
    ahVsClose: r4(p0 / closePub - 1), nextOpenVsClose: r4(nb.o / closePub - 1),
    // Captured by the after-hours buyer up to the next open (vs SPY close → open).
    captureToOpen: r4(nb.o / p0 - 1 - (sNext.o / spyRef - 1)), captureToOpenVw15: r4(nb.o / vw15 - 1 - (sNext.o / spyRef - 1)),
    ex1: r4(r(p0, exit(0)?.stock, exit(0)?.spy)), ex5: r4(r(p0, exit(5)?.stock, exit(5)?.spy)), ex20: r4(r(p0, exit(20)?.stock, exit(20)?.spy)),
    openEntry1: e.h?.[1]?.excess ?? null, openEntry5: e.h?.[5]?.excess ?? null, openEntry20: e.h?.[20]?.excess ?? null,
  });
}
const sum = (xs) => { const v = xs.filter((x) => x != null); return { n: v.length, median: r4(median(v)), mean: r4(mean(v)), positive: v.length ? r4(v.filter((x) => x > 0).length / v.length) : null }; };
const result = { generatedAt: new Date().toISOString(), pool: pool.length, strata: {} };
for (const [stratum] of strata) {
  const rs = rows.filter((r) => r.stratum === stratum), ok = rs.filter((r) => r.status === "ok");
  const tt = (k) => { const v = ok.filter((r) => r[k] != null).map((r) => ({ issuer: r.ticker, x: r[k] })); const tv = clusteredT(v, "x"); return { t: r4(tv), p: r4(pValue(tv)) }; };
  result.strata[stratum] = {
    sampled: rs.length, status: rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}),
    minutesToFirstTrade: sum(ok.map((r) => r.minutesAfterAcceptance)), ahDollars: sum(ok.map((r) => r.ahDollars)),
    shareWithAtLeast10kDollars: ok.length ? r4(ok.filter((r) => r.ahDollars >= 1e4).length / ok.length) : null,
    ahFirstVsClose: sum(ok.map((r) => r.ahVsClose)), nextOpenVsClose: sum(ok.map((r) => r.nextOpenVsClose)),
    captureToOpen: { ...sum(ok.map((r) => r.captureToOpen)), ...tt("captureToOpen") }, captureToOpenVw15: sum(ok.map((r) => r.captureToOpenVw15)),
    ahEntry: { d1: { ...sum(ok.map((r) => r.ex1)), ...tt("ex1") }, d5: { ...sum(ok.map((r) => r.ex5)), ...tt("ex5") }, d20: { ...sum(ok.map((r) => r.ex20)), ...tt("ex20") } },
    openEntrySameEvents: { d1: sum(ok.map((r) => r.openEntry1)), d5: sum(ok.map((r) => r.openEntry5)), d20: sum(ok.map((r) => r.openEntry20)) },
    liquidOnly: (() => { const l = ok.filter((r) => r.ahDollars >= 2.5e4); return { n: l.length, captureToOpen: sum(l.map((r) => r.captureToOpen)), d1: sum(l.map((r) => r.ex1)), d5: sum(l.map((r) => r.ex5)) }; })(),
    // Same split dates as the main study — the gap observation came from the full dataset, so this
    // checks that the after-hours capture is not confined to one period.
    bySplit: Object.fromEntries([["train", (r) => r.publishedAt < "2026-06-15"], ["validation", (r) => r.publishedAt >= "2026-06-15" && r.publishedAt < "2026-09-01"], ["test", (r) => r.publishedAt >= "2026-09-01"]]
      .map(([k, f]) => { const s = ok.filter(f); return [k, { n: s.length, captureToOpen: sum(s.map((r) => r.captureToOpen)), d1: sum(s.map((r) => r.ex1)) }]; })),
    // Round-trip cost scenarios (per side): net = gross − 2 × cost (approximation).
    netOfCosts: Object.fromEntries([10, 25, 50, 100].map((bps) => [`${bps}bps`, { captureToOpenMedian: r4(median(ok.map((r) => r.captureToOpen).filter((v) => v != null)) - 2 * bps / 1e4), captureToOpenMean: r4(mean(ok.map((r) => r.captureToOpen).filter((v) => v != null)) - 2 * bps / 1e4), d1Median: r4(median(ok.map((r) => r.ex1).filter((v) => v != null)) - 2 * bps / 1e4), d1Mean: r4(mean(ok.map((r) => r.ex1).filter((v) => v != null)) - 2 * bps / 1e4) }])),
  };
}
result.costNote = "Gross of costs. Extended-hours spreads for small caps are often 0.5–2%: subtract 2× the per-side cost for a round trip.";
fs.writeFileSync(path.join(DIR, "afterHours.json"), JSON.stringify({ result, rows }, null, 1));
const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
for (const [k, s] of Object.entries(result.strata)) {
  console.log(`\n${k}: sampled ${s.sampled} ${JSON.stringify(s.status)}`);
  console.log(`  first eligible AH trade: median ${s.minutesToFirstTrade.median} min after acceptance; AH dollar volume median $${s.ahDollars.median} (≥$10k in ${pct(s.shareWithAtLeast10kDollars)})`);
  console.log(`  AH first trade vs 16:00 close ${pct(s.ahFirstVsClose.median)} · next open vs close ${pct(s.nextOpenVsClose.median)}`);
  console.log(`  CAPTURE AH entry → next open (vs SPY): median ${pct(s.captureToOpen.median)} mean ${pct(s.captureToOpen.mean)} positive ${pct(s.captureToOpen.positive)} t=${s.captureToOpen.t} (n ${s.captureToOpen.n}) · VWAP15 entry median ${pct(s.captureToOpenVw15.median)}`);
  console.log(`  AH entry vs SPY: 1d ${pct(s.ahEntry.d1.median)}/${pct(s.ahEntry.d1.mean)} t=${s.ahEntry.d1.t} · 5d ${pct(s.ahEntry.d5.median)}/${pct(s.ahEntry.d5.mean)} · 20d ${pct(s.ahEntry.d20.median)}/${pct(s.ahEntry.d20.mean)} (n ${s.ahEntry.d20.n})`);
  console.log(`  OPEN entry, same events:  1d ${pct(s.openEntrySameEvents.d1.median)}/${pct(s.openEntrySameEvents.d1.mean)} · 5d ${pct(s.openEntrySameEvents.d5.median)}/${pct(s.openEntrySameEvents.d5.mean)} · 20d ${pct(s.openEntrySameEvents.d20.median)}/${pct(s.openEntrySameEvents.d20.mean)}`);
  console.log(`  liquid AH (≥$25k traded): n ${s.liquidOnly.n} capture→open median ${pct(s.liquidOnly.captureToOpen.median)} · 1d ${pct(s.liquidOnly.d1.median)} · 5d ${pct(s.liquidOnly.d5.median)}`);
}
