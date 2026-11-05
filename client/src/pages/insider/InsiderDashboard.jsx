// Insider Tracker — app shell for /insider/*: top navigation, live SEC status
// bar, account drawer and the Overview · Transactions · Companies · Analytics
// views. Data: GET /api/insider/transactions (parsed from SEC EDGAR).
// The feed/badge logic that used to live here moved, unchanged in behaviour, to
// hooks/useInsiderFeed.js and components/Badges.jsx.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { InsiderProvider, useInsider } from "./InsiderContext";
import StatusBar from "./components/StatusBar";
import AccountDrawer from "./components/AccountDrawer";
import ErrorBoundary from "./components/ErrorBoundary";
import { Skeleton } from "./components/Common";
import { OverviewView, TransactionsView, CompaniesView, AnalyticsView } from "./views/Views";
import useAuth from "../../hooks/useAuth";
import { useTheme } from "./theme";
import "./insider.css";

// Route-level code splitting: Overview / Transactions / Companies stay in the
// main chunk; the heavier, less-visited pages load on demand.
// Company page: preloaded on idle (see usePreloadCompanyView). Once the module is
// in memory, lazy() gets a synchronously resolving thenable, so navigating to a
// company never flashes the Suspense fallback (React 18 lazy resolves in place).
let companyModule = null;
const loadCompanyView = () => import("./views/CompanyView").then((m) => { companyModule = m; return m; });
const CompanyView = lazy(() => (companyModule ? { then: (resolve) => resolve(companyModule) } : loadCompanyView()));
const BacktestPage = lazy(() => import("./backtest/BacktestPage"));
const OwnerProfilePage = lazy(() => import("./owner/OwnerProfilePage"));
const SignInPage = lazy(() => import("./auth/SignInPage"));

const TABS = [
  { to: "/insider", label: "Overview", end: true },
  { to: "/insider/transactions", label: "Transactions" },
  { to: "/insider/companies", label: "Companies" },
  { to: "/insider/analytics", label: "Analytics" },
  { to: "/insider/backtesting", label: "Backtesting" },
];

function TickerJump() {
  const [v, setV] = useState("");
  const navigate = useNavigate();
  const input = useRef(null);
  // "/" focuses the ticker search (ignored while typing in another field).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const go = (e) => {
    e.preventDefault();
    const t = v.trim().toUpperCase();
    if (/^[A-Z0-9.-]{1,10}$/.test(t)) { navigate(`/insider/company/${encodeURIComponent(t)}`); setV(""); }
  };
  return (
    <form onSubmit={go} role="search" className="it-search hidden md:block">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input ref={input} value={v} onChange={(e) => setV(e.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10))}
        placeholder="Search ticker" aria-label="Open company by ticker (press / to focus)" className="it-input w-44 lg:w-52" spellCheck={false} />
      {!v && <span className="it-kbd" aria-hidden="true">/</span>}
    </form>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";
  return (
    <button type="button" className="it-btn it-icon-btn" onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"} aria-pressed={dark}>
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
      )}
    </button>
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
        <span className="it-num absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-semibold leading-[18px]" style={{ background: "var(--it-accent)", color: "var(--it-on-accent)" }}>
          {account.unread > 99 ? "99+" : account.unread}
        </span>
      )}
    </button>
  );
}

function TopNav() {
  return (
    <header className="it-nav">
      <div className="mx-auto flex h-[60px] max-w-[1440px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <NavLink to="/insider" className="flex shrink-0 items-center gap-2.5" aria-label="InsiderTracker home">
          <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "var(--it-accent)", color: "var(--it-on-accent)", boxShadow: "var(--it-shadow-sm)" }} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
          </span>
          <span className="text-[16px] font-semibold tracking-tight" style={{ color: "var(--it-text)" }}>Insider<span style={{ color: "var(--it-accent)" }}>Tracker</span></span>
        </NavLink>
        <nav className="it-scroll-x hidden min-w-0 flex-1 items-center lg:flex" aria-label="Sections">
          {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `it-tab${isActive ? " active" : ""}`}>{t.label}</NavLink>)}
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <TickerJump />
          <ThemeToggle />
          <AccountButton />
        </div>
      </div>
      {/* Phone + tablet (<1024px): scrollable section tabs — the inline desktop nav would clip at 768–1023px */}
      <nav className="it-scroll-x it-nav-mobile flex gap-1 px-3 py-1.5 lg:hidden" style={{ borderTop: "1px solid var(--it-line-soft)" }} aria-label="Sections">
        {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `it-tab${isActive ? " active" : ""}`}>{t.label}</NavLink>)}
      </nav>
    </header>
  );
}

function CompanyRoute() {
  const { ticker = "" } = useParams();
  return <CompanyView key={ticker} />;
}

function OwnerRoute() {
  const { cik = "" } = useParams();
  return <OwnerProfilePage key={cik} />;
}

// Suspense fallback for lazily loaded pages: a quiet skeleton in the page's own
// layout (title, lede, panel) instead of a full-screen spinner.
function RouteFallback() {
  return (
    <div className="flex min-h-[100vh] flex-col gap-5" aria-busy="true" aria-label="Loading page">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="it-panel flex flex-col gap-3 p-4">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}
      </div>
    </div>
  );
}

// Warm the company page chunk once the browser is idle so Companies → company stays instant.
function usePreloadCompanyView() {
  useEffect(() => {
    const preload = () => { loadCompanyView().catch(() => { /* retried on navigation */ }); };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(preload, 2000);
    return () => clearTimeout(t);
  }, []);
}

function InsiderRoutes() {
  const { pathname } = useLocation();
  usePreloadCompanyView();
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route index element={<OverviewView />} />
          <Route path="transactions" element={<TransactionsView />} />
          <Route path="companies" element={<CompaniesView />} />
          <Route path="company/:ticker" element={<CompanyRoute />} />
          <Route path="analytics" element={<AnalyticsView />} />
          <Route path="backtesting" element={<BacktestPage />} />
          <Route path="owner/:cik" element={<OwnerRoute />} />
          <Route path="sign-in" element={<SignInPage />} />
          <Route path="*" element={<Navigate to="/insider" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function InsiderDashboard() {
  return (
    <InsiderProvider>
      <div className="it-root">
        <TopNav />
        <StatusBar />
        <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <InsiderRoutes />
          <footer className="mt-6 border-t pt-5 pb-4 text-[12px] leading-relaxed it-dim2" style={{ borderColor: "var(--it-line)" }}>
            Source: U.S. Securities and Exchange Commission, EDGAR. Only non-derivative transaction codes P (open-market or private purchase) and S (open-market or private sale) are shown.
          </footer>
        </main>
        <AccountDrawer />
      </div>
    </InsiderProvider>
  );
}
