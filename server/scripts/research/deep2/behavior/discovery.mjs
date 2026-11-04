// deep2/behavior/discovery.mjs — registers every behaviour hypothesis FIRST, then computes it on the discovery period only.
//   node scripts/research/deep2/behavior/discovery.mjs
// Outcome: per-event net excess return vs SPY (stage-C excessNet; 4-session exit from bars), entry = next regular open
// after acceptance + 60 s. Gap tests use the opening gap (entry open vs last close, minus SPY's gap, gross).
import { bhQ } from "../lib2.mjs";
import { register, recordOnce, companyStats, diffTest, rankSlope, writeOut, readOut, mean, median, r4, AGENT } from "./common.mjs";
import { buildRows } from "./outcomes.mjs";
import fs from "node:fs";
import path from "node:path";
import { DEEP2 } from "../lib2.mjs";

const isOm = (r) => r.cls === "om";
const pi = (r) => (r.firstPosition ? 1e6 : r.posIncrease); // first positions rank above every % increase
const piGe = (t) => (r) => isOm(r) && r.convValid && (r.firstPosition || r.posIncrease >= t);
const ceoCfo10 = (r) => piGe(0.1)(r) && (r.isCeo || r.isCfo);
const cov = (r) => isOm(r) && r.salesCovered;

