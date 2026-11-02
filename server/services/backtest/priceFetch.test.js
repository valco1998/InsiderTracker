// Targeted price collection: only signal tickers and needed ranges, benchmark,
// ticker conflicts, SEC/vendor name check (ticker reuse), CSV in the existing
// provider format (read back by the csv provider), up-to-date skip, auth stop.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planPriceRequests, runPriceFetch, namesMatch, canonicalSymbol } from "./priceFetch.js";
import { createCsvProvider } from "../stockData/stockDataProvider.js";
import { TiingoAuthError, TiingoRateLimitError, TiingoInvalidResponseError } from "../stockData/tiingoClient.js";
import { priceTimeline } from "./tracking.js";

const sig = (id, ticker, cik, name, windowFrom, publishedDate) => ({ id, ticker, issuerCik: cik, issuerName: name, windowFrom, publishedDate });
const SIGNALS = [
  sig("1", "ACME", "0000000001", "Acme Corp", "2026-03-02", "2026-03-06"),
  sig("2", "ACME", "0000000001", "Acme Corp", "2026-06-01", "2026-06-04"),
  sig("3", "BRK-B", "0000000002", "Berkshire Hathaway Inc", "2026-05-01", "2026-05-05"),
  sig("4", null, "0000000003", "Private Fund LP", "2026-05-01", "2026-05-05"),
  sig("5", "DUP", "0000000004", "Dup One Inc", "2026-05-01", "2026-05-05"),
  sig("6", "DUP", "0000000005", "Dup Two Inc", "2026-05-01", "2026-05-05"),
];

test("plan: only signal tickers, from 120 days before the first purchase to today, plus the benchmark", () => {
  const { requests, skipped } = planPriceRequests(SIGNALS, { today: "2026-11-02" });
  assert.deepEqual(requests.map((r) => [r.symbol, r.from, r.to, !!r.benchmark]), [
    ["SPY", "2025-11-02", "2026-11-02", true],     // earliest needed date of all tickers
    ["ACME", "2025-11-02", "2026-11-02", false],   // 120 days before its first purchase (2026-03-02); both clusters in one range
    ["BRK.B", "2026-01-01", "2026-11-02", false],  // SEC/Form 4 "BRK-B" → canonical "BRK.B"
  ]);
  assert.deepEqual(skipped.map((s) => s.reason).sort(), ["no_ticker_on_form4", "ticker_used_by_several_issuers"]);
  assert.equal(canonicalSymbol("brk-b"), "BRK.B");
});

test("company name check guards against reused tickers", () => {
  assert.equal(namesMatch("Rapport Therapeutics, Inc.", "Rapport Therapeutics Inc"), true);
  assert.equal(namesMatch("HUNTINGTON BANCSHARES INC /MD/", "Huntington Bancshares Incorporated"), true);
  assert.equal(namesMatch("Acme Corp", "Totally Different Holdings"), false);
  assert.equal(namesMatch(null, "X"), null);
});

function fakeClient({ names = {}, bars = {}, failAuthOn = null } = {}) {
  const calls = [];
  return {
    calls,
    stats: () => ({ requests: calls.length }),
    async meta(symbol) { calls.push(`meta:${symbol}`); if (symbol === failAuthOn) throw new TiingoAuthError("Tiingo rejected the API key (HTTP 401)"); return names[symbol] ? { ticker: symbol.toLowerCase(), name: names[symbol], exchangeCode: "NYSE", startDate: "2000-01-03", endDate: "2026-10-30" } : null; },
    async dailyBars(symbol, { from }) { calls.push(`prices:${symbol}:${from}`); return (bars[symbol] || []).filter((b) => b.date >= from); },
  };
}
const BAR = (date, close, adjClose = close) => ({ date, open: close, high: close, low: close, close, adjClose, volume: 100, splitFactor: 1, divCash: 0 });

