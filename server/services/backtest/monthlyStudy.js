// server/services/backtest/monthlyStudy.js
//
// MONTHLY PER-BUYER PURCHASE STUDY (research / backtesting only — pure, no I/O).
//
// Signal rule (user-defined, 2026-11-05):
//   For every calendar month M (America/New_York, by SEC ACCEPTANCE time), every economic
//   buyer B and every issuer I: B's cumulative Form 4 code-P purchase value at I, counted
//   ONLY from filings accepted in M and only from what was public at that moment, is
//   evaluated at each acceptance time T in M. The first T at which the sum exceeds the
//   threshold (default USD 1,000,000, strictly greater) is the signal. At most one signal
//   per (B, I, M). Trade dates can precede M (a late filing published in M counts in M).
//
// Point in time (shared with the cluster engine, signals.js): rows are known from their
// first public report; Form 4/A supersedes an original only from the amendment's
// acceptance; duplicate reports of one transaction by related filers count once (from
// the first report); identities are rebuilt from rows public at T. A Form 4/A that
// restates a purchase first published BEFORE M is a correction, not a new purchase in M.
//
// Two identity layers are kept: LEGAL (each reporting-owner CIK on the reports) and
// ECONOMIC (union-find of owners who report together / confirmed duplicate reports —
// insiderInsights.buildIdentities). Thresholds use the economic layer, so a fund and the
// manager who report the same purchase are counted once. Different CIKs with similar
// names are never merged.
//
// Nothing is excluded for the buyer's type or the purchase type: every code-P purchase is
// classified (open market, offering, private placement, 10b5-1 plan, trust/asset exchange,
// transfer, unknown) and the classification is shown and filterable — only the USD value
// rules below decide what adds to the sum.
//
// USD value per purchase (shares × reported price):
//   • missing / non-positive value                         → not counted (missing_price)
//   • intrinsic price anomaly or peer price outlier        → not counted (price_anomaly)
//   • a foreign currency stated by the filing (detectCurrency) → converted with a
//     documented reference rate (fx(code, tradeDate)); no rate → not counted (fx_unavailable)
//   • a foreign currency that cannot be identified          → not counted (currency_unknown)
// Uncounted purchases stay visible with their reason; they never become zero silently.

import { buildIdentities, ownerRoleGroups } from "../edgar/insiderInsights.js";
import { peerKey, peerOutlierDetail } from "../edgar/priceAnomalies.js";
import { currencyOf } from "../edgar/currency.js";
import { pointInTimeItems, identityRowAt, rowBacktestRoles } from "./signals.js";
import { etToUtcIso } from "./publicationStart.js";

export const STUDY_DEFAULTS = Object.freeze({
  thresholdUsd: 1_000_000,
  comparisonThresholdUsd: 10_000_000,
});

export const PURCHASE_TYPES = ["open_market", "plan_10b5_1", "offering", "private_placement", "trust_or_asset_exchange", "transfer", "unknown"];
export const PURCHASE_TYPE_LABELS = {
  open_market: "Open market (stated by the filing)",
  plan_10b5_1: "Rule 10b5-1 plan purchase",
  offering: "Public offering / IPO allocation",
  private_placement: "Private placement / direct purchase from the issuer",
  trust_or_asset_exchange: "Exchange of assets between related trusts/entities (code P, not necessarily new money)",
  transfer: "Transfer between related holders (code P, not necessarily new money)",
  unknown: "Not stated by the filing",
};

const round2 = (n) => Math.round(n * 100) / 100;
const stampOf = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? String(s).replace(/\s*ET$/, "") : null);
export const monthOf = (stamp) => (stamp ? String(stamp).slice(0, 7) : null);
const textOf = (r) => [...(r.footnotes || []).map((f) => f?.text || ""), r.remarks || "", r.natureOfOwnership || "", r.purchaseContextEvidence || ""].filter(Boolean).join(" \n ");
// Phrases that contain "exchange"/"transfer" without describing the transaction.
const NOISE_RE = /securities exchange act|exchange act of 1934|securities and exchange commission|stock exchange|exchange rate|nasdaq|new york stock exchange|tender offer/gi;

