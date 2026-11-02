// Insider Tracker — app shell for /insider/*: top navigation, live SEC status
// bar, account drawer and the Overview · Transactions · Companies · Analytics
// views. Data: GET /api/insider/transactions (parsed from SEC EDGAR).
// The feed/badge logic that used to live here moved, unchanged in behaviour, to
// hooks/useInsiderFeed.js and components/Badges.jsx.
import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { InsiderProvider, useInsider } from "./InsiderContext";
import StatusBar from "./components/StatusBar";
import AccountDrawer from "./components/AccountDrawer";
import { OverviewView, TransactionsView, CompaniesView, AnalyticsView } from "./views/Views";
import CompanyView from "./views/CompanyView";
import useAuth from "../../hooks/useAuth";
import "./insider.css";

const TABS = [
  { to: "/insider", label: "Overview", end: true },
  { to: "/insider/transactions", label: "Transactions" },
  { to: "/insider/companies", label: "Companies" },
  { to: "/insider/analytics", label: "Analytics" },
];

function TickerJump() {
  const [v, setV] = useState("");
  const navigate = useNavigate();
  const go = (e) => {
    e.preventDefault();
    const t = v.trim().toUpperCase();
    if (/^[A-Z0-9.-]{1,10}$/.test(t)) { navigate(`/insider/company/${encodeURIComponent(t)}`); setV(""); }
  };
  return (
    <form onSubmit={go} role="search" className="hidden md:block">
      <input value={v} onChange={(e) => setV(e.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10))}
        placeholder="Go to ticker…" aria-label="Open company by ticker" className="it-input it-mono w-40" spellCheck={false} />
    </form>
  );
}

function AccountButton() {
  const { account, setAccountOpen } = useInsider();
  const { isAuthed } = useAuth();
  const label = isAuthed ? (account.user?.username || "Account") : "Sign in";
  return (
    <button className="it-btn relative" onClick={() => setAccountOpen(true)} aria-haspopup="dialog"
      aria-label={`${label}${account.unread ? `, ${account.unread} unread alerts` : ""}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {isAuthed ? <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>
          : <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>}
      </svg>
      <span className="hidden max-w-[120px] truncate sm:inline">{label}</span>
      {account.unread > 0 && (
        <span className="it-num absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-semibold leading-[18px] text-white" style={{ background: "var(--it-accent)" }}>
          {account.unread > 99 ? "99+" : account.unread}
        </span>
      )}
    </button>
  );
}

function TopNav() {
  return (
    <header className="it-nav">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 sm:px-6">
        <NavLink to="/insider" className="flex shrink-0 items-center gap-2 py-2" aria-label="Insider Tracker home">
          <span className="grid h-6 w-6 place-items-center rounded" style={{ background: "var(--it-accent-soft)", boxShadow: "inset 0 0 0 1px rgba(59,158,255,0.35)" }} aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b9eff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
          </span>
          <span className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--it-text)" }}>Insider<span className="it-dim2 font-medium">Tracker</span></span>
        </NavLink>
        <nav className="it-scroll-x hidden min-w-0 flex-1 items-center md:flex" aria-label="Sections">
          {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `it-tab${isActive ? " active" : ""}`}>{t.label}</NavLink>)}
        </nav>
        <div className="ml-auto flex items-center gap-2 py-2 md:ml-0">
          <TickerJump />
          <AccountButton />
        </div>
      </div>
      {/* Mobile: scrollable section tabs */}
      <nav className="it-scroll-x flex px-2 md:hidden" style={{ borderTop: "1px solid var(--it-line-soft)" }} aria-label="Sections">
        {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `it-tab${isActive ? " active" : ""}`}>{t.label}</NavLink>)}
      </nav>
    </header>
  );
}

function CompanyRoute() {
  const { ticker = "" } = useParams();
  return <CompanyView key={ticker} />;
}

export default function InsiderDashboard() {
  return (
    <InsiderProvider>
      <div className="it-root">
        <TopNav />
        <StatusBar />
        <main className="mx-auto max-w-[1600px] px-3 py-3 sm:px-6 sm:py-4">
          <Routes>
            <Route index element={<OverviewView />} />
            <Route path="transactions" element={<TransactionsView />} />
            <Route path="companies" element={<CompaniesView />} />
            <Route path="company/:ticker" element={<CompanyRoute />} />
            <Route path="analytics" element={<AnalyticsView />} />
            <Route path="*" element={<Navigate to="/insider" replace />} />
          </Routes>
          <footer className="pt-4 pb-2 text-[11px] leading-relaxed it-dim2">
            Source: U.S. Securities and Exchange Commission, EDGAR. Only non-derivative transaction codes P (open-market or private purchase) and S (open-market or private sale) are shown.
          </footer>
        </main>
        <AccountDrawer />
      </div>
    </InsiderProvider>
  );
}
