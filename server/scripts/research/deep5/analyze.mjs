// deep5/analyze.mjs — descriptive statistics, pre-registered tests (prereg.json), frozen strategies, sensitivities.
//   node --max-old-space-size=6144 scripts/research/deep5/analyze.mjs   → .cache/research/deep5/stats.json (+ csv tables)
import fs from "node:fs";
import path from "node:path";
import * as L from "./lib5.mjs";
const { mean, median, quantile, group, cnt, addDays, dnum } = L;

const J = L.readOut("clusters.json");
const prereg = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "prereg.json"), "utf8");
const preregSha = L.sha256(prereg);
const K = L.makeMarket();
const issuerOf = (c) => c.cik;
const withIssuer = (cs) => cs.map((c) => ({ ...c, issuer: issuerOf(c) }));

// ---------- samples ----------
const mainOf = (clock, cat) => (cat === "U" ? J.unions[clock] : J.clusters.filter((c) => c.clock === clock && c.cat === cat)).filter((c) => c.full180 && !c.gap);
const S = {}; for (const clock of [1, 2]) for (const cat of ["A", "B", "C", "U"]) S[`${clock}${cat}`] = withIssuer(mainOf(clock, cat));
const period = (c) => (c.entryDate <= L.PERIODS.designEnd ? "design" : "confirm");
const month = (c) => c.entryDate.slice(0, 7);

// ---------- control paths (recomputed for curves and timing distributions) ----------
const ctlPaths = (c) => (c.ctrlSyms ? c.ctrlSyms.split(" ").map((s) => L.pathOutcome(K, s, c.entryDate, c.entryMode)).filter((o) => o.ret) : []);

// ---------- 1. descriptive table per category ----------
const pct = (xs, p) => quantile(xs.filter((x) => x != null), p);
const nn = (xs) => xs.filter((x) => x != null && Number.isFinite(x));
function describe(cs) {
  if (!cs.length) return { n: 0 };
  const g = (k) => nn(cs.map((c) => c[k]));
  const ctl = cs.filter((c) => c.ctrlStatus === "ok");
  const worst = [...cs].sort((a, b) => a.r180 - b.r180).slice(0, 5).map((c) => ({ ticker: c.ticker, issuer: c.issuer, entryDate: c.entryDate, r180: c.r180, minLowRet: c.minLowRet, maxGain: c.maxGain }));
  const best = [...cs].sort((a, b) => b.maxGain - a.maxGain).slice(0, 5).map((c) => ({ ticker: c.ticker, issuer: c.issuer, entryDate: c.entryDate, r180: c.r180, maxGain: c.maxGain, daysToMax: c.daysToMax }));
  return {
    n: cs.length, issuers: new Set(cs.map((c) => c.cik)).size, months: Object.keys(cnt(cs, month)).sort(),
    usdMean: mean(g("usd")), usdMedian: median(g("usd")), ownersMedian: median(g("owners")),
    maxGain: { mean: mean(g("maxGain")), median: median(g("maxGain")), p25: pct(g("maxGain"), 0.25), p50: pct(g("maxGain"), 0.5), p75: pct(g("maxGain"), 0.75), p90: pct(g("maxGain"), 0.9) },
    maxCloseGain: { mean: mean(g("maxCloseGain")), median: median(g("maxCloseGain")), p25: pct(g("maxCloseGain"), 0.25), p75: pct(g("maxCloseGain"), 0.75), p90: pct(g("maxCloseGain"), 0.9) },
    daysToMax: { mean: mean(g("daysToMax")), median: median(g("daysToMax")), sessMedian: median(g("sessToMax")), p25: pct(g("daysToMax"), 0.25), p75: pct(g("daysToMax"), 0.75) },
    daysToMaxClose: { median: median(g("daysToMaxClose")) },
    hitHigh: Object.fromEntries(L.THRESH.map((t) => [t, mean(cs.map((c) => c[`hit${t}`]))])),
    hitClose: Object.fromEntries(L.THRESH.map((t) => [t, mean(cs.map((c) => c[`hitC${t}`]))])),
    medDaysToHit: Object.fromEntries(L.THRESH.map((t) => [t, median(nn(cs.map((c) => c[`dHit${t}`])))])),
    ret: Object.fromEntries(L.HORIZONS.map((D) => [D, { mean: mean(g(`r${D}`)), median: median(g(`r${D}`)), netMean: mean(g(`n${D}`)), spyMean: mean(g(`spy${D}`)), xMean: mean(g(`x${D}`)), xMedian: median(g(`x${D}`)) }])),
    minLowRet: { median: median(g("minLowRet")), p10: pct(g("minLowRet"), 0.1) }, closeDrawdown: { median: median(g("closeDrawdown")), p10: pct(g("closeDrawdown"), 0.1) },
    sigDD: cnt(cs, (c) => c.sigDD), endedEarly: cs.filter((c) => c.endedEarly).length, fundLike: cs.filter((c) => c.fundLike).length,
    winRate180: mean(cs.map((c) => (c.n180 > 0 ? 1 : 0))),
    controls: ctl.length ? { n: ctl.length, maxGainMean: mean(nn(ctl.map((c) => c.ctl_maxGain))), maxGainEventMean: mean(nn(ctl.map((c) => c.maxGain))), hit20: mean(nn(ctl.map((c) => c.ctl_hit20))), hit20Event: mean(ctl.map((c) => c.hit20)),
      n180: mean(nn(ctl.map((c) => c.ctl_n180))), n180Event: mean(nn(ctl.map((c) => c.n180))), daysToMax: mean(nn(ctl.map((c) => c.ctl_daysToMax))), pool_n180: mean(nn(ctl.map((c) => c.pool_n180))), pool_hit20: mean(nn(ctl.map((c) => c.pool_hit20))), pool_maxGain: mean(nn(ctl.map((c) => c.pool_maxGain))) } : null,
    worst, best,
  };
}
const desc = {}; for (const k of Object.keys(S)) desc[k] = describe(S[k]);

