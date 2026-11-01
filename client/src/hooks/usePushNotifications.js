import { useState, useEffect, useCallback, useRef } from "react";
import { getToken, deleteToken, onMessage } from "firebase/messaging";
import { getFirebaseMessaging, isFirebaseConfigured } from "../lib/firebase";
import useAuth from "./useAuth";
import api from "../lib/api";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const LS_KEY         = "skintel_push_enabled";
const LS_LAST_SAVED  = "skintel_push_last_saved";   // unix ms of last successful token registration
const LS_PROBE_LOG   = "skintel_push_probe_log";    // circular log of last 20 probe()/request() events
const REFRESH_AFTER_MS = 60 * 60 * 1000;            // re-register token if >1h since last save (was 6h)

// Append an entry to the circular probe log (max 20 entries, stored in localStorage).
function writeProbeLog(entry) {
  try {
    const prev = JSON.parse(localStorage.getItem(LS_PROBE_LOG) || "[]");
    localStorage.setItem(LS_PROBE_LOG, JSON.stringify([entry, ...prev].slice(0, 20)));
  } catch { /* ignore quota/parse errors */ }
}

// Push subscription endpoints identify a device channel — log tails only.
const endpointTail = (e) => (e ? "..." + String(e).slice(-16) : "(none)");

// Force-delete the Firebase token, then return a fresh token.
//
// DIAGNOSTIC MODE: logs push subscription endpoint before deleteToken() and
// after getToken() so we can verify on Android Chrome whether deleteToken()
// alone causes getToken() to return a different token (new subscription) or
// the same token (same cached subscription, still stale).
//
// If before-endpoint == after-endpoint → same subscription re-derived → stale
// token returned → pushManager.unsubscribe() fix needed.
// If before-endpoint != after-endpoint → new subscription created → stale
// subscription was NOT the cause; look elsewhere (VAPID/project mismatch).
async function _forceFreshToken(messaging, swReg) {
  // ── DIAGNOSTIC: snapshot the current push subscription before deleteToken ──
  let preEndpoint = null;
  let preSubExists = false;
  if (swReg) {
    try {
      const preSub = await swReg.pushManager.getSubscription();
      preSubExists = !!preSub;
      preEndpoint  = preSub?.endpoint ?? null;
      console.log(
        "[FCM] _forceFreshToken() PRE-deleteToken snapshot:",
        "\n  pushSubscription exists:", preSubExists,
        "\n  endpoint:", endpointTail(preEndpoint),
      );
    } catch (snapErr) {
      console.warn("[FCM] _forceFreshToken() PRE snapshot failed:", snapErr.message);
    }
  }

  try {
    await deleteToken(messaging);
    console.log("[FCM] _forceFreshToken() → deleteToken() ✓ — Firebase cache cleared");
  } catch (delErr) {
    // Expected on first-ever registration ("no FCM token to delete") — safe to ignore.
    console.log("[FCM] _forceFreshToken() → deleteToken() — nothing to clear:", delErr.message);
  }

  // ── DIAGNOSTIC: check whether deleteToken() changed the push subscription ──
  if (swReg) {
    try {
      const midSub = await swReg.pushManager.getSubscription();
      const midEndpoint = midSub?.endpoint ?? null;
      const sameEndpoint = midEndpoint === preEndpoint;
      console.log(
        "[FCM] _forceFreshToken() POST-deleteToken, PRE-getToken snapshot:",
        "\n  pushSubscription exists:", !!midSub,
        "\n  endpoint:", endpointTail(midEndpoint),
        "\n  same as before deleteToken():", sameEndpoint,
        sameEndpoint
          ? "⚠️ deleteToken() did NOT clear the push subscription — getToken() will likely re-derive the same FCM token"
          : "✓ push subscription changed after deleteToken()",
      );
    } catch (midErr) {
      console.warn("[FCM] _forceFreshToken() MID snapshot failed:", midErr.message);
    }
  }

  console.log(
    "[FCM] _forceFreshToken() → calling getToken()",
    "| vapidKey tail=..." + (VAPID_KEY ?? "").slice(-8),
    "| swReg:", swReg ? `scope=${swReg.scope} active=${!!swReg.active}` : "omitted",
  );
  const freshToken = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    ...(swReg ? { serviceWorkerRegistration: swReg } : {}),
  });

  // ── DIAGNOSTIC: compare the new token's subscription endpoint to the pre-deleteToken one ──
  if (swReg && freshToken) {
    try {
      const postSub = await swReg.pushManager.getSubscription();
      const postEndpoint = postSub?.endpoint ?? null;
      const sameEndpoint = postEndpoint === preEndpoint;
      console.log(
        "[FCM] _forceFreshToken() POST-getToken snapshot:",
        "\n  new token tail: ..." + freshToken.slice(-20),
        "\n  pushSubscription exists:", !!postSub,
        "\n  endpoint:", endpointTail(postEndpoint),
        "\n  same endpoint as PRE-deleteToken():", sameEndpoint,
        sameEndpoint
          ? "⚠️ SAME subscription re-derived — calling pushManager.unsubscribe() and retrying getToken()"
          : "✓ NEW subscription created — deleteToken() alone was sufficient",
      );

      if (sameEndpoint && postSub) {
        // deleteToken() did NOT clear the browser-level Web Push subscription.
        // On Android Chrome the push subscription is decoupled from the FCM token
        // cache — deleteToken() only clears the Firebase layer, not the underlying
        // Web Push subscription. Manually unsubscribe to force a genuinely new
        // subscription, then call getToken() again.
        await postSub.unsubscribe();
        console.log("[FCM] _forceFreshToken() → pushManager.unsubscribe() ✓ — retrying getToken()");
        const retryToken = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          ...(swReg ? { serviceWorkerRegistration: swReg } : {}),
        });
        if (retryToken) {
          console.log("[FCM] _forceFreshToken() ✓ retry succeeded — new tail: ..." + retryToken.slice(-20));
          return retryToken;
        }
        console.warn("[FCM] _forceFreshToken() — retry after unsubscribe returned empty token, falling back to original");
      }
    } catch (postErr) {
      console.warn("[FCM] _forceFreshToken() POST snapshot failed:", postErr.message);
    }
  }

  return freshToken;
}

