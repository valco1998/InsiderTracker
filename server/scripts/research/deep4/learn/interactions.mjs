// deep4/learn/interactions.mjs — pre-declared interaction pairs (spec.interactions; family learn.int) on the matched-control-
// adjusted 30-day outcomes of design universe events. Tercile cells from design feature quantiles (declared in spec.json).
//   node --max-old-space-size=8192 scripts/research/deep4/learn/interactions.mjs [--record]
import fs from "node:fs";
import { loadEvents, loadCtl, inUniverse, readOut, writeOut, outPath, record, recordedIds, checkpoint, toCsv, mean } from "./common.mjs";
import { FEATURE_NAMES, trackRecords, eventFeatures } from "./features.mjs";
import * as E from "./evalLib.mjs";
import * as L4 from "../lib4.mjs";

const DO_RECORD = process.argv.includes("--record");
const SEGMENT = (process.argv.find((x) => x.startsWith("--segment=")) || "--segment=design").split("=")[1];
if (SEGMENT === "confirm" && !fs.existsSync(L4.agentFrozenFile("learn"))) throw new Error("confirm needs learn/frozen.json first");
const SUF = SEGMENT === "design" ? "" : `-${SEGMENT}`;
const spec = readOut("spec.json");
const segs = SEGMENT === "design" ? ["design"] : ["design", "confirm"];
const P = loadEvents({ segments: segs }), C = loadCtl({ segments: segs });
const U = P.rows.filter((r) => inUniverse(r) && r.segment === SEGMENT);
const TR = trackRecords(U, P.rows);
const OUTC = { xs30: "B_xsNet30", hit30: "B_hit10_30" };
const cuts = spec.interactions.tercileCuts;
const terc = (name, v) => (v == null || !Number.isFinite(v) ? null : v <= cuts[name][0] ? 1 : v <= cuts[name][1] ? 2 : 3);

