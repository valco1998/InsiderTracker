// server/services/backtest/ownerProfile.js
//
// REPORTING-OWNER PROFILES and TRACK RECORDS for the monthly per-buyer study (pure).
//
// Profile (legal layer: one SEC reporting-owner CIK): names used, entity type (heuristic,
// labelled), role at each issuer over time, issuers, reported purchases and sales, the last
// reported holding per issuer and ownership form (direct / indirect + nature), SEC links.
// Coverage limit: the Form 4 store keeps code P and S rows only — holdings-only rows, awards,
// option exercises and other codes are not stored, so "reported holdings" is the post-
// transaction balance of the latest stored P/S row, not a full position history.
//
// Track record = the outcomes of FOLLOWING this owner's monthly signals (publication-based
// entry, fixed exits) — not the owner's own profit and not the owner's portfolio. Nothing is
// assumed about later sales that were not reported.
//
// Economic groups: owners who appear together on any signal (joint filers / linked reports)
// form one group, so a fund and its manager are one row in the leaderboard (never summed
// twice). Profiles stay per CIK and show the group.
//
// Point-in-time selection ("follow buyers whose earlier signals worked"): at a signal's
// entry date only the same owner's EARLIER signals whose five-day window had already ended
// (exit date < entry date) are used. Owners are matched by shared legal CIK on those earlier
// signals only — no later filing can link them retroactively.

import { summarizeRule, ruleResult, TP_GRID } from "./exitRules.js";

const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);
const cikNum = (c) => (c == null || c === "" ? null : Number(c));
const ENTITY_RE = /\b(L\.?L\.?C|L\.?P|INC|CORP(ORATION)?|FUND|CAPITAL|PARTNERS|HOLDINGS?|MANAGEMENT|LTD|LIMITED|S\.?A|PLC|GROUP|COMPANY|BANK|FOUNDATION|SPV|ADVISORS?|INVESTMENTS?|VENTURES?|ASSOCIATES|AG|GMBH|N\.?V|B\.?V|PTE|PTY|SICAV|S\.?P\.?C)\b|\bco\.?$/i;
export function entityKind(name = "") {
  if (/\btrust\b|\btrustee\b|\bTR\b/i.test(name)) return "trust";
  if (ENTITY_RE.test(name)) return "entity";
  return "person";
}
const ownersOf = (r) => (r.owners?.length ? r.owners : [{ cik: r.insiderCik, name: r.insiderName, role: r.role }]);

export const DEFAULT_TRACK_RULE = Object.freeze({ kind: "tp", target: 0.04, horizon: 5 });
export const RANK_MIN = Object.freeze({ signals: 5, issuers: 2 });

