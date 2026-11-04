// server/scripts/research/deep2/execution/grid.mjs — the complete, pre-declared test grid of the
// execution agent (ids, families, honest family sizes, machine-checkable specs). register.mjs logs
// every entry BEFORE run.mjs computes anything; run.mjs evaluates exactly these specs.
import { TRIGGERS, HORIZONS_B } from "./execLib.mjs";

const TRIG = Object.keys(TRIGGERS);
const COSTS = { tier1: { costModel: "tier", costMultiplier: 1 }, tier2: { costModel: "tier", costMultiplier: 2 }, tier3: { costModel: "tier", costMultiplier: 3 }, spread: { costModel: "spread", costMultiplier: 1 } };
const COST_LABEL = { tier1: "liquidity-tier cost ×1", tier2: "liquidity-tier cost ×2", tier3: "liquidity-tier cost ×3", spread: "price-level half-spread + impact model" };
const ENTRIES = {
  nextOpen: { entry: "nextOpen", delaySessions: 0, label: "next regular open after acceptance + 60 s (stage-C entry)" },
  delay1: { entry: "nextOpen", delaySessions: 1, label: "next-open entry delayed by one session" },
  moc: { entry: "sameDayClose", delaySessions: 0, label: "same-day close (MOC) for filings published on a session day before 15:30 ET" },
};
const MECH_B = "Insider purchases reveal private information / perceived undervaluation; if the market absorbs the filing slowly (limited attention to small caps), prices drift for several sessions after publication. Execution question: is the drift still there after realistic fills, costs and delays?";

export const FAMILIES = {};
export const TESTS = [];
const add = (family, t) => { TESTS.push({ family, ...t }); };

