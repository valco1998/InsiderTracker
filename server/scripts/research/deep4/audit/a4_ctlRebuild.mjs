// deep4/audit/a4_ctlRebuild.mjs — rebuild matched controls with the panel's own deep-2 matching code (panelLib / chart/common),
// varying ONLY the control-pool definition:
//   REPRO     : the panel's rule (no visible code-P mark within +-20 sessions)  -> must reproduce controls.json / controls-confirm.json
//   BACKONLY  : exclusion looks backward only (no visible mark in [j-20, j])     -> no condition on future filings in the window
//   PIT       : BACKONLY + the control symbol had a visible insider purchase before the control day (point-in-time universe)
// Pool rows are built only for control days < 2026-09-01; confirmation-control outcomes use bars through 2026-11-03 (as the panel).
// Also the late-window decomposition (B_xsNet30 - B_xsNet20) on the original controls. Tests registered in a0b_register.mjs.
//   node --max-old-space-size=12288 scripts/research/deep4/audit/a4_ctlRebuild.mjs
import fs from "node:fs";
import path from "node:path";
import { phaseA, L4, V, loadP, loadC, writeOut, checkpoint, recordOnce, mean, median, r4, r6, fin, group, countBy, isPrimaryPurchase, cstats, toCsv, outPath } from "./common.mjs";
import * as PL from "../panel/panelLib.mjs";
import { OUT_DIR } from "../../lib.mjs";

