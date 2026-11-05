// deep4/audit/a2_identity.mjs — Phase A item 2: insider identity. The panel's `person` is the app rule (union-find of co-reporting
// owner keys + confirmed duplicates) built STORE-WIDE (Dec 2025 – Nov 2026), i.e. with links that may only become known after a
// filing's decision time. Rebuild a POINT-IN-TIME union-find from the raw Form-4 shards (only shards dated <= 2026-08-31 are read;
// records accepted >= 2026-09-01 are dropped) and quantify the effect on person-history features and on the behaviour selections
// that use them (A04 multi-company, S1x first observed, repeat flags, person track-record coverage).
//   node --max-old-space-size=8192 scripts/research/deep4/audit/a2_identity.mjs
import fs from "node:fs";
import path from "node:path";
import { phaseA, L4, loadP, writeOut, checkpoint, mean, r4, r6, group, countBy, fin, isPrimaryPurchase, cstats } from "./common.mjs";

phaseA();
const t0 = Date.now();
const STORE = path.join(process.cwd(), ".cache", "backfill", "form4");
const shards = fs.readdirSync(STORE).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n) && n.slice(0, 10) <= "2026-08-31").sort();
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const keyOf = (o) => (o?.cik ? `cik:${Number(o.cik)}` : o?.name ? `name:${normName(o.name)}` : null);
// link events: { at, keys[] } from every code P/S transaction's owner list (the app rule unions ownersOf(r) of P/S rows)
const links = [];
let recN = 0, txN = 0;
for (const n of shards) {
  const s = JSON.parse(fs.readFileSync(path.join(STORE, n), "utf8"));
  for (const rec of Object.values(s.records || {})) {
    const at = String(rec.acceptedAtET || "").replace(/\s*ET$/, "");
    if (!at || at >= L4.EXPOSED_START) continue; recN++;
    for (const t of rec.transactions || []) {
      const code = t.code ?? t.transactionCode; if (code !== "P" && code !== "S") continue; txN++;
      const owners = t.owners?.length ? t.owners : [{ cik: t.insiderCik, name: t.insiderName }];
      const keys = [...new Set(owners.map(keyOf).filter(Boolean))];
      if (keys.length) links.push({ at: String(t.acceptedAt || at).replace(/\s*ET$/, "") || at, keys });
    }
  }
}
links.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
console.log(`shards ${shards.length}, records ${recN}, P/S transactions ${txN}, link events ${links.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
// union-find (same tie rule as services/edgar/insiderInsights.buildIdentities: root = lexicographically smaller key)
function UF() { const parent = new Map(); const find = (k) => { let p = parent.get(k) ?? k; while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p; return p; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); }; const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); }; return { find, add, union }; }
const P = loadP(["design", "confirm"]);
const rows = [...P.rows].sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : a.key < b.key ? -1 : 1));
// owner key of a panel row: the p-filings first owner CIK (panel ownerCik), else the person key itself
const ownKey = (r) => (r.ownerCik ? `cik:${Number(r.ownerCik)}` : r.person);
// final (visible, through 2026-08-31) union-find
const UFall = UF(); for (const l of links) { l.keys.forEach(UFall.add); for (let i = 1; i < l.keys.length; i++) UFall.union(l.keys[0], l.keys[i]); }
// partition comparison panel person vs visible-final union-find over panel rows
const byPanel = group(rows, (r) => r.person), byMine = group(rows, (r) => UFall.find(ownKey(r)));
const panelSplit = [...byPanel.values()].filter((xs) => new Set(xs.map((r) => UFall.find(ownKey(r)))).size > 1);
const mineSplit = [...byMine.values()].filter((xs) => new Set(xs.map((r) => r.person)).size > 1);
// point-in-time pass
const PIT = UF(); let li = 0;
const pit = new Map();
const panelGroups = group(rows, (r) => r.person);
const idxInGroup = new Map(); for (const xs of panelGroups.values()) xs.forEach((r, i) => idxInGroup.set(r.key, i));
for (const e of rows) {
  while (li < links.length && links[li].at <= e.publishedAt) { const l = links[li++]; l.keys.forEach(PIT.add); for (let i = 1; i < l.keys.length; i++) PIT.union(l.keys[0], l.keys[i]); }
  PIT.add(ownKey(e));
  const me = PIT.find(ownKey(e));
  const grp = panelGroups.get(e.person), i = idxInGroup.get(e.key);
  // earlier rows of the same panel person, and whether they are linked to e AT e's acceptance
  const prior = grp.slice(0, i).filter((g) => g.publishedAt < e.publishedAt);
  const linked = prior.filter((g) => PIT.find(ownKey(g)) === me);
  pit.set(e.key, { prior, linked });
}
// compare features
const cmp = { rows: rows.length, rowsWithPrior: 0, rowsWithUnlinkedPrior: 0, pPriorDiff: 0, pFirstEverFlip: 0, pPriorCoDiff: 0, pCompaniesDiff: 0, repeatCoFlip: 0, storedPriorMismatch: 0 };
const flipRows = [];
for (const e of rows) {
  const { prior, linked } = pit.get(e.key);
  if (prior.length !== e.pPrior) cmp.storedPriorMismatch++;
  if (prior.length) cmp.rowsWithPrior++;
  if (linked.length !== prior.length) { cmp.rowsWithUnlinkedPrior++; cmp.pPriorDiff++; }
  const fe0 = prior.length ? 0 : 1, fe1 = linked.length ? 0 : 1; if (fe0 !== fe1) { cmp.pFirstEverFlip++; flipRows.push(e); }
  const co0 = prior.filter((g) => g.cik === e.cik).length, co1 = linked.filter((g) => g.cik === e.cik).length;
  if (co0 !== co1) cmp.pPriorCoDiff++; if ((co0 > 0) !== (co1 > 0)) cmp.repeatCoFlip++;
  const c0 = new Set([...prior.map((g) => g.cik), e.cik]).size, c1 = new Set([...linked.map((g) => g.cik), e.cik]).size; if (c0 !== c1) cmp.pCompaniesDiff++;
}
const prim = rows.filter(isPrimaryPurchase);
const primAff = { primary: prim.length, primaryWithUnlinkedPrior: prim.filter((e) => { const p = pit.get(e.key); return p.linked.length !== p.prior.length; }).length,
  primaryFirstEverFlip: prim.filter((e) => flipRows.includes(e)).length };
// behaviour selections that depend on identity: S1x (pFirstEver = 1) and A04 (prior open-market valued primary purchase at another issuer)
const om = (g) => g.cls === "om" && g.valued === 1 && g.isPrimary === 1;
const sel = {};
for (const seg of ["design", "confirm"]) {
  const E = prim.filter((e) => e.segment === seg && fin(e.B_xsNet30) != null);
  const S = (f) => { const xs = E.filter(f); const cs = cstats(xs.map((e) => ({ issuer: e.cik, x: e.B_xsNet30, month: e.month }))); const d = xs.filter((e) => fin(e.C_xsNet30) != null);
    return { n: cs.n, mean: cs.mean, t: cs.t, p: cs.p, vsCtl: r4(mean(d.map((e) => e.B_xsNet30 - e.C_xsNet30))) }; };
  sel[seg] = {
    S1x_panel: S((e) => e.pFirstEver === 1), S1x_PIT: S((e) => pit.get(e.key).linked.length === 0),
    A04_panel: S((e) => new Set([...pit.get(e.key).prior.filter(om).map((g) => g.cik), e.cik]).size >= 2),
    A04_PIT: S((e) => new Set([...pit.get(e.key).linked.filter(om).map((g) => g.cik), e.cik]).size >= 2),
    repeat_panel: S((e) => pit.get(e.key).prior.some((g) => g.cik === e.cik)), repeat_PIT: S((e) => pit.get(e.key).linked.some((g) => g.cik === e.cik)),
  };
}
// person 30-day track-record coverage (matured primary items) under each identity
const cov = {};
for (const seg of ["design", "confirm"]) {
  const E = prim.filter((e) => e.segment === seg);
  const nMat = (xs, e) => xs.filter((g) => isPrimaryPurchase(g) && g.B_end30 && g.B_end30 < e.decisionAt.slice(0, 10) && fin(g.B_xsNet30) != null).length;
  let a = 0, b = 0, diff = 0; for (const e of E) { const x = nMat(pit.get(e.key).prior, e), y = nMat(pit.get(e.key).linked, e); if (x >= 1) a++; if (y >= 1) b++; if (x !== y) diff++; }
  cov[seg] = { events: E.length, withMaturedRecordPanelIdentity: a, withMaturedRecordPIT: b, eventsWhoseRecordDiffers: diff };
}
const out = { builtAt: new Date().toISOString(), shardsRead: shards.length, lastShard: shards.at(-1), recordsAcceptedBeforeExposed: recN, psTransactions: txN, linkEvents: links.length,
  partition: { panelPersons: byPanel.size, visibleUnionFindPersons: byMine.size, panelPersonsSplitByVisibleUF: panelSplit.length, visibleUFGroupsMergingPanelPersons: mineSplit.length,
    note: "a panel person split by the visible union-find = a link that needs confirmed-duplicate evidence or a filing accepted >= 2026-09-01 (store-wide build)",
    splitExamples: panelSplit.slice(0, 6).map((xs) => ({ person: xs[0].person, rows: xs.length, owners: [...new Set(xs.map((r) => r.ownerName))].slice(0, 5), firstAt: xs[0].publishedAt })) },
  featureComparison: cmp, primaryAffected: primAff, selections: sel, personRecordCoverage: cov, elapsedSec: (Date.now() - t0) / 1000 };
writeOut("a2-identity.json", out);
checkpoint("a2_identity", { elapsedSec: out.elapsedSec });
console.log(JSON.stringify({ partition: { ...out.partition, splitExamples: undefined }, cmp, primAff, sel, cov }, null, 1));
