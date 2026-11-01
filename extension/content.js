/**
 * SKINTEL Inventory Importer — content.js
 *
 * Runs on: https://steamcommunity.com/ * /inventory*
 */
"use strict";

console.log("[SKINTEL EXT] loaded on", window.location.href);

/* ─── Config ─────────────────────────────────────────── */
const BATCH_SIZE = 100;
const MAX_PAGES  = 50;

const SAFE_TAG_CATS = new Set(["Rarity", "Exterior", "Type", "Weapon", "ItemSet", "Quality"]);

/* ─── SteamID detection ──────────────────────────────── */
function detectSteamId() {
  const m = window.location.pathname.match(/\/profiles\/(\d{17})/);
  if (m) return m[1];
  return null;
}

function isVanityUrl() {
  return /\/id\/[^/]+\/inventory/i.test(window.location.pathname);
}

/* ─── Read page globals via injected script ───────────── */
function readPageGlobals() {
  return new Promise(resolve => {
    const REPLY_TYPE = "SKINTEL_PAGE_DATA_" + Date.now();

    const handler = (e) => {
      if (e.source !== window || e.data?.type !== REPLY_TYPE) return;
      window.removeEventListener("message", handler);
      resolve(e.data);
    };
    window.addEventListener("message", handler);

    const script = document.createElement("script");
    script.textContent = `
      (function() {
        var replyType = ${JSON.stringify(REPLY_TYPE)};
        try {
          // Try both numeric key 2 and string "2" for compatibility
          var assets730 = window.g_rgAssets && (window.g_rgAssets["730"] || window.g_rgAssets[730]);
          var desc730   = window.g_rgDescriptions && (window.g_rgDescriptions["730"] || window.g_rgDescriptions[730]);
          var a = (assets730 && (assets730["2"] || assets730[2])) || null;
          var d = (desc730   && (desc730["2"]   || desc730[2]))   || null;
          var s = window.g_steamID || window.g_AccountID || null;
          var assetCount = a ? Object.keys(a).length : 0;
          var descCount  = d ? Object.keys(d).length : 0;
          var globalKeys = Object.keys(window).filter(function(k){ return k.startsWith('g_rg') || k.startsWith('g_steam') || k === 'g_AccountID'; });
          window.postMessage({
            type: replyType,
            assets: a,
            descriptions: d,
            steamId: s,
            _debug: { assetCount: assetCount, descCount: descCount, globalKeys: globalKeys }
          }, "*");
        } catch(e) {
          window.postMessage({ type: replyType, assets: null, descriptions: null, steamId: null, _debug: { error: e.message } });
        }
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();

    // 3-second fallback — if the page-world script never replies
    setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve({ assets: null, descriptions: null, steamId: null, _debug: { timedOut: true } });
    }, 3000);
  });
}

/* ─── Retry globals until items appear (Steam SPA loads data async) ── */
async function waitForGlobals(maxWaitMs = 8000, pollMs = 500) {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const g = await readPageGlobals();
    const assetCount = g.assets ? Object.keys(g.assets).length : 0;
    console.log(`[SKINTEL EXT] globals attempt ${attempt}: steamId=${g.steamId} assets=${assetCount} descCount=${g._debug?.descCount ?? "?"}`);
    if (assetCount > 0) return g;
    if (attempt === 1 && g._debug?.globalKeys?.length > 0) {
      console.log("[SKINTEL EXT] found globals keys:", g._debug.globalKeys.join(", "));
    }
    // Wait before retrying
    await new Promise(r => setTimeout(r, pollMs));
  }
  console.warn("[SKINTEL EXT] globals never populated after", maxWaitMs, "ms — falling back to API fetch");
  return { assets: null, descriptions: null, steamId: null, _debug: { timedOut: true } };
}

/* ─── Sanitise one item ──────────────────────────────── */
function sanitiseItem(assetId, classId, instanceId, amount, desc) {
  const name = (desc.market_hash_name || desc.name || "").trim().slice(0, 300);
  if (!name || !assetId) return null;

  const tags = (desc.tags || [])
    .filter(t => t && SAFE_TAG_CATS.has(t.category))
    .map(t => ({
      category:           String(t.category           || ""),
      internal_name:      String(t.internal_name      || "").slice(0, 100),
      localized_tag_name: String(t.localized_tag_name || "").slice(0, 100),
      color:              String(t.color              || "").replace(/[^0-9a-fA-F]/g, "").slice(0, 6),
    }));

  return {
    assetid:          String(assetId),
    classid:          String(classId    || ""),
    instanceid:       String(instanceId ?? "0"),
    amount:           String(amount     || "1"),
    name:             String(desc.name  || "").trim().slice(0, 300),
    market_hash_name: name,
    icon_url:         String(desc.icon_url || "").trim().slice(0, 500),
    // Handle both integer (Steam API) and boolean (page globals) formats
    tradable:         desc.tradable   === 1 || desc.tradable   === true,
    marketable:       desc.marketable === 1 || desc.marketable === true,
    tags,
  };
}

/* ─── Parse from page globals ────────────────────────── */
function parseFromGlobals(assets, descriptions) {
  if (!assets || !descriptions) {
    console.warn("[SKINTEL EXT] parseFromGlobals: missing assets or descriptions");
    return null;
  }

  const assetKeys = Object.keys(assets);
  const descKeys  = Object.keys(descriptions);
  console.log(`[SKINTEL EXT] parseFromGlobals: ${assetKeys.length} assets, ${descKeys.length} descriptions`);

  if (assetKeys.length > 0) {
    // Log first asset to inspect structure
    const firstKey = assetKeys[0];
    console.log("[SKINTEL EXT] first asset key:", firstKey, "value:", JSON.stringify(assets[firstKey]).slice(0, 200));
  }
  if (descKeys.length > 0) {
    const firstDescKey = descKeys[0];
    console.log("[SKINTEL EXT] first desc key:", firstDescKey, "market_hash_name:", descriptions[firstDescKey]?.market_hash_name);
  }

  const items = [];
  let skipped = 0;
  for (const [aid, asset] of Object.entries(assets)) {
    const key  = `${asset.classid}_${asset.instanceid ?? "0"}`;
    const desc = descriptions[key] || descriptions[`${asset.classid}_0`] || {};

    if (!desc.market_hash_name && !desc.name) {
      if (skipped < 3) {
        console.warn(`[SKINTEL EXT] desc miss — assetid=${aid} classid=${asset.classid} instanceid=${asset.instanceid} tried key="${key}"`);
      }
      skipped++;
    }

    const item = sanitiseItem(asset.assetid || asset.id || aid, asset.classid, asset.instanceid, asset.amount, desc);
    if (item) items.push(item);
  }

  if (skipped > 0) {
    console.warn(`[SKINTEL EXT] parseFromGlobals: ${skipped} assets had no matching description`);
  }

  return items;
}

/* ─── Fetch inventory from Steam API with pagination ──── */
async function fetchAllPages(steamId, onProgress) {
  const all = new Map();
  let page = 0;
  let startAssetId = null;

  while (page < MAX_PAGES) {
    page++;
    let url = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=2000`;
    if (startAssetId) url += `&start_assetid=${startAssetId}`;

    console.log(`[SKINTEL EXT] fetch page ${page} → ${url}`);
    onProgress?.(`Fetching page ${page}…`);

    let res;
    try {
      res = await fetch(url, { credentials: "include" });
    } catch (netErr) {
      console.error("[SKINTEL EXT] fetch network error:", netErr.message);
      throw new Error("Network error fetching Steam inventory: " + netErr.message);
    }

    console.log(`[SKINTEL EXT] page ${page} → HTTP ${res.status}`);

    if (res.status === 400 || res.status === 403) {
      console.log(`[SKINTEL EXT] Steam ${res.status} — inventory empty or private`);
      break;
    }
    if (!res.ok) throw new Error(`Steam HTTP ${res.status}`);

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      console.error("[SKINTEL EXT] JSON parse error:", parseErr.message);
      throw new Error("Steam returned non-JSON response");
    }

    console.log(`[SKINTEL EXT] page ${page} data — success:${data?.success} assets:${data?.assets?.length ?? "n/a"} more_items:${data?.more_items} descriptions:${data?.descriptions?.length ?? "n/a"}`);

    if (!data || data.success === false) {
      console.warn("[SKINTEL EXT] Steam returned success=false:", JSON.stringify(data).slice(0, 200));
      break;
    }
    if (!data.assets) {
      console.warn("[SKINTEL EXT] no assets array in response — inventory may be empty");
      break;
    }

    // Build description map
    const descMap = {};
    for (const d of data.descriptions ?? []) {
      const key = `${d.classid}_${d.instanceid ?? "0"}`;
      descMap[key] = d;
    }

    console.log(`[SKINTEL EXT] descMap keys: ${Object.keys(descMap).length}`);
    if (data.descriptions?.length > 0) {
      console.log("[SKINTEL EXT] first desc:", JSON.stringify(data.descriptions[0]).slice(0, 200));
    }

    let pageAdded = 0;
    let pageSkipped = 0;
    for (const a of data.assets) {
      if (all.has(a.assetid)) { pageSkipped++; continue; }
      const key  = `${a.classid}_${a.instanceid ?? "0"}`;
      const desc = descMap[key] ?? descMap[`${a.classid}_0`] ?? {};
      const item = sanitiseItem(a.assetid, a.classid, a.instanceid, a.amount, desc);
      if (item) {
        all.set(a.assetid, item);
        pageAdded++;
      } else {
        pageSkipped++;
        if (pageSkipped <= 2) {
          console.warn(`[SKINTEL EXT] item skipped — assetid=${a.assetid} classid=${a.classid} desc.name="${desc.market_hash_name || desc.name || "(empty)"}"`);
        }
      }
    }

    console.log(`[SKINTEL EXT] page ${page}: added ${pageAdded}, skipped ${pageSkipped} — total so far: ${all.size}`);
    onProgress?.(`Fetched ${all.size} items…`);

    if (!data.more_items) break;
    startAssetId = data.last_assetid;
    if (!startAssetId) break;

    await new Promise(r => setTimeout(r, 600));
  }

  const result = [...all.values()];
  console.log(`[SKINTEL EXT] fetchAllPages done — ${result.length} total items`);
  if (result.length > 0) {
    console.log("[SKINTEL EXT] sample item:", JSON.stringify(result[0]).slice(0, 300));
  }
  return result;
}

