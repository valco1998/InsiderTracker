import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import useAuth from "../../hooks/useAuth";
import api from "../../lib/api";
import logo from "../../assets/skintel.logo.png";
import steamLogoImg from "../../assets/Steam_icon_logo.png";
import { useChatPanel } from "../../context/ChatPanelContext";
import { useChatContext } from "../../context/ChatContext";
import TradeNotificationBell from "../../components/TradeNotificationBell";
import { STEAM_LOGIN_URL } from "../../lib/config";
import useTradeUnreadCount from "../../hooks/useTradeUnreadCount";

function useTotalChatUnread() {
  try {
    const { unreadByRoom } = useChatContext() ?? {};
    if (!unreadByRoom) return 0;
    return Object.values(unreadByRoom).reduce((a, b) => a + (b || 0), 0);
  } catch { return 0; }
}

/* ─── Unread count badge — premium, no pink ──────────────
   A flat, minimal count tag. Amber for alerts, slate for chat.
   No glow, no rounded pill, no harsh color.
──────────────────────────────────────────────────────── */
function CountBadge({ count, variant = "amber" }) {
  if (!count || count < 1) return null;
  const n = count > 99 ? "99+" : String(count);
  const isAmber = variant === "amber";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "0.02em",
        lineHeight: 1,
        background: isAmber ? "rgba(251,191,36,0.14)" : "rgba(148,163,184,0.14)",
        border: isAmber
          ? "1px solid rgba(251,191,36,0.28)"
          : "1px solid rgba(148,163,184,0.22)",
        color: isAmber ? "#fbbf24" : "rgba(148,163,184,0.9)",
      }}
    >
      {n}
    </span>
  );
}

/* ─── Nav items ─────────────────────────────────────── */

const NAV_ITEMS = [
  { to: "/", label: "Home" },
  { to: "/market", label: "Market" },
  { to: "/auctions", label: "Auctions" },
  { to: "/watchlist", label: "Watchlist" },
  { to: "/alerts", label: "Alerts", badge: "alerts" },
];