// kind: mean (one-sample on select), diff (A vs B), slope (rank of z), with outcome H (1..5) or "gap".
const FAM = {
  class: { family: "behavior-class", size: 8 },
  conv: { family: "behavior-conv", size: 13 },
  sales: { family: "behavior-sales", size: 10 },
  mem: { family: "behavior-memory", size: 10 },
};
const T = [
  // ---- classification v2: re-ask on true open-market buys ----
  ...[1, 3, 5].map((H) => ({ id: `behavior-class-om-H${H}`, fam: "class", kind: "mean", H, A: isOm,
    statement: `True open-market filings (classification v2) have non-zero mean net excess vs SPY from the next open to the close of session ${H}.`,
    rationale: "Discretionary open-market buys by insiders carry private information; if the market under-reacts at the open, post-open drift is positive. Deep 1 found large positive opening gaps, so the residual may be ~0." })),
  { id: "behavior-class-omVsRest-H5", fam: "class", kind: "diff", H: 5, A: isOm, B: (r) => !isOm(r),
    statement: "Post-open H5 net excess differs between true open-market filings and the rest (offering/plan, fund/entity, unknown).",
    rationale: "Offerings and fund allocations are not information-driven insider decisions; mixing them in dilutes or reverses the signal." },
  { id: "behavior-class-offering-H5", fam: "class", kind: "mean", H: 5, A: (r) => r.cls === "offering",
    statement: "Offering/placement/plan filings have non-zero mean H5 net excess (expected negative).",
    rationale: "Issuance adds supply, placements are priced at a discount and the stock gravitates to the deal price; plans are mechanical." },
  { id: "behavior-class-entity-H5", fam: "class", kind: "mean", H: 5, A: (r) => r.cls === "entity",
    statement: "Fund/entity filings have non-zero mean H5 net excess.",
    rationale: "Fund buying (closed-end fund arbitrage, activists, strategic stakes) is driven by flows and discounts, not inside information; little drift expected." },
  { id: "behavior-class-priceVsText-H5", fam: "class", kind: "diff", H: 5, A: (r) => isOm(r) && r.omBasis === "price", B: (r) => isOm(r) && r.omBasis !== "price",
    statement: "Among true open-market filings, those identified by price evidence only do not differ from those identified by filing text (validity check).",
    rationale: "If the in-range price test identifies real open-market buys, both groups should behave alike; a large difference would mean the price-only group is contaminated." },
  { id: "behavior-class-gap-omVsRest", fam: "class", kind: "diff", H: "gap", A: isOm, B: (r) => !isOm(r),
    statement: "The opening gap (SPY-adjusted) is larger for true open-market filings than for the rest.",
    rationale: "If the market already prices genuine insider buying at the open, the information shows up in the gap rather than in post-open returns." },
  // ---- conviction ----
  ...[1, 3, 5].map((H) => ({ id: `behavior-conv-pctRank-H${H}`, fam: "conv", kind: "slope", H, A: (r) => isOm(r) && r.convValid && pi(r) != null, z: pi,
    statement: `Among true open-market filings, the % increase in the insider's position (first positions ranked highest) predicts net excess to session ${H} (rank slope).`,
    rationale: "The fraction of own wealth put at stake measures conviction; the insider-trading literature finds larger % holdings changes predict larger abnormal returns." })),
  { id: "behavior-conv-pctRank-allClasses-H5", fam: "conv", kind: "slope", H: 5, A: (r) => r.convValid && pi(r) != null, z: pi,
    statement: "The same rank slope on all purchase filings (no classification).",
    rationale: "Shows whether mixing offerings/funds (whose 'position increase' is mechanical) hides or creates the conviction effect." },
  { id: "behavior-conv-firstPos-H5", fam: "conv", kind: "diff", H: 5, A: (r) => isOm(r) && r.convValid && r.firstPosition, B: (r) => isOm(r) && r.convValid && !r.firstPosition,
    statement: "First-ever positions (no prior holdings, no earlier holdings in the store) differ from adds to existing positions (two-sided).",
    rationale: "Opening a position is new money and strong conviction, but many first buys are token purchases by new directors; direction is ambiguous." },
  { id: "behavior-conv-largeOwn-H5", fam: "conv", kind: "diff", H: 5, A: (r) => isOm(r) && r.ownPriorFilings > 0 && r.valueVsOwnMedian >= 2, B: (r) => isOm(r) && r.ownPriorFilings > 0 && r.valueVsOwnMedian < 2,
    statement: "Among insiders with earlier purchases at the issuer, a filing at least 2x their own median prior filing value outperforms smaller ones.",
    rationale: "Departing from one's own routine is the signature of opportunistic (informed) trading (Cohen, Malloy & Pomorski 2012)." },
  ...[1, 3, 5].map((H) => ({ id: `behavior-conv-ceoCfo10-H${H}`, fam: "conv", kind: "mean", H, A: ceoCfo10,
    statement: `True open-market buys by a CEO or CFO that raise their position by >= 10% (or open one) have positive mean net excess to session ${H}.`,
    rationale: "CEOs/CFOs have the broadest information; a >= 10% increase is economically meaningful personal exposure." })),
  ...[0.1, 0.25, 0.5].map((t) => ({ id: `behavior-conv-pi${Math.round(t * 100)}-H5`, fam: "conv", kind: "mean", H: 5, A: piGe(t),
    statement: `True open-market buys raising the position by >= ${Math.round(t * 100)}% (or opening one) have positive mean H5 net excess (threshold grid, chosen on discovery).`,
    rationale: "Conviction threshold for a tradable rule; grid {10,25,50}% counted in the family." })),
  { id: "behavior-conv-gap-pctRank", fam: "conv", kind: "slope", H: "gap", A: (r) => isOm(r) && r.convValid && pi(r) != null, z: pi,
    statement: "The % position increase predicts the opening gap (is conviction priced at the open?).",
    rationale: "Holdings after the trade are in the filing; if the market reads them, larger increases get larger gaps." },
  // ---- sales context (true open-market buys, 90-day look-back fully inside the store) ----
  ...[5, 1].map((H) => ({ id: `behavior-sales-othersSold-H${H}`, fam: "sales", kind: "diff", H, A: (r) => cov(r) && r.othersSold90 > 0, B: (r) => cov(r) && r.othersSold90 === 0,
    statement: `Buys made while other insiders at the company made discretionary (non-10b5-1) sales in the prior 90 days differ at session ${H} (two-sided).`,
    rationale: "Mixed insider signals lower the information content of the buy (net purchase ratio literature); alternatively a contrarian buy against colleagues is high conviction." })),
  { id: "behavior-sales-selfSold-H5", fam: "sales", kind: "diff", H: 5, A: (r) => cov(r) && r.selfSold90, B: (r) => cov(r) && !r.selfSold90,
    statement: "Buys by an insider who made a discretionary sale in the prior 90 days differ (descriptive: ~20 discovery events, underpowered).",
    rationale: "Round-tripping insiders look like traders rather than informed holders." },
  ...[5, 1].map((H) => ({ id: `behavior-sales-netBalance-H${H}`, fam: "sales", kind: "slope", H, A: cov, z: (r) => r.netBalance90,
    statement: `The issuer's 90-day insider net balance ((buy$ - discretionary sell$)/(buy$ + sell$)) predicts net excess to session ${H}.`,
    rationale: "Aggregate insider sentiment (net purchase ratio) predicts returns better than a single trade (Lakonishok & Lee 2001)." })),
  ...[5, 1].map((H) => ({ id: `behavior-sales-firstAfterSelling-H${H}`, fam: "sales", kind: "mean", H, A: (r) => cov(r) && r.firstBuyAfterSelling,
    statement: `The first insider buy after a selling streak (>= 3 discretionary sale filings and no other purchase filing in the prior 90 days) has positive mean net excess to session ${H}.`,
    rationale: "A switch from insider selling to buying marks a change in insiders' valuation view near a low." })),
  { id: "behavior-sales-firstAfterSelling-diff-H5", fam: "sales", kind: "diff", H: 5, A: (r) => cov(r) && r.firstBuyAfterSelling, B: (r) => cov(r) && !r.firstBuyAfterSelling,
    statement: "First buy after a selling streak vs other covered open-market buys (H5).", rationale: "As above, relative to the average buy." },
  { id: "behavior-sales-gap-othersSold", fam: "sales", kind: "diff", H: "gap", A: (r) => cov(r) && r.othersSold90 > 0, B: (r) => cov(r) && r.othersSold90 === 0,
    statement: "Opening gap differs when others sold in the prior 90 days.", rationale: "Is the sales context priced at the open?" },
  { id: "behavior-sales-gap-firstAfterSelling", fam: "sales", kind: "diff", H: "gap", A: (r) => cov(r) && r.firstBuyAfterSelling, B: (r) => cov(r) && !r.firstBuyAfterSelling,
    statement: "Opening gap differs for the first buy after a selling streak.", rationale: "Is the regime switch priced at the open?" },
  // ---- company memory ----
  ...[5, 1].map((H) => ({ id: `behavior-mem-prevReaction-H${H}`, fam: "mem", kind: "slope", H, A: (r) => isOm(r) && r.prevPostOpen1 != null, z: (r) => r.prevPostOpen1,
    statement: `The post-open reaction to the previous purchase filing at the same company (open -> close of its session 1, minus SPY) predicts this filing's net excess to session ${H} (two-sided).`,
    rationale: "Reaction memory: the same liquidity providers and holders trade each filing; a faded previous gap suggests the next one will also be faded, a held one that it will continue." })),
  ...[5, 1].map((H) => ({ id: `behavior-mem-nth-H${H}`, fam: "mem", kind: "diff", H, A: (r) => isOm(r) && r.burstN >= 3, B: (r) => isOm(r) && r.burstN === 1,
    statement: `The 3rd or later open-market filing of a burst (filings <= 14 days apart) differs from the first at session ${H}.`,
    rationale: "The first filing carries the news; later ones are anticipated, so their drift should be smaller (or they mark persistent accumulation)." })),
  { id: "behavior-mem-timeSince-H5", fam: "mem", kind: "slope", H: 5, A: (r) => isOm(r) && r.daysSincePrevOm != null, z: (r) => r.daysSincePrevOm,
    statement: "Days since the previous open-market filing at the company predicts H5 net excess (rank slope).", rationale: "A filing after a long silence is more surprising than one in a stream." },
  ...[5, 1].map((H) => ({ id: `behavior-mem-indep-H${H}`, fam: "mem", kind: "diff", H, A: (r) => isOm(r) && r.buyerType30 === "independent", B: (r) => isOm(r) && r.buyerType30 === "repeat",
    statement: `With open-market filings at the company in the prior 30 days, independent buyers (a different person, not a joint filer) differ from one insider repeating at session ${H}.`,
    rationale: "Agreement among independent insiders is more credible than one insider averaging down or supporting the price." })),
  { id: "behavior-mem-gap-nth", fam: "mem", kind: "diff", H: "gap", A: (r) => isOm(r) && r.burstN >= 3, B: (r) => isOm(r) && r.burstN === 1,
    statement: "Opening gap of 3rd+ burst filings vs first filings.", rationale: "Later filings should be partly anticipated." },
  { id: "behavior-mem-gap-indep", fam: "mem", kind: "diff", H: "gap", A: (r) => isOm(r) && r.buyerType30 === "independent", B: (r) => isOm(r) && r.buyerType30 === "repeat",
    statement: "Opening gap: independent buyers vs one insider repeating.", rationale: "Is buyer independence priced at the open?" },
  { id: "behavior-mem-gap-prevReaction", fam: "mem", kind: "slope", H: "gap", A: (r) => isOm(r) && r.prevPostOpen1 != null, z: (r) => r.prevPostOpen1,
    statement: "The previous filing's post-open reaction predicts this filing's opening gap.", rationale: "Do traders condition today's open on how the last filing traded?" },
];
// family sizes must match the number of tests declared
for (const [k, v] of Object.entries(FAM)) { const n = T.filter((t) => t.fam === k).length; if (n !== v.size) throw new Error(`family ${k}: declared ${v.size}, has ${n}`); }

