// Deep study 4 — shared protocol layer (read-only, cache-only, no network).
// Re-exports the deep-2 statistics/bars helpers and adds the deep-4 period guard and registry.
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR } from "../lib.mjs";
export { loadBars, idxBefore, loadSecRows, companyStats, wmean, simulatePortfolio, sha256, mean, median, clusteredT, pValue, bhQ, r4, pct } from "../deep2/lib2.mjs";

export const DEEP4 = path.join(OUT_DIR, "deep4");
fs.mkdirSync(DEEP4, { recursive: true });

// ---- protocol (frozen 2026-11-04 by the lead, before any deep-4 result was computed) ----
// design:    published < DESIGN_END, and every outcome used for learning must end (last bar date) < DESIGN_END.
// confirm:   published in [DESIGN_END, EXPOSED_START). Outcomes may mature after EXPOSED_START (prices only).
//            Readable by an agent only after that agent has written its own frozen file (agentFrozenFile).
// exposed:   published >= EXPOSED_START. Previously exposed in deep 1-3 — NOT an independent holdout.
//            Readable only when DEEP4_EXPOSED=1 AND the lead's deep-4 frozen-rules.json exists (auditor, once).
export const DESIGN_END = "2026-06-15";
export const EXPOSED_START = "2026-09-01";
export const FROZEN4 = path.join(DEEP4, "frozen-rules.json");
export const EMBARGO_CAL_DAYS = 30;

const day = (iso) => String(iso).slice(0, 10);
export function segmentOf(publishedAt) {
  const d = day(publishedAt);
  return d < DESIGN_END ? "design" : d < EXPOSED_START ? "confirm" : "exposed";
}
export const agentFrozenFile = (agent) => path.join(DEEP4, agent, "frozen.json");
export const exposedUnlocked = () => process.env.DEEP4_EXPOSED === "1" && fs.existsSync(FROZEN4);
export const confirmUnlocked = (agent) => fs.existsSync(agentFrozenFile(agent)) || exposedUnlocked();

// Throws if a caller tries to read a segment it is not allowed to see.
export function assertVisible(publishedAt, agent) {
  const s = segmentOf(publishedAt);
  if (s === "exposed" && !exposedUnlocked()) throw new Error(`deep4 guard: exposed-period event (${day(publishedAt)}) is locked`);
  if (s === "confirm" && !confirmUnlocked(agent)) throw new Error(`deep4 guard: confirmation event (${day(publishedAt)}) needs ${agent}/frozen.json first`);
  return s;
}
// Filter helper: keeps only rows the agent may see now (no throw).
export function visible(rows, getPublished, agent) {
  return rows.filter((r) => {
    const s = segmentOf(getPublished(r));
    return s === "design" || (s === "confirm" && confirmUnlocked(agent)) || (s === "exposed" && exposedUnlocked());
  });
}
// An outcome may be used for LEARNING at decision date `asOf` only if its last bar date is < asOf
// (fully matured) — and, inside the design segment, also < DESIGN_END.
export const maturedBy = (outcomeEndDate, asOf) => !!outcomeEndDate && day(outcomeEndDate) < day(asOf);

// ---- registry (deep-4 files; register before computing) ----
const REG = path.join(DEEP4, "registry.jsonl");
const RES = path.join(DEEP4, "registry-results.jsonl");
export function registerHypothesis(h) {
  for (const k of ["agent", "id", "family", "familySize", "statement", "rationale"]) if (h[k] == null) throw new Error(`registerHypothesis: missing ${k}`);
  const reg = fs.existsSync(REG) ? fs.readFileSync(REG, "utf8") : "";
  if (reg.includes(`"id":${JSON.stringify(h.id)}`)) return false; // idempotent
  fs.appendFileSync(REG, JSON.stringify({ ...h, registeredAt: new Date().toISOString() }) + "\n");
  return true;
}
export function recordResult(id, agent, result) {
  const reg = fs.existsSync(REG) ? fs.readFileSync(REG, "utf8") : "";
  if (!reg.includes(`"id":${JSON.stringify(id)}`)) throw new Error(`recordResult: ${id} was not registered first`);
  fs.appendFileSync(RES, JSON.stringify({ id, agent, result, at: new Date().toISOString() }) + "\n");
}

export function writeJson(rel, data) { const f = path.join(DEEP4, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(data, null, 1)); return f; }
export function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(DEEP4, rel), "utf8")); }
