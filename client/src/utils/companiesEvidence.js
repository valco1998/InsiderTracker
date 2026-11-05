// Insider Tracker — Companies "Evidence Grid" helpers (pure; no React). Data comes from
// GET /api/insider/companies (server/services/edgar/companyScreener.js — evidence fields).

// "2026-11-02 06:39:13" or "… ET" (New York wall clock) → ISO UTC string, DST-aware. null if unparseable.
export function etToIso(stamp) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(String(stamp || ""));
  if (!m) return null;
  const asUtc = Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}Z`);
  if (!Number.isFinite(asUtc)) return null;
  // Offset of New York at (about) that instant: format asUtc in NY and compare.
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const nyAsUtc = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  return new Date(asUtc + (asUtc - nyAsUtc)).toISOString();
}

// Server role groups → compact chips (order: CEO, CFO, Dir, 10%, Officer).
const ROLE_CHIP = { CEO: "CEO", CFO: "CFO", Director: "Dir", "10% Owner": "10%", Officer: "Officer" };
export const ROLE_TITLE = { CEO: "Chief Executive Officer", CFO: "Chief Financial Officer", Dir: "Director", "10%": "10% owner", Officer: "Other officer" };
const ROLE_ORDER = ["CEO", "CFO", "Dir", "10%", "Officer"];
export function roleChips(roles) {
  const out = new Set();
  for (const r of roles || []) {
    const g = typeof r === "string" ? r : r?.role;
    if (ROLE_CHIP[g] && (typeof r === "string" || r.buyers > 0)) out.add(ROLE_CHIP[g]);
  }
  return ROLE_ORDER.filter((x) => out.has(x));
}

export const CONF = {
  verified: { label: "Verified", detail: "Every counted row passed the SEC data checks." },
  warning: { label: "Warning", detail: "Totals are reliable, but some rows were merged, superseded or excluded from value — see evidence." },
  uncertain: { label: "Uncertain", detail: "Offering / private placement, unverified currency or mostly unusable prices — interpret with care." },
};
export const QUALITY_FLAG = {
  priceAnomaly: { label: "Price anomaly", detail: "row(s) with an implausible reported price — counted as a purchase, value excluded." },
  missingPrice: { label: "No price", detail: "row(s) without a reported price — value not counted." },
  currencyUnverified: { label: "Currency unverified", detail: "row(s) priced in a foreign currency without a stated USD conversion." },
  offering: { label: "Offering / private placement", detail: "row(s) the filing describes as an offering or private placement — not open-market." },
  duplicateReports: { label: "Duplicate reports merged", detail: "extra report(s) of the same transaction by related filers — counted once." },
  relatedFilers: { label: "Related filers merged", detail: "legal filer(s) merged into an economic buyer (trust, LLC, fund GP, joint filing)." },
  needsReview: { label: "Possible duplicate", detail: "row(s) that look like a duplicate report but lack proof — counted separately." },
  amendmentUnlinked: { label: "Amendment not linked", detail: "Form 4/A row(s) whose original filing is not in the loaded data." },
  superseded: { label: "Superseded by 4/A", detail: "row(s) replaced by an amendment — the amended values are counted." },
};
export const CLUSTER_DEF = { A: "2+ independent buyers on one trade date", B: "3+ independent buyers within 2 days", C: "5+ independent buyers within 7 days" };
export const MOMENTUM = { accelerating: "Accelerating", steady: "Steady", slowing: "Slowing", single: "Single buyer" };
export const PURCHASE_TYPE = { open_market: "Stated open-market", offering_or_private: "Offering / private", unspecified: "Venue not stated" };

// Cluster evolution from the buyers list: cumulative independent buyers by each buyer's first purchase date.
export function evolutionPoints(buyersList) {
  const pts = (buyersList || []).filter((b) => b.firstDate).map((b) => ({ date: b.firstDate, name: b.name, roles: b.roles, value: b.value || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date) || b.value - a.value);
  return pts.map((p, i) => ({ ...p, cumulative: i + 1 }));
}

// Holdings increase as a short label: 0.0712 → "+7.1%", 2.5 → "+250%".
export const holdingsLabel = (x) => (x == null ? null : `+${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
