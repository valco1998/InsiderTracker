// deep6/pooled.mjs — 12-month descriptive tables (every full-180-day Clock 2 event, Nov 2025 – May 2026; mostly previously seen).
//   node --max-old-space-size=8192 scripts/research/deep6/pooled.mjs → .cache/research/deep6/build/pooled.json
import * as L from "../deep5/lib5.mjs";
import * as D6 from "./lib6.mjs";
const { mean, median, quantile, group } = L;
const J = D6.readOut("clusters.json");
const full = (cs) => cs.filter((c) => c.entryStatus === "ok" && c.full180).map((c) => ({ ...c, issuer: c.cik }));
const sets = { A: full(J.clusters.filter((c) => c.clock === 2 && c.cat === "A")), B: full(J.clusters.filter((c) => c.clock === 2 && c.cat === "B")), C: full(J.clusters.filter((c) => c.clock === 2 && c.cat === "C")), U: full(J.unions[2]) };
function d(cs) {
  const ok = cs.filter((c) => c.ctrlStatus === "ok"); const g = (k) => cs.map((c) => c[k]).filter((x) => x != null);
  return {
    n: cs.length, issuers: new Set(cs.map((c) => c.cik)).size, usdMedian: median(g("usd")),
    maxGain: { median: median(g("maxGain")), p25: quantile(g("maxGain"), 0.25), p75: quantile(g("maxGain"), 0.75), p90: quantile(g("maxGain"), 0.9) },
    daysToMaxMedian: median(g("daysToMax")), hit: Object.fromEntries(L.THRESH.map((t) => [t, mean(cs.map((c) => c[`hit${t}`]))])),
    r180Median: median(g("r180")), n180Mean: mean(g("n180")), spy180Mean: mean(g("spy180")),
    vsCtl: L.clusterBoot(ok, (x) => mean(x.map((c) => c.n180 - c.ctl_n180))), vsCtlMedian: median(ok.map((c) => c.n180 - c.ctl_n180)),
    vsSpy: L.clusterBoot(cs.filter((c) => c.x180 != null), (x) => mean(x.map((c) => c.x180))), vsSpyMedian: median(g("x180")),
    maxGainVsCtl: L.clusterBoot(ok, (x) => mean(x.map((c) => c.maxGain - c.ctl_maxGain))), ctlHit20: mean(ok.map((c) => c.ctl_hit20)),
  };
}
const out = { at: new Date().toISOString(), label: "descriptive, mostly previously seen (Dec–May in deep5)", byCat: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, d(v)])),
  months: [...group(sets.U, (c) => c.entryDate.slice(0, 7)).entries()].sort().map(([m, cs]) => { const ok = cs.filter((c) => c.ctrlStatus === "ok"); return { month: m, n: cs.length, vsCtl: mean(ok.map((c) => c.n180 - c.ctl_n180)), vsCtlMedian: median(ok.map((c) => c.n180 - c.ctl_n180)), vsSpy: mean(cs.map((c) => c.x180).filter((x) => x != null)), maxGainMedian: median(cs.map((c) => c.maxGain)), hit20: mean(cs.map((c) => c.hit20)) }; }),
  k1: L.clusterBoot(sets.U.filter((c) => c.c1r180 != null), (x) => mean(x.map((c) => c.c1r180 - c.r180))) };
D6.writeOut("pooled.json", JSON.stringify(out, null, 1));
const p = (x) => (x == null ? "—" : (x * 100).toFixed(1));
for (const [k, v] of Object.entries(out.byCat)) console.log(k, "n", v.n, "iss", v.issuers, "maxGain med", p(v.maxGain.median), "days", v.daysToMaxMedian, "hit", L.THRESH.map((t) => p(v.hit[t])).join("/"), "r180 med", p(v.r180Median), "vsCtl", p(v.vsCtl.est), `[${p(v.vsCtl.lo90)},${p(v.vsCtl.hi90)}]`, "med", p(v.vsCtlMedian), "vsSpy", p(v.vsSpy.est), "med", p(v.vsSpyMedian), "maxGainVsCtl", p(v.maxGainVsCtl.est));
console.log("months", out.months.map((m) => `${m.month} n${m.n} ctl ${p(m.vsCtl)} (med ${p(m.vsCtlMedian)}) spy ${p(m.vsSpy)}`).join(" | "));
console.log("K1", p(out.k1.est), p(out.k1.lo90), p(out.k1.hi90));
