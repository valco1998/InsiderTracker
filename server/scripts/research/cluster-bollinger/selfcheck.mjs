// cluster-bollinger/selfcheck.mjs — leakage + independent recomputation checks.
//   node --max-old-space-size=6144 scripts/research/cluster-bollinger/selfcheck.mjs → selfcheck.json
import fs from "node:fs";
import path from "node:path";
import * as C from "./cbLib.mjs";
const { L } = C; const { addDays, group } = L;
const sig = C.readOut("signals.json"); const res = C.readOut("results.json");
const sec = L.loadSec(), K = L.makeMarket(), names = L.loadNames();
const raw = JSON.parse(fs.readFileSync(path.join(L.SERVER, ".cache", "research", "daily-bars.json"), "utf8"));
const out = []; const check = (name, pass, detail) => { out.push({ name, pass: !!pass, detail }); console.log(pass ? "PASS" : "FAIL", name, JSON.stringify(detail).slice(0, 250)); };
const all = [...sig.base, ...sig.tiered];

// 1. rules on every signal
const bad = all.filter((s) => s.owners < 2 || s.value < 250000 || !s.insiders.some((i) => i.officer) || s.insiders.some((i) => i.avgPrice < 5) || s.dOwn == null || s.dOwn <= 0
  || s.trades.some((t) => t.acceptedAt > s.T || t.tradeDate < addDays(s.T.slice(0, 10), -5) || t.tradeDate > s.T.slice(0, 10))
  || (s.rule === "tiered" && !((s.tier === "T1" && s.value >= 1.5e6 && s.dOwn >= 0.03) || (s.tier === "T2" && s.value >= 5e5 && s.value < 1.5e6 && s.dOwn >= 0.06) || (s.tier === "T3" && s.value < 5e5 && s.owners >= 3 && s.dOwn >= 0.10))));
check("every signal: >=2 owners, officer, >= $250k, insider avg price >= $5, valid dOwn > 0, trades accepted <= T within 5 days, tier rule", bad.length === 0, { checked: all.length, bad: bad.slice(0, 3).map((s) => s.id) });
const sumBad = all.filter((s) => Math.abs(s.trades.reduce((a, t) => a + t.value, 0) - s.value) > s.trades.length);
check("signal value = sum of its purchases", sumBad.length === 0, { bad: sumBad.length });

// 2. point in time: deleting every filing accepted after T reproduces the signal at the same T
const { rows: elig } = C.eligibleRows(sec, K.M.bars, names); const byIss = group(elig, (r) => r.cik);
let pit = 0; const pitBad = [];
for (const s of all) { const rows = (byIss.get(s.cik) || []).filter((r) => r.acceptedAt <= s.T); const eps = C.issuerSignals(rows, K); const hit = eps.some((e) => e[s.rule]?.T === s.T && Math.round(e[s.rule].value) === s.value); pit++; if (!hit) pitBad.push(s.id); }
check("point in time: same signal when every later filing is deleted", pitBad.length === 0, { checked: pit, bad: pitBad.slice(0, 5) });

// 3. entry date = first session open after T + 60 s (09:28 cut-off)
const eBad = all.filter((s) => { const t = L.decisionOf(s.T); const E = L.isSession(t.date) && t.time <= "09:28:00" ? t.date : L.nextSession(t.date); return s.entryDate < E; });
check("entry never before the first session open after disclosure + 60 s", eBad.length === 0, { bad: eBad.length });

// 4. dOwn recomputed by hand from the purchase rows' sharesOwnedAfter
let dN = 0; const dBad = [];
for (const s of all.slice(0, 120)) {
  const lines = s.insiders.flatMap((i) => i.lines).filter((l) => l.dOwn != null);
  const d = lines.reduce((a, l) => a + l.bought, 0) / lines.reduce((a, l) => a + l.pre, 0); dN++;
  if (Math.abs(d - s.dOwn) > 1e-12 || lines.some((l) => !(l.pre > 0))) dBad.push(s.id);
}
check("cluster dOwn = pooled bought / pooled pre-purchase holdings over valid lines", dBad.length === 0, { checked: dN, bad: dBad });

