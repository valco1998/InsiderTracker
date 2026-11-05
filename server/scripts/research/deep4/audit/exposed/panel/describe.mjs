// deep4/panel/describe.mjs — phase-2 DESCRIPTIVE tables on the design segment (no hypothesis tests, no p-values).
//   node --max-old-space-size=6144 scripts/research/deep4/panel/describe.mjs
// Universes (one row per dupKey: isPrimary = 1):
//   om       = open-market (class v2), valued, priced        ← primary universe
//   all      = every priced filing (all classes)
//   nonOm    = priced, class != om
// Outcome B by decision month and horizon: n with outcome, issuers, mean / median gross, net excess vs SPY (tier ×1 and ×2),
// SPY, hit rates +5…+30 within the horizon, MFE / MAE medians, limit +10% mean, matched-control means and event − control.
// Outcome A by decision month: insider hypothetical mark-to-market (unrealised), same summaries.
// Coverage and censoring counts; time to target (sessions / calendar days among touches within 30 days).
import { loadPanel, loadControls } from "./data.mjs";
import * as PL from "./panelLib.mjs";

const { mean, median, cnt, r6, CAL_H, SESS_N, TARGETS } = PL;
const P = loadPanel({ agent: "panel", segments: [process.env.AUDIT_DESCRIBE_SEGMENT || "design"] }); // AUDIT COPY (T3)
const C = loadControls({ agent: "panel", segments: [process.env.AUDIT_DESCRIBE_SEGMENT || "design"] }); // AUDIT COPY (T3)
const rows = P.rows;
const U = {
  om: (r) => r.primary === 1 && r.isPrimary === 1,
  all: (r) => r.priced === 1 && r.isPrimary === 1,
  nonOm: (r) => r.priced === 1 && r.isPrimary === 1 && r.cls !== "om",
};
const num = (xs) => xs.filter((x) => x != null && Number.isFinite(x));
const m6 = (xs) => r6(mean(num(xs))), md6 = (xs) => r6(median(num(xs)));
const rate = (xs) => { const v = num(xs); return v.length ? r6(mean(v)) : null; };
// control mean of any B field for one event (mean over its matched controls with a value)
const ctlMean = (r, F) => { const v = num(C.of(r.key).map((c) => c[F])); return v.length ? mean(v) : null; };

