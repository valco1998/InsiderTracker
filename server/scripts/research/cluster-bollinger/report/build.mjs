// node scripts/research/cluster-bollinger/report/build.mjs → server/.cache/research/cluster-bollinger/report.html
// Reads saved outputs only (results.json, selfcheck.json, spec.log); no recomputation, no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "..", "..", "..");
const OUTD = path.join(SERVER, ".cache", "research", "cluster-bollinger");
const res = JSON.parse(fs.readFileSync(path.join(OUTD, "results.json"), "utf8"));
const sc = JSON.parse(fs.readFileSync(path.join(OUTD, "selfcheck.json"), "utf8"));
const specLog = fs.readFileSync(path.join(OUTD, "spec.log"), "utf8").trim();
const r4 = (x) => (typeof x === "number" && !Number.isInteger(x) ? Math.round(x * 1e5) / 1e5 : x);
const data = JSON.parse(JSON.stringify({ ...res, selfcheck: sc.results.map((r) => ({ name: r.name, pass: r.pass })), specLog }, (k, v) => r4(v)));
const style = fs.readFileSync(path.join(SERVER, "scripts", "research", "deep2", "report", "_style.html"), "utf8");
const body = fs.readFileSync(path.join(here, "body.html"), "utf8");
const head = `<title>Insider Clusters with Bollinger Bands</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,650&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
`;
const out = path.join(OUTD, "report.html");
fs.writeFileSync(out, head + style + "\n" + body.replace("/*__DATA__*/null", JSON.stringify(data)));
console.log(`report → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
