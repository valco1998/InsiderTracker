import { memo, useEffect, useRef, useState } from "react";
import { useChatContext } from "../../context/ChatContext";
import { useChatPanel } from "../../context/ChatPanelContext";
import AuctionShareMessage from "./AuctionShareMessage";

/* ─── Avatar — no dynamic Tailwind classes ──────────── */
function Avatar({ src, name, sizePx = 28 }) {
  const [failed, setFailed] = useState(false);
  const fb = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name || "u")}`;
  return (
    <img
      src={!failed && src ? src : fb}
      alt={name || "user"}
      style={{
        width: sizePx, height: sizePx, flexShrink: 0,
        borderRadius: 8, objectFit: "cover",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.08)",
      }}
      onError={() => setFailed(true)}
    />
  );
}

/* ─── Group initial avatar ──────────────────────────── */
function GroupAvatar({ name }) {
  const COLORS = [
    ["#7c3aed","#6d28d9"], ["#0891b2","#0e7490"],
    ["#db2777","#be185d"], ["#059669","#047857"],
    ["#d97706","#b45309"],
  ];
  const [from, to] = COLORS[(name || "?").charCodeAt(0) % COLORS.length];
  return (
    <div style={{
      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
      background: `linear-gradient(135deg,${from},${to})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 900, color: "#fff",
    }}>
      {(name?.[0] ?? "?").toUpperCase()}
    </div>
  );
}

