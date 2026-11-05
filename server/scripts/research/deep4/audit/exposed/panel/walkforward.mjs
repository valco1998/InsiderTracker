// deep4/panel/walkforward.mjs — monthly walk-forward engine with an outcome-maturity embargo (agent "panel").
//
//   import { walkForward, warmupReport } from "../panel/walkforward.mjs";
//   const res = walkForward({
//     agent: "learn", rows,                       // panel rows from data.mjs loadPanel({ agent }) (guarded)
//     controls,                                   // optional: control rows (data.mjs loadControls(...).rows values)
//     horizon: 30, target: (r) => r.B_xsNet30,    // realised outcome used for training labels and scoring
//     fit: (train, ctx) => model,                 // must return a FROZEN model (no reference to future rows)
//     predict: (model, row, ctx) => number | boolean | null,
//     eligible: (r) => r.primary === 1,           // rows scored in each evaluation month
//     trainFilter: (r) => r.primary === 1,        // rows allowed in the training set
//     includeControlsInTrain: false, evalControls: true,
//   });
//
// Rules:
//   • evaluation month m (by DECISION month: the month of publishedAt) with start m0 = first day of m;
//   • training set = rows (and, optionally, controls) whose outcome window for the chosen horizon ENDED before m0
//     (lib4.maturedBy(end, m0); end = B_end{H} or A_end{H}) and whose label is available. Since every horizon is <= 30
//     calendar days this is (at least) the 30-day embargo; a row published in month m-1 whose window ends in month m is
//     excluded. The model is fitted ONCE per month and frozen; every row decided in m is scored with it;
//   • only months of segments visible to `agent` are evaluated (lib4 guards); design-segment labels are never past
//     2026-06-15 because the design panel embargoes them;
//   • every prediction is recorded with its realised outcome (null when the outcome is not available / embargoed).
import * as L4 from "../../../lib4.mjs";

