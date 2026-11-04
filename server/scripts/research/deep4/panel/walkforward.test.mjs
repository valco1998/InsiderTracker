// deep4/panel/walkforward.test.mjs — leakage tests for walkforward.mjs (fake models; no hypothesis is evaluated).
//   node --max-old-space-size=6144 scripts/research/deep4/panel/walkforward.test.mjs
import assert from "node:assert/strict";
import { walkForward, warmupReport } from "./walkforward.mjs";
import { loadPanel, loadControls } from "./data.mjs";
import { writePretty } from "./panelLib.mjs";

const results = []; let failed = 0;
const test = (name, fn) => { try { const info = fn(); results.push({ name, ok: true, ...(info ? { info } : {}) }); } catch (e) { failed++; results.push({ name, ok: false, error: String(e.stack || e.message).slice(0, 600) }); } };

// ---------------- fixtures ----------------
const F = (key, publishedAt, end, x) => ({ key, cik: 1, person: "p", segment: "design", month: publishedAt.slice(0, 7), publishedAt, decisionAt: publishedAt, B_end30: end, B_xsNet30: x });
const fx = [
  F("a", "2026-01-05 10:00:00", "2026-02-04", 0.1),
  F("b", "2026-01-20 10:00:00", "2026-02-19", 0.2),
  F("c", "2026-01-31 10:00:00", "2026-03-01", 0.3), // ends ON the March start → not trainable for March
  F("d", "2026-02-10 10:00:00", "2026-03-12", -0.1),
  F("e", "2026-03-03 10:00:00", "2026-04-02", 0.0),
  F("f", "2026-03-20 10:00:00", null, null), // embargoed / unavailable outcome
];
const seen = [];
const fakeFit = (train, ctx) => { seen.push({ month: ctx.month, keys: train.map((r) => r.key).sort() }); return Object.freeze({ mean: train.length ? train.reduce((a, r) => a + r.B_xsNet30, 0) / train.length : 0, maxEnd: ctx.trainMaxEnd }); };
const fakePredict = (model, row) => { if (model.maxEnd && !(model.maxEnd < row.decisionAt.slice(0, 10))) throw new Error(`leak: model trained on an outcome ending ${model.maxEnd} scored ${row.key}`); return model.mean; };
const wf = walkForward({ agent: "panel", rows: fx, fit: fakeFit, predict: fakePredict });
test("training sets contain only outcomes that ended before the month start", () => {
  const by = Object.fromEntries(seen.map((s) => [s.month, s.keys]));
  assert.deepEqual(by["2026-01"], []);
  assert.deepEqual(by["2026-02"], []);           // a ends 02-04 (after Feb 1)
  assert.deepEqual(by["2026-03"], ["a", "b"]);    // c ends 03-01 = March start → excluded
  return by;
});
test("every month's rows are scored by the model frozen at the month start; unavailable outcomes are recorded as null", () => {
  const m3 = wf.predictions.filter((p) => p.month === "2026-03");
  assert.equal(m3.length, 2); assert.ok(Math.abs(m3[0].prediction - 0.15) < 1e-12); assert.equal(m3.find((p) => p.key === "f").realized, null);
});
test("a row whose outcome ends after the month start drops out of training", () => {
  const wf2 = walkForward({ agent: "panel", rows: fx, fit: (t) => ({ keys: t.map((r) => r.key) }), predict: (m) => m.keys.length, endField: (r) => (r.key === "a" ? "2026-03-15" : r.B_end30), months: ["2026-03"] });
  assert.equal(wf2.predictions[0].prediction, 1); // only b remains
});
test("defensive invariant throws if a training row's end is on/after the month start (mutating row)", () => {
  let calls = 0; // first read (maturity filter) passes, later reads (max-end audit) return a late date
  const endField = (r) => (r.key === "a" ? (calls++ === 0 ? "2026-02-04" : "2026-03-15") : r.B_end30);
  assert.throws(() => walkForward({ agent: "panel", rows: fx, fit: fakeFit, predict: fakePredict, endField, months: ["2026-03"] }), /leakage/);
});
test("minTrain marks warm-up months and skips fitting", () => {
  const w = walkForward({ agent: "panel", rows: fx, fit: fakeFit, predict: fakePredict, minTrain: 2 });
  assert.deepEqual(w.months.map((m) => m.warmup), [true, true, false]);
});
test("locked segments are refused", () => {
  assert.throws(() => walkForward({ agent: "panel", rows: fx, fit: fakeFit, predict: fakePredict, segment: "confirm" }), /locked/);
  assert.throws(() => walkForward({ agent: "panel", rows: [{ ...fx[0], publishedAt: "2026-07-01 10:00:00" }], fit: fakeFit, predict: fakePredict }), /guard/);
});

// ---------------- real design panel: fake models, leakage audit and warm-up counts ----------------
const P = loadPanel({ agent: "panel", segments: ["design"] });
const C = loadControls({ agent: "panel", segments: ["design"] });
const ctlRows = [...C.rows.values()];
const audit = { violations: 0, fits: 0, rowsChecked: 0 };
const byKey = new Map(P.rows.map((r) => [r.key, r]));
for (const H of [5, 10, 20, 30]) {
  const fit = (train, ctx) => {
    audit.fits++;
    for (const r of train) { audit.rowsChecked++; const end = r[`B_end${H}`]; if (!(end < ctx.monthStart) || r[`B_xsNet${H}`] == null) audit.violations++; if (!r.isControl && !(r.publishedAt < ctx.monthStart)) audit.violations++; }
    return { m: ctx.monthStart };
  };
  const predict = (model, row) => { if (!(model.m <= String(row.decisionAt ?? row.entryDate).slice(0, 10))) audit.violations++; return 0; };
  walkForward({ agent: "panel", rows: P.rows, controls: ctlRows, horizon: H, fit, predict, eligible: (r) => r.primary === 1 || r.ctlKey != null, trainFilter: (r) => r.primary === 1 || r.ctlKey != null,
    includeControlsInTrain: true, evalControls: true, keepPredictions: false });
}
test("real panel: no training row (events or controls) ends on/after its month start; models never score earlier rows", () => { assert.equal(audit.violations, 0); return audit; });
const warm = warmupReport({ agent: "panel", rows: P.rows, eligible: (r) => r.primary === 1 });
test("warm-up report covers the design months and marks locked segments", () => { assert.equal(warm.confirm.locked, true); assert.equal(warm.exposed.locked, true); assert.ok(warm.design.months.length >= 6); });

const out = { ranAt: new Date().toISOString(), passed: results.filter((r) => r.ok).length, failed, results, warmup: warm };
writePretty("walkforward-test.json", out);
writePretty("warmup-independence.json", warm);
console.log(JSON.stringify({ passed: out.passed, failed, failures: results.filter((r) => !r.ok), audit }, null, 1));
for (const H of [5, 30]) console.log(`H${H}`, JSON.stringify(warm.design.perHorizon[H].table.map((t) => [t.month, t.trainN, t.evalWithOutcome, t.usable])), "independent months:", warm.design.perHorizon[H].independentMonthlyEvaluations);
if (failed) process.exitCode = 1;
