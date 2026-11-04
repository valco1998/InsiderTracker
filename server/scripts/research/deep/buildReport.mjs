// Builds the deep-study report page from saved stage outputs (no recomputation, no typed numbers):
//   node scripts/research/deep/buildReport.mjs  →  server/.cache/research/deep/report.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OUT_DIR } from "../lib.mjs";

const DIR = path.join(OUT_DIR, "deep");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const G = rd("stageG.json"), F = rd("followups.json"), AH = rd("afterHours.json");
const results = fs.readFileSync(path.join(DIR, "registry-results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const famCounts = {}, famPass = {};
for (const r of results) { famCounts[r.family] = (famCounts[r.family] || 0) + 1; if (r.passTrain) famPass[r.family] = (famPass[r.family] || 0) + 1; }
const late = G.promoted.find((r) => r.name === "filingDelayDays Q5");
const dedupeEx = (xs) => { const seen = new Set(); return (xs || []).filter((x) => { const k = `${x.ticker}|${x.publishedAt.slice(0, 10)}`; if (seen.has(k)) return false; seen.add(k); return true; }); };
const ahRows = AH.rows.filter((r) => r.status === "ok");
const ahCeo = ahRows.filter((r) => r.stratum.startsWith("CEO/CFO")).sort((a, b) => b.ex1 - a.ex1);
const data = {
  generatedAt: new Date().toISOString(),
  audit: G.audit, companies: G.companies, events: G.events, splitCounts: G.splitCounts, coverage: G.coverage, baseline: G.baseline, protocol: G.protocol,
  funnel: { tests: G.counts.tests, passTrain: G.counts.passTrain, passValidation: G.counts.passValidation, supported: G.counts.supported, famCounts, famPass },
  hypotheses: G.hypotheses.filter((h) => h.horizon === 20).map((h) => ({ name: h.name, train: h.train, passTrain: h.passTrain })),
  hypothesesAllSplits: G.hypothesesAllSplits.map((h) => ({ name: h.name, h20: h.byH[20] })),
  decay: G.decay.map((r) => ({ family: r.family, name: r.name, horizon: r.horizon, train: r.train, validation: r.validation || r.decay?.validation || null, test: r.test || r.decay?.test || null })),
  promoted: G.promoted.map((r) => ({ family: r.family, name: r.name, horizon: r.horizon, train: r.train, validation: r.validation, test: r.test, supported: r.supported })),
  late: late ? { horizons: late.robustness.horizons, costs: late.robustness.costs, liquidity: late.robustness.liquidity, role: late.robustness.role, ownership: late.robustness.ownership, onePerIssuer30d: late.robustness.onePerIssuer30d, bootstrapCI: late.robustness.bootstrapCI, examples: dedupeEx(late.robustness.examples) } : null,
  eventStudy: G.eventStudy, drift: G.drift, gapFollowups: F.groups, afterHours: AH.result,
  ahExamples: { best: ahCeo.slice(0, 5), worst: ahCeo.slice(-5).reverse() },
  ridgeWeights: G.ridgeWeights.slice(0, 12), rapp: G.rapp, rappLike: G.rappLike,
};
const here = path.dirname(fileURLToPath(import.meta.url));
const tpl = fs.readFileSync(path.join(here, "reportTemplate.html"), "utf8");
const out = path.join(DIR, "report.html");
fs.writeFileSync(out, tpl.replace("/*__DATA__*/null", JSON.stringify(data)));
console.log(`report → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
