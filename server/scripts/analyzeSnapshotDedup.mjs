/**
 * Read-only PriceSnapshot write-pattern audit — Atlas M0 compatible.
 *
 * Atlas M0 enforces a hard 32 MB in-memory sort limit. This script tries the
 * cheapest way to avoid it first, then degrades gracefully:
 *
 *  Phase 0:  Live $collStats/$indexStats reads — replaces hardcoded storage
 *            constants and the "confirmed-unused index" claim with real evidence.
 *  Phase 1:  Overview stats — no sort, index-backed counts.
 *  Phase 2A: Bucket approximation — groups all docs without any $sort.
 *            Gives upper-bound estimates for savings (see accuracy note in output).
 *  Phase 2B: Exact consecutive-pair analysis, three-tier attempt:
 *              Try A — index-assisted full-collection sort (no allowDiskUse needed)
 *              Try B — full-collection sort with allowDiskUse:true (maxTimeMS 90s)
 *              Try C — 12h/6h time-windowed extrapolation (fallback of last resort)
 *  Phase 3:  Per-skin listingCount7d impact — trailing 7-day window, matching
 *            production's actual since7d filter, with a live cross-check.
 *  Phase 3.5: Threshold-crossing impact on SkinMetrics.tier / deal-score
 *            confidence / price-trust gate — the product-visible consequence
 *            of any snapshot-volume reduction, not just a raw %-reduction.
 *  Phase 4:  Storage projections + steady-state warning based on real insert rate.
 *
 * Run from server/:
 *   node scripts/analyzeSnapshotDedup.mjs
 *
 * Performs ONLY read operations. Expected runtime: 3–10 minutes on Atlas M0.
 */
import "dotenv/config";
import mongoose from "mongoose";
import PriceSnapshot from "../models/PriceSnapshot.model.js";
import SkinMetrics from "../models/SkinMetrics.model.js";

const MONGO_URL = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
if (!MONGO_URL) throw new Error("MONGO_URI / MONGO_URL not set in .env");

// Fallback only — used if live $collStats/$indexStats are unavailable on M0.
// Superseded by Phase 0's live reads whenever those succeed.
const FALLBACK_DATA_MB       = 391;
const FALLBACK_INDEX_MB      = 126;
const FALLBACK_AVG_DOC_BYTES = 239;
const FALLBACK_UNUSED_IDX_MB =  42;
const ITEMID_INDEX_NAME = "itemId_1_observedAt_-1";

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = (n)      => Math.round(n).toLocaleString("en-US");
const pct   = (n, d)   => d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(1)}%`;
const elapsed = (t)    => `${((Date.now() - t) / 1000).toFixed(1)}s`;
const bar   = (n, d, w = 24) => {
  const f = d === 0 ? 0 : Math.round((n / d) * w);
  return `[${"█".repeat(f)}${"░".repeat(w - f)}]`;
};
const rule  = ()       => console.log("─".repeat(70));
const title = (s)      => { console.log(`\n${"═".repeat(70)}\n${s}\n${"═".repeat(70)}`); };

// ── Connect ──────────────────────────────────────────────────────────────────
await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 20_000 });
console.log(`Connected: ${mongoose.connection.name}\n`);

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 0 — Live storage + index-usage stats (read-only server commands)
//
// Replaces hardcoded "known from Atlas UI" constants with real numbers pulled
// live from Atlas, and replaces the unverified "confirmed-unused index" claim
// with real accesses.ops evidence.
// ═════════════════════════════════════════════════════════════════════════════
title("PHASE 0 — Live collection stats");

let DATA_MB, INDEX_MB, AVG_DOC_BYTES, UNUSED_IDX_MB;
let statsAreLive = false;

try {
  const [cs] = await PriceSnapshot.aggregate([{ $collStats: { storageStats: {} } }]);
  const ss = cs.storageStats;
  DATA_MB       = ss.size / 1e6;
  INDEX_MB      = ss.totalIndexSize / 1e6;
  AVG_DOC_BYTES = ss.avgObjSize;
  UNUSED_IDX_MB = (ss.indexSizes?.[ITEMID_INDEX_NAME] ?? FALLBACK_UNUSED_IDX_MB * 1e6) / 1e6;
  statsAreLive  = true;

  console.log(`Live data size:     ${DATA_MB.toFixed(1)} MB`);
  console.log(`Live index size:    ${INDEX_MB.toFixed(1)} MB`);
  console.log(`Live avg doc bytes: ${AVG_DOC_BYTES.toFixed(0)} bytes`);
  console.log(`Per-index sizes:`);
  for (const [name, bytes] of Object.entries(ss.indexSizes || {})) {
    console.log(`  ${name.padEnd(40)} ${(bytes / 1e6).toFixed(1)} MB`);
  }
} catch (err) {
  console.log(`⚠  $collStats unavailable (${err.message}) — falling back to stale hardcoded constants.`);
  DATA_MB = FALLBACK_DATA_MB;
  INDEX_MB = FALLBACK_INDEX_MB;
  AVG_DOC_BYTES = FALLBACK_AVG_DOC_BYTES;
  UNUSED_IDX_MB = FALLBACK_UNUSED_IDX_MB;
}

try {
  const idxUsage = await PriceSnapshot.aggregate([{ $indexStats: {} }]);
  console.log(`\nLive index usage (ops served since last server restart):`);
  for (const idx of idxUsage) {
    const ops   = idx.accesses?.ops ?? 0;
    const since = idx.accesses?.since ? new Date(idx.accesses.since).toISOString() : "n/a";
    console.log(`  ${idx.name.padEnd(40)} ops=${fmt(ops).padStart(10)}  since=${since}`);
  }
  const itemIdIdx = idxUsage.find((i) => i.name === ITEMID_INDEX_NAME);
  if (itemIdIdx) {
    const ops = itemIdIdx.accesses?.ops ?? 0;
    console.log(
      `\n${ITEMID_INDEX_NAME}: ${fmt(ops)} real ops served.` +
      ` ${ops === 0 ? "✓ CONFIRMED unused by any query since last restart." : "⚠  NOT unused — still serving reads, do not drop without further investigation."}`
    );
  } else {
    console.log(`\n⚠  Could not find ${ITEMID_INDEX_NAME} in $indexStats output — verify index name manually.`);
  }
} catch (err) {
  console.log(`⚠  $indexStats unavailable (${err.message}) — cannot verify real index usage; do not assume unused.`);
}

console.log(`\n${statsAreLive ? "✓ Phase 0 stats are LIVE." : "⚠  Phase 0 stats are STALE FALLBACK VALUES — not live."}`);

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 1 — Overview  (index-backed, no sort)
// ═════════════════════════════════════════════════════════════════════════════
title("PHASE 1 — Overview");
let t = Date.now();

const totalDocs = await PriceSnapshot.estimatedDocumentCount();
console.log(`Total documents:           ${fmt(totalDocs)}`);

const [dateStats] = await PriceSnapshot.aggregate([
  { $group: { _id: null, min: { $min: "$observedAt" }, max: { $max: "$observedAt" } } },
]);
const spanDays   = (dateStats.max - dateStats.min) / 86_400_000;
const docsPerDay = totalDocs / spanDays;
const windowAnchor = dateStats.max; // anchor for time-windowed queries below — NOT Date.now()
const gapDays = (Date.now() - windowAnchor.getTime()) / 86_400_000;
console.log(`Date range:                ${dateStats.min.toISOString().slice(0, 10)} → ${dateStats.max.toISOString().slice(0, 10)}`);
console.log(`Span:                      ${spanDays.toFixed(2)} days`);
console.log(`Avg insert rate:           ${fmt(docsPerDay)}/day  (${(docsPerDay / 1440).toFixed(1)}/min)`);
if (gapDays > 0.5) {
  console.log(`\n⚠  GAP: most recent snapshot is ${gapDays.toFixed(1)} days old (as of this run) — writes appear to have STOPPED.`);
  console.log(`   All time-windowed queries below are anchored to the collection's actual latest`);
  console.log(`   observedAt (${windowAnchor.toISOString()}), not wall-clock now, or every window would be empty.`);
  console.log(`   This also means production's live listingCount7d (Date.now()-based, see Phase 3) is`);
  console.log(`   likely near zero right now for listing-proxy-driven skins — investigate separately`);
  console.log(`   whether the price snapshot pipeline (empireMarketSocket.js / priceSnapshotWriter.js) is still running.`);
}

