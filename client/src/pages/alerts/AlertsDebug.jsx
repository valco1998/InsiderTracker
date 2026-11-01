import { useState, useEffect } from "react";
import api from "../../lib/api";
import usePushNotifications from "../../hooks/usePushNotifications";
import {
  FcmDebugPanel,
  PushServerDebug,
  LivePermissionDebug,
  PipelineStats,
} from "./Alerts.jsx";

export default function AlertsDebug() {
  const push = usePushNotifications();
  const { swRegistered, fcmToken, lastFgMessage, lastSaveStatus } = push;

  const [pipelineStats,        setPipelineStats]        = useState(null);
  const [pipelineStatsLoading, setPipelineStatsLoading] = useState(false);

  async function loadPipelineStats() {
    setPipelineStatsLoading(true);
    try {
      const res = await api.get("/alerts/stats");
      if (res.data?.ok) setPipelineStats(res.data.stats);
    } catch { /* non-fatal */ }
    finally { setPipelineStatsLoading(false); }
  }

  async function resetPipelineStats() {
    try {
      const res = await api.post("/alerts/stats/reset");
      if (res.data?.ok) setPipelineStats(res.data.stats);
    } catch { /* non-fatal */ }
  }

  useEffect(() => { loadPipelineStats(); }, []);

  return (
    <div style={{ background: "#07080f", minHeight: "100vh", color: "#fff", fontFamily: "inherit" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "clamp(20px,5vw,44px) clamp(12px,4vw,28px) 80px" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: "clamp(24px,5vw,40px)" }}>
          <a
            href="/alerts"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              height: 32, padding: "0 13px", borderRadius: 8,
              fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)",
              border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.03)",
              textDecoration: "none", flexShrink: 0, transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.80)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.45)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}
          >
            <svg width={10} height={10} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to Alerts
          </a>

          <div>
            <h1 style={{
              fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", margin: 0, lineHeight: 1,
              background: "linear-gradient(135deg, #fff 30%, rgba(168,85,247,0.80) 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              Notification Diagnostics
            </h1>
            <p style={{ margin: "5px 0 0", fontSize: 12, color: "rgba(255,255,255,0.30)", lineHeight: 1.4 }}>
              Push pipeline status, FCM tokens, service worker state, and latency metrics.
            </p>
          </div>
        </div>

        {/* ── Debug panels ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <PipelineStats
            stats={pipelineStats}
            loading={pipelineStatsLoading}
            onRefresh={loadPipelineStats}
            onReset={resetPipelineStats}
          />

          <FcmDebugPanel
            swRegistered={swRegistered}
            fcmToken={fcmToken}
            lastFgMessage={lastFgMessage}
            lastSaveStatus={lastSaveStatus}
          />

          <PushServerDebug />

          <LivePermissionDebug fcmToken={fcmToken} />
        </div>

      </div>
    </div>
  );
}
