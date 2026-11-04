// deep2/behavior/common.mjs — helpers for the insider-behaviour specialist (research only, read-only, no network).
// Everything here works on lib2's cached data: stage-C events, slim SEC rows, split-adjusted daily bars.
import fs from "node:fs";
import path from "node:path";
import { DEEP2, loadBars, idxBefore, registerHypothesis, recordResult, companyStats, mean, median, pValue, r4 } from "../../../../deep2/lib2.mjs";

export const AGENT = "behavior";
export const OUT = path.join(DEEP2, "..", "deep3", "audit", "exposed", process.env.AUDIT3_EXPOSED === "1" ? "run" : "dry", "beh"); // audit3: own output folder
fs.mkdirSync(OUT, { recursive: true });
export const writeOut = (name, data) => { const f = path.join(OUT, name); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1)); return f; };
export const readOut = (name) => JSON.parse(fs.readFileSync(path.join(DEEP2, "behavior", name), "utf8")); // audit3: inputs stay the deep-2 originals (read-only)

export const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const DAY = 86_400_000;
export const dnum = (d) => Math.floor(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) / DAY);
export const addDays = (d, n) => new Date((dnum(d) + n) * DAY).toISOString().slice(0, 10);

// ---------------- roles from the role text (S rows have no owner flags) ----------------
const CEO_RE = /\b(chief executive officer|principal executive officer|co-?ceo|ceo)\b/i;
const CFO_RE = /\b(chief financial officer|principal financial officer|cfo)\b/i;
const OFFICER_RE = /\b(president|officer|chief|vice|vp|evp|svp|treasurer|secretary|controller|general counsel|coo|cto|cio|cao|chairman|chairwoman|chair)\b/i;
export function rolesOfText(role) {
  const t = String(role || "");
  const g = new Set();
  if (CEO_RE.test(t)) g.add("CEO");
  if (CFO_RE.test(t)) g.add("CFO");
  if (/director/i.test(t)) g.add("Director");
  if (/10%\s*owner/i.test(t)) g.add("10% Owner");
  const rest = t.replace(/director|10%\s*owner/gi, "");
  if (!g.has("CEO") && !g.has("CFO") && OFFICER_RE.test(rest)) g.add("Officer");
  if (!g.size) g.add("Other");
  return g;
}

// ---------------- entity / personal-vehicle detection ----------------
// An owner name is an entity when it carries a legal-form or investment-vehicle word.
export const ENTITY_NAME_RE = /\b(L\.?\s?P\.?|LLC|L\.L\.C\.?|INC\.?|INCORPORATED|CORP\.?|CORPORATION|LTD\.?|LIMITED|FUNDS?|CAPITAL|PARTNERS|PARTNERSHIP|HOLDINGS?|TRUST|VENTURES?|MANAGEMENT|ADVIS[OE]RS?|GROUP|BANK|BANCORP|INSURANCE|ASSURANCE|REINSURANCE|ASSET|INVESTMENTS?|INVESTORS|COMPANY|CO\.|ASSOCIATES|FOUNDATION|ENDOWMENT|OPPORTUNIT(?:Y|IES)|MASTER|PTE\.?|GMBH|S\.A\.?|N\.V\.?|PLC|AG|SPV|ENTERPRISES?|FINANCIAL|SECURITIES|EQUIT(?:Y|IES)|MUTUAL|PENSION|FAMILY OFFICE|SICAV|SARL|B\.V\.|A\/S|KG)\b/i;
export const ownerNames = (insider) => String(insider || "").split(/\s*;\s*/).filter(Boolean);
export const isEntityName = (n) => ENTITY_NAME_RE.test(String(n || ""));
// Personal vehicles: still the individual's own money and decision.
export const PERSONAL_RE = /\b(family|famil|spouse|wife|husband|child|children|son|daughter|minor|revocable|living trust|irrevocable|\bIRA\b|roth|retirement|401\s?\(?k\)?|custodian|UTMA|UGMA|estate|GRAT|personal|self|jointly|joint tenancy|grandchild|by trust\b|dynasty|SEP|KEOGH|profit sharing)\b/i;
// Fund / managed-money language in the nature of ownership or footnotes.
export const FUND_ROLE_RE = /portfolio manager/i; // managers buying the fund they run (closed-end funds) — managed-money context
export const FUND_RE = /\b(fund|funds|L\.?\s?P\.?|investment (manager|adviser|advisor)|managed accounts?|separately managed|clients?|general partner|managing member|portfolio manager|asset management|capital management|master fund|investment vehicle|private investment|hedge|sub-advis|advisory clients?)\b/i;