// ---------- 2. cumulative touch curves (events vs matched controls), days-to-peak histograms ----------
function curves(cs) {
  const days = Array.from({ length: 181 }, (_, i) => i);
  const ev = {}, ct = {};
  const ctlAll = cs.flatMap((c) => ctlPaths(c).map((o) => ({ o, w: 1 })));
  for (const t of L.THRESH) {
    ev[t] = days.filter((d) => d % 5 === 0 || d === 180).map((d) => [d, mean(cs.map((c) => (c[`dHit${t}`] != null && c[`dHit${t}`] <= d ? 1 : 0)))]);
    ct[t] = days.filter((d) => d % 5 === 0 || d === 180).map((d) => [d, ctlAll.length ? mean(ctlAll.map(({ o }) => (o.touchH[t] != null && o.touchH[t] <= d ? 1 : 0))) : null]);
  }
  const bins = Array.from({ length: 18 }, (_, i) => i * 10);
  const hist = (xs) => bins.map((b) => xs.filter((x) => x >= b && x < (b === 170 ? 181 : b + 10)).length / Math.max(1, xs.length));
  return { ev, ct, peakHist: { bins, ev: hist(nn(cs.map((c) => c.daysToMax))), ct: hist(ctlAll.map(({ o }) => o.daysToMax).filter((x) => x != null)) },
    maxGainHist: (() => { const edges = [-0.5, 0, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 100]; const h = (xs) => edges.slice(0, -1).map((e, i) => xs.filter((x) => x >= e && x < edges[i + 1]).length / Math.max(1, xs.length)); return { edges, ev: h(nn(cs.map((c) => c.maxGain))), ct: h(ctlAll.map(({ o }) => o.maxGain)) }; })(),
    nCtl: ctlAll.length };
}
const curve = {}; for (const k of ["2A", "2B", "2C", "2U", "1U"]) curve[k] = curves(S[k]);

// ---------- 3. monthly cohorts ----------
function cohorts(cs) {
  return Object.entries(Object.fromEntries(group(cs, month))).sort().map(([m, xs]) => {
    const c = xs.filter((x) => x.ctrlStatus === "ok");
    return { month: m, n: xs.length, issuers: new Set(xs.map((x) => x.cik)).size, r180: median(nn(xs.map((x) => x.r180))), n180: mean(nn(xs.map((x) => x.n180))), x180: mean(nn(xs.map((x) => x.x180))), spy180: mean(nn(xs.map((x) => x.spy180))),
      vsCtl: c.length ? mean(c.map((x) => x.n180 - x.ctl_n180)) : null, maxGainMed: median(nn(xs.map((x) => x.maxGain))), ctlMaxGainMed: median(nn(c.map((x) => x.ctl_maxGain))), hit20: mean(xs.map((x) => x.hit20)), ctlHit20: c.length ? mean(c.map((x) => x.ctl_hit20)) : null, daysToMaxMed: median(nn(xs.map((x) => x.daysToMax))) };
  });
}
const months = {}; for (const k of ["2A", "2B", "2C", "2U", "1U"]) months[k] = cohorts(S[k]);

