// deep3/dataquality/secAudit.mjs — SEC-side inventory and quality audit (READ-ONLY, no network).
//   node --max-old-space-size=6144 scripts/research/deep3/dataquality/secAudit.mjs
// Inputs: the history store via lib.loadSec() (the same pipeline that built sec-rows / stage C), lib2.loadSecRows(),
//         lib2.loadEvents() (non-holdout stage-C events ONLY; holdout membership is reproduced from SEC rows, never read),
//         deep2 classification v2 (filing-class.json).
// Outputs (.cache/research/deep3/dataquality/): sec-audit.json, p-filings.json (one row per purchase filing; checkpoint).
import fs from "node:fs";
import path from "node:path";
import { loadSec } from "../../lib.mjs";
import { loadSecRows, loadEvents, periodOf, DISCOVER_END, HOLDOUT_START } from "../../deep2/lib2.mjs";
import { buildIdentities } from "../../../../services/edgar/insiderInsights.js";
import { isBusinessDay } from "../../../../services/edgar/businessDays.js";
import { isSession, closeTime } from "../../../../services/backtest/sessionCalendar.js";

const OUT = path.join(process.cwd(), ".cache", "research", "deep3", "dataquality");
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now(); const log = (m) => console.log(`[DQ-SEC ${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const inc = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; return m; };
const cnt = (arr, f) => arr.reduce((m, x) => inc(m, f(x)), {});
const DAY = 86_400_000, dnum = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);
const stamp = (s) => String(s || "").replace(/\s*ET$/, "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ownerKey = (o) => (o.cik ? `cik:${Number(o.cik)}` : o.name ? `name:${normName(o.name)}` : null);
const ownersOf = (r) => (r.owners?.length ? r.owners : [{ cik: r.insiderCik, name: r.insiderName, role: r.role }]);
const periodOfDate = (d) => (d < DISCOVER_END ? "discover" : d < HOLDOUT_START ? "confirm" : "holdout");
// Publication window of an acceptance stamp "YYYY-MM-DD HH:MM:SS" (ET).
function windowOf(T) {
  const d = T.slice(0, 10), t = T.slice(11);
  if (!isSession(d)) return "non_session_day";
  if (t < "04:00:00") return "overnight_00_04";
  if (t < "09:30:00") return "premarket_04_0930";
  if (t < closeTime(d)) return "regular_session";
  if (t < "20:00:00") return "after_close_to_20";
  return "evening_20_24";
}

// ---------------- load ----------------
log("loading SEC snapshot (read-only store)");
const s = loadSec();
const raw = s.snap.raw.filter((r) => r.code === "P" || r.code === "S");
const econ = s.snap.economic.filter((r) => r.code === "P" || r.code === "S");
const accMap = s.acc;
log(`raw P/S rows ${raw.length}, economic ${econ.length}`);
const sec = await loadSecRows();
log(`sec-rows ${sec.rows.length} (built ${sec.builtAt})`);
const evNH = loadEvents({ includeUnpriced: true }); // non-holdout only (lib2 leak guard)
log(`stage-C non-holdout events ${evNH.length}`);
const filingClass = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".cache", "research", "deep2", "behavior", "filing-class.json"), "utf8"));

// ---------------- 1. rows, filings, codes ----------------
const byCode = (rows) => ({ P: rows.filter((r) => r.code === "P").length, S: rows.filter((r) => r.code === "S").length });
const filingsOf = (rows) => new Set(rows.map((r) => r.accessionNo));
const rawP = raw.filter((r) => r.code === "P"), rawS = raw.filter((r) => r.code === "S");
const econP = econ.filter((r) => r.code === "P"), econS = econ.filter((r) => r.code === "S");
const rawPAcc = filingsOf(rawP), econPAcc = filingsOf(econP);
const mergedAwayP = [...rawPAcc].filter((a) => !econPAcc.has(a));
const secPAcc = new Set(sec.rows.filter((r) => r.code === "P").map((r) => r.acc));
const consistency = {
  secRowsVsSnapshotEconomic: { secRowsP: sec.rows.filter((r) => r.code === "P").length, econP: econP.length, secRowsS: sec.rows.filter((r) => r.code === "S").length, econS: econS.length,
    secPFilings: secPAcc.size, econPFilings: econPAcc.size, sameAccessionSet: secPAcc.size === econPAcc.size && [...secPAcc].every((a) => econPAcc.has(a)) },
};

// ---------------- 2. dedupe, amendments, price checks, ownership, coverage ----------------
const reasonsOf = (rows) => { const m = {}; for (const r of rows) for (const x of r.priceCheck?.reasons || []) inc(m, x.rule || "?"); return m; };
const natureCat = (n) => {
  const t = String(n || "").toLowerCase();
  if (!t || t === "-") return "none";
  if (/see (footnote|note)|footnote|^\(?\d+\)?$|^f\d/.test(t)) return "see footnote";
  if (/spouse|wife|husband/.test(t)) return "spouse";
  if (/child|son|daughter|minor|ugma|utma|custodian/.test(t)) return "children / custodian";
  if (/ira|401|roth|retirement|pension|sep\b|keogh/.test(t)) return "retirement account";
  if (/trust|trustee/.test(t)) return "trust";
  if (/fund|l\.?p\.?\b|partners|capital|management|advisors|investment|holdings|llc|l\.l\.c|ltd|inc\b|corp|company/.test(t)) return "fund / entity vehicle";
  if (/foundation|charit/.test(t)) return "foundation";
  return "other";
};
function ownershipBlock(rows) {
  const f = new Map(); for (const r of rows) { const a = f.get(r.accessionNo) || f.set(r.accessionNo, new Set()).get(r.accessionNo); a.add(r.ownership || "?"); }
  const filingMix = cnt([...f.values()], (set) => (set.size > 1 ? "mixed" : [...set][0]));
  const ind = rows.filter((r) => r.ownership === "I");
  return { rows: cnt(rows, (r) => r.ownership || "missing"), filings: filingMix, indirectNature: cnt(ind, (r) => natureCat(r.natureOfOwnership)),
    topIndirectNatureTexts: Object.entries(cnt(ind, (r) => String(r.natureOfOwnership || "").slice(0, 40))).sort((a, b) => b[1] - a[1]).slice(0, 20) };
}
const cov = (rows) => ({ rows: rows.length, holdingsAfter: rows.filter((r) => r.sharesOwnedAfter != null).length, footnotes: rows.filter((r) => (r.footnotes || []).length > 0).length,
  remarks: rows.filter((r) => r.remarks).length, plan10b5_1: cnt(rows, (r) => String(r.is10b5_1)), price: rows.filter((r) => r.price > 0).length, value: rows.filter((r) => r.value > 0).length,
  shares: rows.filter((r) => r.shares > 0).length, natureOfOwnership: rows.filter((r) => r.natureOfOwnership).length, late: rows.filter((r) => r.filingDelay?.late).length });
const quality = {
  dedupe: { P: cnt(econP, (r) => r.dedupe?.status || "none"), S: cnt(econS, (r) => r.dedupe?.status || "none"),
    reportedByP: cnt(econP, (r) => String(r.reportedBy?.length || 1)), reportedByS: cnt(econS, (r) => String(r.reportedBy?.length || 1)),
    rawMergedAwayRows: { P: rawP.length - econP.length, S: rawS.length - econS.length },
    pFilingsWhoseRowsAllMergedIntoAnotherFiling: mergedAwayP.length },
  amendments: { econP: cnt(econP, (r) => r.amendment?.status || "none"), econS: cnt(econS, (r) => r.amendment?.status || "none"),
    form4A: { econPRows: econP.filter((r) => r.formType === "4/A").length, econPFilings: filingsOf(econP.filter((r) => r.formType === "4/A")).size, amendmentFilingsInStore: s.ds.amendmentFilings.length } },
  priceChecks: { P: cnt(econP, (r) => r.priceCheck?.status || "none"), S: cnt(econS, (r) => r.priceCheck?.status || "none"), reasonsP: reasonsOf(econP), reasonsS: reasonsOf(econS),
    missingPriceP: econP.filter((r) => !(r.price > 0)).length, zeroOrMissingValueP: econP.filter((r) => !(r.value > 0)).length },
  ownership: { P: ownershipBlock(econP), S: ownershipBlock(econS) },
  coverage: { P: cov(econP), S: cov(econS) },
  venueP: cnt(econP, (r) => r.purchaseContext || "unspecified"),
};

// ---------------- 3. dates: transaction vs acceptance; publication windows ----------------
const dateChecks = (rows) => {
  const out = { invalidTradeDate: 0, afterAcceptance: [], over2y: 0, over2yFilings: new Set(), over1y: 0, earliest: [], byLagBucket: {} };
  for (const r of rows) {
    const A = stamp(r.acceptedAtET).slice(0, 10);
    if (!ISO.test(r.transactionDate || "")) { out.invalidTradeDate++; continue; }
    const lag = dnum(A) - dnum(r.transactionDate);
    if (lag < 0) out.afterAcceptance.push({ acc: r.accessionNo, code: r.code, ticker: r.ticker, tradeDate: r.transactionDate, acceptedAt: stamp(r.acceptedAtET), form: r.formType });
    if (lag > 730) { out.over2y++; out.over2yFilings.add(r.accessionNo); }
    if (lag > 365) out.over1y++;
    inc(out.byLagBucket, lag < 0 ? "<0" : lag <= 2 ? "0-2d" : lag <= 5 ? "3-5d" : lag <= 30 ? "6-30d" : lag <= 365 ? "31-365d" : lag <= 730 ? "1-2y" : ">2y");
  }
  out.over2yFilings = out.over2yFilings.size;
  out.earliest = [...rows].filter((r) => ISO.test(r.transactionDate || "")).sort((a, b) => a.transactionDate.localeCompare(b.transactionDate)).slice(0, 15)
    .map((r) => ({ acc: r.accessionNo, code: r.code, ticker: r.ticker, tradeDate: r.transactionDate, acceptedAt: stamp(r.acceptedAtET), form: r.formType, amendment: r.amendment?.status || null }));
  return out;
};
const dates = { P: dateChecks(econP), S: dateChecks(econS),
  acceptanceRange: (() => { const a = econ.map((r) => stamp(r.acceptedAtET)).filter(Boolean).sort(); return [a[0], a.at(-1)]; })(),
  tradeDateRange: (() => { const a = econ.map((r) => r.transactionDate).filter((d) => ISO.test(d || "")).sort(); return [a[0], a.at(-1)]; })(),
  acceptanceRangeInStoreWindow: (() => { const a = econ.map((r) => stamp(r.acceptedAtET)).filter((x) => x >= "2025-12-01").sort(); return [a[0], a.at(-1)]; })(),
  acceptedBeforeStoreWindow: econ.filter((r) => stamp(r.acceptedAtET) < "2025-12-01").map((r) => ({ acc: r.accessionNo, code: r.code, ticker: r.ticker, acceptedAt: stamp(r.acceptedAtET), tradeDate: r.transactionDate, filingDate: r.filingDate })) };

// ---------------- 4. identities: reporting owners vs people ----------------
log("identities");
const ownerKeysAll = new Set(), ownerKeysP = new Set(), firstCikP = new Set(), firstCikAll = new Set();
const nameToCiks = new Map(), cikToNames = new Map();
let multiOwnerRowsP = 0, multiOwnerRowsS = 0; const multiOwnerFilingsP = new Set(), ownersPerFilingP = {};
for (const r of raw) {
  const os = ownersOf(r);
  if (os.length > 1) { if (r.code === "P") { multiOwnerRowsP++; multiOwnerFilingsP.add(r.accessionNo); } else multiOwnerRowsS++; }
  for (const o of os) {
    const k = ownerKey(o); if (!k) continue; ownerKeysAll.add(k); if (r.code === "P") ownerKeysP.add(k);
    if (o.cik && o.name) {
      const n = normName(o.name), c = Number(o.cik);
      (nameToCiks.get(n) || nameToCiks.set(n, new Set()).get(n)).add(c);
      (cikToNames.get(c) || cikToNames.set(c, new Set()).get(c)).add(n);
    }
  }
  if (r.insiderCik) { firstCikAll.add(Number(r.insiderCik)); if (r.code === "P") firstCikP.add(Number(r.insiderCik)); }
}
for (const a of multiOwnerFilingsP) { const r = rawP.find((x) => x.accessionNo === a); inc(ownersPerFilingP, String(ownersOf(r).length)); }
const reportOwners = (rowId) => s.snap.rawById.get(rowId)?.owners;
const idsAll = buildIdentities(econ, { reportOwners }), idsAllNoDup = buildIdentities(raw);
const peopleAll = new Set(econ.map((r) => idsAll.personOf(r)).filter(Boolean)), peopleP = new Set(econP.map((r) => idsAll.personOf(r)).filter(Boolean));
const peoplePNoDup = new Set(rawP.map((r) => idsAllNoDup.personOf(r)).filter(Boolean));
const sameNameMultiCik = [...nameToCiks.entries()].filter(([, c]) => c.size > 1);
const sameCikMultiName = [...cikToNames.entries()].filter(([, n]) => n.size > 1);
// persons (union-find) that span several CIKs
const personCiks = new Map();
for (const r of econ) { const p = idsAll.personOf(r); if (!p) continue; const set = personCiks.get(p) || personCiks.set(p, new Set()).get(p); for (const o of ownersOf(r)) if (o.cik) set.add(Number(o.cik)); for (const rep of r.reportedBy || []) for (const o of reportOwners(rep.rowId) || []) if (o.cik) set.add(Number(o.cik)); }
const personSizes = cnt([...personCiks.values()], (x) => (x.size >= 10 ? "10+" : String(x.size)));
const identities = {
  rule: "person = union-find of reporting-owner keys (CIK, else normalized name) that co-report on a Form 4, plus owners of CONFIRMED duplicate reports (services/edgar/insiderInsights.buildIdentities with reportOwners) — the backtest/app rule",
  reportingOwnersAllPS: ownerKeysAll.size, reportingOwnersP: ownerKeysP.size, firstListedOwnerCiksAll: firstCikAll.size, firstListedOwnerCiksP: firstCikP.size,
  peopleAll: peopleAll.size, peopleP: peopleP.size, peoplePWithoutDuplicateLinks: peoplePNoDup.size,
  jointFilings: { pRowsWithSeveralOwners: multiOwnerRowsP, sRowsWithSeveralOwners: multiOwnerRowsS, pFilingsWithSeveralOwners: multiOwnerFilingsP.size, ownersPerJointPFiling: ownersPerFilingP },
  personsByCikCount: personSizes,
  sameNormalizedNameSeveralCiks: { count: sameNameMultiCik.length, examples: sameNameMultiCik.slice(0, 15).map(([n, c]) => ({ name: n, ciks: [...c] })) },
  sameCikSeveralNames: { count: sameCikMultiName.length, examples: sameCikMultiName.slice(0, 15).map(([c, n]) => ({ cik: c, names: [...n] })) },
};

// ---------------- 5. buyer counting under different identity rules (ownership structures) ----------------
// Unit: issuer × trade-date month, purchase rows not superseded by an amendment.
log("buyer-count rules");
const live = (r) => r.amendment?.status !== "superseded";
const monthOf = (r) => (r.transactionDate || "").slice(0, 7);
const entityAcc = new Set(Object.entries(filingClass).filter(([, f]) => f.cls === "entity").map(([a]) => a));
const rules = {
  r1_filings: { rows: rawP.filter(live), key: (r) => r.accessionNo },
  r2_firstOwnerCik: { rows: rawP.filter(live), key: (r) => (r.insiderCik ? `cik:${Number(r.insiderCik)}` : `name:${normName(r.insiderName)}`) },
  r3_everyCoReportingOwner: { rows: rawP.filter(live), keys: (r) => ownersOf(r).map(ownerKey).filter(Boolean) },
  r4_unionFindCoReporting: { rows: rawP.filter(live), key: (r) => idsAllNoDup.personOf(r) },
  r5_appRule_withConfirmedDuplicates: { rows: econP.filter(live), key: (r) => idsAll.personOf(r) },
  r6_appRule_excludingEntityFilings: { rows: econP.filter(live).filter((r) => !entityAcc.has(r.accessionNo)), key: (r) => idsAll.personOf(r) },
};
const buyerCounts = {}, perIssuerMonth = {};
for (const [name, rule] of Object.entries(rules)) {
  const m = new Map();
  for (const r of rule.rows) { const k = `${Number(r.issuerCik)}|${monthOf(r)}`; const set = m.get(k) || m.set(k, new Set()).get(k); for (const x of rule.keys ? rule.keys(r) : [rule.key(r)]) if (x) set.add(x); }
  const sizes = [...m.values()].map((x) => x.size);
  buyerCounts[name] = { issuerMonths: m.size, ge2: sizes.filter((x) => x >= 2).length, ge3: sizes.filter((x) => x >= 3).length, ge5: sizes.filter((x) => x >= 5).length, buyerMonthSum: sizes.reduce((a, b) => a + b, 0) };
  perIssuerMonth[name] = m;
}
const diffs = [];
for (const [k, set] of perIssuerMonth.r3_everyCoReportingOwner) { const app = perIssuerMonth.r5_appRule_withConfirmedDuplicates.get(k)?.size || 0, first = perIssuerMonth.r2_firstOwnerCik.get(k)?.size || 0; if (set.size !== app || first !== app) diffs.push({ issuerMonth: k, everyOwner: set.size, firstOwnerCik: first, filings: perIssuerMonth.r1_filings.get(k)?.size || 0, appRule: app }); }
diffs.sort((a, b) => b.everyOwner - b.appRule - (a.everyOwner - a.appRule));
const tickerOfCik = new Map(econP.map((r) => [Number(r.issuerCik), r.ticker]));
const buyerCounting = { unit: "issuer × trade-date month; purchase rows not superseded", rules: buyerCounts,
  issuerMonthsWhereRulesDisagree: diffs.length,
  issuerMonthsWhereFirstOwnerCikOvercountsAppRule: diffs.filter((d) => d.firstOwnerCik > d.appRule).length,
  issuerMonthsWhereAppRuleExceedsFirstOwnerCik: diffs.filter((d) => d.firstOwnerCik < d.appRule).length,
  largestInflations: diffs.slice(0, 15).map((d) => ({ ...d, ticker: tickerOfCik.get(Number(d.issuerMonth.split("|")[0])) || null })) };

// ---------------- 6. stage-C membership reproduction and reconciliation ----------------
log("stage-C reconciliation");
const usd = (r) => (r.priceCheck?.status === "anomaly" || !(r.value > 0) ? null : r.value);
const filP = new Map(); for (const r of econP) (filP.get(r.accessionNo) || filP.set(r.accessionNo, []).get(r.accessionNo)).push(r);
const nhSet = new Map(evNH.map((e) => [e.accessionNo, e]));
const pFilings = [];
const recon = { secRowsPFilings: secPAcc.size, reasons: {}, byPeriod: {} };
for (const [acc, rows] of filP) {
  const T = stamp(accMap.get(acc)) || stamp(rows[0].acceptedAtET);
  const okRows = rows.filter((r) => ISO.test(r.transactionDate || "") && Number(r.issuerCik) && stamp(r.acceptedAtET));
  const liveRows = okRows.filter(live);
  const valued = liveRows.filter((r) => usd(r) != null);
  let reason = null;
  if (!okRows.length) reason = "invalid_trade_date_or_cik_or_acceptance";
  else if (!liveRows.length) reason = "all_purchase_rows_superseded_by_amendment";
  else if (!valued.length) {
    const why = liveRows.some((r) => r.priceCheck?.status === "anomaly") && liveRows.every((r) => !(r.value > 0) || r.priceCheck?.status === "anomaly") ? (liveRows.every((r) => r.priceCheck?.status === "anomaly") ? "no_valued_row:all_price_anomaly" : "no_valued_row:anomaly_or_missing_price") : "no_valued_row:missing_or_zero_price";
    reason = why;
  }
  const L = valued.length ? [...valued].sort((a, b) => usd(b) - usd(a))[0] : (liveRows[0] || rows[0]);
  const period = periodOfDate(T.slice(0, 10));
  const inC = reason == null;
  const ev = nhSet.get(acc);
  if (period !== "holdout" && inC !== !!ev) inc(recon, "nonHoldoutMismatch");
  inc(recon.reasons, reason || "in_stage_C");
  const bp = recon.byPeriod[period] || (recon.byPeriod[period] = {}); inc(bp, reason || "in_stage_C");
  const fc = filingClass[acc];
  pFilings.push({
    acc, cik: Number(L.issuerCik), ticker: L.ticker || null, tickerReported: L.tickerReported || null, issuer: L.issuerName || null, form: L.formType, publishedAt: T, window: windowOf(T), period,
    tradeDate: L.transactionDate, rows: rows.length, liveRows: liveRows.length, valuedRows: valued.length, filingValue: Math.round(valued.reduce((a, r) => a + usd(r), 0)),
    price: L.price ?? null, shares: L.shares ?? null, security: L.securityTitle || null, owner: ownersOf(L)[0]?.name || null, ownerCik: ownersOf(L)[0]?.cik || null, person: idsAll.personOf(L), own: [...new Set(rows.map((r) => r.ownership || "?"))].join("+"),
    dedupe: [...new Set(rows.map((r) => r.dedupe?.status || "none"))].join("+"), amend: [...new Set(rows.map((r) => r.amendment?.status || "none"))].join("+"),
    venue: L.purchaseContext || "unspecified", cls: fc?.cls || null, inStageC: inC, excludedReason: reason,
    // non-holdout only (from lib2); holdout events are never read
    stageC: ev ? { priceStatus: ev.priceStatus, entryDate: ev.entryDate || null, chartStatus: ev.chartStatus || null } : null,
  });
}
const predictedNH = pFilings.filter((p) => p.inStageC && p.period !== "holdout").length, predictedH = pFilings.filter((p) => p.inStageC && p.period === "holdout").length;
recon.stageCNonHoldoutFromLib2 = evNH.length; recon.predictedNonHoldout = predictedNH; recon.predictedHoldout = predictedH;
recon.predictedTotal = predictedNH + predictedH; recon.documentedStageCTotal = 10836; recon.totalMatchesDocumented = predictedNH + predictedH === 10836;
recon.lib2EventsNotInSecRows = evNH.filter((e) => !filP.has(e.accessionNo)).length;
recon.rawPFilings = rawPAcc.size; recon.rawPFilingsMergedIntoOtherFilings = mergedAwayP.length;
recon.form4AEventsNonHoldout = evNH.filter((e) => e.formType === "4/A").length;
recon.form4APredictedTotal = pFilings.filter((p) => p.inStageC && p.form === "4/A").length;

// ---------------- 7. publication windows and classification v2 ----------------
const inC = pFilings.filter((p) => p.inStageC);
const windows = { allPredictedStageC: cnt(inC, (p) => p.window), byPeriod: Object.fromEntries(["discover", "confirm", "holdout"].map((k) => [k, cnt(inC.filter((p) => p.period === k), (p) => p.window)])) };
const classV2 = { filingClassEntries: Object.keys(filingClass).length,
  secPFilingsCovered: [...secPAcc].filter((a) => filingClass[a]).length,
  byClassAllCovered: cnt(Object.values(filingClass), (f) => f.cls),
  stageCByPeriod: Object.fromEntries(["discover", "confirm", "holdout"].map((k) => [k, cnt(inC.filter((p) => p.period === k), (p) => p.cls || "unclassified")])),
  pricedNonHoldoutByClass: cnt(pFilings.filter((p) => p.stageC?.priceStatus === "ok"), (p) => p.cls || "unclassified") };

// ---------------- 8. counts summary ----------------
const counts = {
  issuersP: new Set(econP.map((r) => Number(r.issuerCik))).size, issuersS: new Set(econS.map((r) => Number(r.issuerCik))).size, issuersPS: new Set(econ.map((r) => Number(r.issuerCik))).size,
  tickersP: new Set(econP.map((r) => r.ticker).filter(Boolean)).size, tickersPS: new Set(econ.map((r) => r.ticker).filter(Boolean)).size,
  filings: { rawP: rawPAcc.size, rawS: filingsOf(rawS).size, econP: econPAcc.size, econS: filingsOf(econS).size, econPorS: filingsOf(econ).size },
  rows: { raw: byCode(raw), economic: byCode(econ) },
  stageCPredicted: { total: inC.length, byPeriod: cnt(inC, (p) => p.period) },
};

const result = { builtAt: new Date().toISOString(), source: { storeDays: [s.days[0], s.days.at(-1)], heldDays: s.days.length, secRowsBuiltAt: sec.builtAt }, consistency, counts, quality, dates, identities, buyerCounting, reconciliation: recon, windows, classV2 };
fs.writeFileSync(path.join(OUT, "sec-audit.json"), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(OUT, "p-filings.json"), JSON.stringify({ builtAt: result.builtAt, note: "one row per purchase filing (economic P rows); stageC only for non-holdout (lib2)", rows: pFilings }));
log(`done: ${JSON.stringify({ counts: counts.filings, recon: { reasons: recon.reasons, predictedTotal: recon.predictedTotal, matches: recon.totalMatchesDocumented, nonHoldoutMismatch: recon.nonHoldoutMismatch || 0 } })}`);
