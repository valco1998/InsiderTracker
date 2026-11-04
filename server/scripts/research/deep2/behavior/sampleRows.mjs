// deep2/behavior/sampleRows.mjs — prints a deterministic stratified sample of classified purchase rows for hand inspection.
//   node scripts/research/deep2/behavior/sampleRows.mjs [perStratum=8] [seed=11]
import { readOut } from "./common.mjs";
import { loadSecRows } from "../lib2.mjs";

const per = Number(process.argv[2] || 8), seed0 = Number(process.argv[3] || 11);
const rows = readOut("rows-classified.json");
const sec = await loadSecRows();
const raw = new Map(sec.rows.map((r) => [r.id, r]));
let s = seed0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const strata = {
  "om/text": (x) => x.cls === "om" && x.omText,
  "om/price-only": (x) => x.cls === "om" && !x.omText,
  "offering/text": (x) => x.cls === "offering" && x.venue === "offering" && x.offerText,
  "offering/price": (x) => x.cls === "offering" && x.venue === "offering" && !x.offerText,
  "offering/plan+other": (x) => x.cls === "offering" && (x.venue === "plan" || x.venue === "other_nonmarket"),
  "entity": (x) => x.cls === "entity",
  "unknown": (x) => x.cls === "unknown",
};
const only = process.argv[4] || null;
for (const [name, f] of Object.entries(strata)) {
  if (only && name !== only) continue;
  const pool = rows.filter(f).filter((x) => x.priceCheck !== "anomaly");
  const pick = []; const used = new Set();
  while (pick.length < Math.min(per, pool.length)) { const k = Math.floor(rnd() * pool.length); if (!used.has(k)) { used.add(k); pick.push(pool[k]); } }
  console.log(`\n==================== ${name} (pool ${pool.length}) ====================`);
  for (const x of pick) {
    const r = raw.get(x.id);
    console.log(`--- ${x.id} ${x.ticker} ${x.tradeDate} acc@${x.acceptedAt} | ${x.insider.slice(0, 90)} | role: ${x.role.slice(0, 60)}`);
    console.log(`    shares ${x.shares} @ ${x.price} = $${Math.round(x.value || 0)} | after ${x.after} | own ${x.own} ${x.nature ? `(${String(x.nature).slice(0, 60)})` : ""} | 10b5-1 ${x.plan10b5} | stated ${x.statedCtx}`);
    console.log(`    px ${x.px.status} vsLow ${x.px.vsLow} vsHigh ${x.px.vsHigh} factor ${x.px.factor} | round ${x.round} dec ${x.decimals} | peers ${x.peers}`);
    console.log(`    => ${x.cls} | venue ${x.venue}: ${x.vwhy} | entity: ${x.ewhy || "-"}`);
    console.log(`    fn: ${String(r.fn || "").slice(0, 420)}`);
    if (r.remarks) console.log(`    remarks: ${String(r.remarks).slice(0, 200)}`);
  }
}