const day = (s) => String(s).slice(0, 10);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const monthStart = (m) => `${m}-01`;
const nextMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
function spearman(a, b) {
  const n = a.length; if (n < 5) return null;
  const rank = (xs) => { const idx = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(n); let i = 0; while (i < n) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const ra = rank(a), rb = rank(b), ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}
const isVisibleSeg = (seg, agent) => seg === "design" || (seg === "confirm" && L4.confirmUnlocked(agent)) || (seg === "exposed" && L4.exposedUnlocked());
const segmentEndOf = (seg) => (seg === "design" ? L4.DESIGN_END : seg === "confirm" ? L4.EXPOSED_START : null);

export function walkForward({ agent, rows, controls = null, horizon = 30, outcome = "B", target = null, fit, predict, eligible = () => true, trainFilter = () => true,
  segment = "design", months = null, minTrain = 0, includeControlsInTrain = false, evalControls = false, endField = null, keepPredictions = true } = {}) {
  if (!agent) throw new Error("walkForward: agent is required (lib4 guard)");
  if (typeof fit !== "function" || typeof predict !== "function") throw new Error("walkForward: fit and predict callbacks are required");
  if (!isVisibleSeg(segment, agent)) throw new Error(`walkForward: segment ${segment} is locked for agent ${agent}`);
  for (const r of rows) L4.assertVisible(r.publishedAt, agent);
  const endOf = endField || ((r) => r[`${outcome}_end${horizon}`]);
  const labelOf = target || ((r) => r[outcome === "B" ? `B_xsNet${horizon}` : `A_xs${horizon}`]);
  const ctlRows = controls ? [...controls] : [];
  for (const c of ctlRows) if (!isVisibleSeg(c.segment, agent)) throw new Error(`walkForward: control row of locked segment ${c.segment}`);
  const evalMonths = months || [...new Set(rows.filter((r) => r.segment === segment).map((r) => r.month))].sort();
  const report = [], predictions = [];
  for (const m of evalMonths) {
    const m0 = monthStart(m);
    const lab = (r) => { const v = labelOf(r); return v == null || (typeof v === "number" && !Number.isFinite(v)) ? null : v; };
    const train = rows.filter((r) => trainFilter(r) && L4.maturedBy(endOf(r), m0) && lab(r) != null);
    const trainCtl = includeControlsInTrain ? ctlRows.filter((c) => trainFilter(c) && L4.maturedBy(endOf(c), m0) && lab(c) != null).map((c) => ({ ...c, isControl: 1 })) : [];
    const ctx = { month: m, monthStart: m0, segment, horizon, outcome, trainN: train.length, trainControlsN: trainCtl.length, trainMaxEnd: [...train, ...trainCtl].reduce((x, r) => (endOf(r) > x ? endOf(r) : x), "") };
    // invariant: nothing in the training set ends on/after the month start
    if (ctx.trainMaxEnd && !(day(ctx.trainMaxEnd) < m0)) throw new Error(`walkForward: leakage, training row ends ${ctx.trainMaxEnd} >= ${m0}`);
    const evalRows = rows.filter((r) => r.segment === segment && r.month === m && eligible(r));
    const evalCtl = evalControls ? ctlRows.filter((c) => c.segment === segment && c.entryMonth === m && eligible(c)) : [];
    const skip = train.length + trainCtl.length < minTrain;
    const model = skip ? null : fit(train.concat(trainCtl), ctx);
    const recs = [];
    for (const [r, isC] of [...evalRows.map((r) => [r, 0]), ...evalCtl.map((c) => [c, 1])]) {
      const p = skip ? null : predict(model, r, ctx);
      recs.push({ key: isC ? r.ctlKey : r.key, isControl: isC, month: m, issuer: isC ? r.sym : r.cik, decisionAt: isC ? r.entryDate : r.decisionAt, end: endOf(r) ?? null, prediction: p, realized: lab(r) });
    }
    const scored = recs.filter((x) => !x.isControl && x.prediction != null && typeof x.prediction !== "object" && x.realized != null);
    const scoredC = recs.filter((x) => x.isControl && x.prediction != null && typeof x.prediction !== "object" && x.realized != null);
    const numPred = (xs) => xs.map((x) => (typeof x.prediction === "boolean" ? (x.prediction ? 1 : 0) : x.prediction));
    const sel = (xs, on) => xs.filter((x) => (typeof x.prediction === "boolean" ? x.prediction : x.prediction === 1) === on).map((x) => x.realized);
    const binary = scored.length && scored.every((x) => typeof x.prediction === "boolean" || x.prediction === 0 || x.prediction === 1);
    report.push({
      month: m, monthStart: m0, warmup: skip, trainN: train.length, trainControlsN: trainCtl.length, trainMaxEnd: ctx.trainMaxEnd || null, trainIssuers: new Set(train.map((r) => r.cik)).size,
      evalN: evalRows.length, evalControlsN: evalCtl.length, scoredN: scored.length, scoredIssuers: new Set(scored.map((x) => x.issuer)).size, scoredControlsN: scoredC.length,
      meanPrediction: mean(numPred(scored)), meanRealized: mean(scored.map((x) => x.realized)), spearman: binary ? null : spearman(numPred(scored), scored.map((x) => x.realized)),
      selectedN: binary ? sel(scored, true).length : null, selectedMean: binary ? mean(sel(scored, true)) : null, notSelectedMean: binary ? mean(sel(scored, false)) : null,
      controlsSelectedN: binary && scoredC.length ? sel(scoredC, true).length : null, controlsSelectedMean: binary && scoredC.length ? mean(sel(scoredC, true)) : null,
      controlsSpearman: !binary && scoredC.length ? spearman(numPred(scoredC), scoredC.map((x) => x.realized)) : null,
    });
    if (keepPredictions) predictions.push(...recs);
  }
  const active = report.filter((r) => !r.warmup && r.scoredN > 0);
  return { agent, segment, horizon, outcome, months: report, predictions, summary: { months: report.length, warmupMonths: report.filter((r) => r.warmup).length, evaluatedMonths: active.length,
    scoredN: active.reduce((a, r) => a + r.scoredN, 0), firstEvaluatedMonth: active[0]?.month ?? null } };
}

// Warm-up / independence counts: for each segment month, how many matured training outcomes exist at the month start, how
// many rows are decided in the month and how many of those have an outcome available inside the segment (embargo).
export function warmupReport({ agent, rows, horizons = [5, 10, 20, 30], outcome = "B", eligible = () => true, minTrain = 100, minEval = 20 } = {}) {
  for (const r of rows) L4.assertVisible(r.publishedAt, agent);
  const out = {};
  for (const seg of ["design", "confirm", "exposed"]) {
    if (!isVisibleSeg(seg, agent)) { out[seg] = { locked: true }; continue; }
    const segRows = rows.filter((r) => r.segment === seg && eligible(r));
    if (!segRows.length) { out[seg] = { rows: 0 }; continue; }
    const months = [...new Set(segRows.map((r) => r.month))].sort();
    const perH = {};
    for (const H of horizons) {
      const endOf = (r) => r[`${outcome}_end${H}`], lab = (r) => r[outcome === "B" ? `B_xsNet${H}` : `A_xs${H}`];
      const table = months.map((m) => {
        const m0 = monthStart(m);
        const train = rows.filter((r) => eligible(r) && L4.maturedBy(endOf(r), m0) && lab(r) != null);
        const ev = segRows.filter((r) => r.month === m);
        const evOk = ev.filter((r) => lab(r) != null);
        return { month: m, trainN: train.length, trainIssuers: new Set(train.map((r) => r.cik)).size, trainPersons: new Set(train.map((r) => r.person)).size,
          evalN: ev.length, evalWithOutcome: evOk.length, evalIssuers: new Set(evOk.map((r) => r.cik)).size, usable: train.length >= minTrain && evOk.length >= minEval };
      });
      perH[H] = { table, independentMonthlyEvaluations: table.filter((t) => t.usable).length, rule: `month usable if trainN >= ${minTrain} matured outcomes at the month start and >= ${minEval} rows decided in the month have an outcome inside the segment` };
    }
    out[seg] = { months, segmentEnd: segmentEndOf(seg), perHorizon: perH };
  }
  return out;
}
export { nextMonth, monthStart, spearman };
