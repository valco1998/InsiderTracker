// Task 2: rule attacks on eligibility / owner linking / amendments. Full independent pipeline per variant.
import * as A from "./alib.mjs";
const rows = A.loadRows(); const K = A.market();
const P = rows.filter((r) => r.code === "P");
const V = {
  base: { opt: {}, mode: "linked" },
  a_noPriceRange: { opt: { priceRange: false }, mode: "linked" },
  b_noListing5: { opt: { listing: false }, mode: "linked" },
  c_plainCik: { opt: {}, mode: "cik" },
  d_amendReplaces: { opt: { amendReplace: true }, mode: "linked" },
  all_abcd: { opt: { priceRange: false, listing: false, amendReplace: true }, mode: "cik" },
};
const out = {}; const baseIds = {};
for (const [name, v] of Object.entries(V)) {
  const { rows: el } = A.eligibleRows(P, K, v.opt);
  const R = A.pipeline(K, el, { mode: v.mode, allP: P });
  const M = R.main, ok = M.filter((c) => c.ctrlSt === "ok");
  const ids = new Set(M.map((c) => c.id)); if (name === "base") baseIds.ids = ids;
  const b1 = A.boot(ok, (x) => A.avg(x.map((c) => c.n180 - c.ctl_n180)));
  const b4 = A.boot(ok, (x) => A.avg(x.map((c) => c.maxGain - c.ctl_maxGain)));
  const b3 = A.boot(ok, (x) => A.avg(x.map((c) => c.hit20 - c.ctl_hit20)));
  const b2 = A.boot(M.filter((c) => c.x180 != null), (x) => A.avg(x.map((c) => c.x180)));
  out[name] = {
    eligible: el.length, clusters: Object.fromEntries([1, 2].flatMap((k) => ["A", "B", "C"].map((cat) => [`${k}${cat}`, R.clusters.filter((c) => c.clock === k && c.cat === cat).length]))),
    union2: R.unions[2].length, main: M.length, issuers: new Set(M.map((c) => c.cik)).size, withControls: ok.length,
    addedVsBase: baseIds.ids ? [...ids].filter((x) => !baseIds.ids.has(x)).length : 0, droppedVsBase: baseIds.ids ? [...baseIds.ids].filter((x) => !ids.has(x)).length : 0,
    medMaxGain: A.med(M.map((c) => c.maxGain)), hit20: A.avg(M.map((c) => c.hit20)),
    P1_n180_minus_ctl: [b1.est, b1.lo95, b1.hi95, b1.p], P2_x180_spy: [b2.est, b2.lo95, b2.hi95, b2.p], P3_hit20_minus_ctl: [b3.est, b3.lo95, b3.hi95, b3.p], P4_maxGain_minus_ctl: [b4.est, b4.lo95, b4.hi95, b4.p],
  };
  console.log(name, JSON.stringify(out[name]));
}
A.save("a2_variants.json", out);
