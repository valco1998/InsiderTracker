// deep4/behavior/candDefs.mjs — exact strategy rules (baselines + candidates) and the frozen confirmation plan.
// Selection context is point-in-time: family-A prior profiles (defs.profileOf) and family-C records (trackLib.computeRecords,
// history.mjs) computed over ALL visible rows (design history + the evaluated segment), each at the event's own decision time.
import { readJson, group, isPrimaryPurchase } from "./common.mjs";
import { profileOf } from "./defs.mjs";
import { STYLE_RULES_FILE } from "./styles.mjs";
import { computeRecords, createHistory } from "./trackLib.mjs";

export function prepareContext(rows, { segment }) {
  const th = readJson(STYLE_RULES_FILE).thresholds;
  const byPerson = group(rows, (r) => r.person);
  for (const xs of byPerson.values()) xs.sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : a.key < b.key ? -1 : 1));
  const evs = rows.filter((r) => r.segment === segment && isPrimaryPurchase(r));
  const profile = new Map(evs.map((e) => [e.key, profileOf(e, byPerson.get(e.person), th)]));
  const H = createHistory(rows);
  const recs = computeRecords(H, evs);
  return { th, segment, profile, recs, H, segRows: rows.filter((r) => r.segment === segment) };
}

// ---------------- baselines (always reported) ----------------
export const BASELINES = [
  { id: "behavior.S0.all", kind: "baseline", text: "every primary purchase of the segment (no selection); entry first MOO-eligible open; exit close of the last session <= entry + 30 calendar days; tier x1 costs; 20 equal slots; 1 position per issuer",
    select: (e, ctx) => e.segment === ctx.segment },
  { id: "behavior.S0.liq", kind: "baseline", text: "as behavior.S0.all, restricted to the three most liquid cost tiers (panel costBps <= 35 bps per side, i.e. dv20 tiers 5/15/35)",
    select: (e, ctx) => e.segment === ctx.segment && e.costBps != null && e.costBps <= 35 },
];
// ---------------- candidates (filled only if justified by families A / C on the design segment) ----------------
// NONE: no family-A rule had a positive primary mean with q < 0.10 (best: A11 +1.55%, p 0.31; A04 +0.87%, p 0.45); family C's only
// BH survivor (C04, rank rho 0.117) ranks repeat buyers whose every quintile is negative; C08 / C09 / C10 selections are negative.
export const CANDIDATES = [];
// ---------------- exploratory reference (POST-HOC; not a candidate; verdict capped at PROMISING BUT UNVALIDATED) ----------------
// Registered after the design reference row "firstEver" (05_familyA.mjs references) had been seen: B_xsNet30 +0.59% (t 0.93),
// vs controls +2.06 pts (p 0.003); repeats -2.69%. Deep 3's issuer-level "#1 buyer" failed confirmation (related, not identical).
export const EXPLORATORY = [
  { id: "behavior.S1x.firstObserved", kind: "exploratory", params: { pFirstEver: 1 },
    text: "primary purchases that are the buyer's FIRST observed purchase filing (panel pFirstEver = 1: no earlier purchase filing of any class by the same person since 2025-12-01, accepted before t); same execution as behavior.S0.all",
    select: (e, ctx) => e.segment === ctx.segment && e.pFirstEver === 1 },
];
export const ALL_RULES = () => [...BASELINES, ...CANDIDATES, ...EXPLORATORY];
export const CONFIRM_PLAN = {
  runOnce: true,
  strategies: "behavior.S0.all, behavior.S0.liq (baselines) and behavior.S1x.firstObserved (post-hoc exploratory reference): runRule (stratLib) on confirmation primary purchases, market strategyLib.marketFor(null), with matched-control trades and the nearest-control (no-insider) strategy",
  passCriteria: {
    note: "declared before the confirmation run; with ~2.5 months of confirmation no rule can be VALIDATED by confirmation alone",
    "behavior.S1x.firstObserved": "independent-trade mean xsNet > 0 AND issuer-clustered t >= 1.65 AND vs-controls diff > 0 AND x2-cost mean > 0 AND S1x mean > behavior.S0.all mean; otherwise REJECTED",
    familyC_C04: "confirm Spearman rho > 0 with permutation p < 0.05 → persistence replicated (ranking only); else not replicated",
  },
  familyCPermutations: 200,
  familyC: "C01-C09 statistics on confirmation primary purchases (history.mjs over design + confirmation rows, matured-by-decision-time only); rank tests with R = 200 within-month joint permutations",
  walkForward: "walkforward.mjs over the confirmation months (2026-06 partial, 07, 08): C10 procedure (pool EB prior = history.poolPriorAt at the month start; select iff person matured n >= 1 and EB estimate > 0) with the 30-day record, and the same with the 5-day record; target B_xsNet30",
  familyAReplication: "the 11 frozen family-A selection rules (defs.mjs) on confirmation purchases: B_xsNet30, B_xsNet5, vs matched controls (descriptive replication)",
  contrasts: "first observed purchase vs repeat; purchase-rank buckets (1st, 2nd, 3rd-5th, 6th+) — descriptive",
  styleConsistency: "features only: share of DIP/LOW/DEEP/MOM/CONTRA/FOLLOW over a person's design-period episodes vs the label of their first confirmation-period episode (all, and at a new issuer); Pearson r, within-month permutation, R = 2000",
};
