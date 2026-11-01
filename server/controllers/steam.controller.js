import axios from "axios";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.model.js";
import InventoryCache from "../models/InventoryCache.model.js";
import ManualInventory from "../models/ManualInventory.model.js";
import ImportedInventory from "../models/ImportedInventory.model.js";
import { CLIENT_URL } from "../config/clientUrls.js";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const STEAM_ID_REGEX   = /https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)/;

/* ─── Browser-like headers ────────────────────────────
 *  Referer + Origin + Sec-Fetch-* mimic a real browser
 *  navigating within steamcommunity.com, which reduces
 *  the chance of Steam rejecting the request.
 * ───────────────────────────────────────────────────── */
const STEAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  Accept:            "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Referer:           "https://steamcommunity.com/",
  Origin:            "https://steamcommunity.com",
  "Cache-Control":   "no-cache",
  Pragma:            "no-cache",
  "Sec-Fetch-Site":  "same-origin",
  "Sec-Fetch-Mode":  "cors",
  "Sec-Fetch-Dest":  "empty",
};

/* Reasons that are transient and worth retrying */
const RETRYABLE = new Set([
  "network_error", "http_error", "rate_limited",
  "cloudflare_block", "cloudflare_challenge",
  "steam_blocked", "captcha_required", "parse_error",
]);

const MAX_RETRIES    = 3;   // attempts per endpoint
const RETRY_DELAY_MS = 2000;

