// deep3/dataquality/downloadScope.mjs — exact scope of candidate downloads, computed from cached data only.
// NOTHING IS DOWNLOADED. No network. Needs p-filings.json, p-status.json, unpriced.json, store-scan.json.
//   node --max-old-space-size=6144 scripts/research/deep3/dataquality/downloadScope.mjs → download-scope.json
// Holdout-period filings are COUNTED (inventory) so the user can include or exclude them; only pre-event data
// (ADV over the 20 sessions before publication) is used for them. Calibration uses non-holdout cache content only.
import fs from "node:fs";
import path from "node:path";
import { loadBars } from "../../deep2/lib2.mjs";
import { isSession, nextSession, previousSession, entrySessionAfter, sym } from "../../lib.mjs";
import { closeTime } from "../../../../services/backtest/sessionCalendar.js";

const CWD = process.cwd();
const OUT = path.join(CWD, ".cache", "research", "deep3", "dataquality");
const RES = path.join(CWD, ".cache", "research");
const inc = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; return m; };
const cnt = (arr, f) => arr.reduce((m, x) => inc(m, f(x)), {});
const r1 = (x) => Math.round(x * 10) / 10, r0 = Math.round;
const RATE = 150; // requests/minute: createAlpacaClient default perMinute (services/stockData/alpacaClient.js)
const BAR_PAGE = 10_000, TRADE_PAGE = 1_000, QUOTE_PAGE = 10_000;
const BYTES = { bar: 100, trade: 100, quote: 130, slimTrade: 45 }; // uncompressed JSON per record (Alpaca v2 shapes)
const mins = (a, b) => { const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number); return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1)); };
const runtime = (req) => ({ requests: req, minutesAt150: r1(req / RATE), hoursAt150: r1(req / RATE / 60) });

const P = JSON.parse(fs.readFileSync(path.join(OUT, "p-filings.json"), "utf8")).rows;
const S = new Map(JSON.parse(fs.readFileSync(path.join(OUT, "p-status.json"), "utf8")).map((x) => [x.acc, x]));
const U = JSON.parse(fs.readFileSync(path.join(OUT, "unpriced.json"), "utf8")).rows;
const scan = JSON.parse(fs.readFileSync(path.join(OUT, "store-scan.json"), "utf8"));
const rawBars = JSON.parse(fs.readFileSync(path.join(RES, "daily-bars.json"), "utf8"));
const bars = loadBars(), spy = bars.get("SPY");
const C = P.filter((p) => p.inStageC).map((p) => ({ ...p, st: S.get(p.acc) }));
const hasSeries = (p) => p.st?.symbol && bars.get(p.st.symbol)?.arr.length > 0;
// Pre-event liquidity: mean volume and dollar volume over the 20 sessions before the publication date (inclusive of none after).
function adv(p) {
  const s = bars.get(p.st?.symbol); if (!s) return null;
  const day = p.publishedAt.slice(0, 10);
  let lo = 0, hi = s.arr.length - 1, i = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s.arr[m].d < day) { i = m; lo = m + 1; } else hi = m - 1; }
  if (i < 0) return null; const w = s.arr.slice(Math.max(0, i - 19), i + 1);
  return { vol: w.reduce((a, b) => a + b.v, 0) / w.length, dv: w.reduce((a, b) => a + b.v * b.c, 0) / w.length };
}
const tierOf = (dv) => (dv == null ? "unknown" : dv >= 50e6 ? "≥$50M" : dv >= 5e6 ? "$5–50M" : dv >= 1e6 ? "$1–5M" : "<$1M");
for (const p of C) { p.adv = hasSeries(p) ? adv(p) : null; p.tier = tierOf(p.adv?.dv); }
const byPeriod = (xs) => cnt(xs, (x) => x.period);

