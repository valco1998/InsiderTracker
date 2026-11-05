// deep4/learn/confirm.mjs — ONE-SHOT confirmation run of the frozen procedure (agent learn). Verifies that every frozen script
// and spec.json still hash to the values in frozen.json, refuses to run twice, then runs in order:
//   wf.mjs --segment=confirm (monthly refits exactly as frozen) -> familyB.mjs --segment=confirm -> strategies.mjs --segment=confirm
//   -> interactions.mjs --segment=confirm -> confirmTests.mjs -> report.mjs --segment=confirm
//   node --max-old-space-size=8192 scripts/research/deep4/learn/confirm.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readOut, outPath, existsOut, sha256File, SCRIPTS, writeOut, L4 } from "./common.mjs";

if (!fs.existsSync(L4.agentFrozenFile("learn"))) throw new Error("frozen.json missing: freeze first");
if (existsOut("confirm-done.json")) throw new Error("confirmation already run once (confirm-done.json exists) — refusing to run again");
const frozen = readOut("frozen.json");
const bad = [];
for (const [f, h] of Object.entries(frozen.scripts)) { const now = sha256File(path.join(SCRIPTS, f)); if (now !== h) bad.push(f); }
if (sha256File(outPath("spec.json")) !== frozen.specSha256) bad.push("spec.json");
if (bad.length) throw new Error(`frozen files changed since the freeze: ${bad.join(", ")}`);
writeOut("confirm-started.json", { at: new Date().toISOString(), frozenSha256: sha256File(outPath("frozen.json")) });
const run = (script, args = []) => { console.log(`\n>>> ${script} ${args.join(" ")}`); execFileSync(process.execPath, ["--max-old-space-size=8192", path.join(SCRIPTS, script), ...args], { stdio: "inherit" }); };
run("wf.mjs", ["--segment=confirm"]);
run("familyB.mjs", ["--segment=confirm"]);
run("strategies.mjs", ["--segment=confirm"]);
run("interactions.mjs", ["--segment=confirm"]);
run("confirmTests.mjs");
run("report.mjs", ["--segment=confirm"]);
writeOut("confirm-done.json", { at: new Date().toISOString(), frozenSha256: sha256File(outPath("frozen.json")) });
console.log("\nconfirmation run complete (once).");
