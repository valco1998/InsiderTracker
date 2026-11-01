// server/services/priceProvider.js
export async function getCurrentPriceForItem(itemId) {
  // TODO: להחליף בקריאה אמיתית ל-API
  // סטאב: מחיר "זז" קצת כדי לייצר התראות
  const base = 10 + (Number(itemId) % 10);
  const wobble = (Math.random() - 0.5) * 2; // -1 עד +1
  const price = Math.max(0.01, base + wobble);
  return Number(price.toFixed(2));
}