// =====================================================================================================
// 1. DAILY BARS
// =====================================================================================================
// 1a/1b: unpriced but recoverable by ticker mapping
const rec = U.filter((u) => u.recover === "map_ticker_bars_already_cached" || u.recover === "map_ticker_then_download_daily_bars");
const needDl = rec.filter((u) => u.recover === "map_ticker_then_download_daily_bars");
const dlSyms = [...new Set(needDl.map((u) => u.altTicker).filter(Boolean))];
// earliest date needed for 60-session features: 61 sessions before the earliest trade date among these events (+5 buffer)
const back = (d, n) => { let x = d; for (let k = 0; k < n; k++) x = previousSession(x); return x; };
const earliestTrade = needDl.map((u) => P.find((p) => p.acc === u.acc)?.tradeDate).filter(Boolean).sort()[0] || null;
const start1b = earliestTrade ? back(earliestTrade < "2025-10-01" ? "2025-10-01" : earliestTrade, 66) : null;
const sessionsBetween = (a, b) => { let n = 0; for (let d = a; d <= b; d = nextSession(d)) { if (isSession(d)) n++; if (n > 5000) break; } return n; };
const days1b = start1b ? sessionsBetween(start1b, "2026-11-03") : 0;
const item1b = { symbols: dlSyms.length, symbolList: dlSyms, filingsRecovered: needDl.length, from: start1b, to: "2026-11-03", sessions: days1b, symbolDays: dlSyms.length * days1b,
  ...runtime(Math.max(1, Math.ceil((dlSyms.length * days1b) / BAR_PAGE)) * 2), note: "split + raw adjustment (2 passes); one multi-symbol request per ≤100 symbols per 10,000 bars", bytes: dlSyms.length * days1b * BYTES.bar * 2 };
// 1c: RAW daily bars for every cached symbol with bars → exact split factors (fixes A5 levels, as-traded price, holdings checks)
const withBars = Object.keys(rawBars).filter((k) => k !== "__meta" && Array.isArray(rawBars[k]) && rawBars[k].length);
const barsPerSym = withBars.map((k) => rawBars[k].length);
const chunks = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const req1c = chunks(barsPerSym, 100).reduce((a, ch) => a + Math.max(1, Math.ceil(ch.reduce((x, y) => x + y, 0) / BAR_PAGE)), 0);
const item1c = { symbols: withBars.length, from: "2025-10-01", to: "2026-11-03", symbolDays: barsPerSym.reduce((a, b) => a + b, 0), ...runtime(req1c), bytes: barsPerSym.reduce((a, b) => a + b, 0) * BYTES.bar };
// 1d: history extension so every event has 60 prior sessions (cache starts 2025-10-01)
const truncated = new Map(); let truncEvents = 0; const truncByPeriod = {};
for (const p of C) {
  if (p.st?.status !== "ok") continue; const s = bars.get(p.st.symbol); if (s.arr[0].d !== "2025-10-01") continue; // priced events whose series is truncated by the cache start, not by a listing
  const ent = p.st.entry || entrySessionAfter(p.publishedAt, 60);
  let lo = 0, hi = s.arr.length - 1, i = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s.arr[m].d < ent) { i = m; lo = m + 1; } else hi = m - 1; }
  if (i >= 0 && i < 60) { truncEvents++; inc(truncByPeriod, p.period); truncated.set(p.st.symbol, Math.max(truncated.get(p.st.symbol) || 0, 60 - i)); }
}
const maxDeficit = Math.max(0, ...truncated.values()), extFrom = back("2025-10-01", maxDeficit + 5), extDays = sessionsBetween(extFrom, previousSession("2025-10-01"));
const item1d = { eventsWithFewerThan60PriorSessionsBecauseCacheStarts20251001: truncEvents, byPeriod: truncByPeriod, symbols: truncated.size, maxDeficitSessions: maxDeficit, from: extFrom, to: previousSession("2025-10-01"), sessions: extDays,
  symbolDays: truncated.size * extDays, ...runtime(chunks([...truncated.keys()], 100).reduce((a, ch) => a + Math.max(1, Math.ceil((ch.length * extDays) / BAR_PAGE)), 0) * 2), bytes: truncated.size * extDays * BYTES.bar * 2,
  note: "split + raw passes; extends the cache back (max deficit + 5 sessions) so ret60/dd60/vol60 exist for every priced event" };

