import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import RealtimeAlertPopup from "./pages/Popup/RealtimeAlertPopup.jsx";
import TradeMatchToast from "./components/TradeMatchToast.jsx";
import ErrorBoundary from "./pages/insider/components/ErrorBoundary.jsx";
import { currentTheme, fallbackPalette, isInsiderPath } from "./utils/insiderUiFallback.js";

// Heavy pages — code-split so the initial bundle only contains the shell.
// Each page chunk is downloaded on first navigation, not on first load.
// InsiderTracker routes only. The legacy SkinTel pages (landing, home, market, chat,
// trade, auctions, Steam inventory, CS2 alerts, notification dashboard) are no longer
// routed: their APIs (/items, /chat, /trades, /auctions, /steam, /alerts/stats,
// /notifications/metrics) do not exist on the InsiderTracker server (insider-mvp.js),
// so every one of those pages could only fail. Their files are left in place.
const Privacy = lazy(() => import("./pages/Privacy.jsx"));
const InsiderDashboard      = lazy(() => import("./pages/insider/InsiderDashboard.jsx"));

function PageFallback({ insider }) {
  // InsiderTracker pages are light by default: never paint the legacy dark
  // purple screen there. Theme comes from <html data-theme> (set pre-paint).
  if (insider) {
    const p = fallbackPalette(currentTheme());
    return (
      <div aria-busy="true" style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: p.bg,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          border: `2px solid ${p.accentLine}`,
          borderTopColor: p.accent,
          animation: "spin 0.7s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#07080f",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        border: "2px solid rgba(168,85,247,0.15)",
        borderTopColor: "#a855f7",
        animation: "spin 0.7s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const isInsider = pathname.startsWith("/insider");
  return (
    <>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#1a1625",
            color: "#e2e8f0",
            border: "1px solid rgba(168,85,247,0.20)",
            fontSize: 13,
            fontFamily: "inherit",
          },
          success: { iconTheme: { primary: "#4ade80", secondary: "#1a1625" } },
          error:   { iconTheme: { primary: "#f87171", secondary: "#1a1625" } },
          duration: 5000,
        }}
      />
      {/* Legacy CS2 popups listen to window "price_alert" — which the foreground
          FCM handler also dispatches for insider alerts. Keep them off /insider. */}
      {!isInsider && <RealtimeAlertPopup />}
      {!isInsider && <TradeMatchToast />}

      <Suspense fallback={<PageFallback insider={isInsiderPath(pathname)} />}>
        <Routes>

          {/* Public: the InsiderTracker home is /insider (also the push-notification default) */}
          <Route path="/" element={<Navigate to="/insider" replace />} />
          <Route path="/privacy" element={<Privacy />} />
          {/* Google-only sign-in (email/password retired) */}
          <Route path="/login" element={<Navigate to="/insider/sign-in" replace />} />
          <Route path="/signup" element={<Navigate to="/insider/sign-in" replace />} />
          <Route path="/insider/*" element={
            // Top-level safety net; InsiderDashboard adds per-view boundaries inside.
            <ErrorBoundary resetKey={pathname}><InsiderDashboard /></ErrorBoundary>
          } />

          {/* Fallback: unknown and retired legacy paths open InsiderTracker */}
          <Route path="*" element={<Navigate to="/insider" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