function NavItem({ to, label, badge, alertCount }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative flex items-center gap-2 px-4 py-2 text-[13px] font-medium transition-all duration-200 ${
          isActive
            ? "text-white/95"
            : "text-white/42 hover:text-white/85 hover:bg-violet-500/[0.07]"
        }`
      }
      style={({ isActive }) => ({
        borderRadius: 10,
        background: isActive ? "rgba(168,85,247,0.12)" : "transparent",
        boxShadow: isActive ? "inset 0 0 0 1px rgba(168,85,247,0.28), 0 0 18px rgba(168,85,247,0.14)" : "none",
      })}
    >
      {label}
      {badge === "alerts" && alertCount > 0 && (
        <CountBadge count={alertCount} variant="amber" />
      )}
    </NavLink>
  );
}

/* ─── Icon button ───────────────────────────────────── */
function IconBtn({ onClick, title, active, children, style: extraStyle }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: "relative",
        width: 36,
        height: 36,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active
          ? "rgba(168,85,247,0.16)"
          : hov
          ? "rgba(168,85,247,0.10)"
          : "rgba(255,255,255,0.04)",
        border: active
          ? "1px solid rgba(168,85,247,0.38)"
          : hov
          ? "1px solid rgba(168,85,247,0.26)"
          : "1px solid rgba(255,255,255,0.08)",
        boxShadow: active || hov ? "0 0 14px rgba(168,85,247,0.18)" : "none",
        transition: "all 0.15s ease",
        cursor: "pointer",
        flexShrink: 0,
        ...extraStyle,
      }}
    >
      {children}
    </button>
  );
}

/* ─── Trade nav item with unread badge ─────────────── */

function TradeNavItem({ unread }) {
  return (
    <NavLink
      to="/trade"
      className={({ isActive }) =>
        `relative flex items-center gap-2 px-4 py-2 text-[13px] font-medium transition-all duration-200 ${
          isActive ? "text-white/95" : "text-white/42 hover:text-white/85 hover:bg-violet-500/[0.07]"
        }`
      }
      style={({ isActive }) => ({
        borderRadius: 10,
        background: isActive ? "rgba(168,85,247,0.12)" : "transparent",
        boxShadow: isActive ? "inset 0 0 0 1px rgba(168,85,247,0.28), 0 0 18px rgba(168,85,247,0.14)" : "none",
      })}
    >
      Trade
      {unread > 0 && (
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          minWidth: 16, height: 16, padding: "0 4px", borderRadius: 4,
          fontSize: 10, fontWeight: 700, lineHeight: 1,
          background: "rgba(139,92,246,0.18)",
          border: "1px solid rgba(139,92,246,0.32)",
          color: "rgba(167,139,250,1)",
          fontVariantNumeric: "tabular-nums",
        }}>
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </NavLink>
  );
}

/* ─── Main component ────────────────────────────────── */

export default function Navbar() {
  const { isAuthed, logout, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { open: chatOpen, toggle: toggleChat } = useChatPanel();
  const chatUnread = useTotalChatUnread();
  const [alertUnread, setAlertUnread] = useState(0);
  const tradeUnread = useTradeUnreadCount(isAuthed);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Auto-close mobile menu on navigation
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Alerts badge: real-time delivery is via the `price_alert` Socket.IO event
  // (see effect below) — this REST poll is only a periodic resync/correction
  // net, so it can run far less often, skip entirely while the tab is
  // hidden, and always fire once immediately when the tab regains focus.
  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    let inFlight = false;

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await api.get("/alerts");
        if (cancelled) return;
        const list = Array.isArray(res.data?.alerts) ? res.data.alerts : [];
        setAlertUnread(list.filter(a => !a.isRead).length);
      } catch { } finally { inFlight = false; }
    };

    load();

    const ALERTS_RESYNC_MS = 45_000;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, ALERTS_RESYNC_MS);

    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isAuthed]);

  // Optimistic instant badge bump on real-time alert delivery — keeps the
  // badge accurate immediately instead of waiting for the next resync poll.
  useEffect(() => {
    if (!isAuthed) return;
    const handler = () => setAlertUnread(n => n + 1);
    window.addEventListener("price_alert", handler);
    return () => window.removeEventListener("price_alert", handler);
  }, [isAuthed]);

  const avatarSrc = !avatarFailed && user?.avatarUrl
    ? user.avatarUrl
    : `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(user?.username || "guest")}`;

  const mobileNavItems = [
    { to: "/", label: "Home" },
    { to: "/market", label: "Market" },
    { to: "/auctions", label: "Auctions" },
    { to: "/watchlist", label: "Watchlist" },
    { to: "/alerts", label: "Alerts" },
    ...(isAuthed ? [
      { to: "/chat", label: "Chat" },
      { to: "/inventory", label: "Inventory" },
      { to: "/trade", label: "Trade" },
    ] : []),
  ];

  return (
    <>
    <header
      className="sticky top-0 z-50 flex-shrink-0"
      style={{
        background: "rgba(8,6,16,0.78)",
        borderBottom: "1px solid rgba(168,85,247,0.14)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}
    >
      {/* Top edge highlight */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, transparent 5%, rgba(168,85,247,0.45) 35%, rgba(232,121,249,0.35) 65%, transparent 95%)",
        }}
      />

      <div
        className="flex items-center justify-between gap-4"
        style={{
          height: 64,
          maxWidth: 1800,
          margin: "0 auto",
          padding: "0 24px",
        }}
      >

        {/* ── Left: chat + logo ── */}
        <div className="flex items-center gap-3 flex-shrink-0">

          {/* Chat panel toggle */}
          {isAuthed && (
            <div style={{ position: "relative" }}>
              <IconBtn
                onClick={toggleChat}
                title="Toggle chat"
                active={chatOpen}
              >
                <svg
                  width={17}
                  height={17}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  style={{ color: chatOpen ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)" }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </IconBtn>
              {/* Chat unread: slate-toned badge, no glow */}
              {chatUnread > 0 && !chatOpen && (
                <span
                  style={{
                    position: "absolute",
                    top: -5,
                    right: -5,
                    minWidth: 16,
                    height: 16,
                    padding: "0 3px",
                    borderRadius: 4,
                    fontSize: 9,
                    fontWeight: 700,
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontVariantNumeric: "tabular-nums",
                    background: "rgba(100,116,139,0.9)",
                    border: "1px solid rgba(148,163,184,0.3)",
                    color: "rgba(255,255,255,0.9)",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                  }}
                >
                  {chatUnread > 99 ? "99+" : chatUnread}
                </span>
              )}
            </div>
          )}

          {/* Logo + brand */}
          <NavLink to="/" className="flex items-center gap-3" style={{ textDecoration: "none" }}>
            <img
              src={logo}
              alt="Skintel"
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                objectFit: "cover",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 4px 12px rgba(0,0,0,0.4)",
              }}
            />
            <div className="hidden sm:block">
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.1,
                  color: "#fff",
                }}
              >
                SKIN<span className="text-gradient">TEL</span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.30)",
                  lineHeight: 1,
                  marginTop: 1,
                }}
              >
                CS2 Intelligence
              </div>
            </div>
          </NavLink>
        </div>

        {/* ── Center: nav ── */}
        {/* xl, not lg: with the chat dock (48px) the 8 links + right cluster
            overflow the row below ~1280px and get clipped by body overflow-x:hidden */}
        <nav className="hidden xl:flex items-center" style={{ gap: 2 }}>
          {NAV_ITEMS.map(item => (
            <NavItem
              key={item.to}
              {...item}
              alertCount={item.badge === "alerts" ? alertUnread : 0}
            />
          ))}
          {isAuthed && (
            <>
              <NavItem to="/chat" label="Chat" />
              <NavItem to="/inventory" label="Inventory" />
              <TradeNavItem unread={tradeUnread} />
            </>
          )}
        </nav>

        {/* ── Right: search + actions ── */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">

          {/* Search */}
          <SearchBar />

          {/* Hamburger — mobile only, always visible */}
          <button
            className="flex xl:hidden items-center justify-center flex-shrink-0"
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Toggle navigation menu"
            style={{
              width: 36, height: 36, borderRadius: 10, cursor: "pointer",
              background: menuOpen ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)",
              border: menuOpen ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(255,255,255,0.08)",
              transition: "all 0.15s",
            }}
          >
            {menuOpen ? (
              <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.7)" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.55)" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>

          {isAuthed ? (
            <>
              {/* Trade notification bell */}
              <TradeNotificationBell />

              {/* Bell / Alerts */}
              <div style={{ position: "relative" }}>
                <IconBtn
                  onClick={() => navigate("/alerts")}
                  title="Alerts"
                  style={
                    alertUnread > 0
                      ? {
                          background: "rgba(251,191,36,0.07)",
                          border: "1px solid rgba(251,191,36,0.16)",
                        }
                      : {}
                  }
                >
                  <svg
                    width={17}
                    height={17}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    style={{
                      color: alertUnread > 0 ? "rgba(251,191,36,0.8)" : "rgba(255,255,255,0.4)",
                    }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </IconBtn>
                {alertUnread > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -5,
                      right: -5,
                      minWidth: 16,
                      height: 16,
                      padding: "0 3px",
                      borderRadius: 4,
                      fontSize: 9,
                      fontWeight: 700,
                      lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontVariantNumeric: "tabular-nums",
                      background: "rgba(251,191,36,0.9)",
                      border: "1px solid rgba(251,191,36,0.4)",
                      color: "#000",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                    }}
                  >
                    {alertUnread > 99 ? "99+" : alertUnread}
                  </span>
                )}
              </div>

              {/* Divider */}
              <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.07)", margin: "0 2px" }} />

              {/* User */}
              <UserChip
                avatarSrc={avatarSrc}
                username={user?.username}
                onAvatarError={() => setAvatarFailed(true)}
              />

              {/* Sign out */}
              <SignOutButton onClick={() => { logout(); navigate("/login", { state: { signedOut: true } }); }} />
            </>
          ) : (
            <AuthButtons />
          )}
        </div>
      </div>
    </header>

    {/* ── Mobile nav drawer ── */}
    {menuOpen && (
      <nav
        className="mobile-nav-overlay xl:hidden fixed inset-x-0 z-[49] overflow-y-auto"
        style={{
          top: 64,
          maxHeight: "calc(100dvh - 64px)",
          background: "rgba(12,16,26,0.98)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div style={{ padding: "10px 14px 24px", display: "flex", flexDirection: "column", gap: 2 }}>
          {mobileNavItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center px-4 py-3 rounded-xl text-[15px] font-medium transition-all duration-150 ${
                  isActive ? "text-white/95" : "text-white/52 active:text-white/80"
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? "rgba(255,255,255,0.065)" : "transparent",
              })}
            >
              {label}
            </NavLink>
          ))}

          <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "6px 4px" }} />

          {isAuthed ? (
            <button
              onClick={() => { logout(); navigate("/login", { state: { signedOut: true } }); setMenuOpen(false); }}
              style={{
                display: "flex", alignItems: "center", padding: "12px 16px",
                borderRadius: 12, fontSize: 15, fontWeight: 500,
                color: "rgba(255,255,255,0.38)", background: "transparent",
                border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              }}
            >
              Sign out
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
              <NavLink
                to="/login"
                onClick={() => setMenuOpen(false)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "13px 0", borderRadius: 12,
                  fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.60)",
                  border: "1px solid rgba(255,255,255,0.09)", textDecoration: "none",
                }}
              >
                Log in
              </NavLink>
              <NavLink
                to="/signup"
                onClick={() => setMenuOpen(false)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "13px 0", borderRadius: 12,
                  fontSize: 14, fontWeight: 700, color: "#fff", textDecoration: "none",
                  background: "linear-gradient(135deg, #22d3ee, #a855f7)",
                }}
              >
                Get started
              </NavLink>
            </div>
          )}
        </div>
      </nav>
    )}
    </>
  );
}

/* ─── Sub-components ────────────────────────────────── */

function SearchBar() {
  const [focused, setFocused] = useState(false);
  return (
    <div
      className="hidden 2xl:flex items-center gap-2"
      style={{
        width: 196,
        height: 34,
        padding: "0 12px",
        borderRadius: 9,
        background: focused ? "rgba(168,85,247,0.09)" : "rgba(255,255,255,0.04)",
        border: focused
          ? "1px solid rgba(168,85,247,0.38)"
          : "1px solid rgba(255,255,255,0.08)",
        boxShadow: focused ? "0 0 16px rgba(168,85,247,0.16)" : "none",
        transition: "all 0.15s ease",
      }}
    >
      <svg
        width={13}
        height={13}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }}
      >
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        placeholder="Search skins…"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize: 12.5,
          fontWeight: 400,
          color: "rgba(255,255,255,0.82)",
          fontFamily: "inherit",
          minWidth: 0,
        }}
      />
    </div>
  );
}

function UserChip({ avatarSrc, username, onAvatarError }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      className="hidden md:flex items-center gap-2"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: 34,
        padding: "0 10px 0 6px",
        borderRadius: 10,
        background: hov ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        cursor: "default",
        transition: "background 0.15s ease",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      <img
        src={avatarSrc}
        alt="avatar"
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          objectFit: "cover",
          border: "1px solid rgba(255,255,255,0.12)",
          flexShrink: 0,
        }}
        onError={onAvatarError}
      />
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          color: "rgba(255,255,255,0.75)",
          maxWidth: 88,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          lineHeight: 1,
        }}
      >
        {username || "User"}
      </span>
    </div>
  );
}

function SignOutButton({ onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title="Sign out"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        height: 34,
        padding: "0 10px",
        borderRadius: 9,
        background: hov ? "rgba(239,68,68,0.1)" : "transparent",
        border: hov ? "1px solid rgba(239,68,68,0.2)" : "1px solid rgba(255,255,255,0.08)",
        color: hov ? "#f87171" : "rgba(255,255,255,0.32)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 0.15s ease",
        flexShrink: 0,
        fontFamily: "inherit",
      }}
    >
      <svg width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
      <span className="hidden sm:block">Sign out</span>
    </button>
  );
}

function AuthButtons() {
  return (
    <div className="flex items-center gap-2">
      {/* Steam login */}
      <a
        href={STEAM_LOGIN_URL}
        title="Login with Steam"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          height: 34,
          padding: "0 12px",
          borderRadius: 9,
          fontSize: 12,
          fontWeight: 600,
          color: "rgba(255,255,255,0.55)",
          background: "rgba(23,26,33,0.6)",
          border: "1px solid rgba(102,192,244,0.14)",
          textDecoration: "none",
          transition: "all 0.18s ease",
          flexShrink: 0,
          boxShadow: "0 0 0 0 transparent",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = "rgba(255,255,255,0.92)";
          e.currentTarget.style.background = "rgba(23,26,33,0.9)";
          e.currentTarget.style.borderColor = "rgba(102,192,244,0.32)";
          e.currentTarget.style.boxShadow = "0 0 12px rgba(102,192,244,0.14), 0 2px 6px rgba(0,0,0,0.3)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = "rgba(255,255,255,0.55)";
          e.currentTarget.style.background = "rgba(23,26,33,0.6)";
          e.currentTarget.style.borderColor = "rgba(102,192,244,0.14)";
          e.currentTarget.style.boxShadow = "0 0 0 0 transparent";
        }}
      >
        <SteamNavIcon />
        <span className="hidden sm:block">Steam</span>
      </a>

      <NavLink
        to="/login"
        style={{
          display: "flex",
          alignItems: "center",
          height: 34,
          padding: "0 14px",
          borderRadius: 9,
          fontSize: 13,
          fontWeight: 500,
          color: "rgba(255,255,255,0.55)",
          border: "1px solid rgba(255,255,255,0.09)",
          textDecoration: "none",
          transition: "all 0.15s ease",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = "rgba(255,255,255,0.88)";
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = "rgba(255,255,255,0.55)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        Log in
      </NavLink>
      <NavLink
        to="/signup"
        style={{
          display: "flex",
          alignItems: "center",
          height: 34,
          padding: "0 16px",
          borderRadius: 9,
          fontSize: 13,
          fontWeight: 700,
          color: "#fff",
          background: "linear-gradient(135deg, #22d3ee, #a855f7)",
          boxShadow: "0 0 16px rgba(34,211,238,0.14), 0 2px 6px rgba(0,0,0,0.3)",
          textDecoration: "none",
          transition: "filter 0.15s ease",
        }}
        onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.1)"; }}
        onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)"; }}
      >
        Get started
      </NavLink>
    </div>
  );
}

function SteamNavIcon() {
  return (
    <img
      src={steamLogoImg}
      alt="Steam"
      style={{ width: 15, height: 15, objectFit: "contain", flexShrink: 0 }}
    />
  );
}
