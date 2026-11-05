// deep4/learn/report.mjs — compiles per-month walk-forward tables (from wf.mjs run files) into CSV + console text.
//   node scripts/research/deep4/learn/report.mjs [--segment=design]
import fs from "node:fs";
import { readOut, existsOut, outPath, toCsv } from "./common.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const SEGMENT = arg("segment", "design"), DIR = `wf-${SEGMENT}`;
const pc = (x) => (x == null || !Number.isFinite(x) ? "  -  " : `${(x * 100).toFixed(2)}`);
const f3 = (x) => (x == null || !Number.isFinite(x) ? "  -  " : x.toFixed(3));
const rows = [];
for (const t of ["xs30", "hit30", "xs5", "xs10", "mae30", "hit10d"]) {
  const c3 = existsOut(`${DIR}/run-${t}-M3c.json`) ? readOut(`${DIR}/run-${t}-M3c.json`) : null;
  const c3ev = new Map((c3?.monthTable || []).map((m) => [m.month, m])), c3ct = new Map((c3?.controlsMonths || []).map((m) => [m.month, m]));
  for (const mid of ["M0", "M1", "M2", "M3", "M4", "M3c", "M3p", "M5", "TREE", "EN", "D1", "D2"]) {
    if (!existsOut(`${DIR}/run-${t}-${mid}.json`)) continue;
    const R = readOut(`${DIR}/run-${t}-${mid}.json`);
    const ctlMonths = new Map((R.controlsMonths || []).map((m) => [m.month, m]));
    for (const m of R.monthTable) {
      const lam = R.models.find((x) => x.month === m.month)?.lambda;
      rows.push({ target: t, model: mid, month: m.month, n: m.n, issuers: m.issuers, skill: m.auc ?? m.ic ?? null, brier: m.brier ?? null, bss: m.bss ?? null, calInLarge: m.calInLarge ?? null, calSlope: m.calSlope ?? null,
        topXs30: m.topXs30, restXs30: m.restXs30, topHit30: m.topHit30, restHit30: m.restHit30, selN: m.selN, selXs30: m.selXs30, allXs30: m.allXs30,
        M3cOnEvents: c3ev.get(m.month)?.auc ?? c3ev.get(m.month)?.ic ?? null, M3cOnControls: c3ct.get(m.month)?.value ?? null, thisOnControls: ctlMonths.get(m.month)?.value ?? null, lambda: JSON.stringify(lam ?? null) });
    }
  }
}
fs.writeFileSync(outPath(`${DIR}/month-tables.csv`), toCsv(rows, Object.keys(rows[0])));
let cur = "";
for (const r of rows) {
  const k = `${r.target}`; if (k !== cur) { cur = k; console.log(`\n### ${r.target} (${r.target.startsWith("hit") ? "AUC" : "IC"}) — month | n | skill | Brier/BSS | cal slope | top-q xs30 vs rest | top-q hit30 vs rest | exec sel n / xs30 (all) | M3c on events / on controls`); }
  console.log(`${r.model.padEnd(5)} ${r.month} n${String(r.n).padStart(4)} skill ${f3(r.skill)} ${r.brier != null ? `Brier ${f3(r.brier)} BSS ${f3(r.bss)}` : ""} slope ${f3(r.calSlope)} | top ${pc(r.topXs30)} rest ${pc(r.restXs30)} | hit ${pc(r.topHit30)} vs ${pc(r.restHit30)} | sel ${r.selN} ${pc(r.selXs30)} (all ${pc(r.allXs30)}) | M3c ${f3(r.M3cOnEvents)} / ${f3(r.M3cOnControls)}${r.thisOnControls != null ? ` | this on ctl ${f3(r.thisOnControls)}` : ""} | λ ${r.lambda}`);
}
