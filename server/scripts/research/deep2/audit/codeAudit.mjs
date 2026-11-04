// deep2/audit/codeAudit.mjs — auditor (agent "audit"): quantitative evidence behind the code review for look-ahead,
// leakage, costs and embargo. Read-only, cache-only, holdout LOCKED (refuses to run with DEEP2_HOLDOUT set).
//   node scripts/research/deep2/audit/codeAudit.mjs
// Output: .cache/research/deep2/audit/code-audit-evidence.json (numbers); code-audit.json is assembled by
// writeCodeAudit.mjs from these numbers plus the file:line findings.
import fs from "node:fs";
import path from "node:path";
import * as L from "../lib2.mjs";
import { writeOut, readCsv, num, mean, median, r4, countBy, groupBy, sha256File, FROZEN_SHA } from "./auditLib.mjs";

if (process.env.DEEP2_HOLDOUT) throw new Error("codeAudit.mjs must run with the holdout locked (unset DEEP2_HOLDOUT)");
const ev = {};
ev.frozenRulesSha256Ok = sha256File(L.FROZEN_FILE) === FROZEN_SHA;

const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const T3 = (e) => (e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5;
const E = L.loadEvents({ includeUnpriced: true }); // lib2 hides the holdout
const EP = E.filter((e) => e.priceStatus === "ok");
const bars = L.loadBars();
const spy = bars.get("SPY");
const stageA = JSON.parse(fs.readFileSync(path.join(L.DEEP1, "stageA.json"), "utf8"));
const COMPLETE = stageA.completeThrough;
const suspects = new Set(stageA.prices.suspectSymbols || []);

// ---- 0. holdout lock ----
ev.holdoutLock = { eventsVisible: E.length, priced: EP.length, maxPublishedAt: E.reduce((m, e) => (e.publishedAt > m ? e.publishedAt : m), ""),
  anyHoldoutVisible: E.some((e) => L.periodOf(e) === "holdout"), completeThrough: COMPLETE };

// ---- 1. event construction: rows later superseded by amendments are dropped (lib.mjs:76 / deep/features.mjs:23) ----
const sec = await L.loadSecRows();
const P = sec.rows.filter((r) => r.code === "P");
const isCeoCfoText = (role) => /\b(chief executive officer|principal executive officer|ceo|chief financial officer|principal financial officer|cfo)\b/i.test(String(role || ""));
const byAcc = groupBy(P, (r) => r.acc);
const supersededFilings = [];
for (const [acc, rs] of byAcc) {
  if (!rs.every((r) => r.amend === "superseded")) continue;
  const acceptedAt = rs[0].acceptedAt;
  if (acceptedAt >= L.HOLDOUT_START) continue; // count pre-holdout filings only
  const value = rs.reduce((a, r) => a + (r.priceCheck === "anomaly" ? 0 : r.value || 0), 0);
  supersededFilings.push({ acc, acceptedAt, period: acceptedAt < L.DISCOVER_END ? "discover" : "confirm", t3Like: isCeoCfoText(rs[0].role) && rs[0].own === "D" && rs[0].ctx === "open_market" && value >= 2.5e5 });
}
const preHoldoutPFilings = [...byAcc.values()].filter((rs) => rs[0].acceptedAt < L.HOLDOUT_START).length;
ev.amendmentSelection = {
  pRows: P.length, pRowsByAmendStatus: countBy(P, (r) => r.amend),
  preHoldoutPFilings, filingsWhoseRowsAreAllSupersededLater: supersededFilings.length, shareOfFilings: r4(supersededFilings.length / preHoldoutPFilings),
  byPeriod: countBy(supersededFilings, (f) => f.period), t3LikeAmongThem: supersededFilings.filter((f) => f.t3Like).length,
  stageCEventsFromForm4A: E.filter((e) => e.formType === "4/A").length, t3EventsFromForm4A: E.filter((e) => T3(e) && e.formType === "4/A").length,
  t3Events: E.filter(T3).length,
};

// ---- 2. classifier trade-date bar on same-day intraday filings (behavior/classify.mjs:66-67) ----
const sameDayRth = E.filter((e) => e.publishedAt.slice(0, 10) === e.tradeDate && e.publishedAt.slice(11) >= "09:30:00" && e.publishedAt.slice(11) < "16:00:00");
ev.classifierTradeDateBar = { eventsPublishedIntradayOnTradeDate: sameDayRth.length, ofWhichEntryAfterPublicationDay: sameDayRth.filter((e) => e.entryDate > e.tradeDate).length,
  note: "classify.mjs:67 discards the trade-date bar only when bar date >= entry date; for next-open entries the trade-date bar is complete before the entry open, so no leak. It would leak only for a same-session MOC entry, which no behaviour test uses." };

// ---- 3. new-listing window: events published before the symbol's first bar (behavior/common.mjs:69-70) ----
const firstBar = (s) => bars.get(sym(s))?.arr[0]?.d || null;
const pubBeforeFirstBar = EP.filter((e) => { const f = firstBar(e.ticker); return f && e.publishedAt.slice(0, 10) < f; });
ev.newListingLogic = { pricedEventsPublishedBeforeFirstBar: pubBeforeFirstBar.length, examples: pubBeforeFirstBar.slice(0, 5).map((e) => [e.ticker, e.publishedAt, firstBar(e.ticker)]) };

// ---- 4. matched controls: future-filing exclusion, sign of the bias (chart/common.mjs:126-143) ----
const mc = JSON.parse(fs.readFileSync(path.join(L.DEEP2, "chart", "mc-table.json"), "utf8"));
const pick = (design, outcome) => mc.find((r) => r.design === design && r.subset === "all" && r.outcome === outcome);
ev.matchedControls = {
  allEvents: ["x0", "x1", "x3", "x5"].map((o) => ({ outcome: o, ...Object.fromEntries(["primary", "ext", "sameDate", "rich"].map((d) => { const r = pick(d, o); return [d, r ? { ctl: r.controlMean, diff: r.diffMean, diffMedian: r.diffMedian, t: r.t } : null]; })) })),
  reading: "ext removes control days followed by a P filing within 60 sessions (primary: 20). Control means rise when those days are removed (x5: -0.79% -> -0.53%), so days that precede a future purchase have lower forward returns. Any exclusion that conditions on future filings therefore raises the control mean and shrinks the event-control difference (conservative); the purchase-issuer-only universe works the other way (controls tilted towards stocks that will fall before insiders buy).",
};

// ---- 5. after-hours 'share already priced' (execution/summarize.mjs:55, run.mjs:173-174) ----
const ahRows = readCsv(path.join(L.DEEP2, "execution", "events-trackA-afterHours-confirm.csv"));
function pricedShare(rows) {
  const ok = rows.filter((r) => r.status_L1 === "ok" && r.entryVsClose_L1 !== "" && r.nextOpenVsClose !== "");
  const a = ok.map((r) => num(r.entryVsClose_L1)), b = ok.map((r) => num(r.nextOpenVsClose)), sx = ok.map((r) => num(r.excessToOpen_L1));
  const big = ok.filter((r) => Math.abs(num(r.nextOpenVsClose)) >= 0.02);
  const ratios = big.map((r) => num(r.entryVsClose_L1) / num(r.nextOpenVsClose));
  const srt = [...ok].sort((x, y) => num(x.nextOpenVsClose) - num(y.nextOpenVsClose)); const k = Math.floor(0.05 * srt.length); const trim = srt.slice(k, srt.length - k);
  const common = ok.filter((r) => ["L5", "L15", "L30"].every((l) => r[`status_${l}`] === "ok"));
  return { n: ok.length, meanEntryVsClose: r4(mean(a)), meanNextOpenVsClose: r4(mean(b)), ratioOfMeans_asReported: r4(mean(a) / mean(b)),
    ratioOfMedians: r4(median(a) / median(b)), trimmed5pctRatioOfMeans: r4(mean(trim.map((r) => num(r.entryVsClose_L1))) / mean(trim.map((r) => num(r.nextOpenVsClose)))),
    perEventRatio_absGapGe2pct: { n: big.length, median: r4(median(ratios)), share0to1: r4(ratios.filter((x) => x >= 0 && x <= 1).length / ratios.length), shareAbove1_overshoot: r4(ratios.filter((x) => x > 1).length / ratios.length), shareNegative: r4(ratios.filter((x) => x < 0).length / ratios.length) },
    commonSubsample: { n: common.length, ratioOfMeans: r4(mean(common.map((r) => num(r.entryVsClose_L1))) / mean(common.map((r) => num(r.nextOpenVsClose)))) },
    meanCaptureToOpenExSpy: r4(mean(sx)) };
}
ev.afterHoursPricedShare = {};
for (const per of ["discover", "confirm"]) for (const [g, f] of [["pooled", () => true], ["S1_T3", (r) => r.stratum === "S1_ceoCfoOM250k"]]) ev.afterHoursPricedShare[`${per}|${g}`] = pricedShare(ahRows.filter((r) => r.period === per && f(r)));

// ---- 6. split-adjusted price level (deep/features.mjs:133 priceLevel; lib.mjs:222 priceVsPrevClose) ----
function asTradedFactor(e) {
  const s = bars.get(sym(e.ticker)); if (!s || !(e.price > 0)) return 1;
  let i = s.idx.get(e.tradeDate); if (i == null) i = L.idxBefore(s, e.tradeDate); if (i < 0) return 1;
  const ratio = s.arr[i].c / e.price; return ratio > 1.8 || ratio < 0.55 ? ratio : 1;
}
const lvl = (es) => { const xs = es.map((e) => ({ e, f: asTradedFactor(e) })); return { n: es.length, splitInferred: xs.filter((x) => x.f !== 1).length,
  adjustedGe5ButAsTradedLt5: xs.filter((x) => x.e.priceLevel >= 5 && x.e.priceLevel / x.f < 5).length, entryAsTradedLt5: xs.filter((x) => x.e.entryPrice / x.f < 5).length, entryAsTradedLt1: xs.filter((x) => x.e.entryPrice / x.f < 1).length }; };
ev.priceLevel = { allPriced: lvl(EP), t3: lvl(EP.filter(T3)), usedByDeep2: "only execution/validate.mjs:75-76 (diagnostic count); no deep-2 test, trigger or frozen rule conditions on priceLevel. Deep-1 tested priceLevel quintiles (deepResearch.mjs:197) — 15 of the 2,523 tests." };

// ---- 7. costs: stage-C net convention re-derived from bars for T3 (lib.mjs:240-254) ----
let checked = 0, mismatch = 0; const costTiers = countBy(EP.filter(T3), (e) => e.costBpsPerSide);
for (const e of EP.filter(T3)) for (const N of [3, 5]) {
  const h = e.h?.[N]; if (h?.status !== "ok") continue;
  const s = bars.get(sym(e.ticker)); const eb = s?.arr[s.idx.get(e.entryDate)], xb = s?.arr[s.idx.get(h.exitDate)];
  const se = spy.arr[spy.idx.get(e.entryDate)], sx = spy.arr[spy.idx.get(h.exitDate)];
  if (!eb || !xb || !se || !sx) continue; checked++;
  const c = e.costBpsPerSide / 1e4, net = (xb.c * (1 - c)) / (eb.o * (1 + c)) - 1, x = net - (sx.c / se.o - 1);
  if (Math.abs(r4(x) - h.excessNet) > 1.01e-4 || Math.abs(eb.o - e.entryPrice) > 1e-9) mismatch++;
}
ev.costs = { t3CostTierBpsPerSide: costTiers, t3MeanRoundTripBps: Math.round(2 * mean(EP.filter(T3).map((e) => e.costBpsPerSide))),
  stageCNetRederived: { checked, mismatch }, spyCharged: false,
  afterHoursCostAssumptions: { deep1AfterHoursStudy: "50/100/200 bps per side scenarios (afterHoursStudy.mjs:9)", behavior: "entry max(50 bps, 2x tier), exit tier (afterHoursBehavior.mjs:29)", executionF3: "25 bps per side primary, 50 stress (frozen-rules.json F3)" } };

// ---- 8. embargo + holdout scan of every deep-2 output (behavior, chart, execution) ----
const ends = { discover: L.DISCOVER_END, confirm: L.HOLDOUT_START };
const embargo = [];
for (const area of ["behavior", "chart", "execution"]) {
  const dir = path.join(L.DEEP2, area);
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f); if (fs.statSync(full).isDirectory()) continue;
    const rec = { file: `${area}/${f}` };
    if (f.endsWith(".csv")) {
      const rows = readCsv(full); rec.rows = rows.length;
      const pub = rows.map((r) => r.publishedAt).filter(Boolean); rec.maxPublishedAt = pub.reduce((m, x) => (x > m ? x : m), "") || null;
      rec.holdoutRows = pub.filter((x) => x >= L.HOLDOUT_START).length;
      let viol = 0, chk = 0;
      for (const r of rows) {
        const per = r.period || (r.publishedAt ? (r.publishedAt < L.DISCOVER_END ? "discover" : r.publishedAt < L.HOLDOUT_START ? "confirm" : "holdout") : null); if (!ends[per]) continue;
        const exits = [];
        for (const N of [2, 3, 4, 5]) if (r[`usable_${N}`] === "1") exits.push(r[`exitDate_${N}`]);
        if (r.exitDate) exits.push(r.exitDate);
        if (r.nextDate && r.status_L1 === "ok") exits.push(r.nextDate);
        if (f.includes("mooMoc") && r.entryDate) exits.push(r.entryDate);
        for (const x of exits) { if (!x) continue; chk++; if (x >= ends[per]) viol++; }
      }
      rec.exitChecks = chk; rec.embargoViolations = viol;
    } else if (f.endsWith(".json")) {
      const txt = fs.readFileSync(full, "utf8");
      rec.holdoutPublishedAtMentions = (txt.match(/"publishedAt":\s*"2026-(09|10|11)-/g) || []).length;
    } else continue;
    embargo.push(rec);
  }
}
ev.embargoScan = embargo;

// ---- 9. F3 'buyable size' invalidation uses AH volume AFTER the 1-minute fill (look-ahead) ----
const X = await import("../execution/execLib.mjs");
const f3opts = { entry: "ah", latencyMinutes: 1, exitSessions: "nextOpen", excludeSuspects: true, mooCutoff: "09:28:00", requireVolume: true };
const t3ah = EP.filter((e) => T3(e) && X.inAhPool(e));
const f3rows = (bps) => X.evaluate(t3ah, { ...f3opts, costModel: bps }).rows;
const st = (rows) => L.companyStats(rows.map((r) => ({ issuer: r.issuerCik, x: r.excessNet })));
ev.f3BuyableFilter = { t3AfterClosePool: t3ah.length, statusCounts: countBy(f3rows(25), (r) => r.status) };
for (const per of ["discover", "confirm"]) {
  const rows25 = f3rows(25).filter((r) => r.status === "ok" && X.periodOk(r, per));
  const keep = rows25.filter((r) => (r.ahBuyable15 ?? 0) >= 5000), drop = rows25.filter((r) => !((r.ahBuyable15 ?? 0) >= 5000));
  ev.f3BuyableFilter[per] = { all25bps: st(rows25), buyableGe5k_25bps: st(keep), buyableLt5k_25bps: st(drop),
    meanGrossExcess_keep: r4(mean(keep.map((r) => r.excess))), meanGrossExcess_drop: r4(mean(drop.map((r) => r.excess))) };
}

// ---- 10. execution traps on T3 (suspects from full-history bars; 09:28 cut-off; zero-volume bars; exits) ----
const t3 = EP.filter(T3);
const mooShift = t3.filter((e) => e.entryDate === e.publishedAt.slice(0, 10) && e.publishedAt.slice(11) > "09:27:00");
const zeroVol = (e, d) => { const s = bars.get(sym(e.ticker)); const b = s?.arr[s.idx.get(d)]; return b && !(b.v > 0); };
ev.t3Traps = {
  suspectSymbols: { listSize: suspects.size, t3EventsAffected: t3.filter((e) => suspects.has(sym(e.ticker))).length, note: "stageA suspect list is computed from bars through 2026-11-03 (look-ahead filter), but no pre-holdout T3 event is affected" },
  mooCutoffShifted: mooShift.map((e) => ({ ticker: e.ticker, publishedAt: e.publishedAt, entryDate: e.entryDate })),
  zeroVolume: { entry: t3.filter((e) => zeroVol(e, e.entryDate)).length, exitH3: t3.filter((e) => e.h?.[3]?.status === "ok" && zeroVol(e, e.h[3].exitDate)).length, exitH5: t3.filter((e) => e.h?.[5]?.status === "ok" && zeroVol(e, e.h[5].exitDate)).length },
  priceStatusAllT3: countBy(E.filter(T3), (e) => e.priceStatus),
  h3Status: countBy(t3, (e) => e.h?.[3]?.status), h5Status: countBy(t3, (e) => e.h?.[5]?.status),
};

// ---- 11. deep-1 overlap: T3 == deep-1 H22 (deepResearch.mjs:225), already evaluated on train/validation/test in deep 1 ----
const d1 = fs.readFileSync(path.join(L.DEEP1, "registry.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.name.startsWith("H22"));
ev.deep1Overlap = { h22TrainStats: d1.map((r) => ({ id: r.id, n: r.train.n, meanExcessNet: r.train.meanExcess, t: r.train.t, p: r.train.p, qAbn: r.train.qAbn })),
  note: "deepResearch.mjs:444 computed every pre-registered hypothesis (incl. H22 = T3) on the TEST split (published >= 2026-09-01) at 5/10/20 sessions and saved it in stageG.json; afterHoursStudy.mjs:99-100 saved the S1 (= T3 after-close) capture by split, incl. test. Those numbers were NOT read by the auditor before the holdout run." };

// ---- 12. deep-1 features mixing the RAW reported price with SPLIT-ADJUSTED bars (lib.mjs:222, deep/features.mjs:135-136) ----
// ratio = adjusted close on the trade date / reported price: > 1.8 means a LATER reverse split (adjusted history inflated),
// < 0.55 a later forward split. priceVsTradePrevClose / insiderPremium then encode a future corporate action.
{
  const rat = (e) => { const s = bars.get(sym(e.ticker)); if (!s || !(e.price > 0)) return null; let i = s.idx.get(e.tradeDate); if (i == null) i = L.idxBefore(s, e.tradeDate); return i < 0 ? null : s.arr[i].c / e.price; };
  const grp = { futureReverseSplit: [], futureForwardSplit: [], noSplit: [] };
  for (const e of EP) { const r = rat(e); if (r == null) continue; (r > 1.8 ? grp.futureReverseSplit : r < 0.55 ? grp.futureForwardSplit : grp.noSplit).push(e); }
  const out = (es, H) => { const xs = es.filter((e) => L.usable(e, H, "discover")).map((e) => e.h[H].excessNet); return { n: xs.length, mean: r4(mean(xs)), median: r4(median(xs)) }; };
  const leaf = (e) => e.spyRet20 != null && e.spyRet20 <= 0.0391 && e.gaps20 > 0; // deep-1 tree leaf minus its priceVsTradePrevClose condition
  const inLeaf = EP.filter(leaf), cut = inLeaf.filter((e) => !(e.priceVsTradePrevClose > -0.0299));
  ev.deep1SplitContamination = {
    counts: Object.fromEntries(Object.entries(grp).map(([k, v]) => [k, v.length])),
    discoveryOutcomes: Object.fromEntries(Object.entries(grp).map(([k, v]) => [k, { h5: out(v, 5), h20: out(v, 20) }])),
    medianPriceVsTradePrevClose: Object.fromEntries(Object.entries(grp).map(([k, v]) => [k, r4(median(v.map((e) => e.priceVsTradePrevClose).filter(Number.isFinite)))])),
    deep1TreeLeaf: { leafEventsIgnoringPriceCondition: inLeaf.length, removedByPriceVsTradePrevCloseLe_m0299: cut.length, ofWhichFutureReverseSplit: cut.filter((e) => (rat(e) ?? 1) > 1.8).length,
      discoveryH20_removed: out(cut, 20), discoveryH20_kept: out(inLeaf.filter((e) => e.priceVsTradePrevClose > -0.0299), 20) },
    usedInDeep2: "no deep-2 script reads priceVsTradePrevClose, priceVsPrevClose or insiderPremium (grep); deep-2 compares decisionClose only with split-adjusted prices",
  };
}

writeOut("code-audit-evidence.json", { generatedAt: new Date().toISOString(), ...ev });
console.log(JSON.stringify(ev, (k, v) => (k === "embargoScan" ? v.filter((x) => x.holdoutRows || x.embargoViolations || x.holdoutPublishedAtMentions) : v), 1));
console.log("embargo files scanned:", embargo.length, "rows checked:", embargo.reduce((a, r) => a + (r.exitChecks || 0), 0));
