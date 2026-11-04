// deep3/sequence/tests.mjs — the pre-registered test set (single source of truth for register.mjs and analyze.mjs).
// Written 2026-11-04 after the STRUCTURE counts (build-summary.json: n per position) and BEFORE any outcome was computed.
//
// Conventions
//   Signal = a new distinct buyer (position k) at its filing's SEC acceptance T. Entry: official open of the first session
//   >= T + 60 s. Touch "+X% within W sessions": a daily high >= entry×(1+X) in sessions 1..W, the entry session = session 1.
//   Net N: exit at the official close of the N-th session after the entry session, net of tier cost (×1) per side, minus SPY
//   over the same fills. Controls: K = 10 matched non-event stock-days (same month, liquidity tier and period; nearest on the
//   control set's features), entry at the control day's open, each control charged the event's cost.
//   Test buckets: positions 1, 2, 3, 4, 5, 6+ (the finer 6–7 / 8–10 / 11+ are reported descriptively: 8–10 has 8 issuers and
//   11+ has 3 issuers in discovery, 0 in confirmation).
// Minimum sample: a test is computed only if every group has n >= 20 events and >= 10 issuers with a usable outcome;
//   otherwise it is recorded as NA (still counted in its family size).
// Multiple testing: BH across all discovery tests (families S1–S10) of this agent; confirmation (S11) is judged separately
//   (same sign, p < 0.10). Thresholds below were fixed a priori (deep-2 conventions), not chosen from outcomes.
export const TEST_BUCKETS = ["1", "2", "3", "4", "5", "6+"];
export const tb = (k) => (k >= 6 ? "6+" : String(k));
export const DESC_BUCKETS = ["1", "2", "3", "4", "5", "6-7", "8-10", "11+"];
export const db = (k) => (k >= 11 ? "11+" : k >= 8 ? "8-10" : k >= 6 ? "6-7" : String(k));
export const MIN_N = 20, MIN_ISSUERS = 10;

export const METRICS = {
  T5W2: { type: "touch", X: 0.05, W: 2, label: "touch +5% within 2 sessions" },
  T10W5: { type: "touch", X: 0.10, W: 5, label: "touch +10% within 5 sessions" },
  T20W10: { type: "touch", X: 0.20, W: 10, label: "touch +20% within 10 sessions" },
  N1: { type: "net", N: 1, label: "net excess vs SPY, close of session 1 after entry" },
  N2: { type: "net", N: 2, label: "net excess, close N=2" },
  N3: { type: "net", N: 3, label: "net excess, close N=3" },
  N5: { type: "net", N: 5, label: "net excess, close N=5" },
  N10: { type: "net", N: 10, label: "net excess, close N=10" },
};

const pos = (s) => s.position;
const isRole = (r) => (s) => s.primaryRole === r;
const base = (g, u, period = "discover") => ({ source: "signals", grouping: g, universe: u, period });
const T = [];
const fam = (family, list) => { for (const t of list) T.push({ ...t, family }); };

// S1 — position bucket: touch rate minus volatility+momentum-matched controls (cal, om)
fam("S1-cal-touch-vs-volMom", TEST_BUCKETS.flatMap((b) => ["T5W2", "T10W5", "T20W10"].map((m) => ({
  id: `sequence-S1-cal-b${b}-${m}`, kind: "ctl", set: "volMom", metric: m, ...base("cal", "om"), sel: { bucket: b },
  statement: `Calendar-month buyer position ${b} (open-market): ${METRICS[m].label} exceeds matched non-event stock-days (volatility + momentum + liquidity, same month/tier).` }))));
// S2 — executable net excess level
fam("S2-cal-net-level", TEST_BUCKETS.flatMap((b) => ["N1", "N2", "N3", "N5", "N10"].map((m) => ({
  id: `sequence-S2-cal-b${b}-${m}`, kind: "level", metric: m, ...base("cal", "om"), sel: { bucket: b },
  statement: `Calendar-month buyer position ${b}: ${METRICS[m].label} (tier cost ×1) differs from 0.` }))));
// S3 — net excess minus matched controls (insider-specific residual)
fam("S3-cal-net-vs-volMom", TEST_BUCKETS.flatMap((b) => ["N1", "N3", "N5"].map((m) => ({
  id: `sequence-S3-cal-b${b}-${m}`, kind: "ctl", set: "volMom", metric: m, ...base("cal", "om"), sel: { bucket: b },
  statement: `Calendar-month buyer position ${b}: ${METRICS[m].label} minus volMom-matched controls differs from 0.` }))));