function bBlock(rs, H) {
  const ok = rs.filter((r) => r[`B_st${H}`] === "ok");
  const o = { n: ok.length, issuers: new Set(ok.map((r) => r.cik)).size, meanGross: m6(ok.map((r) => r[`B_gross${H}`])), medianGross: md6(ok.map((r) => r[`B_gross${H}`])),
    meanSpy: m6(ok.map((r) => r[`B_spy${H}`])), meanXsNet: m6(ok.map((r) => r[`B_xsNet${H}`])), medianXsNet: md6(ok.map((r) => r[`B_xsNet${H}`])), meanXsNet2x: m6(ok.map((r) => r[`B_xsNet2x${H}`])),
    winVsSpy: rate(ok.map((r) => (r[`B_xsNet${H}`] > 0 ? 1 : 0))), mfeMedian: md6(ok.map((r) => r[`B_mfe${H}`])), maeMedian: md6(ok.map((r) => r[`B_mae${H}`])),
    lim10Mean: m6(ok.map((r) => r[`B_lim10_${H}`])), lim10FillRate: rate(ok.map((r) => r[`B_lim10fill${H}`])) };
  for (const X of TARGETS) o[`hit${X}`] = rate(ok.map((r) => r[`B_hit${X}_${H}`]));
  // matched controls (same horizon, same fields)
  const wc = ok.filter((r) => r.C_n > 0);
  const evX = [], ctX = [], evH = [], ctH = [];
  for (const r of wc) { const cx = ctlMean(r, `B_xsNet${H}`), ch = ctlMean(r, `B_hit10_${H}`); if (cx != null) { evX.push(r[`B_xsNet${H}`]); ctX.push(cx); } if (ch != null) { evH.push(r[`B_hit10_${H}`]); ctH.push(ch); } }
  o.ctl = { n: evX.length, eventXsNet: m6(evX), controlXsNet: m6(ctX), diffXsNet: evX.length ? r6(mean(evX) - mean(ctX)) : null, eventHit10: rate(evH), controlHit10: rate(ctH), diffHit10: evH.length ? r6(mean(evH) - mean(ctH)) : null };
  for (const X of [5, 20]) { const e = [], c = []; for (const r of wc) { const cm = ctlMean(r, `B_hit${X}_${H}`); if (cm != null) { e.push(r[`B_hit${X}_${H}`]); c.push(cm); } } o.ctl[`eventHit${X}`] = rate(e); o.ctl[`controlHit${X}`] = rate(c); }
  return o;
}
function ttBlock(rs) {
  const o = {};
  for (const X of TARGETS) {
    const obs = rs.filter((r) => r[`B_tt${X}obs`] != null);
    const hit = obs.filter((r) => r[`B_tt${X}obs`] === 1);
    o[`+${X}`] = { windowComplete: obs.length, touched30d: hit.length, rate: obs.length ? r6(hit.length / obs.length) : null, medianSessions: md6(hit.map((r) => r[`B_tt${X}s`])), medianCalDays: md6(hit.map((r) => r[`B_tt${X}d`])),
      within0: obs.length ? r6(hit.filter((r) => r[`B_tt${X}s`] === 0).length / obs.length) : null };
  }
  return o;
}
function aBlock(rs, H) {
  const ok = rs.filter((r) => r.A_status === "ok" && r[`A_st${H}`] === "ok");
  const o = { n: ok.length, issuers: new Set(ok.map((r) => r.cik)).size, meanRet: m6(ok.map((r) => r[`A_ret${H}`])), medianRet: md6(ok.map((r) => r[`A_ret${H}`])), meanXs: m6(ok.map((r) => r[`A_xs${H}`])), medianXs: md6(ok.map((r) => r[`A_xs${H}`])),
    winVsSpy: rate(ok.map((r) => (r[`A_xs${H}`] > 0 ? 1 : 0))), adjInferredShare: rate(ok.map((r) => r.fut_adjInferred)) };
  if (H === 30) { o.mfeMedian = md6(ok.map((r) => r.A_mfe30)); o.maeMedian = md6(ok.map((r) => r.A_mae30)); for (const X of TARGETS) { o[`hit${X}`] = rate(ok.map((r) => r[`A_hit${X}_30`])); o[`tt${X}MedianSessions`] = md6(ok.map((r) => r[`A_tt${X}s`])); } }
  return o;
}
const sBlock = (rs) => Object.fromEntries(SESS_N.map((N) => { const ok = rs.filter((r) => r[`B_sSt${N}`] === "ok"); const w = ok.filter((r) => r.C_n > 0);
  return [N, { n: ok.length, meanXsNet: m6(ok.map((r) => r[`B_sXsNet${N}`])), medianXsNet: md6(ok.map((r) => r[`B_sXsNet${N}`])), meanXsNet2x: m6(ok.map((r) => r[`B_sXsNet2x${N}`])), controlXsNet: m6(w.map((r) => r[`C_sXsNet${N}`])), eventXsNetWithCtl: m6(w.map((r) => r[`B_sXsNet${N}`])) }]; }));

