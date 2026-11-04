// deep4/panel/strategyLib.test.mjs — tests for strategyLib.mjs (synthetic paths + consistency with the panel's own outcomes).
//   node --max-old-space-size=6144 scripts/research/deep4/panel/strategyLib.test.mjs
// No hypothesis is evaluated here: real-data checks only compare two implementations of the same returns.
import assert from "node:assert/strict";
import * as SL from "./strategyLib.mjs";
import * as PL from "./panelLib.mjs";
import { loadPanel, loadControls } from "./data.mjs";

const results = []; let failed = 0;
const test = (name, fn) => { try { const info = fn(); results.push({ name, ok: true, ...(info ? { info } : {}) }); } catch (e) { failed++; results.push({ name, ok: false, error: String(e.stack || e.message).slice(0, 600) }); } };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ---------------- synthetic aligned series (sessions 0..9, one bar per session) ----------------
const mk = (bars) => { const arr = bars.map((b, j) => ({ d: `S${j}`, ...b })); return { arr, kAt: Int32Array.from(arr.map((_, j) => j)), jOfBar: Int32Array.from(arr.map((_, j) => j)), first: "S0", last: `S${arr.length - 1}`, firstJ: 0 }; };
test("limitExit: target hit → fill at max(open, target) with the 0.5% buffer", () => {
  const A = mk([{ o: 100, h: 105, l: 99, c: 104 }, { o: 104, h: 110.4, l: 103, c: 109 }, { o: 109, h: 111, l: 108, c: 110 }]);
  const ex = PL.limitExit(A, 0, 2, 100, 0.10, null);
  assert.equal(ex.why, "tp"); assert.equal(ex.j, 2); close(ex.px, 110); // session 1 high 110.4 < 110*1.005 = 110.55 → not filled
});
test("limitExit: gap above target fills at the open", () => {
  const A = mk([{ o: 100, h: 101, l: 99, c: 100 }, { o: 115, h: 118, l: 114, c: 117 }]);
  const ex = PL.limitExit(A, 0, 1, 100, 0.10, null); assert.equal(ex.why, "tp"); close(ex.px, 115);
});
test("limitExit: stop and target in the same session → stop first (worst case)", () => {
  const A = mk([{ o: 100, h: 101, l: 99, c: 100 }, { o: 100, h: 112, l: 89, c: 105 }]);
  const ex = PL.limitExit(A, 0, 1, 100, 0.10, 0.10); assert.equal(ex.why, "stop"); close(ex.px, 90);
});
test("limitExit: gap below the stop fills at the open", () => {
  const A = mk([{ o: 100, h: 101, l: 99, c: 100 }, { o: 80, h: 85, l: 78, c: 84 }]);
  const ex = PL.limitExit(A, 0, 1, 100, 0.10, 0.10); assert.equal(ex.why, "stop"); close(ex.px, 80);
});
test("limitExit: neither → time exit at the close of jX", () => {
  const A = mk([{ o: 100, h: 101, l: 99, c: 100 }, { o: 100, h: 104, l: 95, c: 103 }, { o: 103, h: 105, l: 101, c: 102 }]);
  const ex = PL.limitExit(A, 0, 2, 100, 0.10, 0.10); assert.equal(ex.why, "time"); close(ex.px, 102); assert.equal(ex.j, 2);
});
test("limitExit for a close entry starts at the next session's real open", () => {
  // entry at the close of S0 (100); S1 opens at 85 (gap through the 10% stop) → fill at 85, not at 90
  const A = mk([{ o: 98, h: 101, l: 97, c: 100 }, { o: 85, h: 88, l: 84, c: 86 }]);
  const ex = PL.limitExit(A, 1, 1, 100, null, 0.10); assert.equal(ex.why, "stop"); close(ex.px, 85);
});

// ---------------- independence, caps, costs ----------------
const T = (o) => ({ entryPrice: 100, exitPrice: 110, costPerSide: 0.0035, costMult: 1, spyRet: 0.01, gross: 0.1, net: PL.netOf(100, 110, 0.0035, 0.0035), sessionsHeld: 5, ...o });
test("independentTrades drops overlapping same-issuer trades only", () => {
  const ts = [T({ key: "a", issuer: 1, entryDate: "2026-01-02", exitDate: "2026-01-09" }), T({ key: "b", issuer: 1, entryDate: "2026-01-05", exitDate: "2026-01-12" }),
    T({ key: "c", issuer: 1, entryDate: "2026-01-12", exitDate: "2026-01-20" }), T({ key: "d", issuer: 2, entryDate: "2026-01-05", exitDate: "2026-01-12" })];
  assert.deepEqual(SL.independentTrades(ts).map((t) => t.key), ["a", "d", "c"]);
});
test("capPerCompany(1) skips a trade while the issuer is held; cap 2 allows two", () => {
  const ts = [T({ key: "a", issuer: 1, entryDate: "2026-01-02", exitDate: "2026-01-09" }), T({ key: "b", issuer: 1, entryDate: "2026-01-05", exitDate: "2026-01-12" }), T({ key: "c", issuer: 1, entryDate: "2026-01-10", exitDate: "2026-01-14" })];
  assert.deepEqual(SL.capPerCompany(ts, 1).map((t) => t.key), ["a", "c"]);
  assert.deepEqual(SL.capPerCompany(ts, 2).map((t) => t.key), ["a", "b", "c"]);
});

