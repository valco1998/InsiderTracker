import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Navbar from "./Navbar.jsx";
import GlobalChatDock from "./GlobalChatDock.jsx";
import useFcmKeepAlive from "../../hooks/useFcmKeepAlive.js";

export default function AppLayout({ children }) {
  // Keep FCM token alive on every authenticated page (not just Alerts).
  // Without this, tokens silently expire and push stops working.
  useFcmKeepAlive();

  const [showDock, setShowDock] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setShowDock(mq.matches);
    const handler = (e) => setShowDock(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <div className="flex min-h-screen overflow-x-hidden" style={{ background: "var(--bg-app)" }}>
      {showDock && <GlobalChatDock />}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <Navbar />
        <main className="flex-1 min-w-0">{children}</main>
        <footer style={{
          borderTop: "1px solid rgba(255,255,255,0.05)",
          padding: "12px clamp(14px,4vw,24px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}>
          <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.18)" }}>
            © {new Date().getFullYear()} SkinTel
          </span>
          <nav style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <Link
              to="/privacy"
              style={{ fontSize: 11.5, color: "rgba(255,255,255,0.30)", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.65)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.30)"; }}
            >
              Privacy Policy
            </Link>
            <a
              href="mailto:akivaidan1998@gmail.com"
              style={{ fontSize: 11.5, color: "rgba(255,255,255,0.30)", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.65)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.30)"; }}
            >
              Contact
            </a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
