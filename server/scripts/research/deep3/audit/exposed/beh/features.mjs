// deep2/behavior/features.mjs — point-in-time behaviour features per purchase filing (stage-C event). No returns here.
//   node scripts/research/deep2/behavior/features.mjs   (needs classify.mjs output)
// Known at T = the event's SEC acceptance (publishedAt): only SEC rows with acceptedAt <= T are used (sales, prior buys,
// prior filings). Company-memory reactions use earlier events whose day-1 exit closed before this event's entry session.
import { loadSecRows, loadEvents } from "../../../../deep2/lib2.mjs";
import { writeOut, readOut, dnum, addDays, ownerNames, rolesOfText, r4, median } from "./common.mjs";

const sec = await loadSecRows();
const filingClass = readOut("filing-class.json");
const events = loadEvents({ includeUnpriced: true }); // holdout hidden by lib2
const COVER_START = "2025-12-01";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const P = sec.rows.filter((r) => r.code === "P" && r.amend !== "superseded");
const S = sec.rows.filter((r) => r.code === "S");
const group = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
const pByAcc = group(P, (r) => r.acc), pByCik = group(P, (r) => r.cik), sByCik = group(S, (r) => r.cik);
// Purchase filings per issuer: { acc, acceptedAt, insiderCik, names, value, tradeDate, cls }
const filingsByCik = new Map();
for (const [cik, rows] of pByCik) {
  const fs = [...group(rows, (r) => r.acc).entries()].map(([acc, xs]) => ({ acc, acceptedAt: xs[0].acceptedAt, insiderCik: xs[0].insiderCik,
    names: new Set(ownerNames(xs[0].insider).map(norm)), value: xs.reduce((a, r) => a + (r.priceCheck === "anomaly" ? 0 : r.value || 0), 0),
    tradeDate: xs.map((r) => r.tradeDate).sort().at(-1), cls: filingClass[acc]?.cls || "unknown" }));
  filingsByCik.set(cik, fs.sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt)));
}
const samePerson = (a, b) => a.insiderCik === b.insiderCik || [...a.names].some((n) => b.names.has(n));

// Stage-C events per issuer (for reaction memory), sorted by publication.
const evByCik = group(events.filter((e) => e.priceStatus === "ok"), (e) => e.issuerCik);
for (const xs of evByCik.values()) xs.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));

function conviction(e, rows, T) {
  // Ownership lines in this filing: direct, and each nature of indirect ownership.
  const lines = group(rows, (r) => `${r.own}|${norm(r.nature)}`);
  let bought = 0, prior = 0, after = 0, valid = true, directPriorZero = false, hasDirect = false, indirectPrior = 0;
  for (const [k, xs] of lines) {
    const b = xs.reduce((a, r) => a + (r.shares || 0), 0);
    const aft = Math.max(...xs.map((r) => (Number.isFinite(r.after) ? r.after : -1)));
    if (!(b > 0) || !(aft >= 0)) { valid = false; continue; }
    const pr = aft - b;
    if (pr < -Math.max(1, 0.001 * aft)) { valid = false; continue; } // 'after' inconsistent with the shares bought
    bought += b; after += aft; prior += Math.max(0, pr);
    if (k.startsWith("D|")) { hasDirect = true; if (pr <= 0.005 * aft) directPriorZero = true; } else indirectPrior += Math.max(0, pr);
  }
  if (!valid || !(bought > 0)) return { convValid: false };
  // Earlier rows of the same person at this issuer that show holdings (point in time).
  const me = { insiderCik: rows[0].insiderCik, names: new Set(ownerNames(rows[0].insider).map(norm)) };
  const earlier = [...(pByCik.get(e.issuerCik) || []), ...(sByCik.get(e.issuerCik) || [])]
    .filter((r) => r.acc !== e.accessionNo && r.acceptedAt < T && samePerson(me, { insiderCik: r.insiderCik, names: new Set(ownerNames(r.insider).map(norm)) }));
  const earlierHoldings = earlier.some((r) => r.after > 0);
  const firstPosition = hasDirect && directPriorZero && indirectPrior <= 0.005 * after && prior <= 0.005 * after && !earlierHoldings;
  const posIncrease = prior > 0.005 * after ? bought / prior : null; // null when prior ≈ 0
  // Size vs this insider's own earlier purchase filings at the issuer (point in time, any class).
  const mine = (filingsByCik.get(e.issuerCik) || []).filter((f) => f.acc !== e.accessionNo && f.acceptedAt < T && samePerson(me, f) && f.value > 0);
  const value = rows.reduce((a, r) => a + (r.priceCheck === "anomaly" ? 0 : r.value || 0), 0);
  const ownMedian = mine.length ? median(mine.map((f) => f.value)) : null;
  return { convValid: true, sharesBought: bought, priorHoldings: prior, holdingsAfter: after, posIncrease: posIncrease == null ? null : r4(posIncrease),
    priorNearZero: prior <= 0.005 * after, firstPosition, earlierHoldings, ownPriorFilings: mine.length, valueVsOwnMedian: ownMedian ? r4(value / ownMedian) : null, filingValueRows: value };
}

