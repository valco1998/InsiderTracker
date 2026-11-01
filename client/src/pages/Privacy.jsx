import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #07080f 0%, #0f0a1e 60%, #07080f 100%)",
      color: "rgba(255,255,255,0.87)",
      fontFamily: "inherit",
    }}>

      {/* ── Nav ───────────────────────────────────────────────────── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 2rem", height: 60,
        background: "rgba(7,8,15,0.88)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(139,92,246,0.13)",
      }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 14, color: "#fff",
          }}>S</div>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#fff", letterSpacing: "-0.01em" }}>SKINTEL</span>
        </Link>
        <Link to="/" style={{
          color: "rgba(255,255,255,0.50)", textDecoration: "none",
          fontSize: 13, transition: "color 0.15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.color = "#a78bfa"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.50)"; }}
        >
          ← Back to Home
        </Link>
      </nav>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 28px 96px" }}>

        <h1 style={{
          fontSize: "clamp(1.75rem, 4vw, 2.4rem)", fontWeight: 800,
          marginBottom: 6, lineHeight: 1.1,
          background: "linear-gradient(90deg, #a78bfa 0%, #818cf8 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          Privacy Policy
        </h1>
        <p style={{ color: "rgba(255,255,255,0.38)", fontSize: 13, marginBottom: 40 }}>
          Last updated: May 2026
        </p>

        <Section title="Overview">
          <p>
            SkinTel ("we," "our," or "us") operates the SkinTel web application at{" "}
            <a href="https://skin-tel.com" style={linkStyle}>skin-tel.com</a>{" "}
            and the SkinTel Inventory Importer Chrome Extension. This policy explains what
            data we collect, how we use it, and your rights.
          </p>
        </Section>

        <Section title="What We Do NOT Collect">
          <ul style={ul}>
            <li><strong>Steam passwords</strong> — SkinTel never asks for or stores your Steam account password.</li>
            <li><strong>Steam session cookies</strong> — We do not intercept, store, or transmit Steam authentication cookies.</li>
            <li><strong>Browser history</strong> — No data is collected outside of the Steam inventory page when you use the extension.</li>
            <li><strong>Financial information</strong> — We do not collect payment card details or banking information.</li>
          </ul>
        </Section>

        <Section title="What We Collect">
          <ul style={ul}>
            <li><strong>Account info</strong> — username, email, and hashed password (for email sign-up), or Steam profile ID and display name (for Steam OAuth).</li>
            <li><strong>Inventory data</strong> — CS2 skin items imported via the Chrome extension or Steam API: item names, float values, wear, stickers, and market prices. Used exclusively for SkinTel features (import, trading, price analysis, trade matching).</li>
            <li><strong>Watchlist &amp; alert rules</strong> — price thresholds and notification preferences you configure.</li>
            <li><strong>Push notification tokens</strong> — FCM device tokens stored only if you explicitly enable push alerts; deleted immediately when you disable them.</li>
            <li><strong>Standard server logs</strong> — IP address, request timestamps, and endpoints accessed, for security and debugging only.</li>
          </ul>
        </Section>

        <Section title="How Inventory Data Is Used">
          <p>
            Inventory data imported into SkinTel is used <em>only</em> for the following platform features:
          </p>
          <ul style={ul}>
            <li>Displaying your CS2 inventory within the app</li>
            <li>Powering price analysis and market comparison tools</li>
            <li>Enabling trade posting and trade matching with other users</li>
            <li>Generating watchlist alerts when item prices change</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            Inventory data is never used for advertising, profiling, or any purpose outside
            SkinTel functionality.
          </p>
        </Section>

        <Section title="Data Is Not Sold">
          <p>
            We do <strong>not</strong> sell, rent, or share your personal data with third parties
            for commercial purposes. Data shared with infrastructure providers (MongoDB Atlas,
            Render, Firebase) is strictly for operating the platform.
          </p>
        </Section>

        <Section title="Third-Party Services">
          <ul style={ul}>
            <li><strong>Steam / Valve</strong> — OAuth login and public inventory data. Subject to <a href="https://store.steampowered.com/privacy_agreement/" target="_blank" rel="noreferrer" style={linkStyle}>Steam's Privacy Policy</a>.</li>
            <li><strong>Firebase (Google)</strong> — Browser push notifications only. FCM tokens deleted when you turn off push alerts.</li>
            <li><strong>MongoDB Atlas</strong> — Encrypted database hosting for account and inventory data.</li>
            <li><strong>CSGOEmpire</strong> — Live market price feeds (read-only; no user data is sent to them).</li>
          </ul>
        </Section>

        <Section title="Data Deletion">
          <p>
            You can request deletion of your account and all associated data at any time.
            Contact us at the email below and we will permanently delete your account,
            inventory, alerts, chat history, and push tokens within 7 days.
          </p>
          <p style={{ marginTop: 12 }}>
            Push tokens can be removed instantly by clicking <strong style={{ color: "#c4b5fd" }}>PUSH ENABLED → disable</strong> in
            the Alerts page.
          </p>
        </Section>

        <Section title="Contact">
          <div style={{
            padding: "16px 20px", borderRadius: 12,
            background: "rgba(139,92,246,0.07)",
            border: "1px solid rgba(139,92,246,0.18)",
          }}>
            <p style={{ margin: 0, color: "rgba(255,255,255,0.80)", lineHeight: 1.8 }}>
              <strong style={{ color: "#c4b5fd" }}>SkinTel</strong><br />
              Email:{" "}
              <a href="mailto:akivaidan1998@gmail.com" style={linkStyle}>
                akivaidan1998@gmail.com
              </a>
            </p>
          </div>
        </Section>

      </div>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "20px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12,
      }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
          © {new Date().getFullYear()} SkinTel. All rights reserved.
        </span>
        <div style={{ display: "flex", gap: 20 }}>
          <Link to="/" style={footerLink} onMouseEnter={fIn} onMouseLeave={fOut}>Home</Link>
          <Link to="/privacy" style={{ ...footerLink, color: "#a78bfa" }}>Privacy Policy</Link>
          <a href="mailto:akivaidan1998@gmail.com" style={footerLink} onMouseEnter={fIn} onMouseLeave={fOut}>Contact</a>
        </div>
      </footer>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{
        fontSize: "1.05rem", fontWeight: 700, color: "#c4b5fd",
        marginBottom: 12, paddingBottom: 8,
        borderBottom: "1px solid rgba(139,92,246,0.14)",
      }}>
        {title}
      </h2>
      <div style={{ color: "rgba(255,255,255,0.72)", lineHeight: 1.8, fontSize: "0.94rem" }}>
        {children}
      </div>
    </section>
  );
}

const ul = { paddingLeft: "1.4rem", lineHeight: 2.1, color: "rgba(255,255,255,0.70)" };
const linkStyle = { color: "#a78bfa", textDecoration: "none" };
const footerLink = { fontSize: 12, color: "rgba(255,255,255,0.35)", textDecoration: "none", transition: "color 0.15s" };
const fIn  = e => { e.currentTarget.style.color = "rgba(255,255,255,0.75)"; };
const fOut = e => { e.currentTarget.style.color = "rgba(255,255,255,0.35)"; };
