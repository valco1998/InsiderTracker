import { useMemo, useState } from "react";

const ILS_PER_COIN = 2;

function splitName(full = "") {
  const [weaponPart, restPart] = String(full).split("|").map((s) => s?.trim());
  if (!restPart) return { weapon: "", skin: full, wear: "" };

  const wearMatch = restPart.match(/\(([^)]+)\)\s*$/);
  const wear = wearMatch ? wearMatch[1] : "";
  const skin = wear ? restPart.replace(wearMatch[0], "").trim() : restPart;

  return { weapon: weaponPart || "", skin, wear };
}

export default function SkinCard({ item, onTrack }) {
  const [target, setTarget] = useState("");

  const image =
    item.image ||
    item.iconUrl ||
    item.icon ||
    item.img ||
    "https://placehold.co/300x200?text=Skin";

  const priceCoins = useMemo(() => {
    if (Number.isFinite(Number(item?.priceCoins))) return Number(item.priceCoins);
    if (Number.isFinite(Number(item?.priceCents))) return Number(item.priceCents) / 100;
    if (Number.isFinite(Number(item?.price))) return Number(item.price);
    return 0;
  }, [item]);

  const priceIls = priceCoins * ILS_PER_COIN;

  const discountPct = Number(item?.discountPct ?? 0);
  const isGoodDeal = discountPct > 0; // אם אצלך “הנחה” היא מספר חיובי
  const discountText =
    discountPct === 0 ? "" : `${discountPct > 0 ? "-" : ""}${Math.abs(discountPct)}%`;

  const { weapon, skin, wear } = useMemo(() => splitName(item?.name), [item?.name]);

  const targetCoins = (() => {
    const n = Number(target);
    return Number.isFinite(n) ? n : "";
  })();

  const id = item?.id ?? item?.itemId;
  const empireUrl = id ? `https://csgoempire.com/item/${id}` : null;

  return (
    <div className="rounded-2xl bg-base-100/40 border border-white/10 p-3 hover:border-white/20 hover:bg-base-100/50 transition">
      {/* top row */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] tracking-wide text-white/60 uppercase">
          {wear || item.wear_name || ""}
        </div>

        {discountPct !== 0 && (
          <span
            className={[
              "badge badge-sm font-semibold",
              isGoodDeal ? "badge-success" : "badge-error",
            ].join(" ")}
            title="Discount"
          >
            {discountText}
          </span>
        )}
      </div>

      {/* image (clickable to Empire) */}
      {empireUrl ? (
        <a href={empireUrl} target="_blank" rel="noreferrer" className="block">
          <div className="rounded-xl bg-base-200/40 h-24 flex items-center justify-center overflow-hidden hover:bg-base-200/60 transition">
            <img
              src={image}
              alt={item?.name}
              className="h-20 object-contain"
              onError={(e) => (e.currentTarget.src = "https://placehold.co/300x200?text=No+Image")}
            />
          </div>
        </a>
      ) : (
        <div className="rounded-xl bg-base-200/40 h-24 flex items-center justify-center overflow-hidden">
          <img
            src={image}
            alt={item?.name}
            className="h-20 object-contain"
            onError={(e) => (e.currentTarget.src = "https://placehold.co/300x200?text=No+Image")}
          />
        </div>
      )}

      {/* title */}
      <div className="mt-3">
        <div className="text-[11px] text-white/60 truncate">{weapon}</div>
        <div className="text-sm font-semibold text-white leading-tight line-clamp-2">
          {skin}
        </div>
      </div>

      {/* price row */}
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-yellow-300 font-semibold">
            <span>🪙</span>
            <span>{priceCoins.toFixed(2)}</span>
          </div>
          <div className="text-white/50">₪ {priceIls.toFixed(2)}</div>
        </div>

        {empireUrl && (
          <a
            href={empireUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-white/60 hover:text-white underline underline-offset-4"
          >
            Open in Empire
          </a>
        )}
      </div>

      {/* actions */}
      <div className="mt-3 flex items-center gap-2">
        <input
          className="w-full h-9 px-2 rounded-xl bg-base-200/30 border border-white/10 text-sm text-white outline-none focus:border-white/25"
          placeholder="Target (coins) e.g. 750"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />

        <button
          className="h-9 px-4 rounded-xl bg-white/5 border border-white/10 text-white/90 hover:bg-white/10 hover:border-white/20 transition text-sm font-semibold"
          onClick={() => onTrack(item, targetCoins === "" ? priceCoins : targetCoins)}
        >
          Track
        </button>
      </div>

      {targetCoins !== "" && (
        <div className="mt-1 text-[11px] text-white/45">
          Target ₪ {(targetCoins * ILS_PER_COIN).toFixed(2)}
        </div>
      )}
    </div>
  );
}