const EXCHANGE_RE = /substitut\w*[^.]{0,60}\bassets?\b|\bin exchange for\b|exchange of assets|asset swap|swap(ped)? (of )?(assets|shares)|power to substitute|exchanged? [^.]{0,60}\b(between|among)\b[^.]{0,60}\btrusts?\b/i;
const OFFERING_RE = /underwritten (public )?offering|public offering|initial public offering|\bIPO\b|registered direct|offering price|in the offering|concurrent (private )?(placement|offering)/i;
const PRIVATE_RE = /private placement|\bPIPE\b|securities purchase agreement|share purchase agreement|stock purchase agreement|subscription agreement|directly from the issuer|purchased from the issuer|issued by the issuer|rights offering/i;
const TRANSFER_RE = /\b(transferred|contributed|distributed|gifted)\b[^.]{0,80}\b(from|to|between|by)\b/i;
const PLAN_RE = /10b5-1/i;

// Purchase classification — LABEL ONLY, never an exclusion.
// → { type, isNewCapital, evidence }
export function classifyPurchase(r) {
  const raw = textOf(r);
  const text = raw.replace(NOISE_RE, " ");
  const ev = (re) => { const m = text.match(re); if (!m) return null; const i = Math.max(0, m.index - 60); return text.slice(i, m.index + m[0].length + 80).replace(/\s+/g, " ").trim(); };
  let e;
  if ((e = ev(EXCHANGE_RE))) return { type: "trust_or_asset_exchange", isNewCapital: false, evidence: e };
  if ((e = ev(OFFERING_RE))) return { type: "offering", isNewCapital: true, evidence: e };
  if ((e = ev(PRIVATE_RE))) return { type: "private_placement", isNewCapital: true, evidence: e };
  if (r.purchaseContext === "offering_or_private") return { type: "private_placement", isNewCapital: true, evidence: r.purchaseContextEvidence || null };
  if ((e = ev(TRANSFER_RE)) && !/\bpurchas/i.test(e)) return { type: "transfer", isNewCapital: false, evidence: e };
  if (r.is10b5_1 === true || (e = ev(PLAN_RE))) return { type: "plan_10b5_1", isNewCapital: true, evidence: e || "Form 4 Rule 10b5-1 checkbox" };
  if (r.purchaseContext === "open_market") return { type: "open_market", isNewCapital: true, evidence: r.purchaseContextEvidence || null };
  return { type: "unknown", isNewCapital: true, evidence: null };
}

// ISO code for currency mentions (currency.js CURRENCY_RE alternatives).
const CURRENCY_CODES = [
  [/^(cad|cdn|c\$)$|canadian dollar/i, "CAD"], [/^eur$|€|euro/i, "EUR"], [/^gbp$|£|pound/i, "GBP"],
  [/^(nis|ils)$|₪|shekel/i, "ILS"], [/^jpy$|¥|\byen\b/i, "JPY"], [/^chf$|swiss franc/i, "CHF"],
  [/^(aud|a\$)$|australian dollar/i, "AUD"], [/^hkd$/i, "HKD"], [/^sek$/i, "SEK"], [/^nok$/i, "NOK"], [/^dkk$/i, "DKK"],
  [/^inr$/i, "INR"], [/^(cny|rmb)$/i, "CNY"], [/^(brl|r\$)$|brazilian rea|\breais\b|\breals?\b/i, "BRL"], [/^mxn$|mexican peso/i, "MXN"],
  [/^krw$/i, "KRW"], [/^sgd$/i, "SGD"], [/^zar$|south african rand/i, "ZAR"], [/^nzd$/i, "NZD"], [/^twd$/i, "TWD"],
];
const CURRENCY_NAME_RE = /\b(CAD|CDN|EUR|GBP|NIS|ILS|JPY|CHF|AUD|HKD|SEK|NOK|DKK|INR|CNY|RMB|BRL|MXN|KRW|SGD|ZAR|NZD|TWD)\b|R\$|C\$|A\$|[€£₪¥]|canadian dollars?|euros?\b|pounds? sterling|israeli (new )?shekels?|\byen\b|swiss francs?|australian dollars?|south african rand|brazilian rea(is|ls?)|\breais\b|mexican pesos?/i;
const codeOf = (mention) => { const s = String(mention || "").trim(); for (const [re, c] of CURRENCY_CODES) if (re.test(s)) return c; return null; };

