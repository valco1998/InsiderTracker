// Insider Tracker — number/date formatting shared by every insider view.
// Moved unchanged from InsiderDashboard.jsx; new helpers below the line.

export const usd = (n, digits = 2) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });

export function compactUsd(n) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return usd(n, 0);
}

export const shares = (n) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 4 }));

// YYYY-MM-DD from the filing — format in UTC so the calendar date never shifts.
export function day(iso) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────

export const price = (p) => (p == null ? "n/a" : usd(p, p < 1 ? 4 : 2));

export const count = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

// Signed compact value: "+$1.20M" / "−$3.40M".
export const signedCompactUsd = (n) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${compactUsd(Math.abs(n))}`);

// "Oct 30" (UTC calendar day, no year) for chart axes / compact labels.
export function shortDay(iso) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

// "2026-11-02 06:39:13 ET" (SEC acceptance time, already Eastern) → "Nov 2 · 06:39 ET".
export function acceptedShort(et) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(et || "");
  return m ? `${shortDay(m[1])} · ${m[2]} ET` : et || "—";
}

// Relative time from an ISO timestamp, against `now` (ms).
export function ago(iso, now = Date.now()) {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
