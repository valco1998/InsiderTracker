// deep2/behavior/timelines.mjs — company memory: per-issuer timelines of purchase filings, descriptive sequence tables,
// and objectively selected case studies (5 best + 5 worst issuers by mean H5 net excess among issuers with >= 3 true
// open-market filings and >= $2M median daily dollar volume, plus the 2 issuers with the most open-market filings).
//   node scripts/research/deep2/behavior/timelines.mjs
// Descriptive only: the registered tests are in discovery.mjs; nothing here is used to choose a rule.
import { loadEvents, loadBars } from "../lib2.mjs";
import { writeOut, r4, mean, median, chartDesc } from "./common.mjs";
import { buildRows } from "./outcomes.mjs";

const bars = loadBars();
const ev = new Map(loadEvents().map((e) => [e.accessionNo, e]));
const rows = buildRows().filter((r) => r.period !== "holdout");
const byIssuer = new Map();
for (const r of rows) (byIssuer.get(r.issuer) || byIssuer.set(r.issuer, []).get(r.issuer)).push(r);
for (const xs of byIssuer.values()) xs.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));

// ---- timelines for every issuer with >= 2 priced purchase filings ----
const timelines = [];
for (const [issuer, xs] of byIssuer) {
  if (xs.length < 2) continue;
  timelines.push({ issuer, ticker: xs[0].ticker, filings: xs.map((r) => {
    const e = ev.get(r.acc); const d = chartDesc(e, bars) || {};
    return { acc: r.acc, publishedAt: r.publishedAt, period: r.period, insider: r.insider, role: r.role, cls: r.cls, value: Math.round(r.filingValue || 0),
      posIncrease: r.posIncrease, firstPosition: r.firstPosition, burstN: r.burstN, buyerType30: r.buyerType30, daysSincePrevOm: r.daysSincePrevOm,
      prevPostOpen1: r.prevPostOpen1, ret60: d.ret60 ?? null, ret20: d.ret20 ?? null, dd60: d.dd60 ?? null, volumeRatio5_60: d.volumeRatio5_60 ?? null,
      gap: r.gap, day0Net: r.day0?.excessNet ?? null, h1: r.x[1], h5: r.x[5], h20: r.x[20] };
  }) });
}
writeOut("timelines.json", timelines);

// ---- descriptive sequence tables (true open-market filings, discovery + confirmation shown separately) ----
const om = rows.filter((r) => r.cls === "om");
const cell = (xs) => ({ n: xs.length, gap: r4(mean(xs.map((r) => r.gap).filter((v) => v != null))), h1: r4(mean(xs.map((r) => r.x[1]).filter((v) => v != null))),
  h5: r4(mean(xs.map((r) => r.x[5]).filter((v) => v != null))), h5med: r4(median(xs.map((r) => r.x[5]).filter((v) => v != null))) });
const table = (key, groups) => Object.fromEntries(["discover", "confirm"].map((p) => [p, Object.fromEntries(Object.entries(groups).map(([k, f]) => [k, cell(om.filter((r) => r.period === p && f(r)))]))]));
const desc = {
  burstPosition: table("burstN", { "1st": (r) => r.burstN === 1, "2nd": (r) => r.burstN === 2, "3rd": (r) => r.burstN === 3, "4th": (r) => r.burstN === 4, "5th+": (r) => r.burstN >= 5 }),
  daysSincePrevOm: table("days", { "same/next day (<=1)": (r) => r.daysSincePrevOm != null && r.daysSincePrevOm <= 1, "2-7": (r) => r.daysSincePrevOm >= 2 && r.daysSincePrevOm <= 7, "8-30": (r) => r.daysSincePrevOm >= 8 && r.daysSincePrevOm <= 30, ">30": (r) => r.daysSincePrevOm > 30, "none in store": (r) => r.daysSincePrevOm == null }),
  previousReaction: table("prev", { "prev faded (< -2%)": (r) => r.prevPostOpen1 != null && r.prevPostOpen1 < -0.02, "prev flat (-2..+2%)": (r) => r.prevPostOpen1 != null && Math.abs(r.prevPostOpen1) <= 0.02, "prev continued (> +2%)": (r) => r.prevPostOpen1 > 0.02, "no previous": (r) => r.prevPostOpen1 == null }),
  buyerType30: table("type", { independent: (r) => r.buyerType30 === "independent", repeat: (r) => r.buyerType30 === "repeat", none: (r) => r.buyerType30 === "none" }),
  convictionTerciles: table("pi", { "<5%": (r) => !r.firstPosition && r.posIncrease != null && r.posIncrease < 0.05, "5-25%": (r) => !r.firstPosition && r.posIncrease >= 0.05 && r.posIncrease < 0.25, ">=25%": (r) => !r.firstPosition && r.posIncrease >= 0.25, "first position": (r) => r.firstPosition }),
  othersSold90: table("sold", { "others sold (discretionary)": (r) => r.salesCovered && r.othersSold90 > 0, "no others sold": (r) => r.salesCovered && r.othersSold90 === 0 }),
};
writeOut("sequence-tables.json", desc);