// ---------- 4. pre-registered tests ----------
const tests = [];
const T = (id, family, items, stat, extra = {}) => { const b = L.clusterBoot(items, stat); tests.push({ id, family, ...extra, ...b }); return b; };
const ctlOk = (cs) => cs.filter((c) => c.ctrlStatus === "ok");
for (const cat of ["A", "B", "C", "U"]) {
  const cs = S[`2${cat}`];
  T(`P1-${cat}`, "primary", ctlOk(cs), (x) => mean(x.map((c) => c.n180 - c.ctl_n180)), { what: "180d net minus matched controls" });
  T(`P2-${cat}`, "primary", cs.filter((c) => c.x180 != null), (x) => mean(x.map((c) => c.x180)), { what: "180d net minus SPY" });
  T(`P3-${cat}`, "primary", ctlOk(cs), (x) => mean(x.map((c) => c.hit20 - c.ctl_hit20)), { what: "+20% touch share minus controls" });
  T(`P4-${cat}`, "primary", ctlOk(cs), (x) => mean(x.map((c) => c.maxGain - c.ctl_maxGain)), { what: "max 180d gain minus controls" });
}
const U = ctlOk(S["2U"]);
const sp = (fx, fy) => (x) => L.spearman(x.map(fx), x.map(fy));
const lusd = (c) => Math.log(c.usd), lrel = (c) => Math.log(c.usdToAdv);
T("D1", "dose", U, sp(lusd, (c) => c.n180 - c.ctl_n180), { what: "rho(log USD, 180d excess vs controls)" });
T("D2", "dose", U, sp((c) => c.owners, (c) => c.n180 - c.ctl_n180), { what: "rho(owners, 180d excess vs controls)" });
T("D3", "dose", U.filter((c) => c.usdToAdv > 0), sp(lrel, (c) => c.n180 - c.ctl_n180), { what: "rho(log USD/ADV, 180d excess vs controls)" });
T("D4", "dose", U, sp(lusd, (c) => c.maxGain - c.ctl_maxGain), { what: "rho(log USD, max-gain excess)" });
T("D5", "dose", U, sp((c) => c.owners, (c) => c.maxGain - c.ctl_maxGain), { what: "rho(owners, max-gain excess)" });
T("D6", "dose", U.filter((c) => c.usdToAdv > 0), sp(lrel, (c) => c.maxGain - c.ctl_maxGain), { what: "rho(log USD/ADV, max-gain excess)" });
const usdTop = quantile(U.map((c) => c.usd), 2 / 3), advLow = quantile(nn(U.map((c) => c.adv20)), 1 / 3);
const SPLITS = {
  G1: (c) => c.ceoCfo === 1, G2: (c) => c.tenPct === 1, G3: (c) => c.nTradeDates === 1, G4: (c) => c.pr60 != null && c.pr60 <= -0.2, G5: (c) => c.adv20 <= advLow,
  G6: (c) => c.fundLike === 1, G7: (c) => c.spyAbove50 === 1, G8: (c) => c.staleDays > 7, G9: (c) => c.plan === 1, G10: (c) => c.usd >= usdTop,
};
const xs = (c) => c.n180 - c.ctl_n180;
const sub = {};
for (const [g, f] of Object.entries(SPLITS)) {
  const yes = U.filter(f), no = U.filter((c) => !f(c));
  sub[g] = { nYes: yes.length, nNo: no.length, yes: mean(yes.map(xs)), no: mean(no.map(xs)) };
  if (yes.length < 10 || no.length < 10) { tests.push({ id: g, family: "subgroup", what: "INSUFFICIENT DATA (< 10 events on one side; deviation from prereg: minimum added before reading the estimate)", n: U.length, nYes: yes.length, nNo: no.length, est: sub[g].yes - sub[g].no, p: null }); continue; }
  T(g, "subgroup", U, (x) => { const a = x.filter(f), b = x.filter((c) => !f(c)); return a.length && b.length ? mean(a.map(xs)) - mean(b.map(xs)) : null; }, { what: `difference in 180d excess vs controls (yes - no)`, nYes: yes.length, nNo: no.length });
}
T("T1", "timing", U, (x) => median(nn(x.map((c) => c.daysToMax))) - median(nn(x.map((c) => c.ctl_daysToMax))), { what: "median days to 180d high, events minus controls" });
T("T2", "timing", U, (x) => mean(x.map((c) => (c.daysToMax > 150 ? 1 : 0))) - mean(x.map((c) => c.ctl_lateMax)), { what: "share of highs in the last 30 days, events minus controls" });
const linked = S["2U"].filter((c) => c.c1r180 != null);
T("K1", "clocks", linked, (x) => mean(x.map((c) => c.c1r180 - c.r180)), { what: "hindsight (Clock 1) 180d return minus public (Clock 2) gross 180d return, same events" });