test("run: writes provider CSV + metadata, read back by the csv provider; mismatches and unknown tickers are not written", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  const plan = { requests: [
    { symbol: "SPY", from: "2026-01-01", to: "2026-11-02", issuers: [], benchmark: true },
    { symbol: "ACME", from: "2026-01-01", to: "2026-11-02", issuers: [{ cik: "1", name: "Acme Corp" }] },
    { symbol: "REUSED", from: "2026-01-01", to: "2026-11-02", issuers: [{ cik: "2", name: "Old Company Inc" }] },
    { symbol: "GONE", from: "2026-01-01", to: "2026-11-02", issuers: [{ cik: "3", name: "Gone Inc" }] },
  ], skipped: [] };
  const client = fakeClient({
    names: { SPY: "SPDR S&P 500 ETF Trust", ACME: "Acme Corporation", REUSED: "New Unrelated Co" },
    bars: { SPY: [BAR("2026-03-02", 400), BAR("2026-10-30", 440)], ACME: [BAR("2026-03-02", 20), BAR("2026-10-30", 26)], REUSED: [BAR("2026-03-02", 1)] },
  });
  const m = await runPriceFetch({ plan, client, dir, now: () => Date.parse("2026-11-02T22:00:00Z"), log: { log() {}, warn() {} } });
  assert.deepEqual(m.results.map((r) => [r.symbol, r.status]), [["SPY", "ok"], ["ACME", "ok"], ["REUSED", "name_mismatch"], ["GONE", "not_found"]]);
  assert.ok(!client.calls.includes("prices:REUSED:2026-01-01"), "no price download for a mismatched company");
  assert.ok(!fs.existsSync(path.join(dir, "REUSED.csv")));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "ACME.meta.json"), "utf8"));
  assert.equal(meta.licence, "Tiingo Starter — personal use only");
  assert.equal(meta.lastBarDate, "2026-10-30");
  // read back through the existing csv provider + the tracking timeline
  const p = createCsvProvider({ dir, benchmarkSymbol: "SPY" });
  assert.equal(p.available, true);
  assert.equal(await p.resolveSymbol({ cik: "1", ticker: "ACME", asOf: "2026-03-06" }), "ACME");
  const t = priceTimeline({ startDate: "2026-03-02", bars: await p.getDailyBars("ACME"), benchBars: await p.getDailyBars("SPY"), today: "2026-11-02" });
  assert.ok(Math.abs(t.stats.changePct - 0.3) < 1e-9);
  assert.ok(Math.abs(t.stats.benchmarkChangePct - 0.1) < 1e-9);

  // second run the same evening: current files are skipped (no requests)
  const before = client.calls.length;
  const m2 = await runPriceFetch({ plan: { requests: plan.requests.slice(0, 2), skipped: [] }, client, dir, now: () => Date.parse("2026-11-02T23:00:00Z"), log: { log() {}, warn() {} } });
  assert.deepEqual(m2.results.map((r) => r.status), ["up_to_date", "up_to_date"]);
  assert.equal(client.calls.length, before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("run: an invalid API key stops immediately", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  const client = fakeClient({ failAuthOn: "SPY" });
  const m = await runPriceFetch({ plan: { requests: [{ symbol: "SPY", from: "2026-01-01", to: "2026-11-02", issuers: [], benchmark: true }, { symbol: "ACME", from: "2026-01-01", to: "2026-11-02", issuers: [] }], skipped: [] }, client, dir, log: { log() {}, warn() {} } });
  assert.deepEqual(m.results.map((r) => r.status), ["error", "not_attempted"]);
  assert.equal(m.stoppedReason, "invalid_api_key");
  assert.deepEqual(client.calls, ["meta:SPY"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

const quiet = { log() {}, warn() {} };
const REQ = (symbol, extra = {}) => ({ symbol, from: "2026-01-01", to: "2026-11-02", issuers: [{ cik: "1", name: `${symbol} Corp` }], ...extra });
function scripted(behaviour) { // symbol → "ok" | Error
  const calls = [];
  return {
    calls, stats: () => ({ requests: calls.length }),
    async meta(sym) { calls.push(`meta:${sym}`); const b = behaviour[sym]; if (b instanceof Error) throw b; return b === "missing" ? null : { ticker: sym.toLowerCase(), name: `${sym} Corporation` }; },
    async dailyBars(sym) { calls.push(`prices:${sym}`); return [BAR("2026-10-30", 10)]; },
  };
}

test("quotas: monthly unique-symbol and daily request limits stop the run before any extra request", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  const client = scripted({});
  const NOW = () => Date.parse("2026-11-02T22:00:00Z");
  const m = await runPriceFetch({ plan: { requests: [REQ("AAA"), REQ("BBB"), REQ("CCC")], skipped: [] }, client, dir, now: NOW, log: quiet, limits: { symbolsPerMonth: 2, requestsPerDay: 100 } });
  assert.deepEqual(m.results.map((r) => r.status), ["ok", "ok", "not_attempted"]);
  assert.equal(m.stoppedReason, "monthly_symbol_quota");
  assert.ok(!client.calls.some((c) => c.endsWith("CCC")), "no request for the symbol over quota");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "_tiingo-usage.json"), "utf8")).symbols, ["AAA", "BBB"]);
  // daily request quota (2 requests per symbol)
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  const m2 = await runPriceFetch({ plan: { requests: [REQ("AAA"), REQ("BBB")], skipped: [] }, client: scripted({}), dir: dir2, now: NOW, log: quiet, limits: { symbolsPerMonth: 100, requestsPerDay: 3 } });
  assert.deepEqual([m2.results.map((r) => r.status), m2.stoppedReason], [["ok", "not_attempted"], "daily_request_quota"]);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dir2, { recursive: true, force: true });
});

test("HTTP 429 stops the run; invalid responses and failures never overwrite good data", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  const NOW1 = () => Date.parse("2026-10-01T22:00:00Z");
  await runPriceFetch({ plan: { requests: [REQ("AAA")], skipped: [] }, client: scripted({}), dir, now: NOW1, log: quiet });
  const good = fs.readFileSync(path.join(dir, "AAA.csv"), "utf8");
  // a month later: AAA fails with an invalid response, BBB is rate-limited, CCC is never attempted
  const NOW2 = () => Date.parse("2026-11-02T22:00:00Z");
  const client = scripted({ AAA: new TiingoInvalidResponseError("unexpected prices response (not a list)"), BBB: new TiingoRateLimitError("HTTP 429") });
  const m = await runPriceFetch({ plan: { requests: [REQ("AAA"), REQ("BBB"), REQ("CCC")], skipped: [] }, client, dir, now: NOW2, log: quiet });
  assert.deepEqual(m.results.map((r) => r.status), ["error", "rate_limited", "not_attempted"]);
  assert.equal(m.stoppedReason, "rate_limited");
  assert.equal(fs.readFileSync(path.join(dir, "AAA.csv"), "utf8"), good, "previous good file kept");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "AAA.meta.json"), "utf8")).status, "ok");
  assert.ok(!fs.existsSync(path.join(dir, "BBB.csv")));
  fs.rmSync(dir, { recursive: true, force: true });
});