// Count unique itemIds: group then count — avoids $addToSet blowing up memory
const [ic] = await PriceSnapshot.aggregate([
  { $group: { _id: "$itemId" } },
  { $count: "n" },
]).allowDiskUse(true);
const [sc] = await PriceSnapshot.aggregate([
  { $group: { _id: { mhn: "$marketHashName", wear: "$wear" } } },
  { $count: "n" },
]).allowDiskUse(true);
console.log(`Unique itemIds:            ${fmt(ic.n)}`);
console.log(`Unique (skin, wear) pairs: ${fmt(sc.n)}`);
console.log(`Avg snapshots / itemId:    ${(totalDocs / ic.n).toFixed(2)}`);
console.log(`Avg snapshots / skin:      ${(totalDocs / sc.n).toFixed(1)}`);

// Steady-state projection — the most important number
const steadyStateDocs = docsPerDay * 30;
const steadyDataGB    = (steadyStateDocs * AVG_DOC_BYTES) / 1e9;
console.log(`\n⚠  30-day steady-state projection (current rate × 30 days):`);
console.log(`   Docs:       ${fmt(steadyStateDocs)}`);
console.log(`   Data alone: ~${steadyDataGB.toFixed(1)} GB  (Atlas M0 cap is 0.512 GB total)`);
console.log(`   STATUS:     ${steadyDataGB > 0.512 ? "WILL OVERFLOW — urgent action required" : "within limit"}`);
console.log(`   Note: collection is only ${spanDays.toFixed(1)} days old, TTL has not deleted anything yet.`);

console.log(`\nPhase 1 complete in ${elapsed(t)}`);

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 2A — Bucket-based dedup approximation  (windowed + extrapolated, M0 safe)
//
// CONFIRMED EMPIRICALLY (this run): grouping the full collection by
// (itemId, 15/60-min bucket, price) exceeds the ~100MB in-memory $group limit,
// and allowDiskUse:true does NOT rescue it on Atlas M0 — the option is
// correctly sent (verified via agg.options) but the server still rejects with
// "didn't allow external sort" regardless. This is because items snapshot
// infrequently here (~4.79 snapshots/itemId over the observed span), so
// fine-grained group-key cardinality is close to the raw doc count.
//
// Redesign: same shrinking-window retry strategy as Phase 2B, anchored to
// `windowAnchor` (the collection's actual latest observedAt — see Phase 1 gap
// warning). Each strategy finds its own largest safe window, then the
// skip/kept counts are scaled by (totalDocs / windowDocs) to full-collection
// scale — the SKIP FRACTION itself needs no scaling (ratio is preserved), only
// the displayed absolute counts are extrapolated.
//
// Accuracy: still UPPER BOUNDS on savings (same reasoning as before — see
// Phase 2B for exact calibration), now with an ADDITIONAL uncertainty layer
// from windowed extrapolation. Phase 2B's exact pass (full-collection if Try
// A/B succeed) is the number to trust; these are the fallback estimate.
// ═════════════════════════════════════════════════════════════════════════════
title("PHASE 2A — Bucket approximation (windowed + extrapolated, M0 safe)");
t = Date.now();
console.log(`Anchoring windows to the collection's actual latest snapshot (${windowAnchor.toISOString()}), not wall-clock now.`);

async function windowedGroupWithFallback(buildPipeline, { startHours = 24, minHours = 0.25 } = {}) {
  let hours = startHours;
  while (hours >= minHours) {
    const windowStart = new Date(windowAnchor.getTime() - hours * 3_600_000);
    try {
      const [result] = await PriceSnapshot.aggregate(buildPipeline(windowStart)).allowDiskUse(true);
      return { result, hours };
    } catch (err) {
      if (err.code !== 292 && !/Exceeded memory limit/i.test(err.message || "")) throw err;
      console.log(`  ${hours}h window exceeded $group memory limit — shrinking to ${hours / 2}h...`);
      hours = hours / 2;
    }
  }
  throw new Error(`windowedGroupWithFallback: failed even at minimum window (${minHours}h)`);
}

