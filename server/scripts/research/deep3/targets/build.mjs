// deep3/targets/build.mjs — event-level outcome table + matched controls (NO statistics, no tests; data only).
//   node scripts/research/deep3/targets/build.mjs
// Events: every priced stage-C purchase filing in discovery and confirmation (lib2.loadEvents hides the holdout).
// Entry: stage-C official open of the first session >= acceptance + 60 s (verified against the bar open).
// Outputs (in .cache/research/deep3/targets/): events.json (full rows), events-outcomes.csv, controls-primary.json,
// build-summary.json (counts, stage-C reproduction check, thresholds, balance), thresholds.json.
import fs from "node:fs";
import path from "node:path";
import {
  loadBars, loadEvents, loadSecRows, periodOf, DEEP2, DISCOVER_END, HOLDOUT_START, STORE_START, sym, tierOf, calendar, featuresAt, pathAt, outcomesOf,
  purchaseBlocks, buildPool, MATCH_FEATURES, GAP_FEATURE, robustScales, indexPool, prepareVectors, nearest, pubBucket, periodEnd, dnum, addDays,
  TARGETS, HORIZONS, STOPS, TP_N, writeOut, toCsv, mean, sd, smd, quant, r4, checkpoint, OUT,
} from "./common.mjs";
import { chartFlags } from "./defs.mjs";

