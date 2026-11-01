"use strict";

const API_BASE = "https://skintel-app.onrender.com/api";

/* Accumulates chunks across a multi-chunk import for the same steamId */
const pendingChunks = new Map();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "SKINTEL_SEND") return;

  const { items, steamId, token, chunkIndex = 0, totalChunks = 1, isLast = true } = msg;

  console.log(`[SKINTEL BG] SKINTEL_SEND — steamId:${steamId} chunk:${chunkIndex+1}/${totalChunks} items:${items?.length} isLast:${isLast} token:${token ? "present" : "MISSING"}`);

  (async () => {
    try {
      const key = steamId;
      if (!pendingChunks.has(key)) {
        pendingChunks.set(key, { allItems: [], totalChunks });
        console.log(`[SKINTEL BG] new session for ${steamId} — expecting ${totalChunks} chunk(s)`);
      }

      const session = pendingChunks.get(key);
      session.allItems.push(...(items || []));
      console.log(`[SKINTEL BG] accumulated ${session.allItems.length} items so far`);

      if (!isLast && chunkIndex < totalChunks - 1) {
        console.log(`[SKINTEL BG] partial — waiting for more chunks`);
        sendResponse({ ok: true, count: 0, partial: true });
        return;
      }

      const finalItems = session.allItems;
      pendingChunks.delete(key);

      console.log(`[SKINTEL BG] sending ${finalItems.length} items to backend at ${API_BASE}/steam/import`);
      if (finalItems.length > 0) {
        console.log("[SKINTEL BG] first item sample:", JSON.stringify(finalItems[0]).slice(0, 200));
      }

      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let res;
      try {
        res = await fetch(`${API_BASE}/steam/import`, {
          method:  "POST",
          headers,
          body:    JSON.stringify({ items: finalItems, steamId }),
        });
      } catch (netErr) {
        console.error("[SKINTEL BG] network error reaching backend:", netErr.message);
        sendResponse({ ok: false, error: `Cannot reach SKINTEL server: ${netErr.message}` });
        return;
      }

      console.log(`[SKINTEL BG] backend response status: ${res.status}`);

      let json = {};
      try {
        json = await res.json();
      } catch {
        console.error("[SKINTEL BG] backend returned non-JSON (status:", res.status, ")");
        sendResponse({ ok: false, error: `Server error (HTTP ${res.status})` });
        return;
      }

      console.log("[SKINTEL BG] backend response body:", JSON.stringify(json));

      if (!res.ok || !json.ok) {
        sendResponse({ ok: false, error: json.error || json.message || `HTTP ${res.status}` });
      } else {
        sendResponse({ ok: true, count: json.count, steamId: json.steamId });
      }
    } catch (e) {
      console.error("[SKINTEL BG] unexpected error:", e.message);
      sendResponse({ ok: false, error: `Extension error: ${e.message}` });
    }
  })();

  return true;
});