// S4 — position k vs position 1
fam("S4-cal-vs-pos1", TEST_BUCKETS.slice(1).flatMap((b) => ["T5W2", "T10W5", "N3"].map((m) => ({
  id: `sequence-S4-cal-b${b}-vs1-${m}`, kind: "diff", metric: m, ...base("cal", "om"), A: { bucket: b }, B: { bucket: "1" },
  statement: `Calendar-month position ${b} vs position 1: ${METRICS[m].label} differs.` }))));
// S5 — position bucket vs all other open-market purchase filings (all-purchase baseline, incl. repeat filings)
fam("S5-cal-vs-allOther", TEST_BUCKETS.flatMap((b) => ["T10W5", "N3"].map((m) => ({
  id: `sequence-S5-cal-b${b}-vsAll-${m}`, kind: "diffAll", metric: m, ...base("cal", "om"), A: { bucket: b },
  statement: `Calendar-month position ${b} vs every other open-market purchase filing of the period: ${METRICS[m].label} differs.` }))));
// S6 — momentum check: residual vs volatility-only controls and vs controls that also match the entry gap
fam("S6-cal-momentum-check", TEST_BUCKETS.flatMap((b) => ["volOnly", "volMomGap"].flatMap((set) => ["T10W5", "N3"].map((m) => ({
  id: `sequence-S6-cal-b${b}-${set}-${m}`, kind: "ctl", set, metric: m, ...base("cal", "om"), sel: { bucket: b },
  statement: `Calendar-month position ${b}: ${METRICS[m].label} minus ${set === "volOnly" ? "volatility+liquidity-only" : "volatility+momentum+entry-gap"}-matched controls differs from 0.` })))));
