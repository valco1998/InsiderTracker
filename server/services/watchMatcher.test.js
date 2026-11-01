import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractVariant,
  extractWear,
  getCanonicalItemId,
  canonicalizeWatchName,
  matchesWatchRule,
  explainWatchRuleMatch,
} from "./watchMatcher.js";

function rule(overrides = {}) {
  return {
    _id: "ruleA",
    userId: "userA",
    baseName: "AK-47 | Redline",
    marketHashName: "AK-47 | Redline (Field-Tested)",
    wear: "Field-Tested",
    cooldownMin: 5,
    ...overrides,
  };
}

function item(overrides = {}) {
  return {
    itemId: "item1",
    market_hash_name: "AK-47 | Redline (Field-Tested)",
    priceCoins: 90,
    discountPct: 0,
    ...overrides,
  };
}

// ── extractVariant ─────────────────────────────────────────────────────────
test("extractVariant: plain name -> NORMAL", () => {
  assert.equal(extractVariant("AK-47 | Redline (Field-Tested)"), "NORMAL");
});
test("extractVariant: StatTrak(TM) -> STATTRAK", () => {
  assert.equal(extractVariant("StatTrak™ AK-47 | Redline (Field-Tested)"), "STATTRAK");
});
test("extractVariant: StatTrak asterisk -> STATTRAK", () => {
  assert.equal(extractVariant("StatTrak* AK-47 | Redline (Field-Tested)"), "STATTRAK");
});
test("extractVariant: bare StatTrak -> STATTRAK", () => {
  assert.equal(extractVariant("StatTrak AK-47 | Redline (Field-Tested)"), "STATTRAK");
});
test("extractVariant: Souvenir -> SOUVENIR", () => {
  assert.equal(extractVariant("Souvenir AWP | Dragon Lore (Field-Tested)"), "SOUVENIR");
});
test("extractVariant: star + StatTrak knife -> STATTRAK (star is not a variant)", () => {
  assert.equal(extractVariant("★ StatTrak™ Bayonet | Forest DDPAT (Field-Tested)"), "STATTRAK");
});
test("extractVariant: plain star knife -> NORMAL (star must not be misread as StatTrak)", () => {
  assert.equal(extractVariant("★ Classic Knife | Fade (Factory New)"), "NORMAL");
});

// ── extractWear ─────────────────────────────────────────────────────────────
test("extractWear: explicit wear_name field wins", () => {
  assert.equal(extractWear({ wear_name: "Field-Tested", market_hash_name: "AK-47 | Redline" }), "Field-Tested");
});
test("extractWear: strict trailing-parenthesis extraction", () => {
  assert.equal(extractWear({ market_hash_name: "AK-47 | Redline (Minimal Wear)" }), "Minimal Wear");
});
test("extractWear: real Doppler+Phase item, explicit wear_name required (suffix breaks trailing-paren match)", () => {
  assert.equal(extractWear({ market_hash_name: "★ Butterfly Knife | Doppler (Factory New) - Phase 2", wear_name: "Factory New" }), "Factory New");
});
test("extractWear: Doppler+Phase with NO explicit wear field -> null (name-only extraction correctly fails, not a false positive)", () => {
  assert.equal(extractWear({ market_hash_name: "★ Butterfly Knife | Doppler (Factory New) - Phase 2" }), null);
});
test("extractWear: no wear info at all -> null", () => {
  assert.equal(extractWear({ market_hash_name: "★ Kukri Knife" }), null);
});
test("extractWear: arbitrary non-wear trailing parenthesis is NOT treated as wear", () => {
  assert.equal(extractWear({ market_hash_name: "Sticker | Titan (Holo)" }), null);
});

