// Print one panel row (by acc, or the first primary row) and its controls.
import fs from "node:fs";
import path from "node:path";
import { OUT } from "../panelLib.mjs";
const P = JSON.parse(fs.readFileSync(path.join(OUT, "panel.json"), "utf8"));
const acc = process.argv[2];
const r = acc ? P.rows.find((x) => x.acc === acc) : P.rows.find((x) => x.primary && x.pPriorCo > 0 && x.B_st30 === "ok" && x.A_status === "ok");
const nonNull = Object.entries(r).filter(([, v]) => v != null);
console.log(JSON.stringify(Object.fromEntries(nonNull)));
console.log("null fields:", Object.entries(r).filter(([, v]) => v == null).map(([k]) => k).join(","));
console.log("meta keys", Object.keys(P.meta).join(","), "featureFields", P.meta.featureFields.length);