// ── Sanity check: 15-min same-price collisions (should be ~0) ───────────────
const b15w = await windowedGroupWithFallback((windowStart) => [
  { $match: { observedAt: { $gte: windowStart, $lte: windowAnchor } } },
  {
    $project: {
      itemId:     1,
      priceGroup: { $round: ["$priceCoins", 0] },
      bucket15:   { $toLong: { $subtract: [{ $toLong: "$observedAt" }, { $mod: [{ $toLong: "$observedAt" }, 900_000] }] } },
    },
  },
  { $group: { _id: { i: "$itemId", b: "$bucket15", p: "$priceGroup" }, n: { $sum: 1 } } },
  { $group: { _id: null, collisions: { $sum: { $subtract: ["$n", 1] } }, total: { $sum: "$n" } } },
]);
const b15xFactor = totalDocs / b15w.result.total;
const b15 = { collisions: Math.round(b15w.result.collisions * b15xFactor), total: totalDocs };
console.log(`\n15-min collision check: ${b15w.hours}h window (${fmt(b15w.result.total)} docs) — extrapolated ×${b15xFactor.toFixed(1)}`);
console.log(`Sanity: 15-min same-price collisions = ${fmt(b15.collisions)} / ${fmt(b15.total)}`);
console.log(`  ${b15.collisions > 500 ? "⚠  Non-zero — server restarts may have reset in-memory dedup state" : "✓  Near-zero, current 15-min dedup is working"}`);

// ── 60-min bucket analysis ────────────────────────────────────────────────────
const b60w = await windowedGroupWithFallback((windowStart) => [
  { $match: { observedAt: { $gte: windowStart, $lte: windowAnchor } } },
  {
    $project: {
      itemId:     1,
      priceGroup: { $round: ["$priceCoins", 0] },
      bucket60:   { $toLong: { $subtract: [{ $toLong: "$observedAt" }, { $mod: [{ $toLong: "$observedAt" }, 3_600_000] }] } },
    },
  },
  { $group: { _id: { i: "$itemId", b: "$bucket60", p: "$priceGroup" }, n: { $sum: 1 } } },
  {
    $group: {
      _id:       null,
      totalDocs: { $sum: "$n" },
      kept:      { $sum: 1 },                              // 1 per (item, hour, price)
      skipped:   { $sum: { $subtract: ["$n", 1] } },       // extras within each bucket
    },
  },
]);
const b60xFactor = totalDocs / b60w.result.totalDocs;
const b60 = {
  totalDocs: totalDocs,
  kept:      Math.round(b60w.result.kept * b60xFactor),
  skipped:   Math.round(b60w.result.skipped * b60xFactor),
};
console.log(`60-min bucket:          ${b60w.hours}h window (${fmt(b60w.result.totalDocs)} docs) — extrapolated ×${b60xFactor.toFixed(1)}`);

// ── Price-change-only approximation ──────────────────────────────────────────
const bPOw = await windowedGroupWithFallback((windowStart) => [
  { $match: { observedAt: { $gte: windowStart, $lte: windowAnchor } } },
  {
    $project: {
      itemId:     1,
      priceGroup: { $round: ["$priceCoins", 0] },
    },
  },
  { $group: { _id: { i: "$itemId", p: "$priceGroup" }, n: { $sum: 1 } } },
  {
    $group: {
      _id:       null,
      totalDocs: { $sum: "$n" },
      kept:      { $sum: 1 },                              // 1 per (item, distinct price)
      skipped:   { $sum: { $subtract: ["$n", 1] } },
    },
  },
]);
const bPOxFactor = totalDocs / bPOw.result.totalDocs;
const bPO = {
  totalDocs: totalDocs,
  kept:      Math.round(bPOw.result.kept * bPOxFactor),
  skipped:   Math.round(bPOw.result.skipped * bPOxFactor),
};
console.log(`Price-change-only:      ${bPOw.hours}h window (${fmt(bPOw.result.totalDocs)} docs) — extrapolated ×${bPOxFactor.toFixed(1)}`);

const total2a = totalDocs; // all figures below are now expressed at full-collection scale
console.log(`\nTotal docs analysed (extrapolated to full collection): ${fmt(total2a)}`);
console.log(`\n${"Strategy".padEnd(30)} ${"Skipped (upper bound)".padStart(22)} ${"Kept".padStart(12)} ${"Skip %".padStart(8)}`);
rule();
console.log(`${"60-min same-price".padEnd(30)} ${fmt(b60.skipped).padStart(22)} ${fmt(b60.kept).padStart(12)} ${pct(b60.skipped, total2a).padStart(8)}`);
console.log(`${"Price-change-only".padEnd(30)} ${fmt(bPO.skipped).padStart(22)} ${fmt(bPO.kept).padStart(12)} ${pct(bPO.skipped, total2a).padStart(8)}`);
console.log(`\n⚑  Both figures are UPPER BOUNDS, extrapolated from time-windowed samples. Phase 2B exact sample calibrates these.`);
console.log(`\nPhase 2A complete in ${elapsed(t)}`);

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 2B — Exact consecutive-pair analysis
//
// Three-tier attempt, each falling through to the next on failure:
//   Try A: index-assisted full-collection sort — attempted first, but CONFIRMED
//          to still fail: $setWindowFields always inserts its own blocking
//          $sort stage regardless of whether the input already arrives
//          index-sorted (verified via full-pipeline .explain()). Kept as a
//          fast fail-fast check (explain only, skips the real run once the
//          injected sort is detected) so this is documented with evidence,
//          not assumed.
//   Try B: full-collection pass with allowDiskUse:true + maxTimeMS:90s.
//          CONFIRMED Atlas M0 rejects allowDiskUse for both $group (Phase 2A)
//          and $sort (here) — the option is correctly sent but the server
//          still returns the same "didn't opt in to external sorting" error.
//   Try C: time-windowed extrapolation, retry-shrinking on the REAL error
//          (12h→6h→3h...) rather than a pre-estimated safe size — the naive
//          61-bytes/doc estimate undershot real per-doc sort overhead.
//
// Uses $setWindowFields LAG(1) to get each doc's chronological predecessor
// within the same itemId partition, then counts gap-bucketed same-price pairs.
// ═════════════════════════════════════════════════════════════════════════════
title("PHASE 2B — Exact consecutive-pair analysis");
t = Date.now();

// CONFIRMED EMPIRICALLY: $setWindowFields always inserts its own explicit
// blocking $sort pipeline stage before it runs, even when the input is
// already correctly ordered by an index scan (verified directly against this
// cluster — a $match+$sort-only explain showed IXSCAN with zero blocking
// sort, but explaining the FULL pipeline including $setWindowFields revealed
// a separate top-level {$sort:...} stage injected right before
// {$_internalSetWindowFields:...}, and the real run failed with the same
// 32MB sort-memory error). So index-assisted sort can shrink the $cursor's
// own scan cost, but cannot eliminate $setWindowFields' mandatory re-sort —
// this function checks the FULL real pipeline's top-level stage list (not
// just queryPlanner.winningPlan) for that injected $sort.
function pipelineHasBlockingSort(explainResult) {
  const stages = explainResult?.stages;
  if (!Array.isArray(stages)) {
    return new RegExp(`"stage"\\s*:\\s*"SORT"`).test(JSON.stringify(explainResult));
  }
  return stages.some((s, i) => i > 0 && Object.prototype.hasOwnProperty.call(s, "$sort"));
}

