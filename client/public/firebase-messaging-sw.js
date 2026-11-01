// Firebase Cloud Messaging — background service worker.
//
// Self-contained: Firebase is initialized here with the public client config.
// No postMessage from the app is needed — this works when all tabs are closed.
//
// importScripts is synchronous, so firebase.initializeApp() and
// firebase.messaging() both run during the script's initial evaluation.
// onBackgroundMessage() and addEventListener() are therefore also registered
// synchronously, satisfying Chrome's requirement that push/notificationclick
// handlers be added during initial script evaluation.
importScripts('/firebase/firebase-app-compat.js');
importScripts('/firebase/firebase-messaging-compat.js');

// Activate a new version of this SW immediately on deploy instead of waiting
// for all tabs to close — prevents an outdated FCM SW from continuing to
// handle push/notificationclick events after a fix has shipped.
self.skipWaiting();

// Public Firebase client config — not a secret.
firebase.initializeApp({
  apiKey:            "AIzaSyAqSQgyeBLMNBUIOzHaUXidMQtU69S_QQo",
  authDomain:        "skintel-3fbc1.firebaseapp.com",
  projectId:         "skintel-3fbc1",
  storageBucket:     "skintel-3fbc1.firebasestorage.app",
  messagingSenderId: "369635946478",
  appId:             "1:369635946478:web:3ce65e78f784b60734e8ff",
});

// ── [DEBUG] Raw push listener — logs in the SW console, not the page console.
// Open DevTools → Application → Service Workers → click the inspector link
// next to firebase-messaging-sw.js to see these logs.
// Remove this block once the delivery chain is confirmed working.
self.addEventListener('push', function(event) {
  console.log('[DEBUG:1] ===== RAW PUSH EVENT RECEIVED =====');
  console.log('[DEBUG:1] event.data exists:', !!event.data);
  if (event.data) {
    var rawText = '(unreadable)';
    try { rawText = event.data.text(); } catch (_) {}
    console.log('[DEBUG:1] Raw payload text:', rawText);
    try {
      var parsed = JSON.parse(rawText);
      console.log('[DEBUG:1] Has top-level notification field:', !!parsed.notification);
      console.log('[DEBUG:1] Has data field:', !!parsed.data);
      console.log('[DEBUG:1] notification value:', JSON.stringify(parsed.notification));
    } catch (_) {
      console.log('[DEBUG:1] Payload is not JSON');
    }
  }
  console.log('[DEBUG:1] =====================================');
});

// ── Delivery receipt (diagnostics only) ──────────────────────────────────────
// Proves a real alert push reached this service worker: POSTs a tiny receipt
// to /api/push/device-received, recorded server-side as DEVICE_RECEIVED so it
// can be correlated with PUSH_SEND_SUCCESS by alertId.
//
// Strictly best-effort and independent of display: Firebase's own 'push'
// listener (registered by firebase.messaging() below) shows the notification
// in parallel. This listener never throws, never touches the notification,
// and the receipt fetch is time-boxed. Only the last 20 chars of the FCM
// token are ever sent — never the full token.
var RECEIPT_URL = (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1')
  ? 'http://localhost:5055/api/push/device-received'
  : 'https://skintel-app.onrender.com/api/push/device-received';
var RECEIPT_TIMEOUT_MS = 8000;

function receiptDeviceMeta() {
  var ua = (self.navigator && self.navigator.userAgent) || '';
  var platform = /android/i.test(ua) ? 'android' : /ipad|iphone|ipod/i.test(ua) ? 'ios' : 'web';
  var browser = /firefox/i.test(ua) ? 'Firefox'
    : /edg\//i.test(ua) ? 'Edge'
    : /opr\//i.test(ua) ? 'Opera'
    : /chrome/i.test(ua) ? 'Chrome'
    : /safari/i.test(ua) ? 'Safari'
    : 'Unknown';
  return { platform: platform, browser: browser };
}

// Read-only lookup of this origin's current FCM token in the Firebase SDK's
// IndexedDB cache. Never creates or upgrades the SDK's database: if it does
// not exist yet, the upgrade transaction is aborted and we resolve null.
function receiptTokenTail() {
  return new Promise(function (resolve) {
    try {
      var appId = firebase.app().options.appId;
      var req = self.indexedDB.open('firebase-messaging-database');
      req.onupgradeneeded = function () { try { req.transaction.abort(); } catch (_) {} };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
      req.onsuccess = function () {
        var db = req.result;
        try {
          if (!db.objectStoreNames.contains('firebase-messaging-store')) { db.close(); resolve(null); return; }
          var get = db.transaction('firebase-messaging-store', 'readonly').objectStore('firebase-messaging-store').get(appId);
          get.onsuccess = function () {
            var token = get.result && get.result.token;
            db.close();
            resolve(typeof token === 'string' && token.length > 20 ? token.slice(-20) : null);
          };
          get.onerror = function () { db.close(); resolve(null); };
        } catch (_) { try { db.close(); } catch (_) {} resolve(null); }
      };
    } catch (_) { resolve(null); }
  });
}

function sendDeliveryReceipt(alertId, receivedAt) {
  var meta = receiptDeviceMeta();
  var tailTimer;
  var tailTimeout = new Promise(function (resolve) { tailTimer = setTimeout(function () { resolve(null); }, 2000); });
  return Promise.race([receiptTokenTail(), tailTimeout]).then(function (tokenTail) {
    clearTimeout(tailTimer);
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, RECEIPT_TIMEOUT_MS);
    return fetch(RECEIPT_URL, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alertId: alertId,
        tokenTail: tokenTail,
        platform: meta.platform,
        browser: meta.browser,
        receivedAt: receivedAt,
      }),
      signal: controller ? controller.signal : undefined,
    }).finally(function () { clearTimeout(timer); });
  });
}