// items: [{ sig, ev }] → track record of these signals (already selected for one owner/group).
export function trackRecordFor(items, { rule = DEFAULT_TRACK_RULE, min = RANK_MIN } = {}) {
  const sorted = [...items].sort((a, b) => a.sig.publishedAt.localeCompare(b.sig.publishedAt));
  const ok = sorted.filter((it) => it.ev?.status === "ok");
  const matured = ok.filter((it) => it.ev.completeDays >= 5);
  const issuer = (it) => it.sig.issuerCik;
  const closes = Object.fromEntries([1, 2, 3, 4, 5].map((k) => [k, summarizeRule(ok.filter((it) => it.ev.completeDays >= k).map((it) => ({ ret: it.ev.closes[k], issuer: issuer(it), spy: it.ev.spy?.[k] ?? null })), { costs: [0] })]));
  const tpAt = (t) => summarizeRule(matured.map((it) => { const x = ruleResult(it.ev, { kind: "tp", target: t, horizon: 5 }); return { ret: x?.ret ?? null, hit: x ? x.hit : null, daysToTarget: x?.daysToTarget ?? null, issuer: issuer(it) }; }), { costs: [0] });
  const strategy = summarizeRule(matured.map((it) => ({ ret: ruleResult(it.ev, rule)?.ret ?? null, issuer: issuer(it), spy: it.ev.spy?.[rule.horizon] ?? null })));
  const issuers = new Set(matured.map(issuer)).size;
  const eligible = matured.length >= min.signals && issuers >= min.issuers;
  return {
    signals: sorted.length, priced: ok.length, matured: matured.length, pending: sorted.filter((it) => it.ev?.status === "pending").length,
    notPriced: sorted.filter((it) => it.ev?.status === "na").length,
    notPricedReasons: sorted.filter((it) => it.ev?.status === "na").reduce((m, it) => { m[it.ev.naReason] = (m[it.ev.naReason] || 0) + 1; return m; }, {}),
    from: sorted[0]?.sig.publishedAt || null, to: sorted.at(-1)?.sig.publishedAt || null,
    issuers: new Set(sorted.map(issuer)).size,
    valueUsdAtSignals: Math.round(sorted.reduce((s, it) => s + (it.sig.valueUsdAtSignal || 0), 0)),
    closes, tp4: tpAt(0.04), tp65: tpAt(0.065),
    rule, strategy,
    rankEligible: eligible,
    sampleNote: eligible ? null : `Insufficient sample for ranking: ${matured.length} matured signal(s) at ${issuers} issuer(s); minimum ${min.signals} signals at ${min.issuers} issuers.`,
    signalsList: sorted.map((it) => ({
      id: it.sig.id, month: it.sig.month, ticker: it.sig.ticker, issuerName: it.sig.issuerName, publishedAt: it.sig.publishedAt, valueUsdAtSignal: it.sig.valueUsdAtSignal,
      purchaseTypes: it.sig.purchaseTypes, status: it.ev?.status, naReason: it.ev?.naReason || null, entryDate: it.ev?.entryDate || null,
      closes: it.ev?.closes || null, tp4: ruleResult(it.ev, { kind: "tp", target: 0.04, horizon: 5 }), tp65: ruleResult(it.ev, { kind: "tp", target: 0.065, horizon: 5 }),
    })),
  };
}

// Union-find over the legal owners of every signal → group id per owner key.
export function economicGroups(items) {
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  const keyOf = (o) => (o.cik ? `cik:${cikNum(o.cik)}` : `name:${String(o.name || "").toLowerCase()}`);
  for (const it of items) {
    const ks = (it.sig.legalOwners || []).map(keyOf);
    ks.forEach(add);
    for (let i = 1; i < ks.length; i++) { const a = find(ks[0]), b = find(ks[i]); if (a !== b) parent.set(a < b ? b : a, a < b ? a : b); }
  }
  return { groupOf: (it) => find(keyOf((it.sig.legalOwners || [])[0] || { name: it.sig.buyerName })), keyOf, find };
}

// Leaderboard rows per economic group, filtered. filters: { q, ticker, role, minUsd, from, to, type }
export function ownersList(items, filters = {}, opts = {}) {
  const f = filters;
  const keep = (it) => {
    const s = it.sig;
    if (f.ticker && String(s.ticker || "").toUpperCase() !== String(f.ticker).toUpperCase()) return false;
    if (f.role && !(s.roles || []).includes(f.role)) return false;
    if (f.minUsd && !(s.valueUsdAtSignal >= Number(f.minUsd))) return false;
    if (f.from && s.publishedAt.slice(0, 10) < f.from) return false;
    if (f.to && s.publishedAt.slice(0, 10) > f.to) return false;
    if (f.type && !(s.purchaseTypes || []).includes(f.type)) return false;
    return true;
  };
  const kept = items.filter(keep);
  const g = economicGroups(items); // groups from all signals (display grouping only)
  const by = new Map();
  for (const it of kept) { const k = g.groupOf(it); (by.get(k) || by.set(k, []).get(k)).push(it); }
  const q = String(f.q || "").toLowerCase();
  const rows = [];
  for (const [group, its] of by) {
    const owners = new Map();
    for (const it of its) for (const o of it.sig.legalOwners || []) owners.set(g.keyOf(o), { cik: o.cik, name: o.name });
    if (q && ![...owners.values()].some((o) => String(o.name || "").toLowerCase().includes(q) || String(o.cik || "").includes(q))) continue;
    const tr = trackRecordFor(its, opts);
    const { signalsList, ...summary } = tr;
    const primary = [...owners.values()][0];
    rows.push({ group, primaryCik: primary?.cik || null, name: its[0].sig.buyerName, kind: entityKind(its[0].sig.buyerName), owners: [...owners.values()], tickers: [...new Set(its.map((it) => it.sig.ticker).filter(Boolean))], ...summary });
  }
  rows.sort((a, b) => b.signals - a.signals || (b.strategy.mean ?? -9) - (a.strategy.mean ?? -9));
  return rows;
}

