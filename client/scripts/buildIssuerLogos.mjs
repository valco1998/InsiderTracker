// Builds the self-hosted company logos for the Companies page from a VERIFIED logo audit (offline — no network).
//   cd client && node scripts/buildIssuerLogos.mjs --audit <folder with final.json and iconfull/> [--out public/logos]
//
// A logo is written only when ALL of these hold (rules from the logo audit):
//   • final.json logoSource === "site" and status === "verified": the issuer's own latest 10-K / 20-F / 40-F names the
//     website, the domain matches the CURRENT SEC company name, and it is not a sponsor domain shared by several issuers;
//   • icon-quality.json marks the icon usable (decodable, ≥ the size floor, not blank, not a generic platform icon);
//   • the icon file is a format sharp can read (png / jpg / webp / svg; .ico and unknown binaries are skipped).
// Everything else gets ticker initials in the UI. Output: <out>/<cik10>.webp (64×64, contained, transparent) and
// <out>/manifest.v1.json = { version, generatedAt, rule, issuers: { "<cik10>": { bg: "light" | "dark" } } }.
// "dark" = the icon is white/near-white (invisible on a light tile). Logos are trademarks of their owners.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const AUDIT = arg("audit");
const OUT = path.resolve(arg("out", path.join(process.cwd(), "public", "logos")));
if (!AUDIT) { console.error("--audit <folder> is required"); process.exit(2); }
const final = JSON.parse(fs.readFileSync(path.join(AUDIT, "final.json"), "utf8"));
const qualityList = JSON.parse(fs.readFileSync(path.join(AUDIT, "iconfull", "icon-quality.json"), "utf8"));
const quality = new Map((Array.isArray(qualityList) ? qualityList : Object.values(qualityList)).map((q) => [q.cik, q]));
const ICONS = path.join(AUDIT, "iconfull", "icons");
const files = new Map(fs.readdirSync(ICONS).map((f) => [f.slice(0, f.lastIndexOf(".")).toUpperCase(), f]));
const READABLE = new Set(["png", "jpg", "jpeg", "webp", "svg"]);

fs.mkdirSync(OUT, { recursive: true });
const issuers = {}; const skipped = {};
const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
for (const rec of final) {
  if (rec.logoSource !== "site") { skip(`initials (${rec.logoSource})`); continue; }
  if (rec.status !== "verified") { skip("not verified"); continue; }
  const q = quality.get(rec.cik);
  if (!q?.usable) { skip("icon not usable"); continue; }
  const file = files.get(String(rec.ticker || "").toUpperCase());
  if (!file) { skip("icon file missing"); continue; }
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  if (!READABLE.has(ext)) { skip(`unreadable format .${ext}`); continue; }
  const cik10 = String(rec.cik).replace(/\D/g, "").padStart(10, "0");
  try {
    await sharp(path.join(ICONS, file), { density: 300 }).resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 82 }).toFile(path.join(OUT, `${cik10}.webp`));
    issuers[cik10] = { bg: q.q?.invisibleOnLight ? "dark" : "light" };
  } catch (e) { skip(`decode error`); }
}
const manifest = { version: 1, generatedAt: new Date().toISOString(), rule: "verified official-site icon (logo audit 2026-11-05); others use ticker initials", issuers };
fs.writeFileSync(path.join(OUT, "manifest.v1.json"), JSON.stringify(manifest));
const bytes = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(JSON.stringify({ out: OUT, logos: Object.keys(issuers).length, dark: Object.values(issuers).filter((x) => x.bg === "dark").length, totalKB: Math.round(bytes / 1024), skipped }, null, 1));