const months = [...new Set(rows.map((r) => r.month))].sort();
const out = { builtAt: new Date().toISOString(), segment: "design", note: "descriptive only: no hypothesis tests or p-values; one row per dupKey (isPrimary); outcomes past 2026-06-15 are embargoed", universes: {} };
for (const [u, f] of Object.entries(U)) {
  const rs = rows.filter(f);
  const block = { n: rs.length, issuers: new Set(rs.map((r) => r.cik)).size, persons: new Set(rs.map((r) => r.person)).size, overall: { B: {}, A: {}, sessions: sBlock(rs), timeToTarget: ttBlock(rs) }, byMonth: {} };
  for (const H of CAL_H) { block.overall.B[H] = bBlock(rs, H); block.overall.A[H] = aBlock(rs, H); }
  for (const m of months) {
    const ms = rs.filter((r) => r.month === m);
    const b = { n: ms.length, B: {}, A: {}, censoring: {} };
    for (const H of CAL_H) { b.B[H] = bBlock(ms, H); b.A[H] = aBlock(ms, H); b.censoring[H] = cnt(ms, (r) => r[`B_st${H}`]); }
    b.timeToTarget = ttBlock(ms);
    block.byMonth[m] = b;
  }
  out.universes[u] = block;
}
// coverage (all design filings, not only isPrimary)
out.coverage = {
  filings: rows.length, priced: rows.filter((r) => r.priced).length, primary: rows.filter((r) => r.primary).length, primaryDeduped: rows.filter(U.om).length,
  priceStatus: cnt(rows, (r) => r.priceStatus), priceStatusByClass: Object.fromEntries(["om", "entity", "offering", "unknown"].map((c) => [c, cnt(rows.filter((r) => r.cls === c), (r) => r.priceStatus)])),
  unvalued: rows.filter((r) => !r.valued).length, unvaluedPriced: rows.filter((r) => !r.valued && r.priced).length,
  B_status: cnt(rows, (r) => r.B_status), A_status: cnt(rows, (r) => r.A_status),
  B_horizonStatus: Object.fromEntries(CAL_H.map((H) => [H, cnt(rows.filter((r) => r.priced), (r) => r[`B_st${H}`])])), A_horizonStatus: Object.fromEntries(CAL_H.map((H) => [H, cnt(rows.filter((r) => r.A_status === "ok"), (r) => r[`A_st${H}`])])),
  adjInferred: cnt(rows.filter((r) => r.priced), (r) => r.fut_adjInferred), featOk: cnt(rows.filter((r) => r.priced), (r) => r.featOk), withControls: rows.filter((r) => r.C_n > 0).length,
  histSessionsAtDecision: { p10: r6(PL.quantile(rows.filter((r) => r.priced).map((r) => r.histSessions), 0.1)), median: r6(PL.quantile(rows.filter((r) => r.priced).map((r) => r.histSessions), 0.5)), win252Full: rows.filter((r) => r.win252 === 252).length },
  dupGroups: { filingsInGroups: rows.filter((r) => r.dupSize > 1).length, groups: new Set(rows.filter((r) => r.dupSize > 1).map((r) => r.dupKey)).size },
  amendmentRule: "4/A re-reports of held originals dropped (see build-summary.json); superseded originals kept",
  ctxTruncated30: rows.filter((r) => r.ctxTrunc30).length, regime: cnt(rows.filter((r) => r.priced), (r) => r.regime),
};
PL.writePretty("describe-design.json", out);
// flat CSVs: B by month × horizon, A by month × horizon (om universe and all)
const bCsv = [], aCsv = [];
for (const u of ["om", "all"]) for (const m of ["ALL", ...months]) for (const H of CAL_H) {
  const b = m === "ALL" ? out.universes[u].overall.B[H] : out.universes[u].byMonth[m].B[H], a = m === "ALL" ? out.universes[u].overall.A[H] : out.universes[u].byMonth[m].A[H];
  bCsv.push({ universe: u, month: m, H, n: b.n, issuers: b.issuers, meanGross: b.meanGross, meanSpy: b.meanSpy, meanXsNet: b.meanXsNet, medianXsNet: b.medianXsNet, meanXsNet2x: b.meanXsNet2x, winVsSpy: b.winVsSpy,
    hit5: b.hit5, hit10: b.hit10, hit15: b.hit15, hit20: b.hit20, hit30: b.hit30, mfeMedian: b.mfeMedian, maeMedian: b.maeMedian, lim10Mean: b.lim10Mean, lim10FillRate: b.lim10FillRate,
    ctlN: b.ctl.n, ctlXsNet: b.ctl.controlXsNet, diffXsNet: b.ctl.diffXsNet, ctlHit10: b.ctl.controlHit10, diffHit10: b.ctl.diffHit10 });
  aCsv.push({ universe: u, month: m, H, n: a.n, issuers: a.issuers, meanRet: a.meanRet, medianRet: a.medianRet, meanXs: a.meanXs, medianXs: a.medianXs, winVsSpy: a.winVsSpy, hit10_30d: a.hit10 ?? null, mfe30Median: a.mfeMedian ?? null, mae30Median: a.maeMedian ?? null });
}
PL.writeOut("describe-B-by-month.csv", PL.toCsv(bCsv, Object.keys(bCsv[0])));
PL.writeOut("describe-A-by-month.csv", PL.toCsv(aCsv, Object.keys(aCsv[0])));
PL.checkpoint("describe", { file: "describe-design.json" });
// compact console view
const pc = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}`);
for (const H of [5, 30]) {
  console.log(`\nB (om universe), H=${H}d: month n | gross | SPY | xsNet x1 | median | x2 | win | hit5/10/20/30 | MFE/MAE med | lim10 | ctl xsNet | diff | ctl hit10 | diff hit10`);
  for (const m of ["ALL", ...months]) { const b = m === "ALL" ? out.universes.om.overall.B[H] : out.universes.om.byMonth[m].B[H];
    console.log(`${m} ${b.n} | ${pc(b.meanGross)} | ${pc(b.meanSpy)} | ${pc(b.meanXsNet)} | ${pc(b.medianXsNet)} | ${pc(b.meanXsNet2x)} | ${pc(b.winVsSpy)} | ${pc(b.hit5)}/${pc(b.hit10)}/${pc(b.hit20)}/${pc(b.hit30)} | ${pc(b.mfeMedian)}/${pc(b.maeMedian)} | ${pc(b.lim10Mean)} | ${pc(b.ctl.controlXsNet)} | ${pc(b.ctl.diffXsNet)} | ${pc(b.ctl.controlHit10)} | ${pc(b.ctl.diffHit10)}`); }
}
for (const H of [5, 30]) {
  console.log(`\nA (om universe, insider hypothetical), H=${H}d: month n | mean ret | median | xs | win`);
  for (const m of ["ALL", ...months]) { const a = m === "ALL" ? out.universes.om.overall.A[H] : out.universes.om.byMonth[m].A[H]; console.log(`${m} ${a.n} | ${pc(a.meanRet)} | ${pc(a.medianRet)} | ${pc(a.meanXs)} | ${pc(a.winVsSpy)}${H === 30 ? ` | hit10 ${pc(a.hit10)} MFE ${pc(a.mfeMedian)} MAE ${pc(a.maeMedian)}` : ""}`); }
}
console.log("\nall-classes overall B:", JSON.stringify(Object.fromEntries(CAL_H.map((H) => [H, { n: out.universes.all.overall.B[H].n, xsNet: out.universes.all.overall.B[H].meanXsNet, diff: out.universes.all.overall.B[H].ctl.diffXsNet }]))));
console.log("non-om overall B:", JSON.stringify(Object.fromEntries(CAL_H.map((H) => [H, { n: out.universes.nonOm.overall.B[H].n, xsNet: out.universes.nonOm.overall.B[H].meanXsNet, diff: out.universes.nonOm.overall.B[H].ctl.diffXsNet }]))));
console.log("sessions (om):", JSON.stringify(out.universes.om.overall.sessions));
console.log("time to target (om):", JSON.stringify(out.universes.om.overall.timeToTarget));
console.log("coverage:", JSON.stringify(out.coverage));
