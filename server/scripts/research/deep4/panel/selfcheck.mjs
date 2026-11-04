// deep4/panel/selfcheck.mjs — validation of the deep-4 panel (agent "panel"). No hypothesis is evaluated here.
//   node --max-old-space-size=6144 scripts/research/deep4/panel/selfcheck.mjs
// Sections:
//   A structural invariants (panel + controls)          E hand spot-checks from the RAW bar file (independent code)
//   B self-test segment path vs panel.json               F stage-C (deep 1) reproduction on design events
//   C perturbation leakage test (future bars)            G split / reverse-split names (as-traded vs adjusted)
//   D independent recomputation of person / cluster      H unit-test files + deep-3 validate.mjs synthetic checks
// Output: .cache/research/deep4/panel/selfcheck.json (+ selfcheck-spotchecks.json)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as PL from "./panelLib.mjs";
import { loadPanel, loadControls } from "./data.mjs";
import { OUT_DIR } from "../../lib.mjs";
import { loadEvents } from "../../deep2/lib2.mjs";

const { L4, cnt, mean } = PL;
const t0 = Date.now();
const log = (...a) => console.log(`[SELFCHECK ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const res = { ranAt: new Date().toISOString(), sections: {} };
const fail = []; const note = (sec, ok, msg, extra = {}) => { (res.sections[sec] ||= { checks: [] }).checks.push({ ok, msg, ...extra }); if (!ok) fail.push(`${sec}: ${msg}`); };
const eq = (a, b, eps = 1e-6) => (a == null && b == null) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b))) || a === b;
let seed = 4242; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const sample = (arr, k) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };

const P = loadPanel({ agent: "panel", segments: ["design"] });
const C = loadControls({ agent: "panel", segments: ["design"] });
const rows = P.rows, meta = P.meta.design, TH = meta.regimeThresholds;
const byKey = new Map(rows.map((r) => [r.key, r]));
const M = PL.createMarket({ cutoff: L4.DESIGN_END });
log(`panel rows ${rows.length}, control rows ${C.rows.size}`);

// ======================= A. structural invariants =======================
{
  const S = "A_structural";
  note(S, new Set(rows.map((r) => r.key)).size === rows.length, "unique event keys");
  note(S, rows.every((r) => r.segment === "design" && r.publishedAt < L4.DESIGN_END), "every row is design-segment (published < 2026-06-15)");
  let v = 0; const ex = [];
  const bad = (k, why) => { v++; if (ex.length < 10) ex.push({ key: k, why }); };
  for (const r of rows) {
    for (const H of PL.CAL_H) {
      if (r[`B_st${H}`] === "ok" && !(r[`B_end${H}`] < L4.DESIGN_END && r[`B_end${H}`] >= r.B_entryDate)) bad(r.key, `B_end${H}`);
      if (r[`B_st${H}`] !== "ok" && r[`B_xsNet${H}`] != null) bad(r.key, `B_xsNet${H} without ok status`);
      if (r[`B_st${H}`] === "embargo" && (r[`B_hit10_${H}`] != null || r[`B_mfe${H}`] != null || r[`B_lim10_${H}`] != null)) bad(r.key, `embargoed path stats ${H}`);
      if (r[`A_st${H}`] === "ok" && !(r[`A_end${H}`] < L4.DESIGN_END && r[`A_end${H}`] > r.tradeDate)) bad(r.key, `A_end${H}`);
    }
    for (const N of PL.SESS_N) if (r[`B_sSt${N}`] === "ok" && !(r[`B_sEnd${N}`] < L4.DESIGN_END)) bad(r.key, `B_sEnd${N}`);
    if (r.B_status === "ok" && !(r.B_entryDate < L4.DESIGN_END && r.B_entryDate === r.entryDate)) bad(r.key, "entry");
    if (r.decDate != null && !(r.decDate < r.entryDate)) bad(r.key, "decDate >= entryDate");
    if (r.td_decDate != null && !(r.td_decDate < r.tradeDate)) bad(r.key, "td_decDate >= tradeDate");
    if (r.decStale != null && r.decStale < 0) bad(r.key, "decStale < 0");
    if (r.B_tt10obs === 1 && !(r.B_tt10s >= 0)) bad(r.key, "tt10");
    if (r.entryDate <= r.decisionDate && !(r.decisionAt.slice(11) <= "09:28:00")) bad(r.key, "entry on decision day after the MOO cut-off");
    if (r.C_n > 10) bad(r.key, "C_n > 10");
  }
  note(S, v === 0, `outcome / feature date invariants (${v} violations)`, { examples: ex });
  // controls
  let cv = 0; const cex = [];
  const blocked = PL.purchaseBlocks(M, JSON.parse(fs.readFileSync(path.join(PL.OUT, "panel-rows.json"), "utf8")).rows.map((x) => ({ ticker: x.ticker, cik: x.cik, acceptedAt: x.acceptedAt, tradeDate: x.tradeDate })), new Map(rows.filter((r) => r.sym).map((r) => [r.cik, r.sym])));
  for (const r of rows) for (const [k] of C.byEvent[r.key] || []) {
    const c = C.rows.get(k);
    const why = !c ? "missing control row" : c.segment !== "design" ? "segment" : !(c.entryDate < L4.DESIGN_END) ? "date" : c.entryMonth !== r.entryMonth ? "month" : c.sym === r.sym ? "own symbol" : c.tier !== r.tier ? "tier" : null;
    if (why) { cv++; if (cex.length < 5) cex.push({ ev: r.key, k, why }); continue; }
    const b = blocked.get(c.sym); const j = M.idx.get(c.entryDate); if (b && b[j]) { cv++; if (cex.length < 5) cex.push({ ev: r.key, k, why: "within ±20 sessions of a purchase mark (panel-rows)" }); }
  }
  note(S, cv === 0, `controls: same month/tier/segment, never own symbol, no purchase mark within ±20 sessions (${cv} violations)`, { examples: cex });
  note(S, Object.values(C.byEvent).every((xs) => xs.every(([k]) => C.rows.has(k))), "every control reference resolves");
  // fields the panel says are not features really are excluded from featureFields
  note(S, !meta.featureFields.some((f) => /^(B_|A_|C_|fut_)/.test(f) || ["insPriceAdj", "decCloseAdj", "td_decCloseAdj", "gapEntry", "gapEntryX"].includes(f)), "featureFields contain no outcome / future-derived / at-entry fields");
  res.sections[S].counts = { rows: rows.length, controls: C.rows.size, eventsWithControls: rows.filter((r) => r.C_n > 0).length };
  log("A done");
}

// ======================= B. self-test segment path (fake boundary inside design) =======================
{
  const S = "B_selftest_segments";
  const sd = path.join(PL.OUT, "selftest", "panel-design.json"), sc = path.join(PL.OUT, "selftest", "panel-confirm.json");
  if (!fs.existsSync(sd) || !fs.existsSync(sc)) note(S, false, "selftest files missing: run buildPanel.mjs --selftest-boundary=2026-03-16 first");
  else {
    const D = JSON.parse(fs.readFileSync(sd, "utf8")), Cf = JSON.parse(fs.readFileSync(sc, "utf8"));
    const B = D.meta.priceCutoff; // fake boundary
    note(S, D.rows.every((r) => r.publishedAt < B) && Cf.rows.every((r) => r.publishedAt >= B && r.publishedAt < L4.DESIGN_END), `rows split at the fake boundary ${B}`);
    note(S, D.rows.length + Cf.rows.length === rows.length, "fake design + fake confirm = all design rows");
    let leak = 0; for (const r of D.rows) for (const H of PL.CAL_H) { if (r[`B_st${H}`] === "ok" && !(r[`B_end${H}`] < B)) leak++; if (r[`A_st${H}`] === "ok" && !(r[`A_end${H}`] < B)) leak++; }
    note(S, leak === 0, `fake-design outcomes never reach the fake cutoff (${leak})`);
    const featF = meta.featureFields.filter((f) => !["C_n"].includes(f));
    let fm = 0, om = 0; const fex = [];
    for (const r of [...D.rows, ...Cf.rows]) { const p = byKey.get(r.key); for (const f of featF) if (!eq(r[f], p[f])) { fm++; if (fex.length < 5) fex.push({ key: r.key, f, selftest: r[f], panel: p[f] }); } }
    for (const r of Cf.rows) { const p = byKey.get(r.key); for (const f of [...meta.fieldGroups.B_FIELDS, ...meta.fieldGroups.A_FIELDS]) if (!eq(r[f], p[f])) om++; }
    note(S, fm === 0, `features identical whatever the cutoff (${fm} mismatches over ${featF.length} feature fields)`, { examples: fex });
    note(S, om === 0, `fake-confirm outcomes (cutoff 2026-06-15) identical to panel.json (${om} mismatches)`);
    const cD = JSON.parse(fs.readFileSync(path.join(PL.OUT, "selftest", "controls-design.json"), "utf8")), cC = JSON.parse(fs.readFileSync(path.join(PL.OUT, "selftest", "controls-confirm.json"), "utf8"));
    const iE = cD.fields.indexOf("entryDate"), iE2 = cC.fields.indexOf("entryDate");
    note(S, cD.rows.every((x) => x[iE] < B) && cC.rows.every((x) => x[iE2] >= B && x[iE2] < L4.DESIGN_END), "fake-design controls before the boundary, fake-confirm controls inside [boundary, 2026-06-15)");
  }
  log("B done");
}

// ======================= C. perturbation leakage test =======================
{
  const S = "C_perturbation";
  const bars0 = L4.loadBars();
  const featKeys = [...PL.MARKET_FIELDS, ...PL.REGIME_FIELDS];
  const priced = rows.filter((r) => r.featOk === 1);
  const dates = sample([...new Set(priced.map((r) => r.entryDate))], 14);
  const tdates = sample([...new Set(priced.filter((r) => r.td_featOk === 1).map((r) => r.tradeDate))], 10);
  let compared = 0, mism = 0; const ex = [];
  const perturbed = (D, mode) => {
    const m = new Map();
    for (const [s, ser] of bars0) {
      if (mode === "drop") { const arr = ser.arr.filter((b) => b.d < D); m.set(s, { arr, idx: new Map(arr.map((b, i) => [b.d, i])) }); }
      else { const arr = ser.arr.map((b) => (b.d >= D ? { d: b.d, o: b.o * (0.5 + rnd()), h: b.h * (1.5 + rnd()), l: b.l * (0.1 + 0.5 * rnd()), c: b.c * (0.3 + 2 * rnd()), v: Math.round(b.v * 10 * rnd()) } : b)); m.set(s, { arr, idx: ser.idx }); }
    }
    return m;
  };
  for (const [kind, list, field, prefix] of [["entry", dates, "entryDate", ""], ["trade", tdates, "tradeDate", "td_"]]) for (const D of list) for (const mode of ["scramble", "drop"]) {
    const Mp = PL.createMarket({ cutoff: L4.DESIGN_END, bars: perturbed(D, mode) });
    for (const r of priced.filter((x) => x[field] === D)) {
      const A = Mp.aligned(r.sym); const jDec = Mp.firstOnOrAfter(D) - 1;
      const f = { ...(PL.marketFeatures(Mp, A, jDec, prefix) || PL.blankMarket(prefix)), ...PL.regimeFeatures(Mp, TH, jDec, prefix) };
      // the panel stores values rounded to 6 decimals (PL.r6): recompute, round the same way, require exact equality
      for (const k of featKeys) { compared++; const kk = `${prefix}${k}`; if (PL.r6(f[kk]) !== r[kk] && !(f[kk] == null && r[kk] == null)) { mism++; if (ex.length < 8) ex.push({ key: r.key, kind, mode, D, field: kk, recomputed: f[kk], panel: r[kk] }); } }
    }
  }
  note(S, mism === 0, `features recomputed after scrambling / deleting every bar on/after the entry date (decision features) or trade date (td_ features), all symbols incl. SPY: ${compared} values compared, ${mism} differ`, { examples: ex, dates, tdates });
  // gapEntry is the only market field allowed to use the entry-session open; it must change when the entry bar changes
  log("C done");
}

// ======================= D. independent recomputation of person / cluster features =======================
{
  const S = "D_person_cluster";
  const sec = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep2", "sec-rows.json"), "utf8"));
  const Svis = L4.visible(sec.rows, (r) => r.acceptedAt, "panel").filter((r) => r.code === "S"); sec.rows = null;
  const pf = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep3", "dataquality", "p-filings.json"), "utf8"));
  const pfv = L4.visible(pf.rows, (r) => r.publishedAt, "panel"); pf.rows = null;
  const cikPerson = new Map(); for (const p of pfv) if (p.ownerCik && p.person) cikPerson.set(Number(p.ownerCik), p.person);
  const who = (r) => { const c = Number(r.insiderCik); return c ? cikPerson.get(c) || `cik:${c}` : `name:${String(r.insider || "").toLowerCase()}`; };
  const minus30 = (T) => `${PL.addDays(T.slice(0, 10), -30)}${T.slice(10)}`;
  let comp = 0, mm = 0; const ex = [];
  for (const r of sample(rows, 500)) {
    const t = r.decisionAt, f30 = minus30(t);
    const mine = rows.filter((x) => x.person === r.person && x.publishedAt < r.publishedAt);
    const iss = rows.filter((x) => x.cik === r.cik && x.publishedAt < t && x.key !== r.key);
    const s30 = Svis.filter((x) => Number(x.cik) === r.cik && x.acceptedAt < t && x.acceptedAt >= f30);
    const exp = {
      pPrior: mine.length, pPriorCo: mine.filter((x) => x.cik === r.cik).length, pCompanies: new Set([...mine.map((x) => x.cik), r.cik]).size,
      pDaysSincePrev: mine.length ? PL.daysBetween(mine.at(-1).publishedAt, r.publishedAt) : null,
      oBuyers30: new Set(iss.filter((x) => x.publishedAt >= f30 && x.person !== r.person).map((x) => x.person)).size,
      oBuyersPrior: new Set(iss.filter((x) => x.person !== r.person).map((x) => x.person)).size,
      sellers30: new Set(s30.map(who)).size, sellers30np: new Set(s30.filter((x) => !x.plan).map(who)).size,
      sellUsd30: s30.reduce((a, x) => a + (x.priceCheck !== "anomaly" && x.value > 0 ? x.value : 0), 0),
    };
    for (const [k, v] of Object.entries(exp)) { comp++; if (!eq(v, r[k], 1e-6)) { mm++; if (ex.length < 8) ex.push({ key: r.key, k, independent: v, panel: r[k] }); } }
  }
  note(S, mm === 0, `500 random events, person / issuer / seller context recomputed independently from filings accepted before t: ${comp} values, ${mm} differ`, { examples: ex });
  log("D done");
}

// ======================= E. hand spot-checks from the raw bar file (independent, naive code) =======================
{
  const S = "E_spotchecks";
  const raw = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "daily-bars.json"), "utf8"));
  const spyD = raw.SPY.map((b) => b[0]);
  const barOf = (sym, d) => (raw[sym] || []).find((b) => b[0] === d) || null;
  const lastBarLE = (sym, d) => { let out = null; for (const b of raw[sym] || []) { if (b[0] <= d) out = b; else break; } return out; };
  const wallPlus60 = (T) => { const [d, t] = T.split(" "); const [y, mo, da] = d.split("-").map(Number); const [h, mi, s] = t.split(":").map(Number); const w = new Date(Date.UTC(y, mo - 1, da, h, mi, s) + 60000).toISOString(); return { date: w.slice(0, 10), time: w.slice(11, 19) }; };
  const naiveEntry = (T) => { const { date, time } = wallPlus60(T); if (spyD.includes(date) && time <= "09:28:00") return date; return spyD.find((x) => x > date) || null; };
  const plusDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const lastSpyLE = (d) => { let o = null; for (const x of spyD) { if (x <= d) o = x; else break; } return o; };
  const naiveTier = (sym, entry) => { const i = spyD.indexOf(entry); const first = (raw[sym] || [])[0]?.[0]; const win = spyD.slice(Math.max(0, i - 20), i); let s = 0; for (const d of win) { const b = barOf(sym, d); if (b) s += b[4] * b[5]; } const sessions = win.filter((d) => d >= first).length; const dv = s / Math.max(1, Math.min(20, sessions)); return dv >= 50e6 ? 5 : dv >= 5e6 ? 15 : dv >= 1e6 ? 35 : dv > 0 ? 75 : 100; };
  const pick = [];
  const add = (why, r) => { if (r && !pick.some((p) => p.r.key === r.key)) pick.push({ why, r }); };
  const prim = rows.filter((r) => r.primary === 1 && r.B_st30 === "ok");
  for (const r of sample(prim, 10)) add("random primary", r);
  for (const r of sample(rows.filter((r) => r.fut_adjInferred === 1 && r.B_st30 === "ok" && r.A_st30 === "ok"), 3)) add("split inferred (reverse split / other class)", r);
  add("published 09:27-09:30 (MOO cut-off)", rows.find((r) => r.priced && r.publishedAt.slice(11) > "09:27:00" && r.publishedAt.slice(11) <= "09:29:59" && PL.isSession(r.publishedAt.slice(0, 10))));
  add("weekend / holiday publication", rows.find((r) => r.priced && r.window === "non_session_day" && r.B_st5 === "ok"));
  add("limit +10% filled on the entry session", rows.find((r) => r.B_lim10sess5 === 0));
  add("no exit bar at the 30-day horizon", rows.find((r) => r.B_st30 === "no_exit_bar"));
  add("late filing (lag > 30 days) with outcome A", rows.find((r) => r.lagDays > 30 && r.A_st30 === "ok" && r.B_st5 === "ok"));
  add("trade date before bar coverage", rows.find((r) => r.A_status === "td_before_bars" && r.B_st5 === "ok"));
  add("duplicate group (same person / issuer / entry)", rows.find((r) => r.dupSize > 1 && r.B_st5 === "ok"));
  const out = []; let mism = 0;
  for (const { why, r } of pick) {
    const sym = r.sym, chk = {}, m = [];
    const cmpv = (k, naive, panel, eps = 1e-6) => { chk[k] = { naive, panel }; if (!eq(naive, panel, eps)) m.push(k); };
    const E = naiveEntry(r.publishedAt); cmpv("entryDate", E, r.entryDate);
    const eb = barOf(sym, E), se = barOf("SPY", E);
    if (eb && r.B_status === "ok") {
      cmpv("entryOpen", eb[1], r.B_entryPrice);
      const tier = naiveTier(sym, E); cmpv("costBps", tier, r.costBps);
      const c = r.costBps / 1e4;
      for (const H of [5, 30]) {
        const X = lastSpyLE(plusDays(E, H)); if (X >= L4.DESIGN_END) { cmpv(`B_st${H}`, "embargo", r[`B_st${H}`]); continue; }
        const xb = barOf(sym, X), sx = barOf("SPY", X);
        cmpv(`B_end${H}`, X, r[`B_end${H}`]);
        if (xb) { const gross = xb[4] / eb[1] - 1, spy = sx[4] / se[1] - 1, net = (xb[4] * (1 - c)) / (eb[1] * (1 + c)) - 1; cmpv(`B_gross${H}`, gross, r[`B_gross${H}`]); cmpv(`B_spy${H}`, spy, r[`B_spy${H}`]); cmpv(`B_xsNet${H}`, net - spy, r[`B_xsNet${H}`]); }
        const path_ = (raw[sym] || []).filter((b) => b[0] >= E && b[0] <= X);
        const tgt = eb[1] * 1.1, first = path_.find((b) => b[2] >= tgt);
        cmpv(`B_hit10_${H}`, first ? 1 : 0, r[`B_hit10_${H}`]);
        cmpv(`B_mae${H}`, Math.min(...path_.map((b) => b[3])) / eb[1] - 1, r[`B_mae${H}`]);
        if (H === 30) { cmpv("B_tt10s", first ? spyD.indexOf(first[0]) - spyD.indexOf(E) : null, r.B_tt10s); cmpv("B_mfe30", Math.max(...path_.map((b) => b[2])) / eb[1] - 1, r.B_mfe30); }
        // limit +10%: first session with high >= tgt*1.005 → max(open, tgt); else close of X
        const fill = path_.find((b) => b[2] >= tgt * 1.005);
        if (fill || xb) { const px = fill ? Math.max(fill[1], tgt) : xb[4], sd = fill ? fill[0] : X; const spyL = barOf("SPY", sd)[4] / se[1] - 1; cmpv(`B_lim10_${H}`, (px * (1 - c)) / (eb[1] * (1 + c)) - 1 - spyL, r[`B_lim10_${H}`]); }
      }
      // decision features: r5, dHi60, vol20 from the bars strictly before E
      const before = (raw[sym] || []).filter((b) => b[0] < E), dec = before.at(-1);
      const iDec = spyD.indexOf(E) - 1, d5 = spyD[iDec - 5];
      const b5 = lastBarLE(sym, d5); if (dec && b5 && d5 >= raw[sym][0][0]) cmpv("r5", dec[4] / b5[4] - 1, r.r5);
      const w60 = before.filter((b) => b[0] > (spyD[iDec - 60] || "0")); if (w60.length) cmpv("dHi60", dec[4] / Math.max(...w60.map((b) => b[4])) - 1, r.dHi60);
      const w20i = before.findIndex((b) => b[0] > (spyD[iDec - 20] || "0")); const lr = []; for (let k = Math.max(1, w20i); k < before.length; k++) lr.push(Math.log(before[k][4] / before[k - 1][4]));
      if (lr.length >= 3) { const mu = mean(lr); cmpv("vol20", Math.sqrt(lr.reduce((a, x) => a + (x - mu) ** 2, 0) / (lr.length - 1)), r.vol20); }
      cmpv("gapEntry", eb[1] / dec[4] - 1, r.gapEntry);
    }
    // outcome A: adj factor from the trade-date close, then the close of the last session <= tradeDate + 30
    if (r.priceReported && r.tradeDate >= (raw[sym]?.[0]?.[0] ?? "9")) {
      const tb = lastBarLE(sym, r.tradeDate); const ratio = tb[4] / r.priceReported; const f = ratio > 1.8 || ratio < 0.55 ? ratio : 1;
      cmpv("adjFactor", f, r.fut_adjFactor); cmpv("insPriceAdj", r.priceReported * f, r.insPriceAdj);
      const X = lastSpyLE(plusDays(r.tradeDate, 30));
      if (X < L4.DESIGN_END && r.A_status === "ok") { const xb = barOf(sym, X), spyB = barOf("SPY", lastSpyLE(r.tradeDate)); if (xb) { cmpv("A_ret30", xb[4] / (r.priceReported * f) - 1, r.A_ret30); cmpv("A_xs30", xb[4] / (r.priceReported * f) - 1 - (barOf("SPY", X)[4] / spyB[4] - 1), r.A_xs30); } }
    } else chk.A_status = { panel: r.A_status };
    if (m.length) mism++;
    const ser = raw[sym] || []; const ie = ser.findIndex((b) => b[0] >= r.entryDate);
    out.push({ why, key: r.key, ticker: r.ticker, sym, publishedAt: r.publishedAt, decisionAt: r.decisionAt, tradeDate: r.tradeDate, entryDate: r.entryDate, priceReported: r.priceReported, security: r.security,
      mismatches: m, checks: chk, rawBarsAroundEntry: ie >= 0 ? ser.slice(Math.max(0, ie - 3), ie + 6) : [], rawBarOnTradeDate: lastBarLE(sym, r.tradeDate) });
  }
  PL.writePretty("selfcheck-spotchecks.json", out);
  note(S, pick.length >= 15 && mism === 0, `${pick.length} events recomputed by hand from the raw bar file (entry, cost tier, 5/30-day exits, touch, MFE/MAE, limit fill, r5 / dHi60 / vol20 / gap, adj factor, insider price, outcome A): ${mism} with mismatches`,
    { cases: out.map((o) => ({ why: o.why, key: o.key, ticker: o.ticker, mismatches: o.mismatches, nChecks: Object.keys(o.checks).length })) });
  log("E done");
}

// ======================= F. stage-C (deep 1) reproduction on design events =======================
{
  const S = "F_stageC";
  const ev = L4.visible(loadEvents(), (e) => e.publishedAt, "panel"); // design only (confirm rows dropped immediately)
  let sameEntry = 0, diffEntry = 0, mooShift = 0, pxM = 0, cmpN = 0, retM = 0, tierSame = 0, tierN = 0; const ex = [];
  for (const e of ev) {
    const r = byKey.get(e.accessionNo); if (!r || r.B_status !== "ok") continue;
    if (e.entryDate !== r.entryDate) { diffEntry++; if (r.publishedAt.slice(11) > "09:27:00" && r.publishedAt.slice(11) < "09:30:00") mooShift++; else if (ex.length < 5) ex.push({ key: r.key, stageC: e.entryDate, panel: r.entryDate, publishedAt: r.publishedAt }); continue; }
    sameEntry++; if (!eq(e.entryPrice, r.B_entryPrice, 1e-9)) pxM++;
    for (const N of [1, 5, 10]) { const h = e.h?.[N]; if (!h || h.status !== "ok" || r[`B_sSt${N}`] !== "ok") continue; cmpN++; if (Math.abs(h.gross - r[`B_sGross${N}`]) > 1.1e-4 || Math.abs(h.spy - r[`B_sSpy${N}`]) > 1.1e-4) retM++; }
    tierN++; if (e.costBpsPerSide === r.costBps) tierSame++;
  }
  note(S, pxM === 0 && retM === 0 && diffEntry === mooShift, `stage-C design events: entry date equal for ${sameEntry} (differs for ${diffEntry}, all ${mooShift} explained by the 09:28 MOO cut-off), entry price mismatches ${pxM}, session 1/5/10 gross and SPY mismatches ${retM} of ${cmpN}`, { examples: ex });
  res.sections[S].costTierAgreement = { compared: tierN, same: tierSame, share: tierN ? tierSame / tierN : null, note: "stage C tiers by 20 bars before the TRADE date; the panel by 20 sessions before ENTRY (point in time, missing bar = 0)" };
  log("F done");
}

// ======================= G. split / reverse-split names =======================
{
  const S = "G_splits";
  const inf = rows.filter((r) => r.fut_adjInferred === 1);
  const common = inf.filter((r) => r.commonLike === 1), other = inf.filter((r) => r.commonLike !== 1);
  let idv = 0; const iex = [];
  for (const r of inf) {
    // with an inferred factor the adjusted insider price equals the adjusted trade-date close (premium information lost)
    const A = M.aligned(r.sym); const k = A ? A.kAt[M.lastOnOrBefore(r.tradeDate)] : -1;
    if (k >= 0 && !eq(r.insPriceAdj, A.arr[k].c, 1e-6)) { idv++; if (iex.length < 5) iex.push({ key: r.key, kind: "insPriceAdj", insPriceAdj: r.insPriceAdj, close: A.arr[k].c }); }
    // product of two values each stored with 6 decimals: relative tolerance 1e-5
    if (r.decCloseAsTraded != null && !eq(r.decCloseAsTraded * r.fut_adjFactor, r.decCloseAdj, 1e-5)) { idv++; if (iex.length < 5) iex.push({ key: r.key, kind: "asTraded", prod: r.decCloseAsTraded * r.fut_adjFactor, adj: r.decCloseAdj }); }
  }
  note(S, idv === 0, `inferred-split identities hold (insider price = trade-date adjusted close; as-traded × factor = adjusted) for ${inf.length} filings: ${idv} violations`, { examples: iex });
  const ratios = inf.map((r) => r.fut_adjRatio).sort((a, b) => a - b);
  res.sections[S].summary = { inferred: inf.length, issuers: new Set(inf.map((r) => r.cik)).size, commonLike: common.length, otherSecurity: other.length, primary: inf.filter((r) => r.primary).length,
    ratioQuantiles: [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => PL.r6(PL.quantile(ratios, p))), reverseLike: inf.filter((r) => r.fut_adjRatio > 1.8).length, forwardLike: inf.filter((r) => r.fut_adjRatio < 0.55).length,
    examples: inf.filter((r) => r.commonLike === 1 && r.primary === 1).slice(0, 12).map((r) => ({ ticker: r.ticker, tradeDate: r.tradeDate, priceReported: r.priceReported, adjRatio: r.fut_adjRatio, decCloseAsTraded: r.decCloseAsTraded, decCloseAdj: r.decCloseAdj, security: r.security })),
    note: "fut_* fields depend on splits up to 2026-11 (future information): never use them, adjusted price LEVELS, or the adjFactor's existence as features; returns/ratios are split-invariant" };
  log("G done");
}

// ======================= H. unit-test files + deep-3 validate.mjs synthetic checks =======================
{
  const S = "H_tests";
  for (const f of ["history-test.json", "strategyLib-test.json", "walkforward-test.json"]) {
    const p = path.join(PL.OUT, f);
    if (!fs.existsSync(p)) { note(S, false, `${f} missing (run the test)`); continue; }
    const j = JSON.parse(fs.readFileSync(p, "utf8")); note(S, j.failed === 0, `${f}: ${j.passed} passed, ${j.failed} failed`);
  }
  // deep-3 validate.mjs synthetic suite, run from a copy whose output path points at this folder (the original writes into deep3/)
  const src = fs.readFileSync(path.join(OUT_DIR, "..", "..", "scripts", "research", "deep3", "dataquality", "validate.test.mjs"), "utf8");
  const copy = src.replace(/import \* as V from "\.\/validate\.mjs";/, 'import * as V from "../../deep3/dataquality/validate.mjs";')
    .replace(/const OUT = path\.join\([^\n]*\);/, `const OUT = ${JSON.stringify(PL.OUT)};`).replace(/"validate-test\.json"/, '"validate-test-copy.json"');
  const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), "validateTestCopy.mjs");
  fs.writeFileSync(tmp, copy);
  try { execFileSync(process.execPath, [tmp], { stdio: "pipe", cwd: path.join(OUT_DIR, "..", "..") }); } catch (e) { note(S, false, `validate.test copy failed: ${String(e.message).slice(0, 200)}`); }
  const vt = path.join(PL.OUT, "validate-test-copy.json");
  if (fs.existsSync(vt)) { const j = JSON.parse(fs.readFileSync(vt, "utf8")); const checks = j.checks || j.results || []; const passed = Array.isArray(checks) ? checks.filter((c) => c.pass ?? c.ok).length : j.passed; const total = Array.isArray(checks) ? checks.length : j.total;
    note(S, passed === total && total > 0, `deep-3 validate.mjs synthetic checks: ${passed}/${total}`); }
  log("H done");
}

res.ok = fail.length === 0; res.failures = fail;
PL.writePretty("selfcheck.json", res);
PL.checkpoint("selfcheck", { ok: res.ok, failures: fail.length });
console.log(JSON.stringify({ ok: res.ok, failures: fail, sections: Object.fromEntries(Object.entries(res.sections).map(([k, v]) => [k, v.checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.msg}`)])) }, null, 1));
