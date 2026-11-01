import { useEffect, useSyncExternalStore } from "react";
import api from "../lib/api";

// Single shared poller for /trades/notifications/unread-count, consumed by
// Navbar, TradeNotificationBell, and TradePage. Previously each of those
// three components ran its own independent interval (one-shot, 30s, 15s)
// against the same endpoint. This module is a tiny external store (React 18
// useSyncExternalStore) so every consumer re-renders from one shared poll
// instead of tripling the request volume.
const POLL_MS = 60_000;

const listeners = new Set();
let count = 0;
let authed = false;
let started = false;
let pollTimer = null;
let inFlight = null;

function emit() {
  for (const l of listeners) l();
}

function setCount(n) {
  const next = Math.max(0, n);
  if (next === count) return;
  count = next;
  emit();
}

async function fetchCount() {
  if (!authed || inFlight) return inFlight;
  inFlight = api
    .get("/trades/notifications/unread-count")
    .then((res) => {
      if (res.data?.ok) setCount(res.data.count || 0);
    })
    .catch(() => {})
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function scheduleNext() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (authed && document.visibilityState === "visible") await fetchCount();
    scheduleNext();
  }, POLL_MS);
}

function onVisible() {
  if (authed && document.visibilityState === "visible") fetchCount();
}

function onTradeMatch() {
  setCount(count + 1);
}

function ensureStarted() {
  if (started) return;
  started = true;
  scheduleNext();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("trade:match", onTradeMatch);
}

function setAuthed(next) {
  if (authed === next) return;
  authed = next;
  if (next) fetchCount();
  else setCount(0);
}

function subscribe(listener) {
  listeners.add(listener);
  ensureStarted();
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return count;
}

/** Shared trade-notification unread badge count. Pass the caller's isAuthed. */
export default function useTradeUnreadCount(isAuthed) {
  useEffect(() => {
    setAuthed(!!isAuthed);
  }, [isAuthed]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Force an immediate refetch (e.g. after an action known to change the count). */
export function refreshTradeUnreadCount() {
  return fetchCount();
}

/** Locally zero the shared count (e.g. after "mark all read") without a refetch. */
export function resetTradeUnreadCount() {
  setCount(0);
}
