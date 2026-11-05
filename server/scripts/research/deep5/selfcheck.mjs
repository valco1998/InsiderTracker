// deep5/selfcheck.mjs — leakage and reproduction checks on the build output.
//   node --max-old-space-size=6144 scripts/research/deep5/selfcheck.mjs   → .cache/research/deep5/selfcheck.json
import fs from "node:fs";
import path from "node:path";
import * as L from "./lib5.mjs";
const { addDays, dnum, symOf, group } = L;

const J = L.readOut("clusters.json");
const sec = L.loadSec();
const K = L.makeMarket();
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail).slice(0, 300)}`); };
const c2 = J.clusters.filter((c) => c.clock === 2), c1 = J.clusters.filter((c) => c.clock === 1);

// 1. cluster rules
const bad = J.clusters.filter((c) => {
  const W = L.DEFS[c.cat].W, N = L.DEFS[c.cat].N;
  const span = dnum(c.windowEnd) - dnum(c.windowStart);
  const usd = c.purchases.reduce((a, p) => a + p.usd, 0);
  return !(c.usd > L.MIN_USD) || c.owners < N || span > W - 1 || Math.abs(usd - c.usd) > c.purchases.length;
});
check("rules: USD > 250k, owners >= N, window span <= W-1, USD = sum of purchases", bad.length === 0, { checked: J.clusters.length, bad: bad.slice(0, 3).map((c) => c.id) });
const owBad = J.clusters.filter((c) => c.owners > new Set(c.purchases.map((p) => p.insider)).size);
check("owners never exceed distinct reporting names", owBad.length === 0, { bad: owBad.length });

// 2. Clock 2 point in time: every purchase accepted <= T, one accepted exactly at T; recompute with all later rows deleted
const late = c2.filter((c) => c.purchases.some((p) => p.acceptedAt > c.T) || !c.purchases.some((p) => p.acceptedAt === c.T));
check("clock 2: all qualifying purchases accepted <= T and the completing filing is at T", late.length === 0, { checked: c2.length, bad: late.length });
// rebuild eligibility exactly like build.mjs, then truncate at T
const seen = new Set(), elig = [];
for (const r of sec.rows.filter((r) => r.code === "P")) {
  const dk = [r.acc, r.tradeDate, r.shares, r.price, r.own, r.nature, r.after].join("|"); if (seen.has(dk)) continue; seen.add(dk);
  const e = L.rowEligibility(r, K.M.bars); if (e.ok) elig.push({ ...r, flags: e.flags });
}
const byIss = group(elig, (r) => r.cik);
let trunc = 0, truncBad = [];
for (const c of c2) {
  const rows = (byIss.get(c.cik) || []).filter((r) => r.acceptedAt <= c.T);
  const again = L.clustersClock2(rows, c.cat).find((x) => x.T === c.T);
  trunc++;
  if (!again || again.owners !== c.owners || Math.round(again.usd) !== c.usd) truncBad.push(c.id);
}
check("clock 2: identical cluster when every filing accepted after T is deleted", truncBad.length === 0, { checked: trunc, bad: truncBad.slice(0, 5) });

// 3. features use only bars before the entry date: scramble every bar on/after entry and recompute
let fChecked = 0, fBad = [];
const sample = c2.filter((c) => c.entryStatus === "ok").slice(0, 400);
for (const c of sample) {
  const ser = K.M.bars.get(c.ticker); const orig = ser.arr;
  const cut = orig.findIndex((b) => b.d >= c.entryDate);
  const scr = orig.map((b, i) => (i >= cut && cut >= 0 ? { ...b, o: b.o * 3.1, h: b.h * 3.3, l: b.l * 0.2, c: b.c * 2.7, v: b.v * 9 } : b));
  ser.arr = scr; const f = L.featuresBefore(K, c.ticker, c.entryDate); ser.arr = orig;
  fChecked++;
  const same = (a, b) => (a == null && b == null) || Math.abs(a - b) < 1e-9;
  if (!f || !same(f.pr30 ?? f.r30, c.pr30) || !same(f.r60, c.pr60) || !same(f.adv20, c.adv20) || !same(f.vol40, c.vol40) || !same(f.price, c.price)) fBad.push(c.id);
}
check("features unchanged after scrambling every bar on/after entry", fBad.length === 0, { checked: fChecked, bad: fBad.slice(0, 5) });

// 4. hand recomputation of outcomes from the raw cache file (independent loop)
const raw = JSON.parse(fs.readFileSync(path.join(L.SERVER, ".cache", "research", "daily-bars.json"), "utf8"));
const full = c2.filter((c) => c.full180);
let hBad = [], hN = 0;
for (let i = 0; i < full.length; i += Math.max(1, Math.floor(full.length / 40))) {
  const c = full[i]; const a = raw[c.ticker]; const k0 = a.findIndex((b) => b[0] === c.entryDate);
  const entry = c.entryMode === "open" ? a[k0][1] : a[k0][4];
  const end = addDays(c.entryDate, 180);
  let mx = -1, md = null; let lastC = null;
  for (let k = c.entryMode === "open" ? k0 : k0 + 1; k < a.length && a[k][0] <= end; k++) { if (a[k][2] > mx) { mx = a[k][2]; md = a[k][0]; } lastC = a[k][4]; }
  hN++;
  if (Math.abs(entry - c.entry) > 1e-9 || Math.abs(mx / entry - 1 - c.maxGain) > 1e-9 || md !== c.maxDate || Math.abs(lastC / entry - 1 - c.r180) > 1e-9) hBad.push(c.id);
}
check("hand recomputation: entry, 180d max high, max date, 180d close return", hBad.length === 0, { checked: hN, bad: hBad });
// entry timing: decision = acceptance + 60 s, entry date = first session with 09:28 cut-off >= decision
const eBad = c2.filter((c) => c.entryStatus === "ok" && !c.entryDelayed).filter((c) => { const t = L.decisionOf(c.T); const E = t.time <= "09:28:00" && L.isSession(t.date) ? t.date : L.nextSession(t.date); return E !== c.entryDate || c.entryDate < c.T.slice(0, 10); });
check("clock 2 entry is the first session open after disclosure + 60 s", eBad.length === 0, { bad: eBad.length });

// 5. controls: point-in-time pool membership
const firstP = new Map();
for (const r of sec.rows) if (r.code === "P") { const s = symOf(r.ticker); if (s && r.acceptedAt && (!firstP.has(s) || r.acceptedAt < firstP.get(s))) firstP.set(s, r.acceptedAt); }
let cN = 0, cBad = [];
for (const c of J.clusters.filter((c) => c.ctrlStatus === "ok")) {
  const cutoff = c.clock === 1 ? `${c.completionDate} 23:59:59` : c.T;
  for (const s of c.ctrlSyms.split(" ")) { cN++; if (!(firstP.get(s) <= cutoff) || s === c.ticker) cBad.push(`${c.id}:${s}`); }
}
check("controls: every control had an insider purchase filing accepted before the decision; never the event's own symbol", cBad.length === 0, { checked: cN, bad: cBad.slice(0, 5) });
// controls never excluded because of a FUTURE cluster: re-derive — a control may have a later cluster (expected to exist sometimes)
const later = J.clusters.filter((c) => c.ctrlStatus === "ok" && c.clock === 2).reduce((a, c) => a + c.ctrlSyms.split(" ").filter((s) => c2.some((x) => x.ticker === s && x.T > c.T && dnum(x.T) - dnum(c.T) <= 60)).length, 0);
check("controls: some controls have a cluster in the NEXT 60 days (proof the pool is not filtered on the future)", later > 0, { controlsWithLaterCluster: later });

const out = { at: new Date().toISOString(), pass: results.filter((r) => r.pass).length, total: results.length, results };
L.writeOut("selfcheck.json", JSON.stringify(out, null, 1));
console.log(`${out.pass}/${out.total} PASS`);