// Currency of the reported price. currency.js decides USD vs converted vs unverified; this
// adds the ISO code of an unverified mention and catches a footnote that states only a
// currency name (e.g. "Brazilian reais." attached to the price column), which currency.js
// treats as USD because no price wording is present.
// → { code: "USD"|ISO|null, basis: "form4"|"converted_to_usd"|"stated_foreign"|"unknown_foreign", note }
export function detectCurrency(r) {
  const c = currencyOf(r);
  if (c.basis === "converted_to_usd") return { code: "USD", basis: "converted_to_usd", note: c.note || null };
  if (c.basis === "unverified") {
    const code = codeOf(c.mentioned);
    return code ? { code, basis: "stated_foreign", note: c.note || null } : { code: null, basis: "unknown_foreign", note: c.note || null };
  }
  for (const f of r.footnotes || []) {
    const t = String(f?.text || "").trim();
    if (t.length > 80) continue; // a bare currency statement, not a sentence about something else
    const m = t.match(CURRENCY_NAME_RE);
    if (m) { const code = codeOf(m[0]); return code ? { code, basis: "stated_foreign", note: t } : { code: null, basis: "unknown_foreign", note: t }; }
  }
  return { code: "USD", basis: "form4", note: null };
}

// Does the reported security correspond to the listed series we would price? Evidence from
// the filing only (the price-scale check against bars is in exitRules.priceScaleCheck).
// → { status: "ok"|"uncertain", reasons: [] }
export function securityMatch(r) {
  const title = String(r.securityTitle || "");
  const reasons = [];
  const ticker = String(r.ticker || "").toUpperCase();
  if (!ticker) reasons.push("no_ticker");
  if (/preferred|preference|warrant|\bnotes?\b|debenture|\brights?\b|units?\b/i.test(title) && !/\.(U|WS|PR)/.test(ticker)) reasons.push("non_common_security_title");
  const local = title.match(/\b[A-Z]{4}\d{1,2}\b/); // a local-market code (e.g. BBDC4) different from the US listing
  if (local && local[0] !== ticker) reasons.push(`local_series_${local[0]}`);
  const cls = title.match(/\bclass\s+([a-z])\b/i);
  if (cls && (r.tickerSymbols?.length || 0) > 1) reasons.push(`class_${cls[1].toUpperCase()}_with_${r.tickerSymbols.length}_listed_series`);
  if (/ordinary shares?/i.test(title) && /depositary|\bads\b|\badr\b/i.test(String(r.issuerName || ""))) reasons.push("ordinary_vs_depositary");
  return { status: reasons.length ? "uncertain" : "ok", reasons };
}

// Reliable USD value of one purchase at time T (peers known then). fx(code, date) →
// { rate, rateDate, source } (USD per 1 unit) or null.
// A filer sometimes enters the AGGREGATE price in the per-share price column and says so in
// a footnote ("for an aggregate purchase price of US$2,272,653" with price 2272653). Then
// shares × price is meaningless and the stated aggregate is the value. Requires the
// footnote amount to equal the reported price (±0.5 %) — never inferred from size alone.
const AGGREGATE_RE = /aggregate (?:purchase )?(?:price|consideration)[^$\d]{0,30}(?:US)?\$\s?([\d,]+(?:\.\d+)?)/i;
const AGGREGATE_PRICE_RULES = new Set(["price_stated_as_aggregate", "implausible_per_share_price"]); // priceAnomalies.js rules
export function aggregatePriceStatement(r) {
  if (!(r.price > 0) || !(r.shares > 1)) return null;
  for (const f of r.footnotes || []) {
    const m = String(f?.text || "").match(AGGREGATE_RE);
    if (!m) continue;
    const amount = Number(m[1].replace(/,/g, ""));
    if (amount > 0 && Math.abs(amount - r.price) / amount <= 0.005) return { valueUsd: amount, note: String(f.text).slice(0, 240) };
  }
  return null;
}

