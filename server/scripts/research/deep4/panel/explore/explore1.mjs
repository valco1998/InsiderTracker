// Exploration (design segment only): field distributions of p-filings.json and sec-rows.json.
import fs from "node:fs";
import path from "node:path";
import { visible, segmentOf, DESIGN_END } from "../../lib4.mjs";
import { OUT_DIR } from "../../../lib.mjs";

const pf = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep3", "dataquality", "p-filings.json"), "utf8"));
const rows = visible(pf.rows, (r) => r.publishedAt, "panel");
const cnt = (arr, f) => arr.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log("p-filings total", pf.rows.length, "visible", rows.length, "segments", JSON.stringify(cnt(rows, (r) => segmentOf(r.publishedAt))));
console.log("keys", Object.keys(rows[0]).join(","));
for (const k of ["form", "window", "period", "own", "dedupe", "amend", "venue", "cls", "inStageC", "excludedReason"]) console.log(k, JSON.stringify(cnt(rows, (r) => r[k])));
console.log("stageC", JSON.stringify(cnt(rows, (r) => (r.stageC ? r.stageC.priceStatus : "none"))));
console.log("person null", rows.filter((r) => !r.person).length, "ticker null", rows.filter((r) => !r.ticker).length);
console.log("persons", new Set(rows.map((r) => r.person)).size, "issuers", new Set(rows.map((r) => r.cik)).size);
console.log("month", JSON.stringify(cnt(rows, (r) => r.publishedAt.slice(0, 7))));
console.log("sample with stageC", JSON.stringify(rows.find((r) => r.stageC)));
console.log("sample amends", JSON.stringify(rows.find((r) => /amends/.test(r.amend))));
console.log("sample superseded", JSON.stringify(rows.find((r) => /superseded/.test(r.amend))));
// sec rows (only rows accepted before DESIGN_END are inspected)
const sec = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep2", "sec-rows.json"), "utf8"));
const sr = sec.rows.filter((r) => String(r.acceptedAt) < DESIGN_END);
console.log("sec rows total", sec.rows.length, "accepted < DESIGN_END", sr.length, "keys", Object.keys(sr[0]).join(","));
console.log("codes", JSON.stringify(cnt(sr, (r) => r.code)));
console.log("amend", JSON.stringify(cnt(sr, (r) => r.amend)), "dedupe", JSON.stringify(cnt(sr, (r) => r.dedupe)), "priceCheck", JSON.stringify(cnt(sr, (r) => r.priceCheck)));
console.log("own", JSON.stringify(cnt(sr, (r) => r.own)), "plan", JSON.stringify(cnt(sr, (r) => r.plan)));
console.log("sample P", JSON.stringify(sr.find((r) => r.code === "P")));
console.log("sample S", JSON.stringify(sr.find((r) => r.code === "S")));
console.log("acceptedAt min/max", sr.reduce((m, r) => (r.acceptedAt < m ? r.acceptedAt : m), "9999"), sr.reduce((m, r) => (r.acceptedAt > m ? r.acceptedAt : m), ""));
const pAcc = new Set(sr.filter((r) => r.code === "P").map((r) => r.acc));
const pfAcc = new Set(rows.map((r) => r.acc));
console.log("P accessions in sec-rows (design)", pAcc.size, "in p-filings design", pfAcc.size, "pf not in sec", [...pfAcc].filter((a) => !pAcc.has(a)).length, "sec not in pf", [...pAcc].filter((a) => !pfAcc.has(a)).length);
// persons with multiple filings at the same acceptance second
const g = new Map(); for (const r of rows) { const k = `${r.person}|${r.publishedAt}`; g.set(k, (g.get(k) || 0) + 1); }
console.log("person-second groups >1", [...g.values()].filter((v) => v > 1).length);
const g2 = new Map(); for (const r of rows) { const k = `${r.person}|${r.cik}|${r.publishedAt.slice(0, 10)}`; g2.set(k, (g2.get(k) || 0) + 1); }
console.log("person-issuer-day groups >1", [...g2.values()].filter((v) => v > 1).length, "max", Math.max(...g2.values()));
