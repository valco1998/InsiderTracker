// deep2/audit/holdoutContext.mjs — auditor, AFTER the single holdout run: what had deep 1 already computed for the same
// rules on the same holdout (test split), before frozen-rules.json was written? Reads deep-1 stageG.json (H22 == T3 on the
// test split) and afterHours.json (S1 == T3 after close, test split), and compares them with holdout.json. Writes
// holdout-context.json. Refuses to run before holdout.json exists.
//   node scripts/research/deep2/audit/holdoutContext.mjs
import fs from "node:fs";
import path from "node:path";
import { DEEP1 } from "../lib2.mjs";
import { OUT, readOut, writeOut, r4 } from "./auditLib.mjs";

if (!fs.existsSync(path.join(OUT, "holdout.json"))) throw new Error("run holdout.mjs first");
const H = readOut("holdout.json");
const G = JSON.parse(fs.readFileSync(path.join(DEEP1, "stageG.json"), "utf8"));
const h22 = (G.hypothesesAllSplits || []).find((h) => h.name.startsWith("H22"));
const pick = (s) => (s ? { n: s.n, issuers: s.issuers, meanExcessNet: s.meanExcess, medianExcessNet: s.medianExcess, t: s.t, p: s.p } : null);
const ah = JSON.parse(fs.readFileSync(path.join(DEEP1, "afterHours.json"), "utf8")).result;
const s1 = Object.entries(ah.strata).find(([k]) => /CEO\/CFO/.test(k))?.[1];
const stamp = (f) => fs.statSync(path.join(DEEP1, f)).mtime.toISOString();
const out = {
  generatedAt: new Date().toISOString(),
  deep1Files: { "stageG.json": stamp("stageG.json"), "afterHours.json": stamp("afterHours.json"), "report.html": fs.existsSync(path.join(DEEP1, "report.html")) ? stamp("report.html") : null },
  frozenAt: H.frozenAt,
  deep1_H22_eqT3_testSplit: h22 ? Object.fromEntries(Object.entries(h22.byH).map(([N, sp]) => [N, { train: pick(sp.train), validation: pick(sp.validation), test: pick(sp.test) }])) : "not found",
  deep1_afterHours_S1_eqT3AfterClose_bySplit: s1?.bySplit ?? "not found",
  auditorHoldout: { F1: H.rules.F1.tier1, F2: H.rules.F2.tier1, F3: H.rules.F3.bps25, untrappedH3: H.diagnostics.stageC_untrapped_h3, untrappedH5: H.diagnostics.stageC_untrapped_h5 },
  reading: "If deep 1's test-split numbers for H22 at 5 sessions (and the after-hours S1 test split) match the auditor's holdout values, the holdout performance of F2/F3 was already computed and saved before the rules were frozen.",
};
writeOut("holdout-context.json", out);
console.log(JSON.stringify(out, null, 1));
