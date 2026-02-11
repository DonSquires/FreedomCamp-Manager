// Service Worker for FreedomCamp Manager PWA
// Handles offline caching, background sync, and auto-updates

var CACHE_VERSION = '2.2.3';
var CACHE_NAME = 'freedomcamp-v' + CACHE_VERSION;
var STATIC_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/jds-security-logo.png',
];

// Install event - cache static assets
self.addEventListener('install', function(event) {
  console.log('[SW] Installing service worker version', CACHE_VERSION);
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_CACHE);
    }).then(function() {
      // Skip waiting to activate immediately
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches and notify about updates
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating service worker version', CACHE_VERSION);
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(function(cacheNames) {
        return Promise.all(
          cacheNames.map(function(cacheName) {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control of all clients
      self.clients.claim(),
    ]).then(function() {
      // Notify all clients about the update
      return self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({
            type: 'UPDATE_AVAILABLE',
            version: CACHE_VERSION,
          });
        });
      });
    })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', function(event) {
  // Skip for chrome-extension URLs (browser extensions)
  if (event.request.url.indexOf('chrome-extension://') !== -1) {
    return;
  }

  // Skip for API requests (Supabase)
  if (
    event.request.url.indexOf('/api/') !== -1 ||
    event.request.url.indexOf('supabase.co') !== -1 ||
    event.request.url.indexOf('functions/v1') !== -1
  ) {
    return;
  }

  // Skip for non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(response) {
      // Return cached version if available
      if (response) {
        return response;
      }

      // Fetch from network and cache successful responses
      return fetch(event.request).then(function(fetchResponse) {
        // Only cache successful responses
        if (!fetchResponse || fetchResponse.status !== 200 || fetchResponse.type === 'error') {
          return fetchResponse;
        }

        // Clone the response before caching
        var responseToCache = fetchResponse.clone();

        // Only cache valid HTTP/HTTPS URLs (skip chrome-extension, blob, data, etc.)
        var urlProtocol = event.request.url.split(':')[0].toLowerCase();
        if (urlProtocol === 'http' || urlProtocol === 'https') {
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseToCache).catch(function() {
              // Silently fail if caching fails (e.g., unsupported URL schemes, CORS issues)
            });
          }).catch(function() {
            // Silently ignore cache open failures
          });
        }

        return fetchResponse;
      }).catch(function() {
        // Return offline page if available
        return caches.match('/index.html');
      });
    })
  );
});

// Background sync for queued scans
self.addEventListener('sync', function(event) {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-scans') {
    event.waitUntil(syncQueuedScans());
  }
});

function syncQueuedScans() {
  return self.clients.matchAll().then(function(clients) {
    clients.forEach(function(client) {
      client.postMessage({
        type: 'SYNC_QUEUE',
        timestamp: Date.now(),
      });
    });
  }).catch(function(error) {
    console.error('[SW] Background sync failed:', error);
  });
}

// Push notification handler
self.addEventListener('push', function(event) {
  console.log('[SW] Push notification received:', event);
  
  if (!event.data) return;

  var data = event.data.json();
  var options = {
    body: data.body || '',
    icon: '/jds-security-logo.png',
    badge: '/jds-security-logo.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
    },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'FreedomCamp Manager', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Notification clicked');
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function(clientList) {
      // Focus existing window if available
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window if needed
      if (self.clients.openWindow) {
        return self.clients.openWindow(event.notification.data.url);
      }
    })
  );
});

// Listen for skip waiting message
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting message received');
    self.skipWaiting();
  }
});

console.log('[SW] Service Worker loaded - version', CACHE_VERSION);
