import { memo, useEffect, useRef, useState } from "react";
import { useChatContext } from "../../context/ChatContext";
import { useChatPanel } from "../../context/ChatPanelContext";
import AuctionShareMessage from "./AuctionShareMessage";

const RAIL_W  = 48;
const PANEL_W = 232; // extra panel beside the rail
const FULL_W  = RAIL_W + PANEL_W; // 280 total when expanded

/* ─── Helpers ───────────────────────────────────────────── */
function groupColor(name) {
  const PAIRS = [
    ["#7c3aed", "#6d28d9"], ["#0891b2", "#0e7490"],
    ["#db2777", "#be185d"], ["#059669", "#047857"],
    ["#d97706", "#b45309"],
  ];
  return PAIRS[(name || "?").charCodeAt(0) % PAIRS.length];
}

/* ─── Group initial avatar ──────────────────────────────── */
function GroupAvatar({ name, size = 26 }) {
  const [from, to] = groupColor(name);
  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      borderRadius: Math.round(size * 0.3),
      background: `linear-gradient(135deg,${from},${to})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: Math.round(size * 0.42), fontWeight: 900, color: "#fff",
    }}>
      {(name?.[0] ?? "?").toUpperCase()}
    </div>
  );
}

/* ─── Unread dot / badge ────────────────────────────────── */
function Badge({ count }) {
  if (!count) return null;
  return (
    <span style={{
      position: "absolute", top: 0, right: 0,
      minWidth: 15, height: 15, borderRadius: 8,
      background: "#22d3ee", color: "#000",
      fontSize: 8, fontWeight: 900, lineHeight: 1,
      display: "flex", alignItems: "center", justifyContent: "center",
      paddingInline: 2, boxShadow: "0 0 5px rgba(34,211,238,0.4)",
    }}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/* ─── Rail icon button ──────────────────────────────────── */
function RailBtn({ onClick, active, unread = 0, title, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: "relative",
        width: 34, height: 34, flexShrink: 0,
        borderRadius: 10, border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: active
          ? "rgba(34,211,238,0.14)"
          : hov ? "rgba(255,255,255,0.07)" : "transparent",
        outline: active ? "1px solid rgba(34,211,238,0.3)" : "none",
        transition: "background 0.15s",
      }}
    >
      {children}
      <Badge count={unread} />
    </button>
  );
}

/* ─── Room row in expanded list ─────────────────────────── */
const RoomRow = memo(function RoomRow({ icon, label, sub, active, unread, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 8,
        padding: "7px 10px", borderRadius: 10, textAlign: "left",
        background: active ? "rgba(34,211,238,0.08)" : hov ? "rgba(255,255,255,0.04)" : "transparent",
        borderLeft: `2px solid ${active ? "rgba(34,211,238,0.7)" : "transparent"}`,
        border: "none", cursor: "pointer",
        transition: "background 0.13s",
      }}
    >
      <div style={{ flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{
          fontSize: 12, fontWeight: 700, margin: 0,
          color: active ? "#fff" : "rgba(255,255,255,0.55)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{label}</p>
        {sub && (
          <p style={{
            fontSize: 10, margin: 0,
            color: "rgba(255,255,255,0.25)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{sub}</p>
        )}
      </div>
      {unread > 0 && !active && (
        <span style={{
          height: 16, minWidth: 16, borderRadius: 8, paddingInline: 3,
          background: "#22d3ee", color: "#000", fontSize: 9, fontWeight: 900,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 4px rgba(34,211,238,0.35)", flexShrink: 0,
        }}>
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
});

/* ─── Expanded room list ────────────────────────────────── */
function RoomListView({ activeRoomId, groups, onlineUsers, unreadByRoom, onOpen }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "6px 6px 12px" }}>
      <SectionLabel>General</SectionLabel>
      <RoomRow
        icon={
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: "rgba(34,211,238,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15,
          }}>🌐</div>
        }
        label="Global Chat"
        sub={`${onlineUsers.length} online`}
        active={activeRoomId === "global"}
        unread={unreadByRoom["global"] || 0}
        onClick={() => onOpen("global")}
      />

      {groups.length > 0 && (
        <>
          <SectionLabel style={{ marginTop: 10 }}>Groups</SectionLabel>
          {groups.map(g => (
            <RoomRow
              key={g.id}
              icon={<GroupAvatar name={g.name} size={30} />}
              label={g.name}
              sub={`${g.members?.length ?? 0} members`}
              active={activeRoomId === `group:${g.id}`}
              unread={unreadByRoom[`group:${g.id}`] || 0}
              onClick={() => onOpen(`group:${g.id}`)}
            />
          ))}
        </>
      )}

      {groups.length === 0 && (
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.18)", textAlign: "center", padding: "16px 8px" }}>
          No groups yet
        </p>
      )}
    </div>
  );
}

function SectionLabel({ children, style: extra }) {
  return (
    <p style={{
      fontSize: 9, fontWeight: 900, textTransform: "uppercase",
      letterSpacing: "0.2em", color: "rgba(255,255,255,0.2)",
      padding: "6px 10px 3px", margin: 0, ...extra,
    }}>{children}</p>
  );
}

/* ─── Mini message bubble ───────────────────────────────── */
const MiniMsg = memo(function MiniMsg({ msg, isMine }) {
  if (msg.type === "auction_share" || msg.type === "market_item") {
    return <AuctionShareMessage msg={msg} isMine={isMine} compact />;
  }

  return (
    <div style={{ display: "flex", flexDirection: isMine ? "row-reverse" : "row" }}>
      <div style={{
        maxWidth: "85%", padding: "6px 11px",
        borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        fontSize: 12, lineHeight: 1.45, wordBreak: "break-word",
        ...(isMine
          ? { background: "rgba(34,211,238,0.14)", border: "1px solid rgba(34,211,238,0.2)", color: "#fff" }
          : { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)" }),
      }}>
        {!isMine && msg.senderName && (
          <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", margin: "0 0 2px" }}>
            {msg.senderName}
          </p>
        )}
        {msg.text}
      </div>
    </div>
  );
});

/* ─── Mini chat view ────────────────────────────────────── */
function MiniChatView({ activeRoomId, groups, currentUser, messages, typingUsers, sendMessage, startTyping, stopTyping, onBack }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastId]);

  function handleSend() {
    const t = input.trim();
    if (!t) return;
    sendMessage(t);
    setInput("");
    inputRef.current?.focus();
  }

  const isGroup = activeRoomId?.startsWith("group:");
  const activeGroup = isGroup ? groups.find(g => `group:${g.id}` === activeRoomId) : null;
  const roomLabel = isGroup ? (activeGroup?.name ?? "Group") : "Global Chat";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Mini header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 10px", flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <button
          onClick={onBack}
          style={{
            width: 22, height: 22, borderRadius: 6, border: "none",
            background: "transparent", cursor: "pointer",
            color: "rgba(255,255,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <svg width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={{
          fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.6)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
        }}>
          {roomLabel}
        </span>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", minHeight: 0,
        padding: "8px 10px", display: "flex", flexDirection: "column", gap: 5,
      }}>
        {messages.filter(m => m.type !== "system").slice(-40).map((msg, i) => (
          <MiniMsg key={msg.id ?? i} msg={msg} isMine={msg.senderId === currentUser?.id} />
        ))}

        {typingUsers.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {[0, 120, 240].map(d => (
              <span key={d} style={{
                width: 4, height: 4, borderRadius: "50%",
                background: "rgba(255,255,255,0.3)",
                display: "inline-block",
                animation: `bounce 1s ${d}ms infinite`,
              }} />
            ))}
            <span style={{ fontSize: 10, fontStyle: "italic", color: "rgba(255,255,255,0.25)" }}>
              {typingUsers[0]?.username} typing…
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "7px 8px", borderTop: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 5 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); startTyping(); }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            onBlur={stopTyping}
            placeholder="Message…"
            maxLength={500}
            style={{
              flex: 1, minWidth: 0, fontSize: 12, color: "#fff",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 9, padding: "7px 10px", outline: "none",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            style={{
              width: 30, height: 30, flexShrink: 0, border: "none", borderRadius: 9,
              background: "linear-gradient(135deg,#22d3ee,#a855f7)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", opacity: input.trim() ? 1 : 0.3,
              transition: "opacity 0.13s",
            }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Chat icon SVG ─────────────────────────────────────── */
function ChatIcon({ active }) {
  return (
    <svg width={18} height={18} fill="none" viewBox="0 0 24 24"
      stroke={active ? "#22d3ee" : "rgba(255,255,255,0.4)"} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

/* ─── Main GlobalChatDock ───────────────────────────────── */
export default function GlobalChatDock() {
  const { open, toggle } = useChatPanel();
  const ctx = useChatContext();
  const {
    groups = [], unreadByRoom = {}, activeRoomId = "global",
    messages = [], typingUsers = [], onlineUsers = [],
    connected = false, currentUser = null,
    selectRoom, sendMessage, startTyping, stopTyping,
  } = ctx ?? {};

  const [view, setView] = useState("list");

  function openRoom(roomId) {
    selectRoom?.(roomId);
    setView("chat");
    if (!open) toggle();
  }

  const totalUnread = Object.values(unreadByRoom).reduce((s, n) => s + (n || 0), 0);

  return (
    <div
      className="global-chat-dock"
      style={{
        width: open ? FULL_W : RAIL_W,
        minWidth: open ? FULL_W : RAIL_W,
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        overflow: "hidden",
        background: "#1a2133",
        borderRight: "1px solid rgba(255,255,255,0.09)",
        transition: "width 0.25s cubic-bezier(0.4,0,0.2,1), min-width 0.25s cubic-bezier(0.4,0,0.2,1)",
        position: "sticky",
        top: 0,
        height: "100vh",
        zIndex: 20,
        alignSelf: "flex-start",
      }}
    >
      {/* ── Icon rail (always 48px) ── */}
      <div style={{
        width: RAIL_W, minWidth: RAIL_W, flexShrink: 0,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 10, paddingBottom: 12, gap: 3,
      }}>
        {/* Toggle */}
        <RailBtn onClick={toggle} active={open} unread={open ? 0 : totalUnread} title="Toggle chat">
          <ChatIcon active={open} />
        </RailBtn>

        {/* Divider */}
        <div style={{ width: 24, height: 1, background: "rgba(255,255,255,0.07)", margin: "3px 0" }} />

        {/* Global */}
        <RailBtn
          onClick={() => openRoom("global")}
          active={activeRoomId === "global" && open}
          unread={unreadByRoom["global"] || 0}
          title="Global Chat"
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>🌐</span>
        </RailBtn>

        {/* Groups */}
        {groups.map(g => (
          <RailBtn
            key={g.id}
            onClick={() => openRoom(`group:${g.id}`)}
            active={activeRoomId === `group:${g.id}` && open}
            unread={unreadByRoom[`group:${g.id}`] || 0}
            title={g.name}
          >
            <GroupAvatar name={g.name} size={22} />
          </RailBtn>
        ))}

        {/* Bottom: status dot */}
        <div style={{ marginTop: "auto" }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: connected ? "#4ade80" : "#fbbf24",
            boxShadow: connected
              ? "0 0 5px rgba(74,222,128,0.5)"
              : "0 0 5px rgba(251,191,36,0.5)",
          }} title={connected ? "Connected" : "Connecting…"} />
        </div>
      </div>

      {/* ── Expanded panel ── */}
      <div style={{
        width: PANEL_W, flexShrink: 0,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        opacity: open ? 1 : 0,
        transition: "opacity 0.18s ease",
      }}>
        {/* Panel header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 12px 10px", flexShrink: 0,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: connected ? "#4ade80" : "#fbbf24",
              boxShadow: connected ? "0 0 4px rgba(74,222,128,0.5)" : "0 0 4px rgba(251,191,36,0.5)",
            }} />
            <span style={{ fontSize: 13, fontWeight: 900, color: "#fff" }}>Chat</span>
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
            {onlineUsers.length} online
          </span>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {view === "list" ? (
            <RoomListView
              activeRoomId={activeRoomId}
              groups={groups}
              onlineUsers={onlineUsers}
              unreadByRoom={unreadByRoom}
              onOpen={(roomId) => { selectRoom?.(roomId); setView("chat"); }}
            />
          ) : (
            <MiniChatView
              activeRoomId={activeRoomId}
              groups={groups}
              currentUser={currentUser}
              messages={messages}
              typingUsers={typingUsers}
              sendMessage={sendMessage ?? (() => {})}
              startTyping={startTyping ?? (() => {})}
              stopTyping={stopTyping ?? (() => {})}
              onBack={() => setView("list")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
