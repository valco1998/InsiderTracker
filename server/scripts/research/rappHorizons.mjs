// RAPP (Rapport Therapeutics, CIK 0002012593) — returns of every RAPP purchase filing measured
// from the first realistically tradable entry AFTER its SEC publication, at 1/5/10/20/30/60
// trading sessions. Future horizons are "pending", never estimated.
// Also decomposes the post-offering rebound into the part before and after the large filing
// became public. Usage (from server/): node scripts/research/rappHorizons.mjs
import { loadSec, purchaseItemsByIssuer, buildEvents, loadDailyBars, lastCompleteSession, priceEvent, writeOut, HORIZONS, r4, pct } from "./lib.mjs";

const CIK = 2012593;
const sec = loadSec();
const events = buildEvents({ itemsByIssuer: purchaseItemsByIssuer(sec), acc: sec.acc }).filter((e) => e.issuerCik === CIK);
const bars = await loadDailyBars(["RAPP", "SPY"]);
const rapp = bars.get("RAPP"), spy = bars.get("SPY");
const completeThrough = lastCompleteSession();
for (const e of events) priceEvent(e, { bars: rapp, spy, completeThrough });

// Where did the move happen? Close-to-close segments around the large filing (public Oct 30 19:32:45 ET).
const seg = (a, b) => ({ from: a, to: b, rapp: r4(rapp.get(b).c / rapp.get(a).c - 1), spy: r4(spy.get(b).c / spy.get(a).c - 1) });
const openToClose = (d) => ({ day: d, rapp: r4(rapp.get(d).c / rapp.get(d).o - 1), spy: r4(spy.get(d).c / spy.get(d).o - 1) });
const decomposition = {
  note: "Large filing (Healy / Sofinnova funds, $20.36M at the $21.00 offering price) became public Fri 2026-10-30 19:32:45 ET; first regular-hours entry = Mon 2026-11-02 open.",
  offeringPricedDay: { day: "2026-10-28", prevClose: rapp.get("2026-10-27").c, open: rapp.get("2026-10-28").o, low: rapp.get("2026-10-28").l, close: rapp.get("2026-10-28").c },
  beforePublication: seg("2026-10-28", "2026-10-30"),
  overWeekend: { from: "2026-10-30 close", to: "2026-11-02 open", rapp: r4(rapp.get("2026-11-02").o / rapp.get("2026-10-30").c - 1), spy: r4(spy.get("2026-11-02").o / spy.get("2026-10-30").c - 1) },
  afterPublication: [openToClose("2026-11-02"), ...(rapp.get("2026-11-03") ? [seg("2026-11-02", "2026-11-03")] : [])],
};
const rows = events.map((e) => ({
  accessionNo: e.accessionNo, insider: e.insider, tradeDate: e.tradeDate, secPublishedET: e.publishedAt, ownership: e.ownership, venue: e.venue,
  filingValueUsd: Math.round(e.filingValue), reportedPrice: e.price, entryDate: e.entryDate, entryPrice: e.entryPrice ?? null, costBpsPerSide: e.costBpsPerSide ?? null, priceStatus: e.priceStatus,
  horizons: Object.fromEntries(HORIZONS.map((N) => [N, e.h?.[N] || { status: e.priceStatus === "ok" ? "?" : e.priceStatus }])),
}));
const out = { generatedAt: new Date().toISOString(), completeThrough, decomposition, filings: rows };
const f = writeOut("rapp-horizons.json", out);
console.log(`complete sessions through ${completeThrough} → ${f}\n`);
console.log("WHERE THE MOVE HAPPENED");
console.log(`  Oct 27 close $${decomposition.offeringPricedDay.prevClose} → offering priced $21.00 → Oct 28 low $${decomposition.offeringPricedDay.low}, close $${decomposition.offeringPricedDay.close}`);
console.log(`  Oct 28 close → Oct 30 close (BEFORE the filing was public): RAPP ${pct(decomposition.beforePublication.rapp)}, SPY ${pct(decomposition.beforePublication.spy)}`);
console.log(`  Oct 30 close → Nov 2 open (weekend, after publication): RAPP ${pct(decomposition.overWeekend.rapp)}`);
for (const a of decomposition.afterPublication) console.log(`  ${a.day ? `${a.day} open → close` : `${a.from} → ${a.to} close`}: RAPP ${pct(a.rapp)}, SPY ${pct(a.spy)}`);
console.log("\nRETURNS FROM THE FIRST TRADABLE ENTRY AFTER EACH FILING (gross | net of costs | SPY | excess | max drawdown | max favorable)");
for (const r of rows) {
  console.log(`\n${r.insider} · trade ${r.tradeDate} · public ${r.secPublishedET} ET · $${r.filingValueUsd.toLocaleString("en-US")} · entry ${r.entryDate} open $${r.entryPrice} · cost ${r.costBpsPerSide} bps/side`);
  for (const N of HORIZONS) {
    const h = r.horizons[N];
    console.log(`  ${String(N).padStart(2)}d → ${h.exitDate || ""}  ${h.status === "ok" ? `${pct(h.gross, 2)} | ${pct(h.net, 2)} | SPY ${pct(h.spy, 2)} | ${pct(h.excess, 2)} | DD ${pct(h.maxDrawdown, 1)} | MFE ${pct(h.maxFavorable, 1)}` : h.status.toUpperCase()}`);
  }
}
