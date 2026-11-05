// Builds the deep-4 report page from saved outputs (no recomputation, no network):
//   node scripts/research/deep4/report/build.mjs  →  server/.cache/research/deep4/report.html
// Numbers that exist only in agents' hand-back reports (strategy tables across periods, exposed-period model IC)
// are copied from the saved findings.md files and labelled with their source file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "..", "..", "..");
const D4 = path.join(SERVER, ".cache", "research", "deep4");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(D4, f), "utf8"));

function csv(f) {
  const txt = fs.readFileSync(path.join(D4, f), "utf8").trim();
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"' && txt[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cur); cur = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && txt[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; } else cur += ch;
  }
  row.push(cur); rows.push(row);
  const [h, ...rest] = rows; return rest.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const num = (v) => (v === "" || v == null || v === "null" ? null : Number(v));

// 1. Month-by-month 30-day outcomes (primary open-market purchases)
const months = [];
const dB = csv("panel/describe-B-by-month.csv").filter((r) => r.universe === "om" && r.H === "30" && r.month !== "ALL" && num(r.n) > 0);
const dA = new Map(csv("panel/describe-A-by-month.csv").filter((r) => r.universe === "om" && r.H === "30").map((r) => [r.month, r]));
for (const r of dB) months.push({ month: r.month, seg: "design", n: num(r.n), b: num(r.meanXsNet), bMed: num(r.medianXsNet), ctl: num(r.ctlXsNet), a: num(dA.get(r.month)?.meanXs), spy: num(r.meanSpy) });
for (const [f, seg] of [["audit/confirm-dryrun-monthly.csv", "confirm"], ["audit/exposed-period-monthly.csv", "exposed"]])
  for (const r of csv(f).filter((r) => r.H === "30" && r.month !== "ALL" && num(r.B_n) > 0))
    months.push({ month: r.month, seg, n: num(r.B_n), censored: num(r.B_censored), b: num(r.B_meanXsNet), bMed: num(r.B_medianXsNet), ctl: num(r.B_ctl), a: num(r.A_meanXs), spy: num(r.B_meanSpy) });

// 2. Walk-forward rank skill (IC, 30-day net excess) by month
const wf = [];
for (const [f, seg] of [["learn/wf-design/month-tables.csv", "design"], ["learn/wf-confirm/month-tables.csv", "confirm"]])
  for (const r of csv(f).filter((r) => r.target === "xs30" && ["M2", "M3", "M4", "M3c"].includes(r.model)))
    wf.push({ seg, month: r.month, model: r.model, n: num(r.n), ic: num(r.skill), icCtl: r.model === "M3c" ? num(r.M3cOnControls) : null });
const wfExposed = { source: "audit/findings.md (pooled Sep–Oct walk-forward)", M2: 0.009, M3: -0.001, M4: 0.025, M3c: 0.378, M3cOnControls: 0.345 };

// 3. Control-construction mechanism (audit A8)
const mech = rd("audit/a4b-mechanism.json");

// 4. Style consistency (episode level) and profiles
const cons = rd("behavior/consistency.json").tests.filter((t) => t.level === "episode").map((t) => ({ label: t.label, units: t.units, persons: t.persons, r: t.r, p: t.p, q: t.qFamily }));
const prof = csv("behavior/profiles.csv").filter((r) => r.styleTags).sort((a, b) => num(b.nEpisodes) - num(a.nEpisodes) || num(b.nPurchases) - num(a.nPurchases)).slice(0, 40)
  .map((r) => ({ name: r.ownerName, tickers: r.tickers, roles: r.roles, n: num(r.nPurchases), ep: num(r.nEpisodes), iss: num(r.nIssuers), tags: r.styleTags, conf: r.confidence, usd: num(r.usdTotal), first: r.first?.slice(0, 10), last: r.last?.slice(0, 10) }));
const profCount = csv("behavior/profiles.csv").length;