// ---------------- purchase text evidence ----------------
// Strong open-market language describing the reported transaction.
export const OM_RE = /weighted[- ]average|range of prices|prices? rang(?:ing|ed)|rang(?:ing|ed) from \$?\d|multiple transactions|open[- ]market|on the open market|market purchases?|purchased on (the )?(nasdaq|nyse|[a-z ]*stock exchange)/i;
// Issuer-directed acquisitions (offering, placement, subscription, IPO, units).
export const OFFER_RE = /private placement|\bPIPE\b|securities purchase agreement|stock purchase agreement|share purchase agreement|subscri(?:ption|bed|be)|registered direct|underwrit|public offering|initial public offering|\bIPO\b|secondary offering|follow-on offering|offering price|in the offering|in connection with the (offering|closing)|purchased (directly )?from the (issuer|company)|directly from the (issuer|company)|acquired from the issuer|issued by the issuer|rights offering|conversion offering|second[- ]step|stock offering|each unit|units? consist|pre-?funded|concurrent private|purchase agreement with the (issuer|company)|equity line|at[- ]the[- ]market offering|standby purchase|backstop/i;
// Plans and non-discretionary acquisitions.
export const PLAN_RE = /dividend reinvest|reinvestment of (a |the )?(cash |quarterly )?dividends?|automatic(ally)? reinvest|reinvested dividends?|\bDRIP\b|employee stock purchase|\bESPP\b|stock purchase plan|401\s?\(?k\)?|retainer|in lieu of (cash|fees|director)|director(s'|'s)? fees|deferred compensation|dividend investment plan|thrift plan|savings plan|profit[- ]sharing plan|automatic investment|compensation plan|\b409A\b|shares issued under/i;
// Holdings footnotes that merely mention a plan or offering ("includes N shares acquired under the ESPP").
export const HOLDINGS_NOTE_RE = /\b(includes?|including|total (holdings|amount)|amount (of securities )?beneficially owned|following (the|this) (reported )?transaction|previously (acquired|reported)|also (holds|owns)|in addition)\b[^|]{0,160}\b(ESPP|employee stock purchase|dividend reinvest|offering|IPO|private placement|401)/i;
// Other non-market acquisitions.
export const OTHER_NONMARKET_RE = /merger|business combination|debt exchange|exchange agreement|in exchange for|conversion of (the )?(notes?|debentures?|preferred)|converted (from|into)|upon conversion|settlement of (the )?(notes?|debt|loan)|satisf(y|action of) (a )?(debt|loan|note)|in satisfaction|tender offer|distribution from|in[- ]kind|spin-?off|reorganization|demutualization/i;