function signToken(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET missing in .env");
  const exp = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign({ sub: String(userId) }, secret, { expiresIn: exp });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ─── Redirect user to Steam OpenID ──────────────────── */

export function steamLogin(req, res) {
  const serverUrl = process.env.SERVER_URL || "http://localhost:5055";
  const returnTo  = `${serverUrl}/api/steam/callback`;

  const params = new URLSearchParams({
    "openid.ns":         "http://specs.openid.net/auth/2.0",
    "openid.mode":       "checkid_setup",
    "openid.return_to":  returnTo,
    "openid.realm":      serverUrl,
    "openid.identity":   "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });

  const url = `${STEAM_OPENID_URL}?${params.toString()}`;
  console.log("[steam] login — redirecting:", url.slice(0, 80) + "...");
  res.redirect(url);
}

/* ─── Verify OpenID assertion ─────────────────────────── */

async function verifySteamAssertion(query) {
  const params = { ...query, "openid.mode": "check_authentication" };
  const body   = new URLSearchParams(params).toString();

  const { data } = await axios.post(STEAM_OPENID_URL, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000,
  });

  const valid = typeof data === "string" && data.includes("is_valid:true");
  console.log("[steam] verify — is_valid:", valid);
  return valid;
}

/* ─── Fetch public Steam profile ──────────────────────── */

async function fetchSteamProfile(steamId) {
  try {
    const { data } = await axios.get(
      `https://steamcommunity.com/profiles/${steamId}/?xml=1`,
      { timeout: 8000 }
    );
    const displayName =
      (data.match(/<steamID><!\[CDATA\[(.+?)\]\]><\/steamID>/) || [])[1] ||
      `Steam_${steamId.slice(-6)}`;
    const avatar =
      (data.match(/<avatarFull><!\[CDATA\[(.+?)\]\]><\/avatarFull>/) || [])[1] || "";
    const profileUrl =
      (data.match(/<steamIDURL><!\[CDATA\[(.+?)\]\]><\/steamIDURL>/) || [])[1] ||
      `https://steamcommunity.com/profiles/${steamId}`;
    return { displayName, avatar, profileUrl };
  } catch (err) {
    console.warn("[steam] profile fetch failed:", err.message);
    return {
      displayName: `Steam_${steamId.slice(-6)}`,
      avatar:      "",
      profileUrl:  `https://steamcommunity.com/profiles/${steamId}`,
    };
  }
}

/* ─── Resolve a Steam vanity name (steamcommunity.com/id/{vanity}) ────
 *  Uses the public profile XML endpoint — no Steam Web API key needed,
 *  same approach as fetchSteamProfile() above.
 * ─────────────────────────────────────────────────────────────────── */

const VANITY_NAME_REGEX = /^[\w-]{2,32}$/;

export async function resolveVanityUrl(req, res) {
  const vanity = String(req.params.vanity || "").trim();

  if (!VANITY_NAME_REGEX.test(vanity)) {
    return res.status(400).json({ ok: false, message: "Invalid Steam vanity name." });
  }

  try {
    const { data } = await axios.get(
      `https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`,
      { timeout: 8000, responseType: "text", headers: STEAM_HEADERS }
    );

    const body = String(data ?? "");
    const idMatch = body.match(/<steamID64>(\d{17})<\/steamID64>/);

    if (!idMatch) {
      console.warn(`[steam] resolve-vanity — no steamID64 found for "${vanity}"`);
      return res.json({ ok: false, message: "Could not resolve this Steam profile. It may not exist or is private." });
    }

    console.log(`[steam] resolve-vanity — "${vanity}" -> ${idMatch[1]}`);
    return res.json({ ok: true, steamId: idMatch[1] });
  } catch (err) {
    console.warn(`[steam] resolve-vanity error for "${vanity}":`, err.message);
    return res.status(502).json({ ok: false, message: "Could not reach Steam to resolve this profile." });
  }
}

/* ─── Unique username generator ──────────────────────── */

async function generateUsername(base) {
  const clean =
    (base || "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 20) || "steam_user";

  let username = clean;
  let n = 0;
  while (await User.exists({ username })) {
    n++;
    username = `${clean}_${n}`;
  }
  return username;
}

/* ─── Steam OpenID callback ───────────────────────────── */

export async function steamCallback(req, res) {
  const clientUrl = CLIENT_URL;
  console.log("[steam] callback reached — query keys:", Object.keys(req.query).join(", "));

  try {
    const claimedId = String(req.query["openid.claimed_id"] || "");
    console.log("[steam] claimed_id:", claimedId);

    const match = claimedId.match(STEAM_ID_REGEX);
    if (!match) {
      console.warn("[steam] could not extract steamId");
      return res.redirect(`${clientUrl}/login?error=steam_invalid_id`);
    }

    const steamId = match[1];
    console.log("[steam] extracted steamId:", steamId);

    const valid = await verifySteamAssertion(req.query);
    if (!valid) {
      console.warn("[steam] OpenID verification failed");
      return res.redirect(`${clientUrl}/login?error=steam_auth_failed`);
    }

    const profile = await fetchSteamProfile(steamId);
    let user = await User.findOne({ steamId });

    if (!user) {
      const username = await generateUsername(profile.displayName);
      user = await User.create({
        username,
        steamId,
        steamDisplayName: profile.displayName,
        steamProfileUrl:  profile.profileUrl,
        avatarUrl:        profile.avatar,
        fullName:         profile.displayName,
      });
      console.log("[steam] user created:", user._id.toString());
    } else {
      await User.findByIdAndUpdate(user._id, {
        steamDisplayName: profile.displayName,
        steamProfileUrl:  profile.profileUrl,
        ...(profile.avatar ? { avatarUrl: profile.avatar } : {}),
      });
      user = await User.findById(user._id);
      console.log("[steam] user updated:", user._id.toString());
    }

    const token = signToken(user._id);
    const redirectUrl = `${clientUrl}/steam/callback?token=${encodeURIComponent(token)}`;
    console.log("[steam] redirecting to client:", redirectUrl.replace(/token=.+/, "token=[JWT]"));
    res.redirect(redirectUrl);
  } catch (err) {
    console.error("[steam] steamCallback error:", err);
    res.redirect(`${clientUrl}/login?error=steam_server_error`);
  }
}

/* ─── GET /api/steam/me ───────────────────────────────── */

export function steamMe(req, res) {
  const u = req.user;
  console.log("[steam] /me — userId:", String(u._id),
    "| username:", u.username,
    "| steamId:", u.steamId || "(none)");
  res.json({
    ok: true,
    user: {
      id:               String(u._id),
      username:         u.username,
      fullName:         u.fullName   || "",
      email:            u.email      || null,
      avatarUrl:        u.avatarUrl  || "",
      steamId:          u.steamId    || null,
      steamDisplayName: u.steamDisplayName || "",
      steamProfileUrl:  u.steamProfileUrl  || "",
    },
  });
}

/* ═══════════════════════════════════════════════════════
   INVENTORY SYSTEM
   — low-level fetch
   — two-endpoint strategy with per-endpoint retries
   — MongoDB cache (read on failure, write on success)
═══════════════════════════════════════════════════════ */

/* ── Single HTTP fetch — never throws ── */
async function fetchSteamUrl(url, label) {
  console.log(`[steam] [${label}] GET ${url}`);

  let r;
  try {
    r = await axios.get(url, {
      timeout:        15_000,
      validateStatus: () => true,
      responseType:   "text",
      decompress:     true,
      headers:        STEAM_HEADERS,
    });
  } catch (netErr) {
    console.error(`[steam] [${label}] network error: ${netErr.message}`);
    return { ok: false, reason: "network_error", error: netErr.message };
  }

  const bodyStr      = String(r.data ?? "");
  const ct           = String(r.headers["content-type"] || "");
  const isHtml       = ct.includes("text/html") || bodyStr.trimStart().startsWith("<");
  const isCloudflare = !!(r.headers["cf-ray"] || r.headers["cf-cache-status"]);
  const isRateLimit  = r.status === 429;
  const isCaptcha    = isHtml && /captcha/i.test(bodyStr);

  console.log(`[steam] [${label}] status: ${r.status} | ct: ${ct} | bytes: ${bodyStr.length} | html: ${isHtml} | cf: ${isCloudflare} | rl: ${isRateLimit}`);
  console.log(`[steam] [${label}] body[:200]: ${bodyStr.slice(0, 200)}`);

  if (r.headers["cf-ray"]) console.log(`[steam] [${label}] cf-ray: ${r.headers["cf-ray"]}`);
  if (r.headers["retry-after"]) console.log(`[steam] [${label}] retry-after: ${r.headers["retry-after"]}`);

  if (r.status !== 200) {
    const reason = isRateLimit  ? "rate_limited"
                 : isCloudflare ? "cloudflare_block"
                 :                "http_error";
    console.warn(`[steam] [${label}] non-200 (${r.status}) → reason: ${reason}`);
    return { ok: false, reason, status: r.status };
  }

  if (isHtml) {
    const reason = isCaptcha    ? "captcha_required"
                 : isCloudflare ? "cloudflare_challenge"
                 :                "steam_blocked";
    console.warn(`[steam] [${label}] HTML response → reason: ${reason}`);
    return { ok: false, reason };
  }

  let data;
  try {
    data = JSON.parse(bodyStr);
  } catch (parseErr) {
    console.error(`[steam] [${label}] JSON.parse failed: ${parseErr.message}`);
    return { ok: false, reason: "steam_blocked", error: parseErr.message };
  }

  if (data === null) {
    console.warn(`[steam] [${label}] Steam returned literal JSON null`);
    return { ok: false, reason: "null_response" };
  }

  console.log(`[steam] [${label}] ✅ JSON OK — top keys: ${Object.keys(data).join(", ")}`);
  return { ok: true, data };
}

/* ── Shared item builder ── */
function buildItem(assetId, classId, instanceId, amount, desc) {
  const tag      = cat => (desc.tags ?? []).find(t => t.category === cat);
  const rarity   = tag("Rarity");
  const exterior = tag("Exterior");
  const type     = tag("Type");
  const weapon   = tag("Weapon");

  return {
    assetId,
    classId,
    instanceId,
    amount,
    name:       desc.market_hash_name || desc.name || "",
    iconUrl:    desc.icon_url
      ? `https://community.akamai.steamstatic.com/economy/image/${desc.icon_url}/360fx360f`
      : "",
    tradable:   desc.tradable   === 1,
    marketable: desc.marketable === 1,
    rarity:   rarity   ? { name: rarity.localized_tag_name,   color: `#${rarity.color}` } : null,
    exterior: exterior ? exterior.localized_tag_name : null,
    type:     type     ? type.localized_tag_name     : null,
    weapon:   weapon   ? weapon.localized_tag_name   : null,
  };
}

/* ── Endpoint 1: /inventory/:id/730/2 ── */
function normalizeEndpoint1(data) {
  const s = data?.success;
  console.log(`[steam] normalizeEP1 — success: ${JSON.stringify(s)}, assets: ${data?.assets?.length ?? "n/a"}`);
  if (!data || (s !== 1 && s !== true)) return null;
  if (!data.assets || data.assets.length === 0) return [];

  const descMap = {};
  for (const d of data.descriptions ?? []) {
    descMap[`${d.classid}_${d.instanceid}`] = d;
  }
  return data.assets.map(a =>
    buildItem(a.assetid, a.classid, a.instanceid, a.amount,
      descMap[`${a.classid}_${a.instanceid}`] ?? {})
  );
}

/* ── Endpoint 2: /profiles/:id/inventory/json/730/2/ ── */
function normalizeEndpoint2(data) {
  const s = data?.success;
  const successOk = s === true || s === 1 || s === "true";
  const invCount  = Object.keys(data?.rgInventory ?? {}).length;
  const descCount = Object.keys(data?.rgDescriptions ?? {}).length;

  console.log(`[steam] normalizeEP2 — success: ${JSON.stringify(s)} (ok:${successOk}), rgInventory: ${invCount}, rgDescriptions: ${descCount}`);
  if (!data || !successOk) return null;

  const rgInv  = data.rgInventory    ?? {};
  const rgDesc = data.rgDescriptions ?? {};
  const assets = Object.values(rgInv);
  if (assets.length === 0) return [];

  return assets.map(a => {
    const desc = rgDesc[`${a.classid}_${a.instanceid ?? "0"}`]
              ?? rgDesc[`${a.classid}_0`]
              ?? {};
    return buildItem(a.id, a.classid, a.instanceid ?? "0", a.amount, desc);
  });
}

/* ── Fetch from Steam with per-endpoint retries ──────────────────
 *
 *  For each endpoint:
 *    - Up to MAX_RETRIES attempts
 *    - RETRY_DELAY_MS between attempts (fixed delay)
 *    - Retries only for transient failures (network, rate-limit, CF…)
 *    - Breaks immediately for definitive failures (null, private)
 *  Returns { ok:true, items } on first success, or { ok:false } if all fail.
 * ──────────────────────────────────────────────────────────────── */
async function fetchInventoryLive(steamId) {
  const endpoints = [
    {
      label:     "EP1 /inventory API",
      // NOTE: the query param is lowercase letter L (language), not digit 1
      url:       `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=5000`,
      normalize: normalizeEndpoint1,
    },
    {
      label:     "EP2 /profile legacy JSON",
      url:       `https://steamcommunity.com/profiles/${steamId}/inventory/json/730/2/`,
      normalize: normalizeEndpoint2,
    },
  ];

  let overallLastReason = "unknown";

  for (const ep of endpoints) {
    let epLastReason = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 1) {
        console.log(`[steam] [${ep.label}] waiting ${RETRY_DELAY_MS}ms before attempt ${attempt}/${MAX_RETRIES}...`);
        await sleep(RETRY_DELAY_MS);
      }

      const fetched = await fetchSteamUrl(ep.url, `${ep.label} #${attempt}`);

      if (!fetched.ok) {
        epLastReason = fetched.reason;
        if (RETRYABLE.has(fetched.reason)) {
          console.warn(`[steam] [${ep.label}] transient failure (${fetched.reason}) — will retry`);
          continue;
        }
        // Definitive — skip remaining retries for this endpoint
        console.warn(`[steam] [${ep.label}] definitive failure (${fetched.reason}) — skipping retries`);
        break;
      }

      // ── Normalize ──
      let items;
      try {
        items = ep.normalize(fetched.data);
      } catch (normErr) {
        console.error(`[steam] [${ep.label}] normalize threw: ${normErr.message}`);
        epLastReason = "normalize_error";
        continue;
      }

      if (items === null) {
        epLastReason = "private_or_invalid";
        console.warn(`[steam] [${ep.label}] normalize returned null — definitive`);
        break;
      }

      // ✅ Success
      console.log(`[steam] [${ep.label}] ✅ ${items.length} items fetched for ${steamId}`);
      return { ok: true, items, reason: null };
    }

    overallLastReason = epLastReason ?? "unknown";
    console.warn(`[steam] [${ep.label}] all attempts exhausted — last reason: ${overallLastReason}`);
  }

  return { ok: false, reason: overallLastReason };
}

/* ── Save to cache ── */
async function saveToCache(steamId, userId, items) {
  try {
    const fetchedAt = new Date();
    await InventoryCache.findOneAndUpdate(
      { steamId },
      { steamId, userId, items, fetchedAt },
      { upsert: true, new: true }
    );
    console.log(`[steam] cache saved — ${items.length} items for ${steamId}`);
    return fetchedAt;
  } catch (err) {
    console.warn(`[steam] cache save failed: ${err.message}`);
    return new Date();
  }
}

/* ── Load from cache ── */
async function loadFromCache(steamId) {
  try {
    const doc = await InventoryCache.findOne({ steamId }).lean();
    if (doc && Array.isArray(doc.items) && doc.items.length > 0) {
      console.log(`[steam] cache hit — ${doc.items.length} items for ${steamId}, fetchedAt: ${doc.fetchedAt}`);
      return doc;
    }
    console.log(`[steam] cache miss for ${steamId}`);
    return null;
  } catch (err) {
    console.warn(`[steam] cache load failed: ${err.message}`);
    return null;
  }
}

/* Inventories don't change every minute — a fetch within this window is
   served straight from the Mongo cache instead of hitting Steam live. The
   explicit POST /refresh endpoint below always bypasses this and forces a
   live fetch, so users still have an on-demand way to get current data. */
const INVENTORY_FRESH_MS = 10 * 60 * 1000;

/* ═══════════════════════════════════════════════════════
   GET /api/steam/inventory/:steamId
   1. Serve the Mongo cache directly if it's fresh (< INVENTORY_FRESH_MS).
   2. Otherwise try a live fetch with retries across two endpoints.
   3. On success → save to cache, return fresh data.
   4. On failure → serve cache if available, even if stale.
   5. If no cache → return empty with a clear reason.
═══════════════════════════════════════════════════════ */

export async function steamInventory(req, res) {
  const { steamId } = req.params;

  if (!/^\d{17}$/.test(steamId)) {
    return res.json({ ok: false, message: "Invalid Steam ID — must be a 17-digit number." });
  }

  console.log(`\n[steam] ═══ inventory request for ${steamId} ═══`);

  // ── 0. Fresh cache → skip the live Steam round-trip entirely ──
  const cached = await loadFromCache(steamId);
  if (cached) {
    const fetchedAtDate = cached.fetchedAt instanceof Date ? cached.fetchedAt : new Date(cached.fetchedAt);
    const ageMs = Date.now() - fetchedAtDate.getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < INVENTORY_FRESH_MS) {
      console.log(`[steam] cache fresh (${Math.round(ageMs / 1000)}s old) — skipping live fetch for ${steamId}`);
      return res.json({
        ok:        true,
        items:     cached.items,
        total:     cached.items.length,
        cached:    true,
        fetchedAt: fetchedAtDate.toISOString(),
      });
    }
  }

  // ── 1. Live fetch (cache missing or stale) ──
  const live = await fetchInventoryLive(steamId);

  if (live.ok) {
    const fetchedAt = await saveToCache(steamId, req.user._id, live.items);
    return res.json({
      ok:        true,
      items:     live.items,
      total:     live.items.length,
      cached:    false,
      fetchedAt: fetchedAt.toISOString(),
    });
  }

  // ── 2. Live failed → fall back to cache even if stale ──
  console.log(`[steam] live failed (${live.reason}) — checking cache...`);

  if (cached) {
    const fetchedAt = cached.fetchedAt instanceof Date
      ? cached.fetchedAt.toISOString()
      : String(cached.fetchedAt);
    return res.json({
      ok:        true,
      items:     cached.items,
      total:     cached.items.length,
      cached:    true,
      fetchedAt,
      message:   "Showing last cached inventory.",
    });
  }

  // ── 3. Nothing available ──
  const r = live.reason;
  const message =
    r === "null_response"       ? "Steam's public inventory endpoint returned null for this account."
    : r === "private_or_invalid" ? "This Steam inventory is set to private."
    : r === "rate_limited"       ? "Steam is rate-limiting this server. Try again shortly."
    : (r === "cloudflare_block" || r === "cloudflare_challenge" || r === "captcha_required")
                                 ? "Steam is blocking automated requests. Try again in a few minutes."
    : "Steam returned no CS2 inventory data. No cached version is available.";

  return res.json({
    ok:     true,
    items:  [],
    total:  0,
    cached: false,
    reason: r,
    message,
  });
}