function salesContext(e, rows, T) {
  const tDay = T.slice(0, 10), from = addDays(tDay, -90);
  const me = { insiderCik: rows[0].insiderCik, names: new Set(ownerNames(rows[0].insider).map(norm)) };
  const sales = (sByCik.get(e.issuerCik) || []).filter((r) => r.acceptedAt <= T && r.tradeDate >= from && r.tradeDate <= tDay);
  const disc = sales.filter((r) => !r.plan);
  const isMe = (r) => samePerson(me, { insiderCik: r.insiderCik, names: new Set(ownerNames(r.insider).map(norm)) });
  const others = disc.filter((r) => !isMe(r)), othersAll = sales.filter((r) => !isMe(r));
  const buys = (pByCik.get(e.issuerCik) || []).filter((r) => r.acceptedAt <= T && r.tradeDate >= from && r.tradeDate <= tDay && (filingClass[r.acc]?.cls || "unknown") !== "offering");
  const buyUsd = buys.reduce((a, r) => a + (r.priceCheck === "anomaly" ? 0 : r.value || 0), 0);
  const sellUsd = disc.reduce((a, r) => a + (r.value > 0 ? r.value : 0), 0);
  const priorBuyFilings = new Set(buys.filter((r) => r.acc !== e.accessionNo && r.acceptedAt < T).map((r) => r.acc)).size;
  const sellFilings = new Set(disc.map((r) => r.acc)).size;
  return {
    salesCovered: from >= COVER_START,
    othersSold90: new Set(others.map((r) => r.insiderCik)).size, othersSoldAny90: new Set(othersAll.map((r) => r.insiderCik)).size,
    othersSoldUsd90: r4(others.reduce((a, r) => a + (r.value > 0 ? r.value : 0), 0)),
    selfSold90: disc.some(isMe), selfSoldAny90: sales.some(isMe),
    netBalance90: buyUsd + sellUsd > 0 ? r4((buyUsd - sellUsd) / (buyUsd + sellUsd)) : null, buyUsd90: r4(buyUsd), sellUsd90: r4(sellUsd),
    sellFilings90: sellFilings, priorBuyFilings90: priorBuyFilings, firstBuyAfterSelling: priorBuyFilings === 0 && sellFilings >= 3,
  };
}

function memory(e, rows, T) {
  const me = { insiderCik: rows[0].insiderCik, names: new Set(ownerNames(rows[0].insider).map(norm)) };
  const fs = (filingsByCik.get(e.issuerCik) || []).filter((f) => f.acceptedAt < T && f.acc !== e.accessionNo);
  const om = fs.filter((f) => f.cls === "om");
  // Burst of open-market filings: chain of OM filings each accepted within 14 days of the next, ending at this filing.
  let n = 1, cur = T;
  for (let i = om.length - 1; i >= 0; i--) { if (dnum(cur) - dnum(om[i].acceptedAt) <= 14) { n++; cur = om[i].acceptedAt; } else break; }
  const lastOm = om.at(-1);
  const daysSincePrevOm = lastOm ? dnum(T) - dnum(lastOm.acceptedAt) : null;
  const coverDays = dnum(T) - dnum(COVER_START);
  // Independent buyers vs the same insider repeating: OM filings in the 30 days before this filing's trade date.
  const w30 = om.filter((f) => dnum(f.tradeDate) >= dnum(e.tradeDate) - 30);
  const indep = w30.filter((f) => !samePerson(me, f)), repeat = w30.filter((f) => samePerson(me, f));
  const indepPeople = new Set(indep.map((f) => f.insiderCik)).size;
  // Reaction memory: the most recent earlier priced event at this issuer whose day-1 close is known before our entry.
  const prev = (evByCik.get(e.issuerCik) || []).filter((p) => p.publishedAt < T && p.accessionNo !== e.accessionNo && p.h?.[1]?.status === "ok"
    && e.entryDate && p.h[1].exitDate < e.entryDate && dnum(T) - dnum(p.publishedAt) <= 120).at(-1);
  return {
    burstN: n, prevOmFilings: om.length, daysSincePrevOm, memoryCoverDays: coverDays,
    omPrior30: w30.length, indepPrior30: indep.length, indepPeople30: indepPeople, repeatPrior30: repeat.length,
    buyerType30: w30.length === 0 ? "none" : indep.length ? "independent" : "repeat",
    prevAcc: prev?.accessionNo || null, prevPublishedAt: prev?.publishedAt || null, prevCls: prev ? filingClass[prev.accessionNo]?.cls || "unknown" : null,
    prevSameInsider: prev ? samePerson(me, { insiderCik: (pByAcc.get(prev.accessionNo) || [])[0]?.insiderCik, names: new Set(ownerNames((pByAcc.get(prev.accessionNo) || [])[0]?.insider).map(norm)) }) : null,
    prevPostOpen1: prev ? prev.h[1].excess : null, // previous filing: entry open → close of session 1, minus SPY (gross)
  };
}

