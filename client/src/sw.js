import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

// Take control of all open clients immediately on activate
self.skipWaiting();
clientsClaim();

// Remove assets cached by old service workers
cleanupOutdatedCaches();

// Precache everything Vite/VitePWA built (manifest injected at build time)
precacheAndRoute(self.__WB_MANIFEST);

// Firebase background messaging is handled by /firebase-messaging-sw.js
// (see public/firebase-messaging-sw.js — uses Firebase compat 9.x CDN)
