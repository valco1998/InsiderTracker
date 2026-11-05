// deep4/behavior/peekControls.mjs — plumbing check (no outcome statistics printed): control-row fields and counts.
import { loadDesign } from "./common.mjs";
const { rows, C } = loadDesign({ controls: true });
const k = rows.find((r) => r.primary === 1 && r.isPrimary === 1 && C.of(r.key).length).key;
const c = C.of(k)[0];
console.log("control fields:", Object.keys(c).filter((f) => !f.startsWith("B_") || ["B_status", "B_entryDate", "B_costBps"].includes(f)).join(","));
console.log("controls per event (first event):", C.of(k).length, "total control rows:", C.rows.size, "segments:", [...new Set([...C.rows.values()].map((x) => x.segment))]);
console.log("tier values:", [...new Set(rows.map((r) => r.tier))], "costBps:", [...new Set(rows.map((r) => r.costBps))]);