// =====================================================================================================
// calibration from the cached after-hours SIP trades (NON-HOLDOUT entries only)
// =====================================================================================================
const ah = JSON.parse(fs.readFileSync(path.join(RES, "deep", "ah-trades-cache.json"), "utf8"));
const byAcc = new Map(C.map((p) => [p.acc, p]));
const calib = {}; // tier → [{ eligible, minutesWithTrades, windowMinutes }]
for (const [acc, v] of Object.entries(ah)) {
  const p = byAcc.get(acc); if (!p || p.period === "holdout" || v.error) continue;
  const win = mins(p.publishedAt.slice(11, 16), "20:00"), m = new Set(v.trades.map((t) => t[0].slice(0, 16))).size;
  (calib[p.tier] || (calib[p.tier] = [])).push({ eligible: v.trades.length, minutesWithTrades: m, windowMinutes: win, truncated: !!v.truncated });
}
const calSummary = Object.fromEntries(Object.entries(calib).map(([t, xs]) => {
  const e = xs.map((x) => x.eligible).sort((a, b) => a - b), occ = xs.map((x) => (x.windowMinutes ? x.minutesWithTrades / x.windowMinutes : 0));
  return [t, { n: xs.length, meanEligible: r1(e.reduce((a, b) => a + b, 0) / e.length), medianEligible: e[e.length >> 1], p90Eligible: e[Math.floor(0.9 * (e.length - 1))], truncated: xs.filter((x) => x.truncated).length,
    meanMinuteOccupancy: Math.round((occ.reduce((a, b) => a + b, 0) / occ.length) * 1000) / 1000 }];
}));
// expected requests for one filing in a tier at multiplier m (all trades ≈ m × eligible), page size `page`
const expPages = (tier, m, page) => { const xs = calib[tier] || calib["<$1M"]; return xs.reduce((a, x) => a + Math.max(1, Math.ceil((x.eligible * m) / page)), 0) / xs.length; };
const expRecords = (tier, m) => { const xs = calib[tier] || calib["<$1M"]; return (xs.reduce((a, x) => a + x.eligible, 0) / xs.length) * m; };

