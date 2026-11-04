// deep2/chart/matchedControls.mjs — TASK 1: insider effect vs ordinary price behaviour (matched controls).
// Discovery period only. Every test is registered (lib2 registry) before its result is computed.
//   node scripts/research/deep2/chart/matchedControls.mjs
//
// Design: for each discovery insider event (stage C), K = 10 control stock-days from the bar cache with no
// code-P filing within ±20 sessions, same calendar month as the entry, same period (control exits inside the
// period), same liquidity tier (decision-time 20-session dollar volume), nearest on prior 5/20-session return,
// 60-session drawdown, 20-session volatility, 20-session dollar volume and the prior-day gap (one stock-day per
// symbol). Controls are charged the per-side cost their event paid. Outcome = event − mean(controls).
import { setup, matchAll } from "./mcSetup.mjs";
import {
  MATCH_FEATURES, clip, prepareVectors, nearest, usable, usableN, companyStats, mean, median, r4, reg, rec, xnetAt, writeOut, toCsv, pct, myResults, bhQ, pValue, DISCOVER_END,
} from "./common.mjs";

const S = await setup();
const disc = S.ev.filter((r) => r.per === "discover");

// ---- "rich" variant: also match the 3-session volume spike, the decision-day return and the 60-session position ----
const RICH = [...MATCH_FEATURES,
  { k: "lvolSpike", w: 1, f: (r) => (r.volSpike > 0 ? clip(Math.log(r.volSpike), -2, 3) : null) },
  { k: "r1", w: 0.5, f: (r) => clip(r.r1, -0.3, 0.5) },
  { k: "pos60", w: 0.5, f: (r) => r.pos60 },
];
prepareVectors(S.pool.rows, RICH, "rv");
{ const xs = (F) => S.pool.rows.map(F.f).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b); for (const F of RICH.slice(MATCH_FEATURES.length)) { const s = xs(F); S.scales[F.k] = Math.max(1e-6, (s[Math.floor(0.75 * (s.length - 1))] - s[Math.floor(0.25 * (s.length - 1))]) / 1.349); } }

const M = {
  primary: matchAll(S, disc, "primary"),
  sameDate: matchAll(S, disc, "sameDate"),
  ext: matchAll(S, disc, "ext"),
  rich: new Map(disc.map((r) => [r.e.id, nearest(r, S.idx, S.scales, S.pool.syms.length, { K: 10, feats: RICH, key: "rv" })])),
};

// ---- subsets (stage-C fields) and outcomes ----
const SUBSETS = {
  all: () => true,
  ceoCfo: (e) => e.isCeo || e.isCfo,
  openMarket: (e) => e.venue === "open_market",
  value250k: (e) => e.filingValue >= 2.5e5,
  afterDrawdown30: (e) => e.dd60 != null && e.dd60 <= -0.3,
  nearLow60: (e) => e.nearLow60 === true,
};
const OUTCOMES = ["gapX", "x0", "x1", "x2", "x3", "x4", "x5"];
const OUT_DESC = { gapX: "open gap (decision close → entry open) minus SPY's gap; no cost", x0: "entry open → same-day close (MOO→MOC), net, minus SPY", x1: "entry open → close 1 session later, net, minus SPY", x2: "→ close 2 sessions later", x3: "→ close 3 sessions later", x4: "→ close 4 sessions later", x5: "→ close 5 sessions later" };

// ---- registration (before any outcome comparison is computed) ----
const id1 = (sub, o) => `chart-T1-${sub}-${o}`;
for (const sub of Object.keys(SUBSETS)) for (const o of OUTCOMES) reg({
  id: id1(sub, o), family: "chart-T1 matched control (primary)", familySize: Object.keys(SUBSETS).length * OUTCOMES.length,
  statement: `Discovery, subset ${sub}: mean over events of [event ${o} − mean of its 10 matched controls' ${o}] differs from 0 (${OUT_DESC[o]}).`,
  rationale: "If insider purchase filings carry information beyond what ordinary price behaviour (momentum/reversal, drawdown, volatility, liquidity) implies, events should beat stock-days with the same chart. Gap = the news reaction at the open (expected > 0); x0..x5 = what a follower earns after the open.",
});
for (const v of ["sameDate", "ext", "rich"]) for (const o of OUTCOMES) reg({
  id: `chart-T1R-${v}-all-${o}`, family: "chart-T1 matched control (robustness variants, all events)", familySize: 3 * OUTCOMES.length,
  statement: `Discovery, all events, control variant ${v}: event ${o} − mean of matched controls' ${o} differs from 0.`,
  rationale: { sameDate: "Controls from the exact entry session remove day-specific small-cap/sector shocks.", ext: "Excludes control days followed by a P filing within 60 sessions (the bar universe = stocks that had insider buys, so pre-purchase declines could depress control returns).", rich: "Also matches the 3-session volume spike, the decision-day return and the 60-session position, which stay imbalanced under primary matching (volume premium / news confound)." }[v],
});
reg({ id: "chart-T1D-pool-prepurchase", family: "chart-T1 control-validity diagnostic", familySize: 1,
  statement: "Among primary matched controls (discovery), x5 of controls followed by a P filing within 21–60 sessions minus x5 of the other controls differs from 0.",
  rationale: "Checks whether the insider-buyer universe biases control outcomes (insiders buy after declines)." });