// 5. independent band + exit replay from the raw cache (plain loops), variant C and D event trades
const trades = []; for (const line of fs.readFileSync(path.join(C.OUT, "event-trades.csv"), "utf8").trim().split("\n").slice(1)) trades.push(line);
const ev = JSON.parse(fs.readFileSync(path.join(C.OUT, "results.json"), "utf8"));
function replay(sym, entryDate, mode) {
  const a = raw[sym]; const i0 = a.findIndex((b) => b[0] === entryDate);
  const band = (i) => { const cs = a.slice(i - 19, i + 1).map((b) => b[4]); const m = cs.reduce((x, y) => x + y, 0) / 20; const sd = Math.sqrt(cs.reduce((x, y) => x + (y - m) ** 2, 0) / 20); return [m - 2.5 * sd, m + 2.5 * sd]; };
  const entry = a[i0][1], stop = band(i0 - 1)[0] * 0.98; let pend = false;
  const spy = raw.SPY.map((b) => b[0]); const s0 = spy.indexOf(entryDate);
  for (let j = i0; j < a.length && a[j][0] <= L.COMPLETE_THROUGH; j++) {
    const [d, o, h, l, c] = a[j]; const k = spy.findIndex((x) => x >= d) - s0 + 1;
    if (mode === "fixed") { if (k >= 20) return [d, c, "fixed"]; continue; }
    if (pend && j > i0) return [d, o, "dyn"];
    if (j > i0 && o <= stop) return [d, o, "gapstop"];
    if (l <= stop) return [d, stop, "stop"];
    const lim = band(j - 1)[1];
    if (j > i0 && o >= lim) return [d, o, "gaptp"];
    if (h >= lim) return [d, Math.max(lim, j === i0 ? entry : lim), "tp"];
    if (c < band(j)[0]) pend = true;
    if (k >= 45) return [d, c, "time"];
  }
  return null;
}
const sigById = new Map(all.map((s) => [s.id, s]));
let rN = 0; const rBad = [];
const simC = all.filter((s) => s.rule === "base").filter((_, i) => i % 5 === 0);
for (const s of simC) for (const mode of ["bb", "fixed"]) {
  const r = C.simulate(K, s.ticker, s.entryDate, { mode }); if (r.status !== "closed") continue;
  const x = replay(s.ticker, s.entryDate, mode); rN++;
  if (!x || x[0] !== r.exitDate || Math.abs(x[1] - r.exit) > 1e-9) rBad.push(`${s.id}:${mode}`);
}
check("independent replay of entries, bands, stops, take-profits and exits (base signals, both exit modes)", rBad.length === 0, { checked: rN, bad: rBad.slice(0, 5) });

// 6. take-profit never uses the same day's band; hard stop = lower band of the day before entry x 0.98
const tpBad = []; for (const s of simC) { const r = C.simulate(K, s.ticker, s.entryDate, { mode: "bb" }); if (r.status !== "closed") continue; const B = C.bands(K, s.ticker); const ser = K.ser(s.ticker); const iE = ser.idx.get(s.entryDate); if (Math.abs(r.stop - B.lo[iE - 1] * 0.98) > 1e-9) tpBad.push(s.id); if (/take_profit/.test(r.reason)) { const j = ser.idx.get(r.exitDate); if (r.reason === "take_profit" && r.exit < B.up[j - 1] - 1e-9) tpBad.push(s.id + ":tp"); } }
check("stop = lower band(entry-1) x 0.98; take-profit fills at/above the previous day's upper band", tpBad.length === 0, { bad: tpBad });

// 7. portfolio constraints
const log = res.logD; const byWeek = {}; let maxOpen = 0;
for (const t of log) { const d = new Date(t.entryDate + "T00:00:00Z"); const wk = addDays(t.entryDate, -((d.getUTCDay() + 6) % 7)); byWeek[wk] = (byWeek[wk] || 0) + 1; }
const days = [...new Set(log.flatMap((t) => [t.entryDate]))].sort();
for (const d of days) maxOpen = Math.max(maxOpen, log.filter((t) => t.entryDate <= d && (!t.exitDate || t.exitDate > d)).length);
const posBad = log.filter((t) => t.positionUsd > 0.2 * t.eqAtEntry * 1.08);
check("portfolio D: <= 3 new per week, <= 10 open, position <= 20% of equity (sized at prior close)", Math.max(...Object.values(byWeek)) <= 3 && maxOpen <= 10 && posBad.length === 0, { maxWeek: Math.max(...Object.values(byWeek)), maxOpen, oversized: posBad.length });

const s = { at: new Date().toISOString(), pass: out.filter((x) => x.pass).length, total: out.length, results: out };
C.writeOut("selfcheck.json", JSON.stringify(s, null, 1)); console.log(`${s.pass}/${s.total} PASS`);