function usdValue(r, knownPeers, fx) {
  if (r.value == null || !(r.value > 0)) return { usd: null, reason: "missing_price", currency: null };
  // A stated aggregate equal to the reported price is the reliable value (below), so the price-check
  // rules that only say "this price is an aggregate" do not exclude such a row here.
  const statedAgg = aggregatePriceStatement(r);
  const intrinsic = (r.priceCheck?.reasons || []).filter((x) => x.rule !== "peer_price_outlier" && x.rule !== "currency_unverified"
    && !(statedAgg && AGGREGATE_PRICE_RULES.has(x.rule)));
  if (intrinsic.length) return { usd: null, reason: "price_anomaly", currency: null };
  const cur = detectCurrency(r);
  if (cur.code == null) return { usd: null, reason: "currency_unknown", currency: cur };
  const agg = cur.code === "USD" ? aggregatePriceStatement(r) : null;
  if (agg) return { usd: agg.valueUsd, reason: null, currency: { ...cur, basis: "aggregate_price_in_price_column", note: agg.note } };
  let usd = r.value, conv = null;
  if (cur.code !== "USD") {
    const q = fx ? fx(cur.code, r.transactionDate) : null;
    if (!q || !(q.rate > 0)) return { usd: null, reason: "fx_unavailable", currency: cur };
    usd = r.value * q.rate;
    conv = { from: cur.code, rate: q.rate, rateDate: q.rateDate, source: q.source };
  }
  // Peer outlier check only among peers in the same currency basis (as reported).
  if (cur.code === "USD" && peerOutlierDetail(r, knownPeers)) return { usd: null, reason: "price_anomaly", currency: cur };
  return { usd, reason: null, currency: cur, fx: conv };
}

// Every foreign-currency (code, trade date) pair that a run needs — fetched by the caller
// before detectMonthlySignals (which stays synchronous and pure).
export function fxNeeds(rows, months) {
  const set = new Set(months);
  const out = new Map();
  for (const r of rows) {
    if (r.code !== "P" || !set.has(monthOf(stampOf(r.acceptedAtET)))) continue;
    const c = detectCurrency(r);
    if (c.code && c.code !== "USD" && r.transactionDate) out.set(`${c.code}|${r.transactionDate}`, { code: c.code, date: r.transactionDate });
  }
  return [...out.values()];
}

const ownersOf = (r) => (r.owners?.length ? r.owners : [{ cik: r.insiderCik, name: r.insiderName, role: r.role }]);
const ownerKey = (o) => (o.cik ? `cik:${Number(o.cik)}` : o.name ? `name:${String(o.name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}` : null);

// One purchase as stored in a signal / the examined-rows audit list.
function purchaseRecord(x, v, cls, extra = {}) {
  const r = x.r;
  return {
    rowId: r.id, accessionNo: r.accessionNo || null, formType: r.formType || null, url: r.filingUrl || null,
    issuerCik: r.issuerCik || null, ticker: r.ticker || null,
    owners: ownersOf(r).map((o) => ({ cik: o.cik || null, name: o.name || null, role: o.role || null })),
    reportedBy: (r.reportedBy || []).map((rep) => ({ accessionNo: rep.accessionNo, insiderName: rep.insiderName || null })),
    securityTitle: r.securityTitle || null, transactionDate: r.transactionDate, publishedAt: `${x.firstKnownAt} ET`,
    shares: r.shares ?? null, price: r.price ?? null, valueReported: r.value ?? null,
    currency: v.currency?.code ?? null, currencyBasis: v.currency?.basis ?? null, currencyNote: v.currency?.note ?? null, fx: v.fx || null,
    valueUsd: v.usd == null ? null : round2(v.usd), valueExcludedReason: v.reason,
    ownership: r.ownership || null, natureOfOwnership: r.natureOfOwnership || null,
    purchaseType: cls.type, isNewCapital: cls.isNewCapital, purchaseEvidence: cls.evidence,
    is10b5_1: r.is10b5_1 ?? null, sharesOwnedAfter: r.sharesOwnedAfter ?? null,
    footnotes: (r.footnotes || []).map((f) => String(f?.text || "").slice(0, 600)),
    amends: r.amendment?.status === "amends" ? r.amendment.original || null : null,
    possibleDuplicate: r.dedupe?.status === "needs_review",
    ...extra,
  };
}