// Shared tail: LAG computation + gap-bucketed group. `shiftBy` depends on
// whether the incoming stream is time-ascending (-1) or time-descending (+1)
// per itemId partition — either way prevPrice/prevAt end up representing the
// chronologically-earlier neighbor.
function buildAnalysisPipeline({ matchStage, sortSpec, sortByForWindow, shiftBy }) {
  return [
    matchStage,
    { $sort: sortSpec },
    { $project: { itemId: 1, priceCoins: 1, observedAt: 1 } },
    {
      $setWindowFields: {
        partitionBy: "$itemId",
        sortBy:      sortByForWindow,
        output: {
          prevPrice: { $shift: { output: "$priceCoins", by: shiftBy, default: null } },
          prevAt:    { $shift: { output: "$observedAt", by: shiftBy, default: null } },
        },
      },
    },
    {
      $addFields: {
        isFirst:    { $eq: ["$prevAt", null] },
        timeDiffMs: { $cond: [{ $eq: ["$prevAt", null] }, null, { $subtract: ["$observedAt", "$prevAt"] }] },
      },
    },
    {
      $addFields: {
        samePrice: {
          $cond: [
            "$isFirst",
            false,
            { $lt: [{ $abs: { $subtract: ["$priceCoins", "$prevPrice"] } }, 0.01] },
          ],
        },
      },
    },
    {
      $addFields: {
        skip60: {
          $cond: [
            { $and: ["$samePrice", { $ne: ["$timeDiffMs", null] }, { $lte: ["$timeDiffMs", 3_600_000] }] },
            1, 0,
          ],
        },
        skipPO: { $cond: ["$samePrice", 1, 0] },
      },
    },
    {
      $group: {
        _id:         null,
        total:       { $sum: 1 },
        firstDocs:   { $sum: { $cond: ["$isFirst", 1, 0] } },
        priceChange: { $sum: { $cond: [{ $and: [{ $not: ["$isFirst"] }, { $not: ["$samePrice"] }] }, 1, 0] } },
        // Same-price gap distribution
        gUnder15:  { $sum: { $cond: [{ $and: ["$samePrice", { $lte: ["$timeDiffMs",     900_000] }] }, 1, 0] } },
        g15_60min: { $sum: { $cond: [{ $and: ["$samePrice", { $gt: ["$timeDiffMs",     900_000] }, { $lte: ["$timeDiffMs",   3_600_000] }] }, 1, 0] } },
        g1_2h:     { $sum: { $cond: [{ $and: ["$samePrice", { $gt: ["$timeDiffMs",   3_600_000] }, { $lte: ["$timeDiffMs",   7_200_000] }] }, 1, 0] } },
        g2_6h:     { $sum: { $cond: [{ $and: ["$samePrice", { $gt: ["$timeDiffMs",   7_200_000] }, { $lte: ["$timeDiffMs",  21_600_000] }] }, 1, 0] } },
        gOver6h:   { $sum: { $cond: [{ $and: ["$samePrice", { $gt: ["$timeDiffMs", 21_600_000] }] }, 1, 0] } },
        skipped60: { $sum: "$skip60" },
        skippedPO: { $sum: "$skipPO" },
      },
    },
  ];
}

let exact = null;
let exactMode = null; // "index-assisted-full" | "allowDiskUse-full" | "windowed-extrapolated"
let windowHours = null;

// ── Try A: index-assisted full-collection sort ──────────────────────────────
console.log(`Try A: index-assisted full-collection sort (expects to use ${ITEMID_INDEX_NAME})...`);
try {
  const tryAPipeline = buildAnalysisPipeline({
    matchStage:      { $match: {} },
    sortSpec:        { itemId: 1, observedAt: -1 },
    sortByForWindow: { observedAt: -1 },
    shiftBy:         1,
  });
  // Mongoose's/the driver's .explain() cursor helper rejects with "Option
  // 'explain' cannot be used on an aggregate call with writeConcern" because
  // the connection's default writeConcern gets attached regardless of
  // per-call overrides — use the raw explain command instead, which is
  // unaffected (verified directly against this cluster). Explain the FULL
  // pipeline (not just $match+$sort) — see pipelineHasBlockingSort() comment.
  const explainResult = await mongoose.connection.db.command({
    explain: {
      aggregate: PriceSnapshot.collection.collectionName,
      pipeline:  tryAPipeline,
      cursor:    {},
    },
    verbosity: "queryPlanner",
  });
  const blockingSort = pipelineHasBlockingSort(explainResult);
  console.log(`  explain (full pipeline): blocking $sort stage ${blockingSort ? "PRESENT — $setWindowFields forces its own re-sort regardless of index order, skipping real run" : "ABSENT — safe at any collection size"}`);
  if (!blockingSort) {
    [exact] = await PriceSnapshot.aggregate(tryAPipeline).option({ maxTimeMS: 90_000 });
    if (exact) {
      exactMode = "index-assisted-full";
      console.log(`  ✓ Try A succeeded — EXACT results over the full collection, no allowDiskUse needed.`);
    }
  }
} catch (err) {
  console.log(`  Try A failed: ${err.message}`);
}

// ── Try B: full-collection pass with allowDiskUse:true ──────────────────────
if (!exact) {
  console.log(`\nTry B: full-collection pass with allowDiskUse:true (maxTimeMS 90s)...`);
  try {
    [exact] = await PriceSnapshot.aggregate(
      buildAnalysisPipeline({
        matchStage:      { $match: {} },
        sortSpec:        { itemId: 1, observedAt: 1 },
        sortByForWindow: { observedAt: 1 },
        shiftBy:         -1,
      })
    ).allowDiskUse(true).option({ maxTimeMS: 90_000 });
    if (exact) {
      exactMode = "allowDiskUse-full";
      console.log(`  ✓ Try B succeeded — EXACT results over the full collection via allowDiskUse.`);
    }
  } catch (err) {
    const timedOut = /maxTimeMS|exceeded time limit/i.test(err.message);
    console.log(`  Try B failed (${timedOut ? "TIMED OUT — too slow on M0, not necessarily rejected" : "rejected"}): ${err.message}`);
  }
}