/* ─── Main import logic ───────────────────────────────── */
async function runImport(steamId, onProgress) {
  // Resolve steamId from URL first (fastest)
  const urlSteamId = detectSteamId();

  // Wait for page globals — Steam SPA loads inventory data asynchronously
  onProgress?.("Reading Steam inventory data…");
  const globals = await waitForGlobals(8000, 500);

  const resolvedSteamId = steamId || urlSteamId || globals.steamId || null;

  if (!resolvedSteamId) {
    throw new Error("Could not detect SteamID. Please open your inventory using the /profiles/{steamId64}/inventory URL.");
  }

  console.log("[SKINTEL EXT] steamId:", resolvedSteamId);
  onProgress?.("Steam ID: " + resolvedSteamId);

  let items = null;

  if (globals.assets !== null) {
    console.log("[SKINTEL EXT] parsing from page globals…");
    items = parseFromGlobals(globals.assets, globals.descriptions);
    if (items !== null) {
      console.log(`[SKINTEL EXT] page globals: ${items.length} items`);
    }
  } else {
    console.log("[SKINTEL EXT] page globals not available — using Steam API fetch");
  }

  if (items === null || items.length === 0) {
    console.log("[SKINTEL EXT] fetching via Steam inventory API…");
    onProgress?.("Fetching from Steam API…");
    items = await fetchAllPages(resolvedSteamId, onProgress);
  }

  console.log(`[SKINTEL EXT] parsed items: ${items.length}`);
  return { items, steamId: resolvedSteamId };
}

