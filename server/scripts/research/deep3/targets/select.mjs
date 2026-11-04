// deep3/targets/select.mjs — final BH over ALL discovery tests of this agent, then the frozen "promising" rule
// (protocol.json) applied mechanically. Writes bh-discovery.json and promising.json.
//   node scripts/research/deep3/targets/select.mjs
import { myResults, myRegistry, bhQ, r4, writeOut, readOut, checkpoint, toCsv } from "./common.mjs";
import { loadRows, diffRows, absRows } from "./stats.mjs";
import { patternList } from "./defs.mjs";
import { companyStats } from "./common.mjs";

const protocol = readOut("protocol.json");
const latest = new Map(); for (const x of myResults()) latest.set(x.id, x.result);
const regd = new Map(myRegistry().map((h) => [h.id, h]));
const ids = [...regd.keys()].filter((id) => (id.startsWith("targets-OV") || id.startsWith("targets-P-")));
const missing = ids.filter((id) => !latest.has(id));
const ps = ids.map((id) => latest.get(id)?.p ?? null), qs = bhQ(ps);
const table = ids.map((id, i) => { const r = latest.get(id) || {}; return { id, family: regd.get(id).family, n: r.n, issuers: r.issuers, mean: r.mean, median: r.median, issuerMedian: r.issuerMedianOfMeans, event: r.eventMean ?? null, control: r.controlMean ?? null, t: r.t, p: r.p, q: r4(qs[i]), exTop5: r.meanExTop5Issuers }; });
writeOut("bh-discovery.json", { generatedAt: new Date().toISOString(), tests: ids.length, missingResults: missing, qLt10: table.filter((x) => x.q != null && x.q < 0.1).length, table });
writeOut("bh-discovery.csv", toCsv(table, Object.keys(table[0])));

// promising rule (protocol.promisingRule), applied to pattern tests only
const rows = loadRows(); const TH = readOut("thresholds.json"); const P = patternList(TH);
const D = rows.filter((r) => r.per === "discover");
const promising = [];
for (const p of P) {
  for (const k of ["hit10_5", "tp10s10n5", "x5"]) {
    const t = table.find((x) => x.id === `targets-P-${p.id}-${k}`); if (!t) continue;
    if (!(t.q != null && t.q < 0.1 && t.n >= 40 && t.issuers >= 25 && t.mean > 0)) continue;
    // issuer median: of the per-event diff (hit) or of the per-event net excess (tp, x5)
    const base = (p.universe === "om" ? D.filter((r) => r.cls === "om") : D).filter((r) => p.f(r));
    const rs = k === "hit10_5" ? diffRows(base, k, p.chart || "cm") : absRows(base, k);
    const cs = companyStats(rs.map(({ issuer, x }) => ({ issuer, x })), { boot: 0 });
    const ok = cs.issuerMedianOfMeans > 0;
    promising.push({ pattern: p.id, family: p.family, label: p.label, test: k, n: t.n, issuers: t.issuers, mean: t.mean, median: t.median, issuerMedian: cs.issuerMedianOfMeans, t: t.t, p: t.p, q: t.q, passesIssuerMedian: ok, promising: ok });
  }
}
writeOut("promising.json", { generatedAt: new Date().toISOString(), rule: protocol.promisingRule, protocolSha256: protocol.sha256, bhTests: ids.length, promising });
checkpoint("final discovery BH + promising selection", { bhTests: ids.length, qLt10: table.filter((x) => x.q != null && x.q < 0.1).length, promising: promising.filter((x) => x.promising).map((x) => `${x.pattern}:${x.test}`) });
console.log(`BH over ${ids.length} discovery tests; missing results ${missing.length}; q<0.10: ${table.filter((x) => x.q != null && x.q < 0.1).length}`);
for (const x of table.filter((x) => x.q != null && x.q < 0.1).sort((a, b) => a.q - b.q)) console.log(`${x.id.padEnd(40)} n ${x.n} mean ${x.mean} med ${x.median} t ${x.t} q ${x.q}`);
console.log("PROMISING:", JSON.stringify(promising, null, 0));
