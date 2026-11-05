// Builds the deep-5 report page from saved outputs (no recomputation of results, no network):
//   node scripts/research/deep5/report/build.mjs  →  server/.cache/research/deep5/report.html
// Sources: stats.json, clusters.json, coverage/coverage.json, build-summary.json, selfcheck.json, prereg.log,
//          report/audit-summary.json (written by the lead from audit/findings.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "..", "..", "..");
const D5 = path.join(SERVER, ".cache", "research", "deep5");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(D5, f), "utf8"));
const st = rd("stats.json"), J = rd("clusters.json"), cov = rd("coverage/coverage.json"), bs = rd("build-summary.json"), sc = rd("selfcheck.json");
const auditFile = path.join(here, "audit-summary.json");
const audit = fs.existsSync(auditFile) ? JSON.parse(fs.readFileSync(auditFile, "utf8")) : null;
const bars = JSON.parse(fs.readFileSync(path.join(SERVER, ".cache", "research", "daily-bars.json"), "utf8"));
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);

// timelines for every Clock 2 union event with a full window (main sample) plus the 20 largest partial ones
const main = J.unions[2].filter((u) => u.entryStatus === "ok" && u.full180 && !u.gap);
const tl = main.map((u) => {
  const b = bars[u.ticker] || []; const iE = b.findIndex((x) => x[0] >= u.entryDate);
  const end = addDays(u.entryDate, 180); let iX = b.findIndex((x) => x[0] > end); if (iX < 0) iX = b.length;
  const series = iE >= 0 ? b.slice(Math.max(0, iE - 30), Math.min(b.length, iX + 3)).map((x) => [x[0], x[1], x[2], x[3], x[4]]) : [];
  return { id: u.id, ticker: u.ticker, issuer: u.issuer, cats: u.cats, owners: u.owners, usd: u.usd, T: u.T, completion: u.c1Completion, entryDate: u.entryDate, entry: u.entry, maxDate: u.maxDate, maxGain: r4(u.maxGain), r180: r4(u.r180), n180: r4(u.n180), ctl: r4(u.ctl_n180), x180: r4(u.x180), daysToMax: u.daysToMax, minLowRet: r4(u.minLowRet), fund: u.fundLike,
    purchases: u.purchases.map((p) => [p.tradeDate, p.acceptedAt, p.insider, p.role, p.usd]), series };
});
const r4o = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "number" ? (Number.isInteger(v) ? v : r4(v)) : v)));
const data = r4o({
  generatedAt: new Date().toISOString(), preregSha: st.preregSha, desc: st.desc, curve: st.curve, months: st.months, tests: st.tests, strat: st.strat, sens: st.sens, independence: st.independence,
  events: st.eventTable, tl, counts: st.counts,
  coverage: { sec: { first: cov.sec.firstDay, last: cov.sec.lastDay, missing: cov.sec.missingBusinessDays, purchaseRows: cov.sec.purchaseRows, tradeRange: cov.sec.purchaseTradeDate }, bars: cov.bars, maturity: cov.maturity },
  rows: bs.rows, clusters: bs.clusters, selfcheck: sc.results.map((r) => ({ name: r.name, pass: r.pass })), audit,
});
const style = fs.readFileSync(path.join(SERVER, "scripts", "research", "deep2", "report", "_style.html"), "utf8");
const body = fs.readFileSync(path.join(here, "body.html"), "utf8");
const head = `<title>Insider Cluster Buying</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,650&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
`;
const out = path.join(D5, "report.html");
fs.writeFileSync(out, head + style + "\n" + body.replace("/*__DATA__*/null", JSON.stringify(data)));
console.log(`report → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB; timelines ${tl.length}, events ${data.events.length}, audit ${audit ? "yes" : "pending"})`);
