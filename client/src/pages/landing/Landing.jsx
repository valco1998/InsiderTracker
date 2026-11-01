import { useNavigate, Link } from "react-router-dom";
import skintelLogo from "../../assets/skintel.logo.png";

/* ─── Keyframes ─────────────────────────────────────── */

const CSS = `
  @keyframes landingNebula { 0%,100%{opacity:.72;transform:scale(1) translate(0,0)} 50%{opacity:1;transform:scale(1.05) translate(8px,-12px)} }
  @keyframes landingFloat  { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-10px)} }
  @keyframes landingPulse  { 0%,100%{opacity:1;box-shadow:0 0 5px #a855f7} 50%{opacity:.4;box-shadow:0 0 14px #a855f7} }
  @keyframes landingStar   { 0%,100%{opacity:.38;transform:scale(1)} 50%{opacity:1;transform:scale(1.5)} }
  @keyframes landingFade   { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
  @keyframes meteorFall    { 0%{transform:rotate(-45deg) translateX(0);opacity:0} 6%{opacity:1} 88%{opacity:.8} 100%{transform:rotate(-45deg) translateX(700px);opacity:0} }
  @keyframes cardHoverGlow { 0%,100%{box-shadow:0 0 0 rgba(168,85,247,0)} 50%{box-shadow:0 0 28px rgba(168,85,247,.08)} }
`;

/* ─── Background data (deterministic) ───────────────── */

const STARS = Array.from({ length: 55 }, (_, i) => {
  const a = (i * 137.508) % 360;
  const r = Math.sqrt((i + 1) / 55);
  return {
    x: Math.max(1, Math.min(99, 50 + r * 52 * Math.cos(a * Math.PI / 180))),
    y: Math.max(1, Math.min(99, 50 + r * 50 * Math.sin(a * Math.PI / 180))),
    sz: [0.8, 1, 1, 1.4][i % 4],
    dur: 2.8 + (i * 0.4) % 3,
    delay: (i * 0.55) % 5,
    col: i % 9 === 0 ? "#c4b5fd" : i % 7 === 0 ? "#a5f3fc" : "#ffffff",
  };
});

const METEORS = [
  { x: 78, y: 5,  w: 190, delay: 0,   dur: 3.4 },
  { x: 62, y: 12, w: 130, delay: 3.1, dur: 4.2 },
  { x: 88, y: 8,  w: 220, delay: 7.0, dur: 3.8 },
  { x: 70, y: 20, w: 85,  delay: 1.6, dur: 5.0 },
];

/* ─── Feature data ───────────────────────────────────── */

