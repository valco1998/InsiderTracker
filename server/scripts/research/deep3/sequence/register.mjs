// deep3/sequence/register.mjs — registers every pre-specified test (tests.mjs) in the deep-3 registry BEFORE any outcome
// is computed. Idempotent: ids already registered are skipped.   node scripts/research/deep3/sequence/register.mjs
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regMany, writePretty, existsOut, myRegistry } from "./common.mjs";
import { TESTS, MIN_N, MIN_ISSUERS } from "./tests.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(here, "tests.mjs"))).digest("hex");
// Re-runs are no-ops; a NEW test id may never be registered after outcomes exist (registration precedes computation).
const have = new Set(myRegistry().map((x) => x.id));
const fresh = TESTS.filter((t) => !have.has(t.id));
if (fresh.length && existsOut("outcomes.json")) throw new Error(`outcomes.json already exists — refusing to register ${fresh.length} new id(s) after outcomes were computed`);
if (!fresh.length) { console.log(`all ${TESTS.length} tests already registered (sha256 of tests.mjs now ${sha})`); process.exit(0); }
const RATIONALE = {
  "S1-cal-touch-vs-volMom": "A later distinct insider joining the month's buying is independent confirmation (agreement among insiders). If the market under-reacts to the k-th buyer, post-entry upside should exceed volatility/momentum/liquidity-matched non-event stock-days; touch rates scale with volatility, so only the matched difference is informative.",
  "S2-cal-net-level": "Executable lens: entry at a publicly obtainable official open, exit at an official close, tier costs, minus SPY. A positive level would be a tradable rule.",
  "S3-cal-net-vs-volMom": "Separates the insider-specific residual from what similar stock-days do (momentum, reversal, volatility, liquidity).",
  "S4-cal-vs-pos1": "Joining later adds confirmation but follows more prior price reaction; tests whether later positions differ from the first buyer.",
  "S5-cal-vs-allOther": "Is a given position more informative than the typical open-market purchase filing (all-purchase baseline incl. repeat buys)?",
  "S6-cal-momentum-check": "Momentum check: residual vs volatility-only controls (momentum unmatched) and vs controls that also match the entry gap (information priced at the open).",
  "S7-largest": "The largest buyer so far is the highest-conviction insider known at the time; the eventual largest is descriptive only (look-ahead).",
  "S8-cal-interactions": "Economic interactions: a CEO joining late, escalation vs earlier buyers, conviction (% of holdings), accumulated dollars, chart context (drawdown, consolidation, breakout), cluster speed, direct vs indirect ownership.",
  "S9-roll": "Rolling 30-day positions remove calendar-month boundary artefacts (a buyer on the 1st of a month restarts the count in the calendar version).",
  "S10-allp": "All code-P variant: offerings, plan purchases and fund/entity allocations kept as separate classes, so their behaviour is visible rather than mixed into genuine buys.",
  "S11-confirm": "Pre-specified confirmation cells (Jun 15 – Aug 31, exits before Sep 1), evaluated once, never used for tuning.",
};
const recs = TESTS.map((t) => {
  const { sel, A, B, ...rest } = t;
  return { id: t.id, family: t.family, familySize: t.familySize, statement: t.statement, rationale: RATIONALE[t.family],
    spec: { kind: t.kind, set: t.set ?? null, metric: t.metric, source: t.source, grouping: t.grouping, universe: t.universe, period: t.period, sel: sel ?? null, A: A ?? null, B: B ?? null, z: t.z ?? null },
    minSample: { n: MIN_N, issuers: MIN_ISSUERS }, testsFileSha256: sha, bh: t.period === "discover" ? "global over this agent's discovery tests (S1–S10)" : "confirmation: same sign and p < 0.10" };
});
const n = regMany(recs);
const fams = {}; for (const t of TESTS) fams[t.family] = t.familySize;
writePretty("tests-spec.json", { registeredAt: new Date().toISOString(), testsFileSha256: sha, total: TESTS.length, families: fams, tests: recs });
console.log(`registered ${n} new ids (total ${TESTS.length}); families:`, fams, "sha256", sha);
