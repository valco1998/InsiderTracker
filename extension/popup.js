"use strict";

const API_BASE = "https://skintel-app.onrender.com/api";

/* ─── DOM ──────────────────────────────────────────── */
const dApp      = document.getElementById("dApp");
const lApp      = document.getElementById("lApp");
const dSteam    = document.getElementById("dSteam");
const lSteam    = document.getElementById("lSteam");
const dMatch    = document.getElementById("dMatch");
const lMatch    = document.getElementById("lMatch");
const importBtn = document.getElementById("importBtn");
const progressEl = document.getElementById("progressEl");
const msgEl     = document.getElementById("msgEl");
const hintEl    = document.getElementById("hintEl");
const lastEl    = document.getElementById("lastEl");

/* ─── Helpers ──────────────────────────────────────── */
function dot(el, c) { el.className = "dot " + c; }

function showMsg(text, cls) {
  msgEl.className = "msg " + cls;
  msgEl.textContent = text;
  msgEl.style.display = "block";
}
function showProgress(text) {
  progressEl.className = "msg progress";
  progressEl.textContent = text;
  progressEl.style.display = "block";
}
function hideProgress() { progressEl.style.display = "none"; }
function hint(html)  { hintEl.innerHTML = html; hintEl.style.display = "block"; }
function noHint()    { hintEl.style.display = "none"; }

function timeAgo(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000), h = Math.floor(m / 60), day = Math.floor(h / 24);
  return day > 0 ? `${day}d ago` : h > 0 ? `${h}h ago` : m > 0 ? `${m}m ago` : "just now";
}

/* ─── Get JWT from extension storage or Skintel tab ── */
async function getToken() {
  const { skintelToken } = await chrome.storage.local.get("skintelToken");
  if (skintelToken) {
    console.log("[SKINTEL] getToken: using cached token from chrome.storage.local");
    return skintelToken;
  }
  console.log("[SKINTEL] getToken: no cached token, checking open skin-tel.com tabs…");

  // Try to find an open Skintel tab (apex or www domain) and read its localStorage token.
  // Check every matching tab, not just the first — a user may have both
  // skin-tel.com and www.skin-tel.com tabs open, and only one of them may
  // actually hold the token in its (origin-scoped) localStorage.
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://skin-tel.com/*", "https://www.skin-tel.com/*"],
    });
    console.log(`[SKINTEL] getToken: found ${tabs.length} matching SkinTel tab(s):`,
      tabs.map(t => new URL(t.url).origin));

    for (const tab of tabs) {
      const origin = new URL(tab.url).origin;
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func:   () => localStorage.getItem("token"),
      });
      if (result) {
        console.log("[SKINTEL] getToken: token source origin:", origin);
        await chrome.storage.local.set({ skintelToken: result });
        return result;
      }
      console.log("[SKINTEL] getToken: no 'token' key in localStorage at origin:", origin);
    }
  } catch (e) {
    console.log("[SKINTEL] getToken: tab/script access failed:", e?.message || e);
  }

  console.log("[SKINTEL] getToken: no token found anywhere");
  return null;
}

