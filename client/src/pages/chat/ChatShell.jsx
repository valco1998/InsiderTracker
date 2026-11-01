import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuctionShareMessage from "../components/AuctionShareMessage";

/* ─── Time helpers ───────────────────────────────────────────── */

const _timeCache = new Map();
function fmtTime(iso) {
  if (!iso) return "";
  if (_timeCache.has(iso)) return _timeCache.get(iso);
  try {
    const v = new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    _timeCache.set(iso, v);
    return v;
  } catch { return ""; }
}

const _dateCache = new Map();
function fmtDate(iso) {
  if (!iso) return "";
  if (_dateCache.has(iso)) return _dateCache.get(iso);
  try {
    const d = new Date(iso), now = new Date(), yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    const v = d.toDateString() === now.toDateString()
      ? "Today"
      : d.toDateString() === yest.toDateString()
      ? "Yesterday"
      : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    _dateCache.set(iso, v);
    return v;
  } catch { return ""; }
}

/* ─── Group avatar color ─────────────────────────────────────── */

const GROUP_COLORS = [
  "#7c3aed", "#0891b2", "#db2777", "#059669", "#d97706", "#4f46e5",
];
function groupHue(name = "") {
  return GROUP_COLORS[name.charCodeAt(0) % GROUP_COLORS.length];
}

/* ─── Avatar ─────────────────────────────────────────────────── */

