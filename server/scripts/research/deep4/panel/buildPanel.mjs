// deep4/panel/buildPanel.mjs — point-in-time insider-purchase panel, outcomes A/B and matched controls (agent "panel").
//   node --max-old-space-size=6144 scripts/research/deep4/panel/buildPanel.mjs
//   node --max-old-space-size=6144 scripts/research/deep4/panel/buildPanel.mjs --selftest-boundary=2026-03-16
// Research only: cache only (no network, no Alpaca / SEC / Mongo / server), writes only under .cache/research/deep4/panel/.
//
// Unit = one economic purchase FILING (Form 4 accession with code-P rows; joint filers = one filing; confirmed related-filer
// duplicates already merged by the store's economic dedupe). Point-in-time amendment rule (deep 3 sequence): an original that
// was later superseded stays (it was the public event at its acceptance); a 4/A row that re-reports an original already held
// in the store is dropped. Same person + issuer + entry session (several filings) → one dupKey; isPrimary marks the first.
//
// Segments (lib4): design rows → panel.json / controls.json (price cutoff 2026-06-15: no bar on/after it is read).
// confirm / exposed rows → panel-confirm.json / panel-exposed.json ONLY when lib4 guards allow (confirmUnlocked("panel") /
// exposedUnlocked()); their outcomes may use bars through 2026-11-03. Every emitted row passes L4.assertVisible.
// --selftest-boundary=D : exercises the multi-segment path on DESIGN data only (fake design < D <= fake confirm < 2026-06-15),
// writes selftest/ files and checks invariants against panel.json. Never reads a locked segment.
import fs from "node:fs";
import path from "node:path";
import * as PL from "./panelLib.mjs";
import { adjFactor } from "../../deep2/execution/execLib.mjs";
import { rolesOfText, primaryRole, holdingsOf } from "../../deep3/sequence/common.mjs";
import { OUT_DIR } from "../../lib.mjs";