// ---------- 5. frozen strategies: design -> confirm -> extension (90d) ----------
const designU = U.filter((c) => period(c) === "design");
const relCut = quantile(nn(designU.map((c) => c.usdToAdv)), 2 / 3);
const allSub = Object.entries(SPLITS).flatMap(([g, f]) => [{ id: `${g}=yes`, f }, { id: `${g}=no`, f: (c) => !f(c) }]);
const s6 = allSub.map((s) => ({ ...s, n: designU.filter(s.f).length, m: mean(designU.filter(s.f).map(xs)) })).filter((s) => s.n >= 20).sort((a, b) => b.m - a.m)[0];
const RULES = {
  S1: { sel: () => true, h: 180, ret: "n" }, S2: { sel: (c) => /[BC]/.test(c.cats), h: 180, ret: "n" }, S3: { sel: () => true, h: 90, ret: "n" },
  S4: { sel: () => true, h: 180, ret: "tp20" }, S5: { sel: (c) => c.usdToAdv >= relCut, h: 180, ret: "n" }, S6: { sel: s6.f, h: 180, ret: "n", chosen: s6.id, designMean: s6.m },
};
const frozenStrategies = { at: new Date().toISOString(), relCut, s6: { chosen: s6.id, designN: s6.n, designMean: s6.m } };
L.writeOut("frozen-strategies.json", JSON.stringify(frozenStrategies, null, 1));
// extension sample: Clock 2 union events after the confirm window with a full 90-day window, gap-free, controls ok
const extU = withIssuer(J.unions[2].filter((c) => !c.gap && !c.full180 && c.ctrlStatus === "ok" && c.r90 != null && addDays(c.entryDate, 90) <= L.COMPLETE_THROUGH));
function evalRule(id, R, cs, horizon) {
  const h = horizon || R.h;
  const items = cs.filter(R.sel).map((c) => {
    const net = R.ret === "tp20" && h === 180 ? c.tp20 : c[`n${h}`];
    const ctl = R.ret === "tp20" && h === 180 ? c.ctl_tp20 : c[`ctl_n${h}`];
    return { issuer: c.cik, month: month(c), net, vsCtl: net != null && ctl != null ? net - ctl : null, vsSpy: net != null && c[`spy${h}`] != null ? net - c[`spy${h}`] : null };
  }).filter((x) => x.net != null && x.vsCtl != null);
  if (!items.length) return { n: 0 };
  const bc = L.clusterBoot(items, (x) => mean(x.map((i) => i.vsCtl)));
  const mm = Object.entries(Object.fromEntries(group(items, (i) => i.month))).map(([m, v]) => ({ m, n: v.length, vsCtl: mean(v.map((i) => i.vsCtl)) }));
  const nets = items.map((i) => i.net); const gains = nets.filter((x) => x > 0).reduce((a, b) => a + b, 0), losses = -nets.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  return { n: items.length, issuers: new Set(items.map((i) => i.issuer)).size, horizon: h, net: mean(nets), netMedian: median(nets), winRate: mean(nets.map((x) => (x > 0 ? 1 : 0))), profitFactor: losses ? gains / losses : null, worst: Math.min(...nets),
    vsCtl: bc.est, vsCtlLo90: bc.lo90, vsCtlHi90: bc.hi90, vsCtlP: bc.p, vsSpy: mean(items.map((i) => i.vsSpy)), months: mm.sort((a, b) => (a.m < b.m ? -1 : 1)), monthsPositive: mm.filter((x) => x.vsCtl > 0).length };
}
const strat = {};
for (const [id, R] of Object.entries(RULES)) {
  const d = evalRule(id, R, designU), c = evalRule(id, R, U.filter((x) => period(x) === "confirm")), e = evalRule(id, R, extU, 90);
  let verdict;
  if (c.n < 20) verdict = "INSUFFICIENT DATA";
  else if (c.vsCtl > 0 && c.vsSpy > 0 && c.vsCtlLo90 > 0 && c.monthsPositive >= 2) verdict = "PASSED CONFIRM — PROMISING BUT UNVALIDATED (overlapping periods, one market regime)";
  else verdict = "REJECTED";
  strat[id] = { rule: JSON.parse(prereg).strategies.list.find((x) => x.id === id).rule, chosen: R.chosen || null, design: d, confirm: c, extension90: e, verdict };
  tests.push({ id: `${id}-confirm`, family: "strategy", what: "confirm-period net minus controls", est: c.vsCtl, p: c.vsCtlP, n: c.n });
}