// =====================================================================================================
// 2. ONE-MINUTE BARS (SIP), raw and split
// =====================================================================================================
// Occupancy (share of window minutes that have ≥1 trade, i.e. produce a bar). Extended hours: calibrated from the
// AH cache (eligible trades only → lower bound). Regular session: ASSUMED by liquidity tier (no minute data cached).
const occExt = Object.fromEntries(Object.entries(calSummary).map(([t, s]) => [t, Math.min(1, s.meanMinuteOccupancy * 1.5)]));
const occReg = { "≥$50M": 1, "$5–50M": 0.95, "$1–5M": 0.75, "<$1M": 0.4, unknown: 0.4 };
// Each window carries the REQUEST window it is packed into (common to all symbols that day), so that one
// multi-symbol request serves every event of that day: publication-day regular session 09:30–close; after-close
// 16:00–20:00 (the bars before acceptance are useful context); entry session 04:00–close (premarket + regular).
function minuteWindows(p) {
  const d = p.publishedAt.slice(0, 10);
  if (p.window === "regular_session") return [{ day: d, from: "09:30", to: closeTime(d).slice(0, 5), kind: "reg", req: `09:30-${closeTime(d).slice(0, 5)}` }];
  const ent = p.st?.entry || entrySessionAfter(p.publishedAt, 60), out = [];
  if (p.window === "after_close_to_20") out.push({ day: d, from: closeTime(d).slice(0, 5), to: "20:00", kind: "ext", req: `${closeTime(d).slice(0, 5)}-20:00` });
  const rq = `04:00-${closeTime(ent).slice(0, 5)}`;
  out.push({ day: ent, from: "04:00", to: "09:30", kind: "ext", req: rq }, { day: ent, from: "09:30", to: closeTime(ent).slice(0, 5), kind: "reg", req: rq });
  return out;
}
function minuteScope(events, label, { sessionsAfter = 0 } = {}) {
  const sd = new Map(); // `${day}|${from}|${to}` → Map(symbol → {minutes, expected})
  let upper = 0, expected = 0; const evs = events.filter(hasSeries);
  for (const p of evs) {
    let ws = minuteWindows(p);
    if (sessionsAfter) { let d = p.st.entry || entrySessionAfter(p.publishedAt, 60); for (let k = 0; k < sessionsAfter; k++) { d = nextSession(d); ws.push({ day: d, from: "09:30", to: closeTime(d).slice(0, 5), kind: "reg", req: `09:30-${closeTime(d).slice(0, 5)}` }); } }
    for (const w of ws) {
      const key = `${w.day}|${w.req}`, m = sd.get(key) || sd.set(key, new Map()).get(key);
      const cur = m.get(p.st.symbol) || { wm: 0, e: 0, parts: new Set() };
      const part = `${w.from}-${w.to}`; if (cur.parts.has(part)) continue; // same symbol, same window: fetched once
      const wm = mins(w.from, w.to), e = wm * (w.kind === "reg" ? occReg[p.tier] : occExt[p.tier] ?? 0.05);
      cur.parts.add(part); cur.wm += wm; cur.e += e; m.set(p.st.symbol, cur); upper += wm; expected += e;
    }
  }
  let reqUpper = 0, reqExp = 0, symbolDays = 0;
  for (const m of sd.values()) for (const ch of chunks([...m.values()], 100)) { symbolDays += ch.length; reqUpper += Math.max(1, Math.ceil(ch.reduce((a, x) => a + x.wm, 0) / BAR_PAGE)); reqExp += Math.max(1, Math.ceil(ch.reduce((a, x) => a + x.e, 0) / BAR_PAGE)); }
  return { label, events: evs.length, eventsWithoutBarsExcluded: events.length - evs.length, byPeriod: byPeriod(evs), symbols: new Set(evs.map((p) => p.st.symbol)).size, symbolWindowPairs: symbolDays, dayWindows: sd.size,
    barsUpperBound: upper, barsExpected: r0(expected),
    onePass: { requestsUpper: reqUpper, requestsExpected: reqExp, ...runtime(reqUpper), mbUpper: r1((upper * BYTES.bar) / 1e6) },
    rawAndSplit: { requestsUpper: 2 * reqUpper, ...runtime(2 * reqUpper), mbUpper: r1((2 * upper * BYTES.bar) / 1e6) } };
}
const regEv = C.filter((p) => p.window === "regular_session");
const offEv = C.filter((p) => p.window !== "regular_session");
// sequence signals: within an issuer and publication month, the filing where the k-th DISTINCT person (app identity rule) first appears
const seq = []; { const g = new Map(); for (const p of [...C].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) { const k = `${p.cik}|${p.publishedAt.slice(0, 7)}`; const st = g.get(k) || g.set(k, new Set()).get(k); const who = p.person || p.ownerCik || p.acc; if (!st.has(who)) { st.add(who); if (st.size >= 2) seq.push({ ...p, k: st.size }); } } }
const item2 = {
  regularSession_sessionReaction: minuteScope(regEv, "filings published 09:30–16:00: publication-day regular session"),
  outsideSession_ahPremarketOpen: minuteScope(offEv, "filings published 16:00–09:30 (and non-session days): acceptance→20:00 + next session 04:00–16:00"),
  sequenceSignals_k2_entryDay: minuteScope(seq, "sequence signals (k ≥ 2 distinct buyers in the issuer's publication month): signal day windows"),
  sequenceSignals_k2_10sessions: minuteScope(seq, "sequence signals k ≥ 2: signal-day windows + the next 9 regular sessions (touch timing up to N = 10)", { sessionsAfter: 9 }),
  sequenceSignals_k3_10sessions: minuteScope(seq.filter((x) => x.k >= 3), "sequence signals k ≥ 3: + next 9 regular sessions", { sessionsAfter: 9 }),
  sequenceSignalCounts: { k2plus: seq.length, k3plus: seq.filter((x) => x.k >= 3).length, byPeriod: byPeriod(seq), note: "definition is this agent's proxy; the sequence agent's final rule may differ. Signal-day windows overlap the two items above (same filings)." },
  occupancyAssumptions: { extendedHoursCalibratedFromAhCache: occExt, regularSessionAssumed: occReg },
  note: "Requests are packed: one multi-symbol bars request per (day, window) for ≤100 symbols, 10,000 bars per page. Upper bound = every minute of every window has a bar. Raw-only + daily split factors (item 1c) halves the cost.",
};

