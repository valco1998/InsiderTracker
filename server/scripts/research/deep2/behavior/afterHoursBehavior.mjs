// deep2/behavior/afterHoursBehavior.mjs — does behaviour (conviction) select better after-hours entries?
//   node scripts/research/deep2/behavior/afterHoursBehavior.mjs [--confirm]
// Motivation (registered after the discovery finding that the % position increase predicts the OPENING GAP, t = 6.2):
// if the market prices conviction at the next open, a buyer who enters in the after-hours session right after an
// after-close filing could capture it. Sample: deep-1's cached after-hours SIP trades (614 stratified filings; holdout
// filings ignored). Entry = first eligible AH trade >= acceptance + 60 s (deep-1 definition); exit = next regular open.
// Costs (pre-declared): entry leg max(50 bps, 2 x stage-C cost per side) because extended-hours spreads are wide and
// unobserved; exit leg (opening auction) = stage-C cost per side. Gross numbers are reported too.
import fs from "node:fs";
import path from "node:path";
import { DEEP1, loadEvents, bhQ } from "../lib2.mjs";
import { register, recordOnce, companyStats, rankSlope, readOut, writeOut, r4, mean, median } from "./common.mjs";

const CONFIRM = process.argv.includes("--confirm");
const per = (p) => (p < "2026-06-15" ? "discover" : p < "2026-09-01" ? "confirm" : "holdout");
const ah = JSON.parse(fs.readFileSync(path.join(DEEP1, "afterHours.json"), "utf8")).rows.filter((r) => per(r.publishedAt) !== "holdout");
const F = new Map(readOut("event-features.json").map((x) => [x.acc, x]));
const ev = new Map(loadEvents().map((e) => [e.accessionNo, e]));
const pi = (f) => (f.firstPosition ? 1e6 : f.posIncrease);

const rows = [];
for (const r of ah) {
  const f = F.get(r.id), e = ev.get(r.id);
  if (!f || !e || f.cls !== "om" || r.status !== "ok" || r.captureToOpen == null) continue;
  // entry date's open must be before the period end (embargo, same rule as lib2.usable for the exit)
  const p = per(r.publishedAt);
  if (p === "discover" && !(e.entryDate < "2026-06-15")) continue;
  if (p === "confirm" && !(e.entryDate < "2026-09-01")) continue;
  const c = (e.costBpsPerSide || 100) / 1e4, entryCost = Math.max(0.005, 2 * c);
  rows.push({ acc: r.id, issuer: e.issuerCik, ticker: r.ticker, period: p, publishedAt: r.publishedAt, stratum: r.stratum, insider: r.insider,
    minutesAfterAcceptance: r.minutesAfterAcceptance, ahDollars: r.ahDollars, ahVsClose: r.ahVsClose, nextOpenVsClose: r.nextOpenVsClose,
    captureGross: r.captureToOpen, captureNet: r4(r.captureToOpen - entryCost - c), entryCostPerSide: r4(entryCost), exitCostPerSide: r4(c),
    ex1Gross: r.ex1, ex1Net: r.ex1 == null ? null : r4(r.ex1 - entryCost - c), posIncrease: f.posIncrease, firstPosition: f.firstPosition, z: pi(f),
    isCeoCfo: f.isCeo || f.isCfo, filingValue: f.filingValue, buyerType30: f.buyerType30, othersSold90: f.othersSold90 });
}
const disc = rows.filter((r) => r.period === "discover" && Number.isFinite(r.z));
// Top-tercile threshold of the conviction score, fixed on discovery.
const zs = disc.map((r) => r.z).sort((a, b) => a - b);
const cut = zs[Math.floor((2 / 3) * (zs.length - 1))];