// ---- case studies (objective selection) ----
const cand = [];
for (const [issuer, xs] of byIssuer) {
  const o = xs.filter((r) => r.cls === "om" && r.x[5] != null);
  if (o.length < 3) continue;
  const dv = median(o.map((r) => ev.get(r.acc)?.dollarVol20 || 0));
  if (!(dv >= 2e6)) continue;
  cand.push({ issuer, ticker: xs[0].ticker, n: o.length, meanH5: mean(o.map((r) => r.x[5])), dv });
}
cand.sort((a, b) => b.meanH5 - a.meanH5);
const most = [...cand].sort((a, b) => b.n - a.n).slice(0, 2);
const chosen = [...cand.slice(0, 5).map((c) => ({ ...c, why: "top-5 mean H5" })), ...cand.slice(-5).reverse().map((c) => ({ ...c, why: "bottom-5 mean H5" })),
  ...most.filter((m) => !cand.slice(0, 5).concat(cand.slice(-5)).some((c) => c.issuer === m.issuer)).map((c) => ({ ...c, why: "most open-market filings" }))];
const cases = chosen.map((c) => ({ ...c, meanH5: r4(c.meanH5), timeline: byIssuer.get(c.issuer).map((r) => {
  const e = ev.get(r.acc); const d = chartDesc(e, bars);
  return { publishedAt: r.publishedAt, period: r.period, insider: r.insider, role: r.role, cls: r.cls, value: Math.round(r.filingValue || 0), posIncrease: r.posIncrease,
    first: r.firstPosition, burstN: r.burstN, buyerType30: r.buyerType30, gap: r.gap, h1: r.x[1], h5: r.x[5], h20: r.x[20], chart: d?.text || "n/a",
    ret60: d?.ret60 ?? null, dd60: d?.dd60 ?? null, volumeRatio5_60: d?.volumeRatio5_60 ?? null };
}) }));
writeOut("case-studies.json", cases);

const f = (v) => (v == null ? "-" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
console.log(`timelines: ${timelines.length} issuers with >= 2 priced filings; case-study pool ${cand.length}`);
for (const [k, t] of Object.entries(desc)) { console.log(`\n${k}`); for (const p of ["discover", "confirm"]) console.log(`  ${p}: ` + Object.entries(t[p]).map(([g, c]) => `${g} n=${c.n} gap ${f(c.gap)} h1 ${f(c.h1)} h5 ${f(c.h5)} (med ${f(c.h5med)})`).join(" | ")); }
for (const c of cases) {
  console.log(`\n=== ${c.ticker} (${c.why}; ${c.n} OM filings; mean H5 ${f(c.meanH5)}; median $vol ${(c.dv / 1e6).toFixed(1)}M) ===`);
  for (const t of c.timeline) console.log(`  ${t.publishedAt} [${t.period}] ${String(t.insider).slice(0, 28)} (${t.role}) ${t.cls} $${t.value} +${t.first ? "FIRST" : f(t.posIncrease)} burst#${t.burstN} ${t.buyerType30} | gap ${f(t.gap)} h1 ${f(t.h1)} h5 ${f(t.h5)} h20 ${f(t.h20)}\n      ${t.chart}`);
}
