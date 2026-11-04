// Exploration (design segment only): p-status.json, bars coverage, adjFactor inference rates.
import fs from "node:fs";
import path from "node:path";
import { visible, loadBars, idxBefore } from "../../lib4.mjs";
import { OUT_DIR, entrySessionAfter } from "../../../lib.mjs";

const pf = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep3", "dataquality", "p-filings.json"), "utf8"));
const rows = visible(pf.rows, (r) => r.publishedAt, "panel");
const accs = new Set(rows.map((r) => r.acc));
const ps = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep3", "dataquality", "p-status.json"), "utf8")).filter((x) => accs.has(x.acc));
const cnt = (arr, f) => arr.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log("p-status design", ps.length, JSON.stringify(cnt(ps, (x) => x.status)), "sub", JSON.stringify(cnt(ps, (x) => x.sub)));
const psBy = new Map(ps.map((x) => [x.acc, x]));
const symDiff = rows.filter((r) => psBy.get(r.acc)?.symbol && r.ticker && psBy.get(r.acc).symbol !== r.ticker.toUpperCase().replace(/-/g, "."));
console.log("symbol differs from ticker", symDiff.length, JSON.stringify(symDiff.slice(0, 8).map((r) => [r.ticker, psBy.get(r.acc).symbol, psBy.get(r.acc).status])));
const entryDiff = rows.filter((r) => psBy.get(r.acc)?.entry && psBy.get(r.acc).entry !== entrySessionAfter(r.publishedAt, 60));
console.log("entry differs from entrySessionAfter", entryDiff.length, JSON.stringify(entryDiff.slice(0, 5).map((r) => [r.publishedAt, psBy.get(r.acc).entry, entrySessionAfter(r.publishedAt, 60)])));
const bars = loadBars();
const spy = bars.get("SPY");
console.log("symbols", bars.size, "SPY first/last", spy.arr[0].d, spy.arr.at(-1).d, "SPY sessions", spy.arr.length);
let firsts = cnt([...bars.values()], (s) => (s.arr[0]?.d || "none").slice(0, 7));
console.log("first bar month", JSON.stringify(firsts));
// adjFactor inference on design rows that have bars
const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
let inferred = 0, total = 0; const ratios = [];
for (const r of rows) {
  const s = bars.get(psBy.get(r.acc)?.symbol || sym(r.ticker)); if (!s || !(r.price > 0)) continue;
  let i = s.idx.get(r.tradeDate); if (i == null) i = idxBefore(s, r.tradeDate); if (i < 0) continue;
  total++; const ratio = s.arr[i].c / r.price; if (ratio > 1.8 || ratio < 0.55) { inferred++; ratios.push(Math.round(ratio * 100) / 100); }
}
ratios.sort((a, b) => a - b);
console.log("adj inferred", inferred, "of", total, "ratios sample", JSON.stringify(ratios.filter((_, i) => i % Math.max(1, Math.floor(ratios.length / 60)) === 0)));
// zero-volume and missing bars on sessions
let zeroV = 0, nb = 0; for (const [s, ser] of bars) { if (s === "SPY") continue; for (const b of ser.arr) { nb++; if (!(b.v > 0)) zeroV++; } }
console.log("bars", nb, "zero-volume", zeroV);
const tdOld = rows.filter((r) => r.tradeDate < "2025-10-01").length;
console.log("tradeDate before 2025-10-01", tdOld);
