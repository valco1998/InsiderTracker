import { useState } from "react";
import api from "../../lib/api";
import useAuth from "../../hooks/useAuth";

export default function DevTradeMatchTest() {
  const { isAuthed } = useAuth();
  const [busy,   setBusy]   = useState(false);
  const [status, setStatus] = useState(null); // { ok, label }

  if (!import.meta.env.DEV) return null;

  async function run(endpoint, label) {
    if (busy || !isAuthed) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.post(endpoint);
      if (res.data.ok) {
        console.log(`[TRADE NOTIFS] ${label} OK:`, res.data);
        setStatus({ ok: true, label: `${label} ✓` });
      } else {
        console.warn(`[TRADE NOTIFS] ${label} error:`, res.data.error);
        setStatus({ ok: false, label: `${label} ✗` });
      }
    } catch (err) {
      console.error(`[TRADE NOTIFS] ${label} failed:`, err.message);
      setStatus({ ok: false, label: `${label} ✗` });
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 3000);
    }
  }

  const btnBase = {
    height: 28, padding: "0 11px",
    background: "transparent",
    borderRadius: 7,
    fontSize: 11, fontWeight: 600,
    cursor: busy || !isAuthed ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    transition: "border-color 0.2s, color 0.2s",
    opacity: !isAuthed ? 0.4 : 1,
  };

  const okColor   = status?.ok === true  ? "#86efac" : status?.ok === false ? "#fca5a5" : "#cbd5e1";
  const okText    = status?.ok === true  ? "#16a34a" : status?.ok === false ? "#dc2626" : "#94a3b8";

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <button
        onClick={() => run("/trades/test-notification", "Test notif")}
        disabled={busy || !isAuthed}
        title="Creates a real DB notification + emits socket"
        style={{ ...btnBase, border: `1px dashed ${okColor}`, color: status ? okText : "#94a3b8" }}
      >
        {busy ? "…" : status?.label || "Test Notification"}
      </button>

      <button
        onClick={() => run("/trade-notifications/rescan", "Rescan")}
        disabled={busy || !isAuthed}
        title="Re-runs match detection for ALL active posts — fills any missing notifications"
        style={{ ...btnBase, border: "1px dashed #cbd5e1", color: "#94a3b8" }}
      >
        {busy ? "…" : "Rescan All"}
      </button>
    </div>
  );
}
