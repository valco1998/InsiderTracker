import { useCallback, useEffect, useState } from "react";
import api from "../../lib/api";

const PERIODS = ["1h", "24h", "7d"];
const REFRESH_MS = 60_000;

const BAND_COLORS = {
  Excellent: "#4ade80",
  Good:      "#60a5fa",
  Warning:   "#fbbf24",
  Critical:  "#f87171",
};

const FUNNEL_STAGES = [
  { key: "alertsMatched",  label: "Matched"   },
  { key: "alertsCreated",  label: "Created"   },
  { key: "socketEmits",    label: "Socket"    },
  { key: "pushAttempts",   label: "Push Sent" },
  { key: "pushSuccess",    label: "Success"   },
];

const LATENCY_STAGES = [
  { key: "matchToCreated",    label: "Match → Created"     },
  { key: "createdToSocket",   label: "Created → Socket"    },
  { key: "socketToPushStart", label: "Socket → Push Start" },
  { key: "pushStartToDone",   label: "Push Start → Done"   },
  { key: "endToEnd",          label: "End-to-End"          },
];

function fmtMs(v) {
  if (v == null) return "—";
  if (v < 1000) return `${v}ms`;
  return `${(v / 1000).toFixed(1)}s`;
}

function fmtPct(v) {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 700, color: accent || "#e2e8f0" }}>
        {value}
      </span>
      {sub != null && (
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{sub}</span>
      )}
    </div>
  );
}

function HealthBadge({ score, band }) {
  const color = BAND_COLORS[band] || "#e2e8f0";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "14px 20px", borderRadius: 12,
      background: `${color}14`, border: `1px solid ${color}33`,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: `3px solid ${color}`, fontSize: 18, fontWeight: 800, color,
      }}>
        {score}
      </div>
      <div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.5 }}>
          System Health
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color }}>{band}</div>
      </div>
    </div>
  );
}

function Funnel({ data }) {
  const max = Math.max(1, ...FUNNEL_STAGES.map((s) => data?.[s.key] || 0));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {FUNNEL_STAGES.map((s, i) => {
        const value = data?.[s.key] ?? 0;
        const pct = Math.max(4, (value / max) * 100);
        const prev = i > 0 ? (data?.[FUNNEL_STAGES[i - 1].key] ?? 0) : null;
        const drop = prev != null ? prev - value : null;
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 110, fontSize: 12.5, color: "rgba(255,255,255,0.6)" }}>{s.label}</div>
            <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: 6, overflow: "hidden", height: 22 }}>
              <div style={{
                width: `${pct}%`, height: "100%", borderRadius: 6,
                background: "linear-gradient(135deg, #7c3aed, #6366f1)",
                display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 8,
                fontSize: 12, fontWeight: 700, color: "#fff", minWidth: 32,
              }}>
                {value}
              </div>
            </div>
            {drop != null && drop > 0 && (
              <div style={{ width: 70, fontSize: 11.5, color: "#fbbf24", textAlign: "right" }}>
                -{drop}
              </div>
            )}
            {drop != null && drop <= 0 && <div style={{ width: 70 }} />}
          </div>
        );
      })}
    </div>
  );
}