/* ═══════════════════════════════════════════════════════
   POST /api/steam/inventory/:steamId/refresh
   Force a fresh live fetch — ignores cache on read,
   updates cache on success.  Returns same shape as GET.
═══════════════════════════════════════════════════════ */

export async function refreshInventory(req, res) {
  const { steamId } = req.params;

  if (!/^\d{17}$/.test(steamId)) {
    return res.json({ ok: false, message: "Invalid Steam ID." });
  }

  console.log(`\n[steam] ═══ FORCE REFRESH for ${steamId} ═══`);

  const live = await fetchInventoryLive(steamId);

  if (live.ok) {
    const fetchedAt = await saveToCache(steamId, req.user._id, live.items);
    return res.json({
      ok:        true,
      items:     live.items,
      total:     live.items.length,
      cached:    false,
      fetchedAt: fetchedAt.toISOString(),
    });
  }

  // Live failed — still check cache so the client doesn't lose its previous data
  const cached = await loadFromCache(steamId);
  if (cached) {
    const fetchedAt = cached.fetchedAt instanceof Date
      ? cached.fetchedAt.toISOString()
      : String(cached.fetchedAt);
    return res.json({
      ok:        true,
      items:     cached.items,
      total:     cached.items.length,
      cached:    true,
      fetchedAt,
      message:   "Steam is unavailable. Showing last cached inventory.",
    });
  }

  return res.json({
    ok:     false,
    items:  [],
    total:  0,
    cached: false,
    reason: live.reason,
    message: "Could not reach Steam and no cache is available.",
  });
}