const FEATURES = [
  {
    title: "Live Auction Alerts",
    desc:  "Instant alerts when CS2 auctions drop below your target price. Snipe deals before anyone else.",
    rgb: "168,85,247",
    icon: (
      <svg width={22} height={22} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
    ),
  },
  {
    title: "Watchlist & Price Alerts",
    desc:  "Set price thresholds on specific skins. Get notified the moment market conditions match your rules.",
    rgb: "34,211,238",
    icon: (
      <svg width={22} height={22} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
      </svg>
    ),
  },
  {
    title: "Inventory Analytics",
    desc:  "Know your portfolio value. Float tracker, rarity breakdown, and profit/loss history for every item.",
    rgb: "251,191,36",
    icon: (
      <svg width={22} height={22} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    title: "Trade Matching",
    desc:  "Post your trade, get matched with the right buyer automatically. Real-time Socket.IO chat on every offer.",
    rgb: "74,222,128",
    icon: (
      <svg width={22} height={22} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
      </svg>
    ),
  },
  {
    title: "Chrome Extension",
    desc:  "One-click Steam inventory import. No passwords, no session cookies — your credentials stay in your browser.",
    rgb: "192,38,211",
    icon: (
      <svg width={22} height={22} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/>
        <line x1="21.17" y1="8" x2="12" y2="8"/><line x1="3.95" y1="6.06" x2="8.54" y2="14"/>
        <line x1="10.88" y1="21.94" x2="15.46" y2="14"/>
      </svg>
    ),
  },
  {
    title: "Steam Login",
    desc:  "Sign in with Steam OpenID. No separate account required. Your identity is verified directly by Valve.",
    rgb: "139,92,246",
    icon: (
      <svg width={22} height={22} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
      </svg>
    ),
  },
];

/* ─── FeatureCard ─────────────────────────────────────── */

function FeatureCard({ feature }) {
  return (
    <div
      style={{
        padding: "28px 26px", borderRadius: 16,
        background: "rgba(255,255,255,0.025)",
        border: `1px solid rgba(${feature.rgb},0.14)`,
        transition: "border-color .2s, background .2s, transform .2s",
        animation: "landingFade .6s ease both",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = `rgba(${feature.rgb},.32)`;
        e.currentTarget.style.background  = `rgba(${feature.rgb},.05)`;
        e.currentTarget.style.transform   = "translateY(-3px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = `rgba(${feature.rgb},.14)`;
        e.currentTarget.style.background  = "rgba(255,255,255,0.025)";
        e.currentTarget.style.transform   = "translateY(0)";
      }}
    >
      <div style={{
        width: 46, height: 46, borderRadius: 12, marginBottom: 18,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: `rgba(${feature.rgb},.1)`,
        border: `1px solid rgba(${feature.rgb},.2)`,
        color: `rgba(${feature.rgb},1)`,
      }}>
        {feature.icon}
      </div>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,.9)", margin: "0 0 8px", letterSpacing: "-.01em" }}>
        {feature.title}
      </h3>
      <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "rgba(255,255,255,.42)", margin: 0 }}>
        {feature.desc}
      </p>
    </div>
  );
}

/* ─── Landing ─────────────────────────────────────────── */