function LatencyTable({ latency }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ color: "rgba(255,255,255,0.45)", textAlign: "left" }}>
            <th style={{ padding: "6px 10px", fontWeight: 600 }}>Stage</th>
            <th style={{ padding: "6px 10px", fontWeight: 600 }}>Avg</th>
            <th style={{ padding: "6px 10px", fontWeight: 600 }}>p50</th>
            <th style={{ padding: "6px 10px", fontWeight: 600 }}>p95</th>
            <th style={{ padding: "6px 10px", fontWeight: 600 }}>Max</th>
            <th style={{ padding: "6px 10px", fontWeight: 600 }}>Samples</th>
          </tr>
        </thead>
        <tbody>
          {LATENCY_STAGES.map((s) => {
            const st = latency?.[s.key];
            return (
              <tr key={s.key} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={{ padding: "8px 10px", color: "#e2e8f0" }}>{s.label}</td>
                <td style={{ padding: "8px 10px" }}>{fmtMs(st?.avg)}</td>
                <td style={{ padding: "8px 10px" }}>{fmtMs(st?.p50)}</td>
                <td style={{ padding: "8px 10px" }}>{fmtMs(st?.p95)}</td>
                <td style={{ padding: "8px 10px", color: st?.max > 10000 ? "#f87171" : "#e2e8f0" }}>{fmtMs(st?.max)}</td>
                <td style={{ padding: "8px 10px", color: "rgba(255,255,255,0.4)" }}>{st?.count ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function NotificationDashboard() {
  const [periods, setPeriods] = useState(null);
  const [wsStatus, setWsStatus] = useState(null);
  const [period, setPeriod] = useState("24h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/notifications/metrics/dashboard");
      setPeriods(res.data.periods);
      setWsStatus(res.data.wsStatus);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !periods) {
    return (
      <div style={{ minHeight: "100vh", background: "#07080f", color: "#e2e8f0", padding: 24 }}>
        Loading notification metrics…
      </div>
    );
  }

  if (error && !periods) {
    return (
      <div style={{ minHeight: "100vh", background: "#07080f", color: "#f87171", padding: 24 }}>
        {error}
      </div>
    );
  }

  const data = periods?.[period];

  return (
    <div style={{ minHeight: "100vh", background: "#07080f", color: "#e2e8f0", padding: "24px 20px 60px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Header */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Notification Reliability</h1>
          <div style={{ display: "flex", gap: 6 }}>
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  border: `1px solid ${p === period ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.08)"}`,
                  background: p === period ? "rgba(168,85,247,0.16)" : "rgba(255,255,255,0.03)",
                  color: p === period ? "#c4b5fd" : "#e2e8f0",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Health + WS status */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <HealthBadge score={data?.healthScore ?? 0} band={data?.healthBand ?? "Critical"} />
          <div style={{
            flex: 1, minWidth: 240, padding: "14px 18px", borderRadius: 12,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            display: "flex", flexDirection: "column", gap: 6, justifyContent: "center",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 9, height: 9, borderRadius: "50%",
                background: wsStatus?.connected ? "#4ade80" : "#f87171",
              }} />
              <span style={{ fontWeight: 700 }}>
                Empire WS: {wsStatus?.connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)" }}>
              Last event: {wsStatus?.lastEventName ?? "—"}
              {wsStatus?.lastEventAt ? ` · ${Math.round((Date.now() - wsStatus.lastEventAt) / 1000)}s ago` : ""}
              {" · "}Disconnects: {data?.wsHealth?.disconnects ?? 0}
              {" · "}Reconnects: {data?.wsHealth?.reconnects ?? 0}
              {" · "}Watchdog restarts: {data?.wsHealth?.watchdogRestarts ?? 0}
              {" · "}Server restarts: {data?.serverRestarts ?? 0}
            </div>
          </div>
        </div>

        {/* Pipeline funnel */}
        <div style={{
          padding: "16px 18px", borderRadius: 12,
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 14px", color: "rgba(255,255,255,0.7)" }}>
            Pipeline Funnel ({period})
          </h2>
          <Funnel data={data} />
          {(data?.duplicateSkipped ?? 0) > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              {data.duplicateSkipped} duplicate alert(s) skipped (E11000) in this period
            </div>
          )}
        </div>

        {/* Stat grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <StatCard label="Alerts Detected" value={data?.alertsMatched ?? 0} />
          <StatCard label="Pushes Sent" value={data?.pushAttempts ?? 0} />
          <StatCard label="Success Rate" value={fmtPct(data?.successRate)} accent="#4ade80" />
          <StatCard label="Failure Rate" value={fmtPct(data?.failureRate)} accent={data?.failureRate > 5 ? "#f87171" : "#e2e8f0"} />
          <StatCard label="Duplicate Skips" value={data?.duplicateSkipped ?? 0} />
          <StatCard label="Avg Latency" value={fmtMs(data?.latency?.endToEnd?.avg)} />
          <StatCard label="Worst Latency" value={fmtMs(data?.latency?.endToEnd?.max)} accent={(data?.latency?.endToEnd?.max ?? 0) > 10000 ? "#f87171" : "#e2e8f0"} />
          <StatCard label="Active Tokens" value={data?.activeTokens ?? 0} />
          <StatCard label="Tokens Removed" value={data?.tokensRemoved ?? 0} />
          <StatCard label="Tokens Registered" value={data?.tokensRegistered ?? 0} />
        </div>

        {/* Latency breakdown */}
        <div style={{
          padding: "16px 18px", borderRadius: 12,
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px", color: "rgba(255,255,255,0.7)" }}>
            Latency Breakdown
          </h2>
          <LatencyTable latency={data?.latency} />
        </div>

        {/* Notifications per user */}
        <div style={{
          padding: "16px 18px", borderRadius: 12,
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px", color: "rgba(255,255,255,0.7)" }}>
            Notifications Delivered Per User (top 10)
          </h2>
          {(!data?.notificationsPerUser || data.notificationsPerUser.length === 0) ? (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>No successful pushes in this period.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.notificationsPerUser.map((u) => (
                <div key={u.userId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                  <span style={{ color: "rgba(255,255,255,0.7)" }}>{u.username}</span>
                  <span style={{ fontWeight: 700 }}>{u.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ fontSize: 12, color: "#f87171" }}>
            Last refresh failed: {error}
          </div>
        )}
      </div>
    </div>
  );
}
