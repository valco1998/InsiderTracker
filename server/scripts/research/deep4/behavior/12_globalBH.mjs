// deep4/behavior/12_globalBH.mjs — SNAPSHOT of a global Benjamini–Hochberg over every design-segment p-value currently in the
// deep-4 registry (all agents; other agents may still be adding tests: the lead's final global BH supersedes this).
//   node scripts/research/deep4/behavior/12_globalBH.mjs
import fs from "node:fs";
import path from "node:path";
import { L4, AGENT, writeJson, r4, bh } from "./common.mjs";
const lines = fs.readFileSync(path.join(L4.DEEP4, "registry-results.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const pOf = (r) => { const x = r.result || {}; for (const k of ["p", "pPerm", "pValue", "pT"]) if (typeof x[k] === "number" && Number.isFinite(x[k])) return x[k]; return null; };
const seen = new Set(), tests = [];
for (const r of lines) { const seg = r.result?.segment; if (seg === "confirm" || seg === "exposed") continue; const p = pOf(r); if (p == null) continue; const k = `${r.id}`; if (seen.has(k)) continue; seen.add(k); tests.push({ id: r.id, agent: r.agent, p }); }
const q = bh(tests.map((t) => t.p)); tests.forEach((t, i) => { t.q = r4(q[i]); });
const mine = tests.filter((t) => t.agent === AGENT);
const out = { at: new Date().toISOString(), note: "snapshot; first design result per id; other agents may still be running", total: tests.length, byAgent: tests.reduce((m, t) => { m[t.agent] = (m[t.agent] || 0) + 1; return m; }, {}),
  behaviorQ10: mine.filter((t) => t.q < 0.1).map((t) => ({ id: t.id, p: t.p, qGlobal: t.q })), behaviorQ05: mine.filter((t) => t.q < 0.05).length };
writeJson("global-bh-snapshot.json", out);
console.log(JSON.stringify(out, null, 1));
