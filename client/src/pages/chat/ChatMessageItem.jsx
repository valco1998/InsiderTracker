function fmtCoins(v) {
  const n = Number(v || 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTimeLeft(endsAt) {
  if (!endsAt) return null;
  const diff = Number(endsAt) * 1000 - Date.now();
  if (diff <= 0) return "Ended";
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m left`;
  return `${mins}m left`;
}

function AuctionShareCard({ message }) {
  let data = null;
  try { data = typeof message.text === "string" ? JSON.parse(message.text) : message.text; } catch {}

  const timeLeft = data?.endsAt ? fmtTimeLeft(data.endsAt) : null;
  const profit   = data?.profitCoins > 0 ? data.profitCoins : null;

  const content = data ? (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: "linear-gradient(160deg, #202940 0%, #16202e 100%)",
        border:     "1px solid rgba(251,115,0,0.2)",
        width:      264,
      }}
    >
      {/* Accent line */}
      <div className="h-[2px]" style={{ background: "linear-gradient(90deg, #fb923c, #fbbf24)" }} />

      {/* Image */}
      {data.image && (
        <div
          className="flex items-center justify-center py-3"
          style={{ background: "rgba(0,0,0,0.25)" }}
        >
          <img
            src={data.image}
            alt={data.name}
            className="h-28 object-contain"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </div>
      )}

      <div className="px-3 pb-3 pt-2">
        {/* Badge */}
        <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.14em]"
          style={{ color: "#fb923c" }}>
          🔨 Auction
        </div>

        {/* Name */}
        <p className="text-[13px] font-black leading-snug text-white line-clamp-2 mb-2">
          {data.name || "Unknown Item"}
        </p>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-1.5 mb-2.5">
          <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(0,0,0,0.3)" }}>
            <div className="text-[9px] uppercase text-white/30 font-bold">Current Bid</div>
            <div className="text-sm font-black tabular-nums" style={{ color: "#fbbf24" }}>
              {fmtCoins(data.priceCoins)}
            </div>
          </div>

          {profit !== null ? (
            <div className="rounded-lg px-2 py-1.5"
              style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
              <div className="text-[9px] uppercase text-white/30 font-bold">Profit</div>
              <div className="text-sm font-black tabular-nums" style={{ color: "#4ade80" }}>
                +{fmtCoins(profit)}
              </div>
            </div>
          ) : (
            <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(0,0,0,0.3)" }}>
              <div className="text-[9px] uppercase text-white/30 font-bold">Suggested</div>
              <div className="text-sm font-black tabular-nums text-white/70">
                {fmtCoins(data.suggestedCoins)}
              </div>
            </div>
          )}
        </div>

        {/* Time left */}
        {timeLeft && (
          <div className="mb-2.5 text-[11px] font-bold"
            style={{ color: timeLeft === "Ended" ? "rgba(255,255,255,0.3)" : "#fb923c" }}>
            ⏱ {timeLeft}
          </div>
        )}

        {/* CTA */}
        <a
          href={data.empireUrl || `https://csgoempire.com/item/${data.itemId}`}
          target="_blank"
          rel="noreferrer"
          className="block text-center py-2 rounded-xl text-[12px] font-black text-black transition hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #fbbf24, #f59e0b)", textDecoration: "none" }}
        >
          Open Auction ↗
        </a>
      </div>
    </div>
  ) : (
    // Fallback if JSON parse fails
    <div className="rounded-2xl px-4 py-3 border"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <span className="text-sm text-white/60">[Auction share]</span>
    </div>
  );

  return (
    <div className={`flex flex-col gap-1 ${message.mine ? "items-end" : "items-start"}`}>
      {!message.mine && (
        <span className="text-xs text-white/40 px-1">{message.senderName}</span>
      )}
      {content}
      <span className="text-[11px] text-white/25 px-1">{message.createdAt}</span>
    </div>
  );
}

export default function ChatMessageItem({ message }) {
  if (message.type === "auction_share") {
    return <AuctionShareCard message={message} />;
  }

  if (message.type === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full px-3 py-1 text-[11px] text-white/30"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {message.text}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex ${message.mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-3xl px-4 py-3 border ${
          message.mine
            ? "bg-cyan-400 text-slate-950 border-cyan-300/50"
            : "bg-white/[0.04] text-white border-white/10"
        }`}
      >
        <div className={`text-xs mb-1 ${message.mine ? "text-slate-900/60" : "text-white/45"}`}>
          {message.senderName}
        </div>
        <div className="text-sm leading-6">{message.text}</div>
        <div className={`text-[11px] mt-2 ${message.mine ? "text-slate-900/60" : "text-white/35"}`}>
          {message.createdAt}
        </div>
      </div>
    </div>
  );
}
