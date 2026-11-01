/**
 * useFcmKeepAlive — lightweight background FCM token refresher.
 *
 * Mount this in AppLayout so it runs on EVERY authenticated page,
 * not just Alerts. The full usePushNotifications hook handles the UI;
 * this one solely keeps the backend DeviceToken record current so pushes
 * arrive even when the user has never opened the Alerts page.
 *
 * What it does:
 *   1. On mount: refresh token if >1h since last save.
 *   2. Every KEEPALIVE_MS (30 min): refresh token silently.
 *   3. On visibilitychange (tab focus): refresh token if >1h since last save.
 *
 * All failures are silent — this must never break the app.
 */

import { useEffect, useRef, useCallback } from "react";
import { getToken, deleteToken } from "firebase/messaging";
import { getFirebaseMessaging, isFirebaseConfigured } from "../lib/firebase";
import useAuth from "./useAuth";
import api from "../lib/api";

const VAPID_KEY       = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const LS_KEY          = "skintel_push_enabled";
const LS_LAST_SAVED   = "skintel_push_last_saved";
const KEEPALIVE_MS    = 30 * 60 * 1000;   // run every 30 minutes
const MIN_SAVE_GAP_MS = 60 * 60 * 1000;   // only hit the backend if >1h since last save

function getDeviceMeta() {
  const ua = navigator.userAgent || "";
  const platform = /android/i.test(ua) ? "android"
    : /ipad|iphone|ipod/i.test(ua) ? "ios"
    : "web";
  const browser = /firefox/i.test(ua) ? "Firefox"
    : /edg\//i.test(ua) ? "Edge"
    : /opr\//i.test(ua) ? "Opera"
    : /chrome/i.test(ua) ? "Chrome"
    : /safari/i.test(ua) ? "Safari"
    : "Unknown";
  return { platform, browser };
}