// ---------------- real data: same definitions must reproduce the panel's stored outcomes ----------------
const P = loadPanel({ agent: "panel", segments: ["design"] });
const C = loadControls({ agent: "panel", segments: ["design"] });
const M = SL.marketFor(PL.L4.DESIGN_END);
const priced = P.rows.filter((r) => r.priced === 1);
const cmp = (spec, field, opts = {}) => {
  const { trades } = SL.tradesForEvents(M, priced, spec, opts);
  const by = new Map(trades.map((t) => [t.key, t]));
  let n = 0, mism = 0, missing = 0, extra = 0; const ex = [];
  for (const r of priced) {
    const v = r[field], t = by.get(r.key);
    if (v == null && !t) continue;
    if (v == null && t) { extra++; continue; }
    if (v != null && !t) { missing++; continue; }
    n++; if (Math.abs(t.xsNet - v) > 2e-6) { mism++; if (ex.length < 3) ex.push({ key: r.key, panel: v, lib: t.xsNet }); }
  }
  assert.equal(mism + missing + extra, 0, JSON.stringify({ mism, missing, extra, ex }));
  return { compared: n };
};
for (const H of PL.CAL_H) test(`calendar(${H}) trades reproduce B_xsNet${H}`, () => cmp(SL.exits.calendar(H), `B_xsNet${H}`));
for (const N of PL.SESS_N) test(`sessions(${N}) trades reproduce B_sXsNet${N}`, () => cmp(SL.exits.sessions(N), `B_sXsNet${N}`));
for (const H of PL.CAL_H) test(`limit(+10%, no stop, ${H}d) reproduces B_lim10_${H}`, () => cmp(SL.exits.limit({ target: 0.10, maxDays: H }), `B_lim10_${H}`));
test("cost ×2 reproduces B_xsNet2x30", () => {
  const { trades } = SL.tradesForEvents(M, priced, SL.exits.calendar(30), { costMult: 2 });
  let n = 0; for (const t of trades) { const r = priced.find((x) => x.key === t.key); if (r.B_xsNet2x30 == null) continue; n++; close(t.xsNet, r.B_xsNet2x30, 2e-6); }
  return { compared: n };
});
test("no trade exits on/after the design cutoff", () => {
  for (const spec of [SL.exits.calendar(30), SL.exits.sessions(10), SL.exits.limit({ target: 0.2, stop: 0.1, maxDays: 30 })]) {
    const { trades, skipped } = SL.tradesForEvents(M, priced, spec);
    assert.ok(trades.every((t) => t.exitDate < PL.L4.DESIGN_END && t.entryDate < PL.L4.DESIGN_END)); assert.ok((skipped.embargo || 0) > 0);
  }
});
test("control trades with calendar(H) reproduce the stored control means C_xsNet{H}", () => {
  const sample = priced.filter((r) => r.C_n > 0).slice(0, 800);
  let n = 0;
  for (const H of PL.CAL_H) {
    const ctl = SL.controlTradesFor(M, sample, C, SL.exits.calendar(H));
    for (const r of sample) { const ts = ctl.get(r.key); if (r[`C_xsNet${H}`] == null) { assert.equal(ts.length, 0); continue; } n++; close(PL.mean(ts.map((t) => t.xsNet)), r[`C_xsNet${H}`], 2e-6); assert.equal(ts.length, r[`C_xsNet${H}_n`]); }
  }
  return { compared: n };
});
test("strategyMetrics: cost ×0 equals gross minus SPY; ×1 equals the trade net; months and portfolio populated", () => {
  const rows = priced.filter((r) => r.primary === 1).slice(0, 300);
  const { trades } = SL.tradesForEvents(M, rows, SL.exits.calendar(10));
  const ctl = SL.controlTradesFor(M, rows, C, SL.exits.calendar(10));
  const m = SL.strategyMetrics(trades, { controlTrades: ctl, slots: 10, B: 200, label: "api smoke test (first 300 primary rows; not a result)" });
  const ind = SL.independentTrades(trades);
  close(m.costSensitivity.find((c) => c.mult === 0).meanXsNet, PL.r6(PL.mean(ind.map((t) => t.gross - t.spyRet))), 2e-6);
  close(m.costSensitivity.find((c) => c.mult === 1).meanXsNet, m.meanXsNet, 2e-6);
  assert.ok(m.monthTable.length >= 1 && m.portfolio.simple.trades > 0 && m.portfolio.cash.trades > 0 && m.vsControls.n > 0);
  return { n: m.n, nAll: m.nAll, months: m.monthTable.length, exitWhy: m.exitWhy };
});

const out = { ranAt: new Date().toISOString(), passed: results.filter((r) => r.ok).length, failed, results };
PL.writePretty("strategyLib-test.json", out);
console.log(JSON.stringify({ passed: out.passed, failed, failures: results.filter((r) => !r.ok), info: results.filter((r) => r.info).map((r) => [r.name, r.info]) }, null, 1));
if (failed) process.exitCode = 1;