// rows: economic rows (snapshot.economic). months: ["YYYY-MM", ...].
// → { signals, examined, stats }
//   signals   one per (economic buyer, issuer, month) whose month sum crossed the threshold
//   examined  EVERY code-P purchase first published in the months, with its USD status,
//             classification and whether it belongs to a signal (audit trail)
export function detectMonthlySignals({
  rows, acceptedAtByAccession = new Map(), reportOwners = null, reportRow = null,
  months = [], thresholdUsd = STUDY_DEFAULTS.thresholdUsd, fx = null,
}) {
  const monthSet = new Set(months);
  const stats = { rowsWithoutAcceptance: 0, versionedGroups: 0, issuers: 0, purchases: 0, correctionsOfEarlierMonths: 0, notCounted: {} };
  const byIssuer = pointInTimeItems({ rows, acceptedAtByAccession, reportRow, stats });
  const signals = [];
  const examined = new Map(); // rowId|month → record

  const acceptedOf = (acc) => stampOf(acceptedAtByAccession.get(acc));
  for (const [cik, items] of byIssuer) {
    const buys = items.filter((x) => x.r.code === "P");
    if (!buys.length) continue;
    // A row counts in month M when it was first published in M. A Form 4/A restating a
    // purchase whose original was published before M is a correction of that earlier
    // month, not a new purchase in M (it supersedes the original from its acceptance).
    const monthOfItem = (x) => {
      const m = monthOf(x.firstKnownAt);
      if (x.r.amendment?.status === "amends" && x.r.amendment.original) {
        const o = acceptedOf(x.r.amendment.original);
        if (o && monthOf(o) < m) return { month: m, correctionOf: monthOf(o) };
      }
      return { month: m, correctionOf: null };
    };
    const inScope = buys.filter((x) => monthSet.has(monthOf(x.firstKnownAt)) || monthSet.has(monthOf(x.knownAt)));
    if (!inScope.length) continue;
    stats.issuers++;
    for (const M of months) {
      const events = [...new Set(buys.filter((x) => monthOf(x.knownAt) === M).map((x) => x.knownAt))].sort();
      if (!events.length) continue;
      const signaledKeys = new Set(); // owner keys of buyers who already signalled at this issuer in M
      for (const T of events) {
        const known = items.filter((x) => x.knownAt <= T && (!x.validUntil || x.validUntil > T));
        const identities = buildIdentities(known.map((x) => identityRowAt(x.r, T, reportOwners, acceptedAtByAccession)));
        const peersByKey = new Map();
        for (const x of known) { const pk = peerKey(x.r); if (pk) (peersByKey.get(pk) || peersByKey.set(pk, []).get(pk)).push(x.r); }
        const people = new Map(); // person → { usd, items: [{x, v, cls}], ownerKeys }
        for (const x of known) {
          if (x.r.code !== "P") continue;
          const mo = monthOfItem(x);
          if (mo.month !== M) continue;
          const v = usdValue(x.r, peersByKey.get(peerKey(x.r)) || [], fx);
          const cls = classifyPurchase(x.r);
          const counted = v.usd != null && !mo.correctionOf;
          const reason = mo.correctionOf ? "correction_of_earlier_month" : v.reason;
          // Audit list: the latest view of each purchase in M (overwritten as T advances).
          examined.set(`${x.r.id}|${M}`, purchaseRecord(x, { ...v, reason, usd: counted ? v.usd : null }, cls, { month: M, signalId: null, correctionOf: mo.correctionOf }));
          if (!counted) continue;
          const person = identities.personOf(identityRowAt(x.r, T, reportOwners, acceptedAtByAccession)) || `row:${x.r.id}`;
          let p = people.get(person);
          if (!p) { p = { usd: 0, items: [], ownerKeys: new Set() }; people.set(person, p); }
          p.usd += v.usd;
          p.items.push({ x, v, cls });
          for (const o of ownersOf(identityRowAt(x.r, T, reportOwners, acceptedAtByAccession))) { const k = ownerKey(o); if (k) p.ownerKeys.add(k); }
        }
        for (const [person, p] of people) {
          if (!(p.usd > thresholdUsd)) continue;
          if ([...p.ownerKeys].some((k) => signaledKeys.has(k))) continue; // already signalled in M (identity may have grown)
          for (const k of p.ownerKeys) signaledKeys.add(k);
          const crossing = p.items.filter((it) => it.x.knownAt === T);
          const sig = buildSignal({ cik, M, T, person, p, crossing, thresholdUsd });
          signals.push(sig);
          for (const it of p.items) { const e = examined.get(`${it.x.r.id}|${M}`); if (e && !e.signalId) e.signalId = sig.id; }
        }
      }
    }
  }
  const examinedList = [...examined.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || String(a.rowId).localeCompare(String(b.rowId)));
  stats.purchases = examinedList.length;
  for (const e of examinedList) if (e.valueExcludedReason) stats.notCounted[e.valueExcludedReason] = (stats.notCounted[e.valueExcludedReason] || 0) + 1;
  stats.correctionsOfEarlierMonths = stats.notCounted.correction_of_earlier_month || 0;
  signals.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.issuerCik.localeCompare(b.issuerCik) || a.id.localeCompare(b.id));
  return { signals, examined: examinedList, stats };
}

