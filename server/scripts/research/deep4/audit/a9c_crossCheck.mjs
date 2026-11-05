// deep4/audit/a9c_crossCheck.mjs — compares b2_evaluate's confirm dry run with behavior's original confirm-results.json.
import fs from "node:fs";
import path from "node:path";
import { L4, readOut, writeOut, existsOut } from "./common.mjs";
const B = JSON.parse(fs.readFileSync(path.join(L4.DEEP4, "behavior", "confirm-results.json"), "utf8"));
const D = readOut("confirm-dryrun.json");
const mine = new Map(D.table.map((s) => [s.id, s]));
const rows = [];
for (const [id, s] of Object.entries(B.strategies)) { const m = mine.get(id); rows.push({ id, what: "strategy (independent trades)", orig: [s.headline.n, s.headline.meanXsNet, s.headline.p, s.headline.vsControls?.diff], audit: [m.n, m.mean, m.p, m.vsCtl] }); }
for (const a of B.familyA) { const m = mine.get(a.id); rows.push({ id: a.id, what: "family A event-level", orig: [a.n30, a.mean, a.t], audit: [m.eventLevel.n, m.eventLevel.mean, m.eventLevel.t] }); }
const wf = B.familyC.walkForward30.selected, c10 = mine.get("behavior.C10");
rows.push({ id: "behavior.C10", what: "family C walk-forward selected event-level", orig: [wf.n, wf.mean, wf.t], audit: [c10.eventLevel.n, c10.eventLevel.mean, c10.eventLevel.t] });
for (const c of B.familyC.results.filter((x) => x.kind === "select")) { const m = mine.get(c.id); rows.push({ id: c.id, what: "family C select event-level", orig: [c.n, c.mean, c.t], audit: [m.eventLevel.n, m.eventLevel.mean, m.eventLevel.t] }); }
const same = (a, b) => a.every((x, i) => x == null && b[i] == null || (typeof x === "number" && typeof b[i] === "number" && Math.abs(x - b[i]) < 1e-3));
for (const r of rows) r.match = same(r.orig, r.audit);
const prev = existsOut("repro.json") ? readOut("repro.json") : {};
writeOut("repro.json", { ...prev, behaviorConfirmCrossCheck: { rows, allMatch: rows.every((r) => r.match) } });
for (const r of rows) console.log(r.match ? "OK  " : "DIFF", r.id.padEnd(28), r.what.padEnd(42), JSON.stringify(r.orig), JSON.stringify(r.audit));