// =====================================================================================================
// 3. SIP TRADES in extended hours
// =====================================================================================================
const cached = new Set(Object.keys(ah));
const afterClose = C.filter((p) => p.window === "after_close_to_20" && hasSeries(p));
const afterCloseUncached = afterClose.filter((p) => !cached.has(p.acc));
const overnight = C.filter((p) => ["evening_20_24", "premarket_04_0930", "non_session_day"].includes(p.window) && hasSeries(p));
function tradeScope(events, label, windowMinutesOf, refWindow) {
  const rows = events.map((p) => ({ p, wm: windowMinutesOf(p) }));
  const scale = (x) => Math.max(0.2, Math.min(2.5, x.wm / refWindow));
  const out = { label, filings: rows.length, byPeriod: byPeriod(events), byTier: cnt(events, (p) => p.tier), windowMinutesTotal: rows.reduce((a, x) => a + x.wm, 0) };
  for (const [name, m] of [["low_x1.5", 1.5], ["central_x2", 2], ["high_x3", 3]]) {
    const req = rows.reduce((a, x) => a + expPages(x.p.tier, m * scale(x), TRADE_PAGE), 0), recs = rows.reduce((a, x) => a + expRecords(x.p.tier, m * scale(x)), 0);
    out[name] = { tradesEstimated: r0(recs), ...runtime(r0(req)), mbJson: r1((recs * BYTES.trade) / 1e6), mbSlimCache: r1((recs * BYTES.slimTrade) / 1e6) };
  }
  return out;
}
const refMin = Object.values(calib).flat().reduce((a, x) => a + x.windowMinutes, 0) / Object.values(calib).flat().length;
const item3 = {
  calibration: { source: "deep-1 after-hours cache, non-holdout entries only (eligible trades: no odd lots, no excluded conditions; fetch capped at 3 pages)", referenceWindowMinutes: r1(refMin), byTier: calSummary,
    multiplier: "all SIP trades ≈ m × eligible trades (odd lots and excluded prints are not in the cache): m = 1.5 / 2 / 3", pageSize: TRADE_PAGE },
  afterHours_acceptanceTo2000_notCached: tradeScope(afterCloseUncached, "after-close purchase filings (16:00–20:00, session day) not in the AH cache", (p) => mins(p.publishedAt.slice(11, 16), "20:00"), refMin),
  afterHours_cachedButTruncatedOrCapped: { cachedFilings: afterClose.filter((p) => cached.has(p.acc)).length, truncatedNonHoldout: Object.entries(ah).filter(([a, v]) => byAcc.get(a)?.period !== "holdout" && v.truncated).length, note: "re-fetch without the 3-page cap only if full AH volume is needed" },
  premarket_0400To0930_overnightFilings: tradeScope(overnight, "filings published 20:00–09:30 or on non-session days: 04:00→09:30 of the entry session (from acceptance when later)", (p) => {
    if (p.window === "premarket_04_0930") return mins(p.publishedAt.slice(11, 16) < "04:00" ? "04:00" : p.publishedAt.slice(11, 16), "09:30"); return mins("04:00", "09:30"); }, refMin),
  caveat: "Premarket activity is not calibrated (no premarket trades are cached); the after-hours calibration is scaled by window length. Treat as ±2×.",
};

// =====================================================================================================
// 4. QUOTES (NBBO)
// =====================================================================================================
const quoteScope = (tradeItem, label) => Object.fromEntries([["label", label], ["filings", tradeItem.filings], ...[["quotes_x5_trades", 5], ["quotes_x20_trades", 20]].map(([k, q]) => {
  const recs = tradeItem.central_x2.tradesEstimated * q; const req = Math.max(tradeItem.filings, r0(recs / QUOTE_PAGE) + tradeItem.filings);
  return [k, { quotesEstimated: r0(recs), ...runtime(req), mbJson: r1((recs * BYTES.quote) / 1e6) }]; })]);