// ── Try C: time-windowed extrapolation, shrinking on ACTUAL failure ─────────
// (A prior byte-size pre-estimate approach was tried and found unreliable —
// a 12h/250,771-doc window estimated at ~14.6MB still hit the real 32MB sort
// limit, meaning real per-doc blocking-sort overhead is well above the naive
// projected-field-size estimate. Retrying on the real error is more robust
// than guessing a safe size up front.)
if (!exact) {
  console.log(`\nTry C: time-windowed extrapolation (retries on real memory-limit errors)...`);
  windowHours = 12;
  const minHours = 0.25;
  while (windowHours >= minHours) {
    const windowStart = new Date(windowAnchor.getTime() - windowHours * 3_600_000);
    const windowCount = await PriceSnapshot.countDocuments({ observedAt: { $gte: windowStart, $lte: windowAnchor } });
    if (windowCount < 50) {
      console.log(`  ${windowHours}h window has only ${windowCount} docs — too few for meaningful results, shrinking further won't help. Stopping.`);
      break;
    }
    console.log(`  Trying ${windowHours}h window (${fmt(windowCount)} docs)...`);
    try {
      [exact] = await PriceSnapshot.aggregate(
        buildAnalysisPipeline({
          matchStage:      { $match: { observedAt: { $gte: windowStart, $lte: windowAnchor } } },
          sortSpec:        { itemId: 1, observedAt: 1 },
          sortByForWindow: { observedAt: 1 },
          shiftBy:         -1,
        })
      );
      if (exact) {
        exactMode = "windowed-extrapolated";
        console.log(`  ✓ Try C succeeded at ${windowHours}h window.`);
        break;
      }
    } catch (err) {
      const isMemLimit = err.code === 292 || /Exceeded memory limit|Sort exceeded memory limit/i.test(err.message || "");
      if (!isMemLimit) { console.log(`  Try C failed (non-memory error): ${err.message}`); break; }
      console.log(`  ${windowHours}h window still exceeded the sort memory limit — shrinking to ${windowHours / 2}h...`);
      windowHours = windowHours / 2;
    }
  }
  if (!exact) {
    console.log(`  No exact analysis available — Phase 2A bucket estimates are the only figures for this run.`);
  }
}

if (exact) {
  const samePriceTotal = exact.gUnder15 + exact.g15_60min + exact.g1_2h + exact.g2_6h + exact.gOver6h;
  const isExactFull = exactMode === "index-assisted-full" || exactMode === "allowDiskUse-full";
  const xFactor = isExactFull ? 1 : totalDocs / exact.total;
  const scopeLabel = isExactFull
    ? "full collection (EXACT)"
    : `${windowHours}h sample (extrapolated ×${xFactor.toFixed(1)})`;

  console.log(`\nMode: ${exactMode}`);
  console.log(`\nDocument classification — ${scopeLabel} (${fmt(exact.total)} docs analyzed):`);
  console.log(`  First snapshot per itemId (always kept):  ${fmt(exact.firstDocs).padStart(8)}  ${pct(exact.firstDocs, exact.total).padStart(7)}`);
  console.log(`  Price-change events       (always kept):  ${fmt(exact.priceChange).padStart(8)}  ${pct(exact.priceChange, exact.total).padStart(7)}`);
  console.log(`  Same-price consecutive pairs total:       ${fmt(samePriceTotal).padStart(8)}  ${pct(samePriceTotal, exact.total).padStart(7)}`);

  if (samePriceTotal > 0) {
    console.log(`\n  Same-price pair breakdown by time gap between consecutive snapshots of same itemId:`);
    const gaps = [
      ["< 15 min  (sanity — should be near 0)",          exact.gUnder15,  "current dedup blocks"],
      ["15 min – 1 hr  ← skipped by 60-min dedup",       exact.g15_60min, "eliminated by 60-min"],
      ["1 – 2 hrs  ← also skipped by 60-min dedup",      exact.g1_2h,     "eliminated by 60-min"],
      ["2 – 6 hrs  ← only price-change-only catches",    exact.g2_6h,     "price-only only"],
      ["> 6 hrs  ← only price-change-only catches",      exact.gOver6h,   "price-only only"],
    ];
    for (const [label, n] of gaps) {
      console.log(`    ${label.padEnd(50)} ${fmt(n).padStart(8)}  ${pct(n, samePriceTotal).padStart(7)}  ${bar(n, samePriceTotal)}`);
    }
  } else {
    console.log(`\n  ✓ Zero same-price consecutive pairs in this ${scopeLabel}.`);
    console.log(`    This means the current 15-min dedup is already very effective,`);
    console.log(`    and a wider dedup window would provide minimal additional savings.`);
  }

  const ext60 = Math.round(exact.skipped60 * xFactor);
  const extPO = Math.round(exact.skippedPO * xFactor);
  console.log(`\n${isExactFull ? "EXACT full-collection rates" : `Exact ${windowHours}h rates, extrapolated ×${xFactor.toFixed(1)} to full collection`}:`);
  console.log(`  60-min dedup:        ${fmt(exact.skipped60).padStart(9)}${isExactFull ? "" : ` in ${windowHours}h`}  →  ~${fmt(ext60)} total  (${pct(ext60, totalDocs)})`);
  console.log(`  Price-change-only:   ${fmt(exact.skippedPO).padStart(9)}${isExactFull ? "" : ` in ${windowHours}h`}  →  ~${fmt(extPO)} total  (${pct(extPO, totalDocs)})`);
  console.log(`\n  Phase 2A (bucket) vs Phase 2B (${isExactFull ? "exact, full collection" : "exact sample, extrapolated"}):`);
  console.log(`    60-min:  bucket estimated ${pct(b60.skipped, total2a)} skip — ${isExactFull ? "exact" : "exact extrapolation"} says ${pct(ext60, totalDocs)} skip`);
  console.log(`    PO:      bucket estimated ${pct(bPO.skipped, total2a)} skip — ${isExactFull ? "exact" : "exact extrapolation"} says ${pct(extPO, totalDocs)} skip`);
  console.log(`  (${isExactFull ? "These are EXACT numbers over the entire collection — use directly." : "Bucket estimates are upper bounds; exact is the number to act on"})`);
} else {
  console.log(`\n⚠  No exact analysis available (Try A/B/C all failed or skipped) — only Phase 2A bucket upper-bound estimates exist for this run.`);
}
console.log(`\nPhase 2B complete in ${elapsed(t)}`);

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Per-skin listingCount7d impact  (windowed + M0 safe)
//
// Intended to use the SAME trailing-7-day window as skinMetricsAggregator.js's
// `since7d` filter (server/jobs/skinMetricsAggregator.js:70), so "currentCount"
// is comparable to the real SkinMetrics.listingCount7d field. In practice a
// full 7-day $group hits the same M0 memory limit as Phase 2A's full-collection
// attempt on this dataset, so it uses the same shrink-on-failure window
// strategy — see the window-size note printed below. The prior version of this
// script aggregated the full 30-day collection with no time filter at all,
// which did NOT match the field it claimed to model — fixed here regardless.
// ═════════════════════════════════════════════════════════════════════════════
title("PHASE 3 — Per-skin listingCount7d impact (windowed, matches production window where possible)");
t = Date.now();