self.addEventListener('push', function (event) {
  try {
    var receivedAt = Date.now();
    var payload = event.data ? event.data.json() : null;
    var data = (payload && payload.data) || {};
    var isRealAlert = (data.type === 'price_alert' || data.type === 'auction_alert') &&
      typeof data.alertId === 'string' && /^[a-f0-9]{24}$/.test(data.alertId);
    if (!isRealAlert) return;
    event.waitUntil(
      sendDeliveryReceipt(data.alertId, receivedAt).catch(function (err) {
        console.warn('[FCM SW] delivery receipt failed (ignored):', err && err.message);
      })
    );
  } catch (err) {
    console.warn('[FCM SW] delivery receipt skipped:', err && err.message);
  }
});

// ── [DEBUG] Intercept showNotification — confirms whether it is called at all.
// Patching the prototype works at script evaluation time inside the SW.
// Remove once confirmed working.
(function() {
  var _orig = ServiceWorkerRegistration.prototype.showNotification;
  ServiceWorkerRegistration.prototype.showNotification = function(title, options) {
    console.log('[DEBUG:3] showNotification() CALLED — title="' + title + '"');
    console.log('[DEBUG:3] showNotification() options:', JSON.stringify(options));
    return _orig.call(this, title, options);
  };
})();

// Calling firebase.messaging() in a SW context immediately registers the
// internal 'push' event listener that Firebase needs.
const messaging = firebase.messaging();

// ── Background message handler ────────────────────────────────────────────────
// Called for every FCM push that arrives while the app tab is closed or
// the page is not focused. Return the showNotification Promise so the browser
// keeps the SW alive until the notification is displayed.
messaging.onBackgroundMessage((payload) => {
  console.log('[DEBUG:2] onBackgroundMessage() FIRED');
  const data = payload.data ?? {};
  console.log('[FCM SW] onBackgroundMessage() DEVICE_RECEIVED alertId=' + (data.alertId || '–') + ' type=' + (data.type || '–'), JSON.stringify(payload));
  const n    = payload.notification ?? {};

  const title     = n.title ?? data.title ?? 'SkinTel Alert';
  const body      = n.body  ?? data.body  ?? '';
  const isAuction = data.type === 'auction_alert';
  const clickUrl  = data.url ?? '/alerts';

  // Use item image as the large preview when it is a valid absolute URL.
  const itemImage = (data.image && /^https?:\/\//.test(data.image)) ? data.image : null;

  // Standard SkinTel notification template — same actions for every alert
  // type (price, item, auction) so the layout is consistent everywhere.
  const actions = [
    { action: 'open_auction', title: 'Open Auction' },
    { action: 'view_alerts',  title: 'View Alerts'  },
  ];

  const notifOptions = {
    body,
    icon:               '/telIcon.png',
    badge:              '/telIcon.png',
    tag:                data.alertId ?? data.type ?? 'skintel',
    renotify:           true,
    requireInteraction: isAuction,
    vibrate:            [200, 100, 200],
    timestamp:          Date.now(),
    silent:             false,
    data:               { ...data, clickUrl },
    actions,
  };

  if (itemImage) notifOptions.image = itemImage;

  return self.registration.showNotification(title, notifOptions);
});

// ── Notification click → navigate to the correct page ────────────────────────
self.addEventListener('notificationclick', (event) => {
  console.log('[FCM SW] notificationclick — action:', event.action, 'data:', JSON.stringify(event.notification.data));
  event.notification.close();

  const data    = event.notification.data ?? {};
  const itemUrl = data.clickUrl || data.url || (data.tradeId ? `/trade/${data.tradeId}` : null);

  let url;
  if (event.action === 'open_auction') {
    url = itemUrl || 'https://csgoempire.com';
  } else if (event.action === 'view_alerts') {
    url = '/alerts';
  } else {
    // Notification body tap — open the item page directly
    url = itemUrl || '/alerts';
  }

  // Relative URLs (e.g. '/alerts') must resolve against this app's origin —
  // clients.openWindow() requires an absolute or origin-relative URL, and
  // open.navigate() below needs an absolute URL to compare origins safely.
  const absoluteUrl = /^https?:\/\//.test(url) ? url : new URL(url, self.location.origin).href;
  const isExternal  = new URL(absoluteUrl).origin !== self.location.origin;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      // External URLs (e.g. csgoempire.com) must always open a new window —
      // can't navigate a same-origin tab to a cross-origin URL.
      if (isExternal) {
        return clients.openWindow(absoluteUrl);
      }

      const open = list.find((c) => 'focus' in c);
      if (open) {
        // open.navigate() throws "This service worker is not the client's
        // active service worker" when this SW (registered at the FCM push
        // scope) is not the controller of the matched window — the page is
        // actually controlled by the PWA precache SW (/sw.js, scope '/').
        // Fall back to opening/focusing a new tab at the target URL instead.
        try {
          await open.navigate(absoluteUrl);
          return open.focus();
        } catch (err) {
          console.warn('[FCM SW] open.navigate() failed (' + err.message + ') — opening new window instead');
          return clients.openWindow(absoluteUrl);
        }
      }
      return clients.openWindow(absoluteUrl);
    })
  );
});

// ── Subscription expiry → notify open windows to re-register ─────────────────
// When the browser's Web Push subscription expires, FCM calls this event.
// We notify every open tab so usePushNotifications.probe() re-registers the token.
// If no tabs are open the event is a no-op here — but on the next tab open,
// the visibilitychange handler in usePushNotifications.js re-probes automatically.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      console.log('[FCM SW] pushsubscriptionchange — notifying', list.length, 'window(s)');
      list.forEach((c) => c.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' }));
    })
  );
});