phaseA();
const t0 = Date.now();
const log = (...a) => console.log(`[A4 ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const P = loadP(["design", "confirm"]);
const C = loadC(["design", "confirm"]);
const secAll = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep2", "sec-rows.json"), "utf8"));
const SEC = L4.visible(secAll.rows, (r) => r.acceptedAt, "audit"); secAll.rows = null;
const Prows = SEC.filter((r) => r.code === "P");
const cik2sym = new Map(); for (const r of SEC) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, PL.symOf(r.ticker));
const markets = { design: PL.createMarket({ cutoff: L4.DESIGN_END }), confirmPool: PL.createMarket({ cutoff: L4.EXPOSED_START }), confirmOut: PL.createMarket({ cutoff: null }) };
// first visible purchase mark per symbol (session index on the common SPY calendar)
const firstMark = new Map();
{ const M = markets.confirmOut; for (const r of Prows) { const s = r.ticker ? PL.symOf(r.ticker) : cik2sym.get(r.cik); if (!s) continue; const ms = []; const ad = String(r.acceptedAt || "").slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) ms.push(M.firstOnOrAfter(ad)); if (/^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "")) ms.push(M.firstOnOrAfter(r.tradeDate)); for (const m of ms) if (!firstMark.has(s) || m < firstMark.get(s)) firstMark.set(s, m); } }
const segPlan = [{ seg: "design", Mpool: markets.design, Mout: markets.design }, { seg: "confirm", Mpool: markets.confirmPool, Mout: markets.confirmOut }];
const variants = { REPRO: { before: 20, after: 20, pit: false }, BACKONLY: { before: 20, after: 0, pit: false }, PIT: { before: 20, after: 0, pit: true } };
const results = {}, diag = {};
const md = (rows, val, ctls, B = 1000) => { const m = V.matchedDiff(rows.map((r) => ({ issuer: r.cik, x: val(r), controls: ctls(r) })), { value: "x", controls: "controls", cluster: "issuer", B, seed: 7 });
  return m.n ? { n: m.n, clusters: m.clusters, eventMean: r6(m.eventMean), controlMean: r6(m.controlMean), estimate: r6(m.diff), ci: m.ci.map(r6), t: r4(m.t), p: r4(m.p) } : { n: 0 }; };
for (const { seg, Mpool, Mout } of segPlan) {
  const E = P.rows.filter((r) => r.segment === seg && isPrimaryPurchase(r) && r.featOk === 1 && fin(r.B_xsNet30) != null);
  const origCtl = (r) => C.of(r.key).filter((c) => fin(c.B_xsNet30) != null).map((c) => c.B_xsNet30);
  results[seg] = { events: E.length, original: md(E, (r) => r.B_xsNet30, origCtl) };
  for (const [vName, v] of Object.entries(variants)) {
    const blocked = PL.purchaseBlocks(Mpool, Prows, cik2sym, { before: v.before, after: v.after });
    const pool = PL.buildPool(Mpool, blocked, { visibleUntil: null, segOf: (d) => L4.segmentOf(d) });
    let segPool = pool.rows.filter((r) => r.per === seg);
    if (v.pit) segPool = segPool.filter((r) => firstMark.has(r.s) && firstMark.get(r.s) < r.j);
    PL.prepareVectors(segPool, PL.MATCH_FEATURES, "fv");
    const scales = PL.robustScales(segPool, PL.MATCH_FEATURES);
    const idx = PL.indexPool(segPool);
    const ctlVals = new Map(), outCache = new Map();
    let same = 0, cmpN = 0;
    for (const e of E) {
      const ev = { m: e.entryMonth, tier: e.tier, per: seg, r5: e.r5, r20: e.r20, dd60: e.dHi60, vol20: e.vol20, dv20: e.dv20, gapPrev: e.gapPrev };
      const ms = PL.nearest(ev, idx, scales, pool.syms.length, { K: 10, filter: (r) => r.s !== e.sym });
      const vals = [];
      for (const m of ms) {
        const k = `${m.r.s}|${m.r.D}`;
        if (!outCache.has(k)) { const A = Mout.aligned(m.r.s); const mf = PL.marketFeatures(Mout, A, m.r.j - 1); const o = mf ? PL.outcomeB(Mout, A, m.r.j, mf.costBps) : null; outCache.set(k, { x30: o?.B_xsNet30 ?? null, x20: o?.B_xsNet20 ?? null }); }
        const o = outCache.get(k); if (fin(o.x30) != null) vals.push(o.x30);
      }
      ctlVals.set(e.key, vals);
      if (vName === "REPRO") { const orig = new Set(C.byEvent[e.key]?.map(([k]) => k) || []); cmpN++; if (ms.length === orig.size && ms.every((m) => orig.has(`${m.r.s}|${m.r.D}`))) same++; }
    }
    const res = md(E, (r) => r.B_xsNet30, (r) => ctlVals.get(r.key) || []);
    res.poolRows = segPool.length; res.poolSymbols = new Set(segPool.map((r) => r.s)).size;
    if (vName === "REPRO") res.reproduction = { events: cmpN, identicalControlSets: same, share: r4(same / cmpN) };
    results[seg][vName] = res;
    if (vName !== "REPRO") recordOnce(`audit4.ctl.${vName === "BACKONLY" ? "rebuildBackOnly" : "rebuildPIT"}.${seg}`, { segment: seg, ...res });
    // month table of the difference
    diag[`${seg}.${vName}.byMonth`] = cstats(E.map((r) => { const cs = ctlVals.get(r.key) || []; return cs.length ? { issuer: r.cik, month: r.month, x: r.B_xsNet30 - mean(cs) } : null; }).filter(Boolean)).months;
    log(`${seg} ${vName}: pool ${segPool.length} rows; diff ${res.estimate} t ${res.t} (events ${res.eventMean}, controls ${res.controlMean})${res.reproduction ? ` repro ${res.reproduction.share}` : ""}`);
  }
  // late-window decomposition on the ORIGINAL panel controls: (B_xsNet30 - B_xsNet20)
  const late = (o) => (fin(o.B_xsNet30) != null && fin(o.B_xsNet20) != null ? o.B_xsNet30 - o.B_xsNet20 : null);
  const El = E.filter((r) => late(r) != null);
  const lw = md(El, late, (r) => C.of(r.key).map(late).filter((x) => x != null));
  recordOnce(`audit4.ctl.lateWindow.${seg}`, { segment: seg, ...lw });
  results[seg].lateWindow = lw;
  results[seg].earlyWindow20 = md(El, (r) => r.B_xsNet20, (r) => C.of(r.key).map((c) => c.B_xsNet20).filter((x) => fin(x) != null), 300);
  log(`${seg} late window (20->30d) diff ${lw.estimate} t ${lw.t}`);
}
writeOut("a4-ctl-rebuild.json", { builtAt: new Date().toISOString(), note: "pool rows < 2026-09-01 only; matching = panelLib/deep-2 nearest (K=10, month x tier x segment, one stock-day per symbol, never the event's symbol)", results, diag, elapsedSec: (Date.now() - t0) / 1000 });
checkpoint("a4_ctlRebuild", { elapsedSec: (Date.now() - t0) / 1000 });
console.log(JSON.stringify(results, null, 1));