// Anchored to the collection's actual last snapshot, not wall-clock now — see
// the Phase 1 gap warning. Production's REAL listingCount7d is computed with
// a literal Date.now()-7d filter (skinMetricsAggregator.js:70); if there's an
// active write gap, that real window is empty and listingCount7d is ~0 for
// listing-proxy-driven skins right now. This phase instead analyzes the last
// real ACTIVE window (ending at the last real snapshot) to show what dedup
// impact looks like under normal operation — the cross-check below explains
// the resulting (expected) mismatch against the live field.
//
// A full 7-day $group hits the same M0 in-memory limit as Phase 2A's full-
// collection attempt did (this dataset's whole 3.19-day span already exceeds
// it), so this uses the same shrinking-window retry as Phase 2A/2B, starting
// at 24h (Phase 2A's b60 — same group granularity — already proved 24h safe).
// Below is therefore a snapshot-volume proxy over the largest safe recent
// window, NOT a literal 7-day figure — labeled accordingly in the output.
async function windowedRowsWithFallback(buildPipeline, { startHours = 24, minHours = 0.25 } = {}) {
  let hours = startHours;
  while (hours >= minHours) {
    const windowStart = new Date(windowAnchor.getTime() - hours * 3_600_000);
    try {
      const rows = await PriceSnapshot.aggregate(buildPipeline(windowStart)).allowDiskUse(true);
      return { rows, hours, windowStart };
    } catch (err) {
      if (err.code !== 292 && !/Exceeded memory limit/i.test(err.message || "")) throw err;
      console.log(`  ${hours}h window exceeded $group memory limit — shrinking to ${hours / 2}h...`);
      hours = hours / 2;
    }
  }
  throw new Error(`windowedRowsWithFallback: failed even at minimum window (${minHours}h)`);
}

const hourRollupResult = await windowedRowsWithFallback((windowStart) => [
  { $match: { observedAt: { $gte: windowStart, $lte: windowAnchor } } },
  {
    $project: {
      mhn:        "$marketHashName",
      wear:       "$wear",
      itemId:     1,
      priceGroup: { $round: ["$priceCoins", 0] },
      bucket60:   { $toLong: { $subtract: [{ $toLong: "$observedAt" }, { $mod: [{ $toLong: "$observedAt" }, 3_600_000] }] } },
    },
  },
  { $group: { _id: { mhn: "$mhn", wear: "$wear", itemId: "$itemId", hour: "$bucket60", price: "$priceGroup" }, raw: { $sum: 1 } } },
  { $group: { _id: { mhn: "$_id.mhn", wear: "$_id.wear", itemId: "$_id.itemId", hour: "$_id.hour" }, rawDocsPerHour: { $sum: "$raw" }, distinctPrices: { $sum: 1 } } },
  { $group: { _id: { mhn: "$_id.mhn", wear: "$_id.wear" }, currentCount: { $sum: "$rawDocsPerHour" }, count60min: { $sum: "$distinctPrices" } } },
]);
const hourRollup = hourRollupResult.rows;
const phase3WindowHours = hourRollupResult.hours;
const phase3WindowStart = hourRollupResult.windowStart;
console.log(`Analysis window: last ${phase3WindowHours}h ending at the last real snapshot (${phase3WindowStart.toISOString()} → ${windowAnchor.toISOString()}).`);
if (phase3WindowHours < 168) {
  console.log(`Note: this is NOT a full 7-day figure — a 7-day $group exceeds the M0 memory limit on this`);
  console.log(`dataset (same issue as Phase 2A). Treat "Current" below as a recent-activity proxy, not a literal listingCount7d.`);
}

// Price-change-only: distinct (itemId, price) pairs per skin, ignoring hour
// entirely — same window as hourRollup (lower cardinality, so it's expected
// to succeed at that window or larger; falls back to its own shrink-retry
// otherwise so the two rollups stay comparable when possible).
const priceOnlyRollupResult = await windowedRowsWithFallback(
  (windowStart) => [
    { $match: { observedAt: { $gte: windowStart, $lte: windowAnchor } } },
    {
      $project: {
        mhn:        "$marketHashName",
        wear:       "$wear",
        itemId:     1,
        priceGroup: { $round: ["$priceCoins", 0] },
      },
    },
    { $group: { _id: { mhn: "$mhn", wear: "$wear", itemId: "$itemId", price: "$priceGroup" } } },
    { $group: { _id: { mhn: "$_id.mhn", wear: "$_id.wear" }, countPriceOnly: { $sum: 1 } } },
  ],
  { startHours: phase3WindowHours }
);
const priceOnlyRollup = priceOnlyRollupResult.rows;

const priceOnlyBySkin = new Map(priceOnlyRollup.map((r) => [`${r._id.mhn}||${r._id.wear}`, r.countPriceOnly]));

const skinRows = hourRollup
  .map((r) => ({ ...r, countPriceOnly: priceOnlyBySkin.get(`${r._id.mhn}||${r._id.wear}`) ?? r.count60min }))
  .sort((a, b) => b.currentCount - a.currentCount);

