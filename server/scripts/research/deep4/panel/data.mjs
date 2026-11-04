// deep4/panel/data.mjs — guarded loaders for the deep-4 panel (use these instead of reading the JSON files directly).
//   import { loadPanel, loadControls } from "../panel/data.mjs";
//   const P = loadPanel({ agent: "behavior" });               // design rows (+ confirm / exposed only if lib4 guards allow)
//   const C = loadControls({ agent: "behavior" });            // { meta, byEvent, rows: Map(ctlKey → row), of(eventKey) → [row…] }
// Guards: confirm-segment rows are returned only when lib4.confirmUnlocked(agent) (the CALLER's frozen.json exists) AND the
// panel agent produced panel-confirm.json; exposed rows only when lib4.exposedUnlocked(). Every returned row passes
// lib4.assertVisible(publishedAt, agent). Reading the design files never needs a guard.
import fs from "node:fs";
import path from "node:path";
import * as L4 from "../lib4.mjs";

export const PANEL_DIR = path.join(L4.DEEP4, "panel");
const FILES = { design: ["panel.json", "controls.json"], confirm: ["panel-confirm.json", "controls-confirm.json"], exposed: ["panel-exposed.json", "controls-exposed.json"] };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(PANEL_DIR, f), "utf8"));
function segmentsFor(agent, segments) {
  const want = segments || ["design", "confirm", "exposed"];
  return want.filter((s) => s === "design" || (s === "confirm" && L4.confirmUnlocked(agent)) || (s === "exposed" && L4.exposedUnlocked()))
    .filter((s) => fs.existsSync(path.join(PANEL_DIR, FILES[s][0])));
}
// → { meta: { [segment]: meta }, rows: [...] } (rows of all visible segments, sorted by publishedAt then acc)
export function loadPanel({ agent, segments = null } = {}) {
  if (!agent) throw new Error("loadPanel: pass { agent } (used by the lib4 guard)");
  const meta = {}, rows = [];
  for (const s of segmentsFor(agent, segments)) {
    const P = readJson(FILES[s][0]);
    meta[s] = P.meta;
    for (const r of P.rows) { L4.assertVisible(r.publishedAt, agent); rows.push(r); }
  }
  rows.sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : a.acc < b.acc ? -1 : 1));
  return { meta, rows };
}
// → { meta, byEvent: { eventKey: [[ctlKey, dist], …] }, rows: Map(ctlKey → row), of(eventKey) → [{ ...row, dist }] }
export function loadControls({ agent, segments = null } = {}) {
  if (!agent) throw new Error("loadControls: pass { agent } (used by the lib4 guard)");
  const meta = {}, byEvent = {}, rows = new Map();
  for (const s of segmentsFor(agent, segments)) {
    const f = FILES[s][1]; if (!fs.existsSync(path.join(PANEL_DIR, f))) continue;
    const C = readJson(f);
    meta[s] = C.meta;
    Object.assign(byEvent, C.byEvent);
    for (const arr of C.rows) { const o = {}; C.fields.forEach((k, i) => { o[k] = arr[i]; }); rows.set(o.ctlKey, o); }
  }
  const of = (key) => (byEvent[key] || []).map(([k, dist]) => ({ ...rows.get(k), dist }));
  return { meta, byEvent, rows, of };
}
// Field groups of the design panel (feature / outcome lists) without loading the rows.
export function panelSchema() { const P = readJson(FILES.design[0]); return P.meta; }
