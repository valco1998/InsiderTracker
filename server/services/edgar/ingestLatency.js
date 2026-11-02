// server/services/edgar/ingestLatency.js
//
// Phase D0 — per-filing pipeline timeline and latency statistics. Pure; no I/O.
//
// Timeline (ISO UTC strings unless noted; a field is null when it was NOT observed —
// nothing is ever estimated, and a Form 4's transaction date is never used here):
//   acceptedAt     SEC ACCEPTANCE-DATETIME from the filing header (US Eastern → UTC)
//   feedUpdatedAt  the latest-filings feed entry's own <updated> timestamp
//   discoveredAt   when this server first listed the filing (feed or daily index)
//   downloadMs     duration of the successful .txt download (number)
//   parsedAt       when the filing was parsed and stored
//   publishedAt    when the first processed snapshot containing it was built
//   source         "feed" (live discovery) | "index:<day>" | "retry:<source>" | …
//
// Stats are kept separately for LIVE filings (discovered via the feed — the
// latency that matters) and BACKFILL filings (daily index / recovery — their
// acceptance-to-discovery time reflects history, not engine speed).
import { parseAcceptedAtET } from "./easternTime.js";

export const METRICS = {
  acceptedToFeed: ["acceptedAt", "feedUpdatedAt"],         // SEC-side: acceptance → feed listing timestamp
  feedToDiscovered: ["feedUpdatedAt", "discoveredAt"],     // our polling delay
  acceptedToDiscovered: ["acceptedAt", "discoveredAt"],    // discovery latency
  discoveredToParsed: ["discoveredAt", "parsedAt"],        // queue wait + download + parse
  parsedToPublished: ["parsedAt", "publishedAt"],          // snapshot publication delay
  acceptedToPublished: ["acceptedAt", "publishedAt"],      // end-to-end (server side)
};

export const acceptedAtIso = (acceptedAtET) => parseAcceptedAtET(acceptedAtET)?.toISOString() ?? null;
export const timelineClass = (tl) => (tl?.source === "feed" ? "live" : "backfill");

// → { metricName: ms | null } — null when either timestamp is unavailable.
export function timelineMetrics(tl) {
  const out = {};
  for (const [name, [a, b]] of Object.entries(METRICS)) {
    const ta = tl?.[a] ? Date.parse(tl[a]) : NaN;
    const tb = tl?.[b] ? Date.parse(tl[b]) : NaN;
    out[name] = Number.isFinite(ta) && Number.isFinite(tb) ? tb - ta : null;
  }
  out.downloadMs = Number.isFinite(tl?.downloadMs) ? tl.downloadMs : null;
  return out;
}

// Nearest-rank percentiles. Negative values are kept (clock skew stays visible via min).
export function summarize(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(Math.ceil((p / 100) * s.length) - 1, 0))];
  return { n: s.length, min: s[0], p50: at(50), p95: at(95), p99: at(99), max: s[s.length - 1] };
}

export function createLatencyTracker({ window = 1000 } = {}) {
  const rings = { live: [], backfill: [] };
  let memo = null;

  function add(tl) {
    const ring = rings[timelineClass(tl)];
    ring.push(timelineMetrics(tl));
    if (ring.length > window) ring.shift();
    memo = null;
  }

  function group(ring) {
    const metrics = {};
    const unavailable = {};
    for (const name of [...Object.keys(METRICS), "downloadMs"]) {
      const vals = [];
      let missing = 0;
      for (const m of ring) (m[name] == null ? missing++ : vals.push(m[name]));
      metrics[name] = summarize(vals);
      if (missing) unavailable[name] = missing;
    }
    return { filings: ring.length, metrics, unavailable };
  }

  function summary() {
    if (!memo) memo = { window, unit: "ms", live: group(rings.live), backfill: group(rings.backfill) };
    return memo;
  }

  return { add, summary };
}