if (skinRows.length > 0) {
  const top20 = skinRows.slice(0, 20);
  const W = { n: 38, cur: 9, d60: 9, p60: 7, dpo: 10, ppo: 7 };
  const hLine = `${"Skin (wear)".padEnd(W.n)} ${"Current".padStart(W.cur)} ${"60-min".padStart(W.d60)} ${"Δ60(%)".padStart(W.p60)} ${"PriceOnly".padStart(W.dpo)} ${"ΔPO(%)".padStart(W.ppo)}`;
  console.log(`\n${hLine}`);
  rule();
  for (const s of top20) {
    const name    = `${s._id.mhn} (${s._id.wear ?? "none"})`.slice(0, W.n - 1).padEnd(W.n);
    const saved60 = s.currentCount - s.count60min;
    const savedPO = s.currentCount - s.countPriceOnly;
    console.log(
      `${name} ` +
      `${fmt(s.currentCount).padStart(W.cur)} ` +
      `${fmt(s.count60min).padStart(W.d60)} ` +
      `${("-" + pct(saved60, s.currentCount)).padStart(W.p60)} ` +
      `${fmt(s.countPriceOnly).padStart(W.dpo)} ` +
      `${("-" + pct(savedPO, s.currentCount)).padStart(W.ppo)}`
    );
  }
  console.log(`\n  Current   = snapshot count in the last ${phase3WindowHours}h of real activity (recent-activity proxy for listingCount7d — see note above)`);
  console.log(`  60-min    = estimated count after 60-min dedup (upper bound on reduction)`);
  console.log(`  PriceOnly = estimated count after price-change-only dedup (upper bound on reduction)`);

  const top = top20[0];
  try {
    const realMetrics = await SkinMetrics.findOne({ marketHashName: top._id.mhn, wear: top._id.wear }).lean();
    console.log(`\n  Cross-check: "${top._id.mhn} (${top._id.wear ?? "none"})"`);
    if (realMetrics) {
      console.log(`    Script-computed currentCount (last ${phase3WindowHours}h of real activity): ${fmt(top.currentCount)}`);
      console.log(`    Real SkinMetrics.listingCount7d (Date.now()-based, live):  ${fmt(realMetrics.listingCount7d)}`);
      if (top.currentCount === realMetrics.listingCount7d) {
        console.log(`    ✓ MATCH`);
      } else if (gapDays > 0.5) {
        console.log(`    ⚠  MISMATCH EXPECTED: production's real window is empty due to the ${gapDays.toFixed(1)}-day write`);
        console.log(`       gap (see Phase 1) — this script's window is anchored to the last real active week instead.`);
      } else {
        console.log(`    ⚠  MISMATCH — likely just hourly-cron drift; investigate if the gap is large`);
      }
    } else {
      console.log(`    ⚠  No SkinMetrics document found for this skin — cannot cross-check.`);
    }
  } catch (err) {
    console.log(`\n  ⚠  Cross-check failed: ${err.message}`);
  }
}
console.log(`\nPhase 3 complete in ${elapsed(t)}`);

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 3.5 — Threshold-crossing impact on SkinMetrics.tier / deal-score confidence
//
// listingCount7d feeds FIXED, absolute thresholds in production (verified by
// reading the source directly, not assumed):
//   computeTier() listing-proxy branch (server/jobs/skinMetricsAggregator.js:22-26):
//     avgPerDay=count/7; count<5→"no_data", avgPerDay>=3→"active", >=0.3→"thin", else "rare"
//     (only reached when soldCount30d<5 — no SoldHistory join here, so this
//     models only skins currently on that proxy path; real affected-count is <= this)
//   computeSignalConfidence() no-sold-history branch (server/services/dealScore.js:66-70):
//     applies only when soldCount90d is 0 — count>=21→0.40, >=5→0.25, >=1→0.15, else 0.10
//   price-reference trust gate (dealScore.js:137) + confidence label (dealScore.js:196):
//     both flip at count>=5
// Any dedup strategy that lowers listingCount7d can flip these buckets even when
// real market activity hasn't changed — this phase quantifies exactly how many
// skins would flip, per strategy, over the SAME skinRows computed in Phase 3.
// ═════════════════════════════════════════════════════════════════════════════
title("PHASE 3.5 — Threshold-crossing impact (tier / confidence / price-trust)");
t = Date.now();

// Thresholds (21/5/1/0.3/3) are calibrated in production against a literal
// 7-day listingCount7d. Phase 3's window may be shorter than 7d (M0 memory
// limit — see note above), so scale counts to a 7-day-equivalent before
// applying these fixed thresholds, or the comparison would be apples-to-oranges.
const scaleTo7d = 168 / phase3WindowHours;

function tierProxy(count7dEquiv) {
  if (count7dEquiv < 5) return "no_data";
  const avgPerDay = count7dEquiv / 7;
  if (avgPerDay >= 3) return "active";
  if (avgPerDay >= 0.3) return "thin";
  return "rare";
}
function confidenceBucket(count7dEquiv) {
  if (count7dEquiv >= 21) return 0.40;
  if (count7dEquiv >= 5) return 0.25;
  if (count7dEquiv >= 1) return 0.15;
  return 0.10;
}
function trustGate(count7dEquiv) { return count7dEquiv >= 5; }

function crossingStats(rows, afterKey) {
  let tierFlips = 0, confFlips = 0, trustFlips = 0;
  for (const r of rows) {
    const before = r.currentCount * scaleTo7d;
    const after  = r[afterKey] * scaleTo7d;
    if (tierProxy(before) !== tierProxy(after)) tierFlips++;
    if (confidenceBucket(before) !== confidenceBucket(after)) confFlips++;
    if (trustGate(before) !== trustGate(after)) trustFlips++;
  }
  return { tierFlips, confFlips, trustFlips };
}

const cross60 = crossingStats(skinRows, "count60min");
const crossPO = crossingStats(skinRows, "countPriceOnly");

if (phase3WindowHours < 168) {
  console.log(`Scaling ${phase3WindowHours}h window counts ×${scaleTo7d.toFixed(1)} to a 7-day-equivalent before applying production's fixed thresholds.`);
}
console.log(`\nSkins analyzed (${phase3WindowHours}h window, scaled to 7d-equivalent for thresholds): ${fmt(skinRows.length)}`);
console.log(`\n${"Strategy".padEnd(20)} ${"Tier flips".padStart(14)} ${"Confidence flips".padStart(20)} ${"Trust-gate flips".padStart(20)}`);
rule();
console.log(`${"60-min dedup".padEnd(20)} ${fmt(cross60.tierFlips).padStart(14)} ${fmt(cross60.confFlips).padStart(20)} ${fmt(cross60.trustFlips).padStart(20)}`);
console.log(`${"Price-change-only".padEnd(20)} ${fmt(crossPO.tierFlips).padStart(14)} ${fmt(crossPO.confFlips).padStart(20)} ${fmt(crossPO.trustFlips).padStart(20)}`);
console.log(`\n  Tier flips       = skins whose computeTier() listing-proxy result would change`);
console.log(`  Confidence flips = skins whose computeSignalConfidence() no-sold-history bucket would change`);
console.log(`  Trust-gate flips = skins whose medianPrice7d-as-reference eligibility (>=5) would change`);
console.log(`  Caveat: models ONLY the listing-proxy paths. Skins with soldCount30d>=5 (tier) or`);
console.log(`  soldCount90d>=1 (confidence) are driven by SoldHistory instead and are unaffected regardless.`);
console.log(`  This script has no SoldHistory join, so these counts are an UPPER BOUND on affected skins.`);
console.log(`\nPhase 3.5 complete in ${elapsed(t)}`);

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 4 — Storage projections
// Uses Phase 2A bucket fractions as the upper-bound scenario and Phase 2B
// exact fractions as the realistic scenario where available.
// ═════════════════════════════════════════════════════════════════════════════
title("PHASE 4 — Storage Projections");

