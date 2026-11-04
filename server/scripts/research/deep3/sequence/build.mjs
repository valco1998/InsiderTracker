// deep3/sequence/build.mjs — point-in-time buyer-position sequences. STRUCTURE ONLY: no returns are read here.
//   node scripts/research/deep3/sequence/build.mjs
//
// Universe: code-P rows of the deep-2 slim SEC store (snap.economic: confirmed related-filer duplicates already merged),
// accepted in [2025-12-01, 2026-09-01). Holdout filings (accepted >= 2026-09-01) are dropped before anything else.
//   • om   (primary): filings whose classification-v2 class (deep2/behavior/filing-class.json) is "om";
//   • allp (variant): every code-P filing; each signal keeps its class so offerings / entity allocations stay visible.
// Amendments: a 4/A row that amends an original already in the store (same issuer, owner CIK, trade date, earlier
//   "superseded" row) is dropped — the original was the public event at its own acceptance time (point in time).
// Distinct buyers (people), point in time at acceptance T, using only filings accepted <= T at the issuer:
//   union-find over owner keys — the first owner's CIK and every owner name on a filing are one person (joint filers,
//   fund vehicles filing jointly with an insider); and two filings reporting an identical row (issuer, trade date,
//   shares, price, shares owned after) with at least one Indirect holding are the same economic transaction → one buyer
//   (the production dedupe's candidate key, without its relationship-evidence requirement; two Direct holders cannot
//   hold the same shares, so D+D matches stay separate).
// Groupings:
//   • cal  : the calendar month of publication (acceptance, ET). Position k = k-th distinct buyer whose first filing in
//            that month became public. Repeat filings add to amounts but create no position.
//   • roll : trailing 30 days. At T, buyers with a filing accepted in [T−30d, T]; a buyer is new if they had no filing in
//            [T−30d, T); position = number of distinct buyers in [T−30d, T] (new buyers at one second numbered together).
// Same acceptance second: all new buyers at T are assigned consecutive positions at once (ordered by $ desc, then
//   accession) and flagged as a tie; the signal at T sees all of them.
// Descriptive (NOT tradable) variant: positions by first transaction date within the trade-date month.
import fs from "node:fs";
import path from "node:path";
import {
  L, OUT, writeOut, writePretty, STORE_START, HOLDOUT_START, periodOfDate, GAP_DAYS, sym, dnum, tsMs, msToTs, group, ownerNames, normName,
  rolesOfText, primaryRole, holdingsOf, UF, r4, mean, median, quantile, entrySessionAfter,
} from "./common.mjs";

const DAY = 86_400_000;
const t0 = Date.now();
const sec = await L.loadSecRows();
const fc = JSON.parse(fs.readFileSync(path.join(L.DEEP2, "behavior", "filing-class.json"), "utf8"));
const bars = L.loadBars();

const inWindow = (r) => r.acceptedAt && r.acceptedAt >= `${STORE_START} 00:00:00` && r.acceptedAt < `${HOLDOUT_START} 00:00:00`;
const Pall = sec.rows.filter((r) => r.code === "P" && inWindow(r));
const Sall = sec.rows.filter((r) => r.code === "S" && inWindow(r));
// cik → symbol fallback (rows without a ticker)
const cik2sym = new Map(); for (const r of sec.rows) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, sym(r.ticker));

// ---- amendments ----
const superseded = new Map(); // cik|ownerCik|tradeDate → earliest acceptedAt of a superseded original
for (const r of Pall) if (r.amend === "superseded") { const k = `${r.cik}|${r.insiderCik}|${r.tradeDate}`; if (!superseded.has(k) || r.acceptedAt < superseded.get(k)) superseded.set(k, r.acceptedAt); }
const droppedAmend = [];
const P = Pall.filter((r) => {
  if (r.amend !== "amends") return true;
  const k = `${r.cik}|${r.insiderCik}|${r.tradeDate}`;
  if (superseded.has(k) && superseded.get(k) <= r.acceptedAt) { droppedAmend.push(r.acc); return false; }
  return true;
});

