// deep4/audit/a6_misc.mjs — Phase A items 5 (post-unlock rebuild of the design controls), 6 (walk-forward threshold / lambda behaviour)
// and 7 (execution: overlap, independence, cost tiers, portfolio) from the agents' saved outputs and the panel code.
//   node --max-old-space-size=12288 scripts/research/deep4/audit/a6_misc.mjs
import fs from "node:fs";
import path from "node:path";
import { phaseA, L4, V, loadP, loadC, writeOut, checkpoint, recordOnce, mean, median, r4, r6, fin, group, countBy, isPrimaryPurchase, quantile } from "./common.mjs";
import * as PL from "../panel/panelLib.mjs";
import { OUT_DIR } from "../../lib.mjs";

phaseA();
const t0 = Date.now();
const out = {};
// ---------------- item 5: design controls with the PRE-unlock exclusion ----------------
{
  const P = loadP(["design"]), C = loadC(["design"]);
  const secAll = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep2", "sec-rows.json"), "utf8"));
  const SEC = secAll.rows.filter((r) => String(r.acceptedAt) < L4.DESIGN_END); secAll.rows = null;
  const Prows = SEC.filter((r) => r.code === "P"); const cik2sym = new Map(); for (const r of SEC) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, PL.symOf(r.ticker));
  const M = PL.createMarket({ cutoff: L4.DESIGN_END });
  const pool = PL.buildPool(M, PL.purchaseBlocks(M, Prows, cik2sym), { visibleUntil: L4.DESIGN_END, segOf: (d) => L4.segmentOf(d) });
  const sp = pool.rows.filter((r) => r.per === "design"); PL.prepareVectors(sp, PL.MATCH_FEATURES, "fv"); const scales = PL.robustScales(sp, PL.MATCH_FEATURES), idx = PL.indexPool(sp);
  const E = P.rows.filter((r) => isPrimaryPurchase(r) && r.featOk === 1 && fin(r.B_xsNet30) != null);
  let changed = 0; const vals = new Map(), cache = new Map();
  for (const e of E) { const ms = PL.nearest({ m: e.entryMonth, tier: e.tier, per: "design", r5: e.r5, r20: e.r20, dd60: e.dHi60, vol20: e.vol20, dv20: e.dv20, gapPrev: e.gapPrev }, idx, scales, pool.syms.length, { K: 10, filter: (r) => r.s !== e.sym });
    const orig = new Set((C.byEvent[e.key] || []).map(([k]) => k)); if (!(ms.length === orig.size && ms.every((m) => orig.has(`${m.r.s}|${m.r.D}`)))) changed++;
    const v = []; for (const m of ms) { const k = `${m.r.s}|${m.r.D}`; if (!cache.has(k)) { const A = M.aligned(m.r.s); const mf = PL.marketFeatures(M, A, m.r.j - 1); cache.set(k, mf ? PL.outcomeB(M, A, m.r.j, mf.costBps).B_xsNet30 : null); } const x = cache.get(k); if (fin(x) != null) v.push(x); } vals.set(e.key, v); }
  const md = (ctl) => { const m = V.matchedDiff(E.map((r) => ({ issuer: r.cik, x: r.B_xsNet30, controls: ctl(r) })), { value: "x", controls: "controls", cluster: "issuer", B: 1000, seed: 7 }); return { n: m.n, eventMean: r6(m.eventMean), controlMean: r6(m.controlMean), estimate: r6(m.diff), t: r4(m.t), p: r4(m.p) }; };
  const pre = md((r) => vals.get(r.key) || []), post = md((r) => C.of(r.key).map((c) => c.B_xsNet30).filter((x) => fin(x) != null));
  out.item5 = { poolRowsPreUnlock: sp.length, events: E.length, eventsWithChangedControlSet: changed, preUnlock: pre, postUnlockAsUsed: post };
  recordOnce("audit4.ctl.preUnlock.design", { segment: "design", ...pre, eventsWithChangedControlSet: changed, postUnlockEstimate: post.estimate });
  console.log("item5", JSON.stringify(out.item5));
}
// ---------------- item 6: executable threshold / lambda (learn walk-forward) ----------------
{
  const L = path.join(L4.DEEP4, "learn");
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(L, f), "utf8"));
  const res = {};
  for (const seg of ["design", "confirm"]) for (const m of ["EN", "M4", "M3", "M3c", "TREE"]) {
    const R = rd(`wf-${seg}/run-xs30-${m}.json`), rc = rd(`wf-${seg}/recs-xs30-${m}.json`).recs;
    const byM = group(rc, (x) => x.month);
    res[`${seg}.${m}`] = { months: [...byM].sort().map(([mo, xs]) => ({ month: mo, n: xs.length, selectedShare: r4(xs.filter((x) => x.sel).length / xs.length), meanPred: r6(mean(xs.map((x) => x.p))), predQ80: r6(quantile(xs.map((x) => x.p), 0.8)) })),
      models: (R.models || []).map((x) => ({ month: x.month, trainEvents: x.trainEvents, lambda: x.lambda, cvDefaulted: x.cvDefaulted, thr: r6(x.thr) })) };
  }
  out.item6 = res;
  console.log("item6", JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.months.map((m) => `${m.month}:${m.selectedShare}`).join(" ") + " | lambda " + v.models.map((x) => JSON.stringify(x.lambda) + (x.cvDefaulted ? "(def)" : "")).join(",")]))));
}
// ---------------- item 7: execution, overlap, independence, cost tiers ----------------
{
  const L = path.join(L4.DEEP4, "learn"), B = path.join(L4.DEEP4, "behavior");
  const res = {};
  for (const seg of ["design", "confirm"]) {
    const S = JSON.parse(fs.readFileSync(path.join(L, `strategies-${seg}.json`), "utf8")).strategies;
    for (const id of ["S0", "S1", "S2", "S3"]) { const m = S[id]?.metrics; if (!m?.n) continue;
      res[`learn.${seg}.${id}`] = { nAll: m.nAll, nIndependent: m.n, issuers: m.issuers, months: m.months, monthTable: m.monthTable.map((x) => `${x.month}:${r4(x.mean)}(${x.n})`).join(" "), portfolio: { tradesAfterCap: m.portfolio.tradesAfterCap, cashReturn: m.portfolio.cash?.totalReturn, spy: m.portfolio.cash?.spy?.totalReturn, maxDD: m.portfolio.cash?.maxDrawdown, exposure: m.portfolio.exposureMean, timeInMarket: m.portfolio.timeInMarket, skipped: m.portfolio.simple?.skipped } }; }
    const tr = fs.readFileSync(path.join(L, `strategy-${seg}-S0-trades.csv`), "utf8").trim().split("\n"); const h = tr[0].split(","); const ci = h.indexOf("costPerSide"), ei = h.indexOf("entryDate");
    const costs = tr.slice(1).map((l) => Number(l.split(",")[ci])); const ent = tr.slice(1).map((l) => l.split(",")[ei]);
    res[`learn.${seg}.S0.costTiers`] = countBy(costs, (c) => `${Math.round(c * 1e4)}bps`);
    // concurrent open positions (all S0 trades, 30-day holds): max and mean overlapping on entry days
    res[`learn.${seg}.S0.entryDays`] = new Set(ent).size;
  }
  const bc = JSON.parse(fs.readFileSync(path.join(B, "confirm-results.json"), "utf8"));
  res["behavior.confirm.S0.all.portfolio"] = (({ pfReturn, pfSpy, pfMaxDD, exposure, timeInMarket, pfExcessVsSpy }) => ({ pfReturn, pfSpy, pfMaxDD, exposure, timeInMarket, pfExcessVsSpy }))(bc.strategies["behavior.S0.all"].headline);
  out.item7 = res;
  console.log("item7", JSON.stringify(res).slice(0, 2500));
}
out.elapsedSec = (Date.now() - t0) / 1000;
writeOut("a6-misc.json", out);
checkpoint("a6_misc", { elapsedSec: out.elapsedSec });
