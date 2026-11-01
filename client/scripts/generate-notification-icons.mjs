// Generates Insider Tracker push-notification icons from inline SVG.
//   node scripts/generate-notification-icons.mjs
// Output (public/icons/):
//   insider-notification-192.png — full-colour notification icon
//   insider-badge-96.png         — monochrome badge (Android uses alpha only)
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// Dark panel (index.css --bg-panel / --bg-app), cyan accent (--cyan).
const icon = `
<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1f2838"/><stop offset="1" stop-color="#141a24"/>
    </linearGradient>
  </defs>
  <rect width="192" height="192" rx="40" fill="url(#bg)"/>
  <rect x="1.5" y="1.5" width="189" height="189" rx="38.5" fill="none" stroke="#22d3ee" stroke-opacity="0.35" stroke-width="3"/>
  <g fill="#22d3ee" fill-opacity="0.22">
    <rect x="42" y="112" width="18" height="40" rx="4"/>
    <rect x="72" y="96" width="18" height="56" rx="4"/>
    <rect x="102" y="104" width="18" height="48" rx="4"/>
    <rect x="132" y="76" width="18" height="76" rx="4"/>
  </g>
  <polyline points="40,118 74,90 104,104 146,58" fill="none" stroke="#22d3ee" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <polygon points="152,40 160,78 124,62" fill="#22d3ee"/>
</svg>`;

const badge = `
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <polyline points="14,66 34,48 50,58 76,30" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <polygon points="82,18 86,44 62,34" fill="#ffffff"/>
</svg>`;

await sharp(Buffer.from(icon)).png().toFile(path.join(out, "insider-notification-192.png"));
await sharp(Buffer.from(badge)).png().toFile(path.join(out, "insider-badge-96.png"));
console.log("wrote", path.join(out, "insider-notification-192.png"), "and insider-badge-96.png");