/* ═══════════════════════════════════════════════════════
   GET /api/steam/debug/:steamId
   Raw diagnostic — returns full response from both URLs.
═══════════════════════════════════════════════════════ */

export async function steamDebug(req, res) {
  const { steamId } = req.params;
  if (!/^\d{17}$/.test(steamId)) {
    return res.json({ ok: false, message: "Invalid Steam ID." });
  }

  const urls = [
    `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=5000`,
    `https://steamcommunity.com/profiles/${steamId}/inventory/json/730/2/`,
  ];

  const results = [];
  for (const url of urls) {
    let entry = { url };
    try {
      const r = await axios.get(url, {
        timeout: 15_000, validateStatus: () => true,
        responseType: "text", decompress: true, headers: STEAM_HEADERS,
      });
      const bodyStr      = String(r.data ?? "");
      const ct           = r.headers["content-type"] || "";
      const isHtml       = ct.includes("text/html") || bodyStr.trimStart().startsWith("<");
      const isCloudflare = !!(r.headers["cf-ray"] || r.headers["cf-cache-status"]);
      let parsed = null; let parseError = null;
      if (!isHtml) { try { parsed = JSON.parse(bodyStr); } catch (e) { parseError = e.message; } }
      entry = {
        url, status: r.status, contentType: ct,
        bodyLengthBytes: bodyStr.length, isHtml, isCloudflare,
        isRateLimit: r.status === 429,
        isCaptcha: isHtml && /captcha/i.test(bodyStr),
        cfRay: r.headers["cf-ray"] || null,
        server: r.headers["server"] || null,
        bodyPreview: bodyStr.slice(0, 4000),
        parsedTopKeys: parsed ? Object.keys(parsed) : null,
        parsedSuccess: parsed?.success ?? null,
        parsedAssets: Array.isArray(parsed?.assets) ? parsed.assets.length : null,
        parsedRgInv: parsed?.rgInventory ? Object.keys(parsed.rgInventory).length : null,
        parseError,
      };
    } catch (err) {
      entry = { url, networkError: err.message };
    }
    results.push(entry);
  }

  // Also include cache info
  const cached = await loadFromCache(steamId);

  return res.json({
    ok: true, steamId, results,
    cache: cached
      ? { exists: true, itemCount: cached.items.length, fetchedAt: cached.fetchedAt }
      : { exists: false },
  });
}

