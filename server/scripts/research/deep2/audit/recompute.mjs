// deep2/audit/recompute.mjs — auditor (agent "audit"): INDEPENDENT re-computation of frozen rules F1/F2 on discovery and
// confirmation (own code: own session calendar from SPY bars, own fills, own trap filters — execLib is NOT used for F1/F2),
// then challenges to the T3 near-miss: issuer concentration, matched controls (chart's rows + an own point-in-time pool),
// stability by month, benchmark choice, and a power estimate. Holdout LOCKED.
//   node scripts/research/deep2/audit/recompute.mjs
import fs from "node:fs";
import path from "node:path";
import * as L from "../lib2.mjs";
import { writeOut, readCsv, num, mean, median, sd, r4, pT, binom2, clusterT, normInv, countBy, groupBy, sha256File, FROZEN_SHA } from "./auditLib.mjs";

if (process.env.DEEP2_HOLDOUT) throw new Error("recompute.mjs must run with the holdout locked");
if (sha256File(L.FROZEN_FILE) !== FROZEN_SHA) throw new Error("frozen-rules.json hash mismatch");
const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const T3 = (e) => (e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5;
const E = L.loadEvents(); // priced, non-holdout
const bars = L.loadBars();
const SPY = bars.get("SPY");
const DAYS = SPY.arr.map((b) => b.d), DIDX = new Map(DAYS.map((d, i) => [d, i]));
const stageA = JSON.parse(fs.readFileSync(path.join(L.DEEP1, "stageA.json"), "utf8"));
const COMPLETE = stageA.completeThrough, SUSPECT = new Set(stageA.prices.suspectSymbols || []);
const firstAfter = (d) => { let lo = 0, hi = DAYS.length - 1, ans = DAYS.length; while (lo <= hi) { const m = (lo + hi) >> 1; if (DAYS[m] > d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
const END = { discover: L.DISCOVER_END, confirm: L.HOLDOUT_START };
const barOn = (s, d) => { const i = s?.idx.get(d); return i == null ? null : s.arr[i]; };

// ---------------- 1. own implementation of the frozen Track-B rule ----------------
// Entry: stage-C entry session, except a same-day open whose acceptance + 60 s is after 09:28 ET moves to the next session.
// Exit: official close of the N-th SPY session after entry. Net = exit(1-c)/(entry(1+c)) - 1; excess = net - SPY(open->close).
function ownTrade(e, N, { costMult = 1, traps = true } = {}) {
  const s = bars.get(sym(e.ticker)); if (!s) return { status: "no_series" };
  if (traps && SUSPECT.has(sym(e.ticker))) return { status: "suspect_symbol" };
  const pubDay = e.publishedAt.slice(0, 10), tAcc = e.publishedAt.slice(11, 19);
  let d = e.entryDate;
  if (traps && d === pubDay && tAcc > "09:27:00") d = DAYS[firstAfter(pubDay)];
  const i = DIDX.get(d); if (i == null) return { status: "entry_not_session" };
  const xd = DAYS[i + N]; if (!xd || xd > COMPLETE) return { status: "pending", entryDate: d };
  const eb = barOn(s, d), xb = barOn(s, xd), se = SPY.arr[i], sx = SPY.arr[i + N];
  if (!eb || !(eb.o > 0)) return { status: "no_entry_bar", entryDate: d };
  if (!xb || !(xb.c > 0)) return { status: "no_exit_bar", entryDate: d, exitDate: xd };
  if (traps && (!(eb.v > 0) || !(xb.v > 0))) return { status: "zero_volume", entryDate: d, exitDate: xd };
  const c = (e.costBpsPerSide * costMult) / 1e4;
  const gross = xb.c / eb.o - 1, spyR = sx.c / se.o - 1, net = (xb.c * (1 - c)) / (eb.o * (1 + c)) - 1;
  return { status: "ok", entryDate: d, exitDate: xd, entryPrice: eb.o, exitPrice: xb.c, gross, spy: spyR, net, x: net - spyR, xGross: gross - spyR, shifted: d !== e.entryDate };
}
const inPeriod = (e, tr, per) => tr.status === "ok" && L.periodOf(e) === per && tr.exitDate < END[per];

// companyStats + own clustered t (CR1) with a Student-t p-value on G-1 df, sign test, winsorized mean.
function stats(rows) {
  const cs = L.companyStats(rows.map((r) => ({ issuer: r.issuer, x: r.x })));
  if (!rows.length) return cs;
  const ct = clusterT(rows); const pos = rows.filter((r) => r.x > 0).length;
  return { ...cs, ownT: ct.t == null ? null : r4(ct.t), clusters: ct.G, pT_Gminus1: ct.t == null ? null : r4(pT(ct.t, ct.G - 1)), signTestP: r4(binom2(pos, rows.length)), sd: r4(sd(rows.map((r) => r.x))) };
}
const slim = (s) => (s?.n ? { n: s.n, issuers: s.issuers, mean: s.mean, median: s.median, issuerMedianOfMeans: s.issuerMedianOfMeans, positive: s.positive, t: s.t, p: s.p == null ? null : r4(s.p), pT_Gminus1: s.pT_Gminus1, meanExTop5Issuers: s.meanExTop5Issuers, ci95: s.ci95, wmean: s.wmean, signTestP: s.signTestP, sd: s.sd } : { n: 0 });

const t3 = E.filter(T3);
const execRes = Object.fromEntries(["discover", "confirm"].map((ph) => [ph, JSON.parse(fs.readFileSync(path.join(L.DEEP2, "execution", `results-${ph}.json`), "utf8"))]));
const execStat = (ph, id) => { const t = execRes[ph].tests.find((x) => x.id === id); return t ? { n: t.stats.n, mean: t.stats.mean, median: t.stats.median, t: t.stats.t, p: r4(t.stats.p), meanExTop5Issuers: t.stats.meanExTop5Issuers } : null; };

const RULES = { F1: 3, F2: 5 };
const recompute = {};
const eventRows = {}; // per rule/period, event-level rows for the challenges
for (const [rule, N] of Object.entries(RULES)) {
  recompute[rule] = {};
  for (const per of ["discover", "confirm"]) {
    // (a) stage-C usable h[N].excessNet — the untrapped spec (= execution-B-T3-nextOpen-hN-tier1 = deep-1 H22 at N=5)
    const base = t3.filter((e) => L.usable(e, N, per)).map((e) => ({ id: e.id, issuer: e.issuerCik, x: e.h[N].excessNet }));
    // (b) own frozen implementation (traps on), tier x1 and x2
    const own1 = [], own2 = [], status = {};
    for (const e of t3) {
      const tr = ownTrade(e, N); if (L.periodOf(e) === per) status[tr.status] = (status[tr.status] || 0) + 1;
      if (!inPeriod(e, tr, per)) continue;
      const tr2 = ownTrade(e, N, { costMult: 2 });
      own1.push({ id: e.id, issuer: e.issuerCik, ticker: e.ticker, x: tr.x, e, tr }); own2.push({ id: e.id, issuer: e.issuerCik, x: tr2.x });
    }
    eventRows[`${rule}|${per}`] = own1;
    // reconcile: which events differ between (a) and (b) and why
    const baseIds = new Set(base.map((r) => r.id)), ownIds = new Set(own1.map((r) => r.id));
    const onlyBase = base.filter((r) => !ownIds.has(r.id)).map((r) => { const e = t3.find((x) => x.id === r.id); return { ticker: e.ticker, publishedAt: e.publishedAt, reason: ownTrade(e, N).status, ...(ownTrade(e, N).status === "ok" ? { shiftedExitBeyondPeriod: ownTrade(e, N).exitDate } : {}) }; });
    const onlyOwn = own1.filter((r) => !baseIds.has(r.id)).map((r) => ({ ticker: r.ticker, publishedAt: r.e.publishedAt }));
    const shifted = own1.filter((r) => r.tr.shifted).map((r) => ({ ticker: r.ticker, publishedAt: r.e.publishedAt, entryStageC: r.e.entryDate, entryOwn: r.tr.entryDate, xStageC: r.e.h[N]?.excessNet, xOwn: r4(r.x) }));
    recompute[rule][per] = {
      stageC_untrapped: slim(stats(base)), own_frozen_tier1: slim(stats(own1)), own_frozen_tier2: slim(stats(own2)), ownStatusCounts: status,
      execution_frozen_tier1: execStat(per, `execution-trapsClean-T3_ceoCfoOM250k-h${N}`), execution_untrapped_tier1: execStat(per, `execution-B-T3_ceoCfoOM250k-nextOpen-h${N}-tier1`),
      execution_untrapped_tier2: execStat(per, `execution-B-T3_ceoCfoOM250k-nextOpen-h${N}-tier2`),
      reconciliation: { droppedByTraps: onlyBase, addedByTraps: onlyOwn, mooShifted: shifted },
      gross: { meanGrossExcess: r4(mean(own1.map((r) => r.tr.xGross))), meanRoundTripBps: Math.round(mean(own1.map((r) => 2 * r.e.costBpsPerSide))) },
      vsIwm: (() => { const xs = t3.filter((e) => L.usable(e, N, per) && e.h[N].excessIwmNet != null).map((e) => ({ issuer: e.issuerCik, x: e.h[N].excessIwmNet })); return slim(stats(xs)); })(),
    };
  }
}

// ---------------- 2. challenge: issuer concentration ----------------
function concentration(rows) {
  const byI = groupBy(rows, (r) => r.issuer); const tot = rows.reduce((a, r) => a + r.x, 0);
  const contrib = [...byI.entries()].map(([k, v]) => ({ issuer: k, ticker: v[0].ticker, n: v.length, sum: v.reduce((a, r) => a + r.x, 0) })).sort((a, b) => b.sum - a.sum);
  const n = rows.length; const m = tot / n;
  // remove top contributors one by one until the mean is <= 0
  let s = tot, k = n, removed = 0; for (const c of contrib) { if (s / k <= 0) break; s -= c.sum; k -= c.n; removed++; }
  const loo = contrib.map((c) => (tot - c.sum) / (n - c.n));
  const sym5 = rows.filter((r) => !new Set([...contrib.slice(0, 5), ...contrib.slice(-5)].map((c) => c.issuer)).has(r.issuer)).map((r) => r.x);
  return { n, issuers: byI.size, mean: r4(m), sumPct: r4(tot), top5ShareOfSum: r4(contrib.slice(0, 5).reduce((a, c) => a + c.sum, 0) / tot), top10ShareOfSum: r4(contrib.slice(0, 10).reduce((a, c) => a + c.sum, 0) / tot),
    issuersToRemoveForMeanLe0: removed, meanExTop5: r4(mean(rows.filter((r) => !new Set(contrib.slice(0, 5).map((c) => c.issuer)).has(r.issuer)).map((r) => r.x))),
    meanExTop5AndBottom5Symmetric: r4(mean(sym5)), leaveOneIssuerOut: { min: r4(Math.min(...loo)), max: r4(Math.max(...loo)) },
    top5: contrib.slice(0, 5).map((c) => ({ ticker: c.ticker, n: c.n, sumPct: r4(c.sum) })), bottom5: contrib.slice(-5).reverse().map((c) => ({ ticker: c.ticker, n: c.n, sumPct: r4(c.sum) })) };
}
const concentrationOut = Object.fromEntries(Object.entries(eventRows).map(([k, rows]) => [k, concentration(rows)]));

// ---------------- 3. challenge: stability by month / bucket ----------------
const byMonth = {};
for (const [k, rows] of Object.entries(eventRows)) {
  const g = groupBy(rows, (r) => r.tr.entryDate.slice(0, 7));
  byMonth[k] = [...g.entries()].sort().map(([m, rs]) => ({ month: m, n: rs.length, issuers: new Set(rs.map((r) => r.issuer)).size, mean: r4(mean(rs.map((r) => r.x))), median: r4(median(rs.map((r) => r.x))), positive: r4(rs.filter((r) => r.x > 0).length / rs.length) }));
}
const pubB = (e) => { const t = e.publishedAt.slice(11); return t < "09:30:00" ? "premarket" : t < "16:00:00" ? "intraday" : "afterClose"; };
const tierB = (e) => `${e.costBpsPerSide}bps`;
const buckets = {};
for (const k of ["F1|discover", "F1|confirm"]) {
  const rows = eventRows[k];
  for (const [name, f] of [["publication", (r) => pubB(r.e)], ["costTier", (r) => tierB(r.e)], ["drawdown60", (r) => (r.e.dd60 <= -0.3 ? "dd60<=-30%" : r.e.dd60 <= -0.15 ? "-30..-15%" : "> -15%")], ["ret5BeforeTrade", (r) => (r.e.ret5 == null ? "na" : r.e.ret5 <= -0.05 ? "<=-5%" : r.e.ret5 < 0.05 ? "-5..5%" : ">=5%")]]) {
    const g = groupBy(rows, f); buckets[`${k}|${name}`] = Object.fromEntries([...g.entries()].map(([b, rs]) => [b, { n: rs.length, mean: r4(mean(rs.map((r) => r.x))), median: r4(median(rs.map((r) => r.x))) }]));
  }
}

// ---------------- 4. challenge: matched controls ----------------
// 4a. the chart agent's own matched controls (discovery, primary design), T3 rows of mc-events.csv
const mcRows = readCsv(path.join(L.DEEP2, "chart", "mc-events.csv"));
const mcT3 = mcRows.filter((r) => r.ceoCfo === "true" && r.ownership === "D" && r.venue === "open_market" && num(r.filingValue) >= 2.5e5);
const mcStat = (k) => { const rs = mcT3.filter((r) => r[`diff_${k}`] !== ""); return { ...slim(stats(rs.map((r) => ({ issuer: r.issuer, x: num(r[`diff_${k}`]) })))), eventMean: r4(mean(rs.map((r) => num(r[`ev_${k}`])))), controlMean: r4(mean(rs.map((r) => num(r[`ctl_${k}`])))) }; };
const chartControls = { source: "chart/mc-events.csv (primary design: same month + tier, 10 nearest on r5, r20, dd60, log vol20, log dv20, prior gap; ±20-session P exclusion)", t3Rows: mcT3.length, x3: mcStat("x3"), x5: mcStat("x5"), x0: mcStat("x0"), gapX: mcStat("gapX") };

// 4b. own pool, discovery AND confirmation, three exclusion designs (point-in-time vs future-informed)
const sec = await L.loadSecRows();
const cik2sym = new Map(); for (const r of sec.rows) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, sym(r.ticker));
const marks = new Map(); // symbol -> sorted session indices of P filings (acceptance session, next session, trade-date session)
const sessOnOrAfter = (d) => { let lo = 0, hi = DAYS.length - 1, ans = DAYS.length; while (lo <= hi) { const m = (lo + hi) >> 1; if (DAYS[m] >= d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
for (const r of sec.rows) {
  if (r.code !== "P") continue; const s = r.ticker ? sym(r.ticker) : cik2sym.get(r.cik); if (!s) continue;
  const set = marks.get(s) || marks.set(s, new Set()).get(s);
  const ad = String(r.acceptedAt || "").slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) { const j = sessOnOrAfter(ad); set.add(j); set.add(j + 1); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "")) set.add(sessOnOrAfter(r.tradeDate));
}
const markArr = new Map([...marks].map(([s, set]) => [s, [...set].sort((a, b) => a - b)]));
const hasMark = (s, lo, hi) => { const a = markArr.get(s); if (!a) return false; let l = 0, h = a.length - 1; while (l <= h) { const m = (l + h) >> 1; if (a[m] < lo) l = m + 1; else if (a[m] > hi) h = m - 1; else return true; } return false; };
const DESIGNS = { pointInTime: [20, 0], chartLike: [20, 20], ext: [20, 60] }; // [sessions before, sessions after] of the control's entry session
const tierOf = (dv) => (!(dv > 0) ? 100 : dv >= 50e6 ? 5 : dv >= 5e6 ? 15 : dv >= 1e6 ? 35 : 75);
function feat(s, i) { // decision bar i (bars 0..i only)
  const a = s.arr; if (i < 25 || !(a[i]?.c > 0)) return null;
  const last = a[i].c, ret = (n) => (i - n >= 0 && a[i - n].c > 0 ? last / a[i - n].c - 1 : null);
  let hi = -Infinity; for (let k = Math.max(0, i - 59); k <= i; k++) hi = Math.max(hi, a[k].c);
  const lr = []; for (let k = Math.max(1, i - 19); k <= i; k++) if (a[k].c > 0 && a[k - 1].c > 0) lr.push(Math.log(a[k].c / a[k - 1].c));
  let dv = 0, n = 0; for (let k = Math.max(0, i - 19); k <= i; k++) { dv += a[k].c * a[k].v; n++; }
  const v = sd(lr), r5 = ret(5), r20 = ret(20); if (r5 == null || r20 == null || !(v > 0) || !(dv > 0)) return null;
  return { r5: Math.min(1, Math.max(-0.5, r5)), r20: Math.min(2, Math.max(-0.7, r20)), dd60: last / hi - 1, lvol: Math.log(Math.max(v, 1e-3)), ldv: Math.log(Math.max(dv / n, 1e3)), tier: tierOf(dv / n) };
}
const FK = ["r5", "r20", "dd60", "lvol", "ldv"];
// Candidate control stock-days: entry session k (bar index in its own series) in Dec 2025 .. Aug 2026.
const pool = [];
for (const [s, ser] of bars) {
  if (s === "SPY" || s === "IWM" || ser.arr.length < 30) continue;
  for (let k = 26; k < ser.arr.length; k++) {
    const D = ser.arr[k].d; if (D < "2025-12-01" || D >= L.HOLDOUT_START) continue;
    const j = DIDX.get(D); if (j == null || !(ser.arr[k].o > 0)) continue;
    const f = feat(ser, k - 1); if (!f) continue;
    pool.push({ s, k, j, D, m: D.slice(0, 7), ...f });
  }
}
const scale = Object.fromEntries(FK.map((k) => { const xs = pool.map((r) => r[k]).sort((a, b) => a - b); return [k, Math.max(1e-6, (xs[Math.floor(0.75 * (xs.length - 1))] - xs[Math.floor(0.25 * (xs.length - 1))]) / 1.349)]; }));
const poolBy = groupBy(pool, (r) => `${r.m}|${r.tier}`);
function ctlOutcome(r, N, cost, perEnd) {
  const ser = bars.get(r.s), xd = DAYS[r.j + N]; if (!xd || xd >= perEnd || xd > COMPLETE) return null;
  const xb = barOn(ser, xd); if (!xb || !(xb.c > 0)) return null; const eb = ser.arr[r.k];
  const c = cost / 1e4, net = (xb.c * (1 - c)) / (eb.o * (1 + c)) - 1; return net - (SPY.arr[r.j + N].c / SPY.arr[r.j].o - 1);
}
const ownControls = {};
for (const [dname, [bef, aft]] of Object.entries(DESIGNS)) for (const [rule, N] of Object.entries(RULES)) for (const per of ["discover", "confirm"]) {
  const rows = [];
  for (const ev of eventRows[`${rule}|${per}`]) {
    const e = ev.e, ser = bars.get(sym(e.ticker)), k = ser.idx.get(ev.tr.entryDate); if (k == null) continue;
    const f = feat(ser, k - 1); if (!f) continue;
    const cand = poolBy.get(`${ev.tr.entryDate.slice(0, 7)}|${f.tier}`) || [];
    const best = new Map();
    for (const r of cand) {
      if (r.s === sym(e.ticker)) continue;
      if (hasMark(r.s, r.j - bef, r.j + aft)) continue;
      let d2 = 0; for (const q of FK) { const z = (r[q] - f[q]) / scale[q]; d2 += z * z; }
      const b = best.get(r.s); if (!b || d2 < b.d2) best.set(r.s, { r, d2 });
    }
    const picks = [...best.values()].sort((a, b) => a.d2 - b.d2);
    const outs = []; for (const p of picks) { if (outs.length >= 10) break; const o = ctlOutcome(p.r, N, e.costBpsPerSide, END[per]); if (o != null) outs.push(o); }
    if (outs.length < 5) continue;
    rows.push({ issuer: e.issuerCik, x: ev.x - mean(outs), ev: ev.x, ctl: mean(outs) });
  }
  ownControls[`${dname}|${rule}|${per}`] = { ...slim(stats(rows)), eventMean: r4(mean(rows.map((r) => r.ev))), controlMean: r4(mean(rows.map((r) => r.ctl))) };
}

// ---------------- 5. power: forward sample needed at the claimed effect ----------------
function power(rows, label, effect) {
  const xs = rows.map((r) => r.x), n = xs.length, s = sd(xs), ct = clusterT(rows);
  const iidSe = s / Math.sqrt(n), de = ct.se && iidSe ? (ct.se / iidSe) ** 2 : 1;
  const need = (mu, zA) => Math.ceil(((zA + normInv(0.8)) ** 2 * s * s * de) / (mu * mu));
  return { label, effect: r4(effect), sdPerEvent: r4(s), designEffectClustering: r4(de), nFor80pctPower_twoSided05: need(effect, normInv(0.975)), nFor80pctPower_oneSided05: need(effect, normInv(0.95)),
    nFor80pctPower_oneSided05_halfEffect: need(effect / 2, normInv(0.95)) };
}
const rate = (() => { const months = new Set(t3.map((e) => e.publishedAt.slice(0, 7))).size; return { t3EventsPreHoldout: t3.length, calendarMonths: months, perMonth: r4(t3.length / months) }; })();
const pw = [
  power(eventRows["F1|discover"], "F1 at its discovery mean", mean(eventRows["F1|discover"].map((r) => r.x))),
  power(eventRows["F1|discover"], "F1 at its pooled discovery+confirmation mean", mean([...eventRows["F1|discover"], ...eventRows["F1|confirm"]].map((r) => r.x))),
  power(eventRows["F2|discover"], "F2 at its discovery mean", mean(eventRows["F2|discover"].map((r) => r.x))),
];
for (const p of pw) p.monthsAtT3Rate = r4(p.nFor80pctPower_oneSided05 / rate.perMonth);

// ---------------- 6. winners / losers (descriptive) ----------------
const wl = (k) => { const rs = [...eventRows[k]].sort((a, b) => b.x - a.x); const v = (r) => ({ ticker: r.ticker, publishedAt: r.e.publishedAt, role: r.e.role, value: Math.round(r.e.filingValue), dd60: r4(r.e.dd60), ret20: r4(r.e.ret20), costBps: r.e.costBpsPerSide, x: r4(r.x) }); return { winners: rs.slice(0, 8).map(v), losers: rs.slice(-8).reverse().map(v) }; };

const out = { generatedAt: new Date().toISOString(), frozenSha256Verified: true, completeThrough: COMPLETE,
  definitions: { F1: "T3, next achievable open (09:28 MOO cut-off) -> close of session 3, tier cost both sides, zero-volume fills dropped, stage-A suspects excluded", F2: "same, session 5", stats: "lib2.companyStats + own CR1 clustered t with Student-t p on G-1 df" },
  recompute, concentration: concentrationOut, byMonth, buckets, matchedControls: { chart: chartControls, own: ownControls, ownDesign: "same entry month + cost tier; 10 nearest (one per symbol, excluding the event's symbol) on clipped r5, r20, dd60, log vol20, log dv20 at the decision bar; controls charged the event's cost; exits inside the event's period. pointInTime = exclude a control day only for a P filing in the 20 sessions up to its entry (known then); chartLike = also the 20 sessions after; ext = also 60 after." },
  power: { eventRate: rate, estimates: pw }, winnersLosers: { F1discover: wl("F1|discover"), F1confirm: wl("F1|confirm") } };
writeOut("recompute.json", out);
const P = (s) => s?.n ? `n ${s.n}/${s.issuers} mean ${s.mean} med ${s.median} imed ${s.issuerMedianOfMeans} t ${s.t} p ${s.p} pT ${s.pT_Gminus1} exTop5 ${s.meanExTop5Issuers}` : "n 0";
for (const [rule, v] of Object.entries(recompute)) for (const [per, x] of Object.entries(v)) { console.log(`${rule} ${per}\n  stageC  ${P(x.stageC_untrapped)}\n  own x1  ${P(x.own_frozen_tier1)}\n  exec x1 ${JSON.stringify(x.execution_frozen_tier1)}\n  own x2  ${P(x.own_frozen_tier2)}\n  vsIWM   ${P(x.vsIwm)}\n  status ${JSON.stringify(x.ownStatusCounts)} recon ${JSON.stringify(x.reconciliation)}`); }
console.log("concentration", JSON.stringify(concentrationOut, null, 0));
console.log("byMonth", JSON.stringify(byMonth));
console.log("chart controls", JSON.stringify(chartControls));
console.log("own controls", JSON.stringify(Object.fromEntries(Object.entries(ownControls).map(([k, s]) => [k, `n ${s.n} ev ${s.eventMean} ctl ${s.controlMean} diff ${s.mean} t ${s.t} imed ${s.issuerMedianOfMeans}`])), null, 1));
console.log("power", JSON.stringify(out.power, null, 1));
console.log("buckets", JSON.stringify(buckets));