// ---------------- price evidence (split / ADR-ratio aware) ----------------
const NICE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 16, 20, 25, 30, 35, 40, 50, 60, 70, 75, 80, 100, 120, 150, 200, 250, 300, 400, 500];
// Raw reported price vs split-adjusted bars: if price/close is close to a split-like ratio, return that ratio.
export function niceFactor(ratio) {
  for (const k of NICE) { if (Math.abs(ratio * k - 1) < 0.15) return 1 / k; if (Math.abs(ratio / k - 1) < 0.15) return k; }
  return null;
}
export function priceEvidence(r, bars, tol = 0.0075, outTol = 0.02) {
  const ser = bars.get(sym(r.ticker));
  if (!ser || !ser.arr.length) return { status: "no_series" };
  if (!(r.price > 0)) return { status: "no_price" };
  const first = ser.arr[0].d, newListing = first > "2025-10-10";
  const listingDays = newListing ? dnum(r.tradeDate) - dnum(first) : null;
  const i = ser.idx.get(r.tradeDate);
  if (i == null) {
    const dow = new Date(`${r.tradeDate}T12:00:00Z`).getUTCDay();
    const before = idxBefore(ser, r.tradeDate);
    return { status: "no_bar_on_date", weekend: dow === 0 || dow === 6, beforeFirstBar: before < 0, listingDays };
  }
  const b = ser.arr[i];
  let ratio = r.price / b.c, factor = 1, adjusted = false;
  if (ratio < 0.6 || ratio > 1.7) { const f = niceFactor(ratio); if (f) { factor = f; adjusted = true; } }
  const p = r.price / factor;
  const inRange = p >= b.l * (1 - tol) && p <= b.h * (1 + tol);
  const below = p < b.l * (1 - outTol), above = p > b.h * (1 + outTol);
  // A split-like adjustment is accepted only if the adjusted price lands inside the day's range.
  if (adjusted && !inRange) return { status: "far", ratio: r4(ratio), bar: b, factor: null, listingDays };
  return { status: inRange ? "in" : below ? "below" : above ? "above" : "edge", ratio: r4(ratio), factor, adjusted, bar: b,
    vsLow: r4(p / b.l - 1), vsHigh: r4(p / b.h - 1), vsClose: r4(p / b.c - 1), listingDays };
}
export const decimalsOf = (p) => { if (!(p > 0)) return null; const s = String(p); const k = s.indexOf("."); return k < 0 ? 0 : s.length - k - 1; };
// Fixed-price deal prices are round for their level: < $2 → $0.05 steps, < $10 → $0.10, < $50 → $0.50, else whole dollars.
export const isRoundPrice = (p) => { if (!(p > 0)) return false; const step = p < 2 ? 0.05 : p < 10 ? 0.1 : p < 50 ? 0.5 : 1; const k = p / step; return Math.abs(k - Math.round(k)) < 1e-6; };

// ---------------- returns helpers ----------------
// 4-session exit from bars (NYSE calendar from SPY), same convention as stage C: entry open, exit close of the
// 4th session after the entry session, net of costBpsPerSide on each side, minus SPY over the same dates.
export function horizonFromBars(e, N, bars) {
  const spy = bars.get("SPY"), ser = bars.get(sym(e.ticker));
  if (!spy || !ser || !(e.entryPrice > 0)) return { status: "no_data" };
  const si = spy.idx.get(e.entryDate); if (si == null) return { status: "no_entry_bar" };
  const x = spy.arr[si + N]; if (!x) return { status: "pending" };
  const xb = ser.arr[ser.idx.get(x.d)]; if (!xb) return { status: "no_exit_bar", exitDate: x.d };
  const c = (e.costBpsPerSide || 100) / 1e4;
  const gross = xb.c / e.entryPrice - 1, spyR = x.c / spy.arr[si].o - 1;
  const net = (xb.c * (1 - c)) / (e.entryPrice * (1 + c)) - 1;
  return { status: "ok", exitDate: x.d, exitPrice: xb.c, gross: r4(gross), net: r4(net), spy: r4(spyR), excess: r4(gross - spyR), excessNet: r4(net - spyR) };
}
// Opening gap at entry: entry open vs the last close before entry, minus SPY's gap over the same dates (gross).
export function gapOf(e, bars) {
  const spy = bars.get("SPY"), ser = bars.get(sym(e.ticker));
  if (!spy || !ser || !(e.entryPrice > 0)) return null;
  const i = idxBefore(ser, e.entryDate); if (i < 0) return null;
  const dc = ser.arr[i].c, dd = ser.arr[i].d;
  const sj = spy.idx.get(dd), se = spy.idx.get(e.entryDate);
  if (sj == null || se == null) return null;
  return r4(e.entryPrice / dc - 1 - (spy.arr[se].o / spy.arr[sj].c - 1));
}
// Same-session open → close (MOO→MOC) excess vs SPY, gross and net.
export function day0Of(e, bars) {
  const spy = bars.get("SPY"), ser = bars.get(sym(e.ticker));
  const b = ser?.arr[ser.idx.get(e.entryDate)], s = spy?.arr[spy.idx.get(e.entryDate)];
  if (!b || !s || !(e.entryPrice > 0)) return null;
  const c = (e.costBpsPerSide || 100) / 1e4;
  return { excess: r4(b.c / e.entryPrice - 1 - (s.c / s.o - 1)), excessNet: r4((b.c * (1 - c)) / (e.entryPrice * (1 + c)) - 1 - (s.c / s.o - 1)) };
}