const item4 = {
  status: "NOT POSSIBLE with the current code: server/services/stockData/alpacaClient.js exposes tradesPage, barsPage, barsMultiPage, latestTrades — no quotes method.",
  whatWouldBeNeeded: "A new read-only method, e.g. quotesPage(symbol, { start, end, limit = 10000, feed = 'sip', pageToken }) → GET <Alpaca market-data host>/v2/stocks/{symbol}/quotes (historical NBBO; fields t, ax, ap, as, bx, bp, bs, c, z), reusing the client's rate limiter. Preferably as a research-only wrapper in scripts/research/ that imports createAlpacaClient's request pattern — but any change to alpacaClient.js touches a SHARED production file (backtest price service; covered by isolation.test.js) and needs explicit approval, a unit test with a mocked fetch, and an isolation check.",
  windows: "acceptance→20:00 for after-close filings; 04:00→09:30 for overnight filings; optionally 09:30–09:35 around the opening auction",
  afterHours: quoteScope(item3.afterHours_acceptanceTo2000_notCached, "after-close filings (uncached)"),
  premarket: quoteScope(item3.premarket_0400To0930_overnightFilings, "overnight filings"),
  plusCachedAfterHoursSample: { filings: afterClose.filter((p) => cached.has(p.acc)).length, note: "quotes for the 614 already-cached AH filings would add about the same per-filing cost" },
  caveat: "quote counts are a rough multiple of trades (extended-hours small caps: 5–20 quote updates per trade); the scope is dominated by the per-filing minimum request when activity is thin",
};

// =====================================================================================================
// 5. OLDER SEC HISTORY (backfill CLI; read from the code, NOT run)
// =====================================================================================================
const pd = scan.perDay.filter((d) => d.listed > 0).map((d) => ({ ...d, t: Date.parse(d.mtime) })).sort((a, b) => a.t - b.t);
const runs = []; let cur = null;
for (const d of pd) { if (cur && d.t - cur.last < 20 * 60_000) { cur.days.push(d); cur.last = d.t; } else { cur = { days: [d], last: d.t }; runs.push(cur); } }
let fil = 0, ms = 0; for (const r of runs) for (let i = 1; i < r.days.length; i++) { fil += r.days[i].listed - r.days[i].pendingRetry; ms += r.days[i].t - r.days[i - 1].t; }
const perMin = ms ? fil / (ms / 60_000) : null;
const avgListed = scan.coverage.listedTotal / scan.coverage.held, avgBytes = scan.files.bytes / scan.files.shards;
const yearScope = (years) => { const bd = 250 * years, filings = r0(bd * avgListed), req = filings + bd; return { years, businessDays: bd, filingsToDownload: filings, secRequests: req,
  hoursAtObservedRate: perMin ? r1(filings / perMin / 60) : null, hoursAtRps2: r1(req / 2 / 3600), hoursAtRps4: r1(req / 4 / 3600), diskGB: r1((bd * avgBytes) / 1e9),
  expectedPurchaseFilings: r0((bd * scan.totals.filingsWithP) / scan.coverage.held) }; };
