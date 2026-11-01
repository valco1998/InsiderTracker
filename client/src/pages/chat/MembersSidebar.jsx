function getStatusDot(status) {
  if (status === "online") return "bg-emerald-400";
  if (status === "away") return "bg-yellow-400";
  return "bg-white/25";
}

export default function MembersSidebar({ conversation }) {
  const members = conversation?.members || [];

  return (
    <div className="rounded-3xl border border-cyan-500/[0.12] bg-[#1a2133] min-h-[78vh] overflow-hidden">
      <div className="p-4 border-b border-white/10">
        <div className="text-xl font-semibold">Members</div>
        <div className="text-sm text-white/45 mt-1">
          {conversation?.type === "private"
            ? "People in this private chat"
            : "Users in this conversation"}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {members.map((member) => (
          <div
            key={member.id}
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative">
                <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                  {member.name[0]}
                </div>
                <span
                  className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border border-[#041122] ${getStatusDot(
                    member.status
                  )}`}
                />
              </div>

              <div className="min-w-0">
                <div className="font-medium truncate">{member.name}</div>
                <div className="text-xs text-white/45 capitalize">
                  {member.status}
                </div>
              </div>
            </div>

            <button className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/75">
              Message
            </button>
          </div>
        ))}

        {members.length === 0 && (
          <div className="text-sm text-white/40">No members found</div>
        )}
      </div>
    </div>
  );
}