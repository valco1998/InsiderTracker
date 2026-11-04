// server/scripts/research/deep/followups.mjs — follow-up checks on the "opening gap" observation
// (stage G): is the post-publication gap real, consistent across periods and absent on ordinary
// days? Read-only; uses the stage C checkpoint and the cached daily bars. Writes deep/followups.json.
//   node scripts/research/deep/followups.mjs
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR, loadDailyBars, sym, median, mean, r4, clusteredT, pValue, previousSession } from "../lib.mjs";

const DIR = path.join(OUT_DIR, "deep");
const C = JSON.parse(fs.readFileSync(path.join(DIR, "stageC.json"), "utf8"));
const E = C.events.filter((e) => e.priceStatus === "ok" && e.decisionClose > 0);
const bars = await loadDailyBars([...new Set(E.map((e) => e.ticker)), "SPY"]);
const spy = bars.get("SPY");
const VAL_START = "2026-06-15", TEST_START = "2026-09-01";
const split = (e) => (e.publishedAt < VAL_START ? "train" : e.publishedAt < TEST_START ? "validation" : "test");
const wmean = (xs) => mean(xs.map((v) => Math.max(-0.5, Math.min(0.5, v))));
// Gap on a given session: open / previous close − 1, minus SPY's same gap.
function gapOn(ticker, day) {
  const b = bars.get(sym(ticker)); if (!b) return null;
  const d0 = previousSession(day), x = b.get(day), p = b.get(d0), sx = spy.get(day), sp = spy.get(d0);
  return x && p && sx && sp && p.c > 0 ? (x.o / p.c - 1) - (sx.o / sp.c - 1) : null;
}
// Placebo: the same stock's gap 10 sessions BEFORE the entry session (no filing that day by construction
// of the window? not guaranteed — any filing that day is excluded).
const filingDays = new Map(); for (const e of E) { const k = sym(e.ticker); (filingDays.get(k) || filingDays.set(k, new Set()).get(k)).add(e.entryDate); }
function placebo(e) { let d = e.entryDate; for (let i = 0; i < 10; i++) d = previousSession(d); return filingDays.get(sym(e.ticker))?.has(d) ? null : gapOn(e.ticker, d); }
const bucket = (t) => (t >= "09:30:00" && t < "16:00:00" ? "during regular hours" : t >= "16:00:00" && t < "20:00:00" ? "after close (16–20 ET)" : t >= "20:00:00" ? "late evening (20–24 ET)" : t < "04:00:00" ? "overnight (0–4 ET)" : "pre-market (4–9:30 ET)");
const groups = {
  "All purchases": () => true,
  "Open market (stated)": (e) => e.venue === "open_market",
  "CEO/CFO personal open-market ≥ $250k": (e) => (e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5,
  "After ≥30% drawdown": (e) => e.dd60 <= -0.3,
  "Very liquid (≥ $50M/day)": (e) => e.dollarVol20 >= 50e6,
  "Thin (< $1M/day)": (e) => e.dollarVol20 < 1e6,
};
const summarize = (rows) => { const xs = rows.map((r) => r.g); const t = clusteredT(rows.map((r) => ({ issuer: r.issuer, g: r.g })), "g");
  return { n: xs.length, median: r4(median(xs)), wmean: r4(wmean(xs)), positive: xs.length ? r4(xs.filter((v) => v > 0).length / xs.length) : null, t: r4(t), p: r4(pValue(t)) }; };
const out = { generatedAt: new Date().toISOString(), groups: {} };
for (const [g, f] of Object.entries(groups)) {
  const es = E.filter(f);
  const ev = es.map((e) => ({ e, issuer: e.issuerCik, g: gapOn(e.ticker, e.entryDate) })).filter((r) => r.g != null);
  const pl = es.map((e) => ({ issuer: e.issuerCik, g: placebo(e) })).filter((r) => r.g != null);
  out.groups[g] = {
    event: summarize(ev), placebo: summarize(pl),
    bySplit: Object.fromEntries(["train", "validation", "test"].map((sp) => [sp, summarize(ev.filter((r) => split(r.e) === sp))])),
    byPublicationTime: Object.fromEntries(["after close (16–20 ET)", "late evening (20–24 ET)", "overnight (0–4 ET)", "pre-market (4–9:30 ET)", "during regular hours"].map((b) => [b, summarize(ev.filter((r) => bucket(r.e.publishedAt.slice(11)) === b))])),
    byMonth: [...new Set(ev.map((r) => r.e.entryDate.slice(0, 7)))].sort().map((m) => ({ month: m, ...summarize(ev.filter((r) => r.e.entryDate.slice(0, 7) === m)) })),
    // What a follower actually earns from the open vs. what the move from the prior close was.
    openTo20: summarize(es.filter((e) => e.h?.[20]?.status === "ok").map((e) => ({ issuer: e.issuerCik, g: e.h[20].excess }))),
  };
}
fs.writeFileSync(path.join(DIR, "followups.json"), JSON.stringify(out, null, 1));
const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
for (const [g, o] of Object.entries(out.groups)) {
  console.log(`\n${g}: EVENT gap median ${pct(o.event.median)} wmean ${pct(o.event.wmean)} positive ${pct(o.event.positive)} t=${o.event.t} (n ${o.event.n}) | PLACEBO median ${pct(o.placebo.median)} wmean ${pct(o.placebo.wmean)} t=${o.placebo.t} (n ${o.placebo.n})`);
  console.log(`  by split: ${Object.entries(o.bySplit).map(([k, s]) => `${k} ${pct(s.median)}/${pct(s.wmean)} (n ${s.n}, t ${s.t})`).join(" | ")}`);
  console.log(`  by publication time: ${Object.entries(o.byPublicationTime).map(([k, s]) => `${k}: ${pct(s.median)} (n ${s.n})`).join(" | ")}`);
  console.log(`  months with positive median gap: ${o.byMonth.filter((m) => m.median > 0).length}/${o.byMonth.length}`);
}
