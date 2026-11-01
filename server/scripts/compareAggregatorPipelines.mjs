/**
 * compareAggregatorPipelines.mjs
 *
 * Read-only proof that the new cursor-based Pipeline 1 (scanPriceSnapshots7d,
 * added to skinMetricsAggregator.js to fix the M0 QueryExceededMemoryLimit
 * failure) produces identical per-skin output to the old $group+$push
 * aggregation, on the same real data.
 *
 * The old $group+$push pipeline can't run over the full 7-day window anymore
 * (that's the bug being fixed), so this compares both methods over a smaller
 * time slice that the old method can still complete on Atlas M0 — the window
 * size doesn't matter for correctness, since both methods scan the exact same
 * matched documents either way.
 *
 * Read-only: no writes, no bulkWrite, nothing committed to SkinMetrics.
 */
import "dotenv/config";
import mongoose from "mongoose";
import PriceSnapshot from "../models/PriceSnapshot.model.js";
import {
  buildGroupKey,
  createPriceGroup,
  accumulatePriceDoc,
  finalizePriceGroup,
  median,
} from "../jobs/skinMetricsAggregator.js";

const COMPARE_WINDOW_MS = Number(process.argv[2] || 6 * 60 * 60 * 1000); // default 6h slice

function finalizeForCompare(group) {
  const sortedPrices = [...group.prices].sort((a, b) => a - b);
  const floats = group.floatValues.filter((f) => f != null && Number.isFinite(f));
  return {
    count:       group.count,
    avgPrice:    group.avgPrice,
    minPrice:    group.minPrice,
    maxPrice:    group.maxPrice,
    avgDiscount: group.avgDiscount,
    medianPrice: median(sortedPrices),
    avgFloat:    floats.length ? floats.reduce((s, f) => s + f, 0) / floats.length : null,
    minFloat:    floats.length ? floats.reduce((m, f) => (f < m ? f : m), floats[0]) : null,
    maxFloat:    floats.length ? floats.reduce((m, f) => (f > m ? f : m), floats[0]) : null,
  };
}

async function main() {
  const uri = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
  await mongoose.connect(uri);

  const since = new Date(Date.now() - COMPARE_WINDOW_MS);
  console.log(`Comparing over the last ${COMPARE_WINDOW_MS / 3_600_000}h (since ${since.toISOString()})`);

  // ── OLD: $group + $push (the exact pre-fix pipeline shape) ──────────────────
  const oldGroups = await PriceSnapshot.aggregate(
    [
      { $match: { observedAt: { $gte: since } } },
      {
        $group: {
          _id:         { marketHashName: "$marketHashName", wear: "$wear" },
          count:       { $sum: 1 },
          avgPrice:    { $avg: "$priceCoins" },
          minPrice:    { $min: "$priceCoins" },
          maxPrice:    { $max: "$priceCoins" },
          avgDiscount: { $avg: "$discountPct" },
          prices:      { $push: "$priceCoins" },
          floatValues: { $push: "$floatValue" },
        },
      },
    ],
    { allowDiskUse: true }
  );
  const oldByKey = new Map();
  for (const g of oldGroups) {
    oldByKey.set(buildGroupKey(g._id.marketHashName, g._id.wear), finalizeForCompare(g));
  }

  // ── NEW: cursor scan + in-Node accumulation (the shipped fix) ───────────────
  const cursor = PriceSnapshot.find(
    { observedAt: { $gte: since } },
    { marketHashName: 1, wear: 1, priceCoins: 1, discountPct: 1, floatValue: 1, _id: 0 }
  ).lean().cursor();

  const newGroupMap = new Map();
  for await (const doc of cursor) {
    const wear = doc.wear ?? null;
    const key = buildGroupKey(doc.marketHashName, wear);
    let g = newGroupMap.get(key);
    if (!g) { g = createPriceGroup(doc.marketHashName, wear); newGroupMap.set(key, g); }
    accumulatePriceDoc(g, doc);
  }
  const newByKey = new Map();
  for (const [key, group] of newGroupMap.entries()) {
    newByKey.set(key, finalizeForCompare(finalizePriceGroup(group)));
  }

  // ── Compare ──────────────────────────────────────────────────────────────
  const allKeys = new Set([...oldByKey.keys(), ...newByKey.keys()]);
  let mismatches = 0;
  const FIELDS = ["count", "avgPrice", "minPrice", "maxPrice", "avgDiscount", "medianPrice", "avgFloat", "minFloat", "maxFloat"];

  for (const key of allKeys) {
    const o = oldByKey.get(key);
    const n = newByKey.get(key);
    if (!o || !n) {
      mismatches++;
      console.log(`MISMATCH (missing on one side): ${key} — old=${!!o} new=${!!n}`);
      continue;
    }
    for (const field of FIELDS) {
      const ov = o[field];
      const nv = n[field];
      const bothNull = ov == null && nv == null;
      const closeEnough = typeof ov === "number" && typeof nv === "number" && Math.abs(ov - nv) < 1e-9;
      if (!bothNull && !closeEnough && ov !== nv) {
        mismatches++;
        console.log(`MISMATCH ${key} field=${field} old=${ov} new=${nv}`);
      }
    }
  }

  console.log(`\nGroups compared: ${allKeys.size}`);
  console.log(`Fields checked per group: ${FIELDS.join(", ")}`);
  console.log(mismatches === 0 ? "RESULT: 0 mismatches — identical output." : `RESULT: ${mismatches} mismatch(es) found.`);

  await mongoose.disconnect();
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("compareAggregatorPipelines failed:", err?.message || err);
  process.exit(1);
});