/* ─── Get server-side user to check steamId ─────────── */
async function getServerUser(token) {
  if (!token) {
    console.log("[SKINTEL] getServerUser: no token, skipping /steam/me");
    return null;
  }
  try {
    console.log("[SKINTEL] getServerUser: calling", `${API_BASE}/steam/me`);
    const res = await fetch(`${API_BASE}/steam/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("[SKINTEL] getServerUser: response status", res.status);
    const d = await res.json();
    console.log("[SKINTEL] getServerUser: response body", d);
    return d?.ok ? d.user : null;
  } catch (e) {
    console.log("[SKINTEL] getServerUser: fetch failed:", e?.message || e);
    return null;
  }
}

/* ─── Get last import info ───────────────────────────── */
async function getLastImport(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}/steam/inventory`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    return d?.ok ? d : null;
  } catch { return null; }
}

/* ─── Extract steamId from a URL ─────────────────────── */
function steamIdFromUrl(url = "") {
  const m = url.match(/\/profiles\/(\d{17})/);
  return m ? m[1] : null;
}

function vanityNameFromUrl(url = "") {
  const m = url.match(/steamcommunity\.com\/id\/([^/]+)\/inventory/i);
  return m ? m[1] : null;
}

/* ─── Resolve a vanity name (/id/{name}) to a numeric SteamID64 ──── */
async function resolveVanitySteamId(vanity, token) {
  if (!vanity || !token) return null;
  try {
    const res = await fetch(`${API_BASE}/steam/resolve-vanity/${encodeURIComponent(vanity)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    return d?.ok ? d.steamId : null;
  } catch { return null; }
}

/* ─── Listen for progress updates from content.js ────── */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SKINTEL_PROGRESS") {
    showProgress(msg.text);
  }
});

/* ─── Init ─────────────────────────────────────────────── */
let appToken     = null;
let serverUser   = null;
let activeTab    = null;
let resolvedSteamId = null; // numeric SteamID64 for the active tab (direct or resolved from vanity)

async function init() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = activeTab?.url || "";
  console.log("[SKINTEL] active tab origin:", tabUrl ? new URL(tabUrl).origin : "(none)");

  // 1. App login
  appToken   = await getToken();
  serverUser = await getServerUser(appToken);

  // A cached token can go stale (user logged out/in again on the site and
  // got a new JWT). If the cached token fails validation, drop it and
  // re-read a fresh token from the open SkinTel tab before giving up.
  if (appToken && !serverUser) {
    console.log("[SKINTEL] cached token failed /steam/me — clearing cache and retrying from tab");
    await chrome.storage.local.remove("skintelToken");
    appToken   = await getToken();
    serverUser = appToken ? await getServerUser(appToken) : null;
  }

  if (appToken && serverUser) {
    dot(dApp, "g");
    lApp.textContent = `SKINTEL: ${serverUser.username}`;
    console.log("[SKINTEL] logged in as", serverUser.username, "| steamId:", serverUser.steamId || "(none)");
  } else {
    dot(dApp, "r");
    lApp.textContent = "SKINTEL: not logged in";
    console.log("[SKINTEL] not logged in — token present:", !!appToken, "| serverUser:", serverUser);
  }

  // 2. Steam inventory page
  const onSteam   = tabUrl.includes("steamcommunity.com") && /inventory/i.test(tabUrl);
  let tabSteamId  = steamIdFromUrl(tabUrl);
  const vanityName = vanityNameFromUrl(tabUrl);

  // Vanity URL (/id/{name}/inventory) — resolve to numeric SteamID64 automatically
  if (onSteam && !tabSteamId && vanityName) {
    dot(dSteam, "y");
    lSteam.textContent = "Vanity URL — resolving SteamID…";
    tabSteamId = await resolveVanitySteamId(vanityName, appToken);
  }

  resolvedSteamId = tabSteamId;

  if (onSteam && tabSteamId) {
    dot(dSteam, "g");
    lSteam.textContent = `Steam inventory ✓ (ID: ${tabSteamId})`;
  } else if (onSteam && vanityName) {
    dot(dSteam, "r");
    lSteam.textContent = "Could not resolve SteamID from this vanity URL";
  } else if (onSteam) {
    dot(dSteam, "y");
    lSteam.textContent = "Steam inventory page (no numeric ID in URL)";
  } else {
    dot(dSteam, "r");
    lSteam.textContent = "Not on Steam inventory page";
  }

  // 3. SteamID match check
  const serverSteamId = serverUser?.steamId;
  if (serverSteamId && tabSteamId) {
    if (serverSteamId === tabSteamId) {
      dot(dMatch, "g");
      lMatch.textContent = "SteamID match ✓";
    } else {
      dot(dMatch, "r");
      lMatch.textContent = `Mismatch: yours=${serverSteamId.slice(-4)}, page=${tabSteamId.slice(-4)}`;
    }
  } else {
    dot(dMatch, "y");
    lMatch.textContent = serverSteamId ? "Could not verify match" : "Login to SKINTEL first";
  }

  // 4. Decide enable state & hints
  const canImport = !!(appToken && onSteam && tabSteamId && serverSteamId === tabSteamId);
  importBtn.disabled = !canImport;

  if (!canImport) {
    const reasons = [];
    if (!appToken) reasons.push("not logged in to SKINTEL");
    if (!onSteam) reasons.push("not on a Steam inventory page");
    if (onSteam && !tabSteamId) reasons.push("could not determine SteamID for this page");
    if (serverSteamId && tabSteamId && serverSteamId !== tabSteamId) reasons.push("SteamID mismatch");
    console.log("[SKINTEL] import disabled —", reasons.join(", ") || "unknown reason");
  } else {
    console.log("[SKINTEL] import enabled");
  }

  if (!appToken) {
    hint('Open <a href="https://skin-tel.com" target="_blank">skin-tel.com</a> and log in with Steam, then reopen this popup.');
  } else if (onSteam && vanityName && !tabSteamId) {
    hint("Could not resolve your SteamID from this vanity URL. Make sure you're logged into SKINTEL with Steam linked, then reopen this popup.");
  } else if (!onSteam || !tabSteamId) {
    hint(`Go to <a href="https://steamcommunity.com/profiles/${serverSteamId || ""}/inventory" target="_blank">steamcommunity.com/profiles/${serverSteamId || "…"}/inventory</a> then click Import.`);
  } else if (serverSteamId && tabSteamId && serverSteamId !== tabSteamId) {
    hint("You can only import your own inventory. This page belongs to a different Steam account.");
  } else {
    noHint();
  }

  // 5. Last import info
  const last = await getLastImport(appToken);
  if (last?.importedAt) {
    lastEl.textContent = `Last import: ${timeAgo(last.importedAt)} · ${last.itemCount ?? 0} items`;
    lastEl.style.display = "block";
  }
}

/* ─── Import button ──────────────────────────────────── */
importBtn.addEventListener("click", async () => {
  importBtn.disabled = true;
  hideProgress();
  showMsg("Starting import…", "inf");

  chrome.tabs.sendMessage(
    activeTab.id,
    { type: "SKINTEL_IMPORT", token: appToken, steamId: resolvedSteamId },
    (response) => {
      hideProgress();

      if (chrome.runtime.lastError) {
        showMsg("Content script not ready — refresh the Steam page and try again.", "err");
        importBtn.disabled = false;
        return;
      }

      if (!response) {
        showMsg("No response. Refresh the Steam page and retry.", "err");
        importBtn.disabled = false;
        return;
      }

      if (response.ok) {
        if (response.empty || response.count === 0) {
          showMsg("✓ Imported — CS2 inventory is empty for this account.", "ok");
        } else {
          showMsg(`✓ Imported ${response.count} items successfully!`, "ok");
        }
        lastEl.textContent = `Last import: just now · ${response.count} items`;
        lastEl.style.display = "block";
        noHint();
      } else if (response.error === "STEAM_ID_MISMATCH") {
        showMsg("403 — You can only import your own Steam inventory.", "err");
      } else {
        showMsg("Import failed: " + (response.error || "Unknown error"), "err");
      }

      importBtn.disabled = false;
    }
  );
});

/* ─── Run ────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", init);
