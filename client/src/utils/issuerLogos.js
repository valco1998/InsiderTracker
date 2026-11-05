// Insider Tracker — self-hosted company logos (verified official-site icons only).
// /logos/manifest.v1.json is built offline by client/scripts/buildIssuerLogos.mjs from the logo audit.
// Loaded once, lazily; any failure → initials everywhere (never blocks the page).
let manifest = null;      // { "<cik10>": { bg } }
let loading = null;
const listeners = new Set();

export const cik10 = (cik) => { const d = String(cik ?? "").replace(/\D/g, ""); return d && d.length <= 10 ? d.padStart(10, "0") : null; };

export function loadLogoManifest(fetchImpl = (u) => fetch(u)) {
  if (manifest || loading) return loading || Promise.resolve(manifest);
  loading = fetchImpl("/logos/manifest.v1.json")
    .then((r) => (r.ok ? r.json() : { issuers: {} }))
    .catch(() => ({ issuers: {} }))
    .then((j) => { manifest = j?.issuers && typeof j.issuers === "object" ? j.issuers : {}; loading = null; for (const fn of listeners) fn(); return manifest; });
  return loading;
}

// → { src, bg } or null (null = show initials).
export function logoFor(cik, m = manifest) {
  const k = cik10(cik);
  const e = k && m ? m[k] : null;
  return e ? { src: `/logos/${k}.webp`, bg: e.bg === "dark" ? "dark" : "light" } : null;
}

export function onLogosLoaded(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const logosReady = () => manifest != null;

// Two letters from the ticker (or the name) for the placeholder tile.
export function initialsOf(ticker, name) {
  const t = String(ticker || "").replace(/[^A-Za-z0-9]/g, "");
  if (t) return t.slice(0, 2).toUpperCase();
  const words = String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
}
