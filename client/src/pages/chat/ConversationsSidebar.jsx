function getTypeClasses(type) {
  if (type === "global") {
    return "bg-cyan-500/10 text-cyan-300 border-cyan-400/20";
  }
  if (type === "group") {
    return "bg-violet-500/10 text-violet-300 border-violet-400/20";
  }
  return "bg-emerald-500/10 text-emerald-300 border-emerald-400/20";
}

export default function ConversationsSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateGroup,
}) {
  return (
    <div className="rounded-3xl border border-cyan-500/[0.12] bg-[#1a2133] shadow-[0_0_0_1px_rgba(34,211,238,0.03)] overflow-hidden">
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">Chats</div>
            <div className="text-sm text-white/50 mt-1">
              Global, groups, private
            </div>
          </div>

          <button
            onClick={onCreateGroup}
            className="rounded-2xl bg-cyan-500 text-slate-950 px-4 py-2 text-sm font-semibold hover:opacity-90"
          >
            New Group
          </button>
        </div>

        <input
          className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none placeholder:text-white/30"
          placeholder="Search chats..."
          readOnly
        />
      </div>

      <div className="p-3 space-y-2 max-h-[70vh] overflow-auto">
        {conversations.map((item) => {
          const isActive = item.id === activeConversationId;

          return (
            <button
              key={item.id}
              onClick={() => onSelectConversation(item.id)}
              className={`w-full text-left rounded-2xl border p-3 transition ${
                isActive
                  ? "border-cyan-400/25 bg-cyan-500/10"
                  : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center text-sm">
                      {item.avatar}
                    </div>
                    <div className="font-semibold truncate">{item.name}</div>
                  </div>

                  <div className="text-sm text-white/45 mt-2 truncate">
                    {item.lastMessage}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span
                    className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getTypeClasses(
                      item.type
                    )}`}
                  >
                    {item.type}
                  </span>

                  {item.unreadCount > 0 && (
                    <span className="min-w-6 h-6 px-2 rounded-full bg-white text-black text-xs font-bold flex items-center justify-center">
                      {item.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}