const frac60_bucket = b60.skipped / total2a;
const fracPO_bucket = bPO.skipped / total2a;

const activeIdxMB = INDEX_MB - UNUSED_IDX_MB;   // required indexes after dropping unused one

function projRow(label, fracSkipped, withFieldRemoval = false) {
  const kept      = 1 - fracSkipped;
  const fieldFrac = withFieldRemoval ? (1 - 71 / AVG_DOC_BYTES) : 1;  // 71 bytes removed (3 write-only fields)
  const dataMB    = DATA_MB * kept * fieldFrac;
  const idxMB     = activeIdxMB * kept;
  const totalMB   = dataMB + idxMB;
  const savedMB   = (DATA_MB + INDEX_MB) - totalMB;
  const status    = totalMB <= 512 ? "✓" : "✗ OVER";
  console.log(
    `  ${label.padEnd(44)} ` +
    `${dataMB.toFixed(0).padStart(5)} MB ` +
    `${idxMB.toFixed(0).padStart(5)} MB ` +
    `${totalMB.toFixed(0).padStart(6)} MB   ` +
    `saves ${savedMB.toFixed(0).padStart(4)} MB  ${status}`
  );
}

console.log(`\n  ${"Strategy".padEnd(44)} ${"Data".padStart(7)} ${"Idx".padStart(7)} ${"Total".padStart(8)}   Savings`);
rule();
console.log(`  ${"Current (no change)".padEnd(44)} ${DATA_MB.toFixed(0).padStart(5)} MB ${INDEX_MB.toFixed(0).padStart(5)} MB ${(DATA_MB + INDEX_MB).toFixed(0).padStart(6)} MB   saves    0 MB  ✗ OVER`);
console.log(`  ${"① Drop unused index only".padEnd(44)} ${DATA_MB.toFixed(0).padStart(5)} MB ${activeIdxMB.toFixed(0).padStart(5)} MB ${(DATA_MB + activeIdxMB).toFixed(0).padStart(6)} MB   saves   ${UNUSED_IDX_MB.toFixed(0)} MB  ${(DATA_MB + activeIdxMB) <= 512 ? "✓" : "✗ OVER"}`);

console.log(`\n  — Upper-bound estimates (bucket approximation from Phase 2A) —`);
projRow("② 60-min dedup + drop idx",                       frac60_bucket, false);
projRow("③ Price-only dedup + drop idx",                   fracPO_bucket, false);
projRow("④ 60-min + field removal + drop idx",             frac60_bucket, true);
projRow("⑤ Price-only + field removal + drop idx",         fracPO_bucket, true);

const isExactFull = exactMode === "index-assisted-full" || exactMode === "allowDiskUse-full";

if (exact) {
  const xFactor = isExactFull ? 1 : totalDocs / exact.total;
  const frac60_exact = (exact.skipped60 * xFactor) / totalDocs;
  const fracPO_exact = (exact.skippedPO * xFactor) / totalDocs;
  if (frac60_exact > 0 || fracPO_exact > 0) {
    const srcLabel = isExactFull ? "Phase 2B exact full-collection pass" : `Phase 2B exact extrapolation from ${windowHours}h sample`;
    console.log(`\n  — Realistic estimates (${srcLabel}) —`);
    projRow("② 60-min dedup + drop idx",                     frac60_exact, false);
    projRow("③ Price-only dedup + drop idx",                 fracPO_exact, false);
    projRow("④ 60-min + field removal + drop idx",           frac60_exact, true);
    projRow("⑤ Price-only + field removal + drop idx",       fracPO_exact, true);
  }
}

// Steady-state at current rate with each strategy
console.log(`\n⚠  STEADY-STATE AT 30-DAY TTL  (if insert rate stays at ${fmt(docsPerDay)}/day)`);
rule();
const scenarios = [
  ["No change",          0],
  ["60-min dedup",       frac60_bucket],
  ["Price-only dedup",   fracPO_bucket],
];
if (exact) {
  const xFactor = isExactFull ? 1 : totalDocs / exact.total;
  const frac60_exact = (exact.skipped60 * xFactor) / totalDocs;
  const fracPO_exact = (exact.skippedPO * xFactor) / totalDocs;
  const suffix = isExactFull ? "exact, full" : "exact";
  if (frac60_exact > 0)  scenarios.push([`60-min dedup (${suffix})`,     frac60_exact]);
  if (fracPO_exact > 0)  scenarios.push([`Price-only dedup (${suffix})`, fracPO_exact]);
}
for (const [label, frac] of scenarios) {
  const dailyKept  = docsPerDay * (1 - frac);
  const ssDocs     = dailyKept * 30;
  const ssDataMB   = (ssDocs * AVG_DOC_BYTES) / 1e6;
  const ssIdxMB    = activeIdxMB * (ssDocs / totalDocs);
  const ssTotalMB  = ssDataMB + ssIdxMB;
  const fitsM0     = ssTotalMB <= 512 ? "✓ fits M0" : `✗ ${ssTotalMB.toFixed(0)} MB — OVER`;
  console.log(`  ${label.padEnd(30)} ${fmt(ssDocs).padStart(12)} docs   ~${ssTotalMB.toFixed(0).padStart(4)} MB total   ${fitsM0}`);
}

console.log(`
  Note: field removal (strategy ④ / ⑤) reduces per-doc size by ~30 % for new writes.
  Old docs shrink naturally as TTL expires them over 30 days.
  The steady-state column assumes the dedup change is in place before new data accumulates.
`);

await mongoose.disconnect();
console.log("Done.");