// Track B grid: 5 trigger sets × 3 entries × 4 horizons × 4 cost models = 240.
for (const trig of TRIG) for (const [ek, ev] of Object.entries(ENTRIES)) for (const N of HORIZONS_B) for (const [ck, cv] of Object.entries(COSTS)) {
  add("execution-B-grid", { id: `execution-B-${trig}-${ek}-h${N}-${ck}`, kind: "eval", trig,
    opts: { track: "B", entry: ev.entry, delaySessions: ev.delaySessions, exitSessions: N, ...cv },
    statement: `Track B, ${TRIGGERS[trig].label}: buy at the ${ev.label}; sell at the close of session ${N} after entry; ${COST_LABEL[ck]}. H1: mean net excess return vs SPY > 0 (issuer-clustered).`,
    rationale: MECH_B });
}
// Paired execution comparisons: one-session delay cost (5 × 4) + MOC overnight gap for intraday filings (5) = 25.
for (const trig of TRIG) {
  for (const N of HORIZONS_B) add("execution-B-paired", { id: `execution-Bpair-${trig}-delayCost-h${N}`, kind: "pairDelay", trig, N,
    statement: `Track B, ${TRIGGERS[trig].label}, N=${N}: paired gross excess (next-open entry) − (one-session-delayed entry) on the same events ≠ 0.`,
    rationale: "If the edge is fast information diffusion, the first open carries most of the repricing and a one-session delay loses part of it; the paired difference measures the cost of a late fill." });
  add("execution-B-paired", { id: `execution-Bpair-${trig}-mocGap`, kind: "mocGap", trig,
    statement: `Track B, ${TRIGGERS[trig].label}, filings published 09:30–15:30 ET on a session day: overnight excess return from the same-day close (MOC) to the next open (stock − SPY) ≠ 0.`,
    rationale: "For intraday filings the next-open entry gives up the publication-day close → next open move; entering at the same-day close captures it. Positive = MOC entry is better." });
}
// Capacity-conditioned Track B: events supporting a $10k / $50k / $250k position (1% of ADV20), next open, tier ×1: 5 × 3 × 4 = 60.
for (const trig of TRIG) for (const size of [1e4, 5e4, 2.5e5]) for (const N of HORIZONS_B) {
  add("execution-B-capacity", { id: `execution-Bcap-${trig}-${size / 1e3}k-h${N}`, kind: "eval", trig,
    opts: { track: "B", entry: "nextOpen", exitSessions: N, costModel: "tier", costMultiplier: 1, capacityPct: 0.01, minPositionUsd: size },
    statement: `Track B, ${TRIGGERS[trig].label}, only events whose 1% of 20-session dollar volume ≥ $${size / 1e3}k: next open → close of session ${N}, tier cost ×1. H1: mean net excess vs SPY > 0.`,
    rationale: "Size restricts the trade to liquid names, where pricing is more efficient; tests whether any edge survives at a tradable size." });
}
// Track A MOO→MOC on the first session: 5 × 4 costs = 20.
for (const trig of TRIG) for (const [ck, cv] of Object.entries(COSTS)) {
  add("execution-A-mooMoc", { id: `execution-Amoc-${trig}-${ck}`, kind: "eval", trig, opts: { track: "A", entry: "mooMoc", exitSessions: 0, ...cv },
    statement: `Track A, ${TRIGGERS[trig].label}: MOO at the first session open ≥ acceptance + 60 s, MOC at the same session's close; ${COST_LABEL[ck]}. H1: mean net excess vs SPY (open→close) > 0.`,
    rationale: "Same-session continuation of the publication repricing after the opening auction (vs reversal of the opening gap). Unconditional on the open (no gap conditioning)." });
}
// Track A after-hours (cached deep-1 sample): 4 groups × 4 latencies × 2 exits × 3 costs = 96.
const AH_GROUPS = { G0_pooled: "pooled after-close sample (unweighted, all strata)", S1_ceoCfoOM250k: "CEO/CFO personal open-market ≥ $250k (census of after-close filings)", S2_otherOM: "other open-market (random sample)", S3_notOM: "venue not open market (random sample)" };
for (const [g, gl] of Object.entries(AH_GROUPS)) for (const lat of [1, 5, 15, 30]) for (const ex of ["nextOpen", "nextClose"]) for (const bps of [25, 50, 100]) {
  add("execution-A-ah", { id: `execution-Aah-${g}-L${lat}-${ex}-c${bps}`, kind: "ah", group: g,
    opts: { track: "A", entry: "ah", latencyMinutes: lat, exitSessions: ex, costModel: bps, costMultiplier: 1 },
    statement: `Track A after-hours, ${gl}: buy at the first eligible SIP trade ≥ acceptance + ${lat} min (16:00–20:00 ET), sell at the ${ex === "nextOpen" ? "next regular open" : "next regular close"}; ${bps} bps per side. H1: mean net excess vs SPY (16:00 close → exit) > 0.`,
    rationale: "After-close filings are repriced in thin extended-hours trading and at the next open; a fast after-hours buyer captures the overnight repricing. The edge should decay with detection latency." });
}
// Execution traps: suspect symbols excluded (stageA.suspectSymbols): next open tier ×1 (5 × 4) + MOO→MOC tier ×1 (5) = 25.
for (const trig of TRIG) {
  for (const N of HORIZONS_B) add("execution-traps", { id: `execution-traps-noSuspect-${trig}-h${N}`, kind: "eval", trig,
    opts: { track: "B", entry: "nextOpen", exitSessions: N, costModel: "tier", costMultiplier: 1, excludeSuspects: true },
    statement: `Track B, ${TRIGGERS[trig].label}, excluding stage-A suspect (corrupt-bar / extreme-reversal) symbols: next open → close of session ${N}, tier ×1. H1: mean net excess > 0.`,
    rationale: "Bad prints and broken split adjustments create huge spurious returns; results must not depend on them." });
  add("execution-traps", { id: `execution-traps-noSuspect-${trig}-mooMoc`, kind: "eval", trig, opts: { track: "A", entry: "mooMoc", exitSessions: 0, costModel: "tier", costMultiplier: 1, excludeSuspects: true },
    statement: `Track A MOO→MOC, ${TRIGGERS[trig].label}, excluding stage-A suspect symbols, tier ×1. H1: mean net excess > 0.`,
    rationale: "Robustness of the same-session result to corrupt bars." });
  // Opening-auction cut-off (Nasdaq MOO orders by 09:28 ET): pre-market filings whose acceptance + 60 s is later
  // cannot join that day's opening cross and move to the next session's open. Next open tier ×1 (4) + MOO→MOC (1).
  for (const N of HORIZONS_B) add("execution-traps", { id: `execution-traps-mooCutoff-${trig}-h${N}`, kind: "eval", trig,
    opts: { track: "B", entry: "nextOpen", exitSessions: N, costModel: "tier", costMultiplier: 1, mooCutoff: "09:28:00" },
    statement: `Track B, ${TRIGGERS[trig].label}, with the 09:28 ET MOO cut-off enforced: next achievable open → close of session ${N}, tier ×1. H1: mean net excess > 0.`,
    rationale: "Stage C allows a same-day open fill when acceptance + 60 s ≤ 09:30:00, which an auction order cannot achieve after 09:28; checks the result does not rely on unachievable fills." });
  add("execution-traps", { id: `execution-traps-mooCutoff-${trig}-mooMoc`, kind: "eval", trig, opts: { track: "A", entry: "mooMoc", exitSessions: 0, costModel: "tier", costMultiplier: 1, mooCutoff: "09:28:00" },
    statement: `Track A MOO→MOC, ${TRIGGERS[trig].label}, with the 09:28 ET MOO cut-off enforced, tier ×1. H1: mean net excess > 0.`,
    rationale: "Same as above for the same-session trade." });
}

