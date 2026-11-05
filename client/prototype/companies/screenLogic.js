// PROTOTYPE — pure screen logic (filters, sort, summary). No React; testable in Node.
import { NOW, perfOf, hasPrice } from "./mockData.js";

const DAY = 86_400_000;
export const DEFAULTS = { period: "30d", basis: "filed", minBuyers: 1, value: "any", roles: [], ptype: "likely", conf: "all", clusters: [], repeat: false, pub: "any", perf: "any", q: "", sort: "published", dir: "desc", anchor: "signal" };
export const PERIODS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
export const VALUES = { any: [null, "Any value"], "100k": [100_000, "$100K+"], "500k": [500_000, "$500K+"], "1m": [1_000_000, "$1M+"], "5m": [5_000_000, "$5M+"] };
export const PTYPES = { verified: "Verified open-market", likely: "Verified + likely OM", all: "All code P purchases" };
export const CONFS = { all: "All confidence levels", hide_uncertain: "Hide uncertain", verified: "Verified only" };
export const PUBS = { any: "Any time", "24h": "Last 24 hours", "72h": "Last 72 hours", "7d": "Last 7 days" };
export const PERFS = { any: "Any performance", up: "Up since signal", down: "Down since signal", below_insider: "Below insider avg price", beat_spy: "Ahead of SPY" };

export function applyFilters(list, f, licensed) {
  const pubMs = { "24h": DAY, "72h": 3 * DAY, "7d": 7 * DAY }[f.pub];
  const q = f.q.trim().toUpperCase();
  return list.filter((c) => {
    if (NOW - c.publication.latestAt > PERIODS[f.period] * DAY) return false;
    if (c.buyers.economic < f.minBuyers) return false;
    if (VALUES[f.value][0] != null && c.purchases.verifiedValue < VALUES[f.value][0]) return false;
    if (f.roles.length && !f.roles.some((r) => c.buyers.roles.includes(r))) return false;
    if (f.ptype === "verified" && !c.purchases.verifiedOM) return false;
    if (f.ptype === "likely" && !(c.purchases.verifiedOM + c.purchases.likelyOM)) return false;
    if (f.conf === "verified" && c.quality.status !== "verified") return false;
    if (f.conf === "hide_uncertain" && c.quality.status === "uncertain") return false;
    if (f.clusters.length && !f.clusters.includes(c.cluster)) return false;
    if (f.repeat && !c.pattern.repeat) return false;
    if (pubMs && NOW - c.publication.latestAt > pubMs) return false;
    if (licensed && f.perf !== "any") {
      const p = perfOf(c, f.anchor);
      if (!hasPrice(p)) return false;
      if (f.perf === "up" && !(p.ret > 0)) return false;
      if (f.perf === "down" && !(p.ret < 0)) return false;
      if (f.perf === "below_insider" && !p.belowInsider) return false;
      if (f.perf === "beat_spy" && !(p.excess > 0)) return false;
    }
    if (q && !c.ticker.includes(q) && !c.name.toUpperCase().includes(q)) return false;
    return true;
  });
}
export const SORTS = {
  published: (c, f) => (f.anchor === "latest" ? c.publication.latestAt : c.publication.signalAt),
  buyers: (c) => c.buyers.economic * 1e12 + c.purchases.verifiedValue,
  value: (c) => c.purchases.verifiedValue,
  own: (c) => c.purchases.deltaOwnPct,
  ret: (c, f) => { const p = perfOf(c, f.anchor); return hasPrice(p) ? p.ret : null; },
  excess: (c, f) => { const p = perfOf(c, f.anchor); return hasPrice(p) ? p.excess : null; },
};
export function sortList(list, f) {
  const key = SORTS[f.sort] || SORTS.published;
  const m = f.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = key(a, f), y = key(b, f);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // N/A always last, whatever the direction
    if (y == null) return -1;
    return (x - y) * m;
  });
}
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length ? (s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) : null; };