function buildSignal({ cik, M, T, person, p, crossing, thresholdUsd }) {
  const purchases = p.items.map((it) => purchaseRecord(it.x, it.v, it.cls)).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.transactionDate.localeCompare(b.transactionDate));
  // Display name: the owner on the largest purchase (the economic buyer can be several legal filers).
  const top = [...p.items].sort((a, b) => b.v.usd - a.v.usd)[0];
  const r0 = top.x.r;
  const legal = new Map();
  for (const it of p.items) for (const o of ownersOf(it.x.r)) {
    const k = ownerKey(o); if (!k) continue;
    const e = legal.get(k) || { cik: o.cik || null, name: o.name || null, roles: new Set() };
    for (const g of ownerRoleGroups(o)) e.roles.add(g);
    legal.set(k, e);
  }
  const roles = [...new Set(p.items.flatMap((it) => rowBacktestRoles(it.x.r)))];
  const typeUsd = {};
  for (const it of p.items) typeUsd[it.cls.type] = round2((typeUsd[it.cls.type] || 0) + it.v.usd);
  const tradeDates = p.items.map((it) => it.x.r.transactionDate).sort();
  const sharesUsdPriced = p.items.filter((it) => it.x.r.shares > 0);
  const shares = sharesUsdPriced.reduce((s, it) => s + it.x.r.shares, 0);
  const usdSum = sharesUsdPriced.reduce((s, it) => s + it.v.usd, 0);
  const ownership = [...new Set(p.items.map((it) => it.x.r.ownership).filter(Boolean))].sort();
  return {
    id: `${String(cik).padStart(10, "0")}:${person}:${M}`,
    month: M,
    issuerCik: String(cik).padStart(10, "0"),
    ticker: r0.ticker || null,
    tickerSymbols: r0.tickerSymbols || (r0.ticker ? [r0.ticker] : []),
    issuerName: r0.issuerName || null,
    buyerId: person,
    buyerName: r0.owners?.[0]?.name || r0.insiderName || "Unknown",
    legalOwners: [...legal.values()].map((o) => ({ ...o, roles: [...o.roles] })),
    roles,
    ownership, // D / I
    publishedAt: `${T} ET`,
    publishedIso: etToUtcIso(`${T} ET`),
    crossingAccessions: [...new Set(crossing.map((it) => it.x.r.accessionNo))],
    thresholdUsd,
    valueUsdAtSignal: round2(p.usd),
    purchasesAtSignal: purchases.length,
    tradeDateFrom: tradeDates[0], tradeDateTo: tradeDates[tradeDates.length - 1],
    tradedBeforeMonth: tradeDates[0] < `${M}-01`,
    // Average reported purchase price in USD (as traded, NOT split-adjusted) over the purchases known at T.
    insiderAvgPriceUsd: shares > 0 ? Math.round((usdSum / shares) * 1e6) / 1e6 : null,
    purchaseTypes: Object.keys(typeUsd).sort(),
    valueUsdByType: typeUsd,
    newCapitalShare: round2(p.items.filter((it) => it.cls.isNewCapital).reduce((s, it) => s + it.v.usd, 0) / p.usd),
    securityTitle: r0.securityTitle || null,
    securityMatch: securityMatch(r0),
    currencies: [...new Set(purchases.map((q) => q.currency).filter(Boolean))],
    possibleDuplicatePurchases: purchases.filter((q) => q.possibleDuplicate).length,
    purchases, // frozen snapshot as public at T (never updated later)
  };
}