// 1) register everything BEFORE computing
let newly = 0;
for (const t of T) newly += register({ id: t.id, family: FAM[t.fam].family, familySize: FAM[t.fam].size, statement: t.statement, rationale: t.rationale,
  test: `${t.kind} on discovery events; outcome ${t.H === "gap" ? "opening gap (SPY-adjusted, gross)" : `net excess vs SPY, next open -> close of session ${t.H}`}` }) ? 1 : 0;
console.log(`registered ${newly} new hypotheses (${T.length} total)`);

// 2) compute on discovery only
const rows = buildRows().filter((r) => r.period === "discover");
const val = (r, H) => (H === "gap" ? r.gap : r.x[H]);
const prof = (sel) => Object.fromEntries([1, 2, 3, 4, 5].map((H) => { const xs = sel.map((r) => r.x[H]).filter((v) => v != null); return [`H${H}`, xs.length ? r4(mean(xs)) : null]; }).concat([["gap", r4(mean(sel.map((r) => r.gap).filter((v) => v != null)))]]));
const results = [];
for (const t of T) {
  let res;
  const base = rows.filter((r) => val(r, t.H) != null);
  if (t.kind === "mean") {
    const sel = base.filter(t.A);
    res = { kind: "mean", stats: companyStats(sel.map((r) => ({ issuer: r.issuer, x: val(r, t.H) }))), profile: prof(rows.filter(t.A)) };
    res.p = res.stats.p;
  } else if (t.kind === "diff") {
    const A = base.filter(t.A), B = base.filter(t.B);
    const d = diffTest(A.map((r) => ({ issuer: r.issuer, x: val(r, t.H) })), B.map((r) => ({ issuer: r.issuer, x: val(r, t.H) })));
    res = { kind: "diff", diff: d, A: companyStats(A.map((r) => ({ issuer: r.issuer, x: val(r, t.H) }))), B: companyStats(B.map((r) => ({ issuer: r.issuer, x: val(r, t.H) }))),
      profileA: prof(rows.filter(t.A)), profileB: prof(rows.filter(t.B)) };
    res.p = d?.p ?? null;
  } else {
    const sel = base.filter(t.A).filter((r) => Number.isFinite(t.z(r)));
    const s = rankSlope(sel.map((r) => ({ issuer: r.issuer, x: val(r, t.H), z: t.z(r) })));
    // descriptive terciles of z
    const srt = [...sel].sort((a, b) => t.z(a) - t.z(b)); const k = Math.floor(srt.length / 3);
    const terc = [srt.slice(0, k), srt.slice(k, 2 * k), srt.slice(2 * k)].map((g) => ({ n: g.length, zRange: g.length ? [r4(t.z(g[0])), r4(t.z(g.at(-1)))] : null, mean: r4(mean(g.map((r) => val(r, t.H)))), median: r4(median(g.map((r) => val(r, t.H)))) }));
    res = { kind: "slope", slope: s, terciles: terc };
    res.p = s?.p ?? null;
  }
  results.push({ id: t.id, family: FAM[t.fam].family, H: t.H, statement: t.statement, ...res });
  recordOnce(t.id, { period: "discover", ...res });
}
// 3) BH across all of this agent's registered tests that have a p-value (discovery)
const resFile = path.join(DEEP2, "registry-results.jsonl");
const mine = fs.readFileSync(resFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.agent === AGENT && x.result?.period === "discover");
const ps = mine.map((x) => x.result.p ?? null);
const qs = bhQ(ps);
const qById = new Map(mine.map((x, i) => [x.id, qs[i]]));
for (const r of results) r.q = qById.get(r.id) == null ? null : r4(qById.get(r.id));
writeOut("discovery-results.json", { builtAt: new Date().toISOString(), nTestsInBH: ps.filter((p) => p != null).length, results });
// compact print
const f = (v) => (v == null ? "  -   " : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%");
for (const r of results) {
  if (r.kind === "mean") console.log(`${r.id.padEnd(44)} n=${String(r.stats.n).padStart(4)}/${String(r.stats.issuers).padStart(4)} mean ${f(r.stats.mean)} med ${f(r.stats.median)} issMed ${f(r.stats.issuerMedianOfMeans)} pos ${r.stats.positive} t=${r.stats.t} p=${r4(r.p)} q=${r.q} exTop5 ${f(r.stats.meanExTop5Issuers)}`);
  else if (r.kind === "diff") console.log(`${r.id.padEnd(44)} A n=${r.diff?.nA} ${f(r.diff?.meanA)} | B n=${r.diff?.nB} ${f(r.diff?.meanB)} | diff ${f(r.diff?.diff)} t=${r.diff?.t} p=${r4(r.p)} q=${r.q}`);
  else console.log(`${r.id.padEnd(44)} n=${r.slope?.n} top-bottom ${f(r.slope?.b)} t=${r.slope?.t} p=${r4(r.p)} q=${r.q} | terciles ${r.terciles.map((g) => f(g.mean)).join(" ")}`);
}
