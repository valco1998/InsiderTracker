// deep2/behavior/candidates.mjs — freezes the behaviour candidates (hash), registers their confirmation tests, then
// evaluates each ONCE on discovery and confirmation and writes candidates.json + event-level CSVs + winners/losers.
//   node scripts/research/deep2/behavior/candidates.mjs
// No discovery candidate passed BH q < 0.10; these are the best-supported rules, frozen so the null gets one
// out-of-sample check. Thresholds come from discovery only (K3's 24.73% = discovery top tercile).
import fs from "node:fs";
import path from "node:path";
import { loadEvents, loadBars, sha256 } from "../lib2.mjs";
import { OUT, register, recordOnce, companyStats, readOut, writeOut, r4, mean, median, chartDesc } from "./common.mjs";
import { buildRows } from "./outcomes.mjs";
import { toCsv } from "../../lib.mjs";

const CANDS = [
  { id: "behavior-K1-om-v2-H5", horizon: 5, entry: "open of the first regular session whose 09:30 ET open is >= SEC acceptance + 60 s (stage-C entryPrice)",
    exit: "official close of the 5th session after the entry session (stage-C h[5]); no stops", track: "B",
    rule: "Form 4 filing with code-P rows; classification v2 filing class == 'om' (every purchase row: market text or trade price inside the trade-date [low,high] ±0.75%, no offering/plan/exchange text, buyer an individual or personal vehicle, not a fund/entity/portfolio manager); priced in stage C",
    invalidates: "filing reclassified (amendment) as offering/plan/entity; no regular-session bar at entry",
    mechanism: "Baseline: discretionary open-market insider buying after the information reaches the open." },
  { id: "behavior-K2-om-firstInBurst-H5", horizon: 5, entry: "same as K1", exit: "same as K1", track: "B",
    rule: "K1 AND burstN == 1: no other 'om'-class purchase filing at the same issuer accepted in the 14 calendar days before this filing's acceptance",
    invalidates: "same as K1",
    mechanism: "News is concentrated in the first public filing of a buying burst; follow-on filings are anticipated (registered diff test behavior-mem-nth-H5: 3rd+ minus first = -1.61%, p = 0.023, q = 0.23)." },
  { id: "behavior-K3-ah-topConviction-toOpen", horizon: "AH->next open", track: "A (after hours)",
    entry: "first eligible (non-odd-lot, representative) SIP trade >= acceptance + 60 s and before 20:00 ET on the publication day",
    exit: "official next regular-session open (opening auction)",
    rule: "classification v2 'om' AND accepted 16:00-19:55 ET on a trading day AND (first position OR % position increase >= 24.73%) AND an eligible after-hours trade exists",
    invalidates: "no after-hours trade before 20:00 ET; filing not 'om'",
    mechanism: "% position increase predicts the opening gap (t = 6.2); the only fill that precedes the gap is after hours.",
    costs: "entry max(50 bps, 2 x stage-C cost per side); exit stage-C cost per side" },
];
const FROZEN = path.join(OUT, "candidates-frozen.json");
const defHash = sha256(JSON.stringify(CANDS));
if (fs.existsSync(FROZEN)) {
  const f = JSON.parse(fs.readFileSync(FROZEN, "utf8"));
  if (f.hash !== defHash) throw new Error("candidate definitions changed after freezing — refusing to re-evaluate (would be tuning on confirmation)");
} else fs.writeFileSync(FROZEN, JSON.stringify({ frozenAt: new Date().toISOString(), hash: defHash, candidates: CANDS }, null, 1));

// register the confirmation tests BEFORE computing them
for (const c of CANDS) register({ id: `${c.id}-confirm`, family: "behavior-candidates-confirm", familySize: CANDS.length,
  statement: `Frozen candidate ${c.id} has positive mean net excess on the confirmation period (2026-06-15 .. 2026-08-31, exits before 09-01).`,
  rationale: c.mechanism, test: "single evaluation of a frozen rule; one-sample companyStats" });