// ── getCanonicalItemId ───────────────────────────────────────────────────────
test("getCanonicalItemId: itemId", () => assert.equal(getCanonicalItemId({ itemId: "a" }), "a"));
test("getCanonicalItemId: id", () => assert.equal(getCanonicalItemId({ id: "b" }), "b"));
test("getCanonicalItemId: assetid", () => assert.equal(getCanonicalItemId({ assetid: "c" }), "c"));
test("getCanonicalItemId: assetId", () => assert.equal(getCanonicalItemId({ assetId: "d" }), "d"));
test("getCanonicalItemId: item_id", () => assert.equal(getCanonicalItemId({ item_id: "e" }), "e"));
test("getCanonicalItemId: market_nameid", () => assert.equal(getCanonicalItemId({ market_nameid: "f" }), "f"));
test("getCanonicalItemId: marketNameId", () => assert.equal(getCanonicalItemId({ marketNameId: "g" }), "g"));
test("getCanonicalItemId: none present -> empty string, not throw", () => assert.equal(getCanonicalItemId({}), ""));

// ── canonicalizeWatchName ────────────────────────────────────────────────────
test("canonicalizeWatchName: strips star/StatTrak/Souvenir/TM and lowercases", () => {
  assert.equal(canonicalizeWatchName("★ StatTrak™ AK-47 | Redline (Field-Tested)"), "ak-47 | redline");
});
test("canonicalizeWatchName: preserves Phase suffix (not treated as wear)", () => {
  assert.equal(canonicalizeWatchName("★ Butterfly Knife | Doppler (Factory New) - Phase 2"), "butterfly knife | doppler (factory new) - phase 2");
});
test("canonicalizeWatchName: preserves Ruby/Sapphire/Emerald-style suffixes", () => {
  assert.equal(canonicalizeWatchName("★ Karambit | Doppler (Factory New) - Ruby"), "karambit | doppler (factory new) - ruby");
});

// ═══════════════════════════════════════════════════════════════════════════
// matchesWatchRule — required matrices
// ═══════════════════════════════════════════════════════════════════════════

// ── VARIANT matrix ───────────────────────────────────────────────────────────
test("VARIANT: NORMAL rule x normal item = MATCH", () => {
  assert.equal(matchesWatchRule(item(), rule({ variant: "NORMAL" })), true);
});
test("VARIANT: NORMAL rule x StatTrak item = NO MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "StatTrak™ AK-47 | Redline (Field-Tested)" }), rule({ variant: "NORMAL" })), false);
});
test("VARIANT: NORMAL rule x Souvenir item = NO MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "Souvenir AK-47 | Redline (Field-Tested)" }), rule({ variant: "NORMAL" })), false);
});
test("VARIANT: STATTRAK rule x StatTrak item = MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "StatTrak™ AK-47 | Redline (Field-Tested)" }), rule({ variant: "STATTRAK" })), true);
});
test("VARIANT: STATTRAK rule x normal item = NO MATCH", () => {
  assert.equal(matchesWatchRule(item(), rule({ variant: "STATTRAK" })), false);
});
test("VARIANT: STATTRAK rule x Souvenir item = NO MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "Souvenir AK-47 | Redline (Field-Tested)" }), rule({ variant: "STATTRAK" })), false);
});
test("VARIANT: SOUVENIR rule x Souvenir item = MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "Souvenir AK-47 | Redline (Field-Tested)" }), rule({ variant: "SOUVENIR" })), true);
});
test("VARIANT: SOUVENIR rule x normal item = NO MATCH", () => {
  assert.equal(matchesWatchRule(item(), rule({ variant: "SOUVENIR" })), false);
});
test("VARIANT: SOUVENIR rule x StatTrak item = NO MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "StatTrak™ AK-47 | Redline (Field-Tested)" }), rule({ variant: "SOUVENIR" })), false);
});
test("VARIANT: ANY rule x normal item = MATCH", () => {
  assert.equal(matchesWatchRule(item(), rule({ variant: "ANY" })), true);
});
test("VARIANT: ANY rule x StatTrak item = MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "StatTrak™ AK-47 | Redline (Field-Tested)" }), rule({ variant: "ANY" })), true);
});
test("VARIANT: ANY rule x Souvenir item = MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "Souvenir AK-47 | Redline (Field-Tested)" }), rule({ variant: "ANY" })), true);
});