// ---- outcome helpers ----
const evOut = (r, o) => {
  if (o === "gapX") return r.e.entryDate < DISCOVER_END ? r.gapX : null; // embargo: the gap is observed on the entry day
  const N = Number(o.slice(1));
  if ([1, 2, 3, 5].includes(N)) return usable(r.e, N, "discover") ? r.e.h[N].excessNet : null;
  return usableN(r, N) ? r.o.x[N].xnet : null;
};
const ctlOut = (c, r, o) => {
  if (o === "gapX") return c.r.gapX;
  const N = Number(o.slice(1));
  return xnetAt(S.bars.get(c.r.s), c.r.k, S.cal, N, r.e.costBpsPerSide, "open");
};
function compare(rows, matches, o) {
  const d = [], ev = [], ct = [];
  for (const r of rows) {
    const ms = matches.get(r.e.id); if (!ms?.length) continue;
    const x = evOut(r, o); if (x == null) continue;
    const cs = ms.map((c) => ctlOut(c, r, o)).filter((v) => v != null && Number.isFinite(v)); if (!cs.length) continue;
    const cm = mean(cs);
    d.push({ issuer: r.e.issuerCik, x: x - cm }); ev.push({ issuer: r.e.issuerCik, x }); ct.push({ issuer: r.e.issuerCik, x: cm });
  }
  return { diff: companyStats(d), event: companyStats(ev, { boot: 0 }), control: companyStats(ct, { boot: 0 }) };
}

// ---- compute (results are buffered and recorded only after every computation succeeded) ----
const toRecord = { items: [], push(id, r) { this.items.push([id, r]); } };
const results = { generatedAt: new Date().toISOString(), design: "see header", primary: {}, robustness: {}, diagnostic: {} };
for (const [sub, f] of Object.entries(SUBSETS)) {
  const rows = disc.filter((r) => f(r.e));
  results.primary[sub] = {};
  for (const o of OUTCOMES) { const res = compare(rows, M.primary, o); results.primary[sub][o] = res; toRecord.push(id1(sub, o), { n: res.diff.n, issuers: res.diff.issuers, mean: res.diff.mean, median: res.diff.median, t: res.diff.t, p: res.diff.p, eventMean: res.event.mean, controlMean: res.control.mean, stats: res.diff }); }
}
for (const v of ["sameDate", "ext", "rich"]) {
  results.robustness[v] = {};
  for (const o of OUTCOMES) { const res = compare(disc, M[v], o); results.robustness[v][o] = res; toRecord.push(`chart-T1R-${v}-all-${o}`, { n: res.diff.n, mean: res.diff.mean, median: res.diff.median, t: res.diff.t, p: res.diff.p, eventMean: res.event.mean, controlMean: res.control.mean, stats: res.diff }); }
}
{ // control-validity diagnostic
  const pre = [], other = [];
  for (const r of disc) for (const c of M.primary.get(r.e.id) || []) { const x = ctlOut(c, r, "x5"); if (x == null) continue; (c.r.ext ? other : pre).push({ issuer: c.r.s, x }); }
  const a = companyStats(pre, { boot: 0 }), b = companyStats(other, { boot: 0 });
  const seA = a.t ? Math.abs(a.mean / a.t) : null, seB = b.t ? Math.abs(b.mean / b.t) : null;
  const t = seA != null && seB != null ? (a.mean - b.mean) / Math.sqrt(seA ** 2 + seB ** 2) : null;
  results.diagnostic.prePurchaseControls = { prePurchase: a, other: b, diff: r4(a.mean - b.mean), tApprox: r4(t), p: r4(pValue(t)) };
  toRecord.push("chart-T1D-pool-prepurchase", { diff: r4(a.mean - b.mean), t: r4(t), p: pValue(t), prePurchase: a, other: b });
}

