// deep4/panel/freezeCode.mjs — LEAD ONLY. Freezes the panel code so that buildPanel.mjs may emit panel-confirm.json.
//   node scripts/research/deep4/panel/freezeCode.mjs --i-am-the-lead
// lib4.confirmUnlocked("panel") becomes true once .cache/research/deep4/panel/frozen.json exists. The panel agent never runs this
// script itself: whether and when the confirmation-period panel is built is the lead's decision (after the strategy agents
// have frozen their own rules). After freezing: re-run buildPanel.mjs (it then writes panel-confirm.json / controls-confirm.json
// with outcomes through 2026-11-03); consumers still need THEIR OWN frozen.json to read them through data.mjs.
// The manifest records sha256 of every panel script, so any later change to the panel code is detectable.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as L4 from "../lib4.mjs";

if (!process.argv.includes("--i-am-the-lead")) { console.error("refusing: this unlocks the confirmation segment for agent 'panel'; the lead runs it with --i-am-the-lead"); process.exit(2); }
const f = L4.agentFrozenFile("panel");
if (fs.existsSync(f)) { console.error(`refusing: ${f} already exists`); process.exit(3); }
const dir = path.dirname(fileURLToPath(import.meta.url));
const files = ["panelLib.mjs", "buildPanel.mjs", "data.mjs", "history.mjs", "strategyLib.mjs", "walkforward.mjs"];
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const manifest = { frozenAt: new Date().toISOString(), agent: "panel", rules: "panel construction exactly as in the hashed scripts (see buildPanel.mjs header); confirm outcomes may use bars through 2026-11-03",
  files: Object.fromEntries(files.map((n) => [n, sha(path.join(dir, n))])), deps: { "lib4.mjs": sha(path.join(dir, "..", "lib4.mjs")) } };
fs.mkdirSync(path.dirname(f), { recursive: true });
fs.writeFileSync(f, JSON.stringify(manifest, null, 1));
console.log(`wrote ${f}`);