// S7 — the largest purchase
const M5 = ["T5W2", "T10W5", "N1", "N3", "N5"];
fam("S7-largest", [
  ...M5.map((m) => ({ id: `sequence-S7a-cal-largestSoFar-${m}`, kind: "diff", metric: m, ...base("cal", "om"), A: { minPos: 2, largestSoFar: true }, B: { minPos: 2, largestSoFar: false },
    statement: `Calendar month, positions >= 2: a new buyer whose amount is the largest so far (point in time) vs not — ${METRICS[m].label}.` })),
  ...M5.map((m) => ({ id: `sequence-S7b-roll-largestSoFar-${m}`, kind: "diff", metric: m, ...base("roll", "om"), A: { minPos: 2, largestSoFar: true }, B: { minPos: 2, largestSoFar: false },
    statement: `Rolling 30 days, positions >= 2: largest so far (point in time) vs not — ${METRICS[m].label}.` })),
  ...M5.map((m) => ({ id: `sequence-S7c-calFiling-largestFilingSoFar-${m}`, kind: "diff", metric: m, source: "fseq", grouping: "cal", universe: "om", period: "discover", A: { minSeq: 2, largestFilingSoFar: true }, B: { minSeq: 2, largestFilingSoFar: false },
    statement: `Calendar month, every open-market filing after the month's first (new buyers AND repeat buys): the largest single filing so far vs not — ${METRICS[m].label}.` })),
  ...["T10W5", "N3"].map((m) => ({ id: `sequence-S7d-cal-largestSoFar-vsCtl-${m}`, kind: "ctl", set: "volMom", metric: m, ...base("cal", "om"), sel: { minPos: 2, largestSoFar: true },
    statement: `Calendar month, positions >= 2 that are the largest so far: ${METRICS[m].label} minus volMom controls.` })),
  ...M5.map((m) => ({ id: `sequence-S7e-cal-eventualLargest-${m}`, kind: "diff", metric: m, ...base("cal", "om"), A: { minEventual: 2, eventualLargest: true }, B: { minEventual: 2, eventualLargest: false },
    statement: `DESCRIPTIVE / NOT TRADABLE. Calendar months with >= 2 buyers: the buyer who eventually had the month's largest total vs the others — ${METRICS[m].label}.` })),
]);
// S8 — interactions with economic logic (cal, om, positions >= 2 unless stated)
const M2 = ["T10W5", "N3"];
const inter = [
  ["role-ceoLate", "Positions >= 3: CEO vs non-CEO buyers", { minPos: 3, f: "ceo" }, { minPos: 3, f: "notCeo" }],
  ["role-ceoLateVsCeoFirst", "CEO buyers: position >= 2 vs position 1", { minPos: 2, f: "ceo" }, { bucket: "1", f: "ceo" }],
  ["role-cfo", "Positions >= 2: CFO vs other buyers", { minPos: 2, f: "cfo" }, { minPos: 2, f: "notCfo" }],
  ["role-director", "Positions >= 3: director (primary role) vs others", { minPos: 3, f: "director" }, { minPos: 3, f: "notDirector" }],
  ["esc-2xMax", "Positions >= 2: amount >= 2× the previous largest buyer vs < 1×", { minPos: 2, f: "ratioMaxGe2" }, { minPos: 2, f: "ratioMaxLt1" }],
  ["own-DvsI", "Positions >= 2: direct vs indirect ownership", { minPos: 2, f: "ownD" }, { minPos: 2, f: "ownI" }],
  ["hold-firstPos", "Positions >= 2: no prior holdings (first position) vs adding", { minPos: 2, f: "firstPos" }, { minPos: 2, f: "adding" }],
  ["chart-dd30", "Positions >= 2: >= 30% below the 60-session high vs not", { minPos: 2, f: "dd30" }, { minPos: 2, f: "notDd30" }],
  ["chart-consolidation", "Positions >= 2: tight 20-session range (range20 / (vol60·√20) <= 1.2) vs not", { minPos: 2, f: "tight" }, { minPos: 2, f: "notTight" }],
  ["chart-breakout", "Positions >= 2: close above the prior 20-session high vs not", { minPos: 2, f: "breakout" }, { minPos: 2, f: "notBreakout" }],
  ["speed-fast", "Positions >= 2: <= 3 days after buyer #1 vs > 10 days", { minPos: 2, f: "fast" }, { minPos: 2, f: "slow" }],
];
const slopes = [
  ["esc-ratioMeanSlope", "Positions >= 2: rank slope of amount / mean of earlier buyers", "ratioPrevMean"],
  ["hold-pctSlope", "Positions >= 2 adding to a position: rank slope of shares bought / prior holdings", "pctOfPrior"],
  ["accum-slope", "Positions >= 2: rank slope of accumulated month-to-date dollars", "accumUsd"],
  ["speed-slope", "Positions >= 2: rank slope of days since buyer #1", "daysSinceFirst"],
];
fam("S8-cal-interactions", [
  ...inter.flatMap(([k, txt, A, B]) => M2.map((m) => ({ id: `sequence-S8-cal-${k}-${m}`, kind: "diff", metric: m, ...base("cal", "om"), A, B, statement: `${txt} — ${METRICS[m].label}.` }))),
  ...slopes.flatMap(([k, txt, z]) => M2.map((m) => ({ id: `sequence-S8-cal-${k}-${m}`, kind: "slope", metric: m, ...base("cal", "om"), sel: { minPos: 2 }, z, statement: `${txt} — ${METRICS[m].label} (top-vs-bottom spread).` }))),
]);
// S9 — rolling 30-day positions
fam("S9-roll", [
  ...TEST_BUCKETS.flatMap((b) => ["T5W2", "T10W5"].map((m) => ({ id: `sequence-S9-roll-b${b}-${m}-vsCtl`, kind: "ctl", set: "volMom", metric: m, ...base("roll", "om"), sel: { bucket: b },
    statement: `Rolling-30-day buyer position ${b}: ${METRICS[m].label} minus volMom controls.` }))),
  ...TEST_BUCKETS.flatMap((b) => ["N1", "N3", "N5"].map((m) => ({ id: `sequence-S9-roll-b${b}-${m}-level`, kind: "level", metric: m, ...base("roll", "om"), sel: { bucket: b },
    statement: `Rolling-30-day buyer position ${b}: ${METRICS[m].label} differs from 0.` }))),
  ...TEST_BUCKETS.slice(1).flatMap((b) => ["T10W5", "N3"].map((m) => ({ id: `sequence-S9-roll-b${b}-vs1-${m}`, kind: "diff", metric: m, ...base("roll", "om"), A: { bucket: b }, B: { bucket: "1" },
    statement: `Rolling-30-day position ${b} vs position 1: ${METRICS[m].label} differs.` }))),
]);
// S10 — all code-P variant (offerings and fund allocations kept as separate classes)
fam("S10-allp", [
  ...["offering", "entity", "unknown"].flatMap((c) => M2.map((m) => ({ id: `sequence-S10-allp-${c}-vsOm-${m}`, kind: "diff", metric: m, ...base("cal", "allp"), A: { f: `cls_${c}` }, B: { f: "cls_om" },
    statement: `All code-P calendar-month signals: positions triggered by ${c} filings vs by open-market filings — ${METRICS[m].label}.` }))),
  ...TEST_BUCKETS.map((b) => ({ id: `sequence-S10-allp-b${b}-T10W5-vsCtl`, kind: "ctl", set: "volMom", metric: "T10W5", ...base("cal", "allp"), sel: { bucket: b },
    statement: `All code-P calendar-month position ${b}: touch +10% within 5 sessions minus volMom controls.` })),
  ...TEST_BUCKETS.map((b) => ({ id: `sequence-S10-allp-b${b}-N3-level`, kind: "level", metric: "N3", ...base("cal", "allp"), sel: { bucket: b },
    statement: `All code-P calendar-month position ${b}: net excess N=3 differs from 0.` })),
]);
// S11 — confirmation replication of pre-specified cells (looked at once; never used for tuning)
fam("S11-confirm", [
  ...TEST_BUCKETS.flatMap((b) => [["T10W5", "ctl"], ["N3", "level"], ["N3", "ctl"]].map(([m, kind]) => ({ id: `sequence-S11-cal-b${b}-${m}-${kind}`, kind, set: kind === "ctl" ? "volMom" : undefined, metric: m, ...base("cal", "om", "confirm"), sel: { bucket: b },
    statement: `CONFIRMATION. Calendar-month position ${b}: ${METRICS[m].label}${kind === "ctl" ? " minus volMom controls" : ""}.` }))),
  ...["T10W5", "N3"].map((m) => ({ id: `sequence-S11-cal-largestSoFar-${m}`, kind: "diff", metric: m, ...base("cal", "om", "confirm"), A: { minPos: 2, largestSoFar: true }, B: { minPos: 2, largestSoFar: false },
    statement: `CONFIRMATION. Calendar month, positions >= 2: largest so far vs not — ${METRICS[m].label}.` })),
  ...TEST_BUCKETS.map((b) => ({ id: `sequence-S11-roll-b${b}-T10W5-ctl`, kind: "ctl", set: "volMom", metric: "T10W5", ...base("roll", "om", "confirm"), sel: { bucket: b },
    statement: `CONFIRMATION. Rolling-30-day position ${b}: touch +10% within 5 sessions minus volMom controls.` })),
]);

