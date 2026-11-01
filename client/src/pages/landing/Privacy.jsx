import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0a0a0f 0%, #0f0a1e 50%, #0a0a0f 100%)",
        color: "rgba(255,255,255,0.87)",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Nav */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 2rem",
          height: "64px",
          background: "rgba(10,10,15,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(139,92,246,0.15)",
        }}
      >
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <div style={{
            width: 32, height: 32, borderRadius: "8px",
            background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1rem", fontWeight: 700, color: "#fff",
          }}>S</div>
          <span style={{ fontWeight: 700, fontSize: "1.1rem", color: "#fff" }}>SKINTEL</span>
        </Link>
        <Link
          to="/"
          style={{
            color: "rgba(255,255,255,0.6)",
            textDecoration: "none",
            fontSize: "0.9rem",
            transition: "color 0.2s",
          }}
          onMouseOver={e => e.currentTarget.style.color = "#a78bfa"}
          onMouseOut={e => e.currentTarget.style.color = "rgba(255,255,255,0.6)"}
        >
          ← Back to Home
        </Link>
      </nav>

      {/* Content */}
      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "3rem 2rem 6rem" }}>
        <h1 style={{
          fontSize: "clamp(1.8rem, 4vw, 2.5rem)",
          fontWeight: 800,
          marginBottom: "0.5rem",
          background: "linear-gradient(90deg, #a78bfa, #818cf8)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          Privacy Policy
        </h1>
        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", marginBottom: "2.5rem" }}>
          Last updated: May 24, 2026
        </p>

        <Section title="1. Overview">
          <p>
            SKINTEL ("we," "our," or "us") operates the SkinTel web application available at{" "}
            <a href="https://skin-tel.com" style={{ color: "#a78bfa" }}>skin-tel.com</a>{" "}
            and the SkinTel Inventory Importer Chrome Extension. This Privacy Policy explains what data we collect,
            how we use it, and your rights regarding that data.
          </p>
        </Section>

        <Section title="2. Chrome Extension — Data Collection">
          <p style={{ marginBottom: "1rem" }}>
            The <strong style={{ color: "#c4b5fd" }}>SKINTEL Inventory Importer</strong> browser extension is designed
            to import your CS2 Steam inventory into the SkinTel platform. Here is exactly what the extension does and
            does not collect:
          </p>
          <SubHeading>What the extension DOES collect</SubHeading>
          <ul style={listStyle}>
            <li>Your <strong>Steam profile ID</strong> (public, visible in your Steam URL)</li>
            <li>Your <strong>CS2 inventory items</strong>: item names, types, float values, wear condition, stickers, inspect links, and estimated market prices as displayed on the Steam Community inventory page</li>
            <li>The <strong>timestamp</strong> of the import so we can track when your inventory was last synced</li>
          </ul>
          <SubHeading>What the extension does NOT collect</SubHeading>
          <ul style={listStyle}>
            <li>Steam account passwords or login credentials</li>
            <li>Steam session cookies or authentication tokens</li>
            <li>Browser history or data from other websites</li>
            <li>Personal financial information</li>
            <li>Any data outside your CS2 inventory on the Steam Community inventory page</li>
          </ul>
          <p style={{ marginTop: "1rem" }}>
            The extension only activates on <code style={codeStyle}>steamcommunity.com/*/inventory*</code> pages
            and only reads data visible in your browser when you click the "Import" button. No background collection
            occurs.
          </p>
        </Section>

        <Section title="3. Web Application — Data Collection">
          <p style={{ marginBottom: "1rem" }}>When you use the SkinTel web application, we may collect:</p>
          <ul style={listStyle}>
            <li><strong>Account information</strong>: username, email address, and encrypted password (for email/password sign-up), or your Steam profile ID and display name (for Steam OAuth login)</li>
            <li><strong>Inventory data</strong>: CS2 skin items imported via the Chrome extension or Steam API</li>
            <li><strong>Watchlist and alert rules</strong>: price thresholds and notification preferences you configure</li>
            <li><strong>Chat messages</strong>: messages you send within the platform's direct messaging and group chat features</li>
            <li><strong>Push notification tokens</strong>: FCM device tokens used to deliver browser push notifications (only stored if you explicitly enable push alerts)</li>
            <li><strong>Usage data</strong>: standard server logs including IP addresses, request timestamps, and accessed endpoints for security and debugging purposes</li>
          </ul>
        </Section>

        <Section title="4. How We Use Your Data">
          <ul style={listStyle}>
            <li>To provide and operate the SkinTel platform, including inventory tracking, price alerts, and trade matching</li>
            <li>To send push notifications and in-app alerts when your watchlist conditions are met</li>
            <li>To display your CS2 inventory and allow price analysis features</li>
            <li>To enable real-time chat and social features between users</li>
            <li>To authenticate your account securely</li>
            <li>To improve the platform based on usage patterns (aggregated, not sold to third parties)</li>
          </ul>
          <p style={{ marginTop: "1rem" }}>
            We do <strong>not</strong> sell your personal data to third parties. We do not use your data for
            advertising purposes.
          </p>
        </Section>

        <Section title="5. Data Storage and Security">
          <p>
            All data is stored on secure servers hosted by MongoDB Atlas (database) and Render (backend API).
            Passwords are hashed using bcrypt and are never stored in plain text. JWT tokens used for session
            authentication are short-lived and signed with a secret key.
          </p>
          <p style={{ marginTop: "1rem" }}>
            Data transmitted between your browser and our servers is encrypted using HTTPS/TLS.
          </p>
        </Section>

        <Section title="6. Third-Party Services">
          <p style={{ marginBottom: "1rem" }}>SkinTel integrates with the following third-party services:</p>
          <ul style={listStyle}>
            <li><strong>Steam (Valve Corporation)</strong> — for authentication and public inventory data. Subject to Steam's Privacy Policy.</li>
            <li><strong>Firebase Cloud Messaging (Google)</strong> — for delivering browser push notifications. FCM tokens are stored only when you enable push alerts and are deleted when you disable them.</li>
            <li><strong>MongoDB Atlas</strong> — database hosting for account and inventory data.</li>
            <li><strong>CSGOEmpire</strong> — for live market price feeds (read-only, no user data shared).</li>
          </ul>
        </Section>

        <Section title="7. Data Retention and Deletion">
          <p>
            You can delete your account and all associated data at any time by contacting us at{" "}
            <a href="mailto:akivaidan1998@gmail.com" style={{ color: "#a78bfa" }}>akivaidan1998@gmail.com</a>.
            Upon request, we will permanently delete:
          </p>
          <ul style={listStyle}>
            <li>Your account credentials and profile</li>
            <li>All imported inventory data</li>
            <li>Watchlist rules and alert history</li>
            <li>Chat messages and trade history</li>
            <li>All stored push notification tokens</li>
          </ul>
          <p style={{ marginTop: "1rem" }}>
            Push notification tokens can also be removed independently by clicking{" "}
            <strong style={{ color: "#c4b5fd" }}>Push Alerts: OFF</strong> in the Alerts Center, which immediately
            deactivates all device tokens associated with your account.
          </p>
        </Section>

        <Section title="8. Your Rights">
          <p style={{ marginBottom: "1rem" }}>You have the right to:</p>
          <ul style={listStyle}>
            <li><strong>Access</strong> the personal data we hold about you</li>
            <li><strong>Correct</strong> inaccurate data by updating your account settings</li>
            <li><strong>Delete</strong> your data by contacting us (see above)</li>
            <li><strong>Withdraw consent</strong> for push notifications at any time via browser settings or the in-app toggle</li>
            <li><strong>Object</strong> to data processing by contacting us directly</li>
          </ul>
        </Section>

        <Section title="9. Children's Privacy">
          <p>
            SkinTel is not directed at children under the age of 13. We do not knowingly collect personal data from
            children. If you believe a child has provided us with personal information, please contact us and we will
            delete it promptly.
          </p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. When we make material changes, we will update the
            "Last updated" date at the top of this page. Continued use of the platform after changes constitutes
            acceptance of the updated policy.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            For any privacy-related questions, data deletion requests, or concerns, please contact us at:
          </p>
          <div style={{
            marginTop: "1rem",
            padding: "1rem 1.5rem",
            background: "rgba(139,92,246,0.08)",
            border: "1px solid rgba(139,92,246,0.2)",
            borderRadius: "12px",
            color: "rgba(255,255,255,0.8)",
          }}>
            <strong style={{ color: "#c4b5fd" }}>SKINTEL Support</strong><br />
            Email:{" "}
            <a href="mailto:akivaidan1998@gmail.com" style={{ color: "#a78bfa" }}>akivaidan1998@gmail.com</a><br />
            Website:{" "}
            <a href="https://skin-tel.com" style={{ color: "#a78bfa" }}>skin-tel.com</a>
          </div>
        </Section>
      </div>

      {/* Footer */}
      <footer style={{
        borderTop: "1px solid rgba(139,92,246,0.1)",
        padding: "2rem",
        textAlign: "center",
        color: "rgba(255,255,255,0.3)",
        fontSize: "0.85rem",
      }}>
        <p>© 2026 SKINTEL. All rights reserved.</p>
        <div style={{ marginTop: "0.5rem", display: "flex", justifyContent: "center", gap: "1.5rem" }}>
          <Link to="/" style={{ color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>Home</Link>
          <Link to="/privacy" style={{ color: "#a78bfa", textDecoration: "none" }}>Privacy Policy</Link>
          <a href="mailto:akivaidan1998@gmail.com" style={{ color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>Contact</a>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: "2.5rem" }}>
      <h2 style={{
        fontSize: "1.15rem",
        fontWeight: 700,
        color: "#c4b5fd",
        marginBottom: "0.75rem",
        paddingBottom: "0.4rem",
        borderBottom: "1px solid rgba(139,92,246,0.15)",
      }}>
        {title}
      </h2>
      <div style={{ color: "rgba(255,255,255,0.75)", lineHeight: 1.75, fontSize: "0.95rem" }}>
        {children}
      </div>
    </section>
  );
}

function SubHeading({ children }) {
  return (
    <p style={{ fontWeight: 600, color: "rgba(255,255,255,0.9)", marginBottom: "0.4rem", marginTop: "0.75rem" }}>
      {children}
    </p>
  );
}

const listStyle = {
  paddingLeft: "1.5rem",
  lineHeight: 2,
  color: "rgba(255,255,255,0.72)",
};

const codeStyle = {
  background: "rgba(139,92,246,0.15)",
  padding: "0.1rem 0.4rem",
  borderRadius: "4px",
  fontSize: "0.85rem",
  color: "#c4b5fd",
  fontFamily: "monospace",
};
