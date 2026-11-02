// server/utils/safeLog.js
//
// Structured, redacted logging: `[TAG] key=value key=value`.
// Every value passes through redact() so credentials never reach the logs even
// when they appear inside third-party error messages:
//   mongodb:// URIs, user:password@ in any URL, JWTs, Bearer tokens,
//   PEM private keys, key=secret pairs (password, secret, token, api key).
// Long values are truncated; newlines are flattened.

const MAX_VALUE = 300;

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[redacted-private-key]"],
  [/mongodb(\+srv)?:\/\/[^\s"'<>]+/gi, "[redacted-mongodb-uri]"],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@"'<>]+:[^\s/@"'<>]+@/gi, "$1[redacted-credentials]@"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted-jwt]"],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|authorization)(["']?\s*[:=]\s*["']?)(?!Bearer\b|\[redacted)[^\s"',;&]+/gi, "$1$2[redacted]"],
];

export function redact(value) {
  let s = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? "");
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  s = s.replace(/\s+/g, " ").trim();
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s;
}

const fmtValue = (v) => {
  const s = redact(v);
  return /[\s"=]/.test(s) || s === "" ? JSON.stringify(s) : s;
};

// Field order is preserved; undefined/null fields are omitted.
export function formatEvent(tag, fields = {}) {
  const parts = [`[${tag}]`];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (v instanceof Error) { parts.push(`err=${fmtValue(v.name)}`, `msg=${fmtValue(v.message)}`); continue; }
    parts.push(`${k}=${fmtValue(v)}`);
  }
  return parts.join(" ");
}

export function logEvent(tag, fields, level = "log", sink = console) {
  sink[level](formatEvent(tag, fields));
}
export const logError = (tag, fields, sink) => logEvent(tag, fields, "error", sink);
export const logWarn = (tag, fields, sink) => logEvent(tag, fields, "warn", sink);