const famSize = new Map(); for (const t of T) famSize.set(t.family, (famSize.get(t.family) || 0) + 1);
for (const t of T) t.familySize = famSize.get(t.family);
export const TESTS = T;

// ---- selectors (shared by analyze.mjs) ----
export const FILTERS = {
  ceo: (s) => s.primaryRole === "CEO", notCeo: (s) => s.primaryRole !== "CEO",
  cfo: (s) => s.primaryRole === "CFO", notCfo: (s) => s.primaryRole !== "CFO",
  director: (s) => s.primaryRole === "Director", notDirector: (s) => s.primaryRole !== "Director",
  ratioMaxGe2: (s) => s.ratioPrevMax != null && s.ratioPrevMax >= 2, ratioMaxLt1: (s) => s.ratioPrevMax != null && s.ratioPrevMax < 1,
  ownD: (s) => s.own === "D", ownI: (s) => s.own === "I",
  firstPos: (s) => s.holdValid && s.priorNearZero === true, adding: (s) => s.holdValid && s.priorNearZero === false,
  dd30: (s) => s.feat?.dd60 != null && s.feat.dd60 <= -0.3, notDd30: (s) => s.feat?.dd60 != null && s.feat.dd60 > -0.3,
  tight: (s) => s.feat?.tight != null && s.feat.tight <= 1.2, notTight: (s) => s.feat?.tight != null && s.feat.tight > 1.2,
  breakout: (s) => s.feat?.breakout20 === true, notBreakout: (s) => s.feat?.breakout20 === false,
  fast: (s) => s.daysSinceFirst != null && s.daysSinceFirst <= 3, slow: (s) => s.daysSinceFirst != null && s.daysSinceFirst > 10,
  cls_om: (s) => s.cls === "om", cls_offering: (s) => s.cls === "offering", cls_entity: (s) => s.cls === "entity", cls_unknown: (s) => s.cls === "unknown" || s.cls === "unclassified",
};
export function matchSel(s, sel = {}) {
  if (sel.bucket && tb(s.position) !== sel.bucket) return false;
  if (sel.minPos && !(s.position >= sel.minPos)) return false;
  if (sel.minSeq && !(s.seqIndex >= sel.minSeq)) return false;
  if (sel.largestSoFar != null && s.isLargestSoFar !== sel.largestSoFar) return false;
  if (sel.largestFilingSoFar != null && s.largestFilingSoFar !== sel.largestFilingSoFar) return false;
  if (sel.minEventual && !(s.eventualBuyers >= sel.minEventual)) return false;
  if (sel.eventualLargest != null && !!s.isEventualLargest !== sel.eventualLargest) return false;
  if (sel.f && !FILTERS[sel.f](s)) return false;
  return true;
}