// ---- filings ----
const usdOfRow = (r) => (r.priceCheck === "anomaly" || !(r.value > 0) ? null : r.value);
const filings = [];
for (const [acc, rows] of group(P, (r) => r.acc)) {
  const r0 = rows[0];
  const names = ownerNames(r0.insider);
  const roles = rolesOfText(r0.role);
  const usds = rows.map(usdOfRow);
  const usd = usds.reduce((a, v) => a + (v || 0), 0);
  const largest = [...rows].sort((a, b) => (usdOfRow(b) || 0) - (usdOfRow(a) || 0))[0];
  const tds = rows.map((r) => r.tradeDate).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "")).sort();
  const owns = new Set(rows.map((r) => r.own));
  const hold = holdingsOf(rows);
  const tk = rows.find((r) => r.ticker)?.ticker || null;
  const c = fc[acc] || null;
  filings.push({
    acc, cik: r0.cik, ticker: tk, sym: tk ? sym(tk) : cik2sym.get(r0.cik) || null, acceptedAt: r0.acceptedAt, form: r0.form,
    insiderCik: r0.insiderCik || null, names, role: r0.role || null, roles: [...roles], primaryRole: primaryRole(roles),
    own: owns.size === 1 ? [...owns][0] : "mixed", natures: [...new Set(rows.map((r) => r.nature).filter(Boolean))].join(" | ").slice(0, 120) || null,
    cls: c?.cls || "unclassified", omBasis: c?.omBasis || null, stated: c?.stated || null,
    usd: r4(usd), usdMissing: usds.some((v) => v == null), rows: rows.length, shares: rows.reduce((a, r) => a + (r.shares || 0), 0),
    priceLargest: largest.price ?? null, tradeDateLargest: largest.tradeDate || null,
    tradeDateMin: tds[0] || null, tradeDateMax: tds.at(-1) || null,
    delayDays: tds.length ? dnum(r0.acceptedAt) - dnum(tds.at(-1)) : null, delayDaysFirst: tds.length ? dnum(r0.acceptedAt) - dnum(tds[0]) : null,
    plan10b5: rows.some((r) => r.plan), amend: [...new Set(rows.map((r) => r.amend).filter(Boolean))].join("+") || null,
    holdValid: hold.holdValid, sharesBought: hold.sharesBought, priorHoldings: hold.priorHoldings, holdingsAfter: hold.holdingsAfter, pctOfPrior: hold.pctOfPrior, priorNearZero: hold.priorNearZero,
    keys: [...new Set([r0.insiderCik ? `cik:${Number(r0.insiderCik)}` : null, ...names.map((n) => `name:${normName(n)}`)].filter(Boolean))],
    sigs: rows.filter((r) => r.shares != null && r.after != null && /^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "")).map((r) => ({ sig: `${r.tradeDate}|${r.shares}|${r.price ?? "np"}|${r.after}`, own: r.own })),
  });
}
filings.sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.acc.localeCompare(b.acc));
const filingByAcc = new Map(filings.map((f) => [f.acc, f]));

// ---- entry session (structure only: does a bar exist on the entry date?) ----
const entryMemo = new Map();
const entryOf = (T) => { if (!entryMemo.has(T)) entryMemo.set(T, entrySessionAfter(T, 60)); return entryMemo.get(T); };
const pricedOf = (f) => { const s = f.sym ? bars.get(f.sym) : null; if (!s) return "no_bars"; return s.idx.has(entryOf(f.acceptedAt)) ? "ok" : "no_entry_bar"; };
for (const f of filings) { f.entryDate = entryOf(f.acceptedAt); f.priced = pricedOf(f); }

// ---- insiders known (P any class + S), per issuer, by acceptance ----
const insRows = new Map();
for (const r of [...P, ...Sall]) (insRows.get(r.cik) || insRows.set(r.cik, []).get(r.cik)).push([r.acceptedAt, r.insiderCik || r.insider]);
for (const xs of insRows.values()) xs.sort((a, b) => a[0].localeCompare(b[0]));

const inU = { om: (f) => f.cls === "om", allp: () => true };
const UNIVERSES = ["om", "allp"], GROUPINGS = ["cal", "roll"];
const signals = []; // position signals (one per new buyer)
const fseq = []; // filing-level sequence records (new and repeat filings)
const ufByCik = new Map();
const monthStartOf = (T) => `${T.slice(0, 7)}-01`;
const prevMonthOf = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
const gapIn = (fromDay, toDay) => GAP_DAYS.filter((d) => d >= fromDay && d <= toDay);

