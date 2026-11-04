// deep2/chart/inspect2.mjs — read-only: symbol universe for controls, sec-rows shape (no outcome computed).
//   node scripts/research/deep2/chart/inspect2.mjs
import { loadEvents, loadBars, loadSecRows } from "../lib2.mjs";

const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const bars = loadBars();
const sec = await loadSecRows();
console.log("sec rows:", sec.rows.length, "days", sec.days);
console.log("sample P row:", JSON.stringify(sec.rows.find((r) => r.code === "P")).slice(0, 600));
const secTick = new Set(sec.rows.map((r) => sym(r.ticker)).filter(Boolean));
const secTickP = new Set(sec.rows.filter((r) => r.code === "P").map((r) => sym(r.ticker)).filter(Boolean));
const all = [...bars.keys()];
const notIssuer = all.filter((s) => !secTick.has(s));
console.log("bar symbols:", all.length, "in sec tickers (P or S):", all.length - notIssuer.length, "with P rows:", all.filter((s) => secTickP.has(s)).length);
console.log("bar symbols not a Form-4 issuer ticker:", notIssuer.length, notIssuer.slice(0, 80).join(" "));
const empty = all.filter((s) => !bars.get(s).arr.length); console.log("empty series:", empty.length);
const E = loadEvents();
const evT = new Set(E.map((e) => sym(e.ticker)));
console.log("event tickers:", evT.size);
// acceptedAt format
console.log("acceptedAt samples:", sec.rows.slice(0, 3).map((r) => r.acceptedAt));
const P = sec.rows.filter((r) => r.code === "P");
console.log("P rows:", P.length, "no ticker:", P.filter((r) => !r.ticker).length, "no acceptedAt:", P.filter((r) => !r.acceptedAt).length);
// counts of subsets in discovery (counts only)
const disc = E.filter((e) => e.publishedAt < "2026-06-15");
const cnt = (f) => disc.filter(f).length;
console.log("discovery events:", disc.length,
  "ceo/cfo:", cnt((e) => e.isCeo || e.isCfo), "open_market:", cnt((e) => e.venue === "open_market"), ">=250k:", cnt((e) => e.filingValue >= 2.5e5),
  "dd60<=-0.3:", cnt((e) => e.dd60 != null && e.dd60 <= -0.3), "nearLow60:", cnt((e) => e.nearLow60 === true),
  "strong (ceo/cfo & D & open & >=250k):", cnt((e) => (e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5),
  "ceo/cfo & >=250k:", cnt((e) => (e.isCeo || e.isCfo) && e.filingValue >= 2.5e5), "open & >=250k:", cnt((e) => e.venue === "open_market" && e.filingValue >= 2.5e5));
const pubBucket = (t) => (t >= "09:30:00" && t < "16:00:00" ? "rth" : t >= "16:00:00" && t < "20:00:00" ? "ah" : "overnight");
const pb = {}; for (const e of disc) { const b = pubBucket(e.publishedAt.slice(11)); pb[b] = (pb[b] || 0) + 1; } console.log("publication buckets:", pb);
console.log("issuers in discovery:", new Set(disc.map((e) => e.issuerCik)).size);
