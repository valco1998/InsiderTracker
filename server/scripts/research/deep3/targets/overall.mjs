// deep3/targets/overall.mjs — overall touch / time-to-target / MAE / limit-fill / close-exit tables, DISCOVERY only.
//   node scripts/research/deep3/targets/overall.mjs
// Every test id was registered by register.mjs before this script existed.
import { rec, isRegistered, writeOut, checkpoint, TARGETS, HORIZONS, STOPS, TP_N, r4, toCsv } from "./common.mjs";
import { loadRows, testResult, tenQuestions, stability } from "./stats.mjs";

const rows = loadRows();
const D = rows.filter((r) => r.per === "discover");
const U = { om: D.filter((r) => r.cls === "om"), all: D };
const results = {};
const run = (id, rs, t, ctl = "cm") => { if (!isRegistered(id)) throw new Error(`not registered: ${id}`); const res = testResult(rs, t, ctl); rec(id, res); results[id] = res; return res; };

for (const X of TARGETS) for (const N of HORIZONS) run(`targets-OV-om-hit${X}_${N}`, U.om, { k: `hit${X}_${N}`, kind: "diff" });
for (const N of [5, 10]) run(`targets-OV-om-dd10_${N}`, U.om, { k: `dd10_${N}`, kind: "diff" });
for (const X of TARGETS) for (const S of STOPS) for (const N of TP_N) run(`targets-OV-om-tp${X}s${S}n${N}`, U.om, { k: `tp${X}s${S}n${N}`, kind: "abs" });
for (const N of HORIZONS) run(`targets-OV-om-x${N}`, U.om, { k: `x${N}`, kind: "abs" });
for (const X of TARGETS) for (const N of [5, 10]) run(`targets-OV-all-hit${X}_${N}`, U.all, { k: `hit${X}_${N}`, kind: "diff" });
for (const N of [5, 10]) run(`targets-OV-all-dd10_${N}`, U.all, { k: `dd10_${N}`, kind: "diff" });
for (const [v, ctl] of [["gap", "cg"], ["volRich", "cv"]]) for (const k of ["hit10_5", "hit10_10", "dd10_5"]) run(`targets-OVR-om-${v}-${k}`, U.om, { k, kind: "diff" }, ctl);

const tq = { om: tenQuestions(U.om), all: tenQuestions(U.all), byClass: {} };
for (const c of ["om", "entity", "offering", "unknown"]) tq.byClass[c] = tenQuestions(D.filter((r) => r.cls === c));
const stab = { om: stability(U.om), all: stability(U.all) };
writeOut("overall-discovery.json", { generatedAt: new Date().toISOString(), note: "DISCOVERY only. diff = event minus mean of 10 matched controls (primary unless noted). Touch = descriptive; limitFill = approximation; executable = close exits.", results, tenQuestions: tq, stability: stab });

// compact CSV of the grid
const grid = [];
for (const X of TARGETS) for (const N of HORIZONS) { const r = results[`targets-OV-om-hit${X}_${N}`]; grid.push({ universe: "om", target: X, sessions: N, event: r.eventMean, control: r.controlMean, diff: r.mean, t: r.t, p: r.p, n: r.n, issuers: r.issuers, ciLo: r.ci95?.[0], ciHi: r.ci95?.[1] }); }
writeOut("overall-touch-grid-discovery.csv", toCsv(grid, Object.keys(grid[0])));
checkpoint("overall discovery tables", { tests: Object.keys(results).length, file: "overall-discovery.json" });

// console summary
const P = (v) => (v == null ? "  —  " : `${(v * 100).toFixed(1)}%`);
console.log("TOUCH (om, discovery): event / control / diff (t)");
for (const X of TARGETS) console.log(`+${X}%: ` + HORIZONS.map((N) => { const r = results[`targets-OV-om-hit${X}_${N}`]; return `N${N} ${P(r.eventMean)}/${P(r.controlMean)}/${r.mean >= 0 ? "+" : ""}${(r.mean * 100).toFixed(1)} (t ${r.t})`; }).join(" | "));
for (const N of [5, 10]) { const r = results[`targets-OV-om-dd10_${N}`]; console.log(`MAE<=-10% N${N}: ${P(r.eventMean)} vs ${P(r.controlMean)} diff ${(r.mean * 100).toFixed(1)} t ${r.t}`); }
console.log("LIMIT-FILL approx (om): mean / median / t");
for (const X of TARGETS) console.log(`+${X}%: ` + STOPS.flatMap((S) => TP_N.map((N) => { const r = results[`targets-OV-om-tp${X}s${S}n${N}`]; return `s${S}n${N} ${P(r.mean)}/${P(r.median)}/t${r.t}`; })).join(" | "));
console.log("EXECUTABLE close exits (om): " + HORIZONS.map((N) => { const r = results[`targets-OV-om-x${N}`]; return `x${N} ${P(r.mean)} med ${P(r.median)} t ${r.t}`; }).join(" | "));
console.log("ALL classes: " + TARGETS.map((X) => [5, 10].map((N) => { const r = results[`targets-OV-all-hit${X}_${N}`]; return `+${X}%/N${N} ${P(r.eventMean)} vs ${P(r.controlMean)} t ${r.t}`; }).join(" ; ")).join(" | "));
for (const N of [5, 10]) { const r = results[`targets-OV-all-dd10_${N}`]; console.log(`ALL MAE<=-10% N${N}: ${P(r.eventMean)} vs ${P(r.controlMean)} t ${r.t}`); }
for (const v of ["gap", "volRich"]) console.log(`variant ${v}: ` + ["hit10_5", "hit10_10", "dd10_5"].map((k) => { const r = results[`targets-OVR-om-${v}-${k}`]; return `${k} ${P(r.eventMean)} vs ${P(r.controlMean)} diff ${(r.mean * 100).toFixed(1)} t ${r.t}`; }).join(" | "));
console.log("10Q om +10%:", JSON.stringify({ hit10: tq.om.touch[10].hit10, medianT: tq.om.touch[10].medianSessionsToTargetAmongHits, cum: tq.om.touch[10].cumulativeBySession, ctlCum: tq.om.touch[10].controlCumulativeBySession, ddBefore: tq.om.touch[10].drawdownBeforeTarget }));
console.log("by class hit10_5 (event/control):", JSON.stringify(Object.fromEntries(Object.entries(tq.byClass).map(([c, q]) => [c, [q.n, q.touch[10].hit[5], q.touch[10].control[5]]]))));