const { L4, day, daysBetween, mean, median, cnt, group, r6 } = PL;
const t0 = Date.now();
const log = (...a) => console.log(`[PANEL_BUILD ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const SELFTEST = arg("selftest-boundary");
if (SELFTEST && !(SELFTEST > PL.STORE_START && SELFTEST < L4.DESIGN_END)) throw new Error("selftest boundary must lie inside the design period");

// ---------------- segment plan ----------------
// real run: segOf = lib4.segmentOf; selftest: fake split of the design period (everything still < DESIGN_END).
const segOf = SELFTEST ? (d) => (day(d) < SELFTEST ? "design" : day(d) < L4.DESIGN_END ? "confirm" : "exposed") : (d) => L4.segmentOf(d);
const plan = SELFTEST
  ? [{ seg: "design", cutoff: SELFTEST, file: "selftest/panel-design.json", ctl: "selftest/controls-design.json", visibleUntil: L4.DESIGN_END },
     { seg: "confirm", cutoff: L4.DESIGN_END, file: "selftest/panel-confirm.json", ctl: "selftest/controls-confirm.json", visibleUntil: L4.DESIGN_END }]
  : [{ seg: "design", cutoff: L4.DESIGN_END, file: "panel.json", ctl: "controls.json", visibleUntil: L4.confirmUnlocked(PL.AGENT) ? (L4.exposedUnlocked() ? null : L4.EXPOSED_START) : L4.DESIGN_END },
     ...(L4.confirmUnlocked(PL.AGENT) ? [{ seg: "confirm", cutoff: null, file: "panel-confirm.json", ctl: "controls-confirm.json", visibleUntil: L4.exposedUnlocked() ? null : L4.EXPOSED_START }] : []),
     ...(L4.exposedUnlocked() ? [{ seg: "exposed", cutoff: null, file: "panel-exposed.json", ctl: "controls-exposed.json", visibleUntil: null }] : [])];
log(`mode ${SELFTEST ? `SELFTEST boundary ${SELFTEST}` : "real"}; emitting ${plan.map((p) => `${p.seg}(cutoff ${p.cutoff ?? "none"})`).join(", ")}; confirmUnlocked=${L4.confirmUnlocked(PL.AGENT)} exposedUnlocked=${L4.exposedUnlocked()}`);

// ---------------- inputs (visible segments only; filtered immediately after parsing) ----------------
const pfAll = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep3", "dataquality", "p-filings.json"), "utf8"));
const PF = L4.visible(pfAll.rows, (r) => r.publishedAt, PL.AGENT);
const pfByAcc = new Map(PF.map((r) => [r.acc, r]));
const secAll = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep2", "sec-rows.json"), "utf8"));
const SEC = L4.visible(secAll.rows, (r) => r.acceptedAt, PL.AGENT);
const fc = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep2", "behavior", "filing-class.json"), "utf8"));
const inputCounts = { pFilingsAll: pfAll.rows.length, pFilingsVisible: PF.length, secRowsAll: secAll.rows.length, secRowsVisible: SEC.length, secRowsBuiltAt: secAll.builtAt, pFilingsBuiltAt: pfAll.builtAt };
pfAll.rows = null; secAll.rows = null; // drop references to locked rows
log(`inputs ${JSON.stringify(inputCounts)}`);

const Prows = SEC.filter((r) => r.code === "P");
const Srows = SEC.filter((r) => r.code === "S");
const cik2sym = new Map();
for (const r of SEC) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, PL.symOf(r.ticker));

// ---------------- amendment rule (deep3/sequence/build.mjs, point in time) ----------------
const superseded = new Map();
for (const r of Prows) if (r.amend === "superseded") { const k = `${r.cik}|${r.insiderCik}|${r.tradeDate}`; if (!superseded.has(k) || r.acceptedAt < superseded.get(k)) superseded.set(k, r.acceptedAt); }
const droppedRows = [];
const keptP = Prows.filter((r) => { if (r.amend !== "amends") return true; const k = `${r.cik}|${r.insiderCik}|${r.tradeDate}`; if (superseded.has(k) && superseded.get(k) <= r.acceptedAt) { droppedRows.push(r); return false; } return true; });
const rowsByAcc = group(keptP, (r) => r.acc);
const droppedFilings = PF.filter((p) => !rowsByAcc.has(p.acc)).map((p) => p.acc);
log(`P rows ${Prows.length} (dropped amendment rows ${droppedRows.length}); S rows ${Srows.length}; filings kept ${rowsByAcc.size}, dropped (4/A of held original) ${droppedFilings.length}`);

// ---------------- markets (one per price cutoff) ----------------
const markets = new Map();
const marketFor = (cutoff) => { const k = cutoff ?? "none"; if (!markets.has(k)) markets.set(k, PL.createMarket({ cutoff })); return markets.get(k); };
// regime thresholds always from DESIGN sessions (real DESIGN_END), computed on the design-cutoff market
const TH = PL.regimeThresholds(marketFor(L4.DESIGN_END));
log(`regime thresholds ${JSON.stringify(TH)}`);

// ---------------- filing universe ----------------
const usdOf = (r) => (r.priceCheck === "anomaly" || !(r.value > 0) ? null : r.value);
const COMMON_RE = /common|ordinary|class [a-c]\b|shares|stock$/i, NONCOMMON_RE = /preferred|warrant|unit|note|debenture|right|option|convertible|depositary/i;
const filings = [];
for (const [acc, rows] of rowsByAcc) {
  const p = pfByAcc.get(acc); if (!p) continue; // every visible P accession has a p-filings row (verified in explore1)
  const valued = rows.filter((r) => usdOf(r) != null);
  const L = valued.length ? [...valued].sort((a, b) => usdOf(b) - usdOf(a))[0] : rows[0];
  const usd = valued.reduce((a, r) => a + usdOf(r), 0);
  const sharesValued = valued.reduce((a, r) => a + (r.shares || 0), 0);
  const tds = rows.map((r) => r.tradeDate).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "")).sort();
  const roles = rolesOfText(L.role);
  const owns = [...new Set(rows.map((r) => r.own || "?"))].sort();
  const hold = holdingsOf(rows);
  const ticker = p.ticker || rows.find((r) => r.ticker)?.ticker || null;
  const sym = ticker ? PL.symOf(ticker) : cik2sym.get(p.cik) || null;
  const priceL = L.price > 0 && L.priceCheck !== "anomaly" ? L.price : null;
  const sec = String(p.security || "");
  filings.push({
    key: acc, acc, cik: Number(p.cik), ticker, sym, issuer: p.issuer, form: p.form, person: p.person, ownerName: p.owner, ownerCik: p.ownerCik ? Number(p.ownerCik) : null,
    publishedAt: p.publishedAt, tradeDate: L.tradeDate, tradeDateMin: tds[0] || null, tradeDateMax: tds.at(-1) || null,
    amend: p.amend, dedupe: p.dedupe, cls: fc[acc]?.cls || null, venueStated: L.ctx || "unspecified", security: p.security || null,
    commonLike: sec ? (NONCOMMON_RE.test(sec) ? 0 : COMMON_RE.test(sec) ? 1 : 0) : null, plan10b5: rows.some((r) => r.plan) ? 1 : 0, rowsN: rows.length,
    role: L.role || null, isCEO: roles.has("CEO") ? 1 : 0, isCFO: roles.has("CFO") ? 1 : 0, isDirector: roles.has("Director") ? 1 : 0, isTenPct: roles.has("10% Owner") ? 1 : 0,
    isOfficer: roles.has("CEO") || roles.has("CFO") || roles.has("Officer") ? 1 : 0, primaryRole: primaryRole(roles),
    ownership: owns.join("+"), ownD: owns.includes("D") ? 1 : 0, ownI: owns.includes("I") ? 1 : 0,
    valued: valued.length ? 1 : 0, usd: valued.length ? usd : null, shares: rows.reduce((a, r) => a + (r.shares || 0), 0), sharesValued: valued.length ? sharesValued : null,
    priceVwap: valued.length && sharesValued > 0 ? usd / sharesValued : null, priceReported: priceL,
    sharesAfter: hold.holdingsAfter, pctHold: hold.pctOfPrior, firstPosition: hold.holdValid ? (hold.priorNearZero ? 1 : 0) : null, holdValid: hold.holdValid ? 1 : 0,
    _rows: rows,
  });
}
filings.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.acc.localeCompare(b.acc));
const byPerson = group(filings, (f) => f.person);
const byIssuer = group(filings, (f) => f.cik);
// seller identity: owner CIK → app-rule person where that CIK owns a purchase filing; else cik:N
const cikPerson = new Map(); for (const p of PF) if (p.ownerCik && p.person) cikPerson.set(Number(p.ownerCik), p.person);
const sellerOf = (r) => { const c = Number(r.insiderCik); return c ? cikPerson.get(c) || `cik:${c}` : `name:${String(r.insider || "").toLowerCase()}`; };
const sByIssuer = group(Srows.map((r) => ({ cik: Number(r.cik), at: r.acceptedAt, who: sellerOf(r), usd: usdOf(r), plan: !!r.plan })).sort((a, b) => a.at.localeCompare(b.at)), (r) => r.cik);
log(`filings ${filings.length}, persons ${byPerson.size}, issuers ${byIssuer.size}`);

// ---------------- per-filing timing, pricing status, adjusted insider price ----------------
for (const f of filings) {
  const t = PL.decisionOf(f.publishedAt);
  f.decisionAt = t.at; f.decisionDate = t.date; f.segment = segOf(f.publishedAt); f.month = day(f.publishedAt).slice(0, 7);
  f.window = PL.pubWindow(f.publishedAt);
  f.entryDate = PL.entryDateOf(f.publishedAt); f.entryMonth = f.entryDate.slice(0, 7);
  f.lagDays = /^\d{4}-\d{2}-\d{2}$/.test(f.tradeDate || "") ? daysBetween(f.tradeDate, f.decisionDate) : null;
  f.lagDaysFirst = f.tradeDateMin ? daysBetween(f.tradeDateMin, f.decisionDate) : null;
  // as-traded → split-adjusted factor (execLib.adjFactor: adjusted close on the trade date ÷ reported price; outside [0.55, 1.8]
  // a split is inferred). FUTURE-DERIVED: depends on splits up to 2026-11; never use f / inferred / adjusted levels as features.
  // a trade date after the decision date is a data error: never read its bar (it may lie past t / past the cutoff)
  f.tdAfterDecision = /^\d{4}-\d{2}-\d{2}$/.test(f.tradeDate || "") && f.tradeDate > f.decisionDate ? 1 : 0;
  const af = f.sym && f.priceReported && !f.tdAfterDecision ? adjFactor({ id: f.acc, ticker: f.sym, price: f.priceReported, tradeDate: f.tradeDate }) : { f: 1, inferred: false, ratio: null };
  f.fut_adjFactor = f.priceReported && af.ratio != null ? af.f : null; f.fut_adjInferred = af.ratio != null ? (af.inferred ? 1 : 0) : null; f.fut_adjRatio = af.ratio ?? null;
  f.insPriceAdj = f.priceReported && !f.tdAfterDecision ? f.priceReported * af.f : null;
}
// duplicate groups: same person, issuer and entry session
for (const xs of group(filings, (f) => `${f.person}|${f.cik}|${f.entryDate}`).values()) xs.forEach((f, i) => { f.dupKey = `${f.person}|${f.cik}|${f.entryDate}`; f.dupSize = xs.length; f.dupRank = i + 1; f.isPrimary = i === 0 ? 1 : 0; });

// ---------------- person history and cluster context (point in time) ----------------
for (const f of filings) {
  const mine = byPerson.get(f.person) || [];
  const prior = mine.filter((g) => g.publishedAt < f.publishedAt);
  const priorCo = prior.filter((g) => g.cik === f.cik);
  f.pConcurrent = mine.filter((g) => g.publishedAt === f.publishedAt && g.acc !== f.acc).length;
  f.pPrior = prior.length; f.pPriorCo = priorCo.length; f.pPriorOm = prior.filter((g) => g.cls === "om").length;
  f.pCompanies = new Set([...prior.map((g) => g.cik), f.cik]).size; f.pFirstEver = prior.length ? 0 : 1;
  f.pObsDays = daysBetween(PL.STORE_START, day(f.publishedAt));
  f.pDaysSincePrev = prior.length ? daysBetween(day(prior.at(-1).publishedAt), day(f.publishedAt)) : null;
  f.pDaysSincePrevCo = priorCo.length ? daysBetween(day(priorCo.at(-1).publishedAt), day(f.publishedAt)) : null;
  const lastTd = prior.map((g) => g.tradeDate).filter(Boolean).sort().at(-1);
  f.pTdDaysSincePrev = lastTd && f.tradeDate ? daysBetween(lastTd, f.tradeDate) : null;
  const pu = prior.filter((g) => g.valued).map((g) => g.usd), cu = priorCo.filter((g) => g.valued).map((g) => g.usd);
  f.pUsdRatioMax = f.valued && pu.length ? f.usd / Math.max(...pu) : null;
  f.pUsdRatioMed = f.valued && pu.length ? f.usd / median(pu) : null;
  f.pUsdRatioMaxCo = f.valued && cu.length ? f.usd / Math.max(...cu) : null;
  const prevCoPriced = [...priorCo].reverse().find((g) => g.insPriceAdj > 0);
  f.avgDownPct = f.insPriceAdj > 0 && prevCoPriced ? f.insPriceAdj / prevCoPriced.insPriceAdj - 1 : null;
  f.avgDown = f.avgDownPct == null ? null : f.avgDownPct < 0 ? 1 : 0;
  f._prevCoTradeDate = priorCo.length ? priorCo.at(-1).tradeDate : null;
  // issuer context: other filings accepted before t (t = acceptance + 60 s)
  const iss = (byIssuer.get(f.cik) || []).filter((g) => g.publishedAt < f.decisionAt && g.acc !== f.acc);
  const from30 = PL.shiftStamp(f.decisionAt, -30);
  const w30 = iss.filter((g) => g.publishedAt >= from30);
  const o30 = w30.filter((g) => g.person !== f.person);
  f.oBuyers30 = new Set(o30.map((g) => g.person)).size; f.oBuyers30Om = new Set(o30.filter((g) => g.cls === "om").map((g) => g.person)).size;
  f.oBuyUsd30 = o30.reduce((a, g) => a + (g.usd || 0), 0); f.selfBuys30 = w30.filter((g) => g.person === f.person).length;
  const oAll = iss.filter((g) => g.person !== f.person);
  f.oBuyersPrior = new Set(oAll.map((g) => g.person)).size; f.oBuysPrior = oAll.length; f.iBuysPrior = iss.length;
  f.iDaysSincePrevBuy = iss.length ? daysBetween(day(iss.at(-1).publishedAt), day(f.publishedAt)) : null;
  const ss = (sByIssuer.get(f.cik) || []).filter((s) => s.at < f.decisionAt);
  const s30 = ss.filter((s) => s.at >= from30), s30np = s30.filter((s) => !s.plan);
  f.sellers30 = new Set(s30.map((s) => s.who)).size; f.sellUsd30 = s30.reduce((a, s) => a + (s.usd || 0), 0);
  f.sellers30np = new Set(s30np.map((s) => s.who)).size; f.sellUsd30np = s30np.reduce((a, s) => a + (s.usd || 0), 0);
  f.selfSold30 = s30.some((s) => s.who === f.person) ? 1 : 0; f.selfSoldPrior = ss.some((s) => s.who === f.person) ? 1 : 0;
  f.ctxTrunc30 = day(from30) < PL.STORE_START ? 1 : 0;
}
log("person + cluster features done");

// ---------------- market features, outcomes ----------------
function priceRow(f, M) {
  const A = f.sym ? M.aligned(f.sym) : null;
  const jE = M.idx.get(f.entryDate);
  let st = "ok";
  if (!f.sym) st = "no_ticker";
  else if (!A) st = "no_bars";
  else if (M.cutoff && f.entryDate >= M.cutoff) st = "entry_embargo";
  else if (f.entryDate > PL.COMPLETE_THROUGH || jE == null) st = "entry_censored";
  else if (f.entryDate < A.first) st = "entry_before_first_bar";
  else if (f.entryDate > A.last) st = "entry_after_last_bar";
  else if (PL.barOn(A, jE) < 0) st = "no_entry_bar";
  const out = { priceStatus: st, priced: st === "ok" ? 1 : 0 };
  const jDec = jE != null ? jE - 1 : M.firstOnOrAfter(f.entryDate) - 1;
  const mf = A ? PL.marketFeatures(M, A, jDec) : null;
  Object.assign(out, mf || PL.blankMarket());
  out.decCloseAsTraded = mf && f.fut_adjFactor ? mf.decCloseAdj / f.fut_adjFactor : null;
  Object.assign(out, PL.regimeFeatures(M, TH, jDec));
  Object.assign(out, st === "ok" ? PL.entryGap(M, A, jE) : { gapEntry: null, gapEntryX: null });
  // trade-date view (insider's own decision): bars strictly before the trade date
  const okTd = /^\d{4}-\d{2}-\d{2}$/.test(f.tradeDate || "");
  const jTd = okTd ? M.firstOnOrAfter(f.tradeDate) - 1 : -1;
  const tf = A && okTd && jTd <= jDec ? PL.marketFeatures(M, A, jTd, "td_") : null;
  Object.assign(out, tf || PL.blankMarket("td_"));
  Object.assign(out, PL.regimeFeatures(M, TH, okTd && jTd <= jDec ? jTd : -1, "td_"));
  // price move from the trade date to the decision bar (both public at t)
  let retTd = null;
  if (A && okTd && mf) { const jT = M.lastOnOrBefore(f.tradeDate); const k = jT >= 0 && jT <= jDec ? A.kAt[jT] : -1; if (k >= 0 && A.arr[k].c > 0 && f.tradeDate >= A.first) retTd = mf.decCloseAdj / A.arr[k].c - 1; }
  out.retTdToDec = retTd;
  // repeat into falling: stock below its close on the trade date of the person's previous purchase at this issuer
  let chg = null;
  if (A && mf && f._prevCoTradeDate && f._prevCoTradeDate >= A.first) { const jP = M.lastOnOrBefore(f._prevCoTradeDate); const k = jP >= 0 && jP <= jDec ? A.kAt[jP] : -1; if (k >= 0 && A.arr[k].c > 0) chg = mf.decCloseAdj / A.arr[k].c - 1; }
  out.chgSincePrevBuy = chg; out.repeatIntoFalling = f.pPriorCo === 0 ? 0 : chg == null ? null : chg < 0 ? 1 : 0;
  // outcomes
  const costBps = mf ? mf.costBps : null;
  Object.assign(out, st === "ok" && costBps != null ? PL.outcomeB(M, A, jE, costBps) : { ...Object.fromEntries(PL.B_FIELDS.map((k) => [k, null])), B_status: st === "ok" ? "no_features" : st });
  Object.assign(out, f.tdAfterDecision ? { ...Object.fromEntries(PL.A_FIELDS.map((k) => [k, null])), A_status: "td_after_decision" } : PL.outcomeA(M, A, f.tradeDate, f.insPriceAdj));
  out.primary = f.cls === "om" && f.valued && st === "ok" ? 1 : 0;
  return { out, A, jE, jDec };
}

// ---------------- controls ----------------
const CTL_SUM = [...PL.CAL_H.map((H) => `B_xsNet${H}`), ...PL.CAL_H.map((H) => `B_hit10_${H}`), "B_mfe30", "B_mae30", ...PL.CAL_H.map((H) => `B_lim10_${H}`), ...PL.SESS_N.map((N) => `B_sXsNet${N}`)];
function controlsFor(seg, M, evRows, visibleUntil) {
  const blocked = PL.purchaseBlocks(M, Prows, cik2sym);
  const pool = PL.buildPool(M, blocked, { visibleUntil, segOf });
  const segPool = pool.rows.filter((r) => r.per === seg);
  log(`[${seg}] pool rows ${pool.rows.length} (segment ${segPool.length}), symbols ${pool.syms.length}`);
  PL.prepareVectors(segPool, PL.MATCH_FEATURES, "fv");
  const scales = PL.robustScales(segPool, PL.MATCH_FEATURES);
  const idx = PL.indexPool(segPool);
  const byEvent = {}, need = new Map();
  for (const e of evRows) {
    if (!e.featOk || e.jE == null) { byEvent[e.key] = []; continue; }
    const ev = { m: e.entryMonth, tier: e.tier, per: seg, r5: e.r5, r20: e.r20, dd60: e.dHi60, vol20: e.vol20, dv20: e.dv20, gapPrev: e.gapPrev };
    const ms = PL.nearest(ev, idx, scales, pool.syms.length, { K: 10, filter: (r) => r.s !== e.sym });
    byEvent[e.key] = ms.map((m) => { const k = `${m.r.s}|${m.r.D}`; if (!need.has(k)) need.set(k, m.r); return [k, Math.round(m.dist * 1e4) / 1e4]; });
  }
  const ctlRows = {};
  for (const [k, r] of need) {
    const A = M.aligned(r.s);
    const mf = PL.marketFeatures(M, A, r.j - 1);
    const row = { ctlKey: k, sym: r.s, entryDate: r.D, entryMonth: r.m, segment: r.per, exclTrunc: r.exclTrunc, ...mf, ...PL.regimeFeatures(M, TH, r.j - 1), ...PL.entryGap(M, A, r.j), ...PL.outcomeB(M, A, r.j, mf.costBps) };
    ctlRows[k] = PL.roundRow(row);
  }
  // per-event control means (convenience; full detail in controls file)
  for (const e of evRows) {
    const cs = (byEvent[e.key] || []).map(([k]) => ctlRows[k]);
    e.C_n = cs.length; e.C_distMean = cs.length ? mean(byEvent[e.key].map((x) => x[1])) : null; e.C_exclTrunc = cs.length ? mean(cs.map((c) => c.exclTrunc)) : null;
    for (const F of CTL_SUM) { const v = cs.map((c) => c[F]).filter((x) => x != null && Number.isFinite(x)); e[`C_${F.slice(2)}`] = v.length ? mean(v) : null; e[`C_${F.slice(2)}_n`] = v.length; }
  }
  // balance (features only; no outcomes): standardized mean differences of matching and other features
  const smd = (a, b) => { const ma = mean(a), mb = mean(b), va = PL.sd(a) ** 2, vb = PL.sd(b) ** 2; const den = Math.sqrt((va + vb) / 2); return den > 0 ? (ma - mb) / den : null; };
  const balance = {};
  for (const F of ["r5", "r20", "dHi60", "vol20", "dv20", "gapPrev", "r60", "vol60", "volSurge", "gapEntry", "mdd60", "dLo60", "bo20", "sma50r"]) {
    const ev = [], ct = [];
    for (const e of evRows) { const cs = (byEvent[e.key] || []).map(([k]) => ctlRows[k][F]).filter((x) => x != null && Number.isFinite(x)); const v = e[F]; if (v == null || !Number.isFinite(v) || !cs.length) continue; ev.push(F === "dv20" ? Math.log(Math.max(v, 1e3)) : F === "vol20" || F === "vol60" ? Math.log(Math.max(v, 1e-3)) : v); ct.push(mean(cs.map((x) => (F === "dv20" ? Math.log(Math.max(x, 1e3)) : F === "vol20" || F === "vol60" ? Math.log(Math.max(x, 1e-3)) : x)))); }
    balance[F] = { n: ev.length, eventMean: r6(mean(ev)), controlMean: r6(mean(ct)), smd: r6(smd(ev, ct)) };
  }
  return { byEvent, ctlRows, poolRows: segPool.length, poolSymbols: pool.syms.length, scales, balance };
}

// ---------------- emit per segment ----------------
const NOT_FEATURES = ["decCloseAdj", "td_decCloseAdj", "decDate", "td_decDate", "insPriceAdj", "fut_adjFactor", "fut_adjInferred", "fut_adjRatio"];
const ID_FIELDS = ["key", "acc", "cik", "ticker", "sym", "issuer", "form", "person", "ownerName", "ownerCik", "segment", "month", "publishedAt", "decisionAt", "decisionDate", "window", "entryDate", "entryMonth",
  "tradeDate", "tradeDateMin", "tradeDateMax", "dupKey", "dupSize", "dupRank", "isPrimary", "amend", "dedupe", "priceStatus", "priced", "primary"];
const PURCHASE_FIELDS = ["cls", "venueStated", "security", "commonLike", "plan10b5", "rowsN", "role", "isCEO", "isCFO", "isDirector", "isTenPct", "isOfficer", "primaryRole", "ownership", "ownD", "ownI",
  "valued", "usd", "shares", "sharesValued", "priceVwap", "priceReported", "sharesAfter", "pctHold", "firstPosition", "holdValid", "lagDays", "lagDaysFirst", "tdAfterDecision"];
const PERSON_FIELDS = ["pPrior", "pPriorCo", "pPriorOm", "pCompanies", "pFirstEver", "pConcurrent", "pObsDays", "pDaysSincePrev", "pDaysSincePrevCo", "pTdDaysSincePrev", "pUsdRatioMax", "pUsdRatioMed",
  "pUsdRatioMaxCo", "avgDown", "avgDownPct", "chgSincePrevBuy", "repeatIntoFalling"];
const CLUSTER_FIELDS = ["oBuyers30", "oBuyers30Om", "oBuyUsd30", "selfBuys30", "oBuyersPrior", "oBuysPrior", "iBuysPrior", "iDaysSincePrevBuy", "sellers30", "sellUsd30", "sellers30np", "sellUsd30np",
  "selfSold30", "selfSoldPrior", "ctxTrunc30"];
const MARKET_FIELDS = [...PL.MARKET_FIELDS, "decCloseAsTraded", ...PL.REGIME_FIELDS];
const TD_FIELDS = [...PL.MARKET_FIELDS.map((k) => `td_${k}`), ...PL.REGIME_FIELDS.map((k) => `td_${k}`), "retTdToDec"];
const AT_ENTRY_FIELDS = ["gapEntry", "gapEntryX"];
const FUT_FIELDS = ["insPriceAdj", "fut_adjFactor", "fut_adjInferred", "fut_adjRatio"];
const C_FIELDS = ["C_n", "C_distMean", "C_exclTrunc", ...CTL_SUM.flatMap((F) => [`C_${F.slice(2)}`, `C_${F.slice(2)}_n`])];
const ALL_FIELDS = [...ID_FIELDS, ...PURCHASE_FIELDS, ...PERSON_FIELDS, ...CLUSTER_FIELDS, ...MARKET_FIELDS, ...AT_ENTRY_FIELDS, ...TD_FIELDS, ...FUT_FIELDS, ...PL.B_FIELDS, ...PL.A_FIELDS, ...C_FIELDS];
const featureFields = [...PURCHASE_FIELDS.filter((k) => !["security", "role", "venueStated"].includes(k)), ...PERSON_FIELDS, ...CLUSTER_FIELDS,
  ...MARKET_FIELDS.filter((k) => !NOT_FEATURES.includes(k)), ...TD_FIELDS.filter((k) => !NOT_FEATURES.includes(k))];

const summary = { builtAt: new Date().toISOString(), mode: SELFTEST ? `selftest:${SELFTEST}` : "real", inputCounts, amendment: { droppedRows: droppedRows.length, droppedFilings: droppedFilings.length },
  regimeThresholds: TH, segments: {} };
for (const P of plan) {
  const M = marketFor(P.cutoff);
  const segFilings = filings.filter((f) => f.segment === P.seg);
  if (!SELFTEST) for (const f of segFilings) L4.assertVisible(f.publishedAt, PL.AGENT); // defense in depth
  const evRows = [];
  for (const f of segFilings) {
    const { out, jE } = priceRow(f, M);
    const row = {};
    for (const k of ALL_FIELDS) row[k] = k in out ? out[k] : f[k] ?? null;
    row.jE = out.priceStatus === "ok" ? jE : null; // internal
    evRows.push(row);
  }
  log(`[${P.seg}] rows ${evRows.length}; priced ${evRows.filter((r) => r.priced).length}; primary ${evRows.filter((r) => r.primary).length}`);
  const ctl = controlsFor(P.seg, M, evRows, P.visibleUntil);
  const rows = evRows.map((r) => { const { jE, ...rest } = r; const o = {}; for (const k of ALL_FIELDS) o[k] = rest[k] ?? null; return PL.roundRow(o); });
  const meta = {
    builtAt: summary.builtAt, agent: PL.AGENT, segment: P.seg, priceCutoff: P.cutoff, completeThrough: PL.COMPLETE_THROUGH, mode: summary.mode,
    unit: "one economic purchase filing (accession); joint filers once; 4/A re-reports of held originals dropped; superseded originals kept (point in time)",
    decisionTime: "acceptance (ET) + 60 s; entry = official open of the first session whose 09:28 ET MOO cut-off is >= t",
    fieldGroups: { ID_FIELDS, PURCHASE_FIELDS, PERSON_FIELDS, CLUSTER_FIELDS, MARKET_FIELDS, AT_ENTRY_FIELDS, TD_FIELDS, FUT_FIELDS, B_FIELDS: PL.B_FIELDS, A_FIELDS: PL.A_FIELDS, C_FIELDS },
    featureFields, notFeatures: [...NOT_FEATURES, ...AT_ENTRY_FIELDS.map((k) => `${k} (at-entry only)`), "amend (\"superseded\" = a LATER amendment exists: hindsight)", "dedupe (store dedupe status can use later filings)",
      "dupSize (counts same-person filings accepted up to the entry open, i.e. possibly after t)", "priceStatus/priced/primary (need the entry bar: known at the entry open, not at t)", "B_*, A_*, C_* (outcomes)"], regimeThresholds: TH,
    horizons: { calendarDays: PL.CAL_H, sessions: PL.SESS_N, targetsPct: PL.TARGETS, limitPct: PL.LIMIT_X, fillBuffer: PL.FILL_BUFFER },
  };
  PL.writeOut(P.file, { meta, rows });
  PL.writeOut(P.file.replace(/\.json$/, ".csv"), PL.toCsv(rows, ALL_FIELDS));
  const ctlMeta = { builtAt: summary.builtAt, segment: P.seg, priceCutoff: P.cutoff, K: 10, method: "deep-2 chart matching: same entry month x liquidity tier x segment; nearest on clipped r5, r20, dd60 (=dHi60), log vol20, log dv20, gapPrev (w 0.5) with robust (IQR) scales over the segment pool; one stock-day per symbol; never the event's own symbol; no visible code-P filing mark within +-20 sessions",
    exclusionVisibleUntil: P.visibleUntil, poolRows: ctl.poolRows, poolSymbols: ctl.poolSymbols, scales: ctl.scales, balance: ctl.balance, controlRows: Object.keys(ctl.ctlRows).length,
    rowFields: Object.keys(Object.values(ctl.ctlRows)[0] || {}) };
  // columnar storage (one array per control stock-day, in ctlMeta.rowFields order); data.mjs#loadControls rebuilds objects
  const ctlArr = Object.values(ctl.ctlRows);
  PL.writeOut(P.ctl, { meta: ctlMeta, byEvent: ctl.byEvent, fields: ctlMeta.rowFields, rows: ctlArr.map((r) => ctlMeta.rowFields.map((k) => r[k] ?? null)) });
  PL.writeOut(P.ctl.replace(/\.json$/, "-rows.csv"), PL.toCsv(ctlArr, ctlMeta.rowFields));
  if (!SELFTEST && P.seg === "design") {
    // transaction-row table (per code-P row) for the emitted filings
    const keep = new Set(rows.map((r) => r.acc));
    const tx = filings.filter((f) => keep.has(f.acc)).flatMap((f) => f._rows.map((r) => ({ acc: f.acc, id: r.id, form: r.form, cik: r.cik, ticker: r.ticker, insiderCik: r.insiderCik, insider: r.insider, role: r.role,
      tradeDate: r.tradeDate, acceptedAt: r.acceptedAt, shares: r.shares, price: r.price, value: r.value, after: r.after, own: r.own, nature: r.nature, plan: r.plan, ctx: r.ctx, priceCheck: r.priceCheck, amend: r.amend, dedupe: r.dedupe })));
    PL.writeOut("panel-rows.json", { meta: { builtAt: summary.builtAt, note: "code-P transaction rows behind panel.json filings (after the amendment rule)" }, rows: tx });
  }
  summary.segments[P.seg] = { file: P.file, rows: rows.length, priced: rows.filter((r) => r.priced).length, primary: rows.filter((r) => r.primary).length, controlsFile: P.ctl, controlRows: ctlMeta.controlRows,
    eventsWithControls: rows.filter((r) => r.C_n > 0).length, fullK: rows.filter((r) => r.C_n >= 10).length, priceStatus: cnt(rows, (r) => r.priceStatus), B_status: cnt(rows, (r) => r.B_status),
    A_status: cnt(rows, (r) => r.A_status), byMonth: cnt(rows, (r) => r.month), byClass: cnt(rows, (r) => r.cls), balance: ctl.balance };
  log(`[${P.seg}] wrote ${P.file} (${rows.length}) and ${P.ctl} (${ctlMeta.controlRows} control rows)`);
}
PL.writePretty(SELFTEST ? "selftest/build-summary.json" : "build-summary.json", summary);
if (!SELFTEST) PL.checkpoint("buildPanel", { segments: Object.fromEntries(Object.entries(summary.segments).map(([k, v]) => [k, { rows: v.rows, priced: v.priced, primary: v.primary, controlRows: v.controlRows }])) });
log("done");
