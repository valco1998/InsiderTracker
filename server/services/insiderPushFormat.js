// server/services/insiderPushFormat.js
// Builds the AlertLog document and FCM payload for an insider-trade alert.
// FCM contract kept identical to the existing pipeline:
//   data.type = "price_alert"   → service-worker delivery receipt + metrics
//   data.alertId = AlertLog _id → fcm.js dedup, recordAlertPushDone, /device-received
// data.url = the official SEC filing (opened by the service worker on click).

const compactUsd = (n) => {
  if (n == null) return null;
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
// Price exactly as reported (up to 4 decimals, as filed on Form 4).
const usd = (n) => (n == null ? null : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);
const day = (iso, withYear = false) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) }) : "n/a");
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function insiderAlertTitle(tx) {
  const kind = tx.code === "P" ? "Insider purchase" : "Insider sale";
  const v = compactUsd(tx.value);
  return clip(`${tx.ticker || tx.issuerName || "Form 4"} · ${kind}${v ? ` · ${v}` : ""}`, 60);
}

export function insiderAlertBody(tx) {
  const reporters = tx.reportedBy?.length ? tx.reportedBy : [tx];
  const who = String(reporters[0].insiderName || tx.insiderName || "Insider").split("; ")[0];
  const role = String(tx.role || "").split(/ · |; /)[0];
  const verb = tx.code === "P" ? "bought" : "sold";
  const qty = tx.shares != null ? `${tx.shares.toLocaleString("en-US")} sh` : "shares";
  const px = tx.price != null ? ` @ ${usd(tx.price)}` : " (price not reported)";
  const more = reporters.length > 1 ? ` · ${reporters.length} related filings` : "";
  // A trade from an earlier year than the filing must never read as recent.
  const tradeYear = !!tx.transactionDate && !!tx.filingDate && tx.transactionDate.slice(0, 4) !== tx.filingDate.slice(0, 4);
  // Filed after the 2-business-day deadline — the trade may be old news.
  const late = tx.filingDelay?.late ? ` (late, ${tx.filingDelay.businessDays} business days)` : "";
  return clip(`${who}${role && role !== "Not specified" ? ` (${role})` : ""} ${verb} ${qty}${px} · traded ${day(tx.transactionDate, tradeYear)} · Form 4 filed ${day(tx.filingDate)}${late}${more}`, 180);
}

// → fields for AlertLog.create (excluding userId / timing, added by deliverAlert)
export function buildInsiderAlertDoc({ tx, watch, alertKey }) {
  const reporters = tx.reportedBy?.length ? tx.reportedBy : [tx];
  return {
    ruleId: watch._id,
    itemId: alertKey,
    name: insiderAlertTitle(tx),
    image: "",
    source: "insider",
    kind: "insider_trade",
    insider: {
      economicId: alertKey,
      ticker: tx.ticker, issuerName: tx.issuerName, issuerCik: tx.issuerCik,
      insiderName: reporters[0].insiderName || tx.insiderName, role: tx.role,
      code: tx.code, type: tx.type, shares: tx.shares, price: tx.price, value: tx.value,
      transactionDate: tx.transactionDate, filingDate: tx.filingDate, acceptedAtET: tx.acceptedAtET,
      filingUrl: tx.filingUrl,
      filings: reporters.map((r) => ({ accessionNo: r.accessionNo, insiderName: r.insiderName, ownership: r.ownership, filingUrl: r.filingUrl })),
    },
  };
}

export function buildInsiderPushPayload({ tx, alertId, alertKey }) {
  return {
    title: insiderAlertTitle(tx),
    body: insiderAlertBody(tx),
    data: {
      type: "price_alert",
      kind: "insider_trade",
      alertId: String(alertId),
      url: tx.filingUrl,
      filingUrl: tx.filingUrl,
      ticker: tx.ticker || "",
      economicId: alertKey,
      accessionNo: tx.accessionNo,
    },
  };
}
