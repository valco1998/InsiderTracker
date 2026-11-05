// deep4/audit/verifyHashes.mjs — verifies frozen-rules.json (sha256) and every hash it lists, plus every script / dependency /
// output hash listed in panel/, behavior/ and learn/ frozen.json. Read-only. Writes audit/hash-check-<label>.json.
//   node scripts/research/deep4/audit/verifyHashes.mjs --label=before
import fs from "node:fs";
import path from "node:path";
import { L4, SCRIPTS, writeOut, sha256File } from "./common.mjs";

const label = (process.argv.find((a) => a.startsWith("--label=")) || "--label=check").split("=")[1];
const D4 = L4.DEEP4, S4 = path.join(SCRIPTS, "..");
const checks = [];
const chk = (what, file, expected) => { const ok = fs.existsSync(file); const got = ok ? sha256File(file) : null; checks.push({ what, file: path.relative(process.cwd(), file), expected, got, ok: got === expected }); };
chk("frozen-rules.json", path.join(D4, "frozen-rules.json"), "5da97a99d5909ec3edc3a4d3e7d871c562bb5cb64725a49982136e6ec803e4b7");
const FR = JSON.parse(fs.readFileSync(path.join(D4, "frozen-rules.json"), "utf8"));
for (const [rel, h] of Object.entries(FR.hashes)) chk(`frozen-rules.hashes ${rel}`, path.join(D4, rel), h);
// panel files listed in panel-files.sha256
for (const line of fs.readFileSync(path.join(D4, "panel", "panel-files.sha256"), "utf8").split("\n").filter(Boolean)) { const [h, f] = line.trim().split(/\s+\*?/); chk(`panel-files.sha256 ${f}`, path.resolve(process.cwd(), f.replace(/^\*/, "")), h); }
// agents' frozen.json script / dependency / output hashes
const P = JSON.parse(fs.readFileSync(path.join(D4, "panel", "frozen.json"), "utf8"));
for (const [f, h] of Object.entries(P.files)) chk(`panel script ${f}`, path.join(S4, "panel", f), h);
for (const [f, h] of Object.entries(P.deps)) chk(`panel dep ${f}`, path.join(S4, f), h);
const B = JSON.parse(fs.readFileSync(path.join(D4, "behavior", "frozen.json"), "utf8"));
for (const [f, h] of Object.entries(B.files)) chk(`behavior script ${f}`, path.join(S4, "behavior", f), h);
for (const [f, h] of Object.entries(B.deps)) chk(`behavior dep ${f}`, path.join(S4, f), h);
for (const [f, h] of Object.entries(B.outputs)) chk(`behavior output ${f}`, path.join(D4, "behavior", f), h);
const Lf = JSON.parse(fs.readFileSync(path.join(D4, "learn", "frozen.json"), "utf8"));
for (const [f, h] of Object.entries(Lf.scripts)) chk(`learn script ${f}`, path.join(S4, "learn", f), h);
for (const [f, h] of Object.entries(Lf.deps)) chk(`learn dep ${f}`, path.join(S4, f), h);
chk("learn spec.json (frozen specSha256)", path.join(D4, "learn", "spec.json"), Lf.specSha256);
const bad = checks.filter((c) => !c.ok);
writeOut(`hash-check-${label}.json`, { at: new Date().toISOString(), label, checked: checks.length, failed: bad.length, failures: bad, checks });
console.log(`hash check [${label}]: ${checks.length} checked, ${bad.length} failed`);
for (const c of bad) console.log("FAIL", c.what, c.file, c.expected, c.got);
