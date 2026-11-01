import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'public', 'og-image.png');

const W = 1200;
const H = 630;

const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background radial gradient -->
    <radialGradient id="bg" cx="50%" cy="50%" r="75%">
      <stop offset="0%"   stop-color="#1a0a3a"/>
      <stop offset="60%"  stop-color="#0d0520"/>
      <stop offset="100%" stop-color="#050816"/>
    </radialGradient>

    <!-- Centre glow behind logo -->
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#7c3aed" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>

    <!-- Gold shimmer for logo text -->
    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="#ffffff"/>
      <stop offset="40%"  stop-color="#e2cfff"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>

    <!-- Accent line gradient -->
    <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="#7c3aed" stop-opacity="0"/>
      <stop offset="30%"  stop-color="#a855f7" stop-opacity="0.9"/>
      <stop offset="50%"  stop-color="#c084fc" stop-opacity="1"/>
      <stop offset="70%"  stop-color="#a855f7" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#7c3aed" stop-opacity="0"/>
    </linearGradient>

    <!-- Subtle grid pattern -->
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M 60 0 L 0 0 0 60" fill="none"
            stroke="#7c3aed" stroke-width="0.4" stroke-opacity="0.18"/>
    </pattern>

    <!-- Corner bracket clip -->
    <filter id="softBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>

  <!-- Background fill -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Grid overlay -->
  <rect width="${W}" height="${H}" fill="url(#grid)"/>

  <!-- Centre ambient glow -->
  <ellipse cx="${W/2}" cy="${H/2}" rx="480" ry="260" fill="url(#glow)" filter="url(#softBlur)"/>

  <!-- Top border line -->
  <rect x="0" y="0" width="${W}" height="3" fill="url(#lineGrad)"/>
  <!-- Bottom border line -->
  <rect x="0" y="${H-3}" width="${W}" height="3" fill="url(#lineGrad)"/>

  <!-- Decorative corner brackets — top-left -->
  <path d="M 48 48 L 48 88 M 48 48 L 88 48"
        stroke="#a855f7" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.7"/>
  <!-- top-right -->
  <path d="M ${W-48} 48 L ${W-48} 88 M ${W-48} 48 L ${W-88} 48"
        stroke="#a855f7" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.7"/>
  <!-- bottom-left -->
  <path d="M 48 ${H-48} L 48 ${H-88} M 48 ${H-48} L 88 ${H-48}"
        stroke="#a855f7" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.7"/>
  <!-- bottom-right -->
  <path d="M ${W-48} ${H-48} L ${W-48} ${H-88} M ${W-48} ${H-48} L ${W-88} ${H-48}"
        stroke="#a855f7" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.7"/>

  <!-- Horizontal accent lines flanking logo -->
  <rect x="100" y="${H/2 - 1}" width="310" height="1.5" fill="url(#lineGrad)" opacity="0.6"/>
  <rect x="${W - 410}" y="${H/2 - 1}" width="310" height="1.5" fill="url(#lineGrad)" opacity="0.6"/>

  <!-- Diamond accent dots -->
  <polygon points="${W/2},${H/2 - 95} ${W/2 + 7},${H/2 - 88} ${W/2},${H/2 - 81} ${W/2 - 7},${H/2 - 88}"
           fill="#c084fc" opacity="0.85"/>
  <polygon points="${W/2},${H/2 + 95} ${W/2 + 7},${H/2 + 88} ${W/2},${H/2 + 81} ${W/2 - 7},${H/2 + 88}"
           fill="#c084fc" opacity="0.85"/>

  <!-- SKINTEL main logo -->
  <text
    x="${W/2}" y="${H/2 + 24}"
    text-anchor="middle"
    font-family="'Arial Black', 'Impact', 'Helvetica Neue', sans-serif"
    font-weight="900"
    font-size="148"
    letter-spacing="18"
    fill="url(#logoGrad)"
  >SKINTEL</text>

  <!-- Tagline -->
  <text
    x="${W/2}" y="${H/2 + 80}"
    text-anchor="middle"
    font-family="'Arial', 'Helvetica Neue', sans-serif"
    font-weight="400"
    font-size="22"
    letter-spacing="7"
    fill="#a78bfa"
    opacity="0.9"
  >CS2 MARKET INTELLIGENCE</text>

  <!-- Subtle dot row above tagline -->
  <circle cx="${W/2 - 90}" cy="${H/2 + 57}" r="2" fill="#7c3aed" opacity="0.6"/>
  <circle cx="${W/2}"      cy="${H/2 + 57}" r="2" fill="#c084fc" opacity="0.8"/>
  <circle cx="${W/2 + 90}" cy="${H/2 + 57}" r="2" fill="#7c3aed" opacity="0.6"/>
</svg>
`.trim();

await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9, quality: 100 })
  .toFile(outPath);

console.log(`OG image written to ${outPath}`);
