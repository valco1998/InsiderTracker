// ── Standard SkinTel push notification template ────────────────────────────
// Used by every alert source (price alerts, item alerts, auction alerts) so
// notifications look identical across Chrome desktop, PWA and mobile:
//   title: item name only
//   body:  "Bid <price> · Profit +<amount> (<pct>%)"
//   data:  image (large notification image), itemId/url (Open Auction +
//          body click target), itemName, alertId, type
//
// The firebase-messaging-sw.js handler turns this into the actual
// notification (icon/badge always /telIcon.png, actions = Open Auction +
// View Alerts, large `image` only when data.image is an absolute URL).

export function buildAlertPushPayload({
  type,
  alertId,
  itemId,
  name,
  image,
  priceCoins,
  suggestedCoins,
  profitCoins,
  profitPct,
}) {
  const bid = Number(priceCoins) || 0;
  const profit = profitCoins != null
    ? Number(profitCoins)
    : Math.max(0, (Number(suggestedCoins) || 0) - bid);
  const pct = profitPct != null
    ? Number(profitPct)
    : (Number(suggestedCoins) > 0 ? (profit / Number(suggestedCoins)) * 100 : 0);

  const title = name || "SkinTel Alert";
  const sign  = profit >= 0 ? "+" : "";
  const body  = `Bid ${bid.toFixed(2)} · Profit ${sign}${profit.toFixed(2)} (${pct.toFixed(1)}%)`;
  const url   = itemId ? `https://csgoempire.com/item/${itemId}` : "/alerts";

  return {
    title,
    body,
    data: {
      type,
      alertId:  String(alertId),
      itemId:   String(itemId || ""),
      itemName: name || "",
      image:    image || "",
      url,
    },
  };
}