// Chart context of an event from split-adjusted bars: BEFORE = bars strictly before the entry session (what a trader
// knew), AFTER = entry session onward (outcome, for description only). Returns numbers plus a plain-language sentence.
export function chartDesc(e, bars) {
  const ser = bars.get(sym(e.ticker)), spy = bars.get("SPY");
  if (!ser || !spy || !e.entryDate) return null;
  const i = idxBefore(ser, e.entryDate); if (i < 20) return null;
  const a = ser.arr, last = a[i].c;
  const w = (n) => a.slice(Math.max(0, i - n + 1), i + 1);
  const r = (n) => (i - n >= 0 ? last / a[i - n].c - 1 : null);
  const hi60 = Math.max(...w(60).map((b) => b.h)), lo60 = Math.min(...w(60).map((b) => b.l));
  const vAvg = (xs) => mean(xs.map((b) => b.v));
  const vol5 = vAvg(w(5)), vol60 = vAvg(w(60));
  const lr = []; for (let k = Math.max(1, i - 19); k <= i; k++) lr.push(Math.log(a[k].c / a[k - 1].c));
  const sd20 = Math.sqrt(lr.reduce((s, x) => s + (x - mean(lr)) ** 2, 0) / Math.max(1, lr.length - 1));
  const dv20 = mean(w(20).map((b) => b.c * b.v));
  const ei = ser.idx.get(e.entryDate);
  const out = (n) => { const b = ei == null ? null : a[ei + n]; return b ? b.c / e.entryPrice - 1 : null; };
  const spyI = spy.idx.get(e.entryDate);
  const spyOut = (n) => (spyI == null || !spy.arr[spyI + n] ? null : spy.arr[spyI + n].c / spy.arr[spyI].o - 1);
  const ex = (n) => (out(n) == null || spyOut(n) == null ? null : out(n) - spyOut(n));
  const d = {
    ret20: r4(r(20)), ret60: r4(r(60)), dd60: r4(last / hi60 - 1), posIn60Range: r4((last - lo60) / Math.max(1e-9, hi60 - lo60)),
    vol20d: r4(sd20), volumeRatio5_60: r4(vol5 / vol60), dollarVol20: Math.round(dv20), gap: gapOf(e, bars),
    day0: ei == null ? null : r4(a[ei].c / e.entryPrice - 1), excess5: r4(ex(5)), excess20: r4(ex(20)),
  };
  const p = (v) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
  const trend = d.ret60 == null ? `${p(d.ret20)} over 20 sessions` : `${p(d.ret60)} over 60 sessions (${p(d.ret20)} over the last 20)`;
  const where = d.posIn60Range <= 0.15 ? "sitting near its 60-session low" : d.posIn60Range >= 0.85 ? "near its 60-session high" : `in the ${d.posIn60Range < 0.5 ? "lower" : "upper"} half of its 60-session range`;
  const volw = d.volumeRatio5_60 >= 1.8 ? `volume ${d.volumeRatio5_60.toFixed(1)}x its 60-session average in the last 5 sessions` : d.volumeRatio5_60 <= 0.6 ? "volume drying up" : "normal volume";
  d.text = `Before: ${trend}, ${p(d.dd60)} from the 60-session high, ${where}; daily vol ${(d.vol20d * 100).toFixed(1)}%, ${volw}, $${(dv20 / 1e6).toFixed(1)}M/day traded. ` +
    `Open: gap ${p(d.gap)} vs SPY; entry day open->close ${p(d.day0)}. After (gross, vs SPY, from the entry open): ${p(d.excess5)} at the H5 close, ${p(d.excess20)} at the H20 close.`;
  return d;
}

