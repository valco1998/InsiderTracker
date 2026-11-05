// deep4/audit/checkImports.mjs — resolves every relative import of the copies (no execution of their top-level code).
import fs from "node:fs";
import path from "node:path";
import { SCRIPTS } from "./common.mjs";
const D = path.join(SCRIPTS, "exposed"); let bad = 0, ok = 0;
for (const area of fs.readdirSync(D)) for (const f of fs.readdirSync(path.join(D, area))) {
  const src = fs.readFileSync(path.join(D, area, f), "utf8");
  for (const m of src.matchAll(/(?:from\s+"|import\(\s*")(\.{1,2}\/[^"]+)"/g)) { const p = path.resolve(D, area, m[1]); if (fs.existsSync(p)) ok++; else { bad++; console.log("MISSING", `${area}/${f}`, m[1]); } }
}
console.log(`imports resolved ${ok}, missing ${bad}`);
