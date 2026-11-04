// deep2/behavior/classify.mjs — purchase classification v2 (row level → filing level). No returns are used here.
//   node scripts/research/deep2/behavior/classify.mjs
// Classes: om (true open-market, individual insider or personal vehicle) · offering (issuer-directed: offering,
// placement, subscription, IPO, plan/DRIP/ESPP, exchange/conversion) · entity (fund / corporate / managed-money buyer)
// · unknown. Point in time: same-price peer rows count only if accepted no later than the row itself; the trade-date
// bar is used only when it closed before the event's entry session.
import { loadSecRows, loadBars, loadEvents } from "../lib2.mjs";
import {
  writeOut, sym, dnum, rolesOfText, ownerNames, isEntityName, PERSONAL_RE, FUND_RE, FUND_ROLE_RE, OM_RE, OFFER_RE, PLAN_RE, OTHER_NONMARKET_RE,
  priceEvidence, isRoundPrice, decimalsOf,
} from "./common.mjs";

const sec = await loadSecRows();
const bars = loadBars();
const P = sec.rows.filter((r) => r.code === "P");
const events = loadEvents({ includeUnpriced: true }); // holdout hidden by lib2
const entryByAcc = new Map(events.map((e) => [e.accessionNo, e.entryDate || null]));

// Sentences that describe holdings or ownership structure rather than the reported transaction.
const NOTE_SENT_RE = /^(\s)*(includes?|including|total|this (amount|figure|total)|amount (of securities )?beneficially|the reporting person (also )?(holds|owns|disclaims)|consists of)|following the reported transaction|beneficially owned following|disclaims beneficial ownership|previously (acquired|reported|purchased)|acquired (prior|previously)|holds? (directly|indirectly) \d/i;
const txTextOf = (t) => String(t || "").split(/\s*\|\s*|(?<=\.)\s+(?=[A-Z(])/).filter((s) => !NOTE_SENT_RE.test(s)).join(" | ");

// Peer index: P rows by issuer for fixed-price detection.
const byCik = new Map();
for (const r of P) (byCik.get(r.cik) || byCik.set(r.cik, []).get(r.cik)).push(r);
const nameSet = (r) => new Set(ownerNames(r.insider).map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
function samePricePeers(r) {
  if (!(r.price > 0)) return 0;
  const mine = nameSet(r), d0 = dnum(r.tradeDate), who = new Set();
  for (const q of byCik.get(r.cik) || []) {
    if (q.acc === r.acc || q.insiderCik === r.insiderCik || !(q.price > 0)) continue;
    if (q.acceptedAt > r.acceptedAt) continue; // point in time
    if (Math.abs(dnum(q.tradeDate) - d0) > 7 || Math.abs(q.price - r.price) > 0.00051 || q.shares === r.shares) continue;
    if ([...nameSet(q)].some((n) => mine.has(n))) continue; // joint / related filers
    who.add(q.insiderCik);
  }
  return who.size;
}

export function classifyRow(r) {
  const text = [r.fn, r.remarks, r.nature].filter(Boolean).join(" | ");
  const tx = txTextOf([r.fn, r.remarks].filter(Boolean).join(" | "));
  const names = ownerNames(r.insider);
  const roles = rolesOfText(r.role);
  const officer = roles.has("CEO") || roles.has("CFO") || roles.has("Officer");
  const why = [];
  // --- who: individual (or personal vehicle) vs entity / managed money ---
  const firstEntity = isEntityName(names[0]);
  const anyEntity = names.some(isEntityName);
  const nature = String(r.nature || "");
  const natureFund = r.own === "I" && FUND_RE.test(nature) && !PERSONAL_RE.test(nature);
  const seeFn = r.own === "I" && /see|footnote|^\W*$|^-$|^_$/i.test(nature || "-");
  const fnFund = seeFn && FUND_RE.test(r.fn) && !PERSONAL_RE.test(r.fn) && /held (directly )?by|owned (directly )?by|for the account|on behalf of|accounts? (managed|advised)|clients/i.test(r.fn);
  let entity = false;
  if (firstEntity) { entity = true; why.push("filer is an entity"); }
  else if (anyEntity && !officer) { entity = true; why.push("joint filing with entities, no officer role"); }
  else if (natureFund) { entity = true; why.push(`held via fund-like vehicle: ${nature.slice(0, 50)}`); }
  else if (fnFund) { entity = true; why.push("footnote: held by fund / managed accounts"); }
  else if (FUND_ROLE_RE.test(r.role || "")) { entity = true; why.push(`fund-management role: ${String(r.role).slice(0, 40)}`); }
  // --- how: venue evidence ---
  const om = OM_RE.test(tx + " | " + nature);
  const plan = PLAN_RE.test(tx);
  const offer = OFFER_RE.test(tx);
  const other = OTHER_NONMARKET_RE.test(tx);
  const entryDate = entryByAcc.get(r.acc) || null;
  let px = priceEvidence(r, bars);
  if (px.bar && entryDate && px.bar.d >= entryDate) px = { status: "not_known_yet" };
  const round = isRoundPrice(r.price);
  const peers = samePricePeers(r);
  const ipoWindow = px.listingDays != null && Math.abs(px.listingDays) <= 10 && round && px.status !== "in";
  let venue, vwhy;
  if (plan) { venue = "plan"; vwhy = "plan text (DRIP/ESPP/401k/fees)"; }
  else if (offer && !(om && px.status === "in" && !round)) { venue = "offering"; vwhy = om ? "offering text (conflicts with market text)" : "offering text"; }
  else if (other && !om) { venue = "other_nonmarket"; vwhy = "exchange/conversion/merger text"; }
  else if (ipoWindow && !om) { venue = "offering"; vwhy = `round price within 10 days of a new listing (${px.listingDays}d)`; }
  else if (om) { venue = "market"; vwhy = offer ? "market text + in-range non-round price (offering text overruled)" : "market text"; }
  else if (px.status === "in") {
    if (round && peers >= 2) { venue = "offering"; vwhy = `round price shared with ${peers} other filers`; }
    else if (round && peers === 1) { venue = "unknown"; vwhy = "round in-range price shared with one other filer"; }
    else { venue = "market"; vwhy = "price inside the trade-date range"; }
  } else if (px.status === "below" || px.status === "above") {
    if (round || peers >= 1) { venue = "offering"; vwhy = `${px.status} the day's range with ${round ? "round price" : ""}${round && peers ? " and " : ""}${peers ? `${peers} same-price peer(s)` : ""}`; }
    else { venue = "unknown"; vwhy = `${px.status} the day's range, non-round`; }
  } else if (px.status === "no_bar_on_date") {
    if (px.beforeFirstBar) { venue = "unknown"; vwhy = "dated before the stock's first bar (pre-listing / OTC)"; }
    else if (round || peers >= 1) { venue = "offering"; vwhy = `${px.weekend ? "weekend" : "non-trading"} date with round/shared price`; }
    else { venue = "unknown"; vwhy = `${px.weekend ? "weekend" : "non-trading"} trade date`; }
  } else if (px.status === "edge") { venue = "unknown"; vwhy = "just outside the day's range (0.75–2%)"; }
  else { venue = "unknown"; vwhy = `no price evidence (${px.status})`; }
  let cls;
  if (venue === "plan" || venue === "offering" || venue === "other_nonmarket") cls = "offering";
  else if (entity) cls = "entity";
  else if (venue === "market") cls = "om";
  else cls = "unknown";
  return {
    cls, venue, vwhy, entity, ewhy: why.join("; ") || null, statedCtx: r.ctx, omText: om, offerText: offer, planText: plan, otherText: other,
    px: { status: px.status, vsLow: px.vsLow ?? null, vsHigh: px.vsHigh ?? null, vsClose: px.vsClose ?? null, factor: px.factor ?? null, ratio: px.ratio ?? null },
    round, decimals: decimalsOf(r.price), peers, officer, roles: [...roles],
  };
}

const rows = P.map((r) => ({ id: r.id, acc: r.acc, cik: r.cik, ticker: r.ticker, insiderCik: r.insiderCik, insider: r.insider, role: r.role,
  tradeDate: r.tradeDate, acceptedAt: r.acceptedAt, shares: r.shares, price: r.price, value: r.value, after: r.after, own: r.own, nature: r.nature,
  plan10b5: r.plan, amend: r.amend, dedupe: r.dedupe, priceCheck: r.priceCheck, ...classifyRow(r) }));

// Filing level: om only if every purchase row is om; else offering if any row is; else entity if any; else unknown.
const byAcc = new Map();
for (const x of rows) (byAcc.get(x.acc) || byAcc.set(x.acc, []).get(x.acc)).push(x);
const filing = {};
for (const [acc, xs] of byAcc) {
  const live = xs.filter((x) => x.amend !== "superseded");
  const use = live.length ? live : xs;
  const cs = use.map((x) => x.cls);
  const cls = cs.every((c) => c === "om") ? "om" : cs.includes("offering") ? "offering" : cs.includes("entity") ? "entity" : "unknown";
  const omBasis = cls !== "om" ? null : use.every((x) => x.omText) ? "text" : use.some((x) => x.omText) ? "text+price" : "price";
  filing[acc] = { cls, omBasis, rows: use.length, rowCls: cs, stated: [...new Set(use.map((x) => x.statedCtx))].join("+"), venue: [...new Set(use.map((x) => x.venue))].join("+") };
}

// Summaries
const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const evAcc = events.map((e) => e.accessionNo);
const evPriced = events.filter((e) => e.priceStatus === "ok").map((e) => e.accessionNo);
const summary = {
  builtAt: new Date().toISOString(),
  rows: { n: rows.length, byClass: count(rows, (x) => x.cls), byVenue: count(rows, (x) => x.venue), byPx: count(rows, (x) => x.px.status),
    classVsStated: count(rows, (x) => `${x.statedCtx} -> ${x.cls}`) },
  filingsInEvents: { n: evAcc.length, byClass: count(evAcc, (a) => filing[a]?.cls || "missing"), omBasis: count(evAcc.filter((a) => filing[a]?.cls === "om"), (a) => filing[a].omBasis) },
  filingsPriced: { n: evPriced.length, byClass: count(evPriced, (a) => filing[a]?.cls || "missing"), statedVsClass: count(evPriced, (a) => `${filing[a]?.stated} -> ${filing[a]?.cls}`) },
};
writeOut("rows-classified.json", rows);
writeOut("filing-class.json", filing);
writeOut("classification-summary.json", summary);
console.log(JSON.stringify(summary, null, 1));
