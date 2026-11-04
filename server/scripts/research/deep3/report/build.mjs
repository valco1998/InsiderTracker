// Builds the deep-3 report page from saved outputs (no recomputation):
//   node scripts/research/deep3/report/build.mjs  →  server/.cache/research/deep3/report.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "..", "..", "..");
const D3 = path.join(SERVER, ".cache", "research", "deep3");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(D3, f), "utf8"));

const table = rd("sequence/position-target-table.json")
  .filter((r) => r.grouping === "cal" && r.universe === "om")
  .map((r) => ({ period: r.period, bucket: r.bucket, target: r.target, n: r.n, issuers: r.issuers, medianUsd: r.medianUsd,
    w: [r.w1, r.w2, r.w3, r.w5, r.w10], c: [r.ctl_w1, r.ctl_w2, r.ctl_w3, r.ctl_w5, r.ctl_w10], diff5: r.diff_w5, lo: r.diff_w5_lo, hi: r.diff_w5_hi,
    sessions: r.medianSessionsToTarget, ctlSessions: r.ctlMedianSessions, dd: r.ddBeforeTargetMedian, months: r.months, monthsAbove: r.monthsAboveCtl,
    top5: r.top5ShareOfHits, n3: r.net_N3, n3med: r.net_N3_median, lf5: r.limitFill_N5 }));

const cases = fs.readdirSync(path.join(D3, "sequence")).filter((f) => /^case-.*\.json$/.test(f)).map((f) => {
  const c = rd(`sequence/${f}`);
  return {
    key: `${c.ticker} ${c.month}`, ticker: c.ticker, month: c.month, selection: c.selection, summary: c.summary, narrative: c.narrative,
    series: c.series.map((b) => [b.d, b.o, b.h, b.l, b.c, b.v]),
    markers: c.markers.map((m) => ({ type: m.type, pos: m.position, role: m.primaryRole || m.role, title: m.role, usd: m.usd, own: m.own, at: m.acceptedAt, entry: m.entryDate,
      open: m.entryOpen, gap: m.gapX, n1: m.net1?.N1 ?? null, n5: m.net1?.N5 ?? null, t10: m.firstTouch?.t10 ?? null })),
  };
}).sort((a, b) => (b.summary.fromBuyer1EntryToEnd ?? 0) - (a.summary.fromBuyer1EntryToEnd ?? 0));

const data = { generatedAt: new Date().toISOString(), table, cases };
const style = fs.readFileSync(path.join(SERVER, "scripts", "research", "deep2", "report", "_style.html"), "utf8");
const body = fs.readFileSync(path.join(here, "body.html"), "utf8");
const head = `<title>Insider Buyer Sequences</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,650&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
`;
const out = path.join(D3, "report.html");
fs.writeFileSync(out, head + style + "\n" + body.replace("/*__DATA__*/null", JSON.stringify(data)));
console.log(`report → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${table.length} table rows, ${cases.length} cases)`);