/* ═══════════════════════════════════════════════════════
   INVENTORY IMPORT — safe, credential-free

   Architecture for authenticated inventory without cookies:

   Source A — Manual paste (implemented now)
     User opens:
       https://steamcommunity.com/inventory/STEAMID/730/2?l=english&count=5000
     in their browser while logged into Steam, copies the JSON,
     and pastes it here.  We parse it server-side with the same
     normalizeEndpoint1() function used for live fetches.

   Source B — Browser extension (future, protocol defined here)
     The extension runs in the user's own browser.  When the user
     visits their Steam inventory page the extension:
       1. Reads the page DOM / XHR response (already authenticated
          because the user's browser is logged into Steam)
       2. Extracts ONLY the safe fields listed in EXTENSION_ITEM_FIELDS
       3. POSTs the sanitized array to POST /api/steam/inventory/import
          authenticated with the user's app JWT (already in localStorage)
       4. NEVER sends Steam session cookies, steamLoginSecure, or any
          credential of any kind to our backend

   Security guarantee:
     Our backend accepts only the fields in EXTENSION_ITEM_FIELDS.
     Every other field is stripped during sanitization before storage.
     The steamId in the request body must match req.user.steamId.
═══════════════════════════════════════════════════════ */

const EXTENSION_ITEM_FIELDS = ["assetid", "classid", "instanceid", "amount",
  "name", "market_hash_name", "icon_url", "tradable", "marketable"];

/* Strip every field that isn't in the allow-list */
function sanitizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;

  const assetId    = String(raw.assetid    || raw.assetId    || "").trim();
  const name       = String(raw.market_hash_name || raw.name || "").trim().slice(0, 300);
  const iconUrl    = String(raw.icon_url   || raw.iconUrl   || "").trim().slice(0, 500);

  if (!assetId || !name) return null;   // skip items with no identity

  const tag = cat => (raw.tags ?? []).find(t => t.category === cat);
  const rarity   = tag("Rarity");
  const exterior = tag("Exterior");
  const type     = tag("Type");
  const weapon   = tag("Weapon");

  return {
    assetId,
    classId:    String(raw.classid    || raw.classId    || ""),
    instanceId: String(raw.instanceid || raw.instanceId || "0"),
    amount:     String(raw.amount || "1"),
    name,
    iconUrl: iconUrl
      ? (iconUrl.startsWith("http")
          ? iconUrl
          : `https://community.akamai.steamstatic.com/economy/image/${iconUrl}/360fx360f`)
      : "",
    tradable:   raw.tradable   === 1 || raw.tradable   === true,
    marketable: raw.marketable === 1 || raw.marketable === true,
    rarity:   rarity   ? { name: rarity.localized_tag_name,   color: `#${rarity.color}` } : null,
    exterior: exterior ? exterior.localized_tag_name : null,
    type:     type     ? type.localized_tag_name     : null,
    weapon:   weapon   ? weapon.localized_tag_name   : null,
  };
}