// ---------------- statistics beyond lib2.companyStats ----------------
// OLS x = a + b·z with standard errors clustered by issuer (CR1). rows: [{ issuer, x, z }]
export function clusteredOLS(rows) {
  const n = rows.length; if (n < 10) return null;
  let sz = 0, sx = 0, szz = 0, szx = 0;
  for (const r of rows) { sz += r.z; sx += r.x; szz += r.z * r.z; szx += r.z * r.x; }
  const det = n * szz - sz * sz; if (!(Math.abs(det) > 1e-12)) return null;
  const a = (szz * sx - sz * szx) / det, b = (n * szx - sz * sx) / det;
  const inv = [[szz / det, -sz / det], [-sz / det, n / det]];
  const g = new Map();
  for (const r of rows) { const e = r.x - a - b * r.z; const s = g.get(r.issuer) || [0, 0]; s[0] += e; s[1] += e * r.z; g.set(r.issuer, s); }
  const G = g.size; if (G < 5) return null;
  let m00 = 0, m01 = 0, m11 = 0;
  for (const [u0, u1] of g.values()) { m00 += u0 * u0; m01 += u0 * u1; m11 += u1 * u1; }
  const k = (G / (G - 1)) * ((n - 1) / (n - 2));
  // V = inv · M · inv; we need V[1][1]
  const M = [[m00, m01], [m01, m11]];
  const IM = [[inv[0][0] * M[0][0] + inv[0][1] * M[1][0], inv[0][0] * M[0][1] + inv[0][1] * M[1][1]], [inv[1][0] * M[0][0] + inv[1][1] * M[1][0], inv[1][0] * M[0][1] + inv[1][1] * M[1][1]]];
  const v11 = k * (IM[1][0] * inv[0][1] + IM[1][1] * inv[1][1]);
  const t = v11 > 0 ? b / Math.sqrt(v11) : null;
  return { n, issuers: G, a: r4(a), b: r4(b), t: t == null ? null : Math.round(t * 100) / 100, p: t == null ? null : pValue(t) };
}
// Difference of means between groups A (z=1) and B (z=0), issuer-clustered.
export function diffTest(A, B) {
  const rows = [...A.map((r) => ({ issuer: r.issuer, x: r.x, z: 1 })), ...B.map((r) => ({ issuer: r.issuer, x: r.x, z: 0 }))];
  const o = clusteredOLS(rows); if (!o) return null;
  return { nA: A.length, nB: B.length, meanA: r4(mean(A.map((r) => r.x))), meanB: r4(mean(B.map((r) => r.x))), diff: o.b, t: o.t, p: o.p };
}
// Rank-slope test: x on the centred percentile rank of z (−0.5 … +0.5), issuer-clustered → b = top-vs-bottom spread.
export function rankSlope(rows) {
  const s = [...rows].filter((r) => Number.isFinite(r.z) && Number.isFinite(r.x)).sort((a, b) => a.z - b.z);
  if (s.length < 20) return null;
  // average ranks for ties
  const out = []; let i = 0;
  while (i < s.length) { let j = i; while (j + 1 < s.length && s[j + 1].z === s[i].z) j++; const rk = (i + j) / 2 / (s.length - 1) - 0.5; for (let k = i; k <= j; k++) out.push({ issuer: s[k].issuer, x: s[k].x, z: rk }); i = j + 1; }
  return clusteredOLS(out);
}
export { companyStats, mean, median, r4 };

// ---------------- registry wrappers (idempotent: never re-register an id) ----------------
const REG = path.join(DEEP2, "registry.jsonl"), RES = path.join(DEEP2, "registry-results.jsonl");
const readIds = (f) => (fs.existsSync(f) ? new Set(fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).id; } catch { return null; } })) : new Set());
export function register(h) {
  if (!h.id.startsWith(`${AGENT}-`)) throw new Error(`id must start with ${AGENT}-`);
  if (readIds(REG).has(h.id)) return false;
  registerHypothesis({ agent: AGENT, preRegistered: true, ...h });
  return true;
}
export function recordOnce(id, result) {
  if (readIds(RES).has(id)) return false; // result already recorded: never overwrite (append-only registry)
  recordResult(id, AGENT, result);
  return true;
}
export const registeredIds = () => readIds(REG);
export const recordedIds = () => readIds(RES);