// ── LEGACY: variant property genuinely absent ───────────────────────────────
test("LEGACY: rule with variant property GENUINELY ABSENT matches normal item", () => {
  const legacyRule = rule();
  assert.equal("variant" in legacyRule, false, "test setup sanity check — variant key must not exist");
  assert.equal(matchesWatchRule(item(), legacyRule), true);
});
test("LEGACY: rule with variant property GENUINELY ABSENT matches StatTrak item", () => {
  const legacyRule = rule();
  assert.equal("variant" in legacyRule, false);
  assert.equal(matchesWatchRule(item({ market_hash_name: "StatTrak™ AK-47 | Redline (Field-Tested)" }), legacyRule), true);
});
test("LEGACY: rule with variant property GENUINELY ABSENT matches Souvenir item", () => {
  const legacyRule = rule();
  assert.equal("variant" in legacyRule, false);
  assert.equal(matchesWatchRule(item({ market_hash_name: "Souvenir AK-47 | Redline (Field-Tested)" }), legacyRule), true);
});

// ── WEAR matrix ──────────────────────────────────────────────────────────────
test("WEAR: FT rule x FT item = MATCH", () => {
  assert.equal(matchesWatchRule(item(), rule({ wear: "Field-Tested" })), true);
});
test("WEAR: FT rule x MW item = NO MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "AK-47 | Redline (Minimal Wear)" }), rule({ wear: "Field-Tested" })), false);
});
test("WEAR: FT rule x item with unavailable wear = NO MATCH (uncertain listings must not alert)", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "AK-47 | Redline", wear_name: null }), rule({ wear: "Field-Tested", marketHashName: "AK-47 | Redline" })), false);
});
test("WEAR: no rule wear x FT item = MATCH", () => {
  assert.equal(matchesWatchRule(item(), rule({ wear: null })), true);
});
test("WEAR: rule wear = 'ANY' x FT item = MATCH", () => {
  assert.equal(matchesWatchRule(item(), rule({ wear: "ANY" })), true);
});

// ── NAME matrix ──────────────────────────────────────────────────────────────
test("NAME: case differences = MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "ak-47 | redline (field-tested)" }), rule()), true);
});
test("NAME: extra whitespace = MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "   AK-47 | Redline (Field-Tested)   " }), rule()), true);
});
test("NAME: star cosmetic difference = MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "★ AK-47 | Redline (Field-Tested)" }), rule()), true);
});
test("NAME: trademark cosmetic difference = MATCH", () => {
  assert.equal(matchesWatchRule(item({ market_hash_name: "AK-47 | Redline™ (Field-Tested)" }), rule()), true);
});
test("NAME: Doppler generic rule matches real Phase-2 item (one-direction containment)", () => {
  const dopplerRule = rule({
    baseName: "Butterfly Knife | Doppler",
    marketHashName: "Butterfly Knife | Doppler (Factory New)",
    wear: "Factory New",
  });
  const dopplerItem = item({
    itemId: "doppler1",
    market_hash_name: "★ Butterfly Knife | Doppler (Factory New) - Phase 2",
    wear_name: "Factory New",
  });
  assert.equal(matchesWatchRule(dopplerItem, dopplerRule), true);
});
test("NAME: reverse containment (rule longer than item) must NOT match", () => {
  const longRule = rule({
    baseName: "Butterfly Knife | Doppler - Phase 2",
    marketHashName: "Butterfly Knife | Doppler (Factory New) - Phase 2",
    wear: "Factory New",
  });
  const shortItem = item({
    itemId: "doppler2",
    market_hash_name: "Butterfly Knife | Doppler (Factory New)",
    wear_name: "Factory New",
  });
  assert.equal(matchesWatchRule(shortItem, longRule), false);
});