// ---------- 6. multiple testing ----------
const q = L.bh(tests.map((t) => t.p ?? null));
tests.forEach((t, i) => { t.q = q[i]; });

// ---------- 7. sensitivities (exploratory, labelled) ----------
const sens = {};
const vsCtl = (cs, k = "n180", ck = "ctl_n180") => { const it = ctlOk(cs).filter((c) => c[k] != null && c[ck] != null); return L.clusterBoot(it, (x) => mean(x.map((c) => c[k] - c[ck]))); };
sens.allUnion = vsCtl(S["2U"]);
sens.excludeFunds = vsCtl(S["2U"].filter((c) => !c.fundLike));
sens.firstEventPerIssuer = vsCtl(Object.values(Object.fromEntries(group(S["2U"], (c) => c.cik))).map((v) => v.sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1))[0]));
sens.excludeEndedEarly = vsCtl(S["2U"].filter((c) => !c.endedEarly));
sens.costsX2 = L.clusterBoot(ctlOk(S["2U"]).map((c) => ({ ...c, d: (c.n180 - (c.r180 - c.n180)) - c.ctl_n180 })), (x) => mean(x.map((c) => c.d)));
sens.medianDiff = L.clusterBoot(ctlOk(S["2U"]), (x) => median(x.map((c) => c.n180 - c.ctl_n180)));
sens.winsorized = (() => { const d = ctlOk(S["2U"]).map((c) => c.n180 - c.ctl_n180); const lo = quantile(d, 0.05), hi = quantile(d, 0.95); return L.clusterBoot(ctlOk(S["2U"]).map((c) => ({ ...c, w: Math.min(hi, Math.max(lo, c.n180 - c.ctl_n180)) })), (x) => mean(x.map((c) => c.w))); })();
sens.vsPoolAverage = L.clusterBoot(ctlOk(S["2U"]).filter((c) => c.pool_n180 != null), (x) => mean(x.map((c) => c.n180 - c.pool_n180)));
sens.clock1vsControls = vsCtl(S["1U"]);
sens.firstCloseEntry = { n: nn(S["2U"].map((c) => c.fc_r180)).length, meanGrossOpen: mean(nn(S["2U"].filter((c) => c.fc_r180 != null).map((c) => c.r180))), meanGrossFirstClose: mean(nn(S["2U"].map((c) => c.fc_r180))) };
sens.horizons = Object.fromEntries(L.HORIZONS.map((D) => [D, vsCtl(S["2U"], `n${D}`, `ctl_n${D}`)]));
// partial follow-up: all gap-free Clock 2 union events with each horizon matured (more events at short horizons)
sens.partialFollowUp = Object.fromEntries(L.HORIZONS.map((D) => { const cs = withIssuer(J.unions[2].filter((c) => !c.gap && c.ctrlStatus === "ok" && c[`n${D}`] != null && c[`ctl_n${D}`] != null)); return [D, { ...L.clusterBoot(cs, (x) => mean(x.map((c) => c[`n${D}`] - c[`ctl_n${D}`]))), spy: mean(nn(cs.map((c) => c[`x${D}`]))) }]; }));

