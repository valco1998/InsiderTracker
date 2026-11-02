// server/services/edgar/priceAnomalies.js
//
// Flags transaction prices that are likely misreported or misparsed, so they
// can be shown as "Price anomaly — verify filing", excluded from monetary
// totals and never trigger automatic alerts until verified.
//
// Design principle: flag only GROSS, evidence-backed inconsistencies. A large
// value or a high share price is never an anomaly by itself (e.g. BRK.A trades
// far above $100,000/share). Every rule compares the price against something
// else in the SEC data itself — no market-data API, no estimation.
//
// Rules (any one → anomaly):
//   unparseable_value   the filed price/shares string is not a number
//   price_echoes_shares the price's significant digits equal the share count's
//                       (e.g. 3,149,470 sh @ $3,149.47) — typical of an aggregate
//                       amount or the share count entered in the price field
//   outside_stated_range the row's footnote states ONE price range and the
//                       reported price is outside it by more than 2×
//   peer_price_outlier  ≥ 2 other reported prices for the same issuer + security
//                       within ±7 days, and this price differs from their
//                       median by ≥ 20×
//
// Original SEC-reported values are never modified: rows keep `price`, `value`
// and `reported` exactly as parsed; the verdict is added as `priceCheck`.

export const ANOMALY_LABEL = "Price anomaly — verify filing";

const ECHO_MIN_SIG_DIGITS = 5;
const RANGE_TOLERANCE_FACTOR = 2;
const PEER_RATIO = 20;
const PEER_WINDOW_DAYS = 7;
const PEER_MIN = 2;

const normalize = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sigDigits = (s) => String(s).replace(/[^0-9]/g, "").replace(/^0+/, "").replace(/0+$/, "");
const isNumeric = (s) => s != null && String(s).trim() !== "" && Number.isFinite(Number(String(s).replace(/,/g, "")));
const dayNum = (iso) => (iso ? Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000) : null);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const RANGE_RE = /prices?\s+rang(?:ing|ed)\s+from\s+\$\s*([\d,]+(?:\.\d+)?)\s+to\s+\$\s*([\d,]+(?:\.\d+)?)/gi;

export function unparseableReason(t) {
  const r = t.reported || {};
  const bad = [];
  if (r.pricePerShare != null && String(r.pricePerShare).trim() !== "" && !isNumeric(r.pricePerShare)) bad.push(`price "${r.pricePerShare}"`);
  if (r.shares != null && String(r.shares).trim() !== "" && !isNumeric(r.shares)) bad.push(`shares "${r.shares}"`);
  return bad.length ? `filed ${bad.join(" and ")} is not a number` : null;
}

export function priceEchoesShares(t) {
  if (t.price == null || t.shares == null || t.price < 1) return null;
  const p = sigDigits(t.reported?.pricePerShare ?? t.price);
  const s = sigDigits(t.reported?.shares ?? t.shares);
  if (p.length < ECHO_MIN_SIG_DIGITS || p !== s) return null;
  return `price $${t.reported?.pricePerShare ?? t.price} has the same digits as the share count ${t.reported?.shares ?? t.shares} — likely an aggregate amount or share count in the price field`;
}

export function statedRangeMismatch(t) {
  if (t.price == null) return null;
  const ranges = [];
  for (const f of t.footnotes || []) for (const m of f.text.matchAll(RANGE_RE)) ranges.push([Number(m[1].replace(/,/g, "")), Number(m[2].replace(/,/g, "")), f.id]);
  // Multiple ranges (shared multi-row footnotes) are ambiguous — never flag on them.
  if (ranges.length !== 1) return null;
  const [lo, hi, id] = ranges[0];
  if (!(lo > 0) || !(hi >= lo)) return null;
  if (t.price > hi * RANGE_TOLERANCE_FACTOR || t.price < lo / RANGE_TOLERANCE_FACTOR) {
    return `reported price $${t.price} is far outside the $${lo}–$${hi} range stated in footnote ${id}`;
  }
  return null;
}

// rows: all known transactions (raw filing rows). Returns NEW objects with `priceCheck`.
export function annotatePriceChecks(rows) {
  const peersByKey = new Map();
  for (const r of rows) {
    if (r.price == null || !r.issuerCik) continue;
    const k = `${Number(r.issuerCik)}|${normalize(r.securityTitle)}`;
    (peersByKey.get(k) || peersByKey.set(k, []).get(k)).push(r);
  }

  return rows.map((t) => {
    const reasons = [];
    const unparseable = unparseableReason(t);
    if (unparseable) reasons.push({ rule: "unparseable_value", detail: unparseable });
    const echo = priceEchoesShares(t);
    if (echo) reasons.push({ rule: "price_echoes_shares", detail: echo });
    const range = statedRangeMismatch(t);
    if (range) reasons.push({ rule: "outside_stated_range", detail: range });

    if (t.price != null && t.issuerCik) {
      const d = dayNum(t.transactionDate);
      const peers = (peersByKey.get(`${Number(t.issuerCik)}|${normalize(t.securityTitle)}`) || [])
        .filter((p) => p !== t && p.id !== t.id && d != null && Math.abs(dayNum(p.transactionDate) - d) <= PEER_WINDOW_DAYS);
      if (peers.length >= PEER_MIN) {
        const m = median(peers.map((p) => p.price));
        const ratio = Math.max(t.price / m, m / t.price);
        if (ratio >= PEER_RATIO) {
          reasons.push({ rule: "peer_price_outlier", detail: `reported price $${t.price} is ${Math.round(ratio)}× the median $${m} of ${peers.length} other reported prices for this security within ±${PEER_WINDOW_DAYS} days` });
        }
      }
    }

    const status = reasons.length ? "anomaly" : t.price == null || t.value == null ? "missing_price" : "ok";
    return { ...t, priceCheck: { status, label: status === "anomaly" ? ANOMALY_LABEL : null, reasons } };
  });
}

// Automatic push alerts must never fire on unverified anomalous prices, on rows
// superseded by an amendment, or on amendments themselves (a 4/A restates a
// filing that may already have alerted; it is shown on the dashboard only).
export function isAlertEligible(t) {
  if (t.amendment?.status === "superseded") return { eligible: false, reason: "Superseded by an amended filing" };
  if (t.formType === "4/A") return { eligible: false, reason: "Amended filing — no automatic alerts" };
  if (t.priceCheck?.status === "anomaly") return { eligible: false, reason: ANOMALY_LABEL };
  if (!t.priceCheck) return { eligible: false, reason: "price not checked" };
  return { eligible: true, reason: null };
}