for (const [id, r] of toRecord.items) rec(id, r);

// ---- BH over all of this agent's recorded results so far (latest result per id) ----
const latest = new Map(); for (const x of myResults()) latest.set(x.id, x.result);
const ids = [...latest.keys()], ps = ids.map((k) => latest.get(k)?.p ?? null), qs = bhQ(ps);
const qOf = new Map(ids.map((k, i) => [k, qs[i]]));
results.bhNote = `BH across ${ps.filter((p) => p != null).length} chart results recorded so far (final BH is recomputed in summary.mjs over the full registry).`;
for (const sub of Object.keys(SUBSETS)) for (const o of OUTCOMES) results.primary[sub][o].q = r4(qOf.get(id1(sub, o)));
for (const v of ["sameDate", "ext", "rich"]) for (const o of OUTCOMES) results.robustness[v][o].q = r4(qOf.get(`chart-T1R-${v}-all-${o}`));
writeOut("mc-results.json", results);

// ---- event-level output (discovery only) ----
const evRows = [];
for (const r of disc) {
  const ms = M.primary.get(r.e.id) || [];
  const row = { id: r.e.id, ticker: r.e.ticker, issuer: r.e.issuerCik, publishedAt: r.e.publishedAt, entryDate: r.e.entryDate, decisionDate: r.decDate, role: r.e.role, ceoCfo: !!(r.e.isCeo || r.e.isCfo), venue: r.e.venue, ownership: r.e.ownership,
    filingValue: Math.round(r.e.filingValue), dd60_stageC: r.e.dd60, nearLow60_stageC: r.e.nearLow60, costBps: r.e.costBpsPerSide, tier: r.tier,
    r1: r.r1, r5: r.r5, r20: r.r20, dd60: r.dd60, vol20: r.vol20, dv20: r.dv20, gapPrev: r.gapPrev, volSpike: r.volSpike, pos60: r.pos60, nControls: ms.length, meanDist: ms.length ? mean(ms.map((m) => m.dist)) : null };
  for (const o of OUTCOMES) { const x = evOut(r, o); const cs = ms.map((c) => ctlOut(c, r, o)).filter((v) => v != null); row[`ev_${o}`] = x; row[`ctl_${o}`] = cs.length ? mean(cs) : null; row[`diff_${o}`] = x != null && cs.length ? x - mean(cs) : null; }
  evRows.push(row);
}
writeOut("mc-events.csv", toCsv(evRows, Object.keys(evRows[0])));
writeOut("mc-controls.json", Object.fromEntries(disc.map((r) => [r.e.id, (M.primary.get(r.e.id) || []).map((m) => [m.r.s, m.r.D, r4(m.dist)])])));

// ---- console table ----
const line = (lab, res) => `${lab.padEnd(18)} n ${String(res.diff.n).padStart(5)} iss ${String(res.diff.issuers).padStart(4)} | event ${pct(res.event.mean)} ctl ${pct(res.control.mean)} | diff mean ${pct(res.diff.mean)} med ${pct(res.diff.median)} t ${res.diff.t} p ${r4(res.diff.p)} q ${res.q} exTop5 ${pct(res.diff.meanExTop5Issuers)} CI [${pct(res.diff.ci95?.[0])}, ${pct(res.diff.ci95?.[1])}]`;
for (const sub of Object.keys(SUBSETS)) { console.log(`\n== ${sub} (primary) ==`); for (const o of OUTCOMES) console.log(line(o, results.primary[sub][o])); }
for (const v of ["sameDate", "ext", "rich"]) { console.log(`\n== robustness ${v} (all) ==`); for (const o of OUTCOMES) console.log(line(o, results.robustness[v][o])); }
console.log("\n[diagnostic] pre-purchase controls:", JSON.stringify({ pre: results.diagnostic.prePurchaseControls.prePurchase.mean, n: results.diagnostic.prePurchaseControls.prePurchase.n, other: results.diagnostic.prePurchaseControls.other.mean, n2: results.diagnostic.prePurchaseControls.other.n, diff: results.diagnostic.prePurchaseControls.diff }));
