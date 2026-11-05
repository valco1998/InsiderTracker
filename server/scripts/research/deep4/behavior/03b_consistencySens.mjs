// deep4/behavior/03b_consistencySens.mjs — DESCRIPTIVE sensitivity of the cross-issuer style-consistency tests (features only;
// not registered tests). Concern: a person buying several AFFILIATED issuers at the same time (fund families, sponsor groups)
// makes "cross-issuer" episodes share one market event. Variants:
//   (a) drop units whose new-issuer episode starts within 14 calendar days of the person's previous episode start (any issuer);
//   (b) keep only units whose earlier episodes are >= 30 days before (strict separation in time);
//   (c) one unit per person (the first cross-issuer unit) to remove heavy-repeater weight.
//   node --max-old-space-size=6144 scripts/research/deep4/behavior/03b_consistencySens.mjs
import { loadDesign, isPrimaryPurchase, writeJson, readJson, checkpoint, group, mean, r4, rng, shuffleInPlace, pearson } from "./common.mjs";
import { labelsOf, episodesOf, STYLE_RULES_FILE } from "./styles.mjs";

const th = readJson(STYLE_RULES_FILE).thresholds;
const { rows } = loadDesign();
const prim = rows.filter(isPrimaryPurchase).map((r) => ({ ...r, L: labelsOf(r, th) }));
const dnum = (s) => Math.floor(Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`) / 864e5);
const people = [...group(prim, (r) => r.person).values()].map((rs) => { rs.sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1)); return episodesOf(rs); });
const epLabel = (ep, L) => { for (const r of ep.rows) if (r.L[L] === 0 || r.L[L] === 1) return r; return null; };
function units(L, variant) {
  const us = [];
  for (const eps of people) {
    if (eps.length < 2) continue;
    const seen = []; const iss = new Set(); let taken = false;
    for (let j = 0; j < eps.length; j++) {
      const ep = eps[j], r = epLabel(ep, L);
      if (j >= 1 && r && seen.length && !iss.has(ep.cik)) {
        const gapPrev = dnum(ep.start) - dnum(eps[j - 1].start);
        const sep = seen.filter((s) => dnum(ep.start) - dnum(s.start) >= 30);
        let ok = true, s = mean(seen.map((x) => x.v));
        if (variant === "a" && gapPrev < 14) ok = false;
        if (variant === "b") { if (!sep.length) ok = false; else s = mean(sep.map((x) => x.v)); }
        if (variant === "c" && taken) ok = false;
        if (ok) { us.push({ s, y: r.L[L], month: r.month }); taken = true; }
      }
      if (r) seen.push({ v: r.L[L], start: ep.start });
      iss.add(ep.cik);
    }
  }
  return us;
}
function test(us) {
  if (us.length < 8) return { n: us.length };
  const s = us.map((u) => u.s), y = us.map((u) => u.y), r = pearson(s, y);
  if (r == null) return { n: us.length };
  const strata = group(us.map((_, i) => i), (i) => us[i].month), rnd = rng(5); let ge = 0; const perm = new Array(us.length);
  for (let b = 0; b < 2000; b++) { for (const idx of strata.values()) { const ys = shuffleInPlace(idx.map((i) => y[i]), rnd); idx.forEach((i, k) => { perm[i] = ys[k]; }); } const rb = pearson(s, perm); if (rb != null && rb >= r) ge++; }
  return { n: us.length, r: r4(r), p: r4((1 + ge) / 2001), lift: r4(mean(us.filter((u) => u.s >= 0.5).map((u) => u.y)) - mean(us.filter((u) => u.s < 0.5).map((u) => u.y))) };
}
const out = { builtAt: new Date().toISOString(), note: "descriptive sensitivity (features only; not registered tests)", variants: { a: "drop units starting < 14 days after the previous episode", b: "earlier episodes >= 30 days before only", c: "first cross-issuer unit per person only" }, results: {} };
for (const L of ["DIP", "LOW", "DEEP", "MOM", "CONTRA", "FOLLOW"]) out.results[L] = { base: test(units(L, "base")), a: test(units(L, "a")), b: test(units(L, "b")), c: test(units(L, "c")) };
const orig = readJson("consistency.json").tests.filter((t) => t.level === "crossIssuer");
writeJson("consistency-sensitivity.json", out);
checkpoint("03b_consistencySens", {});
for (const [L, v] of Object.entries(out.results)) console.log(L.padEnd(7), "orig", JSON.stringify(orig.find((t) => t.label === L) ? { r: orig.find((t) => t.label === L).r, p: orig.find((t) => t.label === L).p } : null), "base", JSON.stringify(v.base), "a", JSON.stringify(v.a), "b", JSON.stringify(v.b), "c", JSON.stringify(v.c));
