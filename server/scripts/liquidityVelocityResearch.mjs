/**
 * READ-ONLY research script for SkinTel Deal Score Phase 2 audit.
 * Investigates real natural sales velocity / consistency / data quality in
 * SoldHistory. Performs ONLY find/aggregate reads — no writes, no schema
 * changes, no production code touched.
 *
 * Run from server/:
 *   node scripts/liquidityVelocityResearch.mjs
 *
 * Output: human-readable progress to stdout, full structured JSON result
 * written to the path in OUT_PATH below.
 */
import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import SoldHistory from "../models/SoldHistory.model.js";

const MONGO_URL = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
if (!MONGO_URL) throw new Error("MONGO_URI / MONGO_URL not set in .env");

const OUT_PATH = process.env.LIQ_RESEARCH_OUT ||
  "C:/Users/akiva/AppData/Local/Temp/claude/C--Users-akiva-csapp/ed32f87b-eef6-4d2b-83ee-edf22489f5f7/scratchpad/liquidity_research_output.json";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pctile = (sortedArr, p) => {
  if (!sortedArr.length) return null;
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sortedArr[lo] : sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
};

await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 20_000 });
console.log(`Connected: ${mongoose.connection.name}`);

const out = { meta: {}, categoryTop: {}, globalTop: null, items: [], quality: {} };

// ── Phase 0: collection stats ────────────────────────────────────────────────
try {
  const [cs] = await SoldHistory.aggregate([{ $collStats: { storageStats: {} } }]);
  out.meta.dataMB = cs.storageStats.size / 1e6;
  out.meta.avgDocBytes = cs.storageStats.avgObjSize;
} catch (e) { out.meta.collStatsError = e.message; }

out.meta.totalDocs = await SoldHistory.estimatedDocumentCount();
console.log(`Total SoldHistory docs: ${out.meta.totalDocs}`);

const [dateStats] = await SoldHistory.aggregate([
  { $group: { _id: null, min: { $min: "$soldAt" }, max: { $max: "$soldAt" } } },
]);
out.meta.earliest = dateStats?.min ?? null;
out.meta.latest = dateStats?.max ?? null;
out.meta.spanDays = dateStats ? (dateStats.max - dateStats.min) / 86_400_000 : null;
const WALLCLOCK_NOW = Date.now();
out.meta.gapDaysFromNow = dateStats ? (WALLCLOCK_NOW - dateStats.max.getTime()) / 86_400_000 : null;
console.log(`Date range: ${out.meta.earliest?.toISOString()} -> ${out.meta.latest?.toISOString()} (span ${out.meta.spanDays?.toFixed(1)}d)`);
console.log(`Gap from wall-clock now: ${out.meta.gapDaysFromNow?.toFixed(2)}d`);
// Anchor "current" window analysis to the collection's actual latest soldAt,
// not wall-clock now — mirrors analyzeSnapshotDedup.mjs's windowAnchor pattern.
// Production's real Date.now()-based windows (skinMetricsAggregator.js) would
// be biased low by the same gap; this anchor shows what velocity looks like
// during the last period data was actually flowing.
const NOW = dateStats ? dateStats.max.getTime() : WALLCLOCK_NOW;
out.meta.anchorUsedForWindows = new Date(NOW).toISOString();
out.meta.anchorNote = "All sales7d/30d/90d/daysSinceLastSale below are anchored to the collection's latest real soldAt, NOT wall-clock now, because of the gapDaysFromNow above.";

try {
  const [r] = await SoldHistory.aggregate([{ $group: { _id: "$marketHashName" } }, { $count: "n" }]).allowDiskUse(true);
  out.meta.uniqueMarketHashNames = r?.n ?? null;
} catch (e) { out.meta.uniqueNamesError = e.message; }
console.log(`Unique marketHashNames: ${out.meta.uniqueMarketHashNames ?? "ERROR: " + out.meta.uniqueNamesError}`);

// ── Global top-by-volume (best effort, may hit M0 memory limit) ─────────────
try {
  out.globalTop = await SoldHistory.aggregate([
    { $group: { _id: "$marketHashName", count: { $sum: 1 }, avgPrice: { $avg: "$totalValueCoins" }, lastSale: { $max: "$soldAt" } } },
    { $sort: { count: -1 } },
    { $limit: 15 },
  ]).allowDiskUse(true);
  console.log(`Global top-15 by volume: OK (${out.globalTop.length} rows)`);
} catch (e) {
  out.globalTop = { error: e.message };
  console.log(`Global top-15 by volume FAILED (likely M0 memory limit): ${e.message}`);
}

