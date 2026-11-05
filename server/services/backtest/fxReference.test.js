// FX reference rates (ECB via Frankfurter) — fake network, temp cache.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFxReferenceService, FX_SOURCE } from "./fxReference.js";

const quiet = { log() {}, warn() {} };
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fx-")), "rates.json");

test("rates are fetched once, cached with the rate date actually used, and failures are null", async () => {
  const calls = [];
  const fetchJson = async (url) => { calls.push(url); if (url.includes("XXX")) throw new Error("HTTP 404"); return { amount: 1, base: "BRL", date: "2026-10-02", rates: { USD: 0.19 } }; };
  const file = tmp();
  const fx = createFxReferenceService({ fetchJson, cacheFile: file, log: quiet });
  const t = await fx.getRates([{ code: "BRL", date: "2026-10-04" }, { code: "XXX", date: "2026-10-04" }, { code: "brl", date: "x" }]);
  assert.deepEqual(t.get("BRL|2026-10-04"), { rate: 0.19, rateDate: "2026-10-02", source: FX_SOURCE });
  assert.equal(t.get("XXX|2026-10-04"), null);
  assert.equal(t.get("brl|x"), null, "invalid input is not requested");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /api\.frankfurter\.app\/2026-10-04\?from=BRL&to=USD/);
  const again = createFxReferenceService({ fetchJson: async () => { throw new Error("must use the cache"); }, cacheFile: file, log: quiet });
  assert.equal((await again.getRates([{ code: "BRL", date: "2026-10-04" }])).get("BRL|2026-10-04").rate, 0.19);
  assert.equal(fx.lookupFrom(t)("BRL", "2026-10-04").rate, 0.19);
  assert.equal(fx.lookupFrom(t)("EUR", "2026-10-04"), null);
});

test("a response without a USD rate is a failure, not a zero", async () => {
  const fx = createFxReferenceService({ fetchJson: async () => ({ date: "2026-10-02", rates: {} }), cacheFile: tmp(), log: quiet });
  assert.equal((await fx.getRates([{ code: "EUR", date: "2026-10-02" }])).get("EUR|2026-10-02"), null);
});