/* ─── POST /api/steam/inventory/import ───────────────
 *
 *  Accepts two shapes:
 *
 *  1. source:"extension"  — pre-enumerated item array
 *     { source:"extension", steamId, items:[{name, market_hash_name,
 *       icon_url, assetid, tradable, marketable, ...}] }
 *
 *  2. source:"manual"     — raw Steam inventory JSON string
 *     { source:"manual", steamId, raw: "<pasted JSON string>" }
 *
 *  Both paths sanitize server-side.  steamId must match the
 *  logged-in user's steamId (prevents importing for other accounts).
 * ─────────────────────────────────────────────────── */
export async function importInventory(req, res) {
  const { source = "manual", steamId, items: rawItems, raw } = req.body ?? {};
  const me = req.user;

  // steamId must match the authenticated user
  if (!steamId || !/^\d{17}$/.test(steamId)) {
    return res.json({ ok: false, message: "Missing or invalid steamId." });
  }
  if (me.steamId && String(me.steamId) !== String(steamId)) {
    return res.status(403).json({ ok: false, message: "steamId does not match your account." });
  }

  let itemsToSave = [];

  if (source === "extension") {
    // ── Path A: extension sent a pre-enumerated array ──
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.json({ ok: false, message: "items array is empty or missing." });
    }
    itemsToSave = rawItems.map(sanitizeItem).filter(Boolean);

  } else {
    // ── Path B: manual paste of raw Steam inventory JSON ──
    let parsed;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      return res.json({ ok: false, message: "Could not parse inventory JSON: " + e.message });
    }

    // Accept both endpoint1 shape { assets, descriptions } and
    // endpoint2 shape { rgInventory, rgDescriptions }
    if (parsed?.assets) {
      // endpoint1 shape — reuse existing normalizer
      const normalized = normalizeEndpoint1(parsed);
      if (normalized === null) {
        return res.json({ ok: false, message: "Inventory JSON appears private or malformed." });
      }
      itemsToSave = normalized;
    } else if (parsed?.rgInventory) {
      // endpoint2 shape
      const normalized = normalizeEndpoint2(parsed);
      if (normalized === null) {
        return res.json({ ok: false, message: "Inventory JSON appears private or malformed." });
      }
      itemsToSave = normalized;
    } else if (Array.isArray(parsed)) {
      // Plain array of item objects (e.g. copied from extension)
      itemsToSave = parsed.map(sanitizeItem).filter(Boolean);
    } else {
      return res.json({ ok: false, message: "Unrecognised inventory JSON format." });
    }
  }

  if (itemsToSave.length === 0) {
    return res.json({ ok: false, message: "No valid items found after sanitization." });
  }

  // Save to cache
  const fetchedAt = await saveToCache(steamId, me._id, itemsToSave);
  console.log(`[steam] import — saved ${itemsToSave.length} items for ${steamId} (source: ${source})`);

  return res.json({
    ok:        true,
    imported:  itemsToSave.length,
    steamId,
    fetchedAt: fetchedAt.toISOString(),
    source,
  });
}

/* ─── GET /api/steam/trade-url ────────────────────── */
export function getTradeUrl(req, res) {
  res.json({ ok: true, tradeUrl: req.user.tradeUrl || "" });
}

/* ─── POST /api/steam/trade-url ───────────────────── */
export async function saveTradeUrl(req, res) {
  const raw = String(req.body?.tradeUrl || "").trim();

  // Basic validation: must be empty or a real Steam trade URL
  if (raw && !raw.startsWith("https://steamcommunity.com/tradeoffer/new/")) {
    return res.status(400).json({ ok: false, message: "Invalid Steam trade URL format." });
  }

  await User.findByIdAndUpdate(req.user._id, { tradeUrl: raw });
  console.log(`[steam] trade URL saved for user ${req.user._id}`);
  res.json({ ok: true, tradeUrl: raw });
}

/* ═══════════════════════════════════════════════════════
   MANUAL INVENTORY CRUD
   Items entered by the user directly — no Steam API needed.
   Each item is one MongoDB document; individual deletes work
   without rewriting an entire array.
═══════════════════════════════════════════════════════ */

function normalizeManualItem(doc) {
  return {
    assetId:    String(doc._id),
    classId:    "",
    instanceId: "0",
    amount:     "1",
    name:       doc.name,
    iconUrl:    doc.iconUrl || "",
    tradable:   doc.tradable,
    marketable: doc.marketable,
    rarity:     null,
    exterior:   doc.wear || null,
    type:       null,
    weapon:     null,
    source:     "manual",
    manualId:   String(doc._id),
  };
}