// All execution traps fixed at once (added after the timing audit found 47 zero-volume entry bars — counts only,
// no outcome seen): suspects excluded + 09:28 MOO cut-off + zero-volume fill bars dropped. 5 × (4 + 1) = 25.
for (const trig of TRIG) {
  const clean = { excludeSuspects: true, mooCutoff: "09:28:00", requireVolume: true };
  for (const N of HORIZONS_B) add("execution-traps-clean", { id: `execution-trapsClean-${trig}-h${N}`, kind: "eval", trig,
    opts: { track: "B", entry: "nextOpen", exitSessions: N, costModel: "tier", costMultiplier: 1, ...clean },
    statement: `Track B, ${TRIGGERS[trig].label}, all execution traps fixed (suspect symbols excluded, 09:28 MOO cut-off, zero-volume fill bars dropped): next achievable open → close of session ${N}, tier ×1. H1: mean net excess > 0.`,
    rationale: "The realistic version of the primary Track B specification." });
  add("execution-traps-clean", { id: `execution-trapsClean-${trig}-mooMoc`, kind: "eval", trig, opts: { track: "A", entry: "mooMoc", exitSessions: 0, costModel: "tier", costMultiplier: 1, ...clean },
    statement: `Track A MOO→MOC, ${TRIGGERS[trig].label}, all execution traps fixed, tier ×1. H1: mean net excess > 0.`,
    rationale: "The realistic version of the same-session specification." });
}

// Descriptive portfolio simulations (no p-values; not in BH): 5 × 21 + 2 = 107 per period.
export const PORTFOLIOS = [];
for (const trig of TRIG) {
  for (const N of HORIZONS_B) {
    PORTFOLIOS.push({ id: `execution-pf-${trig}-nextOpen-h${N}-tier1`, trig, opts: { entry: "nextOpen", exitSessions: N, costModel: "tier", costMultiplier: 1 }, sim: { slots: 20 } });
    PORTFOLIOS.push({ id: `execution-pf-${trig}-nextOpen-h${N}-tier2`, trig, opts: { entry: "nextOpen", exitSessions: N, costModel: "tier", costMultiplier: 2 }, sim: { slots: 20 } });
    PORTFOLIOS.push({ id: `execution-pf-${trig}-delay1-h${N}-tier1`, trig, opts: { entry: "nextOpen", delaySessions: 1, exitSessions: N, costModel: "tier", costMultiplier: 1 }, sim: { slots: 20 } });
    PORTFOLIOS.push({ id: `execution-pf-${trig}-moc-h${N}-tier1`, trig, opts: { entry: "sameDayClose", exitSessions: N, costModel: "tier", costMultiplier: 1 }, sim: { slots: 20 } });
    PORTFOLIOS.push({ id: `execution-pf-${trig}-nextOpen-h${N}-tier1-cap1M`, trig, opts: { entry: "nextOpen", exitSessions: N, costModel: "tier", costMultiplier: 1 }, sim: { slots: 20, accountSize: 1e6 } });
  }
  PORTFOLIOS.push({ id: `execution-pf-${trig}-mooMoc-tier1`, trig, opts: { entry: "mooMoc", exitSessions: 0, costModel: "tier", costMultiplier: 1 }, sim: { slots: 20 } });
}
for (const ex of ["nextOpen", "nextClose"]) PORTFOLIOS.push({ id: `execution-pf-S1ah-L1-${ex}-c50`, trig: "T3_ceoCfoOM250k", ahOnly: true, opts: { entry: "ah", latencyMinutes: 1, exitSessions: ex, costModel: 50, costMultiplier: 1 }, sim: { slots: 20 } });

for (const t of TESTS) FAMILIES[t.family] = (FAMILIES[t.family] || 0) + 1;
FAMILIES["execution-portfolio (descriptive)"] = PORTFOLIOS.length;
export const AH_GROUP_LABELS = AH_GROUPS;
export { COSTS, COST_LABEL, ENTRIES };