const Avatar = memo(function Avatar({ src, name, size = 32, online, borderBg = "#1a2133" }) {
  const [err, setErr] = useState(false);
  const fallback = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name || "?")}`;
  return (
    <div style={{ position: "relative", flexShrink: 0, width: size, height: size }}>
      <img
        src={!err && src ? src : fallback}
        alt={name || ""}
        onError={() => setErr(true)}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), objectFit: "cover", border: "1px solid rgba(255,255,255,0.08)", display: "block" }}
      />
      {online !== undefined && (
        <div style={{ position: "absolute", bottom: -1, right: -1 }}>
          {online && (
            <span style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              background: "rgba(74,222,128,0.5)",
              animation: "onlinePing 2.3s ease-out infinite",
            }} />
          )}
          <span style={{
            position: "relative", display: "block",
            width: 9, height: 9, borderRadius: "50%",
            background: online ? "#4ade80" : "rgba(255,255,255,0.2)",
            border: `2px solid ${borderBg}`,
            animation: online ? "neonPulse 2.8s ease-in-out infinite" : "none",
          }} />
        </div>
      )}
    </div>
  );
});

const GroupAvatar = memo(function GroupAvatar({ name, size = 32 }) {
  const color = groupHue(name);
  const r     = Math.round(size * 0.3);
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flexShrink: 0,
      background: color, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: Math.round(size * 0.4), fontWeight: 700, color: "#fff",
    }}>
      {(name?.[0] ?? "?").toUpperCase()}
    </div>
  );
});

/* ─── Unread badge ───────────────────────────────────────────── */

function UnreadBadge({ count }) {
  if (!count) return null;
  return (
    <span style={{
      minWidth: 16, height: 16, borderRadius: 4, padding: "0 4px",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 9, fontWeight: 700, fontVariantNumeric: "tabular-nums",
      background: "rgba(251,191,36,0.18)", border: "1px solid rgba(251,191,36,0.3)",
      color: "#fbbf24", flexShrink: 0,
    }}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/* ─── Message bubble ─────────────────────────────────────────── */

const Message = memo(function Message({ msg, isMine, showAvatar, showName }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMine ? "row-reverse" : "row",
        gap: 10,
        padding: "1px 16px",
        background: hov ? "rgba(168,85,247,0.025)" : "transparent",
        transition: "background 0.18s",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {/* Avatar column */}
      <div style={{ width: 32, flexShrink: 0, display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
        {showAvatar
          ? <Avatar src={msg.senderAvatar} name={msg.senderName} size={32} borderBg="#1a2133" />
          : <div style={{ width: 32 }} />}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: isMine ? "flex-end" : "flex-start", maxWidth: "62%", gap: 2 }}>
        {showName && !isMine && (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.42)", paddingLeft: 4, paddingBottom: 1 }}>
            {msg.senderName}
          </span>
        )}
        <div
          style={isMine ? {
            background: "linear-gradient(135deg, rgba(109,40,217,0.30) 0%, rgba(88,28,135,0.24) 50%, rgba(168,85,247,0.18) 100%)",
            border: "1px solid rgba(139,92,246,0.40)",
            borderRadius: "16px 16px 4px 16px",
            padding: "8px 13px",
            fontSize: 13.5,
            lineHeight: 1.55,
            color: "rgba(255,255,255,0.93)",
            wordBreak: "break-word",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow: hov
              ? "0 0 20px rgba(168,85,247,0.30), 0 4px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)"
              : "0 2px 16px rgba(109,40,217,0.20), inset 0 1px 0 rgba(255,255,255,0.08)",
            animation: "msgIn 0.20s ease-out",
            transition: "box-shadow 0.25s",
          } : {
            background: "rgba(255,255,255,0.055)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: "16px 16px 16px 4px",
            padding: "8px 13px",
            fontSize: 13.5,
            lineHeight: 1.55,
            color: "rgba(255,255,255,0.88)",
            wordBreak: "break-word",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow: hov
              ? "0 0 14px rgba(34,211,238,0.12), 0 4px 16px rgba(0,0,0,0.30)"
              : "0 2px 10px rgba(0,0,0,0.22)",
            animation: "msgIn 0.20s ease-out",
            transition: "box-shadow 0.25s",
          }}
        >
          {msg.text}
        </div>
        <span style={{
          fontSize: 10, color: "rgba(255,255,255,0.22)", paddingLeft: 4, paddingRight: 4,
          opacity: hov ? 1 : 0, transition: "opacity 0.15s",
        }}>
          {fmtTime(msg.createdAt)}
        </span>
      </div>
    </div>
  );
});

const SystemMsg = memo(function SystemMsg({ text }) {
  return (
    <div style={{ textAlign: "center", padding: "6px 16px" }}>
      <span style={{
        fontSize: 10.5, fontStyle: "italic", fontWeight: 500,
        color: "rgba(168,85,247,0.55)",
        background: "rgba(168,85,247,0.05)",
        border: "1px solid rgba(168,85,247,0.12)",
        padding: "2px 12px", borderRadius: 10,
        animation: "holoBlink 4s ease-in-out infinite",
      }}>
        {text}
      </span>
    </div>
  );
});

const DateDivider = memo(function DateDivider({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 8px" }}>
      <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, rgba(168,85,247,0.28), rgba(34,211,238,0.14))" }} />
      <span style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase",
        color: "rgba(168,85,247,0.65)", padding: "3px 10px", borderRadius: 6,
        background: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.20)",
        textShadow: "0 0 8px rgba(168,85,247,0.4)",
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(34,211,238,0.14), rgba(168,85,247,0.28), transparent)" }} />
    </div>
  );
});

const TypingBubble = memo(function TypingBubble({ users }) {
  if (!users.length) return null;
  const who = users.length === 1 ? users[0].username
    : users.length === 2 ? `${users[0].username} & ${users[1].username}`
    : `${users[0].username} +${users.length - 1}`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 16px 8px" }}>
      <div style={{ width: 32, flexShrink: 0 }} />
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "7px 14px", borderRadius: "14px 14px 14px 4px",
        background: "rgba(168,85,247,0.08)",
        border: "1px solid rgba(168,85,247,0.22)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 0 12px rgba(168,85,247,0.12), 0 2px 12px rgba(0,0,0,0.25)",
        animation: "neonBreath 3s ease-in-out infinite",
      }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {[0, 160, 320].map(d => (
            <span key={d} style={{
              width: 4.5, height: 4.5, borderRadius: "50%",
              background: "linear-gradient(135deg, #a855f7, #22d3ee)",
              boxShadow: "0 0 6px rgba(168,85,247,0.8)",
              animation: "typingDot 1.4s ease-in-out infinite",
              animationDelay: `${d}ms`,
            }} />
          ))}
        </div>
        <span style={{ fontSize: 11.5, color: "rgba(168,85,247,0.78)", fontWeight: 500 }}>
          {who} typing…
        </span>
      </div>
    </div>
  );
});

/* ─── Auction share wrapper ─────────────────────────────────── */

const AuctionMsg = memo(function AuctionMsg({ msg, isMine, grouped }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: isMine ? "row-reverse" : "row",
      gap: 10,
      padding: `${grouped ? 1 : 16}px 16px 1px`,
    }}>
      <div style={{ width: 32, flexShrink: 0, display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
        {!grouped
          ? <Avatar src={msg.senderAvatar} name={msg.senderName} size={32} borderBg="#1a2133" />
          : <div style={{ width: 32 }} />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: isMine ? "flex-end" : "flex-start" }}>
        {!grouped && !isMine && (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.42)", paddingLeft: 4 }}>
            {msg.senderName}
          </span>
        )}
        <AuctionShareMessage msg={msg} isMine={isMine} compact={false} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", paddingLeft: 4, paddingRight: 4 }}>
          {fmtTime(msg.createdAt)}
        </span>
      </div>
    </div>
  );
});

/* ─── Message skeleton ──────────────────────────────────────── */

const MessageSkeleton = memo(function MessageSkeleton() {
  const rows = [
    { right: false, w: 200 }, { right: false, w: 150 },
    { right: true,  w: 180 }, { right: false, w: 240 },
    { right: true,  w: 120 }, { right: true,  w: 190 },
  ];
  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 10, flexDirection: r.right ? "row-reverse" : "row" }}>
          <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0 }} />
          <div className="skeleton" style={{ height: 36, width: r.w, borderRadius: 14 }} />
        </div>
      ))}
    </div>
  );
});

/* ─── Confirm dialog ────────────────────────────────────────── */

const ConfirmDialog = memo(function ConfirmDialog({ message, detail, onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }}>
      <div style={{ width: "100%", maxWidth: 360, borderRadius: 18, padding: 24, background: "#1f2838", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 24px 60px rgba(0,0,0,0.7)" }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: detail ? 6 : 20 }}>{message}</p>
        {detail && <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 20 }}>{detail}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px 0", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: "10px 0", borderRadius: 10, background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.25)", fontSize: 13, fontWeight: 700, color: "#f87171", cursor: "pointer", fontFamily: "inherit" }}>Confirm</button>
        </div>
      </div>
    </div>
  );
});

/* ─── Modal shell ───────────────────────────────────────────── */

function Modal({ title, subtitle, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(14px)" }}>
      <div style={{ width: "100%", maxWidth: 440, borderRadius: 20, overflow: "hidden", background: "#1f2838", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 32px 80px rgba(0,0,0,0.7)" }}>
        <div style={{ padding: "20px 22px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(34,211,238,0.04)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: 0 }}>{title}</h2>
              {subtitle && <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.38)", marginTop: 3, marginBottom: 0 }}>{subtitle}</p>}
            </div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>×</button>
          </div>
        </div>
        <div style={{ padding: "20px 22px 22px" }}>{children}</div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.05)", padding: "10px 14px",
  fontSize: 13.5, color: "rgba(255,255,255,0.88)", outline: "none",
  fontFamily: "inherit", transition: "border-color 0.15s, background 0.15s",
};

function StyledInput({ onFocus: propFocus, onBlur: propBlur, ...props }) {
  const [foc, setFoc] = useState(false);
  return (
    <input
      {...props}
      style={{
        ...inputStyle,
        borderColor: foc ? "rgba(34,211,238,0.35)" : "rgba(255,255,255,0.10)",
        background:   foc ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.05)",
        ...(props.style ?? {}),
      }}
      onFocus={e => { setFoc(true); propFocus?.(e); }}
      onBlur={e => { setFoc(false); propBlur?.(e); }}
    />
  );
}

function PrimaryBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{ flex: 1, padding: "10px 0", borderRadius: 10, background: "linear-gradient(135deg,#22d3ee,#a855f7)", border: "none", fontSize: 13.5, fontWeight: 700, color: "#fff", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, fontFamily: "inherit", transition: "filter 0.15s" }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.filter = "brightness(1.1)"; }}
      onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)"; }}
    >
      {children}
    </button>
  );
}
function GhostBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{ flex: 1, padding: "10px 0", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", fontSize: 13.5, fontWeight: 500, color: "rgba(255,255,255,0.5)", cursor: "pointer", fontFamily: "inherit" }}>
      {children}
    </button>
  );
}

/* ─── Create group modal ────────────────────────────────────── */

function CreateGroupModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [input, setInput] = useState("");
  const [usernames, setUsernames] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function addUser() {
    const u = input.trim().replace(/^@/, "");
    if (!u || usernames.includes(u)) { setInput(""); return; }
    setUsernames(p => [...p, u]); setInput("");
  }

  async function handle() {
    if (!name.trim()) { setErr("Group name is required"); return; }
    setSaving(true); setErr("");
    try { await onCreate(name.trim(), usernames); onClose(); }
    catch (e) { setErr(e?.response?.data?.error || e?.message || "Failed"); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="New Private Group" subtitle="Only invited members can read messages.">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.38)", marginBottom: 7 }}>Group Name</label>
          <StyledInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Knife Traders" maxLength={60} autoFocus />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.38)", marginBottom: 7 }}>Invite Members</label>
          <div style={{ display: "flex", gap: 8 }}>
            <StyledInput value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addUser(); } }} placeholder="@username" />
            <button onClick={addUser} style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)", cursor: "pointer", flexShrink: 0, fontFamily: "inherit" }}>Add</button>
          </div>
        </div>
        {usernames.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {usernames.map(u => (
              <span key={u} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 6, background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)", fontSize: 12, color: "rgba(34,211,238,0.85)", fontWeight: 500 }}>
                @{u}
                <button onClick={() => setUsernames(p => p.filter(x => x !== u))} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", lineHeight: 1, padding: 0, fontFamily: "inherit" }}>×</button>
              </span>
            ))}
          </div>
        )}
        {err && <p style={{ fontSize: 12.5, color: "#fca5a5", margin: 0 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn onClick={handle} disabled={saving || !name.trim()}>{saving ? "Creating…" : "Create Group"}</PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
}

function AddMemberModal({ groupId, onClose, onAdd }) {
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handle() {
    const u = username.trim().replace(/^@/, "");
    if (!u) return;
    setSaving(true); setErr("");
    try { await onAdd(groupId, u); onClose(); }
    catch (e) { setErr(e?.response?.data?.error || e?.message || "User not found"); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="Add Member" subtitle="Invite someone by username.">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <StyledInput value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handle(); }} placeholder="@username" autoFocus />
        {err && <p style={{ fontSize: 12.5, color: "#fca5a5", margin: 0 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn onClick={handle} disabled={saving || !username.trim()}>{saving ? "Adding…" : "Add Member"}</PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Add friend modal ──────────────────────────────────────── */

function AddFriendModal({ onClose, onSend, onAccept, onDecline, searchFn }) {
  const [q, setQ]               = useState("");
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy]         = useState(null); // userId being actioned
  const [sent, setSent]         = useState({});   // userId → true after successful send
  const [rowErr, setRowErr]     = useState({});   // userId → error string

  async function search(v) {
    setQ(v);
    setRowErr({});
    if (v.length < 2) { setResults([]); return; }
    setSearching(true);
    try { setResults(await searchFn(v)); }
    catch { setResults([]); }
    finally { setSearching(false); }
  }

  async function doSend(userId) {
    setBusy(userId);
    setRowErr(p => ({ ...p, [userId]: "" }));
    const result = await onSend(userId);
    if (result?.ok) {
      setSent(p => ({ ...p, [userId]: true }));
    } else {
      setRowErr(p => ({ ...p, [userId]: result?.error || "Failed" }));
    }
    setBusy(null);
  }

  async function doAccept(userId) {
    setBusy(userId);
    setRowErr(p => ({ ...p, [userId]: "" }));
    const result = await onAccept(userId);
    if (result?.ok) {
      setResults(p => p.map(u => u.userId === userId ? { ...u, hasIncomingRequest: false, isFriend: true } : u));
    } else {
      setRowErr(p => ({ ...p, [userId]: result?.error || "Failed" }));
    }
    setBusy(null);
  }

  async function doDecline(userId) {
    setBusy(userId);
    setRowErr(p => ({ ...p, [userId]: "" }));
    const result = await onDecline(userId);
    if (result?.ok) {
      setResults(p => p.map(u => u.userId === userId ? { ...u, hasIncomingRequest: false } : u));
    } else {
      setRowErr(p => ({ ...p, [userId]: result?.error || "Failed" }));
    }
    setBusy(null);
  }

  return (
    <Modal onClose={onClose} title="Find Friends" subtitle="Search by username and send a friend request.">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <StyledInput value={q} onChange={e => search(e.target.value)} placeholder="Search username…" autoFocus />

        {searching && (
          <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              {[0, 120, 240].map(d => (
                <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.25)", animation: "typingDot 1.2s ease-in-out infinite", animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}

        {!searching && results.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 300, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
            {results.map(u => (
              <div
                key={u.userId}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", borderRadius: 12,
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                  transition: "border-color 0.12s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.11)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
              >
                <Avatar src={u.avatarUrl} name={u.username} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,0.88)", margin: "0 0 1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {u.username}
                  </p>
                  {rowErr[u.userId] ? (
                    <p style={{ fontSize: 10.5, color: "#f87171", margin: 0, fontWeight: 500 }}>{rowErr[u.userId]}</p>
                  ) : u.isFriend ? (
                    <p style={{ fontSize: 10.5, color: "rgba(74,222,128,0.6)", margin: 0, fontWeight: 500 }}>Already friends</p>
                  ) : u.isBlocked ? (
                    <p style={{ fontSize: 10.5, color: "rgba(248,113,113,0.5)", margin: 0, fontWeight: 500 }}>Blocked</p>
                  ) : u.hasIncomingRequest ? (
                    <p style={{ fontSize: 10.5, color: "rgba(251,191,36,0.6)", margin: 0, fontWeight: 500 }}>Sent you a request</p>
                  ) : (sent[u.userId] || u.hasSentRequest) ? (
                    <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.28)", margin: 0, fontWeight: 500 }}>Request pending</p>
                  ) : null}
                </div>

                <div style={{ flexShrink: 0 }}>
                  {u.isBlocked ? null
                  : u.isFriend ? (
                    <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.16)", color: "rgba(74,222,128,0.6)", fontWeight: 600 }}>✓ Friend</span>
                  ) : u.hasIncomingRequest ? (
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={() => doAccept(u.userId)} disabled={busy === u.userId} style={{ padding: "5px 11px", borderRadius: 8, background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.28)", fontSize: 11.5, fontWeight: 700, color: "#4ade80", cursor: "pointer", fontFamily: "inherit", opacity: busy === u.userId ? 0.5 : 1, transition: "filter 0.1s" }} onMouseEnter={e => { if (busy !== u.userId) e.currentTarget.style.filter = "brightness(1.15)"; }} onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}>Accept</button>
                      <button onClick={() => doDecline(u.userId)} disabled={busy === u.userId} style={{ padding: "5px 11px", borderRadius: 8, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.16)", fontSize: 11.5, fontWeight: 600, color: "#f87171", cursor: "pointer", fontFamily: "inherit", opacity: busy === u.userId ? 0.5 : 1 }}>Decline</button>
                    </div>
                  ) : sent[u.userId] || u.hasSentRequest ? (
                    <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>Pending</span>
                  ) : (
                    <button
                      onClick={() => doSend(u.userId)} disabled={busy === u.userId}
                      style={{ padding: "5px 14px", borderRadius: 8, background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.22)", fontSize: 12, fontWeight: 700, color: "#22d3ee", cursor: busy === u.userId ? "default" : "pointer", fontFamily: "inherit", opacity: busy === u.userId ? 0.5 : 1, transition: "filter 0.1s" }}
                      onMouseEnter={e => { if (busy !== u.userId) e.currentTarget.style.filter = "brightness(1.15)"; }}
                      onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
                    >{busy === u.userId ? "…" : "+ Add"}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!searching && q.length >= 2 && results.length === 0 && (
          <div style={{ textAlign: "center", padding: "16px 0 4px" }}>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>No users found for "{q}"</p>
          </div>
        )}

        {!searching && q.length < 2 && q.length > 0 && (
          <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.2)", margin: 0, textAlign: "center" }}>Type at least 2 characters</p>
        )}
      </div>
    </Modal>
  );
}

/* ─── User action row (hover actions for online/member lists) ── */

/* ─── Right-panel icon set ───────────────────────────────────── */

const Ico = {
  dm:     <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  add:    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>,
  remove: <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/></svg>,
  kick:   <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  block:  <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
  check:  <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
};

/* Icon-only 20×20 button — title provides native tooltip */
function ActionBtn({ onClick, variant, title, icon }) {
  const s = {
    primary: { bg: "rgba(34,211,238,0.1)",  border: "rgba(34,211,238,0.22)", color: "#22d3ee" },
    success: { bg: "rgba(74,222,128,0.1)",  border: "rgba(74,222,128,0.25)", color: "#4ade80" },
    danger:  { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.18)",  color: "#f87171" },
    muted:   { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.38)" },
  }[variant] || { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.38)" };

  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      title={title}
      style={{
        width: 20, height: 20, borderRadius: 5, flexShrink: 0,
        background: s.bg, border: `1px solid ${s.border}`,
        color: s.color, cursor: "pointer", fontFamily: "inherit",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "filter 0.12s",
      }}
      onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.25)"; }}
      onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)"; }}
    >
      {icon}
    </button>
  );
}

function UserRow({ user, isMe, isOwner, canKick, isFriend, isBlocked, hasSentRequest, hasIncomingRequest, onKick, onSendRequest, onAcceptRequest, onRemoveFriend, onBlock, onUnblock, onMessage }) {
  const [hov, setHov] = useState(false);
  const name = user.displayName || user.username || "User";

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 8,
        background: isMe ? "rgba(34,211,238,0.06)" : hov ? "rgba(168,85,247,0.05)" : "transparent",
        transition: "background 0.18s",
      }}
    >
      <Avatar src={user.avatarUrl} name={name} size={24} online={user.online} borderBg="#18202e" />

      <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.82)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </span>
          {isMe    && <span style={{ fontSize: 7.5, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)", color: "#22d3ee", flexShrink: 0 }}>you</span>}
          {isOwner && !isMe && <span style={{ fontSize: 7.5, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24", flexShrink: 0 }}>owner</span>}
        </div>
        {!hov && (
          <>
            {isFriend && !isMe             && <span style={{ fontSize: 9, color: "rgba(74,222,128,0.5)",   fontWeight: 500 }}>Friend</span>}
            {!isFriend && hasSentRequest   && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 500 }}>Pending</span>}
            {!isFriend && hasIncomingRequest && <span style={{ fontSize: 9, color: "rgba(251,191,36,0.55)", fontWeight: 500 }}>Wants to connect</span>}
          </>
        )}
      </div>

      {hov && !isMe && (
        <div style={{ display: "flex", gap: 3, flexShrink: 0, alignItems: "center" }}>
          {canKick                                                           && <ActionBtn onClick={onKick}         variant="danger"   title="Kick from group"       icon={Ico.kick}   />}
          {!isBlocked && onMessage                                           && <ActionBtn onClick={onMessage}      variant="primary"  title="Send direct message"   icon={Ico.dm}     />}
          {!isBlocked && !isFriend && !hasSentRequest && !hasIncomingRequest && <ActionBtn onClick={onSendRequest}  variant="muted"    title="Send friend request"   icon={Ico.add}    />}
          {!isBlocked && !isFriend && hasIncomingRequest                     && <ActionBtn onClick={onAcceptRequest} variant="success" title="Accept friend request" icon={Ico.check}  />}
          {isFriend                                                          && <ActionBtn onClick={onRemoveFriend} variant="muted"    title="Remove friend"         icon={Ico.remove} />}
          {isBlocked
            ? <ActionBtn onClick={onUnblock} variant="muted"  title="Unblock user" icon={Ico.check} />
            : <ActionBtn onClick={onBlock}   variant="danger" title="Block user"   icon={Ico.block} />}
        </div>
      )}
    </div>
  );
}

/* ─── DM conversation row ────────────────────────────────────── */

function DMConvRow({ conv, active, currentUserId, onClick }) {
  const [hov, setHov] = useState(false);
  const isMe = conv.lastSenderId === currentUserId;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 9,
        padding: "6px 8px", borderRadius: 10, textAlign: "left", cursor: "pointer",
        background: active
          ? "linear-gradient(90deg, rgba(34,211,238,0.08), rgba(34,211,238,0.03))"
          : hov ? "rgba(34,211,238,0.04)" : "transparent",
        borderTop: "none", borderRight: "none", borderBottom: "none",
        borderLeft: `3px solid ${active ? "#22d3ee" : hov ? "rgba(34,211,238,0.22)" : "transparent"}`,
        boxShadow: active ? "inset 0 0 28px rgba(34,211,238,0.05)" : "none",
        transition: "all 0.18s", fontFamily: "inherit",
      }}
    >
      <Avatar src={conv.otherUser?.avatarUrl} name={conv.otherUser?.username || "?"} size={30} online={conv.otherUser?.online} borderBg={SIDEBAR_BG} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 12.5, fontWeight: conv.myUnread > 0 ? 700 : 500,
          color: active ? "#fff" : conv.myUnread > 0 ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.55)",
          margin: "0 0 1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {conv.otherUser?.username || "User"}
        </p>
        {conv.lastMessage && (
          <p style={{
            fontSize: 10.5, color: conv.myUnread > 0 ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.22)",
            margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: conv.myUnread > 0 ? 600 : 400,
          }}>
            {isMe ? "You: " : ""}{conv.lastMessage}
          </p>
        )}
      </div>
      <UnreadBadge count={conv.myUnread} />
    </button>
  );
}

/* ─── Cyberpunk atmosphere background ───────────────────────── */

const BG_PARTICLES = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  left:  `${6 + (i * 31 + 17) % 88}%`,
  top:   `${(i * 47 + 23) % 100}%`,
  size:  1.2 + (i % 4) * 0.7,
  delay: `${(i * 0.37) % 4}s`,
  dur:   `${5 + (i % 6) * 1.3}s`,
  color: i % 3 === 0 ? "rgba(168,85,247,0.55)" : i % 3 === 1 ? "rgba(34,211,238,0.40)" : "rgba(255,255,255,0.28)",
}));

function CyberpunkBg() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      {/* Nebula glow layers */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 70% 55% at 15% 88%, rgba(168,85,247,0.050) 0%, transparent 62%)",
        animation: "nebulaFloat 14s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 55% 45% at 85% 18%, rgba(34,211,238,0.035) 0%, transparent 58%)",
        animation: "nebulaFloat 18s ease-in-out infinite reverse",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 38% 32% at 50% 48%, rgba(168,85,247,0.022) 0%, transparent 68%)",
      }} />
      {/* Subtle horizontal scanner line */}
      <div style={{
        position: "absolute", left: 0, right: 0, height: 1,
        background: "linear-gradient(90deg, transparent 0%, rgba(168,85,247,0.14) 25%, rgba(34,211,238,0.18) 50%, rgba(168,85,247,0.14) 75%, transparent 100%)",
        top: "38%",
        animation: "scanLineMove 10s linear infinite",
      }} />
      {/* Floating particles */}
      {BG_PARTICLES.map(p => (
        <div key={p.id} style={{
          position: "absolute",
          left: p.left, top: p.top,
          width: p.size, height: p.size,
          borderRadius: "50%",
          background: p.color,
          animation: `particleDrift ${p.dur} ${p.delay} ease-in-out infinite`,
          boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
        }} />
      ))}
    </div>
  );
}

/* ─── Left sidebar ───────────────────────────────────────────── */

const SIDEBAR_BG = "#18202e";

function Sidebar({ activeRoomId, groups, dms, unreadByRoom, connected, onlineUsers, onSelectRoom, onCreateGroup, onOpenDM, social, currentUserId }) {
  const [rightTab, setRightTab] = useState("online"); // "online" | "friends"

  const friendsOnline = useMemo(() => {
    const onlineSet = new Set(onlineUsers.map(u => u.userId));
    return social.friends.map(f => ({ ...f, online: onlineSet.has(f.userId) }));
  }, [social.friends, onlineUsers]);

  return (
    <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", background: SIDEBAR_BG, borderRight: "1px solid rgba(168,85,247,0.18)", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid rgba(168,85,247,0.15)", flexShrink: 0, background: "linear-gradient(90deg, rgba(168,85,247,0.05), rgba(34,211,238,0.02))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, #a855f7, #22d3ee)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
              boxShadow: "0 0 10px rgba(168,85,247,0.40), 0 0 20px rgba(168,85,247,0.15)",
              animation: "neonBreath 4s ease-in-out infinite",
            }}>💬</div>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>Community</span>
          </div>
          <div style={{ position: "relative" }}>
            {connected && (
              <span style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                background: "rgba(74,222,128,0.5)",
                animation: "onlinePing 2.5s ease-out infinite",
              }} />
            )}
            <span style={{
              position: "relative", display: "block",
              width: 7, height: 7, borderRadius: "50%",
              background: connected ? "#4ade80" : "rgba(255,255,255,0.2)",
              animation: connected ? "neonPulse 2.8s ease-in-out infinite" : "none",
            }} title={connected ? "Connected" : "Connecting…"} />
          </div>
        </div>
      </div>

      {/* Channels */}
      <div style={{ padding: "12px 10px 6px", flexShrink: 0 }}>
        <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.20em", color: "rgba(34,211,238,0.50)", padding: "0 6px 6px" }}>Channels</p>
        <SidebarItem
          icon={<span style={{ fontSize: 14 }}>🌐</span>}
          label="Global Chat"
          sub="Open to everyone"
          active={activeRoomId === "global"}
          unread={unreadByRoom["global"] || 0}
          onClick={() => onSelectRoom("global")}
        />
      </div>

      {/* Direct Messages */}
      <div style={{ padding: "4px 10px 6px", flexShrink: 0, borderTop: "1px solid rgba(168,85,247,0.10)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 6px 5px" }}>
          <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.20em", color: "rgba(34,211,238,0.50)", margin: 0 }}>Direct Messages</p>
          <button
            onClick={() => onOpenDM?.()}
            style={{ width: 18, height: 18, borderRadius: 5, background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.22)", color: "rgba(34,211,238,0.7)", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}
            title="New direct message"
          >+</button>
        </div>
        {dms.length === 0 ? (
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.18)", padding: "2px 6px 4px", margin: 0 }}>No messages yet</p>
        ) : (
          dms.map(dm => (
            <DMConvRow
              key={dm.id}
              conv={dm}
              active={activeRoomId === `dm:${dm.id}`}
              currentUserId={currentUserId}
              onClick={() => onSelectRoom(`dm:${dm.id}`)}
            />
          ))
        )}
      </div>

      {/* Groups */}
      <div style={{ padding: "4px 10px 6px", flexShrink: 0, borderTop: "1px solid rgba(168,85,247,0.10)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 6px 5px" }}>
          <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.20em", color: "rgba(168,85,247,0.60)", margin: 0 }}>Groups</p>
          <button onClick={onCreateGroup} style={{ width: 18, height: 18, borderRadius: 5, background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.25)", color: "rgba(168,85,247,0.8)", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }} title="New group">+</button>
        </div>
        {groups.length === 0 ? (
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.18)", padding: "2px 6px 4px", margin: 0 }}>No groups yet</p>
        ) : (
          groups.map(g => (
            <SidebarGroupItem
              key={g.id} group={g}
              active={activeRoomId === `group:${g.id}`}
              unread={unreadByRoom[`group:${g.id}`] || 0}
              onClick={() => onSelectRoom(`group:${g.id}`)}
            />
          ))
        )}
      </div>

      {/* Friends + Social */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", borderTop: "1px solid rgba(168,85,247,0.12)", marginTop: 4 }}>

        {/* Section header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 8px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.20em", color: "rgba(74,222,128,0.55)" }}>Friends</span>
            {social.friends.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.28)" }}>
                {social.friends.length}
              </span>
            )}
            {social.incomingRequests.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "rgba(251,191,36,0.14)", border: "1px solid rgba(251,191,36,0.28)", color: "#fbbf24" }}>
                {social.incomingRequests.length} new
              </span>
            )}
          </div>
          <button
            onClick={() => social._openAddFriend?.()}
            style={{
              padding: "3px 10px", borderRadius: 7, fontSize: 10.5, fontWeight: 600, cursor: "pointer",
              background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.18)", color: "rgba(34,211,238,0.7)",
              fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4, transition: "filter 0.12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.2)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
            title="Find friends"
          >
            <span style={{ fontSize: 13, lineHeight: 1, marginTop: -1 }}>+</span> Add
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px", scrollbarWidth: "none" }}>

          {/* Incoming requests */}
          {social.incomingRequests.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {social.incomingRequests.map(r => (
                <IncomingRequestRow
                  key={r.requestId}
                  request={r}
                  onAccept={() => social.acceptRequest(r.userId)}
                  onDecline={() => social.declineRequest(r.userId)}
                />
              ))}
            </div>
          )}

          {/* Friends list */}
          {friendsOnline.length === 0 && social.incomingRequests.length === 0 ? (
            <div style={{ padding: "12px 4px 6px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.2)" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
                Add friends to trade<br />and chat privately
              </p>
            </div>
          ) : (
            friendsOnline.map(f => (
              <FriendRow
                key={f.userId}
                friend={f}
                onRemove={() => social.removeFriend(f.userId)}
                onBlock={() => social.blockUser(f.userId, f.username, f.avatarUrl)}
                onMessage={() => onOpenDM?.(f.userId)}
              />
            ))
          )}

          {/* Blocked section */}
          {social.blocked.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 6px" }}>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(239,68,68,0.35)", whiteSpace: "nowrap" }}>
                  Blocked · {social.blocked.length}
                </span>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
              </div>
              {social.blocked.map(b => (
                <BlockedRow key={b.userId} user={b} onUnblock={() => social.unblockUser(b.userId)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, sub, active, unread, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "7px 8px", borderRadius: 10, textAlign: "left", cursor: "pointer",
        background: active
          ? "linear-gradient(90deg, rgba(34,211,238,0.09), rgba(34,211,238,0.04))"
          : hov ? "rgba(34,211,238,0.05)" : "transparent",
        borderTop: "none", borderRight: "none", borderBottom: "none",
        borderLeft: `3px solid ${active ? "#22d3ee" : hov ? "rgba(34,211,238,0.25)" : "transparent"}`,
        boxShadow: active ? "inset 0 0 32px rgba(34,211,238,0.06), 0 0 0 1px rgba(34,211,238,0.04)" : "none",
        transition: "all 0.18s", fontFamily: "inherit",
      }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: active ? "rgba(34,211,238,0.18)" : "rgba(255,255,255,0.06)",
        boxShadow: active ? "0 0 14px rgba(34,211,238,0.25), inset 0 0 8px rgba(34,211,238,0.10)" : "none",
        transition: "all 0.18s",
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: active ? 700 : unread ? 700 : 500, margin: 0,
          color: active ? "#fff" : unread ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.5)",
          textShadow: active ? "0 0 8px rgba(34,211,238,0.3)" : "none",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          transition: "all 0.18s",
        }}>{label}</p>
        <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.25)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</p>
      </div>
      <UnreadBadge count={unread} />
    </button>
  );
}

function SidebarGroupItem({ group, active, unread, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "7px 8px", borderRadius: 10, textAlign: "left", cursor: "pointer",
        background: active
          ? "linear-gradient(90deg, rgba(168,85,247,0.11), rgba(168,85,247,0.05))"
          : hov ? "rgba(168,85,247,0.06)" : "transparent",
        borderTop: "none", borderRight: "none", borderBottom: "none",
        borderLeft: `3px solid ${active ? "#a855f7" : hov ? "rgba(168,85,247,0.30)" : "transparent"}`,
        boxShadow: active ? "inset 0 0 32px rgba(168,85,247,0.08), 0 0 0 1px rgba(168,85,247,0.04)" : "none",
        transition: "all 0.18s", fontFamily: "inherit",
      }}
    >
      <GroupAvatar name={group.name} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: active ? 700 : unread ? 700 : 500, margin: 0,
          color: active ? "#fff" : unread ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.5)",
          textShadow: active ? "0 0 8px rgba(168,85,247,0.35)" : "none",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          transition: "all 0.18s",
        }}>{group.name}</p>
        <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.25)", margin: 0 }}>{group.members.length} members</p>
      </div>
      <UnreadBadge count={unread} />
    </button>
  );
}

function IncomingRequestRow({ request, onAccept, onDecline }) {
  const [busy, setBusy] = useState(false);

  async function doAccept() {
    setBusy(true);
    try { await onAccept(); } catch { } finally { setBusy(false); }
  }
  async function doDecline() {
    setBusy(true);
    try { await onDecline(); } catch { } finally { setBusy(false); }
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px 8px 12px", borderRadius: 10, marginBottom: 5,
      background: "rgba(251,191,36,0.05)",
      borderTop: "1px solid rgba(251,191,36,0.14)",
      borderRight: "1px solid rgba(251,191,36,0.14)",
      borderBottom: "1px solid rgba(251,191,36,0.14)",
      borderLeft: "3px solid rgba(251,191,36,0.45)",
      transition: "background 0.12s",
    }}>
      <Avatar src={request.avatarUrl} name={request.username} size={30} borderBg={SIDEBAR_BG} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.88)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {request.username}
        </span>
        <span style={{ fontSize: 10, color: "rgba(251,191,36,0.6)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(251,191,36,0.5)", display: "inline-block", flexShrink: 0 }} />
          Friend request
        </span>
      </div>
      <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
        <button
          onClick={doAccept} disabled={busy}
          style={{
            padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer",
            background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.28)", color: "#4ade80",
            fontFamily: "inherit", opacity: busy ? 0.4 : 1, transition: "filter 0.12s, opacity 0.12s",
          }}
          onMouseEnter={e => { if (!busy) e.currentTarget.style.filter = "brightness(1.18)"; }}
          onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
        >Accept</button>
        <button
          onClick={doDecline} disabled={busy}
          style={{
            width: 26, height: 26, borderRadius: 7, fontSize: 14, cursor: busy ? "default" : "pointer",
            background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.15)", color: "rgba(248,113,113,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "inherit", opacity: busy ? 0.4 : 1, lineHeight: 1,
          }}
          title="Decline"
        >×</button>
      </div>
    </div>
  );
}

function FriendRow({ friend, onRemove, onBlock, onMessage }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "6px 8px", borderRadius: 9,
        background: hov ? "rgba(255,255,255,0.04)" : "transparent",
        transition: "background 0.12s", cursor: "default",
      }}
    >
      <Avatar src={friend.avatarUrl} name={friend.username} size={28} online={friend.online} borderBg={SIDEBAR_BG} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.82)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {friend.username}
        </span>
        {!hov && (
          <span style={{ fontSize: 9.5, fontWeight: 500, color: friend.online ? "rgba(74,222,128,0.6)" : "rgba(255,255,255,0.2)" }}>
            {friend.online ? "Online" : "Offline"}
          </span>
        )}
      </div>
      {hov && (
        <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
          <button
            onClick={onMessage}
            title="Send direct message"
            style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)", color: "rgba(34,211,238,0.75)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "filter 0.12s" }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.2)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
          >{Ico.dm}</button>
          <button
            onClick={onRemove}
            title="Remove friend"
            style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.35)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "filter 0.12s" }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.25)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
          >{Ico.remove}</button>
          <button
            onClick={onBlock}
            title="Block user"
            style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.14)", color: "rgba(248,113,113,0.65)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "filter 0.12s" }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.2)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
          >{Ico.block}</button>
        </div>
      )}
    </div>
  );
}

function BlockedRow({ user, onUnblock }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "5px 8px", borderRadius: 8,
        background: hov ? "rgba(255,255,255,0.025)" : "transparent",
        transition: "background 0.12s",
      }}
    >
      {/* Avatar with blocked overlay */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <div style={{ opacity: 0.4 }}>
          <Avatar src={user.avatarUrl} name={user.username} size={28} borderBg={SIDEBAR_BG} />
        </div>
        <div style={{
          position: "absolute", inset: 0, borderRadius: Math.round(28 * 0.3),
          background: "rgba(239,68,68,0.12)", display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid rgba(239,68,68,0.2)",
        }}>
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="rgba(248,113,113,0.8)" strokeWidth={3} strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
      </div>
      <span style={{ flex: 1, fontSize: 12, color: "rgba(255,255,255,0.3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: "italic" }}>
        {user.username}
      </span>
      {hov && (
        <button
          onClick={onUnblock}
          style={{
            padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 500, cursor: "pointer",
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
            color: "rgba(255,255,255,0.45)", fontFamily: "inherit", whiteSpace: "nowrap",
            transition: "color 0.1s, border-color 0.1s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.7)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.45)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}
        >Unblock</button>
      )}
    </div>
  );
}

/* ─── Right panel ────────────────────────────────────────────── */

function RightPanel({ activeRoomId, onlineUsers, activeGroup, currentUser, onAddMember, onRemoveMember, onLeave, onDisband, onOpenDM, social }) {
  const isGroup = activeRoomId.startsWith("group:");
  const isOwner = activeGroup && currentUser && activeGroup.ownerId === currentUser.id;

  const members = isGroup ? (activeGroup?.members ?? []) : onlineUsers;
  const title   = isGroup ? `Members · ${members.length}` : `Online · ${members.length}`;

  return (
    <div style={{ width: 210, flexShrink: 0, display: "flex", flexDirection: "column", background: SIDEBAR_BG, borderLeft: "1px solid rgba(168,85,247,0.18)", overflow: "hidden" }}>
      <div style={{ padding: "14px 12px 10px", borderBottom: "1px solid rgba(168,85,247,0.15)", flexShrink: 0, background: "rgba(168,85,247,0.04)" }}>
        <p style={{
          fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.20em",
          color: "rgba(168,85,247,0.70)", margin: 0,
          textShadow: "0 0 10px rgba(168,85,247,0.35)",
        }}>{title}</p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", scrollbarWidth: "none" }}>
        {isGroup
          ? members.map(m => (
              <UserRow
                key={m.userId}
                user={{ userId: m.userId, username: m.username, avatarUrl: m.avatarUrl, displayName: m.username }}
                isMe={m.userId === currentUser?.id}
                isOwner={m.userId === activeGroup.ownerId}
                canKick={isOwner && m.userId !== currentUser?.id && m.userId !== activeGroup.ownerId}
                isFriend={social.isFriend(m.userId)}
                isBlocked={social.isBlocked(m.userId)}
                hasSentRequest={social.hasSentRequest?.(m.userId) ?? false}
                hasIncomingRequest={social.hasIncomingRequest?.(m.userId) ?? false}
                onKick={() => onRemoveMember(activeGroup.id, m.userId)}
                onSendRequest={() => social.sendRequest(m.userId)}
                onAcceptRequest={() => social.acceptRequest(m.userId)}
                onRemoveFriend={() => social.removeFriend(m.userId)}
                onBlock={() => social.blockUser(m.userId, m.username, m.avatarUrl)}
                onUnblock={() => social.unblockUser(m.userId)}
                onMessage={m.userId !== currentUser?.id ? () => onOpenDM?.(m.userId) : undefined}
              />
            ))
          : members.length === 0
          ? <p style={{ fontSize: 12, color: "rgba(255,255,255,0.22)", padding: "8px 4px", margin: 0 }}>No one online</p>
          : members.map(u => (
              <UserRow
                key={u.userId}
                user={{ ...u, online: true }}
                isMe={u.userId === currentUser?.id}
                isOwner={false}
                canKick={false}
                isFriend={social.isFriend(u.userId)}
                isBlocked={social.isBlocked(u.userId)}
                hasSentRequest={social.hasSentRequest?.(u.userId) ?? false}
                hasIncomingRequest={social.hasIncomingRequest?.(u.userId) ?? false}
                onKick={() => {}}
                onSendRequest={() => social.sendRequest(u.userId)}
                onAcceptRequest={() => social.acceptRequest(u.userId)}
                onRemoveFriend={() => social.removeFriend(u.userId)}
                onBlock={() => social.blockUser(u.userId, u.username, u.avatarUrl)}
                onUnblock={() => social.unblockUser(u.userId)}
                onMessage={u.userId !== currentUser?.id ? () => onOpenDM?.(u.userId) : undefined}
              />
            ))
        }
      </div>

      {isGroup && activeGroup && (
        <div style={{ padding: "10px 10px 12px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          {isOwner && (
            <button onClick={() => onAddMember(activeGroup.id)} style={{ width: "100%", padding: "8px 0", borderRadius: 9, background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.2)", fontSize: 12, fontWeight: 600, color: "rgba(168,85,247,0.85)", cursor: "pointer", fontFamily: "inherit" }}>+ Add Member</button>
          )}
          {isOwner
            ? <button onClick={() => onDisband(activeGroup.id)} style={{ width: "100%", padding: "7px 0", borderRadius: 9, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)", fontSize: 12, fontWeight: 600, color: "#f87171", cursor: "pointer", fontFamily: "inherit" }}>Delete Group</button>
            : <button onClick={() => onLeave(activeGroup.id)} style={{ width: "100%", padding: "7px 0", borderRadius: 9, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)", fontSize: 12, fontWeight: 600, color: "#f87171", cursor: "pointer", fontFamily: "inherit" }}>Leave Group</button>
          }
        </div>
      )}
    </div>
  );
}

/* ─── DM header three-dot menu ───────────────────────────────── */

function DMHeaderMenu({ otherUser, onClear, onHide, onBlock }) {
  const [open, setOpen]         = useState(false);
  const [confirming, setConf]   = useState(null); // { action, title, detail }
  const menuRef                 = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = e => { if (!menuRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function ask(action, title, detail) {
    setOpen(false);
    setConf({ action, title, detail });
  }

  async function confirm() {
    const { action } = confirming;
    setConf(null);
    if (action === "clear") onClear?.();
    if (action === "hide")  onHide?.();
    if (action === "block") onBlock?.();
  }

  const menuItems = [
    {
      action: "clear",
      label:  "Clear messages",
      detail: "Your message history will be cleared. The other person can still see their history.",
      icon:   <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>,
      danger: false,
    },
    {
      action: "hide",
      label:  "Delete conversation",
      detail: "This conversation will be removed from your sidebar. A new message will restore it.",
      icon:   <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>,
      danger: false,
    },
    { divider: true },
    {
      action: "block",
      label:  `Block ${otherUser?.username ? `@${otherUser.username}` : "user"}`,
      detail: `Neither you nor ${otherUser?.username || "this user"} will be able to send each other messages.`,
      icon:   <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
      danger: true,
    },
  ];

  return (
    <>
      <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: open ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "inherit", transition: "background 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
          onMouseLeave={e => { if (!open) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
          title="Conversation options"
        >
          <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5"  r="1.8"/>
            <circle cx="12" cy="12" r="1.8"/>
            <circle cx="12" cy="19" r="1.8"/>
          </svg>
        </button>

        {open && (
          <div style={{
            position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50,
            width: 220, borderRadius: 12, overflow: "hidden",
            background: "#1f2838", border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}>
            {menuItems.map((item, i) => item.divider ? (
              <div key={i} style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "3px 0" }} />
            ) : (
              <button
                key={item.action}
                onClick={() => ask(item.action, item.label, item.detail)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 14px", background: "transparent", border: "none",
                  cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  color: item.danger ? "#f87171" : "rgba(255,255,255,0.72)",
                  fontSize: 13, fontWeight: 500, transition: "background 0.1s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = item.danger ? "rgba(239,68,68,0.07)" : "rgba(255,255,255,0.05)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ color: item.danger ? "#f87171" : "rgba(255,255,255,0.4)", flexShrink: 0 }}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          message={confirming.title}
          detail={confirming.detail}
          onConfirm={confirm}
          onCancel={() => setConf(null)}
        />
      )}
    </>
  );
}

/* ─── Chat area ──────────────────────────────────────────────── */

function ChatArea({ activeRoomId, activeGroup, activeDM, visibleMessages, typingUsers, onlineUsers, loading, error, connected, currentUser, sendMessage, startTyping, stopTyping, onToggleSidebar, onToggleMembers, onClearDMHistory, onHideDM, onBlockDMUser }) {
  const [input, setInput]     = useState("");
  const bottomRef             = useRef(null);
  const scrollRef             = useRef(null);
  const inputRef              = useRef(null);
  const nearBottom            = useRef(true);

  const isGroup  = activeRoomId.startsWith("group:");
  const isDM     = activeRoomId.startsWith("dm:");
  const roomName = isDM    ? (activeDM?.otherUser?.username || "Direct Message")
                 : isGroup ? (activeGroup?.name || "Group")
                 :           "Global Chat";
  const roomSub  = isDM    ? "Direct message"
                 : isGroup ? `${activeGroup?.members?.length ?? 0} members`
                 :           `${onlineUsers.length} online`;

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const lastId = visibleMessages[visibleMessages.length - 1]?.id;
  useEffect(() => {
    if (nearBottom.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
    nearBottom.current = true;
  }, [activeRoomId]);

  /* Group consecutive messages from the same sender */
  const grouped = useMemo(() => visibleMessages.reduce((acc, msg, i) => {
    const prev = visibleMessages[i - 1];
    const sameDay    = prev && fmtDate(prev.createdAt) === fmtDate(msg.createdAt);
    const sameSender = prev && prev.senderId === msg.senderId && prev.type !== "system" && msg.type !== "system" && sameDay;
    const timeDiff   = prev ? (new Date(msg.createdAt) - new Date(prev.createdAt)) / 60_000 : Infinity;
    acc.push({ msg, grouped: sameSender && timeDiff < 5, showDate: !sameDay || i === 0 });
    return acc;
  }, []), [visibleMessages]);

  const handleSend = useCallback(() => {
    const t = input.trim();
    if (!t || !connected) return;
    sendMessage(t);
    setInput("");
    nearBottom.current = true;
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    inputRef.current?.focus();
  }, [input, connected, sendMessage]);

  const handleKey = useCallback(e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "#1a2133", position: "relative", zIndex: 1 }}>

      {/* Channel header */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "0 18px", height: 56, borderBottom: "1px solid rgba(168,85,247,0.18)", background: "linear-gradient(90deg, rgba(168,85,247,0.04) 0%, rgba(34,211,238,0.02) 50%, rgba(168,85,247,0.03) 100%)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <button onClick={onToggleSidebar} className="md:hidden" style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>
          <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: isGroup ? "rgba(168,85,247,0.14)" : "rgba(34,211,238,0.12)", border: `1px solid ${isGroup ? "rgba(168,85,247,0.2)" : "rgba(34,211,238,0.18)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, overflow: "hidden" }}>
          {isDM && activeDM?.otherUser
            ? <img src={activeDM.otherUser.avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${activeDM.otherUser.username}`} alt="" loading="lazy" style={{ width: 32, height: 32, objectFit: "cover" }} onError={e => { e.currentTarget.style.display = "none"; }} />
            : isGroup ? "👥" : "🌐"}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.92)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{roomName}</h3>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.32)", margin: 0 }}>{roomSub}</p>
        </div>
        {/* DM three-dot menu */}
        {isDM && activeDM && (
          <DMHeaderMenu
            otherUser={activeDM.otherUser}
            onClear={onClearDMHistory}
            onHide={onHideDM}
            onBlock={onBlockDMUser}
          />
        )}
        <button onClick={onToggleMembers} className="md:hidden" style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>
          <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" /></svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingTop: 8, scrollbarWidth: "thin", scrollbarColor: "rgba(168,85,247,0.18) transparent", background: "radial-gradient(ellipse 60% 38% at 78% 22%, rgba(168,85,247,0.055) 0%, transparent 62%), radial-gradient(ellipse 50% 32% at 22% 78%, rgba(34,211,238,0.038) 0%, transparent 62%)" }}>
        {loading ? (
          <MessageSkeleton />
        ) : grouped.length === 0 ? (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 32, textAlign: "center", position: "relative" }}>
            {/* Holographic SKINTEL watermark */}
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none", overflow: "hidden",
            }}>
              <span style={{
                fontSize: 120, fontWeight: 900, letterSpacing: "-0.04em",
                color: "rgba(168,85,247,0.035)",
                animation: "holoBlink 6s ease-in-out infinite",
                userSelect: "none",
                backgroundImage: "linear-gradient(135deg, rgba(168,85,247,0.06), rgba(34,211,238,0.04))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}>SKINTEL</span>
            </div>

            {/* Scanner rings around avatar */}
            <div style={{ position: "relative", marginBottom: 4 }}>
              {[0, 0.9, 1.8].map((delay, i) => (
                <div key={i} style={{
                  position: "absolute", top: "50%", left: "50%",
                  width: 140 + i * 30, height: 140 + i * 30,
                  borderRadius: "50%",
                  border: `1px solid rgba(168,85,247,${0.40 - i * 0.11})`,
                  animation: `scanRing 3s ease-out ${delay}s infinite`,
                  pointerEvents: "none",
                }} />
              ))}
              {/* Outer decorative ring */}
              <div style={{
                position: "absolute", top: "50%", left: "50%",
                width: 220, height: 220,
                borderRadius: "50%",
                border: "1px solid rgba(34,211,238,0.08)",
                transform: "translate(-50%,-50%)",
                animation: "neonBreath 5s ease-in-out infinite",
                pointerEvents: "none",
              }} />
              <div style={{
                width: 80, height: 80, borderRadius: 24, position: "relative", zIndex: 1,
                background: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(109,40,217,0.16))",
                border: "1px solid rgba(168,85,247,0.38)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 32, overflow: "hidden",
                boxShadow: "0 0 30px rgba(168,85,247,0.30), 0 0 70px rgba(168,85,247,0.12), inset 0 1px 0 rgba(255,255,255,0.08)",
              }}>
                {isDM && activeDM?.otherUser
                  ? <img src={activeDM.otherUser.avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${activeDM.otherUser.username}`} alt="" loading="lazy" style={{ width: 80, height: 80, objectFit: "cover" }} />
                  : isGroup ? "👥" : "🌐"}
              </div>
            </div>

            <div style={{ position: "relative" }}>
              <p style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", color: "rgba(255,255,255,0.60)", margin: "0 0 8px" }}>{roomName}</p>
              <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.22)", margin: 0, lineHeight: 1.7 }}>
                {isDM
                  ? "Encrypted channel open. Send a message to connect."
                  : isGroup
                  ? "Private group initialized. Start the conversation."
                  : "Global trading network · Open to all traders"}
              </p>
            </div>

            {/* Live status chip */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 14px", borderRadius: 8, background: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.22)", backdropFilter: "blur(8px)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#a855f7", boxShadow: "0 0 8px rgba(168,85,247,0.9)", animation: "purplePulse 2.5s ease-in-out infinite" }} />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(168,85,247,0.80)" }}>
                {isDM ? "Secure channel" : isGroup ? "Private group" : "Live network"}
              </span>
            </div>
          </div>
        ) : (
          grouped.map(({ msg, grouped: g, showDate }, i) => (
            <div key={msg.id ?? i}>
              {showDate && <DateDivider label={fmtDate(msg.createdAt)} />}
              {msg.type === "system"
                ? <SystemMsg text={msg.text} />
                : msg.type === "auction_share" || msg.type === "market_item"
                ? <AuctionMsg msg={msg} isMine={msg.senderId === currentUser?.id} grouped={g} />
                : (
                  <div style={{ marginTop: g ? 0 : 12 }}>
                    <Message msg={msg} isMine={msg.senderId === currentUser?.id} showAvatar={!g} showName={!g} />
                  </div>
                )
              }
            </div>
          ))
        )}
        <TypingBubble users={typingUsers} />
        <div ref={bottomRef} />
      </div>

      {/* Error bar — auto-dismissed by useChat after 5 s */}
      {error && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 18px", background: "rgba(239,68,68,0.07)", borderTop: "1px solid rgba(239,68,68,0.12)" }}>
          <span style={{ fontSize: 12, color: "#fca5a5" }}>{error}</span>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="rgba(248,113,113,0.5)" strokeWidth={2.5} strokeLinecap="round" style={{ flexShrink: 0 }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </div>
      )}

      {/* Input area */}
      <div style={{ flexShrink: 0, padding: "12px 16px 16px", borderTop: "1px solid rgba(168,85,247,0.18)", background: "rgba(24,32,46,0.85)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {currentUser && (
            <Avatar src={currentUser.avatarUrl} name={currentUser.displayName || currentUser.username} size={32} borderBg="#1a2133" />
          )}
          <div
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 10,
              padding: "9px 14px", borderRadius: 13,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(168,85,247,0.22)",
              transition: "border-color 0.20s, background 0.20s, box-shadow 0.20s",
              cursor: "text",
            }}
            onClick={() => inputRef.current?.focus()}
            onFocus={() => {}}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); startTyping(); }}
              onKeyDown={handleKey}
              onBlur={stopTyping}
              onFocus={e => { const p = e.target.closest("div"); if (p) { p.style.borderColor = "rgba(168,85,247,0.55)"; p.style.background = "rgba(168,85,247,0.07)"; p.style.boxShadow = "0 0 0 3px rgba(168,85,247,0.12), 0 0 14px rgba(168,85,247,0.10)"; } }}
              onBlurCapture={e => { const p = e.target.closest("div"); if (p) { p.style.borderColor = "rgba(168,85,247,0.22)"; p.style.background = "rgba(255,255,255,0.04)"; p.style.boxShadow = "none"; } }}
              placeholder={connected
                ? isDM    ? `Message ${roomName}…`
                : isGroup ? `Message #${roomName}…`
                :           "Message Global Chat…"
                : "Connecting…"}
              disabled={!connected}
              maxLength={2000}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 13.5, color: "rgba(255,255,255,0.88)", fontFamily: "inherit" }}
            />
            {input.length > 1800 && (
              <span style={{ fontSize: 10, color: input.length > 1950 ? "#f87171" : "rgba(255,255,255,0.2)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{input.length}</span>
            )}
          </div>

          <button
            onClick={handleSend}
            disabled={!input.trim() || !connected}
            style={{
              width: 38, height: 38, flexShrink: 0, borderRadius: 11,
              background: "linear-gradient(135deg,#22d3ee,#a855f7)",
              border: "none", cursor: (!input.trim() || !connected) ? "not-allowed" : "pointer",
              opacity: (!input.trim() || !connected) ? 0.3 : 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "opacity 0.15s, transform 0.15s",
              fontFamily: "inherit",
            }}
            onMouseEnter={e => { if (input.trim() && connected) e.currentTarget.style.transform = "scale(1.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Mobile overlay ─────────────────────────────────────────── */

function MobileOverlay({ side, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div style={{
        position: "absolute", top: 0, bottom: 0, width: 260,
        [side === "left" ? "left" : "right"]: 0,
        background: SIDEBAR_BG,
        boxShadow: side === "left" ? "4px 0 24px rgba(0,0,0,0.5)" : "-4px 0 24px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column",
      }}>
        {children}
      </div>
    </div>
  );
}

/* ─── New DM modal ───────────────────────────────────────────── */

function NewDMModal({ onClose, onOpen, searchFn }) {
  const [q, setQ]               = useState("");
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening]   = useState(null);
  const [err, setErr]           = useState("");

  async function search(v) {
    setQ(v);
    setErr("");
    if (v.length < 2) { setResults([]); return; }
    setSearching(true);
    try { setResults(await searchFn(v)); }
    catch { setResults([]); }
    finally { setSearching(false); }
  }

  async function open(userId) {
    setOpening(userId);
    setErr("");
    const result = await onOpen(userId);
    if (result && !result.error) {
      onClose();
    } else {
      setErr(result?.error || "Could not open conversation.");
      setOpening(null);
    }
  }

  return (
    <Modal onClose={onClose} title="New Message" subtitle="Search any user to start a private conversation.">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <StyledInput value={q} onChange={e => search(e.target.value)} placeholder="Search username…" autoFocus />

        {searching && (
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
            <div style={{ display: "flex", gap: 5 }}>
              {[0, 120, 240].map(d => (
                <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.25)", animation: "typingDot 1.2s ease-in-out infinite", animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}

        {err && <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{err}</p>}

        {!searching && results.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 300, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
            {results.map(u => (
              <div
                key={u.userId}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", transition: "border-color 0.12s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.11)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
              >
                <Avatar src={u.avatarUrl} name={u.username} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,0.88)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.username}</p>
                  {u.isBlocked && <p style={{ fontSize: 10.5, color: "rgba(248,113,113,0.5)", margin: 0 }}>Blocked</p>}
                </div>
                {!u.isBlocked && (
                  <button
                    onClick={() => open(u.userId)}
                    disabled={opening === u.userId}
                    style={{ padding: "6px 14px", borderRadius: 8, background: "linear-gradient(135deg,#22d3ee,#a855f7)", border: "none", fontSize: 12, fontWeight: 700, color: "#fff", cursor: opening === u.userId ? "default" : "pointer", fontFamily: "inherit", opacity: opening === u.userId ? 0.5 : 1, transition: "filter 0.1s" }}
                    onMouseEnter={e => { if (opening !== u.userId) e.currentTarget.style.filter = "brightness(1.12)"; }}
                    onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
                  >{opening === u.userId ? "…" : "Message"}</button>
                )}
              </div>
            ))}
          </div>
        )}

        {!searching && q.length >= 2 && results.length === 0 && (
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", textAlign: "center", margin: 0, padding: "8px 0" }}>No users found for "{q}"</p>
        )}
      </div>
    </Modal>
  );
}

/* ─── Root ChatShell ─────────────────────────────────────────── */

export default function ChatShell({
  activeRoomId, messages, onlineUsers, typingUsers,
  groups, activeGroup,
  dms, activeDM, openDM,
  hideDM, clearDMHistory,
  unreadByRoom,
  loading, error, connected, currentUser,
  selectRoom, sendMessage, startTyping, stopTyping,
  createGroup, addMember, removeMember, leaveGroup, disbandGroup,
  social = {},
}) {
  const [showCreate,    setShowCreate]    = useState(false);
  const [addMemberGid,  setAddMemberGid]  = useState(null);
  const [mobileSide,    setMobileSide]    = useState(false);
  const [mobileRight,   setMobileRight]   = useState(false);
  const [confirm,       setConfirm]       = useState(null);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showNewDM,     setShowNewDM]     = useState(false);

  const socialWithOpen = useMemo(() => ({
    ...social,
    _openAddFriend: () => setShowAddFriend(true),
  }), [social]);

  /* Block-aware message filtering */
  const visibleMessages = useMemo(() => {
    const bl = social.allBlockedIds;
    if (!bl?.size) return messages;
    return messages.filter(m => m.type === "system" || !bl.has(String(m.senderId)));
  }, [messages, social.allBlockedIds]);

  /* Block-aware online users */
  const visibleOnlineUsers = useMemo(() => {
    const bl = social.allBlockedIds;
    if (!bl?.size) return onlineUsers;
    return onlineUsers.filter(u => !bl.has(String(u.userId)));
  }, [onlineUsers, social.allBlockedIds]);

  /* Block-aware DMs — hide conversations with blocked users */
  const visibleDMs = useMemo(() => {
    const bl = social.allBlockedIds;
    if (!bl?.size) return dms || [];
    return (dms || []).filter(dm => !bl.has(dm.otherUser?.userId));
  }, [dms, social.allBlockedIds]);

  const isDM = activeRoomId.startsWith("dm:");

  /* Open DM by userId — used from sidebar, right panel, friend list */
  const [dmErr, setDmErr] = useState("");

  const handleOpenDM = useCallback(async (userId) => {
    if (!userId) { setShowNewDM(true); return; }
    if (!openDM) return;
    setMobileSide(false);
    setMobileRight(false);
    const result = await openDM(userId);
    if (result?.error) {
      setDmErr(result.error);
      setTimeout(() => setDmErr(""), 4000);
    }
  }, [openDM]);

  /* DM action callbacks — passed to ChatArea → DMHeaderMenu */
  const handleClearDMHistory = useCallback(async () => {
    const convId = activeRoomId.replace("dm:", "");
    if (clearDMHistory) {
      const result = await clearDMHistory(convId);
      if (result?.error) { setDmErr(result.error); setTimeout(() => setDmErr(""), 4000); }
    }
  }, [activeRoomId, clearDMHistory]);

  const handleHideDM = useCallback(async () => {
    const convId = activeRoomId.replace("dm:", "");
    if (hideDM) {
      const result = await hideDM(convId);
      if (result?.error) { setDmErr(result.error); setTimeout(() => setDmErr(""), 4000); }
    }
  }, [activeRoomId, hideDM]);

  const handleBlockDMUser = useCallback(async () => {
    if (!activeDM?.otherUser) return;
    const { userId, username, avatarUrl } = activeDM.otherUser;
    await social.blockUser?.(userId, username, avatarUrl);
    // The DM will disappear from visibleDMs automatically via allBlockedIds filter
  }, [activeDM, social]);

  const showConfirm = useCallback((message, detail) =>
    new Promise(resolve => setConfirm({ message, detail, resolve })), []);

  const onYes = useCallback(() => { confirm?.resolve(true);  setConfirm(null); }, [confirm]);
  const onNo  = useCallback(() => { confirm?.resolve(false); setConfirm(null); }, [confirm]);

  const handleRemoveMember = useCallback(async (gid, uid) => {
    if (await showConfirm("Remove this member?", "They'll lose access to the group."))
      try { await removeMember(gid, uid); } catch {}
  }, [showConfirm, removeMember]);

  const handleLeave = useCallback(async (gid) => {
    if (await showConfirm("Leave this group?", "You'll need to be re-invited to rejoin."))
      try { await leaveGroup(gid); } catch {}
  }, [showConfirm, leaveGroup]);

  const handleDisband = useCallback(async (gid) => {
    if (await showConfirm("Delete this group?", "All messages will be permanently deleted."))
      try { await disbandGroup(gid); } catch {}
  }, [showConfirm, disbandGroup]);

  const handleSelectRoom = useCallback((roomId) => {
    selectRoom(roomId);
    setMobileSide(false);
    setMobileRight(false);
  }, [selectRoom]);

  const sidebarProps = {
    activeRoomId, groups, unreadByRoom, connected,
    onlineUsers: visibleOnlineUsers,
    dms: visibleDMs,
    onSelectRoom: handleSelectRoom,
    onCreateGroup: () => setShowCreate(true),
    onOpenDM: (userId) => handleOpenDM(userId),
    social: socialWithOpen,
    currentUserId: currentUser?.id,
  };

  const rightPanelProps = {
    activeRoomId, activeGroup, currentUser,
    onlineUsers: visibleOnlineUsers,
    onAddMember: gid => setAddMemberGid(gid),
    onRemoveMember: handleRemoveMember,
    onLeave: handleLeave,
    onDisband: handleDisband,
    onOpenDM: handleOpenDM,
    social: socialWithOpen,
  };

  return (
    <div style={{ display: "flex", overflow: "hidden", height: "calc(100vh - 64px)", background: SIDEBAR_BG, position: "relative" }}>
      <style>{`
        @keyframes typingDot    { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
        @keyframes neonPulse    { 0%,100%{box-shadow:0 0 4px rgba(74,222,128,0.55)} 50%{box-shadow:0 0 14px rgba(74,222,128,1),0 0 24px rgba(74,222,128,0.3)} }
        @keyframes scanRing     { 0%{transform:translate(-50%,-50%) scale(0.4);opacity:0.8} 100%{transform:translate(-50%,-50%) scale(2.5);opacity:0} }
        @keyframes msgIn        { from{opacity:0;transform:translateY(6px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes glowBlink    { 0%,100%{opacity:0.7} 50%{opacity:1} }
        @keyframes streakPass   { 0%{opacity:0;transform:translateX(-60px)} 20%{opacity:1} 80%{opacity:0.7} 100%{opacity:0;transform:translateX(60px)} }
        @keyframes onlinePing   { 0%{transform:scale(1);opacity:0.75} 100%{transform:scale(2.5);opacity:0} }
        @keyframes nebulaFloat  { 0%,100%{opacity:0.55;transform:scale(1) translateX(0)} 50%{opacity:0.78;transform:scale(1.04) translateX(8px)} }
        @keyframes particleDrift{ 0%{transform:translateY(0) translateX(0);opacity:0} 12%{opacity:0.75} 85%{opacity:0.4} 100%{transform:translateY(-95px) translateX(20px);opacity:0} }
        @keyframes scanLineMove { 0%{transform:translateY(0);opacity:0.45} 100%{transform:translateY(-80px);opacity:0} }
        @keyframes holoBlink    { 0%,100%{opacity:0.04} 50%{opacity:0.09} }
        @keyframes neonBreath   { 0%,100%{box-shadow:0 0 8px rgba(168,85,247,0.18),0 0 20px rgba(168,85,247,0.07)} 50%{box-shadow:0 0 18px rgba(168,85,247,0.40),0 0 38px rgba(168,85,247,0.16)} }
        @keyframes purplePulse  { 0%,100%{box-shadow:0 0 4px rgba(168,85,247,0.4)} 50%{box-shadow:0 0 12px rgba(168,85,247,0.9),0 0 20px rgba(168,85,247,0.3)} }
      `}</style>

      {/* Cyberpunk ambient background */}
      <CyberpunkBg />

      {/* DM error toast */}
      {dmErr && (
        <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 80, padding: "8px 16px", borderRadius: 10, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.22)", fontSize: 12.5, color: "#fca5a5", fontWeight: 500, pointerEvents: "none", whiteSpace: "nowrap" }}>
          {dmErr}
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:flex" style={{ position: "relative", zIndex: 1 }}>
        <Sidebar {...sidebarProps} />
      </div>

      {/* Chat area */}
      <ChatArea
        activeRoomId={activeRoomId}
        activeGroup={activeGroup}
        activeDM={activeDM}
        visibleMessages={visibleMessages}
        typingUsers={typingUsers}
        onlineUsers={visibleOnlineUsers}
        loading={loading}
        error={error}
        connected={connected}
        currentUser={currentUser}
        sendMessage={sendMessage}
        startTyping={startTyping}
        stopTyping={stopTyping}
        onToggleSidebar={() => setMobileSide(v => !v)}
        onToggleMembers={() => setMobileRight(v => !v)}
        onClearDMHistory={handleClearDMHistory}
        onHideDM={handleHideDM}
        onBlockDMUser={handleBlockDMUser}
      />

      {/* Desktop right panel — hidden for DMs */}
      {!isDM && (
        <div className="hidden md:flex" style={{ position: "relative", zIndex: 1 }}>
          <RightPanel {...rightPanelProps} />
        </div>
      )}

      {/* Mobile overlays */}
      {mobileSide && (
        <MobileOverlay side="left" onClose={() => setMobileSide(false)}>
          <Sidebar {...sidebarProps} onCreateGroup={() => { setShowCreate(true); setMobileSide(false); }} />
        </MobileOverlay>
      )}
      {mobileRight && (
        <MobileOverlay side="right" onClose={() => setMobileRight(false)}>
          <RightPanel {...rightPanelProps} onAddMember={gid => { setAddMemberGid(gid); setMobileRight(false); }} />
        </MobileOverlay>
      )}

      {/* Modals */}
      {showCreate      && <CreateGroupModal onClose={() => setShowCreate(false)} onCreate={createGroup} />}
      {addMemberGid    && <AddMemberModal   groupId={addMemberGid} onClose={() => setAddMemberGid(null)} onAdd={addMember} />}
      {showAddFriend   && <AddFriendModal   onClose={() => setShowAddFriend(false)} onSend={social.sendRequest} onAccept={social.acceptRequest} onDecline={social.declineRequest} searchFn={social.searchUsers} />}
      {showNewDM       && <NewDMModal       onClose={() => setShowNewDM(false)} onOpen={handleOpenDM} searchFn={social.searchUsers} />}
      {confirm         && <ConfirmDialog    message={confirm.message} detail={confirm.detail} onConfirm={onYes} onCancel={onNo} />}
    </div>
  );
}
