// deep4/behavior/styles.mjs — observable purchase-style labels, episodes and point-in-time prior-purchase profiles.
// Labels use ONLY the purchase's own decision-time context (panel feature fields: bars before the entry date, filings
// accepted before t). Thresholds are design-segment quantiles over primary purchases, computed by 02_styleRules.mjs
// BEFORE any outcome was read, and stored in .cache/research/deep4/behavior/style-rules.json (never re-estimated later).
// No label infers intent or private knowledge: they describe the market state at the time of the purchase.
import { quantile } from "./common.mjs";

export const STYLE_RULES_FILE = "style-rules.json";
export const MARKET_LABELS = ["DIP", "LOW", "DEEP", "RECOV", "MOM", "CONTRA"];
export const BEHAV_LABELS = ["FOLLOW", "ESCAL", "AVGDOWN", "SIMPRICE"];
export const ALL_LABELS = [...MARKET_LABELS, ...BEHAV_LABELS];
export const EPISODE_GAP_DAYS = 30; // a purchase starts a new episode at an issuer if the person's previous purchase there is > 30 calendar days earlier

export const LABEL_TEXT = {
  DIP: "after a crash: 20-session return r20 <= q20(r20)",
  LOW: "near the 60-session low: dLo60 (close / 60-session closing low - 1) <= q20(dLo60)",
  DEEP: "deep drawdown: dHi60 (close / 60-session closing high - 1) <= q20(dHi60)",
  RECOV: "during a recovery: dHi60 <= q50(dHi60) AND dLo60 >= q67(dLo60) AND r10 > 0 (well below the high, bounced off the low, rising)",
  MOM: "momentum / breakout: bo20 = 1 (close = 20-session closing high) OR r20 >= q80(r20)",
  CONTRA: "contrarian composite: DIP or LOW or DEEP",
  FOLLOW: "following other insiders: >= 1 OTHER open-market buyer at the issuer in [t-30d, t) (null whenever the 30-day window is truncated by the 2025-12-01 store start)",
  ESCAL: "increasing size: usd / max usd of the person's earlier valued purchases >= q80(pUsdRatioMax) (null without an earlier valued purchase)",
  AVGDOWN: "averaging down: same-issuer repeat whose split-adjusted price is below the person's previous purchase price there (panel avgDown; null if not a same-issuer repeat)",
  SIMPRICE: "repeated buy at a similar price level: same-issuer repeat with |chgSincePrevBuy| <= q33(|chgSincePrevBuy| over same-issuer repeats) (null if not a repeat)",
};

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
// Thresholds from the DESIGN primary purchases (features only).
export function computeThresholds(prim) {
  const v = (f) => prim.map((r) => r[f]).filter(isNum);
  const rep = prim.filter((r) => r.pPriorCo >= 1 && isNum(r.chgSincePrevBuy));
  return {
    q20_r20: quantile(v("r20"), 0.2), q80_r20: quantile(v("r20"), 0.8),
    q20_dLo60: quantile(v("dLo60"), 0.2), q67_dLo60: quantile(v("dLo60"), 2 / 3),
    q20_dHi60: quantile(v("dHi60"), 0.2), q50_dHi60: quantile(v("dHi60"), 0.5),
    q80_pUsdRatioMax: quantile(v("pUsdRatioMax"), 0.8),
    q33_absChgSincePrevBuy: quantile(rep.map((r) => Math.abs(r.chgSincePrevBuy)), 1 / 3),
    q67_pctHold: quantile(v("pctHold"), 2 / 3),
    nPrimary: prim.length, nRepeatSameIssuer: rep.length,
  };
}
// Labels of one purchase (1 / 0 / null = undefined).
export function labelsOf(r, th) {
  const b = (c) => (c ? 1 : 0);
  const L = {};
  L.DIP = isNum(r.r20) ? b(r.r20 <= th.q20_r20) : null;
  L.LOW = isNum(r.dLo60) ? b(r.dLo60 <= th.q20_dLo60) : null;
  L.DEEP = isNum(r.dHi60) ? b(r.dHi60 <= th.q20_dHi60) : null;
  L.RECOV = isNum(r.dHi60) && isNum(r.dLo60) && isNum(r.r10) ? b(r.dHi60 <= th.q50_dHi60 && r.dLo60 >= th.q67_dLo60 && r.r10 > 0) : null;
  L.MOM = r.bo20 === 1 || (isNum(r.r20) && r.r20 >= th.q80_r20) ? 1 : (r.bo20 === 0 && isNum(r.r20) ? 0 : null);
  L.CONTRA = L.DIP === 1 || L.LOW === 1 || L.DEEP === 1 ? 1 : L.DIP === 0 && L.LOW === 0 && L.DEEP === 0 ? 0 : null;
  L.FOLLOW = r.ctxTrunc30 === 1 ? null : r.oBuyers30Om >= 1 ? 1 : r.oBuyers30Om === 0 ? 0 : null; // truncated window (Dec 2025) = unknown
  L.ESCAL = isNum(r.pUsdRatioMax) ? b(r.pUsdRatioMax >= th.q80_pUsdRatioMax) : null;
  L.AVGDOWN = r.pPriorCo >= 1 && (r.avgDown === 0 || r.avgDown === 1) ? r.avgDown : null;
  L.SIMPRICE = r.pPriorCo >= 1 && isNum(r.chgSincePrevBuy) ? b(Math.abs(r.chgSincePrevBuy) <= th.q33_absChgSincePrevBuy) : null;
  return L;
}
const dnum = (s) => Math.floor(Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`) / 864e5);
// Episodes of one person's purchases (sorted by publishedAt): per issuer, a purchase starts a new episode when the person's
// previous purchase at that issuer is more than EPISODE_GAP_DAYS calendar days (acceptance dates) earlier. Returns
// [{ id, cik, start, rows: [...] }] ordered by start; each row also gets .episodeId / .episodeIdx / .isEpisodeStart.
export function episodesOf(personRows) {
  const lastAt = new Map(), cur = new Map(), eps = [];
  for (const r of personRows) {
    const d = dnum(r.publishedAt), prev = lastAt.get(r.cik);
    if (prev == null || d - prev > EPISODE_GAP_DAYS) { const e = { id: `${r.person}|${r.cik}|${r.publishedAt.slice(0, 10)}`, cik: r.cik, start: r.publishedAt, rows: [] }; eps.push(e); cur.set(r.cik, e); }
    const e = cur.get(r.cik); e.rows.push(r); lastAt.set(r.cik, d);
  }
  eps.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  eps.forEach((e, i) => e.rows.forEach((r, k) => { r.episodeId = e.id; r.episodeIdx = i; r.isEpisodeStart = k === 0 ? 1 : 0; }));
  return eps;
}
// Point-in-time prior purchase set of event e: the SAME person's open-market (class v2), valued, first-of-dupKey filings
// accepted strictly before e.publishedAt (dupKey != e.dupKey). `priced` is NOT required (it is known only at the entry
// open). personRows: all design/visible rows of that person (any class), sorted by publishedAt.
export function priorSet(e, personRows) {
  return personRows.filter((r) => r.publishedAt < e.publishedAt && r.dupKey !== e.dupKey && r.key !== e.key && r.cls === "om" && r.valued === 1 && r.isPrimary === 1);
}
// Profile of the prior set (labels of each prior purchase computed from its OWN decision-time features).
export function priorProfile(e, personRows, th) {
  const S = priorSet(e, personRows);
  const share = {};
  for (const k of ALL_LABELS) { const v = S.map((r) => labelsOf(r, th)[k]).filter((x) => x === 0 || x === 1); share[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; share[`${k}_n`] = v.length; }
  // episode-level shares of the prior set (first purchase of each prior episode, episodes rebuilt on the prior set only)
  const eps = episodesOf(S.map((r) => ({ ...r })));
  const epShare = {};
  for (const k of MARKET_LABELS) { const v = eps.map((ep) => labelsOf(ep.rows[0], th)[k]).filter((x) => x === 0 || x === 1); epShare[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
  const issuers = new Set(S.map((r) => r.cik));
  return { k: S.length, kEpisodes: eps.length, issuers: issuers.size, issuersInclCurrent: new Set([...issuers, e.cik]).size, priorAtIssuer: S.filter((r) => r.cik === e.cik).length, share, epShare,
    lastPriorAt: S.at(-1)?.publishedAt ?? null };
}
