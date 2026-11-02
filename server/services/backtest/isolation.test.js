// Tiingo is used ONLY by Backtesting: the historical price fetch (CLI) and the
// current-price quote of the tracking panel (services/backtest/liveQuote.js, used
// only by the backtest engine). No other server module may reach the Tiingo
// client, the browser app never contacts Tiingo, and company pages never report it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENT_SRC = path.resolve(SERVER, "..", "client", "src");
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|^\s*import\s*["'](\.{1,2}\/[^"']+)["']/gm;

function importGraph(entry) {
  const seen = new Set(), stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) stack.push(path.resolve(path.dirname(f), m[1] || m[2] || m[3]));
  }
  return seen;
}
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(m?js|jsx|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(SERVER, f).split(path.sep).join("/");

test("the web server reaches the Tiingo client only through the backtest quote service", () => {
  const graph = [...importGraph(path.join(SERVER, "insider-mvp.js"))];
  const relGraph = graph.map(rel);
  assert.ok(relGraph.includes("services/backtest/backtestEngine.js"), "sanity: the graph includes the backtest");
  assert.ok(!relGraph.some((f) => f.startsWith("scripts/")), "server must not load CLI scripts");
  const importers = (target) => graph.filter((f) => [...fs.readFileSync(f, "utf8").matchAll(IMPORT_RE)]
    .some((m) => path.resolve(path.dirname(f), m[1] || m[2] || m[3]) === path.join(SERVER, target))).map(rel).sort();
  assert.deepEqual(importers("services/stockData/tiingoClient.js"), ["services/backtest/liveQuote.js"]);
  assert.deepEqual(importers("services/backtest/liveQuote.js"), ["services/backtest/backtestEngine.js"]);
});

test("only the Tiingo client contacts Tiingo; only the price-fetch CLI and the backtest quote service use it", () => {
  const files = walk(SERVER).filter((f) => !/\.test\.(m?js)$/.test(f));
  const hosts = files.filter((f) => fs.readFileSync(f, "utf8").includes("api.tiingo.com")).map(rel);
  assert.deepEqual(hosts, ["services/stockData/tiingoClient.js"]);
  const users = files.filter((f) => /tiingoClient\.js["']/.test(fs.readFileSync(f, "utf8"))).map(rel).sort();
  assert.deepEqual(users, ["scripts/fetchSignalPrices.mjs", "services/backtest/liveQuote.js"]);
});

test("the backtest price provider is used only by the backtest; the browser never contacts Tiingo", () => {
  const files = walk(SERVER).filter((f) => !/\.test\.(m?js)$/.test(f) && !rel(f).startsWith("scripts/"));
  const users = files.filter((f) => /getBacktestPriceProvider|getMarketDataProvider\(/.test(fs.readFileSync(f, "utf8"))).map(rel).sort();
  assert.deepEqual(users, ["services/backtest/backtestEngine.js", "services/stockData/stockDataProvider.js"]);
  // The browser only talks to our server: no Tiingo host, no key handling (source labels in UI text are fine).
  const clientHits = walk(CLIENT_SRC).filter((f) => /tiingo.com|VITE_TIINGO|Authorization:s*["'`]?Token/i.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(CLIENT_SRC, f));
  assert.deepEqual(clientHits, [], "the browser app never contacts Tiingo or handles its key");
});

test("company pages never report the backtest's price files, even when they are configured", async () => {
  const prev = process.env.STOCK_DATA_PROVIDER;
  process.env.STOCK_DATA_PROVIDER = "csv";
  try {
    const { describeMarketData } = await import("../stockData/stockDataProvider.js");
    const m = describeMarketData();
    assert.equal(m.available, false);
    assert.equal(m.provider, null);
    assert.match(m.reason, /No licensed market-data provider/);
  } finally { if (prev === undefined) delete process.env.STOCK_DATA_PROVIDER; else process.env.STOCK_DATA_PROVIDER = prev; }
});