export default function Landing() {
  const nav = useNavigate();

  return (
    <div style={{ background: "#07080f", color: "#fff", minHeight: "100vh", fontFamily: "inherit", overflowX: "hidden" }}>
      <style>{CSS}</style>

      {/* ── Navbar ───────────────────────────────────────── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 clamp(20px, 5vw, 60px)",
        height: 60,
        background: "rgba(7,8,15,.82)", backdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(168,85,247,.10)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={skintelLogo} alt="SkinTel" style={{ height: 30, width: "auto", objectFit: "contain" }} />
          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-.02em", color: "#fff" }}>SkinTel</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => nav("/login")}
            style={{
              height: 34, padding: "0 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: "transparent", border: "1px solid rgba(255,255,255,.1)",
              color: "rgba(255,255,255,.62)", cursor: "pointer", fontFamily: "inherit",
              transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(168,85,247,.35)"; e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,.1)"; e.currentTarget.style.color = "rgba(255,255,255,.62)"; }}
          >
            Log In
          </button>
          <button
            onClick={() => nav("/signup")}
            style={{
              height: 34, padding: "0 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: "linear-gradient(135deg,#a855f7,#7c3aed)", border: "none",
              color: "#fff", cursor: "pointer", fontFamily: "inherit",
              boxShadow: "0 3px 14px rgba(109,40,217,.38)", transition: "filter .15s, transform .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.15)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)";    e.currentTarget.style.transform = "translateY(0)"; }}
          >
            Get Started Free
          </button>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────── */}
      <section style={{ position: "relative", overflow: "hidden", minHeight: 680, display: "flex", alignItems: "center" }}>

        {/* Background layers */}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 60% at 65% 38%, rgba(88,28,135,.30) 0%, transparent 65%), radial-gradient(ellipse 45% 40% at 22% 68%, rgba(29,78,216,.16) 0%, transparent 60%)", animation: "landingNebula 18s ease-in-out infinite" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(168,85,247,.012) 1px,transparent 1px),linear-gradient(90deg,rgba(168,85,247,.012) 1px,transparent 1px)", backgroundSize: "68px 68px" }} />

        {/* Stars */}
        {STARS.map((s, i) => (
          <div key={i} style={{ position: "absolute", left: `${s.x}%`, top: `${s.y}%`, width: s.sz, height: s.sz, borderRadius: "50%", background: s.col, animation: `landingStar ${s.dur}s ease-in-out ${s.delay}s infinite` }} />
        ))}

        {/* Meteors */}
        {METEORS.map((m, i) => (
          <div key={i} style={{ position: "absolute", left: `${m.x}%`, top: `${m.y}%`, width: m.w, height: 1.5, background: "linear-gradient(to right,transparent 0%,rgba(200,220,255,.55) 20%,rgba(255,255,255,.92) 60%,transparent 100%)", animation: `meteorFall ${m.dur}s linear ${m.delay}s infinite`, transformOrigin: "left center" }} />
        ))}

        {/* Logo watermark */}
        <img src={skintelLogo} alt="" aria-hidden style={{ position: "absolute", right: "4%", top: "50%", transform: "translateY(-50%)", width: "clamp(260px,36vw,520px)", opacity: .032, filter: "brightness(20) saturate(0) blur(1px)", pointerEvents: "none", animation: "landingFloat 8s ease-in-out infinite" }} />

        {/* Hero copy */}
        <div style={{ position: "relative", zIndex: 10, maxWidth: 1100, margin: "0 auto", padding: "80px clamp(24px,6vw,60px) 90px", animation: "landingFade .7s ease .1s both" }}>

          {/* Eyebrow */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 14px", borderRadius: 8, background: "rgba(109,40,217,.12)", border: "1px solid rgba(139,92,246,.28)", marginBottom: 26 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#a855f7", display: "inline-block", animation: "landingPulse 2s ease-in-out infinite" }} />
            <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".18em", color: "rgba(168,85,247,.95)" }}>CS2 Intelligence Platform</span>
          </div>

          {/* Headline */}
          <h1 style={{ fontSize: "clamp(36px,5.5vw,72px)", fontWeight: 800, lineHeight: 1.02, letterSpacing: "-.04em", margin: "0 0 20px", maxWidth: 720 }}>
            Intelligent CS2{" "}
            <span style={{ background: "linear-gradient(135deg,#c084fc 0%,#a855f7 40%,#7c3aed 65%,#38bdf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              Trading Platform
            </span>
          </h1>

          <p style={{ fontSize: 17, lineHeight: 1.7, color: "rgba(255,255,255,.46)", maxWidth: 500, margin: "0 0 36px" }}>
            Real-time auction alerts, inventory analytics, and trade matching — built for CS2 traders who want every edge.
          </p>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 36, marginBottom: 40, flexWrap: "wrap" }}>
            {[
              ["6s", "Alert refresh"],
              ["Live", "Auction feed"],
              ["Free", "No credit card"],
            ].map(([v, l]) => (
              <div key={l}>
                <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", background: "linear-gradient(135deg,#c084fc,#a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{v}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.32)", marginTop: 3 }}>{l}</div>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => nav("/signup")}
              style={{ padding: "13px 30px", borderRadius: 12, fontSize: 14, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg,#a855f7,#7c3aed)", border: "none", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 24px rgba(109,40,217,.42)", transition: "filter .15s,transform .15s,box-shadow .15s" }}
              onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.14)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 10px 36px rgba(109,40,217,.55)"; }}
              onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)";    e.currentTarget.style.transform = "translateY(0)";   e.currentTarget.style.boxShadow = "0 4px 24px rgba(109,40,217,.42)"; }}
            >
              Get Started Free →
            </button>
            <button
              onClick={() => nav("/login")}
              style={{ padding: "13px 24px", borderRadius: 12, fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,.6)", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", cursor: "pointer", transition: "all .15s", fontFamily: "inherit" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(109,40,217,.12)"; e.currentTarget.style.borderColor = "rgba(168,85,247,.32)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,.1)"; e.currentTarget.style.color = "rgba(255,255,255,.6)"; }}
            >
              Log In
            </button>
          </div>
        </div>

        {/* Bottom fade */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(to top,#07080f,transparent)", zIndex: 20 }} />
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section style={{ padding: "80px clamp(24px,6vw,60px)", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 52 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".18em", color: "rgba(168,85,247,.7)", marginBottom: 12 }}>
            What SkinTel does
          </div>
          <h2 style={{ fontSize: "clamp(26px,3.5vw,42px)", fontWeight: 800, letterSpacing: "-.03em", margin: "0 0 14px" }}>
            Every edge in one platform
          </h2>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,.38)", maxWidth: 480, margin: "0 auto", lineHeight: 1.7 }}>
            From live auction monitoring to portfolio analytics — everything a serious CS2 trader needs.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
          {FEATURES.map(f => <FeatureCard key={f.title} feature={f} />)}
        </div>
      </section>

      {/* ── Extension section ─────────────────────────────── */}
      <section style={{ padding: "80px clamp(24px,6vw,60px)", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 80% 60% at 50% 50%,rgba(88,28,135,.12) 0%,transparent 70%)" }} />
        <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative", zIndex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 48, alignItems: "center" }}>

            {/* Left: Extension info */}
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".18em", color: "rgba(192,38,211,.8)", marginBottom: 14 }}>
                Chrome Extension
              </div>
              <h2 style={{ fontSize: "clamp(22px,2.8vw,36px)", fontWeight: 800, letterSpacing: "-.03em", margin: "0 0 16px", lineHeight: 1.15 }}>
                Import your Steam inventory{" "}
                <span style={{ background: "linear-gradient(135deg,#c084fc,#a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                  in one click
                </span>
              </h2>
              <p style={{ fontSize: 14.5, lineHeight: 1.7, color: "rgba(255,255,255,.42)", margin: "0 0 28px" }}>
                The SkinTel Chrome extension reads your CS2 inventory directly from Steam — while you are logged in to Steam in your own browser. No passwords, no session cookies, no credentials ever leave your device.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  ["Zero credentials", "Your Steam login is never touched or transmitted"],
                  ["One-click import",  "Navigate to your Steam inventory page and click Import"],
                  ["Instant sync",      "Your items appear in SkinTel within seconds"],
                  ["Open source",       "Extension code is public and auditable on GitHub"],
                ].map(([title, desc]) => (
                  <div key={title} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(74,222,128,.12)", border: "1px solid rgba(74,222,128,.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                      <svg width={11} height={11} fill="none" viewBox="0 0 24 24" stroke="rgba(74,222,128,.9)" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,.82)" }}>{title} — </span>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,.38)" }}>{desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: How-it-works steps */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { step: "1", title: "Install the extension",   desc: "Add SKINTEL Inventory Importer from the Chrome Web Store." },
                { step: "2", title: "Log in to SkinTel",       desc: "Sign in with your email/password or Steam account." },
                { step: "3", title: "Open Steam inventory",    desc: "Navigate to your CS2 inventory on steamcommunity.com." },
                { step: "4", title: "Click Import",            desc: "The extension reads your items and sends them to SkinTel securely." },
              ].map(item => (
                <div key={item.step} style={{ display: "flex", gap: 16, padding: "18px 20px", borderRadius: 12, background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)", alignItems: "flex-start" }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#7c3aed,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
                    {item.step}
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "rgba(255,255,255,.85)", marginBottom: 4 }}>{item.title}</div>
                    <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.38)", lineHeight: 1.55 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Alerts & Trading section ───────────────────────── */}
      <section style={{ padding: "80px clamp(24px,6vw,60px)", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>

          {/* Alert card */}
          <div style={{ padding: "32px 28px", borderRadius: 20, background: "linear-gradient(145deg,rgba(109,40,217,.10),rgba(88,28,135,.06))", border: "1px solid rgba(168,85,247,.18)", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(ellipse,rgba(168,85,247,.12) 0%,transparent 70%)", filter: "blur(24px)" }} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(168,85,247,.12)", border: "1px solid rgba(168,85,247,.22)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, color: "#c084fc" }}>
                <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,.92)", margin: "0 0 10px", letterSpacing: "-.02em" }}>Real-time Alerts</h3>
              <p style={{ fontSize: 13.5, color: "rgba(255,255,255,.42)", lineHeight: 1.65, margin: 0 }}>
                Auction and watchlist alerts stream to you live over Socket.IO. No page refresh needed — deals appear the second they hit the market.
              </p>
            </div>
          </div>

          {/* Trade card */}
          <div style={{ padding: "32px 28px", borderRadius: 20, background: "linear-gradient(145deg,rgba(34,211,238,.07),rgba(29,78,216,.06))", border: "1px solid rgba(34,211,238,.15)", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(ellipse,rgba(34,211,238,.10) 0%,transparent 70%)", filter: "blur(24px)" }} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(34,211,238,.08)", border: "1px solid rgba(34,211,238,.18)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, color: "#22d3ee" }}>
                <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,.92)", margin: "0 0 10px", letterSpacing: "-.02em" }}>Smart Trade Matching</h3>
              <p style={{ fontSize: 13.5, color: "rgba(255,255,255,.42)", lineHeight: 1.65, margin: 0 }}>
                Post your wanted or offered items. SkinTel automatically detects mutual matches and notifies both traders in real time.
              </p>
            </div>
          </div>

          {/* Inventory card */}
          <div style={{ padding: "32px 28px", borderRadius: 20, background: "linear-gradient(145deg,rgba(251,191,36,.07),rgba(245,158,11,.04))", border: "1px solid rgba(251,191,36,.14)", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(ellipse,rgba(251,191,36,.09) 0%,transparent 70%)", filter: "blur(24px)" }} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.18)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, color: "#fbbf24" }}>
                <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,.92)", margin: "0 0 10px", letterSpacing: "-.02em" }}>Inventory Analytics</h3>
              <p style={{ fontSize: 13.5, color: "rgba(255,255,255,.42)", lineHeight: 1.65, margin: 0 }}>
                Live portfolio valuation, float tracking per item, rarity and wear breakdown — see your entire CS2 collection at a glance.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────── */}
      <section style={{ padding: "80px clamp(24px,6vw,60px)", textAlign: "center", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 80% at 50% 50%,rgba(88,28,135,.16) 0%,transparent 65%)" }} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 560, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(26px,3.5vw,44px)", fontWeight: 800, letterSpacing: "-.03em", margin: "0 0 14px" }}>
            Start trading smarter today
          </h2>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,.38)", lineHeight: 1.7, margin: "0 0 32px" }}>
            Free account. No credit card required. Start finding CS2 deals in under 60 seconds.
          </p>
          <button
            onClick={() => nav("/signup")}
            style={{ padding: "14px 38px", borderRadius: 12, fontSize: 15, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg,#a855f7,#7c3aed)", border: "none", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 28px rgba(109,40,217,.45)", transition: "filter .15s,transform .15s,box-shadow .15s" }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.15)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 12px 40px rgba(109,40,217,.60)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)";    e.currentTarget.style.transform = "translateY(0)";   e.currentTarget.style.boxShadow = "0 4px 28px rgba(109,40,217,.45)"; }}
          >
            Create Free Account →
          </button>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,.07)", padding: "32px clamp(24px,6vw,60px)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src={skintelLogo} alt="SkinTel" style={{ height: 22, objectFit: "contain" }} />
            <span style={{ fontSize: 13, color: "rgba(255,255,255,.28)" }}>© {new Date().getFullYear()} SkinTel. All rights reserved.</span>
          </div>
          <nav style={{ display: "flex", gap: 24 }}>
            {[
              { label: "Privacy Policy", to: "/privacy"  },
              { label: "Terms",          to: "/terms"    },
              { label: "Contact",        href: "mailto:akivaidan1998@gmail.com" },
            ].map(link => (
              link.href ? (
                <a key={link.label} href={link.href} style={{ fontSize: 13, color: "rgba(255,255,255,.38)", textDecoration: "none", transition: "color .15s" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,.8)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,.38)"; }}>
                  {link.label}
                </a>
              ) : (
                <Link key={link.label} to={link.to} style={{ fontSize: 13, color: "rgba(255,255,255,.38)", textDecoration: "none", transition: "color .15s" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,.8)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,.38)"; }}>
                  {link.label}
                </Link>
              )
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