// 5. Winners and losers with price paths (split-adjusted daily bars, 40 sessions before entry → exit + 3)
const bars = JSON.parse(fs.readFileSync(path.join(SERVER, ".cache", "research", "daily-bars.json"), "utf8"));
const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const wl = rd("behavior/winners-losers.json")["behavior.S0.all"];
const cases = [];
for (const seg of ["design", "confirm"]) for (const kind of ["winners", "losers"]) for (const c of wl[seg][kind].slice(0, 10)) {
  const b = bars[sym(c.ticker)]; let series = [];
  if (b) { const iE = b.findIndex((x) => x[0] >= c.entryDate); const iX = b.findIndex((x) => x[0] >= c.exitDate); if (iE >= 0) series = b.slice(Math.max(0, iE - 40), (iX >= 0 ? iX : b.length - 1) + 4).map((x) => [x[0], x[1], x[2], x[3], x[4]]); }
  cases.push({ seg, kind, ticker: c.ticker, insider: c.insider, role: c.role, published: c.published, tradeDate: c.tradeDate, entryDate: c.entryDate, exitDate: c.exitDate, usd: c.usd, ctx: c.context, path: c.path, xsNet: c.xsNet, series });
}

// 6. Strategy results across periods (copied from saved findings; independent trades, 30-day net excess vs SPY, tier costs)
const strategies = {
  source: "behavior/findings.md, learn/findings.md, audit/findings.md (exposed-period-trades.csv)",
  rows: [
    { id: "S0", fam: "Baseline", rule: "Every open-market purchase, next open → close after 30 calendar days", design: 0.18, confirm: -2.09, exposed: -8.07, nE: 313, verdict: "REJECTED" },
    { id: "S1x", fam: "A · behaviour", rule: "Insider's first purchase seen since Dec 2025 (post-hoc reference)", design: 0.45, confirm: -2.44, exposed: -7.52, nE: 164, verdict: "REJECTED" },
    { id: "A04", fam: "A · behaviour", rule: "Buyer who has bought at more than one company", design: 0.87, confirm: -1.8, exposed: -1.41, nE: 25, verdict: "REJECTED" },
    { id: "A11", fam: "A · behaviour", rule: "Contrarian-style buyer at a new company", design: 1.55, confirm: 4.5, exposed: -0.47, nE: 5, verdict: "INSUFFICIENT DATA" },
    { id: "A01–A10", fam: "A · behaviour", rule: "Ten other style rules (dip buyers, size escalation, averaging down…)", design: null, designTxt: "−2.9 to +0.9", confirm: null, confirmTxt: "10 of 11 negative", exposed: null, exposedTxt: "−15.4 to −1.4", verdict: "REJECTED" },
    { id: "C10", fam: "C · track record", rule: "Insiders whose matured past results are positive (monthly refit)", design: -1.79, confirm: -1.3, exposed: -8.92, nE: 54, verdict: "REJECTED" },
    { id: "S1", fam: "Model", rule: "Elastic-net model, top fifth of predictions", design: -0.05, confirm: -3.9, exposed: -8.36, nE: 155, verdict: "REJECTED" },
    { id: "S2", fam: "Model", rule: "Combined ridge model, top fifth of predictions", design: 0.12, confirm: -3.84, exposed: -7.9, nE: 107, verdict: "REJECTED" },
    { id: "S3", fam: "B · price check", rule: "Skip if the stock opens more than 3.2% above the pre-filing close", design: 0.08, confirm: -1.34, exposed: -6.64, nE: 185, verdict: "REJECTED" },
  ],
};

const data = { generatedAt: new Date().toISOString(), months, wf, wfExposed, mech, cons, prof, profCount, cases, strategies };
const style = fs.readFileSync(path.join(SERVER, "scripts", "research", "deep2", "report", "_style.html"), "utf8");
const body = fs.readFileSync(path.join(here, "body.html"), "utf8");
const head = `<title>Learning From Insider Behaviour</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,650&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
`;
const out = path.join(D4, "report.html");
fs.writeFileSync(out, head + style + "\n" + body.replace("/*__DATA__*/null", JSON.stringify(data)));
console.log(`report → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB; months ${months.length}, wf ${wf.length}, profiles ${prof.length}/${profCount}, cases ${cases.length}, cases with bars ${cases.filter((c) => c.series.length).length})`);