// Full profile of one reporting-owner CIK. rawRows: every stored raw report row (P and S,
// legal layer). items: evaluated study signals across the months held.
export function ownerProfile({ cik, rawRows, items, opts = {} }) {
  const n = cikNum(cik);
  const rows = rawRows.filter((r) => ownersOf(r).some((o) => cikNum(o.cik) === n));
  const mine = items.filter((it) => (it.sig.legalOwners || []).some((o) => cikNum(o.cik) === n));
  if (!rows.length && !mine.length) return null;
  const names = [...new Set(rows.flatMap((r) => ownersOf(r).filter((o) => cikNum(o.cik) === n).map((o) => o.name)).filter(Boolean))];
  const issuers = new Map();
  const sortKey = (r) => `${r.transactionDate || ""}|${String(r.acceptedAtET || "")}`;
  for (const r of [...rows].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
    const k = String(cikNum(r.issuerCik));
    const e = issuers.get(k) || { issuerCik: r.issuerCik, ticker: r.ticker || null, issuerName: r.issuerName || null, roles: [], purchases: { count: 0, shares: 0, valueReported: 0, valueRows: 0 }, sales: { count: 0, shares: 0, valueReported: 0, valueRows: 0 }, firstDate: r.transactionDate, lastDate: r.transactionDate, lastHolding: null, ownershipForms: new Set() };
    const me = ownersOf(r).find((o) => cikNum(o.cik) === n) || {};
    const role = me.role || r.role || "Not specified";
    const at = String(r.acceptedAtET || "").replace(/\s*ET$/, "");
    const lastRole = e.roles.at(-1);
    if (!lastRole || lastRole.role !== role) e.roles.push({ role, from: at.slice(0, 10), to: at.slice(0, 10) }); else lastRole.to = at.slice(0, 10);
    const side = r.code === "P" ? e.purchases : r.code === "S" ? e.sales : null;
    if (side) {
      side.count++; side.shares += Number(r.shares) || 0;
      const reliable = r.value > 0 && r.priceCheck?.status !== "anomaly";
      if (reliable) { side.valueReported += r.value; side.valueRows++; }
    }
    e.lastDate = r.transactionDate;
    if (r.ownership) e.ownershipForms.add(r.ownership);
    if (r.sharesOwnedAfter != null) e.lastHolding = { asOf: r.transactionDate, publishedAt: r.acceptedAtET || null, sharesOwnedAfter: r.sharesOwnedAfter, ownership: r.ownership || null, natureOfOwnership: r.natureOfOwnership || null, accessionNo: r.accessionNo };
    issuers.set(k, e);
  }
  const g = economicGroups(items);
  const group = g.find(`cik:${n}`);
  const groupItems = items.filter((it) => g.groupOf(it) === group);
  const groupOwners = new Map();
  for (const it of groupItems) for (const o of it.sig.legalOwners || []) groupOwners.set(g.keyOf(o), { cik: o.cik, name: o.name });
  return {
    cik: String(n).padStart(10, "0"),
    names,
    kind: entityKind(names[0] || ""),
    kindNote: "Person / entity / trust is inferred from the reported name — not an SEC field.",
    links: {
      secFilings: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(n).padStart(10, "0")}&type=4&dateb=&owner=include&count=40`,
      secSubmissions: `https://data.sec.gov/submissions/CIK${String(n).padStart(10, "0")}.json`,
    },
    coverage: "Stored SEC Form 4 code P and S rows only (no holdings-only rows, awards or other codes); history starts with the store (2025-12-01).",
    issuers: [...issuers.values()].map((e) => ({ ...e, ownershipForms: [...e.ownershipForms].sort(), purchases: { ...e.purchases, valueReported: Math.round(e.purchases.valueReported) }, sales: { ...e.sales, valueReported: Math.round(e.sales.valueReported) } }))
      .sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate))),
    transactions: [...rows].sort((a, b) => sortKey(b).localeCompare(sortKey(a))).slice(0, 300).map((r) => ({
      transactionDate: r.transactionDate, publishedAt: r.acceptedAtET || null, code: r.code, formType: r.formType || null, ticker: r.ticker || null, issuerName: r.issuerName || null,
      securityTitle: r.securityTitle || null, shares: r.shares ?? null, price: r.price ?? null, value: r.value ?? null, priceCheck: r.priceCheck?.status || null,
      ownership: r.ownership || null, natureOfOwnership: r.natureOfOwnership || null, sharesOwnedAfter: r.sharesOwnedAfter ?? null,
      coReporters: ownersOf(r).filter((o) => cikNum(o.cik) !== n).map((o) => o.name), accessionNo: r.accessionNo, url: r.filingUrl || null,
    })),
    transactionsTotal: rows.length,
    group: { id: group, owners: [...groupOwners.values()], note: "Owners who appear together on any signal (joint filers / linked reports) form one economic group; their signals are counted once." },
    trackRecord: trackRecordFor(mine, opts),
    groupTrackRecord: groupItems.length !== mine.length ? (({ signalsList, ...s }) => s)(trackRecordFor(groupItems, opts)) : null,
  };
}