/* ─── GET /api/steam/manual ───────────────────────── */
export async function getManualItems(req, res) {
  try {
    const docs = await ManualInventory
      .find({ userId: req.user._id })
      .sort({ createdAt: 1 })
      .lean();
    res.json({ ok: true, items: docs.map(normalizeManualItem) });
  } catch (err) {
    console.error("[steam] getManualItems:", err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
}

/* ─── POST /api/steam/manual ──────────────────────── */
export async function addManualItem(req, res) {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 300);
    if (!name) return res.status(400).json({ ok: false, message: "Item name is required." });

    const doc = await ManualInventory.create({
      userId:     req.user._id,
      name,
      wear:       String(req.body?.wear       || "").trim(),
      iconUrl:    String(req.body?.iconUrl    || "").trim().slice(0, 500),
      tradable:   req.body?.tradable   !== false && req.body?.tradable   !== "false",
      marketable: req.body?.marketable !== false && req.body?.marketable !== "false",
    });

    console.log(`[steam] manual item added: "${name}" for user ${req.user._id}`);
    res.json({ ok: true, item: normalizeManualItem(doc) });
  } catch (err) {
    console.error("[steam] addManualItem:", err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
}

/* ─── DELETE /api/steam/manual/:itemId ───────────── */
export async function deleteManualItem(req, res) {
  try {
    const { itemId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ ok: false, message: "Invalid item ID." });
    }

    const result = await ManualInventory.findOneAndDelete({
      _id: itemId,
      userId: req.user._id,
    });

    if (!result) return res.status(404).json({ ok: false, message: "Item not found." });

    console.log(`[steam] manual item deleted: ${itemId} for user ${req.user._id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[steam] deleteManualItem:", err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
}

/* ─── DELETE /api/steam/manual (clear all) ─────── */
export async function clearManualItems(req, res) {
  try {
    const { deletedCount } = await ManualInventory.deleteMany({ userId: req.user._id });
    console.log(`[steam] cleared ${deletedCount} manual items for user ${req.user._id}`);
    res.json({ ok: true, deleted: deletedCount });
  } catch (err) {
    console.error("[steam] clearManualItems:", err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
}

/* ═══════════════════════════════════════════════════════
   EXTENSION-IMPORTED INVENTORY
   ───────────────────────────────────────────────────────
   Security model:
   • Items arrive from the browser extension, which reads
     the user's Steam inventory from their own browser
     session (Steam cookies are never sent to us).
   • The extension authenticates to this API using the
     user's existing JWT — no new credential is involved.
   • Backend strips every field outside the allow-list
     before persisting.
   • steamId in the payload must match the authenticated
     user's steamId to prevent cross-account imports.
═══════════════════════════════════════════════════════ */

const ALLOWED_TAG_CATEGORIES = new Set(["Rarity", "Exterior", "Type", "Weapon", "ItemSet"]);

function sanitizeImportedItem(raw) {
  if (!raw || typeof raw !== "object") return null;

  const assetId  = String(raw.assetid         || raw.assetId  || "").trim();
  const hashName = String(raw.market_hash_name || raw.name    || "").trim().slice(0, 300);
  if (!assetId || !hashName) return null;

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .filter(t => t && ALLOWED_TAG_CATEGORIES.has(t.category))
        .map(t => ({
          category:           String(t.category           || ""),
          internal_name:      String(t.internal_name      || "").slice(0, 100),
          localized_tag_name: String(t.localized_tag_name || "").slice(0, 100),
          color:              String(t.color              || "").replace(/[^0-9a-fA-F]/g, "").slice(0, 6),
        }))
    : [];

  const tagBycat    = cat => tags.find(t => t.category === cat);
  const rarityTag   = tagBycat("Rarity");
  const exteriorTag = tagBycat("Exterior");
  const typeTag     = tagBycat("Type");
  const weaponTag   = tagBycat("Weapon");

  const iconRaw = String(raw.icon_url || raw.iconUrl || "").trim().slice(0, 500);

  return {
    assetId,
    classId:         String(raw.classid    || raw.classId    || "").trim(),
    instanceId:      String(raw.instanceid || raw.instanceId || "0").trim(),
    amount:          String(raw.amount || "1"),
    name:            String(raw.name || "").trim().slice(0, 300),
    marketHashName:  hashName,
    iconUrl: iconRaw
      ? (iconRaw.startsWith("http")
          ? iconRaw
          : `https://community.akamai.steamstatic.com/economy/image/${iconRaw}/360fx360f`)
      : "",
    tradable:        raw.tradable   === 1 || raw.tradable   === true,
    marketable:      raw.marketable === 1 || raw.marketable === true,
    rarity:   rarityTag   ? { name: rarityTag.localized_tag_name,   color: `#${rarityTag.color}` }   : null,
    exterior: exteriorTag ? exteriorTag.localized_tag_name : null,
    type:     typeTag     ? typeTag.localized_tag_name     : null,
    weapon:   weaponTag   ? weaponTag.localized_tag_name   : null,
    tags,
  };
}

/* ─── POST /api/steam/imported-inventory ─────────────
 *  Called by the browser extension after it reads
 *  the user's Steam inventory from their own session.
 * ─────────────────────────────────────────────────── */
export async function saveImportedInventory(req, res) {
  try {
    const { items: rawItems, steamId } = req.body ?? {};
    const me = req.user;

    if (!steamId || !/^\d{17}$/.test(String(steamId))) {
      return res.status(400).json({ ok: false, message: "Missing or invalid steamId." });
    }

    // steamId must match the authenticated user — prevents importing for other accounts
    if (me.steamId && String(me.steamId) !== String(steamId)) {
      return res.status(403).json({ ok: false, message: "steamId does not match your account." });
    }

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ ok: false, message: "items array is empty or missing." });
    }

    const items = rawItems.map(sanitizeImportedItem).filter(Boolean);
    if (items.length === 0) {
      return res.status(400).json({ ok: false, message: "No valid items after sanitization." });
    }

    const importedAt = new Date();
    await ImportedInventory.findOneAndUpdate(
      { userId: me._id },
      { userId: me._id, steamId: String(steamId), items, importedAt, itemCount: items.length },
      { upsert: true, new: true }
    );

    console.log(`[steam] imported-inventory saved — ${items.length} items for user ${me._id} (steamId: ${steamId})`);
    return res.json({ ok: true, imported: items.length, importedAt: importedAt.toISOString() });
  } catch (err) {
    console.error("[steam] saveImportedInventory:", err.message);
    return res.status(500).json({ ok: false, message: err.message });
  }
}