const out = [];
for (const e of events) {
  const rows = pByAcc.get(e.accessionNo) || [];
  const fc = filingClass[e.accessionNo] || { cls: "unknown" };
  const base = { acc: e.accessionNo, issuer: e.issuerCik, ticker: e.ticker, publishedAt: e.publishedAt, tradeDate: e.tradeDate, priced: e.priceStatus === "ok",
    cls: fc.cls, omBasis: fc.omBasis || null, stated: fc.stated || null, isCeo: !!e.isCeo, isCfo: !!e.isCfo, isOfficer: !!e.isOfficer, role: e.role, roles: e.roles,
    rolesText: rows[0] ? [...rolesOfText(rows[0].role)] : [], plan10b5: rows.some((r) => r.plan), filingValue: e.filingValue, insider: e.insider };
  if (!rows.length) { out.push({ ...base, noRows: true }); continue; }
  const T = e.publishedAt;
  out.push({ ...base, ...conviction(e, rows, T), ...salesContext(e, rows, T), ...memory(e, rows, T) });
}
writeOut("event-features.json", out);
// Feature distributions (no outcomes)
const om = out.filter((x) => x.priced && x.cls === "om");
const q = (xs, p) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? r4(s[Math.floor(p * (s.length - 1))]) : null; };
const cnt = (xs, f) => xs.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(JSON.stringify({
  events: out.length, pricedOm: om.length,
  conv: { valid: cnt(om, (x) => x.convValid), firstPosition: cnt(om, (x) => x.firstPosition), priorNearZero: cnt(om, (x) => x.priorNearZero),
    posIncreaseQ: [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => q(om.map((x) => x.posIncrease), p)), ge10: om.filter((x) => x.posIncrease >= 0.1 || x.firstPosition).length,
    ceoCfo: om.filter((x) => x.isCeo || x.isCfo).length, ceoCfo10: om.filter((x) => (x.isCeo || x.isCfo) && (x.posIncrease >= 0.1 || x.firstPosition)).length,
    withOwnPrior: om.filter((x) => x.ownPriorFilings > 0).length, vsOwnQ: [0.25, 0.5, 0.75].map((p) => q(om.map((x) => x.valueVsOwnMedian), p)) },
  sales: { covered: cnt(om, (x) => x.salesCovered), othersSold: cnt(om.filter((x) => x.salesCovered), (x) => Math.min(x.othersSold90, 3)), selfSold: cnt(om.filter((x) => x.salesCovered), (x) => x.selfSold90),
    firstAfterSelling: cnt(om.filter((x) => x.salesCovered), (x) => x.firstBuyAfterSelling), netQ: [0.1, 0.25, 0.5, 0.75].map((p) => q(om.filter((x) => x.salesCovered).map((x) => x.netBalance90), p)) },
  memory: { burstN: cnt(om, (x) => Math.min(x.burstN, 5)), buyerType30: cnt(om, (x) => x.buyerType30), withPrev: om.filter((x) => x.prevAcc).length,
    daysSinceQ: [0.25, 0.5, 0.75].map((p) => q(om.map((x) => x.daysSincePrevOm), p)) },
}, null, 1));