// event-level rows: features, outcome, matched-control mean, difference
const ev = [];
for (const r of U) {
  const f = eventFeatures(r, TR.get(r.key));
  const cs = C.of(r.key);
  const o = { key: r.key, issuer: r.cik, sym: r.sym, month: r.month, ...f };
  for (const [k, fld] of Object.entries(OUTC)) {
    const y = r[fld], cv = cs.map((c) => c[fld]).filter((v) => v != null && Number.isFinite(v));
    o[`${k}_ev`] = y ?? null; o[`${k}_ctl`] = cv.length ? mean(cv) : null; o[`${k}_d`] = y != null && cv.length ? y - mean(cv) : null; o[`${k}_nctl`] = cv.length;
  }
  ev.push(o);
}
const cellKey = (p, o) => {
  const zt = terc(p.z, o[p.z]); if (zt == null) return null;
  if (p.kind === "insider") return `z${zt}`;
  const xt = p.x === "ceoCfo" ? (o.ceoCfo ? 3 : 1) : terc(p.x, o[p.x]); if (xt == null) return null;
  return `x${xt}z${zt}`;
};
function stat(p, items) { // items: [{ cell, d }]
  const m = new Map(); for (const it of items) { const a = m.get(it.cell) || m.set(it.cell, [0, 0]).get(it.cell); a[0] += it.d; a[1]++; }
  const c = (k) => { const a = m.get(k); return a && a[1] ? a[0] / a[1] : null; };
  let v;
  switch (p.id) {
    case "I1": case "I2": v = [c("x3z1"), c("x1z1"), c("x3z3"), c("x1z3")]; return v.some((x) => x == null) ? null : (v[0] - v[1]) - (v[2] - v[3]);
    case "I3": v = [c("x3z3"), c("x1z3"), c("x3z1"), c("x1z1")]; return v.some((x) => x == null) ? null : (v[0] - v[1]) - (v[2] - v[3]);
    case "I4": case "I8": return c("z3") == null || c("z1") == null ? null : c("z3") - c("z1");
    case "I5": case "I6": case "I7": return c("z1") == null || c("z3") == null ? null : c("z1") - c("z3");
    default: throw new Error(p.id);
  }
}
const results = [], cellsOut = [];
const already = recordedIds();
for (const p of spec.interactions.pairs) {
  for (const k of Object.keys(OUTC)) {
    const id = `learn.int.${p.id}.${k}`;
    const items = ev.filter((o) => o[`${k}_d`] != null).map((o) => ({ issuer: o.issuer, cell: cellKey(p, o), d: o[`${k}_d`], ev: o[`${k}_ev`], ctl: o[`${k}_ctl`] })).filter((it) => it.cell != null);
    const est = stat(p, items);
    // issuer-block bootstrap, B = 2000
    const G = new Map(); for (const it of items) (G.get(it.issuer) || G.set(it.issuer, []).get(it.issuer)).push(it);
    const blocks = [...G.values()], rnd = E.rng(7), draws = [];
    for (let b = 0; b < 2000; b++) { const rep = []; for (let j = 0; j < blocks.length; j++) for (const it of blocks[(rnd() * blocks.length) | 0]) rep.push(it); const v = stat(p, rep); if (v != null) draws.push(v); }
    draws.sort((a, b) => a - b);
    const sd = Math.sqrt(draws.reduce((a, x) => a + (x - mean(draws)) ** 2, 0) / (draws.length - 1)), z = sd > 0 ? est / sd : null;
    const cells = [...new Set(items.map((i) => i.cell))].sort().map((cell) => { const xs = items.filter((i) => i.cell === cell); const cs = L4.companyStats(xs.map((i) => ({ issuer: i.issuer, x: i.d }))); return { pair: p.id, outcome: k, cell, n: xs.length, issuers: new Set(xs.map((i) => i.issuer)).size, eventMean: mean(xs.map((i) => i.ev)), controlMean: mean(xs.map((i) => i.ctl)), dMean: mean(xs.map((i) => i.d)), dMedian: cs.median, dT: cs.t, dP: cs.p }; });
    cellsOut.push(...cells);
    const res = { id, pair: p.id, kind: p.kind, x: p.x ?? "insider", z: p.z, outcome: k, statDef: p.stat, estimate: est, se: sd, z, p: E.normP(z), ci95: [draws[Math.floor(0.025 * draws.length)], draws[Math.floor(0.975 * draws.length)]], n: items.length, issuers: G.size, cells };
    results.push(res);
    if (DO_RECORD && SEGMENT === "design" && !already.has(id)) record(id, { segment: "design", estimate: est, se: sd, z, p: res.p, n: items.length, detail: { ...res, cells: undefined } });
  }
}
// overall insider-minus-control (descriptive, not a registered test): all events with controls
const overall = Object.fromEntries(Object.keys(OUTC).map((k) => { const xs = ev.filter((o) => o[`${k}_d`] != null); return [k, { n: xs.length, eventMean: mean(xs.map((o) => o[`${k}_ev`])), controlMean: mean(xs.map((o) => o[`${k}_ctl`])), diff: L4.companyStats(xs.map((o) => ({ issuer: o.issuer, x: o[`${k}_d`] }))) }]; }));
writeOut(`interactions${SUF}.json`, { segment: SEGMENT, overall, results });
fs.writeFileSync(outPath(`interactions${SUF}-cells.csv`), toCsv(cellsOut, Object.keys(cellsOut[0])));
fs.writeFileSync(outPath(`interactions${SUF}-events.csv`), toCsv(ev, ["key", "issuer", "sym", "month", ...FEATURE_NAMES, "xs30_ev", "xs30_ctl", "xs30_d", "xs30_nctl", "hit30_ev", "hit30_ctl", "hit30_d"]));
checkpoint(`interactions${SUF}`, { tests: results.length, recorded: DO_RECORD });
console.log("overall", JSON.stringify(overall, null, 1));
for (const r of results) {
  console.log(`${r.id.padEnd(22)} est ${r.estimate?.toFixed(4)} se ${r.se?.toFixed(4)} z ${r.z?.toFixed(2)} p ${r.p?.toFixed(4)} n ${r.n} | ${r.statDef}`);
  console.log("    " + r.cells.map((c) => `${c.cell}: n${c.n} ev ${(c.eventMean * 100).toFixed(2)} ctl ${(c.controlMean * 100).toFixed(2)} d ${(c.dMean * 100).toFixed(2)}`).join(" | "));
}
