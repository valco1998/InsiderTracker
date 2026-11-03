// Saved strategies (signed-in users). Loading one fills the Strategy Builder with exactly
// the saved values; nothing runs until the user clicks Run backtest.
import { useState } from "react";
import { Link } from "react-router-dom";
import useAuth from "../../../hooks/useAuth";
import useSavedStrategies from "../../../hooks/useSavedStrategies";

export default function SavedStrategies({ currentRequest, onLoad }) {
  const { isAuthed } = useAuth();
  const s = useSavedStrategies(isAuthed);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  if (!isAuthed) {
    return <div className="px-5 py-2.5 text-[12.5px] it-dim2" style={{ borderTop: "1px solid var(--it-line-soft)" }}><Link className="it-link" to="/insider/sign-in">Sign in</Link> to save strategies. Running a backtest does not need an account.</div>;
  }
  const act = async (fn, ok) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); } catch (err) { setMsg({ ok: false, text: err.response?.data?.error || "Could not save." }); } finally { setBusy(false); }
  };
  const canSave = !!currentRequest && name.trim().length > 0 && !busy;
  return (
    <div className="flex flex-col gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="it-label">Saved strategies</span>
        <input className="it-input min-w-0 flex-1 sm:max-w-[260px]" maxLength={80} placeholder="Name this strategy" value={name} onChange={(e) => setName(e.target.value)} aria-label="Strategy name" />
        <button type="button" className="it-btn" disabled={!canSave} onClick={() => act(async () => { await s.save(name.trim(), currentRequest); setName(""); }, "Saved.")}>Save current settings</button>
        {msg && <span className="text-[12px]" style={{ color: msg.ok ? "var(--it-buy)" : "var(--it-warn)" }} role="status">{msg.text}</span>}
      </div>
      {!currentRequest && <span className="text-[11.5px]" style={{ color: "var(--it-warn)" }}>Fix the settings above before saving.</span>}
      {s.error && <span className="text-[12px]" style={{ color: "var(--it-warn)" }}>{s.error}</span>}
      {s.list.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {s.list.map((x) => (
            <li key={x.id} className="it-chip flex items-center gap-1.5" style={{ paddingRight: 4 }}>
              <button type="button" className="hover:underline" onClick={() => onLoad(x.params)} title="Load these settings into the Strategy Builder">{x.name}</button>
              <button type="button" className="it-dim2 px-1" disabled={busy || !currentRequest} title="Overwrite with the current settings" aria-label={`Update ${x.name} with the current settings`} onClick={() => act(() => s.update(x.id, currentRequest), "Updated.")}>↻</button>
              <button type="button" className="it-dim2 px-1" disabled={busy} aria-label={`Delete ${x.name}`} onClick={() => { if (window.confirm(`Delete saved strategy “${x.name}”?`)) act(() => s.remove(x.id), "Deleted."); }}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