for (const [cik, fsC] of group(filings, (f) => f.cik)) {
  const uf = new UF(); ufByCik.set(cik, uf);
  const sigSeen = new Map();
  const hist = { om: [], allp: [] };
  const monthSignals = { om: new Map(), allp: new Map() }; // month → position signals (cal) for eventual stats
  const monthFseq = { om: new Map(), allp: new Map() };
  const ins = insRows.get(cik) || []; let ip = 0; const insSet = new Set();
  const byT = group(fsC, (f) => f.acceptedAt);
  const times = [...byT.keys()].sort();
  let curMonth = null;
  const finalizeMonth = (M) => {
    for (const u of UNIVERSES) {
      const mem = hist[u].filter((h) => h.acceptedAt.slice(0, 7) === M);
      if (!mem.length) continue;
      const tot = new Map(); for (const h of mem) { const r = uf.find(h.keys[0]); tot.set(r, (tot.get(r) || 0) + (h.usd || 0)); }
      const vals = [...tot.values()].sort((a, b) => b - a), mx = vals[0];
      const maxFiling = Math.max(...mem.map((h) => h.usd || 0));
      const acc = mem.reduce((a, h) => a + (h.usd || 0), 0);
      for (const s of monthSignals[u].get(M) || []) {
        const r = uf.find(filingByAcc.get(s.acc).keys[0]); const t = tot.get(r) ?? null;
        Object.assign(s, { eventualBuyers: tot.size, eventualAccumUsd: r4(acc), eventualBuyerMonthUsd: r4(t), isEventualLargest: t != null && t === mx && mx > 0, eventualRankUsd: t == null ? null : vals.indexOf(t) + 1,
          eventualMaxPosition: Math.max(...(monthSignals[u].get(M) || []).map((x) => x.position)) });
      }
      for (const x of monthFseq[u].get(M) || []) Object.assign(x, { isEventualLargestFiling: (filingByAcc.get(x.acc).usd || 0) === maxFiling && maxFiling > 0, eventualBuyers: tot.size });
    }
  };
  for (const T of times) {
    const M = T.slice(0, 7);
    if (curMonth && M !== curMonth) finalizeMonth(curMonth);
    curMonth = M;
    const atT = byT.get(T).sort((a, b) => (b.usd || 0) - (a.usd || 0) || a.acc.localeCompare(b.acc));
    // identity evidence known at T
    for (const f of atT) {
      for (const k of f.keys) uf.add(k);
      for (let i = 1; i < f.keys.length; i++) uf.union(f.keys[0], f.keys[i]);
      for (const s of f.sigs) {
        const prev = sigSeen.get(s.sig) || [];
        for (const p of prev) if (p.f.acc !== f.acc && (p.own === "I" || s.own === "I")) uf.union(p.f.keys[0], f.keys[0]);
        prev.push({ f, own: s.own }); sigSeen.set(s.sig, prev);
      }
    }
    while (ip < ins.length && ins[ip][0] <= T) { insSet.add(String(ins[ip][1])); ip++; }
    const Tms = tsMs(T);
    for (const u of UNIVERSES) {
      const cur = atT.filter(inU[u]);
      if (!cur.length) continue;
      // universe-level "distinct insiders known at publication" (independent of grouping)
      const rootsHist = new Set([...hist[u], ...cur].map((h) => uf.find(h.keys[0])));
      const rootsWin30 = new Set([...hist[u].filter((h) => tsMs(h.acceptedAt) >= Tms - 30 * DAY), ...cur].map((h) => uf.find(h.keys[0])));
      const prevM = prevMonthOf(M);
      const prevMonthBuyers = new Set(hist[u].filter((h) => h.acceptedAt.slice(0, 7) === prevM).map((h) => uf.find(h.keys[0]))).size;
      for (const g of GROUPINGS) {
        const winStartMs = g === "cal" ? tsMs(`${monthStartOf(T)} 00:00:00`) : Tms - 30 * DAY;
        const winStartDay = g === "cal" ? monthStartOf(T) : msToTs(winStartMs).slice(0, 10);
        const before = hist[u].filter((h) => (g === "cal" ? h.acceptedAt.slice(0, 7) === M : tsMs(h.acceptedAt) >= winStartMs));
        const bRoots = new Map();
        for (const h of before) { const r = uf.find(h.keys[0]); const e = bRoots.get(r) || { usd: 0, first: h.acceptedAt, n: 0 }; e.usd += h.usd || 0; e.n++; if (h.acceptedAt < e.first) e.first = h.acceptedAt; bRoots.set(r, e); }
        const firstAt = before.length ? before.reduce((m, h) => (h.acceptedAt < m ? h.acceptedAt : m), before[0].acceptedAt) : T;
        const cRoots = new Map(); for (const f of cur) { const r = uf.find(f.keys[0]); (cRoots.get(r) || cRoots.set(r, []).get(r)).push(f); }
        const usdR = (xs) => xs.reduce((a, f) => a + (f.usd || 0), 0);
        const newR = [...cRoots.entries()].filter(([r]) => !bRoots.has(r)).sort((a, b) => usdR(b[1]) - usdR(a[1]) || a[1][0].acc.localeCompare(b[1][0].acc));
        const nBefore = bRoots.size;
        const prevTot = [...bRoots.values()].map((e) => e.usd);
        const prevMax = prevTot.length ? Math.max(...prevTot) : null, prevMean = prevTot.length ? mean(prevTot) : null;
        const accBefore = before.reduce((a, h) => a + (h.usd || 0), 0), accAfter = accBefore + cur.reduce((a, f) => a + (f.usd || 0), 0);
        const buyersSoFar = new Set([...bRoots.keys(), ...cRoots.keys()]).size;
        const maxFilingBefore = before.length ? Math.max(...before.map((h) => h.usd || 0)) : null;
        const gaps = gapIn(winStartDay, T.slice(0, 10));
        const truncated = g === "roll" && winStartMs < tsMs(`${STORE_START} 00:00:00`);
        const common = { grouping: g, universe: u, cik, T, month: M, period: periodOfDate(T), nBefore, buyersSoFar, prevMaxUsd: r4(prevMax), prevMeanUsd: r4(prevMean),
          accumUsdBefore: r4(accBefore), accumUsd: r4(accAfter), gapDaysInWindow: gaps.length, windowTruncated: truncated,
          buyers30d: rootsWin30.size, buyersHist: rootsHist.size, insidersKnown: insSet.size, prevMonthBuyers: g === "cal" ? prevMonthBuyers : null };
        newR.forEach(([r, xs], i) => {
          const rep = xs[0];
          const usd = usdR(xs);
          const owns = new Set(xs.map((f) => f.own));
          const s = {
            ...common, acc: rep.acc, accs: xs.map((f) => f.acc).join("+"), sym: rep.sym, entryDate: rep.entryDate, priced: rep.priced,
            position: nBefore + i + 1, tieSize: newR.length, tieRank: i + 1,
            usd: r4(usd), usdMissing: xs.some((f) => f.usdMissing), shares: xs.reduce((a, f) => a + (f.shares || 0), 0),
            pctOfPrior: rep.pctOfPrior, priorNearZero: rep.priorNearZero, holdValid: rep.holdValid, holdingsAfter: rep.holdingsAfter,
            role: rep.role, primaryRole: rep.primaryRole, roles: rep.roles.join("+"), own: owns.size === 1 ? [...owns][0] : "mixed", names: rep.names.join("; ").slice(0, 160), insiderCik: rep.insiderCik,
            cls: rep.cls, clsAll: [...new Set(xs.map((f) => f.cls))].join("+"), omBasis: rep.omBasis, plan10b5: xs.some((f) => f.plan10b5),
            ratioPrevMax: prevMax > 0 ? r4(usd / prevMax) : null, ratioPrevMean: prevMean > 0 ? r4(usd / prevMean) : null,
            isLargestSoFar: nBefore === 0 ? null : usd >= prevMax, largestInTie: i === 0,
            daysSinceFirst: nBefore === 0 ? 0 : r4((Tms - tsMs(firstAt)) / DAY), firstAt: nBefore === 0 ? T : firstAt,
            delayDays: rep.delayDays, delayDaysFirst: rep.delayDaysFirst, tradeDateMin: rep.tradeDateMin, tradeDateMax: rep.tradeDateMax, tradeDateLargest: rep.tradeDateLargest, priceLargest: rep.priceLargest,
          };
          signals.push(s);
          if (g === "cal") { const arr = monthSignals[u].get(M) || []; arr.push(s); monthSignals[u].set(M, arr); }
        });
        // filing-level records (new + repeat), for the "largest purchase so far" lens and the all-purchase baseline
        const rankByFirst = [...bRoots.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first)).map(([r]) => r);
        for (const f of cur) {
          const r = uf.find(f.keys[0]);
          const isNew = !bRoots.has(r);
          const x = { ...common, acc: f.acc, sym: f.sym, entryDate: f.entryDate, priced: f.priced, isNew,
            position: isNew ? nBefore + newR.findIndex(([rr]) => rr === r) + 1 : rankByFirst.indexOf(r) + 1,
            seqIndex: before.length + 1, usd: f.usd, usdMissing: f.usdMissing, largestFilingSoFar: before.length ? (f.usd || 0) > maxFilingBefore : null,
            personUsdBefore: isNew ? 0 : r4(bRoots.get(r).usd), primaryRole: f.primaryRole, own: f.own, cls: f.cls };
          fseq.push(x);
          if (g === "cal") { const arr = monthFseq[u].get(M) || []; arr.push(x); monthFseq[u].set(M, arr); }
        }
      }
      hist[u].push(...cur);
    }
  }
  if (curMonth) finalizeMonth(curMonth);
}