const bars = loadBars();
const evById = new Map(loadEvents().map((e) => [e.accessionNo, e]));
const rows = buildRows();
const sel = {
  "behavior-K1-om-v2-H5": (r) => r.cls === "om",
  "behavior-K2-om-firstInBurst-H5": (r) => r.cls === "om" && r.burstN === 1,
};
const statsOf = (xs, H) => companyStats(xs.filter((r) => r.x[H] != null).map((r) => ({ issuer: r.issuer, x: r.x[H] })));
const profile = (xs) => Object.fromEntries([1, 2, 3, 4, 5].map((H) => [`H${H}`, r4(mean(xs.map((r) => r.x[H]).filter((v) => v != null)))])
  .concat([["gap", r4(mean(xs.map((r) => r.gap).filter((v) => v != null)))], ["day0Net", r4(mean(xs.map((r) => r.day0?.excessNet).filter((v) => v != null)))]]));
const describe = (r) => { const e = evById.get(r.acc); const d = e ? chartDesc(e, bars) : null; return d?.text || "n/a"; };
const fmt = (v) => (v == null ? "-" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const out = [], wl = {};
for (const c of CANDS.slice(0, 2)) {
  const all = rows.filter(sel[c.id]);
  const D = all.filter((r) => r.period === "discover"), C = all.filter((r) => r.period === "confirm");
  const res = { id: c.id, rule: c.rule, entry: c.entry, exit: c.exit, horizon: c.horizon, track: c.track, invalidates: c.invalidates, mechanism: c.mechanism,
    discovery: statsOf(D, 5), confirmation: statsOf(C, 5), discoveryProfile: profile(D), confirmationProfile: profile(C),
    discoveryH1: statsOf(D, 1), confirmationH1: statsOf(C, 1) };
  recordOnce(`${c.id}-confirm`, { period: "confirm", stats: res.confirmation, p: res.confirmation.p, profile: res.confirmationProfile });
  out.push(res);
  // event-level CSV (discovery + confirmation)
  const cols = ["acc", "ticker", "issuer", "period", "publishedAt", "entryDate", "entryPrice", "costBpsPerSide", "cls", "omBasis", "stated", "insider", "role", "isCeo", "isCfo",
    "filingValue", "posIncrease", "firstPosition", "burstN", "daysSincePrevOm", "buyerType30", "othersSold90", "salesCovered",
    (r) => r.gap, (r) => r.day0?.excessNet, (r) => r.x[1], (r) => r.x[2], (r) => r.x[3], (r) => r.x[4], (r) => r.x[5], (r) => r.x[20]];
  const header = ["acc", "ticker", "issuer", "period", "publishedAt", "entryDate", "entryPrice", "costBpsPerSide", "cls", "omBasis", "stated", "insider", "role", "isCeo", "isCfo",
    "filingValue", "posIncrease", "firstPosition", "burstN", "daysSincePrevOm", "buyerType30", "othersSold90", "salesCovered", "gapExSpy", "day0ExNet", "exNetH1", "exNetH2", "exNetH3", "exNetH4", "exNetH5", "exNetH20"];
  const csv = toCsv(all, cols).split("\n"); csv[0] = header.join(",");
  fs.writeFileSync(path.join(OUT, `candidate-${c.id}.csv`), csv.join("\n"));
  // winners and losers (H5 net excess), discovery + confirmation
  const ranked = all.filter((r) => r.x[5] != null).sort((a, b) => b.x[5] - a.x[5]);
  const card = (r) => ({ acc: r.acc, ticker: r.ticker, period: r.period, publishedAt: r.publishedAt, insider: r.insider, role: r.role, value: Math.round(r.filingValue),
    posIncrease: r.posIncrease, first: r.firstPosition, burstN: r.burstN, gap: r.gap, h5: r.x[5], chart: describe(r) });
  wl[c.id] = { winners: ranked.slice(0, 12).map(card), losers: ranked.slice(-12).reverse().map(card) };
}
// K3: after-hours capture, from ah-behavior-events.json (deep-1 cached AH trades; threshold frozen above)
{
  const c = CANDS[2];
  const ahRows = readOut("ah-behavior-events.json").filter((r) => (r.firstPosition || r.posIncrease >= 0.2473));
  const D = ahRows.filter((r) => r.period === "discover"), C = ahRows.filter((r) => r.period === "confirm");
  const st = (xs, k) => companyStats(xs.filter((r) => r[k] != null).map((r) => ({ issuer: r.issuer, x: r[k] })));
  const res = { id: c.id, rule: c.rule, entry: c.entry, exit: c.exit, horizon: c.horizon, track: c.track, invalidates: c.invalidates, mechanism: c.mechanism, costs: c.costs,
    discovery: st(D, "captureNet"), confirmation: st(C, "captureNet"), discoveryGross: st(D, "captureGross"), confirmationGross: st(C, "captureGross"),
    discoveryAhToClose1Net: st(D, "ex1Net"), confirmationAhToClose1Net: st(C, "ex1Net"),
    note: "Sample = deep-1 stratified after-hours cache only (all CEO/CFO personal open-market >= $250k + random others); not the full universe. Extended-hours spreads unobserved." };
  recordOnce(`${c.id}-confirm`, { period: "confirm", stats: res.confirmation, p: res.confirmation.p, gross: res.confirmationGross });
  out.push(res);
  const header = ["acc", "ticker", "issuer", "period", "publishedAt", "stratum", "insider", "minutesAfterAcceptance", "ahDollars", "ahVsClose", "nextOpenVsClose", "captureGross", "entryCostPerSide", "exitCostPerSide", "captureNet", "ex1Gross", "ex1Net", "posIncrease", "firstPosition", "isCeoCfo", "filingValue"];
  fs.writeFileSync(path.join(OUT, `candidate-${c.id}.csv`), toCsv(ahRows, header));
  const ranked = [...ahRows].sort((a, b) => b.captureNet - a.captureNet);
  const pick = (r) => { const e = evById.get(r.acc); const d = e ? chartDesc(e, bars) : null; return { acc: r.acc, ticker: r.ticker, period: r.period, publishedAt: r.publishedAt, insider: r.insider, posIncrease: r.posIncrease, first: r.firstPosition, ahVsClose: r.ahVsClose, nextOpenVsClose: r.nextOpenVsClose, captureNet: r.captureNet, ahDollars: r.ahDollars, chart: d?.text || "n/a" }; };
  wl[c.id] = { winners: ranked.slice(0, 10).map(pick), losers: ranked.slice(-10).reverse().map(pick) };
}
writeOut("candidates.json", out.map((c) => ({ id: c.id, rule: c.rule, entry: c.entry, exit: c.exit, horizon: c.horizon, track: c.track, invalidates: c.invalidates,
  discovery: c.discovery, confirmation: c.confirmation, notes: { mechanism: c.mechanism, costs: c.costs || "stage-C costBpsPerSide on each side",
    status: "did NOT pass the discovery gate (BH q < 0.10); frozen only to give the null one out-of-sample check", profiles: { discovery: c.discoveryProfile, confirmation: c.confirmationProfile },
    h1: { discovery: c.discoveryH1, confirmation: c.confirmationH1 }, gross: { discovery: c.discoveryGross, confirmation: c.confirmationGross },
    ahToClose1Net: { discovery: c.discoveryAhToClose1Net, confirmation: c.confirmationAhToClose1Net }, sample: c.note || null, frozenHash: defHash } })));
writeOut("candidates-winners-losers.json", wl);
for (const c of out) {
  const s = (x) => `n=${x.n}/${x.issuers} mean ${fmt(x.mean)} med ${fmt(x.median)} issMed ${fmt(x.issuerMedianOfMeans)} pos ${x.positive} t=${x.t} p=${r4(x.p)} exTop5 ${fmt(x.meanExTop5Issuers)} ci [${fmt(x.ci95?.[0])}, ${fmt(x.ci95?.[1])}]`;
  console.log(`\n${c.id}\n  DISC ${s(c.discovery)}\n  CONF ${s(c.confirmation)}`);
  if (c.discoveryProfile) console.log("  profile D", JSON.stringify(c.discoveryProfile), "\n  profile C", JSON.stringify(c.confirmationProfile));
  if (c.discoveryGross) console.log("  gross D", fmt(c.discoveryGross.mean), "C", fmt(c.confirmationGross.mean), "| AH->close1 net D", fmt(c.discoveryAhToClose1Net.mean), "C", fmt(c.confirmationAhToClose1Net.mean));
}
