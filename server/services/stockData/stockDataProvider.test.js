// Price provider abstraction: not-configured default (never returns values) and the
// licensed-CSV provider (parsing, point-in-time symbol map, path safety).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMarketDataProvider, createCsvProvider, parseBarsCsv, describeMarketData, describePriceProvider, MarketDataUnavailable } from "./stockDataProvider.js";

test("default: not configured, never returns values", async () => {
  const p = getMarketDataProvider("");
  assert.equal(p.available, false);
  await assert.rejects(p.getDailyBars("SPY"), MarketDataUnavailable);
  await assert.rejects(p.resolveSymbol({ ticker: "SPY" }), MarketDataUnavailable);
  assert.equal(getMarketDataProvider("yahoo").available, false);
  assert.equal(describeMarketData(p).available, false);
});

test("csv provider: bars, adjusted close, symbol map with dates, path traversal refused", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-"));
  assert.equal(createCsvProvider({ dir }).available, false, "benchmark file missing");
  fs.writeFileSync(path.join(dir, "SPY.csv"), "date,open,high,low,close,adj_close,volume\n2026-01-02,100,101,99,100.5,98.1,1000\n2026-01-05,101,102,100,101.5,99.1,1200\n");
  fs.writeFileSync(path.join(dir, "OLDT.csv"), "Date,Open,High,Low,Close,Adj Close,Volume,Market_Cap\n2026-01-02,5,5,5,5,5,10,123000000\n");
  fs.writeFileSync(path.join(dir, "NEWT.csv"), "date,open,high,low,close,adj_close,volume\n2026-06-02,6,6,6,6,6,10\n");
  fs.writeFileSync(path.join(dir, "symbols.csv"), "cik,symbol,from,to\n5000,OLDT,,2026-03-31\n5000,NEWT,2026-04-01,\n");
  const p = createCsvProvider({ dir, benchmarkSymbol: "SPY" });
  assert.equal(p.available, true);
  const spy = await p.getDailyBars("SPY", { from: "2026-01-03" });
  assert.deepEqual(spy, [{ date: "2026-01-05", open: 101, high: 102, low: 100, close: 101.5, adjClose: 99.1, volume: 1200, marketCap: null }]);
  assert.equal((await p.getDailyBars("OLDT"))[0].marketCap, 123_000_000);
  assert.equal(await p.resolveSymbol({ cik: "0000005000", ticker: "WHATEVER", asOf: "2026-02-01" }), "OLDT");
  assert.equal(await p.resolveSymbol({ cik: "0000005000", ticker: "OLDT", asOf: "2026-05-01" }), "NEWT", "historical ticker change");
  assert.equal(await p.resolveSymbol({ cik: "7", ticker: "spy", asOf: "2026-05-01" }), "SPY", "unmapped issuer → ticker filed on the Form 4");
  assert.deepEqual(await p.getDailyBars("../../etc/passwd"), []);
  assert.deepEqual(await p.getDailyBars("NOPE"), []);
  assert.throws(() => parseBarsCsv("x,y\n1,2"), /date and close/);
  assert.equal(parseBarsCsv("date,close,adj_close,split_factor\n2026-06-01,21,21,2\n")[0].splitFactor, 2, "split factor read from the price file");
  assert.equal(describePriceProvider(p).capabilities.identityMap, true);
  assert.deepEqual(Object.keys(describeMarketData(p)), ["provider", "available", "reason", "delayed"], "company-insights contract unchanged");
  fs.rmSync(dir, { recursive: true, force: true });
});