// ---- descriptive variant: trade-date order within the trade-date month (om universe; final identities) ----
const omFilings = filings.filter((f) => f.cls === "om");
const omRowsByKey = new Map(); // cik|tradeMonth → [{ f, tradeDate }]
const Pom = P.filter((r) => filingByAcc.get(r.acc)?.cls === "om");
for (const r of Pom) { if (!/^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "")) continue; const k = `${r.cik}|${r.tradeDate.slice(0, 7)}`; (omRowsByKey.get(k) || omRowsByKey.set(k, []).get(k)).push({ f: filingByAcc.get(r.acc), td: r.tradeDate }); }
const tradeOrder = []; let groupsMulti = 0, groupsDisagree = 0, buyersMulti = 0, buyersDisagree = 0, kendallDisc = 0, kendallPairs = 0;
for (const [k, xs] of omRowsByKey) {
  const [cikS, tm] = k.split("|"); const cik = Number(cikS);
  if (tm < "2025-12" || tm > "2026-07") continue; // edges truncated: Nov trades filed before Dec 1 / Aug trades filed in the holdout
  const uf = ufByCik.get(cik);
  const per = new Map();
  for (const { f, td } of xs) {
    const r = uf.find(f.keys[0]); const e = per.get(r) || { root: r, firstTrade: td, firstPub: f.acceptedAt, firstAcc: f.acc, usd: 0, accs: new Set() };
    if (td < e.firstTrade) e.firstTrade = td;
    if (f.acceptedAt < e.firstPub || (f.acceptedAt === e.firstPub && f.acc < e.firstAcc)) { e.firstPub = f.acceptedAt; e.firstAcc = f.acc; }
    if (!e.accs.has(f.acc)) { e.accs.add(f.acc); e.usd += f.usd || 0; }
    per.set(r, e);
  }
  const B = [...per.values()];
  const byTrade = [...B].sort((a, b) => a.firstTrade.localeCompare(b.firstTrade) || a.firstPub.localeCompare(b.firstPub));
  const byPub = [...B].sort((a, b) => a.firstPub.localeCompare(b.firstPub) || a.firstTrade.localeCompare(b.firstTrade));
  byTrade.forEach((e, i) => { e.tradePos = i + 1; }); byPub.forEach((e, i) => { e.pubPos = i + 1; });
  if (B.length >= 2) {
    groupsMulti++; buyersMulti += B.length;
    const dis = B.filter((e) => e.tradePos !== e.pubPos).length; buyersDisagree += dis; if (dis) groupsDisagree++;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) { kendallPairs++; if (Math.sign(B[i].tradePos - B[j].tradePos) !== Math.sign(B[i].pubPos - B[j].pubPos)) kendallDisc++; }
  }
  for (const e of B) { const f = filingByAcc.get(e.firstAcc); tradeOrder.push({ cik, tradeMonth: tm, acc: e.firstAcc, sym: f.sym, T: f.acceptedAt, period: periodOfDate(f.acceptedAt), tradePos: e.tradePos, pubPos: e.pubPos, buyers: B.length, firstTrade: e.firstTrade, usd: r4(e.usd), primaryRole: f.primaryRole, entryDate: f.entryDate, priced: f.priced }); }
}

