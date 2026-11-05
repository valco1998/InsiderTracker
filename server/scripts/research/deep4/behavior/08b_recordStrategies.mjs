// deep4/behavior/08b_recordStrategies.mjs — record the DESIGN headline of each registered strategy rule once (from
// strategies-design.json written by 08_strategies.mjs). Idempotent: skips ids that already have a design result.
import fs from "node:fs";
import path from "node:path";
import { L4, AGENT, readJson, checkpoint } from "./common.mjs";
const S = readJson("strategies-design.json");
const resFile = path.join(L4.DEEP4, "registry-results.jsonl");
const have = fs.existsSync(resFile) ? fs.readFileSync(resFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).filter((r) => r.agent === AGENT && r.result?.segment === "design").map((r) => r.id) : [];
let n = 0;
for (const [id, r] of Object.entries(S.rules)) { if (have.includes(id)) continue; const h = r.headline; L4.recordResult(id, AGENT, { segment: "design", n: h.n, issuers: h.issuers, meanXsNet: h.meanXsNet, medianXsNet: h.medianXsNet, t: h.t, p: h.p, vsControls: h.vsControls, costs: h.costs, pfReturn: h.pfReturn, pfSpy: h.pfSpy, pfMaxDD: h.pfMaxDD, controlMeanXsNet: r.controlHeadline.meanXsNet }); n++; }
checkpoint("08b_recordStrategies", { recorded: n });
console.log(`recorded ${n} design strategy results`);