const item5 = {
  cli: { command: "npm run backtest:backfill -- --from YYYY-MM-DD --to YYYY-MM-DD [--rps 1-5] [--concurrency 1-4] [--max-filings N]", reportOnly: "npm run backtest:backfill -- --report --from … --to … (reads disk only, no SEC requests)",
    defaults: "rps 2 (clamped 1–5), concurrency 1 (max 4); needs SEC_USER_AGENT in server/.env; SEC fair access ≤ 10 req/s in total and the live server uses up to EDGAR_MAX_RPS (default 5), so rps ≤ 4 while the live server runs",
    mechanics: "walks SEC business days oldest first; per day 1 daily-index request (form.YYYYMMDD.idx) + 1 request per Form 4/4A .txt (all transaction codes: the index cannot be filtered to P/S); a complete shard is skipped, a partial one resumes; 404 index before today = SEC closed (noIndex shard); throttling (429/403) pauses and retries; filings already in the live cache are reused",
    source: "scripts/backfillForm4.mjs + services/backtest/form4Backfill.js (read, not run)" },
  observedThroughput: { runsDetected: runs.length, filingsPerMinute: perMin ? r1(perMin) : null, avgListedPerDay: r0(avgListed), avgShardMB: r1(avgBytes / 1e6), basis: "consecutive shard file mtimes within one run (gaps < 20 min)" },
  currentStore: { held: scan.coverage.held, missingDays: scan.coverage.missingDays, partialDays: scan.coverage.partialDays.map((d) => `${d.day} (${d.pendingRetry} pending: ${Object.keys(d.failReasons).join("/")})`), unparsedFilings: scan.coverage.unparsedTotal,
    lastShardWritten: scan.files.lastShardWritten, progressJsonMtime: scan.files.progressJson?.mtime, liveCacheExtendsTo: scan.live?.indexDays?.at(-1) || null },
  fillGapsFirst: { range: "2025-12-24 → 2025-12-31 (5 business days) + re-run the 14 partial days (31 unparsed filings, HTTP 503/404)", filingsEstimate: r0(5 * avgListed * 0.6) + scan.coverage.unparsedTotal, requests: r0(5 * avgListed * 0.6) + 5 + scan.coverage.unparsedTotal,
    note: "late-December volume is lower than average (×0.6 assumed). Note 2025-12-24 and 2025-12-26 may have no index (federal closure by executive order): the CLI records these as noIndex days automatically." },
  older: [1, 2, 5, 10].map(yearScope),
  stallInteraction: "Observed only: the last shard (2025-12-23.json) and progress.json were both written at 2026-11-04 00:18:31Z, and no 2025-12-24 shard exists, so the run never recorded the 2025-12-24 index (an index failure would have rewritten progress.json with a stop reason). The process either died or is blocked on that request. Do NOT start a second backfill while the first may still be alive: both would write progress.json and the same shards, and SEC requests would add up against the 10 req/s limit. First confirm that no backfill process is running (owner action), then re-run the CLI for 2025-12-24 → 2025-12-31 (resumable; complete shards are skipped). Run older years after that, in yearly chunks.",
  alsoNeeded: "Older events need daily bars for the same years (Alpaca SIP history from 2016 on Basic): ~2,500 symbols × 250 sessions per year ≈ 625k bars ≈ 65–130 requests per year (split + raw), plus delisted-symbol coverage checks (survivorship).",
};

const out = { builtAt: new Date().toISOString(), assumptions: { requestsPerMinute: RATE, barsPerPage: BAR_PAGE, tradesPerPage: TRADE_PAGE, quotesPerPage: QUOTE_PAGE, bytesPerRecord: BYTES, includesHoldoutPeriodFilings: true, completeThrough: "2026-11-03" },
  item1_dailyBars: { a_tickerMappingNoDownload: { filings: rec.length - needDl.length, note: "alternative exchange-listed ticker already in the bar cache (map the CIK's current SEC ticker)" }, b_recoverableUnpricedSymbols: item1b, c_rawDailyForAllCachedSymbols: item1c, d_history60SessionsBeforeCacheStart: item1d,
    newListingRule: { filings: U.filter((u) => u.recover?.startsWith("needs_entry_rule")).length, note: "no data needed: define entry = first session with a bar ≥ acceptance + 60 s" } },
  item2_minuteBars: item2, item3_trades: item3, item4_quotes: item4, item5_olderSecHistory: item5 };
fs.writeFileSync(path.join(OUT, "download-scope.json"), JSON.stringify(out, null, 1));
const brief = (x) => ({ events: x.events, symbolWindowPairs: x.symbolWindowPairs, dayWindows: x.dayWindows, barsUpper: x.barsUpperBound, barsExpected: x.barsExpected, reqRawSplit: x.rawAndSplit.requestsUpper, minutes: x.rawAndSplit.minutesAt150 });
console.log(JSON.stringify({ item1b: { syms: item1b.symbols, filings: item1b.filingsRecovered, req: item1b.requests }, item1c: { syms: item1c.symbols, req: item1c.requests }, item1d: { events: item1d.eventsWithFewerThan60PriorSessionsBecauseCacheStarts20251001, syms: item1d.symbols, req: item1d.requests },
  item2: { reg: brief(item2.regularSession_sessionReaction), off: brief(item2.outsideSession_ahPremarketOpen), seq1: brief(item2.sequenceSignals_k2_entryDay), seq10: brief(item2.sequenceSignals_k2_10sessions) },
  item3: { ah: item3.afterHours_acceptanceTo2000_notCached.central_x2, ahN: item3.afterHours_acceptanceTo2000_notCached.filings, pre: item3.premarket_0400To0930_overnightFilings.central_x2, preN: item3.premarket_0400To0930_overnightFilings.filings },
  item5: { perMin: item5.observedThroughput, older: item5.older } }, null, 1));