/**
 * status values:
 *   "checking"            — initial async availability probe
 *   "no-config"           — VITE_FIREBASE_* env vars not set
 *   "browser-unsupported" — FCM isSupported() → false (old browser/iOS)
 *   "not-logged-in"       — no auth token, can't register a device
 *   "denied"              — Notification.permission === "denied"
 *   "ready"               — configured + permission default, awaiting user click
 *   "enabled"             — permission granted + token registered
 */
export default function usePushNotifications() {
  const { token: authToken } = useAuth();

  const [status,         setStatus]         = useState("checking");
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [swRegistered,   setSwRegistered]   = useState(null);
  const [fcmToken,       setFcmToken]       = useState(null);
  const [lastFgMessage,  setLastFgMessage]  = useState(null);
  const [lastSaveStatus, setLastSaveStatus] = useState(null);
  const [autoTestResult, setAutoTestResult] = useState(null);

  const fgUnsubRef = useRef(null);

  // ── Detect platform / browser for token metadata ──────────────────────────
  function getDeviceMeta() {
    const ua = navigator.userAgent || "";
    const platform = /android/i.test(ua)
      ? "android"
      : /ipad|iphone|ipod/i.test(ua)
      ? "ios"
      : "web";
    const browser = /firefox/i.test(ua)
      ? "Firefox"
      : /edg\//i.test(ua)
      ? "Edge"
      : /opr\//i.test(ua)
      ? "Opera"
      : /chrome/i.test(ua)
      ? "Chrome"
      : /safari/i.test(ua)
      ? "Safari"
      : "Unknown";
    return { platform, browser };
  }

  // ── Register /firebase-messaging-sw.js and post config to it ─────────────
  async function getFcmSwReg() {
    if (!("serviceWorker" in navigator)) {
      console.warn("[FCM] getFcmSwReg() → serviceWorker API not available in this browser");
      setSwRegistered(false);
      return null;
    }
    try {
      console.log("[FCM] getFcmSwReg() → registering /firebase-messaging-sw.js scope=/firebase-cloud-messaging-push-scope…");
      const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
        scope: "/firebase-cloud-messaging-push-scope",
      });
      console.log(
        "[FCM] getFcmSwReg() → register() resolved",
        "| scope:", reg.scope,
        "| active:", !!reg.active,
        "| active.state:", reg.active?.state ?? "n/a",
        "| waiting:", !!reg.waiting,
        "| installing:", !!reg.installing,
        "| installing.state:", reg.installing?.state ?? "n/a",
      );

      // Wait for the SW to become active (max 15 s — Android on slow connections
      // can take longer than 4 s to download importScripts from CDN).
      if (!reg.active) {
        console.log("[FCM] getFcmSwReg() → SW not yet active, waiting up to 15 s…");
        let redundant = false;
        await Promise.race([
          new Promise((resolve) => {
            const sw = reg.installing ?? reg.waiting;
            if (!sw) {
              console.warn("[FCM] getFcmSwReg() → no installing/waiting worker — registration may be stuck or failed");
              resolve();
              return;
            }
            console.log("[FCM] getFcmSwReg() → tracking statechange on", sw.scriptURL, "current state:", sw.state);
            sw.addEventListener("statechange", () => {
              console.log("[FCM] getFcmSwReg() → statechange →", sw.state);
              if (sw.state === "activated") { resolve(); return; }
              if (sw.state === "redundant") {
                redundant = true;
                console.error(
                  "[FCM] getFcmSwReg() → SW went REDUNDANT — firebase-messaging-sw.js installation FAILED.",
                  "Most common cause on Android: importScripts CDN (gstatic.com) blocked or timed out.",
                  "Check Application → Service Workers in DevTools for the install error.",
                );
                resolve();
              }
            });
          }),
          new Promise((r) => setTimeout(() => {
            console.warn("[FCM] getFcmSwReg() → 15 s timeout reached — SW still not active");
            r();
          }, 15000)),
        ]);

        if (redundant || !reg.active) {
          console.error(
            "[FCM] getFcmSwReg() → SW is not active after wait",
            "| redundant:", redundant,
            "| active:", !!reg.active,
            "| installing:", !!reg.installing,
            "— getToken() will likely fail. Returning null.",
          );
          setSwRegistered(false);
          return null;
        }
      }

      console.log(
        "[FCM] getFcmSwReg() ✓ | scope:", reg.scope,
        "| active:", !!reg.active,
        "| active.state:", reg.active?.state ?? "n/a",
      );
      setSwRegistered(true);
      return reg;
    } catch (err) {
      console.warn("[FCM] getFcmSwReg() → SW registration threw:", err.message, err);
      setSwRegistered(false);
      return null;
    }
  }

  // ── Save token to backend (shared by probe + request) ────────────────────
  async function _saveToken(token) {
    const { platform, browser } = getDeviceMeta();
    const tail = "..." + token.slice(-20);
    console.log("[FCM] _saveToken() → POST /push/register | platform=" + platform + " browser=" + browser + " tokenTail=" + tail);
    let res;
    try {
      res = await api.post("/push/register", { token, platform, browser });
      console.log("[FCM] _saveToken() → response status:", res.status, "| body:", JSON.stringify(res.data));
    } catch (err) {
      const httpStatus  = err?.response?.status ?? "network-error";
      const httpBody    = err?.response?.data   ?? null;
      const authHeader  = err?.config?.headers?.Authorization ? "Bearer …" + String(err.config.headers.Authorization).slice(-6) : "MISSING";
      console.error(
        "[FCM] _saveToken() → POST /push/register FAILED",
        "\n  httpStatus:", httpStatus,
        "\n  httpBody:", JSON.stringify(httpBody),
        "\n  authHeader:", authHeader,
        "\n  origin:", window.location.origin,
        "\n  err.message:", err.message,
      );
      throw err;
    }
    localStorage.setItem(LS_KEY,        "true");
    localStorage.setItem(LS_LAST_SAVED, String(Date.now()));
    // Verify writes (localStorage can silently fail in private/quota-limited browsers)
    const verKey   = localStorage.getItem(LS_KEY);
    const verSaved = localStorage.getItem(LS_LAST_SAVED);
    if (verKey !== "true" || !verSaved) {
      console.error("[FCM] _saveToken() → localStorage write verification FAILED | LS_KEY='" + verKey + "' LS_LAST_SAVED='" + verSaved + "'");
    } else {
      console.log("[FCM] _saveToken() ✓ localStorage confirmed | LS_KEY='" + verKey + "' LS_LAST_SAVED=" + verSaved);
    }
  }

  // ── Availability probe (runs on mount + when auth changes) ───────────────
  const probe = useCallback(async (source = "probe") => {
    setStatus("checking");
    setError(null);

    const perm = typeof Notification !== "undefined" ? Notification.permission : "N/A (API missing)";
    const origin = window.location.origin;
    const ua = navigator.userAgent ?? "";
    const isAndroid = /android/i.test(ua);
    console.log(
      "[FCM] probe() ─────────────────────────────────────────────\n",
      "  source:", source, "\n",
      "  origin:", origin, "\n",
      "  Notification.permission:", perm, "\n",
      "  isAndroid:", isAndroid, "\n",
      "  authToken present:", !!authToken, "\n",
      "  LS_KEY:", localStorage.getItem(LS_KEY), "\n",
      "  LS_LAST_SAVED:", localStorage.getItem(LS_LAST_SAVED),
    );

    const log = (status) => writeProbeLog({ ts: new Date().toISOString(), origin, notifPerm: perm, status, source });

    if (typeof Notification === "undefined") {
      console.warn("[FCM] probe() → Notification API missing → browser-unsupported");
      log("browser-unsupported"); setStatus("browser-unsupported"); return;
    }
    if (Notification.permission === "denied") {
      console.warn("[FCM] probe() → Notification.permission === denied → status:denied");
      log("denied"); setStatus("denied"); return;
    }
    if (!isFirebaseConfigured()) {
      console.warn("[FCM] probe() → Firebase not configured → no-config");
      log("no-config"); setStatus("no-config"); return;
    }

    console.log("[FCM] probe() → calling getFirebaseMessaging()…");
    const messaging = await getFirebaseMessaging();
    console.log("[FCM] probe() → getFirebaseMessaging() returned:", messaging ? "messaging instance ✓" : "null (unsupported)");
    if (!messaging) {
      log("browser-unsupported"); setStatus("browser-unsupported"); return;
    }
    if (!authToken) {
      console.warn("[FCM] probe() → no authToken → not-logged-in");
      log("not-logged-in"); setStatus("not-logged-in"); return;
    }

    // Permission is granted and push is not explicitly disabled.
    if (Notification.permission === "granted" && localStorage.getItem(LS_KEY) !== "disabled") {
      const wasRegistered = localStorage.getItem(LS_KEY) === "true";
      console.log("[FCM] probe() → permission granted | wasRegistered:", wasRegistered, "| LS_KEY:", localStorage.getItem(LS_KEY));

      if (wasRegistered) {
        // Previously registered — show enabled optimistically, refresh token in background.
        // A transient refresh failure must never revert the UI or clear LS_KEY.
        console.log("[FCM] probe() → was registered → optimistic enabled, background refresh");
        log("enabled"); setStatus("enabled");
        (async () => {
          try {
            // Check whether the server still holds an active token for this device.
            // FCM may have marked the token as not-registered (e.g. app reinstall,
            // browser data cleared, 270-day FCM expiry) and the backend deactivated
            // it. In that case we must force-fresh: deleteToken() clears the browser
            // push subscription so getToken() negotiates a genuinely new one.
            let serverHasActiveToken = true;
            try {
              const healthRes = await api.get("/push/health");
              serverHasActiveToken = healthRes.data?.hasActiveToken !== false;
              console.log("[FCM] probe() bg refresh → /push/health hasActiveToken=" + serverHasActiveToken);
            } catch (healthErr) {
              // Network error or 401 — assume token is still valid, fall back to soft refresh.
              console.warn("[FCM] probe() bg refresh → /push/health failed:", healthErr.message, "— assuming active");
            }

            const swReg = await getFcmSwReg();
            console.log("[FCM] probe() bg refresh → swReg:", swReg ? `scope=${swReg.scope} active=${!!swReg.active}` : "null");

            let token;
            if (!serverHasActiveToken) {
              // Server deactivated our token — do a hard reset so FCM gets a
              // fresh push subscription and the backend gets a valid token.
              console.log("[FCM] probe() bg refresh → server has no active token → force-fresh (deleteToken + getToken)");
              token = await _forceFreshToken(messaging, swReg);
            } else {
              console.log("[FCM] probe() bg refresh → calling getToken() vapidKey tail=..." + (VAPID_KEY ?? "").slice(-8));
              token = await getToken(messaging, {
                vapidKey: VAPID_KEY,
                ...(swReg && { serviceWorkerRegistration: swReg }),
              });
            }

            if (token) {
              console.log("[FCM] probe() bg refresh ✓ tail=..." + token.slice(-20));
              setFcmToken(token);
              await _saveToken(token);
              setLastSaveStatus({ ok: true, ts: Date.now() });
            } else {
              console.warn("[FCM] probe() bg refresh → getToken() returned empty — subscription may have expired");
              setLastSaveStatus({ ok: false, msg: "getToken returned empty", ts: Date.now() });
            }
          } catch (err) {
            console.warn("[FCM] probe() bg refresh → threw:", err.message);
            setLastSaveStatus({ ok: false, msg: err.message, ts: Date.now() });
          }
        })();
        return;
      }

      // Permission granted but LS_KEY is null — token was never successfully saved.
      // This is the case on Android where getToken() or the API call silently failed
      // on a previous attempt, leaving the app in a "granted but not registered" limbo.
      // Do NOT show "enabled" optimistically — wait for the registration to complete.
      console.log("[FCM] probe() → permission granted but never registered (LS_KEY=null) — attempting first-time registration…");
      try {
        const swReg = await getFcmSwReg();
        console.log(
          "[FCM] probe() first-time → swReg:", swReg ? `scope=${swReg.scope}` : "null",
          "| active:", !!swReg?.active,
          "| active.state:", swReg?.active?.state ?? "n/a",
        );
        if (swReg && !swReg.active) {
          console.warn("[FCM] probe() first-time → SW registration returned but no active worker — getToken() may fail");
        }
        if (!swReg) {
          // SW failed to install (redundant/CDN error logged inside getFcmSwReg).
          // Fall through to error handling below.
          throw new Error("FCM service worker failed to activate. Check CDN access to gstatic.com.");
        }
        console.log("[FCM] probe() first-time → calling _forceFreshToken() — will clear any stale subscription first");
        const token = await _forceFreshToken(messaging, swReg);
        if (token) {
          console.log("[FCM] probe() first-time ✓ token tail=..." + token.slice(-20));
          setFcmToken(token);
          await _saveToken(token);
          setLastSaveStatus({ ok: true, ts: Date.now() });
          log("enabled"); setStatus("enabled");
        } else {
          console.warn("[FCM] probe() first-time → getToken() returned empty");
          setLastSaveStatus({ ok: false, msg: "getToken() returned empty — check VAPID key and FCM project", ts: Date.now() });
          log("ready"); setStatus("ready");
        }
      } catch (err) {
        console.error("[FCM] probe() first-time registration FAILED:", err.message, err);
        setError("Push registration failed: " + err.message);
        setLastSaveStatus({ ok: false, msg: err.message, ts: Date.now() });
        log("ready"); setStatus("ready");
      }
      return;
    }

    console.log("[FCM] probe() → permission is default/not-disabled → status:ready");
    log("ready"); setStatus("ready");
  }, [authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { probe("mount"); }, [probe]);

  // ── Re-register when tab regains focus after long inactivity ─────────────
  // This is the primary fix for "notifications stop after 24h" — the SW
  // pushsubscriptionchange event is only delivered to open windows. If the
  // app was closed when the subscription expired, no re-registration occurs.
  // On next focus, if it's been >REFRESH_AFTER_MS since the last save, probe()
  // silently refreshes the token so the backend always has a valid entry.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (Notification.permission !== "granted") return;
      if (localStorage.getItem(LS_KEY) === "disabled") return;

      const lastSaved = Number(localStorage.getItem(LS_LAST_SAVED)) || 0;
      const msSinceLastSave = Date.now() - lastSaved;

      if (msSinceLastSave > REFRESH_AFTER_MS) {
        console.log(`[FCM] Tab visible after ${Math.round(msSinceLastSave / 3600000)}h — re-probing token`);
        probe("tab-focus");
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [probe]);

  // ── Re-register when SW reports subscription expired ─────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event) => {
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") {
        console.log("[FCM] pushsubscriptionchange received from SW — re-probing");
        probe("sw-message");
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [probe]);

  // ── Periodic re-probe for long-running Alerts-page sessions ──────────────
  // useFcmKeepAlive in AppLayout covers most pages; this covers the case where
  // a user keeps the Alerts tab active for hours without switching away.
  useEffect(() => {
    const id = setInterval(() => {
      if (Notification.permission !== "granted") return;
      if (localStorage.getItem(LS_KEY) === "disabled") return;
      console.log("[FCM] periodic re-probe (60min interval)");
      probe("interval");
    }, 60 * 60 * 1000); // every 60 minutes
    return () => clearInterval(id);
  }, [probe]);

  // ── Auto-recover when user grants permission from Chrome Settings ────────
  // navigator.permissions.onchange fires when the user changes the permission
  // externally (Chrome Settings → Site settings → Notifications) without
  // reloading the page. Calling probe() here immediately updates the UI status
  // so the user doesn't need to tap "Refresh permission status".
  useEffect(() => {
    if (!("permissions" in navigator)) return;
    let ps = null;
    navigator.permissions.query({ name: "notifications" }).then((permStatus) => {
      ps = permStatus;
      permStatus.onchange = () => {
        const raw = typeof Notification !== "undefined" ? Notification.permission : "unknown";
        console.log("[FCM] permissions.onchange — permStatus.state:", permStatus.state, "| Notification.permission:", raw);
        writeProbeLog({ ts: new Date().toISOString(), origin: window.location.origin, notifPerm: raw, status: "probing", source: "permissions-api-change" });
        probe("permissions-api-change");
      };
    }).catch(() => {});
    return () => { if (ps) ps.onchange = null; };
  }, [probe]);

  // ── Foreground message → dispatch in-app event + show native notification ──
  useEffect(() => {
    getFirebaseMessaging().then((messaging) => {
      if (!messaging) return;
      fgUnsubRef.current = onMessage(messaging, (payload) => {
        const _d = payload.data ?? {};
        console.log("[FCM] Foreground DEVICE_RECEIVED alertId=" + (_d.alertId || "–") + " type=" + (_d.type || "–"), JSON.stringify(payload, null, 2));
        setLastFgMessage(payload);
        const data = payload.data ?? {};

        // In-app alert feed update (same path as socket alerts)
        window.dispatchEvent(
          new CustomEvent("price_alert", {
            detail: {
              _id:    data.alertId ?? `fcm-${Date.now()}`,
              name:   payload.notification?.body ?? data.title ?? "",
              isRead: false, _isNew: true,
              source: data.type === "auction_alert" ? "auction-alert" : "engine",
              tradeId: data.tradeId ?? null,
              url:    data.url ?? "/insider",
            },
          })
        );

        // Native browser notification (foreground — SW suppresses these by default)
        if (Notification.permission === "granted") {
          const n     = payload.notification ?? {};
          const title = n.title ?? data.title ?? "Insider Tracker alert";
          const body  = n.body  ?? data.body  ?? "";
          const icon  = n.icon  ?? "/icons/insider-notification-192.png";
          const opts  = {
            body,
            icon,
            badge:    "/icons/insider-badge-96.png",
            data:     payload.data ?? {},
            tag:      data.alertId ?? data.type ?? "insider-tracker-fg",
            renotify: true,
          };

          // Prefer SW showNotification so the notificationclick handler in the SW fires on click
          navigator.serviceWorker.ready
            .then((reg) => reg.showNotification(title, opts))
            .catch(() => {
              try { new Notification(title, opts); } catch (_) {}
            });
        }
      });
    });
    return () => { fgUnsubRef.current?.(); };
  }, []);

  // ── Enable: request permission → register SW → get token → save ──────────
  const request = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ua = navigator.userAgent ?? "";
      const isAndroid = /android/i.test(ua);
      console.log(
        "[FCM] request() ─────────────────────────────────────────\n",
        "  isAndroid:", isAndroid, "\n",
        "  current Notification.permission:", typeof Notification !== "undefined" ? Notification.permission : "N/A",
      );

      if (!isFirebaseConfigured()) throw new Error("Firebase is not configured.");
      if (!VAPID_KEY) {
        console.error("[FCM] request() → VITE_FIREBASE_VAPID_KEY is not set (env var missing)");
        throw new Error("VITE_FIREBASE_VAPID_KEY is not set.");
      }
      if (!authToken) throw new Error("You must be logged in.");

      console.log("[FCM] request() → calling getFirebaseMessaging()…");
      const messaging = await getFirebaseMessaging();
      console.log("[FCM] request() → getFirebaseMessaging():", messaging ? "✓" : "null — unsupported");
      if (!messaging) throw new Error("Push notifications are not supported in this browser.");

      console.log("[FCM] request() → calling Notification.requestPermission()…");
      const result = await Notification.requestPermission();
      console.log(
        "[FCM] request() → Notification.requestPermission() →", result,
        "| live Notification.permission now:", Notification.permission,
      );
      writeProbeLog({
        ts: new Date().toISOString(),
        origin: window.location.origin,
        notifPerm: result,
        status: result === "granted" ? "granting" : result === "denied" ? "denied" : "dismissed-default",
        source: "requestPermission",
      });

      if (result === "denied") {
        // Explicitly blocked by the user (or pre-blocked by Chrome).
        console.warn("[FCM] request() → permission denied → status:denied");
        setStatus("denied");
        localStorage.removeItem(LS_KEY);
        return;
      }
      if (result !== "granted") {
        // "default" = Android quiet UI was dismissed without a choice, or the
        // dialog timed out. This is NOT a denial — do not show "PERMISSION DENIED".
        // Revert to ready so the user can try again.
        console.warn(
          "[FCM] request() → requestPermission() returned", result,
          "— treating as dismissed (not denied). Reverting to ready.",
          "Android quiet UI is likely suppressing the permission dialog.",
        );
        setStatus("ready");
        return;
      }

      console.log("[FCM] request() → permission granted — registering SW…");
      const swReg = await getFcmSwReg();
      console.log("[FCM] request() → getFcmSwReg():", swReg ? `scope=${swReg.scope} active=${!!swReg.active}` : "null");
      console.log("[FCM] request() → calling _forceFreshToken() — will clear any stale subscription first");
      const token = await _forceFreshToken(messaging, swReg);
      console.log("[FCM] request() → _forceFreshToken() →", token ? "token received ✓ tail=..." + token.slice(-20) : "EMPTY TOKEN");
      if (!token) throw new Error("FCM returned an empty token. Check your VAPID key.");

      // Never log the full FCM registration token — tail only.
      console.log("[FCM] ── FCM token received ──────────────────────────────");
      console.log("[FCM] Token tail :", "..." + token.slice(-20));
      console.log("[FCM] ─────────────────────────────────────────────────────");
      setFcmToken(token);

      await _saveToken(token);
      setLastSaveStatus({ ok: true, ts: Date.now() });
      setStatus("enabled");

      // Auto-send test push via Firebase Admin to confirm real OS delivery.
      // We check whether the just-registered token specifically succeeded — if the
      // server returned successCount>0 only because a desktop token delivered but
      // our Android token was rejected and deactivated, that is a failure, not a
      // success.  Compare the registered token tail against perToken results.
      console.log("[FCM] Auto-sending test push via POST /push/test ...");
      try {
        const testRes = await api.post("/push/test");
        const d = testRes.data ?? {};
        console.log("[FCM] /push/test response:", JSON.stringify(d, null, 2));
        if (d.messageIds?.length) {
          console.log("[FCM] Firebase messageId(s):", d.messageIds.join(", "));
        }

        // Find whether the token we just registered appears in the per-token results
        // and whether it succeeded. perToken items have a `tokenTail` field.
        const registeredTail = "..." + token.slice(-20);
        const thisTokenResult = d.perToken?.find((t) => t.tokenTail === registeredTail);
        const thisTokenOk = thisTokenResult ? thisTokenResult.success : (d.successCount > 0);

        const sent = d.successCount ?? d.tokenCount ?? "?";
        if (thisTokenOk) {
          setAutoTestResult({
            ok:  true,
            msg: `Push enabled — test notification sent (${sent} device${sent !== 1 ? "s" : ""})`,
            ts:  Date.now(),
          });
        } else {
          const reason = thisTokenResult?.error ?? "Token rejected by FCM — will auto-recover on next visit";
          console.warn("[FCM] Auto-test: this device's token was rejected:", reason);
          setAutoTestResult({
            ok:  false,
            msg: `Push enabled but this device token was rejected by FCM. It will auto-recover on your next visit. (${reason})`,
            ts:  Date.now(),
          });
        }
      } catch (testErr) {
        const errData = testErr?.response?.data ?? {};
        const testMsg = errData.error || testErr.message || "Unknown error";
        console.warn("[FCM] /push/test failed:", testMsg);
        setAutoTestResult({ ok: false, msg: `Push enabled but test failed: ${testMsg}`, ts: Date.now() });
      }
    } catch (err) {
      setError(err.message);
      setLastSaveStatus({ ok: false, msg: err.message, ts: Date.now() });
      console.error("[FCM] enable failed:", err.message);
    } finally {
      setLoading(false);
    }
  }, [authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Disable: deregister backend tokens ───────────────────────────────────
  const disable = useCallback(async () => {
    setLoading(true);
    try {
      await api.delete("/push/register");
    } catch (err) {
      console.warn("[FCM] disable error:", err.message);
    } finally {
      localStorage.setItem(LS_KEY, "disabled");
      localStorage.removeItem(LS_LAST_SAVED);
      setFcmToken(null);
      setLastSaveStatus(null);
      setStatus("ready");
      setLoading(false);
    }
  }, []);

  return { status, loading, error, request, disable, probe, swRegistered, fcmToken, lastFgMessage, lastSaveStatus, autoTestResult };
}
