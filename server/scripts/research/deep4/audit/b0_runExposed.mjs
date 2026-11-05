// deep4/audit/b0_runExposed.mjs — THE single exposed-period run (Phase B). The parent process never sets DEEP4_EXPOSED; only the
// child processes listed as "exposed" receive DEEP4_EXPOSED=1. Stops at the first failure. Refuses to run twice.
//   node scripts/research/deep4/audit/b0_runExposed.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { phaseA, L4, SCRIPTS, OUT, outPath, writeOut, readJsonl, checkpoint } from "./common.mjs";

phaseA(); // the parent itself must be locked
if (!fs.existsSync(outPath("exposed-criteria.json"))) throw new Error("exposed-criteria.json missing");
if (fs.existsSync(outPath("exposed-run-started.json"))) throw new Error("the exposed run was already started once — refusing");
const reg = readJsonl(path.join(L4.DEEP4, "registry.jsonl")).filter((r) => String(r.id).startsWith("audit4.exp."));
if (reg.length < 50) throw new Error(`register audit4.exp.* first (found ${reg.length})`);
const base = { ...process.env }; delete base.DEEP4_EXPOSED; delete base.DEEP2_HOLDOUT; delete base.DEEP3_HOLDOUT;
const logF = outPath("exposed-run.log");
const lines = [];
const step = (name, script, args = [], { exposed = false, env = {} } = {}) => {
  const t = Date.now(); const e = { ...base, ...env, ...(exposed ? { DEEP4_EXPOSED: "1" } : {}) };
  lines.push(`[${new Date().toISOString()}] START ${name} (DEEP4_EXPOSED=${exposed ? 1 : 0})`); fs.writeFileSync(logF, lines.join("\n") + "\n");
  const outp = execFileSync(process.execPath, ["--max-old-space-size=12288", path.join(SCRIPTS, script), ...args], { env: e, cwd: process.cwd(), encoding: "utf8", maxBuffer: 1 << 28 });
  fs.writeFileSync(outPath(`exposed-step-${name}.log`), outp);
  lines.push(`[${new Date().toISOString()}] DONE  ${name} in ${((Date.now() - t) / 1000).toFixed(1)}s`); fs.writeFileSync(logF, lines.join("\n") + "\n");
};
writeOut("exposed-run-started.json", { at: new Date().toISOString(), criteriaFile: "exposed-criteria.json", registeredExpTests: reg.length });
step("hash-before", "verifyHashes.mjs", ["--label=beforeExposed"]);
step("buildPanel", "exposed/panel/buildPanel.mjs", [], { exposed: true });
step("compareRebuild", "b3_compareRebuild.mjs");
step("describe", "exposed/panel/describe.mjs", [], { exposed: true, env: { AUDIT_DESCRIBE_SEGMENT: "exposed", AUDIT_PANEL_OUT: path.join(OUT, "exposed", "panel-describe-exposed") } });
step("behavior", "exposed/behavior/10_confirm.mjs", ["--exposed"], { exposed: true });
step("learn-wf", "exposed/learn/wf.mjs", ["--segment=exposed"], { exposed: true });
step("learn-familyB", "exposed/learn/familyB.mjs", ["--segment=exposed"], { exposed: true });
step("learn-strategies", "exposed/learn/strategies.mjs", ["--segment=exposed"], { exposed: true });
step("evaluate", "b2_evaluate.mjs", ["--segment=exposed"], { exposed: true });
step("hash-after", "verifyHashes.mjs", ["--label=afterExposed"]);
writeOut("exposed-run-done.json", { at: new Date().toISOString() });
checkpoint("b0_runExposed", { done: true });
console.log(lines.join("\n"));
