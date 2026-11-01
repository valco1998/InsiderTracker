import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSalesUrl,
  toSoldAt,
  nameOf,
  filterValidEntries,
  buildUpsertOps,
} from "./soldHistoryFetcher.js";
import { extractWearFromName } from "../controllers/alerts.controller.js";

// Live fixture shape captured from GET /api/v2/trading/item/361361109/sales
// during root-cause verification (2026-07-17) — real field names/types,
// values trimmed/reused across entries for brevity.
const SALE_A = {
  id: 30788348,
  total_value: 1025590,
  created_at: 1783635806, // Unix epoch seconds
  item: {
    icon_url: "i0CoZ81Ui0m",
    market_name: "M4A4 | Howl (Factory New)",
    wear: 0.052, // raw paint-wear float — NOT the condition string
    keychains: [],
    stickers: [],
    preview_id: "1984d47bea46",
  },
};

const MARKET_HASH_NAME = "M4A4 | Howl (Factory New)";

test("buildSalesUrl appends /sales to the item detail endpoint", () => {
  assert.equal(
    buildSalesUrl("https://csgoempire.com/api/v2", "361361109"),
    "https://csgoempire.com/api/v2/trading/item/361361109/sales"
  );
});

test("buildSalesUrl strips a trailing slash on the base URL", () => {
  assert.equal(
    buildSalesUrl("https://csgoempire.com/api/v2/", "361361109"),
    "https://csgoempire.com/api/v2/trading/item/361361109/sales"
  );
});

test("toSoldAt converts Unix epoch seconds to the correct Date", () => {
  const d = toSoldAt(1783635806);
  assert.ok(d instanceof Date);
  assert.equal(d.getTime(), 1783635806 * 1000);
  // Sanity check it lands in 2026, not 1970 (the ms-vs-seconds bug this fixes).
  assert.equal(d.getUTCFullYear(), 2026);
});

test("toSoldAt returns null for missing/non-numeric/zero created_at", () => {
  assert.equal(toSoldAt(undefined), null);
  assert.equal(toSoldAt(null), null);
  assert.equal(toSoldAt("not-a-number"), null);
  assert.equal(toSoldAt(0), null);
  assert.equal(toSoldAt(-1), null);
});

test("extractWearFromName extracts all five wear conditions", () => {
  assert.equal(extractWearFromName("M4A4 | Howl (Factory New)"), "Factory New");
  assert.equal(extractWearFromName("AK-47 | Redline (Minimal Wear)"), "Minimal Wear");
  assert.equal(extractWearFromName("AK-47 | Redline (Field-Tested)"), "Field-Tested");
  assert.equal(extractWearFromName("AWP | Asiimov (Well-Worn)"), "Well-Worn");
  assert.equal(extractWearFromName("AWP | Asiimov (Battle-Scarred)"), "Battle-Scarred");
});

test("extractWearFromName returns empty string for names without a condition suffix", () => {
  assert.equal(extractWearFromName("Sticker | Titan (Holo) | Katowice 2015"), "");
  assert.equal(extractWearFromName(""), "");
});

test("nameOf prefers market_name, falls back to market_hash_name", () => {
  assert.equal(nameOf({ item: { market_name: "A", market_hash_name: "B" } }), "A");
  assert.equal(nameOf({ item: { market_hash_name: "B" } }), "B");
  assert.equal(nameOf({ item: {} }), null);
});

test("filterValidEntries accepts a real /sales entry and derives wear from the name, not the float", () => {
  const { validEntries, rejected } = filterValidEntries([SALE_A], MARKET_HASH_NAME);

  assert.equal(validEntries.length, 1);
  assert.deepEqual(rejected, { name: 0, timestamp: 0, value: 0 });

  const [entry] = validEntries;
  assert.equal(entry.wear, "Factory New");
  assert.ok(entry.soldAt instanceof Date);
  assert.equal(entry.soldAt.getTime(), 1783635806 * 1000);
});

test("filterValidEntries rejects entries whose name doesn't match the requested skin", () => {
  const mismatched = { ...SALE_A, item: { ...SALE_A.item, market_name: "AK-47 | Redline (Field-Tested)" } };
  const { validEntries, rejected } = filterValidEntries([mismatched], MARKET_HASH_NAME);

  assert.equal(validEntries.length, 0);
  assert.equal(rejected.name, 1);
});

test("filterValidEntries rejects entries with an invalid/missing timestamp", () => {
  const badTimestamp = { ...SALE_A, created_at: null };
  const { validEntries, rejected } = filterValidEntries([badTimestamp], MARKET_HASH_NAME);

  assert.equal(validEntries.length, 0);
  assert.equal(rejected.timestamp, 1);
});

test("filterValidEntries rejects entries with a non-positive total_value", () => {
  const badValue = { ...SALE_A, total_value: 0 };
  const { validEntries, rejected } = filterValidEntries([badValue], MARKET_HASH_NAME);

  assert.equal(validEntries.length, 0);
  assert.equal(rejected.value, 1);
});

test("buildUpsertOps builds one upsert per entry keyed by saleId", () => {
  const { validEntries } = filterValidEntries([SALE_A], MARKET_HASH_NAME);
  const ops = buildUpsertOps(validEntries, MARKET_HASH_NAME);

  assert.equal(ops.length, 1);
  const [op] = ops;
  assert.equal(op.updateOne.filter.saleId, String(SALE_A.id));
  assert.equal(op.updateOne.upsert, true);
  assert.equal(op.updateOne.update.$setOnInsert.wear, "Factory New");
  assert.equal(op.updateOne.update.$setOnInsert.totalValueCoins, SALE_A.total_value / 100);
  assert.equal(op.updateOne.update.$setOnInsert.soldAt.getTime(), 1783635806 * 1000);
});

test("buildUpsertOps is idempotent under duplicate saleIds — same entry twice yields two ops with the same filter", () => {
  // bulkWrite's own unique-saleId index (SoldHistory.model.js) is what actually
  // enforces dedup against Mongo; this proves the ops we hand it are shaped so
  // that re-running over the same data can never overwrite an existing row —
  // both ops use upsert + $setOnInsert against the identical saleId filter.
  const { validEntries } = filterValidEntries([SALE_A, SALE_A], MARKET_HASH_NAME);
  const ops = buildUpsertOps(validEntries, MARKET_HASH_NAME);

  assert.equal(ops.length, 2);
  assert.equal(ops[0].updateOne.filter.saleId, ops[1].updateOne.filter.saleId);
  assert.ok(ops.every((op) => op.updateOne.upsert === true));
  assert.ok(ops.every((op) => "$setOnInsert" in op.updateOne.update));
});
