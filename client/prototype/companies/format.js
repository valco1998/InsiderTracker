// PROTOTYPE — formatting helpers and definitions shared by the prototype components.
import { NOW } from "./mockData.js";

export const usd = (n) => (n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`);
export const price = (n) => (n == null ? "—" : `$${n.toFixed(2)}`);
export const pct = (x, d = 1) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(d)}%`);
export const pts = (x) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(1)} pts`);
export const tone = (x) => (x == null ? "cp-flat" : x > 0.0005 ? "cp-up" : x < -0.0005 ? "cp-down" : "cp-flat");
export function ago(ms) {
  const m = Math.max(0, Math.round((NOW - ms) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
export function etTime(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.month} ${p.day} · ${p.hour}:${p.minute} ET`;
}
export const md = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—");
export const shortDate = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(ms));

export const CONF = {
  verified: { label: "Verified", detail: "Every counted row passed all SEC data checks." },
  warning: { label: "Warning", detail: "Counted values are reliable, but some rows were merged or excluded — see evidence." },
  uncertain: { label: "Uncertain", detail: "Classification or security matching is uncertain — interpret with care." },
};
export const CLUSTER_DEF = { A: "≥2 independent buyers, same day", B: "≥3 independent buyers within 2 days", C: "≥5 independent buyers within 7 days" };