// ---- summaries (counts only) ----
const bucket = (k) => (k >= 11 ? "11+" : k >= 8 ? "8-10" : k >= 6 ? "6-7" : String(k));
const BUCKETS = ["1", "2", "3", "4", "5", "6-7", "8-10", "11+"];
const countTable = (xs) => {
  const out = {};
  for (const g of GROUPINGS) for (const u of UNIVERSES) for (const p of ["discover", "confirm"]) {
    const ss = xs.filter((s) => s.grouping === g && s.universe === u && s.period === p && !(g === "roll" && s.windowTruncated));
    out[`${g}|${u}|${p}`] = Object.fromEntries(BUCKETS.map((b) => { const z = ss.filter((s) => bucket(s.position) === b); const zp = z.filter((s) => s.priced === "ok"); return [b, { n: z.length, priced: zp.length, issuers: new Set(zp.map((s) => s.cik)).size }]; }));
    out[`${g}|${u}|${p}`].exact = Object.fromEntries([...group(ss.filter((s) => s.priced === "ok"), (s) => s.position).entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, v.length]));
  }
  return out;
};
const cnt = (arr, f) => arr.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
const calOm = signals.filter((s) => s.grouping === "cal" && s.universe === "om");
const summary = {
  builtAt: new Date().toISOString(), secRowsBuiltAt: sec.builtAt,
  rows: { P: Pall.length, S: Sall.length, droppedAmendments: droppedAmend.length },
  filings: { all: filings.length, byClass: cnt(filings, (f) => f.cls), priced: cnt(filings, (f) => f.priced), byPeriod: cnt(filings, (f) => periodOfDate(f.acceptedAt)) },
  identity: { multiOwnerFilings: filings.filter((f) => f.names.length > 1).length },
  signals: { total: signals.length, byGroupingUniverse: cnt(signals, (s) => `${s.grouping}|${s.universe}`), ties: cnt(signals.filter((s) => s.tieSize > 1), (s) => `${s.grouping}|${s.universe}`) },
  fseq: { total: fseq.length, repeats: cnt(fseq.filter((x) => !x.isNew), (x) => `${x.grouping}|${x.universe}`) },
  positionCounts: countTable(signals),
  calOmMonths: { issuerMonths: new Set(calOm.map((s) => `${s.cik}|${s.month}`)).size, eventualBuyersDist: cnt([...group(calOm, (s) => `${s.cik}|${s.month}`).values()].map((xs) => xs[0].eventualBuyers), (v) => Math.min(v, 11)) },
  calOmRoles: cnt(calOm, (s) => `${bucket(s.position)}|${s.primaryRole}`),
  calOmOwn: cnt(calOm, (s) => `${bucket(s.position)}|${s.own}`),
  calOmGaps: cnt(calOm, (s) => (s.gapDaysInWindow ? "gapInWindow" : "clean")),
  tradeOrder: { groupsWith2plus: groupsMulti, groupsOrderDiffers: groupsDisagree, shareGroupsDiffer: r4(groupsDisagree / groupsMulti), buyersIn2plus: buyersMulti, buyersPositionDiffers: buyersDisagree, shareBuyersDiffer: r4(buyersDisagree / buyersMulti), pairsDiscordant: r4(kendallDisc / kendallPairs), pairs: kendallPairs },
  medianUsdByPosition: Object.fromEntries(BUCKETS.map((b) => [b, r4(median(calOm.filter((s) => bucket(s.position) === b && s.usd > 0).map((s) => s.usd)))])),
  ms: Date.now() - t0,
};
writeOut("filings.json", filings.map(({ keys, sigs, ...f }) => f));
writeOut("signals.json", signals);
writeOut("filing-seq.json", fseq);
writeOut("trade-order.json", tradeOrder);
writePretty("build-summary.json", summary);
console.log(JSON.stringify(summary, null, 1));