/* ─── Room list item ────────────────────────────────── */
const RoomItem = memo(function RoomItem({ icon, label, sub, active, unread, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left"
      style={{
        background: active ? "rgba(34,211,238,0.08)" : hov ? "rgba(255,255,255,0.04)" : "transparent",
        borderLeft: active ? "2px solid rgba(34,211,238,0.7)" : "2px solid transparent",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ flexShrink: 0 }}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold truncate" style={{ color: active ? "#fff" : "rgba(255,255,255,0.55)" }}>
          {label}
        </p>
        {sub && <p className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.25)" }}>{sub}</p>}
      </div>
      {unread > 0 && !active && (
        <span
          className="flex items-center justify-center text-[9px] font-black text-white"
          style={{
            height: 16, minWidth: 16, borderRadius: 8, paddingInline: 4,
            background: "#22d3ee", boxShadow: "0 0 8px rgba(34,211,238,0.5)",
          }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
});

/* ─── Mini message bubble ───────────────────────────── */
const MiniMsg = memo(function MiniMsg({ msg, isMine }) {
  if (msg.type === "auction_share") {
    return <AuctionShareMessage msg={msg} isMine={isMine} compact />;
  }

  return (
    <div className={`flex gap-2 ${isMine ? "flex-row-reverse" : ""}`}>
      <div
        className="text-[12px] leading-relaxed break-words"
        style={{
          maxWidth: "82%",
          padding: "6px 12px",
          borderRadius: isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          ...(isMine
            ? { background: "rgba(34,211,238,0.15)", border: "1px solid rgba(34,211,238,0.2)", color: "#fff" }
            : { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)" }),
        }}
      >
        {!isMine && (
          <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", marginBottom: 2 }}>
            {msg.senderName}
          </p>
        )}
        {msg.text}
      </div>
    </div>
  );
});

/* ─── Mini chat view ────────────────────────────────── */
function MiniChatView({ activeRoomId, groups, currentUser, messages, typingUsers, sendMessage, startTyping, stopTyping, onBack }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  const lastMsgId = messages[messages.length - 1]?.id;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMsgId]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    sendMessage(text);
    setInput("");
    inputRef.current?.focus();
  }

  const isGroup = activeRoomId?.startsWith("group:");
  const activeGroup = isGroup
    ? groups.find(g => `group:${g.id}` === activeRoomId)
    : null;
  const roomLabel = isGroup ? (activeGroup?.name || "Group") : "Global Chat";

  return (
    <div className="flex flex-col h-full">
      {/* Back */}
      <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <button onClick={onBack}
          className="flex items-center justify-center rounded-lg text-white/40 hover:text-white transition-colors"
          style={{ width: 24, height: 24 }}>
          <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-[12px] font-bold truncate" style={{ color: "rgba(255,255,255,0.6)" }}>
          {roomLabel}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 min-h-0">
        {messages.filter(m => m.type !== "system").slice(-30).map((msg, i) => (
          <MiniMsg key={msg.id ?? i} msg={msg} isMine={msg.senderId === currentUser?.id} />
        ))}
        {typingUsers.length > 0 && (
          <div className="flex items-center gap-1.5 pl-1">
            <div className="flex gap-0.5">
              {[0, 150, 300].map(d => (
                <span key={d} className="rounded-full animate-bounce"
                  style={{ width: 4, height: 4, background: "rgba(255,255,255,0.3)", animationDelay: `${d}ms` }} />
              ))}
            </div>
            <span className="text-[10px] italic" style={{ color: "rgba(255,255,255,0.25)" }}>
              {typingUsers[0]?.username} typing…
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-2 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); startTyping(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            onBlur={stopTyping}
            placeholder="Message…"
            maxLength={500}
            className="flex-1 text-[12px] text-white outline-none min-w-0 rounded-xl px-3 py-2 placeholder:text-white/20"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.07)" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="flex-shrink-0 flex items-center justify-center rounded-xl disabled:opacity-30 transition-opacity"
            style={{ width: 32, height: 32, background: "linear-gradient(135deg,#22d3ee,#a855f7)" }}
          >
            <svg style={{ width: 14, height: 14, color: "#fff" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main panel ────────────────────────────────────── */
export default function ChatPanel() {
  const { open } = useChatPanel();

  // Guard: context may be null if ChatProvider isn't mounted (e.g. logged out)
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
  }

  return (
    <div
      className="flex-shrink-0 flex flex-col overflow-hidden"
      style={{
        width: open ? 272 : 0,
        minWidth: open ? 272 : 0,
        borderRight: open ? "1px solid rgba(255,255,255,0.08)" : "none",
        background: "#1a2133",
        opacity: open ? 1 : 0,
        transition: "width 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease, min-width 0.25s cubic-bezier(0.4,0,0.2,1)",
        overflow: "hidden",
      }}
    >
      {open && (
        <div className="flex flex-col h-full chat-panel-enter" style={{ width: 272 }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center gap-2">
              <div
                className="rounded-full flex-shrink-0"
                style={{
                  width: 8, height: 8,
                  background: connected ? "#4ade80" : "#fbbf24",
                  boxShadow: connected ? "0 0 6px rgba(74,222,128,0.8)" : "0 0 6px rgba(251,191,36,0.8)",
                }}
              />
              <span className="text-[13px] font-black text-white">Chat</span>
            </div>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
              {onlineUsers.length} online
            </span>
          </div>

          {view === "list" ? (
            /* Conversations list */
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              <div className="px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: "rgba(255,255,255,0.2)" }}>
                  General
                </p>
              </div>

              <RoomItem
                icon={
                  <div className="flex items-center justify-center rounded-lg text-base"
                    style={{ width: 28, height: 28, background: "rgba(34,211,238,0.1)" }}>
                    🌐
                  </div>
                }
                label="Global Chat"
                sub={`${onlineUsers.length} online`}
                active={activeRoomId === "global"}
                unread={unreadByRoom["global"] || 0}
                onClick={() => openRoom("global")}
              />

              {groups.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1.5">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: "rgba(255,255,255,0.2)" }}>
                      Groups
                    </p>
                  </div>
                  {groups.map(g => (
                    <RoomItem
                      key={g.id}
                      icon={<GroupAvatar name={g.name} />}
                      label={g.name}
                      sub={`${g.members.length} members`}
                      active={activeRoomId === `group:${g.id}`}
                      unread={unreadByRoom[`group:${g.id}`] || 0}
                      onClick={() => openRoom(`group:${g.id}`)}
                    />
                  ))}
                </>
              )}

              {groups.length === 0 && (
                <div className="px-3 py-5 text-center">
                  <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>No groups yet</p>
                </div>
              )}
            </div>
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
      )}
    </div>
  );
}