const FAMILY = "behavior-ah", SIZE = 3;
const tests = [
  { id: "behavior-ah-om-captureNet", statement: "After-close true open-market filings (v2) with an after-hours trade: mean net capture from the first AH trade (>= acceptance + 60 s) to the next open, minus SPY, is positive (costs: entry max(50 bps, 2x stage-C), exit stage-C).",
    rationale: "The opening gap of true open-market buys averages +1.6-1.9%; an after-hours buyer may capture it before the open if the AH price has not yet adjusted.",
    sel: (r) => true, x: (r) => r.captureNet },
  { id: "behavior-ah-pctRank-capture", statement: "Among those filings, the % position increase (first positions highest) predicts the gross AH-to-open capture (rank slope).",
    rationale: "Conviction predicts the opening gap (behavior-conv-gap-pctRank, t = 6.2); if the thin AH market has not priced it yet, it should predict the capture too.",
    sel: (r) => true, x: (r) => r.captureGross, slope: true },
  { id: "behavior-ah-topConviction-captureNet", statement: "Top-tercile conviction (threshold fixed on discovery) after-close true open-market filings: mean net AH-to-open capture is positive.",
    rationale: "Candidate rule combining the gap predictor with the only fill that precedes the gap.",
    sel: (r) => r.z >= cut, x: (r) => r.captureNet },
];
for (const t of tests) register({ id: t.id, family: FAMILY, familySize: SIZE, statement: t.statement, rationale: t.rationale, test: "discovery; deep-1 cached AH trades (holdout ignored)" });

const evalOn = (set, t) => {
  const sel = set.filter(t.sel).filter((r) => t.x(r) != null);
  if (t.slope) { const s = rankSlope(sel.map((r) => ({ issuer: r.issuer, x: t.x(r), z: r.z }))); return { kind: "slope", slope: s, p: s?.p ?? null }; }
  const st = companyStats(sel.map((r) => ({ issuer: r.issuer, x: t.x(r) })));
  const gross = companyStats(sel.map((r) => ({ issuer: r.issuer, x: r.captureGross })));
  const d1 = companyStats(sel.filter((r) => r.ex1Net != null).map((r) => ({ issuer: r.issuer, x: r.ex1Net })));
  const sens = Object.fromEntries([50, 100, 200].map((b) => [`flat${b}bpsPerSide`, r4(mean(sel.map((r) => r.captureGross - 2 * b / 1e4)))]));
  return { kind: "mean", stats: st, gross, ahEntryToClose1Net: d1, costSensitivityMean: sens, medianAhDollars: median(sel.map((r) => r.ahDollars)), p: st.p };
};
const out = { threshold: { topTercileZ: cut, note: "z = % position increase; first positions = 1e6" }, discover: {}, confirm: null };
for (const t of tests) { out.discover[t.id] = evalOn(disc, t); recordOnce(t.id, { period: "discover", ...out.discover[t.id] }); }
if (CONFIRM) {
  const conf = rows.filter((r) => r.period === "confirm" && Number.isFinite(r.z));
  out.confirm = {}; for (const t of tests) out.confirm[t.id] = evalOn(conf, t);
}
writeOut(CONFIRM ? "ah-behavior-confirm.json" : "ah-behavior-discovery.json", out);
writeOut("ah-behavior-events.json", rows);
const f = (v) => (v == null ? "-" : (v * 100).toFixed(2) + "%");
for (const [id, r] of Object.entries(out.discover)) console.log(id, r.kind === "slope" ? `n=${r.slope?.n} top-bottom ${f(r.slope?.b)} t=${r.slope?.t} p=${r4(r.p)}` : `n=${r.stats.n}/${r.stats.issuers} net mean ${f(r.stats.mean)} med ${f(r.stats.median)} pos ${r.stats.positive} t=${r.stats.t} p=${r4(r.p)} | gross ${f(r.gross.mean)}/${f(r.gross.median)} | AH->close1 net ${f(r.ahEntryToClose1Net.mean)} | flat costs ${JSON.stringify(r.costSensitivityMean)} | med AH $${r.medianAhDollars}`);
console.log("top-tercile threshold (posIncrease):", cut);
if (out.confirm) for (const [id, r] of Object.entries(out.confirm)) console.log("CONFIRM", id, r.kind === "slope" ? `n=${r.slope?.n} b ${f(r.slope?.b)} t=${r.slope?.t}` : `n=${r.stats.n} net ${f(r.stats.mean)} med ${f(r.stats.median)} t=${r.stats.t} p=${r4(r.p)} gross ${f(r.gross.mean)}`);