/* ─── Send to backend in chunks ───────────────────────── */
async function sendToBackend(items, steamId, token, onProgress) {
  const chunks = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    chunks.push(items.slice(i, i + BATCH_SIZE));
  }

  console.log(`[SKINTEL EXT] sendToBackend — ${items.length} items in ${chunks.length} chunk(s)`);

  let totalSaved = 0;

  for (let ci = 0; ci < chunks.length; ci++) {
    const isLast = ci === chunks.length - 1;
    onProgress?.(`Uploading chunk ${ci + 1}/${chunks.length}…`);

    console.log(`[SKINTEL EXT] sending chunk ${ci + 1}/${chunks.length} (${chunks[ci].length} items, isLast:${isLast})`);

    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "SKINTEL_SEND",
          items: chunks[ci],
          steamId,
          token,
          chunkIndex: ci,
          totalChunks: chunks.length,
          isLast,
        },
        resolve
      );
    });

    console.log(`[SKINTEL EXT] chunk ${ci + 1} response:`, JSON.stringify(resp));

    if (!resp?.ok) throw new Error(resp?.error || "Backend error on chunk " + (ci + 1));
    totalSaved += resp.count || 0;
  }

  const finalCount = chunks.length === 1 ? totalSaved : items.length;
  console.log(`[SKINTEL EXT] sendToBackend complete — totalSaved:${totalSaved} finalCount:${finalCount}`);
  return finalCount;
}

/* ─── Message listener (from popup) ──────────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "SKINTEL_IMPORT") return;

  if (isVanityUrl() && !detectSteamId() && !msg.steamId) {
    sendResponse({
      ok: false,
      error: "Could not resolve your SteamID from this vanity URL. Make sure you're logged into SKINTEL with Steam linked, then try again."
    });
    return true;
  }

  console.log("[SKINTEL EXT] SKINTEL_IMPORT received — steamId:", msg.steamId, "token present:", !!msg.token);

  const onProgress = (txt) => {
    chrome.runtime.sendMessage({ type: "SKINTEL_PROGRESS", text: txt }).catch(() => {});
  };

  runImport(msg.steamId, onProgress)
    .then(({ items, steamId }) => {
      if (items.length === 0) {
        // CS2 inventory is empty — no backend call needed
        console.log("[SKINTEL EXT] CS2 inventory is empty");
        sendResponse({ ok: true, count: 0, steamId, empty: true });
        return;
      }
      return sendToBackend(items, steamId, msg.token, onProgress).then(count => {
        console.log(`[SKINTEL EXT] import success — ${count} items`);
        sendResponse({ ok: true, count, steamId });
      });
    })
    .catch(e => {
      console.error("[SKINTEL EXT] import failed:", e.message);
      sendResponse({ ok: false, error: e.message });
    });

  return true;
});

console.log("[SKINTEL EXT] ready — waiting for import trigger");