// ── Category discovery ───────────────────────────────────────────────────────
const categoryPatterns = {
  ak47_redline: /^(StatTrak™ )?AK-47 \| Redline/,
  ak47_other: /^(StatTrak™ )?AK-47 \|/,
  awp: /^(StatTrak™ )?AWP \|/,
  m4a4: /^(StatTrak™ )?M4A4 \|/,
  m4a1s: /^(StatTrak™ )?M4A1-S \|/,
  pistols: /^(StatTrak™ )?(Glock-18|USP-S|Desert Eagle|P250|Five-SeveN|Tec-9|CZ75-Auto) \|/,
  knives_gloves: /^★ /,
  doppler: /Doppler/,
  fade: /\bFade\b/,
  crimson_web: /Crimson Web/,
  souvenir: /^Souvenir /,
};

async function topByPattern(pattern, limit = 10) {
  return SoldHistory.aggregate([
    { $match: { marketHashName: pattern } },
    { $group: { _id: "$marketHashName", count: { $sum: 1 }, avgPrice: { $avg: "$totalValueCoins" }, lastSale: { $max: "$soldAt" }, firstSale: { $min: "$soldAt" } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
}

for (const [key, pat] of Object.entries(categoryPatterns)) {
  try {
    out.categoryTop[key] = await topByPattern(pat, 12);
    console.log(`Category ${key}: ${out.categoryTop[key].length} distinct names found, top count=${out.categoryTop[key][0]?.count ?? 0}`);
  } catch (e) {
    out.categoryTop[key] = { error: e.message };
    console.log(`Category ${key}: ERROR ${e.message}`);
  }
}

// ── Build candidate sample (~35-45 names) ───────────────────────────────────
const candidates = new Map(); // name -> category label

function addTop(list, cat, n) {
  if (!Array.isArray(list)) return;
  for (const row of list.slice(0, n)) candidates.set(row._id, cat);
}
function addBottom(list, cat, n) {
  if (!Array.isArray(list)) return;
  for (const row of list.slice(-n)) if (!candidates.has(row._id)) candidates.set(row._id, cat + "_rare");
}

addTop(out.categoryTop.ak47_redline, "ak47_redline", 3);
addTop(out.categoryTop.ak47_other, "ak47", 3);
addTop(out.categoryTop.awp, "awp", 3);
addTop(out.categoryTop.m4a4, "m4a4", 2);
addTop(out.categoryTop.m4a1s, "m4a1s", 2);
addTop(out.categoryTop.pistols, "pistol", 3);
addTop(out.categoryTop.knives_gloves, "knife_glove_liquid", 4);
addBottom(out.categoryTop.knives_gloves, "knife_glove", 4);
addTop(out.categoryTop.doppler, "doppler", 3);
addTop(out.categoryTop.fade, "fade", 2);
addTop(out.categoryTop.crimson_web, "crimson_web", 2);
addTop(out.categoryTop.souvenir, "souvenir", 2);
if (!(out.globalTop?.error)) addTop(out.globalTop, "global_top", 5);

console.log(`\nCandidate sample size: ${candidates.size}`);

// ── Per-item deep analysis ───────────────────────────────────────────────────
for (const [name, category] of candidates.entries()) {
  const docs = await SoldHistory.find({ marketHashName: name })
    .select("soldAt totalValueCoins saleId wear")
    .sort({ soldAt: 1 })
    .limit(20000)
    .lean();

  const trueTotal = await SoldHistory.countDocuments({ marketHashName: name });

  if (!docs.length) continue;

  const times = docs.map((d) => new Date(d.soldAt).getTime());
  const first = times[0];
  const last = times[times.length - 1];
  const observedDays = (NOW - first) / 86_400_000;
  const daysSinceLast = (NOW - last) / 86_400_000;

  const windowCount = (days) => times.filter((t) => t >= NOW - days * 86_400_000).length;
  const c7 = windowCount(7), c30 = windowCount(30), c90 = windowCount(90);

  const intervals = [];
  for (let i = 1; i < times.length; i++) intervals.push((times[i] - times[i - 1]) / 86_400_000);
  const sortedIntervals = [...intervals].sort((a, b) => a - b);

  const activeDaysInWindow = (days) => {
    const cutoff = NOW - days * 86_400_000;
    const set = new Set();
    for (const t of times) if (t >= cutoff) set.add(Math.floor(t / 86_400_000));
    return set.size;
  };
  const activeDays30 = activeDaysInWindow(30);
  const activeDays90 = activeDaysInWindow(90);
  const observedDays30 = Math.min(30, observedDays);
  const observedDays90 = Math.min(90, observedDays);

  const baselineVelocity = observedDays > 0 ? trueTotal / observedDays : null;

  const prices = docs.map((d) => d.totalValueCoins).sort((a, b) => a - b);
  const medianPrice = pctile(prices, 0.5);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const outliers = docs.filter((d) => medianPrice > 0 && (d.totalValueCoins > 5 * medianPrice || d.totalValueCoins < 0.2 * medianPrice));

  const saleIdSet = new Set(docs.map((d) => d.saleId));
  const duplicateSaleIdsInSample = docs.length - saleIdSet.size;

  const tsCount = new Map();
  for (const t of times) tsCount.set(t, (tsCount.get(t) || 0) + 1);
  const duplicateTimestamps = [...tsCount.values()].filter((n) => n > 1).length;

  const rapidPairs = intervals.filter((d) => d * 86400 < 5).length; // < 5 seconds apart

  const wearValues = new Set(docs.map((d) => d.wear ?? null));

  out.items.push({
    name, category,
    totalHistoricalSales: trueTotal,
    sampledForIntervals: docs.length,
    sales7d: c7, sales30d: c30, sales90d: c90,
    salesPerDay7d: +(c7 / 7).toFixed(3),
    salesPerDay30d: +(c30 / 30).toFixed(3),
    salesPerDay90d: +(c90 / 90).toFixed(3),
    firstSaleAt: new Date(first).toISOString(),
    lastSaleAt: new Date(last).toISOString(),
    daysSinceLastSale: +daysSinceLast.toFixed(2),
    observedDays: +observedDays.toFixed(2),
    medianIntervalDays: sortedIntervals.length ? +pctile(sortedIntervals, 0.5).toFixed(3) : null,
    avgIntervalDays: intervals.length ? +(intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(3) : null,
    p25IntervalDays: sortedIntervals.length >= 4 ? +pctile(sortedIntervals, 0.25).toFixed(3) : null,
    p75IntervalDays: sortedIntervals.length >= 4 ? +pctile(sortedIntervals, 0.75).toFixed(3) : null,
    longestGapDays: sortedIntervals.length ? +sortedIntervals[sortedIntervals.length - 1].toFixed(2) : null,
    activeDays30, observedDays30: +observedDays30.toFixed(2),
    consistency30: observedDays30 > 0 ? +(activeDays30 / observedDays30).toFixed(3) : null,
    activeDays90, observedDays90: +observedDays90.toFixed(2),
    consistency90: observedDays90 > 0 ? +(activeDays90 / observedDays90).toFixed(3) : null,
    baselineVelocityPerDay: baselineVelocity != null ? +baselineVelocity.toFixed(4) : null,
    relativeVelocity7d: baselineVelocity ? +((c7 / 7) / baselineVelocity).toFixed(3) : null,
    relativeVelocity30d: baselineVelocity ? +((c30 / 30) / baselineVelocity).toFixed(3) : null,
    medianPriceCoins: medianPrice != null ? +medianPrice.toFixed(2) : null,
    avgPriceCoins: +avgPrice.toFixed(2),
    outlierPriceCount: outliers.length,
    duplicateSaleIdsInSample,
    duplicateTimestampGroups: duplicateTimestamps,
    rapidSuccessionPairsUnder5s: rapidPairs,
    distinctWearValues: [...wearValues],
  });
}

console.log(`\nAnalyzed ${out.items.length} items in depth.`);

// ── Data quality: case-variant check on sampled names ───────────────────────
out.quality.caseVariants = [];
for (const item of out.items.slice(0, 15)) {
  const exact = await SoldHistory.countDocuments({ marketHashName: item.name });
  const caseInsensitive = await SoldHistory.countDocuments({ marketHashName: { $regex: `^${esc(item.name)}$`, $options: "i" } });
  if (caseInsensitive !== exact) {
    out.quality.caseVariants.push({ name: item.name, exact, caseInsensitive });
  }
}
console.log(`Case-variant mismatches found: ${out.quality.caseVariants.length}`);

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
console.log(`\nFull JSON written to: ${OUT_PATH}`);

await mongoose.disconnect();
console.log("Done.");