export default function useFcmKeepAlive() {
  const { token: authToken } = useAuth();
  const runningRef = useRef(false);

  const refresh = useCallback(async (reason = "interval") => {
    // Gate checks — all silent
    if (runningRef.current) return;
    if (!authToken) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (!isFirebaseConfigured()) return;
    if (!VAPID_KEY) return;
    const lsVal = localStorage.getItem(LS_KEY);
    if (lsVal === "disabled") return;
    // LS_KEY is null means the user never successfully completed first-time registration.
    // usePushNotifications.probe() owns that path. Keepalive should only refresh
    // existing registrations to avoid racing with probe() on mount.
    if (lsVal === null) {
      console.log("[FCM keepalive] reason=" + reason + " — LS_KEY null (never registered), deferring to probe()");
      return;
    }

    const lastSaved = Number(localStorage.getItem(LS_LAST_SAVED)) || 0;
    const msSinceSave = Date.now() - lastSaved;

    runningRef.current = true;
    try {
      const messaging = await getFirebaseMessaging();
      if (!messaging) return;

      // Prefer the existing FCM SW registration.
      // If getRegistration returns null (first load on this page before probe() ran,
      // or after a browser update cleared SW registrations) fall back to registering
      // the SW ourselves so getToken() is bound to the correct push subscription.
      // Without this, getToken() may create a token tied to a default internal SW
      // that has no onBackgroundMessage handler — background notifications would be
      // silently dropped even though the token looks valid.
      let swReg = null;
      if ("serviceWorker" in navigator) {
        swReg = await navigator.serviceWorker.getRegistration("/firebase-cloud-messaging-push-scope").catch(() => null);
        if (!swReg) {
          try {
            swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
              scope: "/firebase-cloud-messaging-push-scope",
            });
            console.log(`[FCM keepalive] reason=${reason} — SW was missing, registered new`);
          } catch (regErr) {
            console.warn(`[FCM keepalive] reason=${reason} — SW register fallback failed:`, regErr.message);
          }
        }
      }

      console.log(`[FCM keepalive] reason=${reason} — calling getToken() | swReg:`, swReg ? `scope=${swReg.scope} active=${!!swReg.active}` : "null");
      let token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        ...(swReg ? { serviceWorkerRegistration: swReg } : {}),
      });

      if (!token) {
        console.warn(`[FCM keepalive] reason=${reason} — getToken() returned empty, subscription may have expired`);
        return;
      }
      console.log(`[FCM keepalive] reason=${reason} — getToken() ✓ tail=...${token.slice(-20)}`);

      // Check server-side token health. If the backend has 0 active tokens
      // (silent invalidation), force re-register regardless of timing.
      // subscription_changed always forces registration: the new token is
      // different from what the backend has, and the old token may still
      // appear active (it won't be deactivated until the next push fails).
      let mustRegister = msSinceSave >= MIN_SAVE_GAP_MS || reason === "subscription_changed";
      if (!mustRegister) {
        try {
          const health = await api.get("/push/health");
          if (!health.data?.hasActiveToken) {
            // Backend has 0 active tokens for this user — the token we just fetched
            // via getToken() is the same stale subscription that was previously
            // deactivated (Android caches it at the browser push service level).
            // Force-delete it so the next getToken() creates a genuinely new subscription.
            console.warn(`[FCM keepalive] reason=${reason} — backend 0 active tokens (stale subscription), force-refreshing token`);
            try {
              await deleteToken(messaging);
              console.log(`[FCM keepalive] deleteToken() ✓ — stale subscription cleared`);
              token = await getToken(messaging, {
                vapidKey: VAPID_KEY,
                ...(swReg ? { serviceWorkerRegistration: swReg } : {}),
              });
              if (!token) {
                console.warn(`[FCM keepalive] getToken() returned empty after deleteToken()`);
                return;
              }
              console.log(`[FCM keepalive] fresh token ✓ tail=...${token.slice(-20)}`);
            } catch (freshErr) {
              console.warn(`[FCM keepalive] force-refresh failed: ${freshErr.message} — aborting keepalive`);
              return;
            }
            mustRegister = true;
          }
        } catch (healthErr) {
          // Health check unreachable (server restart, network error).
          // Register defensively: a missed re-registration could silence
          // push for up to MIN_SAVE_GAP_MS if the token was also invalidated.
          console.warn(`[FCM keepalive] reason=${reason} — /push/health unreachable (${healthErr.message}), registering defensively`);
          mustRegister = true;
        }
      }

      if (!mustRegister) {
        console.log(`[FCM keepalive] reason=${reason} — skipped (token fresh, msSinceSave=${msSinceSave})`);
        return;
      }

      const { platform, browser } = getDeviceMeta();
      console.log(`[FCM keepalive] reason=${reason} — POST /push/register platform=${platform} browser=${browser}`);
      await api.post("/push/register", { token, platform, browser });
      // Keep LS_KEY and LS_LAST_SAVED in sync — without LS_KEY="true", probe() would
      // re-enter the "never registered" first-time path on every mount.
      localStorage.setItem(LS_KEY,        "true");
      localStorage.setItem(LS_LAST_SAVED, String(Date.now()));
      console.log(`[FCM keepalive] reason=${reason} ✓ tail=...${token.slice(-20)} msSincePreviousSave=${msSinceSave}`);
    } catch (err) {
      // Never surface FCM keepalive errors to the user
      console.warn(`[FCM keepalive] reason=${reason} failed (silent):`, err.message);
    } finally {
      runningRef.current = false;
    }
  }, [authToken]);

  // Run on mount (once) with staleness check
  useEffect(() => {
    refresh("mount");
  }, [refresh]);

  // Run on a fixed interval regardless of page activity
  useEffect(() => {
    const id = setInterval(() => refresh("interval"), KEEPALIVE_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Run on tab visibility restore
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh("focus");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [refresh]);

  // Re-register immediately when the browser rotates the FCM push subscription.
  // The SW fires pushsubscriptionchange and posts PUSH_SUBSCRIPTION_CHANGED to
  // all open windows. usePushNotifications handles this on the Alerts page;
  // this handler covers every other authenticated page via AppLayout.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handleSwMessage = (event) => {
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") {
        console.log("[FCM keepalive] PUSH_SUBSCRIPTION_CHANGED received from SW — re-registering token");
        refresh("subscription_changed");
      }
    };
    navigator.serviceWorker.addEventListener("message", handleSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleSwMessage);
  }, [refresh]);
}
