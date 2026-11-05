// deep4/audit/peekRegistry.mjs — inventory of result keys in the deep-4 registry (no outcome data read).
import { L4, readJsonl, countBy } from "./common.mjs";
import path from "node:path";
const res = readJsonl(path.join(L4.DEEP4, "registry-results.jsonl"));
const keys = {}; for (const r of res) for (const k of Object.keys(r.result || {})) keys[k] = (keys[k] || 0) + 1;
console.log("results", res.length, "unique ids", new Set(res.map((r) => r.id)).size, "byAgent", JSON.stringify(countBy(res, (r) => r.agent)));
console.log("segments", JSON.stringify(countBy(res, (r) => `${r.agent}|${r.result?.segment ?? "-"}`)));
console.log("keys", JSON.stringify(keys));
const ex = {}; for (const r of res) { const k = `${r.agent}|${Object.keys(r.result || {}).filter((x) => /^p/.test(x)).join("+")}`; if (!ex[k]) ex[k] = { id: r.id, p: Object.fromEntries(Object.entries(r.result).filter(([x]) => /^p|detail/.test(x)).map(([a, b]) => [a, typeof b === "object" ? Object.keys(b || {}).join(",") : b])) }; }
console.log(JSON.stringify(ex, null, 1));