/* ─── GET /api/steam/imported-inventory ──────────── */
export async function getImportedInventory(req, res) {
  try {
    const doc = await ImportedInventory.findOne({ userId: req.user._id }).lean();
    return res.json({
      ok:         true,
      items:      doc?.items      ?? [],
      itemCount:  doc?.itemCount  ?? 0,
      steamId:    doc?.steamId    ?? null,
      importedAt: doc?.importedAt ?? null,
    });
  } catch (err) {
    console.error("[steam] getImportedInventory:", err.message);
    return res.status(500).json({ ok: false, message: err.message });
  }
}

/* ─── DELETE /api/steam/imported-inventory ───────── */
export async function clearImportedInventory(req, res) {
  try {
    await ImportedInventory.findOneAndDelete({ userId: req.user._id });
    console.log(`[steam] imported-inventory cleared for user ${req.user._id}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[steam] clearImportedInventory:", err.message);
    return res.status(500).json({ ok: false, message: err.message });
  }
}

/* ═══════════════════════════════════════════════════════
   EXTENSION IMPORT ENDPOINTS
   ── POST /api/steam/import       called by Chrome extension
   ── GET  /api/steam/inventory    returns the user's imported items
   These are the main endpoints consumed by the extension and the
   Inventory React page.
═══════════════════════════════════════════════════════ */

/* ─── POST /api/steam/import ──────────────────────────
 *  Chrome extension POSTs sanitised CS2 items here.
 *  JWT is required.  steamId must match the logged-in user.
 *  Server re-sanitises every item before storage.
 * ──────────────────────────────────────────────────── */
export async function extensionImport(req, res) {
  try {
    console.log("[IMPORT] body keys:", Object.keys(req.body || {}));
    console.log("[IMPORT] steamId:", req.body?.steamId);
    console.log("[IMPORT] items length:", Array.isArray(req.body?.items) ? req.body.items.length : "not array");
    console.log("[IMPORT] user steamId:", req.user?.steamId);

    const { items: rawItems, steamId } = req.body ?? {};
    const me = req.user;

    if (!steamId || !/^\d{17}$/.test(String(steamId))) {
      return res.status(400).json({ ok: false, error: "Missing or invalid steamId." });
    }

    // Always enforce match — user must have a linked Steam account and it must match
    if (!me.steamId || String(me.steamId) !== String(steamId)) {
      console.warn(`[IMPORT] STEAM_ID_MISMATCH — user:${me.steamId} body:${steamId}`);
      return res.status(403).json({ ok: false, error: "STEAM_ID_MISMATCH" });
    }

    if (!Array.isArray(rawItems)) {
      return res.status(400).json({ ok: false, error: "items must be an array." });
    }

    if (rawItems.length === 0) {
      return res.status(400).json({ ok: false, error: "NO_ITEMS_PARSED" });
    }

    const items = rawItems.map(sanitizeImportedItem).filter(Boolean);
    console.log(`[IMPORT] received ${rawItems.length} items, ${items.length} passed sanitization`);

    if (items.length === 0) {
      console.warn("[IMPORT] all items failed sanitization — first raw item:", JSON.stringify(rawItems[0]).slice(0, 200));
      return res.status(400).json({ ok: false, error: "NO_ITEMS_PARSED" });
    }

    if (items.length > 0) {
      console.log("[IMPORT] sample sanitized item:", JSON.stringify(items[0]).slice(0, 200));
    }

    const now = new Date();
    await ImportedInventory.findOneAndUpdate(
      { userId: me._id },
      { userId: me._id, steamId: String(steamId), items, importedAt: now, updatedAt: now, itemCount: items.length },
      { upsert: true, new: true }
    );

    console.log(`[IMPORT] saved ${items.length} items for user ${me._id} (steamId: ${steamId})`);
    return res.json({ ok: true, count: items.length, steamId });
  } catch (err) {
    console.error("[IMPORT] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ─── GET /api/steam/inventory ────────────────────────
 *  Returns the logged-in user's extension-imported inventory.
 *  Used by the React Inventory page to load persisted items.
 * ──────────────────────────────────────────────────── */
export async function getUserImportedInventory(req, res) {
  try {
    const doc = await ImportedInventory.findOne({ userId: req.user._id }).lean();
    return res.json({
      ok:         true,
      items:      doc?.items      ?? [],
      itemCount:  doc?.itemCount  ?? 0,
      steamId:    doc?.steamId    ?? null,
      importedAt: doc?.importedAt ?? null,
    });
  } catch (err) {
    console.error("[steam] getUserImportedInventory:", err.message);
    return res.status(500).json({ ok: false, message: err.message });
  }
}