// ── PRICE matrix ─────────────────────────────────────────────────────────────
test("PRICE: targetPrice=0 -> no target constraint (real item still matches)", () => {
  assert.equal(matchesWatchRule(item({ priceCoins: 999999 }), rule({ targetPrice: 0 })), true);
});
test("PRICE: targetPrice=null -> no target constraint", () => {
  assert.equal(matchesWatchRule(item({ priceCoins: 999999 }), rule({ targetPrice: null })), true);
});
test("PRICE: targetPrice='' -> no target constraint", () => {
  assert.equal(matchesWatchRule(item({ priceCoins: 999999 }), rule({ targetPrice: "" })), true);
});
test("PRICE: positive targetPrice still rejects an over-target item", () => {
  assert.equal(matchesWatchRule(item({ priceCoins: 150 }), rule({ targetPrice: 100 })), false);
});
test("PRICE: positive targetPrice still accepts an at-or-under-target item", () => {
  assert.equal(matchesWatchRule(item({ priceCoins: 100 }), rule({ targetPrice: 100 })), true);
});

// ── DISCOUNT matrix (Phase 3C precision — reads item.discountPct as-is) ─────
test("DISCOUNT: 5.66% item x minDiscountPct=6 = NO MATCH", () => {
  assert.equal(matchesWatchRule(item({ discountPct: 5.66 }), rule({ minDiscountPct: 6 })), false);
});
test("DISCOUNT: exactly 6% item x minDiscountPct=6 = MATCH", () => {
  assert.equal(matchesWatchRule(item({ discountPct: 6 }), rule({ minDiscountPct: 6 })), true);
});
test("DISCOUNT: 11.1% item (real Phase-3C-shaped value) x minDiscountPct=6 = MATCH", () => {
  assert.equal(matchesWatchRule(item({ discountPct: 11.1 }), rule({ minDiscountPct: 6 })), true);
});

// ── ID matrix ────────────────────────────────────────────────────────────────
for (const [label, idField] of [
  ["itemId", "itemId"], ["id", "id"], ["assetid", "assetid"],
  ["assetId", "assetId"], ["item_id", "item_id"],
  ["market_nameid", "market_nameid"], ["marketNameId", "marketNameId"],
]) {
  test(`ID: ${label} representation is recognized`, () => {
    const testItem = { market_hash_name: "AK-47 | Redline (Field-Tested)", priceCoins: 90, discountPct: 0, [idField]: "xyz123" };
    assert.equal(getCanonicalItemId(testItem), "xyz123");
    assert.equal(matchesWatchRule(testItem, rule()), true);
  });
}

// ── Purity / no-mutation checks ──────────────────────────────────────────────
test("PURITY: matchesWatchRule does not mutate its inputs", () => {
  const i = item();
  const r = rule();
  const iSnapshot = JSON.stringify(i);
  const rSnapshot = JSON.stringify(r);
  matchesWatchRule(i, r);
  assert.equal(JSON.stringify(i), iSnapshot);
  assert.equal(JSON.stringify(r), rSnapshot);
});

