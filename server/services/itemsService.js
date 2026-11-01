export async function fetchItems(params = {}) {
  const { live, q, ...rest } = params;

  const usp = new URLSearchParams();

  // מעבירים פילטרים רגילים
  Object.entries(rest).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") usp.set(k, v);
  });

  // ✅ אם זה LIVE: משתמשים ב-search (לא q)
  if (String(live) === "1") {
    if (q) usp.set("search", q);
    // אופציונלי: להביא הרבה כדי למצוא
    usp.set("perPage", "2500");
    usp.set("order", "market_value");
    usp.set("sort", "desc");
    const url = `/api/items/market-live?${usp.toString()}`;
    return await apiGet(url);
  }

  // ✅ אחרת: CACHE
  if (q) usp.set("q", q);
  const url = `/api/items/market?${usp.toString()}`;
  return await apiGet(url);
}

// תתאים לפונקציה שלך בפועל (axios/fetch)
async function apiGet(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}