const t0 = Date.now();
const log = (...a) => console.log(`[TARGETS_BUILD ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const bars = loadBars(); const cal = calendar(bars);
const E = loadEvents(); // priced, holdout hidden
const fc = JSON.parse(fs.readFileSync(path.join(DEEP2, "behavior", "filing-class.json"), "utf8"));
const efArr = JSON.parse(fs.readFileSync(path.join(DEEP2, "behavior", "event-features.json"), "utf8"));
const EF = new Map(efArr.map((x) => [x.acc, x]));
const sec = await loadSecRows();
log(`events ${E.length}, filing classes ${Object.keys(fc).length}, behaviour features ${efArr.length}, sec rows ${sec.rows.length}`);

// ---------------- SEC purchase filings per issuer (accepted before the holdout) ----------------
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ownerNames = (insider) => String(insider || "").split(/\s*;\s*/).filter(Boolean);
const byAcc = new Map();
for (const r of sec.rows) {
  if (r.code !== "P" || !(String(r.acceptedAt || "") < HOLDOUT_START)) continue;
  let f = byAcc.get(r.acc);
  if (!f) {
    f = { acc: r.acc, cik: r.cik, acceptedAt: r.acceptedAt, form: r.form, insiderCik: String(r.insiderCik || "").replace(/^0+/, ""), names: ownerNames(r.insider).map(norm), value: 0, tradeDate: r.tradeDate, cls: fc[r.acc]?.cls || "unknown" };
    f.keys = new Set([...(f.insiderCik ? [`c:${f.insiderCik}`] : []), ...f.names.filter(Boolean).map((n) => `n:${n}`)]);
    byAcc.set(r.acc, f);
  }
  if (r.priceCheck !== "anomaly" && r.value > 0) f.value += r.value;
  if (r.tradeDate > f.tradeDate) f.tradeDate = r.tradeDate;
}
const filingsByCik = new Map();
for (const f of byAcc.values()) (filingsByCik.get(f.cik) || filingsByCik.set(f.cik, []).get(f.cik)).push(f);
for (const xs of filingsByCik.values()) xs.sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt));
const samePerson = (a, b) => { for (const k of a.keys) if (b.keys.has(k)) return true; return false; };
function countPersons(fs_) {
  const parent = new Map(); const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const roots = [];
  for (const f of fs_) { const ks = [...f.keys]; if (!ks.length) { roots.push(`acc:${f.acc}`); parent.set(`acc:${f.acc}`, `acc:${f.acc}`); continue; } for (const k of ks) if (!parent.has(k)) parent.set(k, k); for (let i = 1; i < ks.length; i++) { const a = find(ks[0]), b = find(ks[i]); if (a !== b) parent.set(a, b); } roots.push(ks[0]); }
  return new Set(roots.map(find)).size;
}
const minusDays = (T, n) => `${addDays(T.slice(0, 10), -n)}${T.slice(10)}`;

// ---------------- event rows: chart features, insider features, outcomes ----------------
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
const rows = [];
const stageCcheck = { compared: 0, mismatches: 0, examples: [] };
const evByCik = new Map();
for (const e of E) {
  const per = periodOf(e); if (per === "holdout") { skip("holdout"); continue; }
  const s = sym(e.ticker), ser = bars.get(s); if (!ser) { skip("no_series"); continue; }
  const k = ser.idx.get(e.entryDate); if (k == null || k < 1) { skip("no_entry_bar_index"); continue; }
  if (Math.abs(ser.arr[k].o - e.entryPrice) > 1e-9 * Math.max(1, e.entryPrice)) { skip("entry_price_mismatch"); continue; }
  const f = featuresAt(ser, k - 1, cal); if (!f) { skip("short_history"); continue; }
  const p = pathAt(ser, k, cal, { perEnd: periodEnd(per) }); if (!p) { skip("no_path"); continue; }
  const o = outcomesOf(p, e.costBpsPerSide);
  // one-session-delay entry (robustness): open of the next calendar session
  const d1 = cal.days[p.j + 1]; const k1 = d1 ? ser.idx.get(d1) : null;
  const pD = k1 != null ? pathAt(ser, k1, cal, { perEnd: periodEnd(per) }) : null;
  const oD = pD ? outcomesOf(pD, e.costBpsPerSide) : null;
  // stage-C reproduction (data check only)
  for (const N of [1, 2, 3, 5, 10]) {
    const h = e.h?.[N]; if (!h || h.status !== "ok" || o[`x${N}`] == null) continue;
    stageCcheck.compared++;
    if (Math.abs(r4(o[`x${N}`]) - h.excessNet) > 0.00011) { stageCcheck.mismatches++; if (stageCcheck.examples.length < 10) stageCcheck.examples.push({ id: e.id, N, mine: r4(o[`x${N}`]), stageC: h.excessNet, exitDate: h.exitDate, myExit: p.d[N] }); }
  }
  const jd = cal.idx.get(ser.arr[k - 1].d), S = cal.spy.arr;
  const gapX = (ser.arr[k].o / ser.arr[k - 1].c - 1) - (S[p.j].o / S[jd].c - 1);
  const row = {
    id: e.id, acc: e.accessionNo, issuer: e.issuerCik, ticker: e.ticker, s, publishedAt: e.publishedAt, tradeDate: e.tradeDate, entryDate: e.entryDate, per, m: e.entryDate.slice(0, 7),
    k, j: p.j, tier: tierOf(f.dv20), cost: e.costBpsPerSide, cls: fc[e.accessionNo]?.cls || "unknown", venueStated: e.venue, role: e.role,
    isCeo: !!e.isCeo, isCfo: !!e.isCfo, isOfficer: !!e.isOfficer, isDirectorOnly: !!e.isDirectorOnly, isTenPct: !!e.isTenPct, ownership: e.ownership, is10b5_1: !!e.is10b5_1,
    filingValue: e.filingValue, insider: e.insider, issuerName: e.issuerName, pubB: pubBucket(e.publishedAt), entryPrice: e.entryPrice, gapX, gap: ser.arr[k].o / ser.arr[k - 1].c - 1,
    ...f, o, oD,
  };
  rows.push(row);
  (evByCik.get(row.issuer) || evByCik.set(row.issuer, []).get(row.issuer)).push(row);
}
log(`event rows ${rows.length}; skipped ${JSON.stringify(skipped)}; stage-C check ${stageCcheck.compared} compared, ${stageCcheck.mismatches} mismatches`);
for (const xs of evByCik.values()) xs.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));

// issuer-history outcomes for every event (10-session window, NO period cut: used only as a feature of LATER events
// whose entry is after the earlier event's 10-session exit date)
const histPath = new Map();
for (const r of rows) {
  const ser = bars.get(r.s); const p = pathAt(ser, r.k, cal, { maxN: 10 });
  if (!p || p.last < 10) { histPath.set(r.id, null); continue; }
  let hit = 0; for (let t = 0; t <= 10; t++) if (p.h[t] != null && p.h[t] >= 1.1) { hit = 1; break; }
  histPath.set(r.id, { exit10: p.d[10], hit10: hit, x10: p.c[10] != null ? p.c[10] - p.spy[10] : null });
}

for (const r of rows) {
  const T = r.publishedAt;
  const fsI = filingsByCik.get(r.issuer) || [];
  const me = byAcc.get(r.acc) || { acc: r.acc, keys: new Set([`n:${norm(r.insider)}`]), cls: r.cls, value: r.filingValue, form: "4" };
  // clusters: distinct people with OPEN-MARKET purchase filings accepted in (T - n days, T], incl. this filing
  const win = (n) => fsI.filter((f) => f.cls === "om" && f.acceptedAt <= T && f.acceptedAt > minusDays(T, n) && f.acc !== r.acc);
  r.clu7 = countPersons([me, ...win(7)]);
  r.clu14 = countPersons([me, ...win(14)]);
  // same person's earlier open-market filings (original Form 4 only; amendments re-report the same trades)
  const mine = fsI.filter((f) => f.acc !== r.acc && f.form === "4" && f.cls === "om" && f.acceptedAt <= T && samePerson(me, f));
  r.rep30 = mine.filter((f) => f.acceptedAt > minusDays(T, 30)).length;
  const prev = mine.filter((f) => f.acceptedAt > minusDays(T, 90) && f.value > 0).at(-1);
  r.prevOwnValue = prev ? prev.value : null; r.ratioPrev = prev && r.filingValue > 0 ? r.filingValue / prev.value : null;
  // gap since the last insider purchase filing (any class) before the current episode (filings within 3 days = one episode)
  const lastAny = fsI.filter((f) => f.acc !== r.acc && f.acceptedAt < minusDays(T, 3)).at(-1);
  r.gapDays = lastAny ? dnum(T) - dnum(lastAny.acceptedAt) : null;
  r.observedDays = dnum(T) - dnum(STORE_START);
  r.gapLeftCensored = r.gapDays == null;
  // issuer history: earlier priced purchase events whose 10-session window closed before this entry
  const hist = (evByCik.get(r.issuer) || []).filter((x) => x.publishedAt < T && x.acc !== r.acc).map((x) => histPath.get(x.id)).filter((h) => h && h.exit10 < r.entryDate);
  r.histN = hist.length; r.histHit = hist.filter((h) => h.hit10).length; r.histMeanX10 = hist.length ? mean(hist.map((h) => h.x10).filter((v) => v != null)) : null;
  // behaviour-agent features (point in time; deep2/behavior/features.mjs)
  const b = EF.get(r.acc) || {};
  r.convValid = !!b.convValid; r.posIncrease = b.posIncrease ?? null; r.firstPosition = b.firstPosition === true; r.valueVsOwnMedian = b.valueVsOwnMedian ?? null; r.ownPriorFilings = b.ownPriorFilings ?? 0;
  r.salesCovered = b.salesCovered === true; r.othersSold90 = b.othersSold90 ?? null; r.othersSoldAny90 = b.othersSoldAny90 ?? null; r.selfSold90 = b.selfSold90 === true; r.selfSoldAny90 = b.selfSoldAny90 === true;
}
log("insider features done");

// ---------------- control pool and matching ----------------
const blocks = await purchaseBlocks(cal);
const pool = buildPool(bars, cal, blocks.blocked);
const nSyms = pool.syms.length;
const tightQ20 = quant(pool.rows.filter((x) => x.per === "discover").map((x) => x.tight), 0.2);
const TH = { tightQ20, note: "20th percentile of `tight` (range20 / (vol60*sqrt20)) over DISCOVERY control-pool rows; feature distribution only" };
writeOut("thresholds.json", TH);
const CF = chartFlags(TH);
prepareVectors(pool.rows, MATCH_FEATURES, "fv");
prepareVectors(pool.rows, [...MATCH_FEATURES, GAP_FEATURE], "gv");
// "volRich" robustness variant (added before any outcome statistic was computed): also match log vol60 and the
// 3-session volume spike, which stay imbalanced under primary matching (event stocks: expanding volatility, attention).
const VOLRICH = [...MATCH_FEATURES, { k: "lvol60", w: 1, f: (x) => (x.vol60 > 0 ? Math.log(Math.max(x.vol60, 1e-3)) : null) }, { k: "lvolSpike", w: 0.5, f: (x) => (x.volSpike > 0 ? Math.min(3, Math.max(-2, Math.log(x.volSpike))) : null) }];
prepareVectors(pool.rows, VOLRICH, "vv");
const scales = robustScales(pool.rows, [...MATCH_FEATURES, GAP_FEATURE, ...VOLRICH.slice(MATCH_FEATURES.length)]);
const idx = indexPool(pool.rows);
log(`pool rows ${pool.rows.length} (symbols ${nSyms}); tightQ20 ${r4(tightQ20)}`);

const KEYS_FULL = ["x1", "x2", "x3", "x5", "x10", "xg5", "xg10", "mfe5", "mae5", "mfe10", "mae10", "tMax10"];
for (const X of TARGETS) for (const N of HORIZONS) KEYS_FULL.push(`hit${X}_${N}`);
for (const X of TARGETS) KEYS_FULL.push(`maeBI${X}`);
for (const L of [5, 10, 20]) for (const N of [1, 2, 3, 5, 10]) KEYS_FULL.push(`dd${L}_${N}`);
for (const X of TARGETS) for (const S of STOPS) for (const N of TP_N) KEYS_FULL.push(`tp${X}s${S}n${N}`);
const KEYS_SMALL = ["x1", "x2", "x3", "x5", "x10", "mfe5", "mae5", "mae10", "tp10s10n5", "tp10s0n10", "tp5s5n5", "tp15s10n10", "tp20s10n10", "maeBI10"];
for (const X of TARGETS) for (const N of HORIZONS) KEYS_SMALL.push(`hit${X}_${N}`);
for (const L of [5, 10, 20]) for (const N of [5, 10]) KEYS_SMALL.push(`dd${L}_${N}`);

const pathMemo = new Map();
const ctlPath = (c) => { const key = `${c.s}|${c.k}`; if (!pathMemo.has(key)) pathMemo.set(key, pathAt(bars.get(c.s), c.k, cal, { perEnd: periodEnd(c.per) })); return pathMemo.get(key); };
function ctlMeans(ms, cost, keys) {
  if (!ms.length) return null;
  const outs = ms.map((m) => outcomesOf(ctlPath(m.r), cost)).filter(Boolean);
  const res = { n: outs.length };
  for (const kk of keys) { const v = outs.map((o) => o[kk]).filter((x) => x != null && Number.isFinite(x)); res[kk] = v.length >= 3 ? mean(v) : null; res[`${kk}__n`] = v.length; }
  // cumulative touch probability by session t (0..10), among controls whose 10-session window is complete
  res.cum = {};
  for (const X of TARGETS) { const full = outs.filter((o) => o.last >= 10); res.cum[X] = full.length >= 3 ? Array.from({ length: 11 }, (_, t) => mean(full.map((o) => (o[`ttt${X}`] != null && o[`ttt${X}`] <= t ? 1 : 0)))) : null; }
  for (const kk of Object.keys(res)) if (kk.endsWith("__n") && res[kk] === outs.length) delete res[kk];
  return res;
}
const FLAG_NAMES = Object.keys(CF);
let nm = 0;
for (const r of rows) {
  const ms = nearest(r, idx, scales, nSyms, { K: 10 });
  r.ctl = ms.map((m) => [m.r.s, m.r.D, m.r.k, r4(m.dist)]);
  r.cm = ctlMeans(ms.map((m) => m), r.cost, KEYS_FULL);
  const gs = nearest(r, idx, scales, nSyms, { K: 10, feats: [...MATCH_FEATURES, GAP_FEATURE], key: "gv" });
  r.cg = ctlMeans(gs, r.cost, KEYS_SMALL);
  const vs = nearest(r, idx, scales, nSyms, { K: 10, feats: VOLRICH, key: "vv" });
  r.cv = ctlMeans(vs, r.cost, KEYS_SMALL);
  r.flags = FLAG_NAMES.filter((F) => CF[F](r));
  r.cf = {};
  for (const F of r.flags) { const fsm = nearest(r, idx, scales, nSyms, { K: 10, filter: CF[F] }); r.cf[F] = ctlMeans(fsm, r.cost, KEYS_SMALL); }
  if (++nm % 1000 === 0) log(`matched ${nm}/${rows.length}`);
}
log("matching done");

// ---------------- balance (features only, no outcomes) ----------------
const featList = [...MATCH_FEATURES, GAP_FEATURE, { k: "vr20_60", f: (x) => x.vr20_60 }, { k: "volSpike", f: (x) => (x.volSpike > 0 ? Math.log(x.volSpike) : null) }, { k: "rs20", f: (x) => x.rs20 }, { k: "pos60", f: (x) => x.pos60 }];
const poolByKey = new Map(pool.rows.map((x) => [`${x.s}|${x.k}`, x]));
const balance = [];
for (const per of ["discover", "confirm"]) for (const F of featList) {
  const ev = [], ct = [];
  for (const r of rows) { if (r.per !== per || !r.ctl.length) continue; const v = F.f(r); if (v == null || !Number.isFinite(v)) continue; const cv = r.ctl.map((c) => F.f(poolByKey.get(`${c[0]}|${c[2]}`))).filter((x) => x != null && Number.isFinite(x)); if (!cv.length) continue; ev.push(v); ct.push(mean(cv)); }
  balance.push({ per, feature: F.k, n: ev.length, eventMean: r4(mean(ev)), controlMean: r4(mean(ct)), smd: r4(smd(ev, ct)) });
}

// ---------------- outputs ----------------
const R6 = (v) => (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);
const roundDeep = (x) => (Array.isArray(x) ? x.map(roundDeep) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, roundDeep(v)])) : R6(x));
const outRows = rows.map((r) => roundDeep(r));
fs.writeFileSync(path.join(OUT, "events.json"), JSON.stringify({ builtAt: new Date().toISOString(), TH, rows: outRows }));
writeOut("controls-primary.json", Object.fromEntries(rows.map((r) => [r.id, r.ctl.map((c) => [c[0], c[1], c[3]])])));
const csvCols = ["id", "issuer", "ticker", "publishedAt", "tradeDate", "entryDate", "per", "cls", "role", "isCeo", "isCfo", "ownership", "filingValue", "pubB", "tier", "cost", "entryPrice", "gap", "gapX",
  "r5", "r20", "rs20", "dd60", "vol20", "vr20_60", "range20", "tight", "breakout20", "breakout60", "hi60r", "volSpike", "volDry", "nearLow60", "nearPivot", "spyAbove50",
  "clu7", "clu14", "rep30", "ratioPrev", "posIncrease", "firstPosition", "valueVsOwnMedian", "ownPriorFilings", "salesCovered", "othersSold90", "othersSoldAny90", "histN", "histHit", "gapDays", "observedDays", "gapLeftCensored"];
const oCols = ["x1", "x2", "x3", "x5", "x10", "mfe5", "mae5", "mfe10", "mae10", "tMax10", ...TARGETS.map((X) => `ttt${X}`), ...TARGETS.flatMap((X) => HORIZONS.map((N) => `hit${X}_${N}`)), ...TARGETS.map((X) => `maeBI${X}`),
  ...[5, 10, 20].flatMap((L) => [5, 10].map((N) => `dd${L}_${N}`)), ...TARGETS.flatMap((X) => STOPS.flatMap((S) => TP_N.map((N) => `tp${X}s${S}n${N}`)))];
const csvRows = rows.map((r) => { const x = {}; for (const c of csvCols) x[c] = r[c]; for (const c of oCols) { x[`ev_${c}`] = r.o[c]; x[`ctl_${c}`] = r.cm ? r.cm[c] : null; } x.nControls = r.ctl.length; return x; });
writeOut("events-outcomes.csv", toCsv(csvRows, Object.keys(csvRows[0])));
const cnt = (xs, f) => xs.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
const summary = {
  builtAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), events: E.length, rows: rows.length, skipped, stageCcheck,
  byPeriodClass: cnt(rows, (r) => `${r.per}|${r.cls}`), byPub: cnt(rows, (r) => `${r.per}|${r.pubB}`), byTier: cnt(rows, (r) => `${r.per}|${r.tier}`),
  withControls: rows.filter((r) => r.ctl.length).length, fullK: rows.filter((r) => r.ctl.length >= 10).length, pool: { rows: pool.rows.length, symbols: nSyms }, TH,
  flagCounts: Object.fromEntries(FLAG_NAMES.map((F) => [F, cnt(rows.filter((r) => r.flags.includes(F)), (r) => `${r.per}|${r.cls === "om" ? "om" : "other"}`)])),
  filteredControlCoverage: Object.fromEntries(FLAG_NAMES.map((F) => [F, rows.filter((r) => r.flags.includes(F) && r.cf[F] && r.cf[F].n >= 5).length])),
  balance,
  design: {
    entry: "stage-C official open of the first session >= acceptance + 60 s",
    touch: "daily HIGH >= entry*(1+X) in sessions 0..N (0 = entry session; daily bars are regular-session only)",
    controls: "K=10 stock-days with no code-P filing (accepted < 2026-09-01) within +-20 sessions; same entry month, liquidity tier and period; nearest on r5, r20, dd60, log vol20, log dollar volume, prior-day gap; one per symbol; charged the event's per-side cost; chart-pattern variants matched WITHIN the pattern",
    embargo: "no session on/after the period end is read (discovery < 2026-06-15, confirmation < 2026-09-01)",
  },
};
writeOut("build-summary.json", summary);
checkpoint("build event + control outcome tables", { rows: rows.length, file: "events.json", stageCmismatches: stageCcheck.mismatches });
log(`done: ${JSON.stringify({ rows: rows.length, withControls: summary.withControls, fullK: summary.fullK })}`);