// ── explainWatchRuleMatch (Phase 5B) — reason per failing stage ─────────────
test("EXPLAIN: full match -> null", () => {
  assert.equal(explainWatchRuleMatch(item(), rule()), null);
});
test("EXPLAIN: StatTrak item x NORMAL rule -> 'variant'", () => {
  assert.equal(explainWatchRuleMatch(item({ market_hash_name: "StatTrak™ AK-47 | Redline (Field-Tested)" }), rule({ variant: "NORMAL" })), "variant");
});
test("EXPLAIN: empty rule name -> 'no_rule_name'", () => {
  assert.equal(explainWatchRuleMatch(item(), rule({ baseName: "", marketHashName: "" })), "no_rule_name");
});
test("EXPLAIN: different skin -> 'name'", () => {
  assert.equal(explainWatchRuleMatch(item({ market_hash_name: "M4A4 | Howl (Field-Tested)" }), rule()), "name");
});
test("EXPLAIN: wear undeterminable -> 'wear_unknown'", () => {
  assert.equal(explainWatchRuleMatch(item({ market_hash_name: "AK-47 | Redline", wear_name: null }), rule({ wear: "Field-Tested", marketHashName: "AK-47 | Redline" })), "wear_unknown");
});
test("EXPLAIN: wear mismatch -> 'wear'", () => {
  assert.equal(explainWatchRuleMatch(item({ market_hash_name: "AK-47 | Redline (Minimal Wear)" }), rule({ wear: "Field-Tested" })), "wear");
});
test("EXPLAIN: over target -> 'target_price'", () => {
  assert.equal(explainWatchRuleMatch(item({ priceCoins: 150 }), rule({ targetPrice: 100 })), "target_price");
});
test("EXPLAIN: missing price with a target -> 'target_price'", () => {
  assert.equal(explainWatchRuleMatch(item({ priceCoins: 0 }), rule({ targetPrice: 100 })), "target_price");
});
test("EXPLAIN: below min discount -> 'min_discount'", () => {
  assert.equal(explainWatchRuleMatch(item({ discountPct: 5.66 }), rule({ minDiscountPct: 6 })), "min_discount");
});
test("EXPLAIN: reports the FIRST failing stage (wear before price/discount)", () => {
  assert.equal(
    explainWatchRuleMatch(item({ market_hash_name: "AK-47 | Redline (Minimal Wear)", priceCoins: 999, discountPct: 0 }), rule({ wear: "Field-Tested", targetPrice: 1, minDiscountPct: 50 })),
    "wear"
  );
});

// ── Equivalence: matchesWatchRule === (explainWatchRuleMatch === null) ──────
test("EQUIVALENCE: boolean wrapper agrees with explain across a fixture cross-product", () => {
  const names = [
    "AK-47 | Redline (Field-Tested)",
    "AK-47 | Redline (Minimal Wear)",
    "AK-47 | Redline",
    "StatTrak™ AK-47 | Redline (Field-Tested)",
    "Souvenir AK-47 | Redline (Field-Tested)",
    "★ Butterfly Knife | Doppler (Factory New) - Phase 2",
    "M4A4 | Howl (Field-Tested)",
    "",
  ];
  const items = [];
  for (const n of names) {
    for (const priceCoins of [0, 50, 100, 150]) {
      for (const discountPct of [0, 5.66, 6, 20]) {
        items.push(item({ market_hash_name: n, priceCoins, discountPct }));
        items.push(item({ market_hash_name: n, priceCoins, discountPct, wear_name: "Field-Tested" }));
      }
    }
  }
  const rules = [];
  for (const variant of [undefined, "ANY", "NORMAL", "STATTRAK", "SOUVENIR"]) {
    for (const wear of [null, "ANY", "Field-Tested", "Factory New"]) {
      for (const targetPrice of [undefined, 0, "", 100]) {
        for (const minDiscountPct of [undefined, 0, 6]) {
          for (const names2 of [
            { baseName: "AK-47 | Redline", marketHashName: "AK-47 | Redline (Field-Tested)" },
            { baseName: "Butterfly Knife | Doppler", marketHashName: "" },
            { baseName: "", marketHashName: "" },
          ]) {
            const r = rule({ wear, targetPrice, minDiscountPct, ...names2 });
            if (variant === undefined) delete r.variant; else r.variant = variant;
            rules.push(r);
          }
        }
      }
    }
  }
  let checked = 0;
  for (const i of items) {
    for (const r of rules) {
      const reason = explainWatchRuleMatch(i, r);
      assert.equal(matchesWatchRule(i, r), reason === null);
      checked += 1;
    }
  }
  assert.ok(checked > 10000);
});