// ---------- 8. independence ----------
const ents = S["2U"].map((c) => c.entryDate).sort();
const independence = { events: S["2U"].length, issuers: new Set(S["2U"].map((c) => c.cik)).size, cohortMonths: Object.keys(cnt(S["2U"], month)).length,
  entrySpanDays: dnum(ents.at(-1)) - dnum(ents[0]), marketWindow: [ents[0], addDays(ents.at(-1), 180)],
  nonOverlapping180dPeriods: (dnum(ents.at(-1)) - dnum(ents[0]) + 180) / 180, repeatIssuers: Object.values(cnt(S["2U"], (c) => c.cik)).filter((v) => v > 1).length };

// ---------- 9. event table for the report ----------
const eventTable = J.unions[2].filter((c) => c.entryStatus === "ok").map((c) => ({ id: c.id, ticker: c.ticker, issuer: c.issuer, cats: c.cats, owners: c.owners, usd: c.usd, completion: c.c1Completion, windowStart: c.windowStart, windowEnd: c.windowEnd, T: c.T, entryDate: c.entryDate, entry: c.entry,
  maxGain: c.maxGain, maxDate: c.maxDate, daysToMax: c.daysToMax, r180: c.r180, n180: c.n180, x180: c.x180, ctl180: c.ctl_n180, minLowRet: c.minLowRet, status: c.outcomeStatus, full180: c.full180, gap: c.gap, fundLike: c.fundLike, observedThrough: c.observedThrough, r30: c.r30, r90: c.r90 }));

const stats = { builtAt: new Date().toISOString(), preregSha, desc, curve, months, tests, sub, strat, frozenStrategies, sens, independence, eventTable,
  counts: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.length])) };
L.writeOut("stats.json", JSON.stringify(stats));
L.writeOut("tests.csv", L.toCsv(tests, ["id", "family", "what", "n", "issuers", "est", "lo90", "hi90", "p", "q"]));
const show = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "%");
console.log("prereg sha", preregSha);
for (const k of ["2A", "2B", "2C", "2U", "1U"]) { const d = desc[k]; console.log(k, "n", d.n, "iss", d.issuers, "maxGain med", show(d.maxGain.median), "p90", show(d.maxGain.p90), "days med", d.daysToMax.median, "hit10/20/30/50/100", L.THRESH.map((t) => show(d.hitHigh[t])).join("/"), "r180 med", show(d.ret[180].median), "net mean", show(d.ret[180].netMean), "xSPY", show(d.ret[180].xMean), "| ctl maxGain", show(d.controls?.maxGainMean), "ctl hit20", show(d.controls?.hit20), "ctl n180", show(d.controls?.n180), "pool n180", show(d.controls?.pool_n180)); }
for (const t of tests) console.log(t.id, t.what, "n", t.n, "est", t.est?.toFixed(4), "90%", t.lo90?.toFixed(3), t.hi90?.toFixed(3), "p", t.p?.toFixed(3), "q", t.q?.toFixed(3));
for (const [id, s] of Object.entries(strat)) console.log(id, s.chosen || "", "design", s.design.n, show(s.design.vsCtl), "confirm", s.confirm.n, show(s.confirm.vsCtl), "spy", show(s.confirm.vsSpy), "ext90", s.extension90.n, show(s.extension90.vsCtl), "->", s.verdict);
console.log("sens", JSON.stringify(Object.fromEntries(Object.entries(sens).filter(([k]) => !["horizons", "partialFollowUp"].includes(k)).map(([k, v]) => [k, v.est ?? v]))));
console.log("partial", JSON.stringify(Object.fromEntries(Object.entries(sens.partialFollowUp).map(([D, v]) => [D, [v.n, v.est?.toFixed(4), v.p?.toFixed(3), v.spy?.toFixed(4)]]))));
console.log("months U", JSON.stringify(months["2U"].map((m) => [m.month, m.n, m.vsCtl?.toFixed(3), m.x180?.toFixed(3)])));
console.log("independence", JSON.stringify(independence));
