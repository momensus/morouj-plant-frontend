// ============================================================
// sw.js — Morouj Commodities PWA Service Worker
// Strategy: Cache-First for static assets, Network-First for API
// ============================================================

const CACHE_NAME        = 'morouj-plant-v3';
const STATIC_CACHE_NAME = 'morouj-static-v3';
const SYNC_TAG          = 'morouj-offline-sync';

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/config.js',
  '/offline-queue.js',
  '/logo.png',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  // Offline fallback page (served when network + cache both fail)
  '/offline.html'
];

// API route prefix — always fetch fresh, never serve stale
const API_PREFIX = '/api/';

// ── INSTALL: pre-cache all static assets ─────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      // addAll fails atomically; skip missing optional assets gracefully
      return cache.addAll(
        PRECACHE_ASSETS.filter(url => !url.includes('offline.html'))
      ).then(() => {
        // Try to cache offline page, but don't fail install if missing
        return cache.add('/offline.html').catch(() => {});
      });
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: purge old caches ────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  const validCaches = [CACHE_NAME, STATIC_CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => !validCaches.includes(name))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: routing strategy ───────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // API calls → Network-First (fresh data always preferred)
  if (url.pathname.startsWith(API_PREFIX)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets → Cache-First (fast, offline-capable)
  event.respondWith(cacheFirst(request));
});

// ── Strategy: Cache-First ────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Return offline fallback for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/offline.html');
      if (fallback) return fallback;
    }
    return new Response('Offline — resource unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// ── Strategy: Network-First ──────────────────────────────────
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline', cached: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── BACKGROUND SYNC: wake open clients to flush IndexedDB queue ──
// The auth token lives in window memory/localStorage — the SW cannot
// access it — so we relay a message to open window clients and let
// offline-queue.js do the actual uploading with the correct token.
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    console.log('[SW] Background sync fired:', SYNC_TAG);
    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => {
          if (clients.length === 0) {
            console.log('[SW] No open clients to relay sync message to.');
            return;
          }
          clients.forEach((client) =>
            client.postMessage({ type: 'SYNC_OFFLINE_QUEUE' })
          );
          console.log(`[SW] Relayed SYNC_OFFLINE_QUEUE to ${clients.length} client(s).`);
        })
    );
  }
});

// ── WEB PUSH NOTIFICATIONS: push event handler ────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification payload received');
  let data = {
    title: 'Morouj Plant Notification',
    body: 'New operational update from Morouj Tomato Paste Plant',
icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: 'morouj-notification',
    data: { url: '/' }
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || 'Operational notification',
icon: data.icon || '/icons/icon-192x192.png',
    badge: data.badge || '/icons/icon-72x72.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'morouj-alert',
    renotify: true,
    requireInteraction: true,
    data: data.data || { url: data.url || '/' },
    actions: [
      { action: 'open_dashboard', title: 'Open Dashboard' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Morouj Plant Notification', options)
  );
});

// ── NOTIFICATION CLICK: Focus open app window or open dashboard ─
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.tag);
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});