// Walk-forward "follow buyers whose earlier signals worked" — strictly point in time.
// For each eligible signal (chronological by entry date): prior = earlier signals that share
// a legal CIK and whose day-5 exit date is BEFORE this entry date. Selected when
// prior.length ≥ minPrior and the prior mean of `rule` > minPriorMean.
export function pointInTimeSelection(items, { rule = DEFAULT_TRACK_RULE, minPrior = 1, minPriorMean = 0 } = {}) {
  const ok = items.filter((it) => it.ev?.status === "ok").sort((a, b) => a.ev.entryDate.localeCompare(b.ev.entryDate));
  const ciks = (it) => new Set((it.sig.legalOwners || []).map((o) => cikNum(o.cik)).filter((x) => x != null));
  const rows = { selected: [], notSelected: [], noHistory: [] };
  const detail = [];
  for (const it of ok) {
    const res = ruleResult(it.ev, rule);
    if (!res) continue; // this signal's own window is incomplete
    const mine = ciks(it);
    const prior = ok.filter((p) => p !== it && p.ev.completeDays >= 5 && p.ev.exitDates[5] < it.ev.entryDate && [...ciks(p)].some((c) => mine.has(c)));
    const priorRes = prior.map((p) => ruleResult(p.ev, rule)?.ret).filter((x) => x != null);
    const priorMean = priorRes.length ? priorRes.reduce((a, b) => a + b, 0) / priorRes.length : null;
    const row = { ret: res.ret, hit: res.hit, issuer: it.sig.issuerCik, spy: it.ev.spy?.[rule.horizon] ?? null };
    let bucket = "noHistory";
    if (priorRes.length >= minPrior) bucket = priorMean > minPriorMean ? "selected" : "notSelected";
    else if (priorRes.length) bucket = "notSelected";
    rows[bucket].push(row);
    detail.push({ id: it.sig.id, ticker: it.sig.ticker, buyer: it.sig.buyerName, entryDate: it.ev.entryDate, bucket, priorSignals: priorRes.length, priorMean: r6(priorMean), ret: res.ret });
  }
  return {
    rule, minPrior, minPriorMean,
    selected: summarizeRule(rows.selected), notSelected: summarizeRule(rows.notSelected), noHistory: summarizeRule(rows.noHistory),
    detail,
    note: "Earlier outcomes count only after their day-5 exit (before this entry). Owners are linked only by a CIK shared with those earlier signals.",
  };
}

export { TP_GRID };
