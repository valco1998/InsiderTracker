import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import ProtectedLayout from "./pages/components/ProtectedLayout.jsx";
import AppLayout from "./pages/components/AppLayout.jsx";
import RealtimeAlertPopup from "./pages/Popup/RealtimeAlertPopup.jsx";
import TradeMatchToast from "./components/TradeMatchToast.jsx";
import useAuth from "./hooks/useAuth.js";

// Heavy pages — code-split so the initial bundle only contains the shell.
// Each page chunk is downloaded on first navigation, not on first load.
const Market       = lazy(() => import("./pages/market/Market.jsx"));
const Login        = lazy(() => import("./pages/login/Login.jsx"));
const Home         = lazy(() => import("./pages/home/home.jsx"));
const Watchlist    = lazy(() => import("./pages/components/watch/Watchlist.jsx"));
const Alerts       = lazy(() => import("./pages/alerts/Alerts.jsx"));
const ChatPage     = lazy(() => import("./pages/chat/ChatPage.jsx"));
const ItemPage     = lazy(() => import("./pages/market/ItemPage.jsx"));
const AuctionsPage = lazy(() => import("./pages/AuctionsPage"));
const SteamCallback   = lazy(() => import("./pages/steam/SteamCallback.jsx"));
const SteamInventory  = lazy(() => import("./pages/steam/SteamInventory.jsx"));
const TradePage            = lazy(() => import("./pages/trade/TradePage.jsx"));
const TradeDetailPage      = lazy(() => import("./pages/trade/TradeDetailPage.jsx"));
const TradeNotificationsPage = lazy(() => import("./pages/trade/TradeNotificationsPage.jsx"));
const Landing = lazy(() => import("./pages/landing/Landing.jsx"));
const Privacy = lazy(() => import("./pages/Privacy.jsx"));
const NotificationDashboard = lazy(() => import("./pages/admin/NotificationDashboard.jsx"));
const AlertsDebug           = lazy(() => import("./pages/alerts/AlertsDebug.jsx"));
const InsiderDashboard      = lazy(() => import("./pages/insider/InsiderDashboard.jsx"));

function PageFallback() {
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

function SmartHome() {
  const { token } = useAuth();
  if (token) {
    return (
      <AppLayout>
        <Home />
      </AppLayout>
    );
  }
  return <Landing />;
}

export default function App() {
  const isInsider = useLocation().pathname.startsWith("/insider");
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

      <Suspense fallback={<PageFallback />}>
        <Routes>

          {/* Public */}
          <Route path="/" element={<SmartHome />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Navigate to="/login" replace />} />
          <Route path="/steam/callback" element={<SteamCallback />} />
          <Route path="/insider/*" element={<InsiderDashboard />} />

          {/* Protected */}
          <Route element={<ProtectedLayout />}>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/market" element={<Market />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/alerts/debug" element={<AlertsDebug />} />
            <Route path="/item/:slug" element={<ItemPage />} />
            <Route path="/auctions" element={<AuctionsPage />} />
            <Route path="/inventory" element={<SteamInventory />} />
            <Route path="/trade" element={<TradePage />} />
            <Route path="/trade/notifications" element={<TradeNotificationsPage />} />
            <Route path="/trade/:id" element={<TradeDetailPage />} />
            <Route path="/admin/notifications" element={<NotificationDashboard />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
