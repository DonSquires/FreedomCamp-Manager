// Service Worker for Field Compliance Manager PWA
// Handles offline caching, background sync, and auto-updates
// NOW WITH: IndexedDB sync, offline API queue, Background Sync API

var CACHE_VERSION = '2.5.1'; // B-05: offline map tile cache + safer network fallback
var CACHE_NAME = 'fieldops-v' + CACHE_VERSION;
var API_CACHE = 'fieldops-api-v' + CACHE_VERSION;
// Separate tile cache — intentionally NOT versioned with CACHE_VERSION so that
// pre-downloaded tiles survive app updates without re-downloading.
var TILE_CACHE = 'fieldops-tiles-v1';
var STATIC_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/iron-eagle-security-logo.jpg',
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
      // Clean up old caches (both static and API)
      caches.keys().then(function(cacheNames) {
        return Promise.all(
          cacheNames.map(function(cacheName) {
            if (cacheName !== CACHE_NAME && cacheName !== API_CACHE && cacheName !== TILE_CACHE) {
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
            features: ['offline_queue', 'background_sync', 'gps_watermark'],
          });
        });
      });
    })
  );
});

// Fetch event - Network-first for API and navigation, cache-first for hashed static assets
self.addEventListener('fetch', function(event) {
  // Skip for chrome-extension URLs (browser extensions)
  if (event.request.url.indexOf('chrome-extension://') !== -1) {
    return;
  }

  // ── OSM tile requests — cache-first for offline map support (B-05) ─────────
  var isTileRequest =
    event.request.url.indexOf('tile.openstreetmap.org') !== -1 ||
    event.request.url.indexOf('.tile.openstreetmap') !== -1;

  if (isTileRequest && event.request.method === 'GET') {
    event.respondWith(
      caches.open(TILE_CACHE).then(function(cache) {
        return cache.match(event.request).then(function(cachedTile) {
          if (cachedTile) {
            return cachedTile;
          }
          return fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone()).catch(function() {});
            }
            return response;
          }).catch(function() {
            // Tile not available offline and network failed — return 204 so
            // Leaflet renders an empty tile rather than a broken-image icon.
            return new Response('', { status: 204, statusText: 'No Content' });
          });
        });
      })
    );
    return;
  }

  var isApiRequest = 
    event.request.url.indexOf('/api/') !== -1 ||
    event.request.url.indexOf('supabase.co') !== -1 ||
    event.request.url.indexOf('functions/v1') !== -1;

  var isBobChatRequest = event.request.url.indexOf('/api/bob/chat') !== -1;

  // Navigation requests (HTML pages) - always Network first so index.html
  // is never served stale after a new deployment changes asset hashes.
  var isNavigationRequest = event.request.mode === 'navigate';

  // Never apply app-shell fallback behavior to cross-origin requests.
  if (event.request.url.indexOf(self.location.origin) !== 0) {
    event.respondWith(fetch(event.request));
    return;
  }

  // API requests - Network first with offline fallback
  if (isApiRequest && !isBobChatRequest) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          // Cache successful GET API responses for offline viewing
          if (event.request.method === 'GET' && response && response.status === 200) {
            var responseClone = response.clone();
            caches.open(API_CACHE).then(function(cache) {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(function(error) {
          console.log('[SW] Network request failed, trying cache:', event.request.url);
          // Try cache for GET requests
          if (event.request.method === 'GET') {
            return caches.match(event.request).then(function(cachedResponse) {
              if (cachedResponse) {
                console.log('[SW] Serving from API cache (offline):', event.request.url);
                return cachedResponse;
              }
              // Return error response for failed API calls
              return new Response(
                JSON.stringify({ error: 'Offline - no cached response available' }),
                { 
                  status: 503, 
                  statusText: 'Service Unavailable',
                  headers: { 'Content-Type': 'application/json' }
                }
              );
            });
          }
          
          // For POST/PUT/DELETE when offline, queue for background sync
          if (event.request.method !== 'GET') {
            console.log('[SW] Queuing non-GET request for background sync');
            // Request will fail, app will catch and add to IndexedDB queue
            return Promise.reject(error);
          }
          
          return Promise.reject(error);
        })
    );
    return;
  }

  // HTML navigation - Network first so deployments always deliver fresh HTML
  if (isNavigationRequest) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          if (response && response.status === 200) {
            var responseClone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, responseClone).catch(function() {});
            }).catch(function() {});
          }
          return response;
        })
        .catch(function() {
          // Offline fallback: serve cached index.html
          return caches.match('/index.html');
        })
    );
    return;
  }

  // Static assets (JS/CSS/images with content hashes) - Cache first
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
        // This branch only handles non-navigation requests. Returning index.html
        // here can break script/style loads due to MIME mismatches.
        return Response.error();
      });
    })
  );
});

// Background sync for queued scans - ENHANCED WITH RETRY LOGIC
self.addEventListener('sync', function(event) {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-scans') {
    event.waitUntil(syncQueuedScans());
  }
});

function syncQueuedScans() {
  console.log('[SW] Starting background sync of queued scans...');
  
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then(function(clients) {
      if (clients.length === 0) {
        console.log('[SW] No active clients to sync with');
        return;
      }
      
      // Notify all active clients to sync their queues
      var syncPromises = clients.map(function(client) {
        return new Promise(function(resolve) {
          // Post message to client
          client.postMessage({
            type: 'SYNC_QUEUE',
            timestamp: Date.now(),
          });
          
          // Set up one-time message listener for sync completion
          var messageHandler = function(event) {
            if (event.data && event.data.type === 'SYNC_COMPLETE') {
              self.removeEventListener('message', messageHandler);
              resolve(event.data);
            }
          };
          
          self.addEventListener('message', messageHandler);
          
          // Timeout after 30 seconds
          setTimeout(function() {
            self.removeEventListener('message', messageHandler);
            resolve({ success: false, error: 'Sync timeout' });
          }, 30000);
        });
      });
      
      return Promise.all(syncPromises);
    })
    .then(function(results) {
      console.log('[SW] Background sync completed:', results);
      return results;
    })
    .catch(function(error) {
      console.error('[SW] Background sync failed:', error);
      throw error;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Push notification handler
// Receives VAPID-encrypted push messages from the send-push-notification or
// send-welfare-reminders edge functions and shows a rich notification even
// when the app tab is closed.
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('push', function(event) {
  console.log('[SW] Push notification received');

  if (!event.data) return;

  var data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'Field Compliance Manager', body: event.data.text() };
  }

  // Map notification type → vibration pattern + urgency
  var vibrate = [200, 100, 200];
  var requireInteraction = false;
  var notifType = (data.data && data.data.type) || data.tag || '';

  if (notifType === 'welfare' && (data.data && data.data.alertType) === 'overdue') {
    vibrate = [500, 200, 500, 200, 500, 200, 500];
    requireInteraction = true;
  } else if (notifType === 'welfare') {
    vibrate = [300, 150, 300];
    requireInteraction = true;
  } else if (notifType === 'shift_posted') {
    vibrate = [200, 100, 200, 100, 200];
  }

  var url = (data.data && data.data.url) || data.url || '/';

  var options = {
    body:               data.body    || '',
    icon:               data.icon    || '/iron-eagle-security-logo.jpg',
    badge:              data.badge   || '/iron-eagle-security-logo.jpg',
    tag:                data.tag     || notifType || 'fcm-general',
    vibrate:            vibrate,
    requireInteraction: requireInteraction,
    silent:             false,
    renotify:           true,  // always re-alert even if same tag
    data: {
      url:  url,
      type: notifType,
    },
    actions: notifType === 'welfare'
      ? [{ action: 'checkin', title: "✓ I'm OK" }]
      : notifType === 'shift_posted'
        ? [{ action: 'view', title: 'View Shift' }]
        : [],
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'Field Compliance Manager',
      options
    )
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Notification click + action handler
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Notification clicked, action:', event.action);
  event.notification.close();

  var targetUrl = event.notification.data.url || '/';
  var notifType = event.notification.data.type || '';

  // "I'm OK" action — open app at /field-officer with a checkin trigger param
  if (event.action === 'checkin') {
    targetUrl = '/field-officer?welfare_checkin=1';
  } else if (event.action === 'view') {
    targetUrl = event.notification.data.url || '/';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Focus an existing window at the same origin if possible
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) {
          if (event.action === 'checkin') {
            // Post a message so the React app performs the check-in
            client.postMessage({ type: 'WELFARE_CHECKIN_ACTION' });
          }
          return client.focus();
        }
      }
      // No existing window — open a new one (use targetUrl which reflects action)
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Message handler
// Accepts messages from the React app to coordinate welfare state and SW updates.
//
// Protocol:
//   { type: 'SKIP_WAITING' }
//   { type: 'WELFARE_SHIFT_START', payload: { officerId, intervalMinutes } }
//   { type: 'WELFARE_CHECKIN',     payload: { officerId } }
//   { type: 'WELFARE_SHIFT_END',   payload: { officerId } }
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('message', function(event) {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      console.log('[SW] Skip waiting');
      self.skipWaiting();
      break;

    case 'CLEAR_TILE_CACHE':
      console.log('[SW] Clearing offline tile cache');
      caches.delete(TILE_CACHE).then(function() {
        if (event.source) {
          event.source.postMessage({ type: 'TILE_CACHE_CLEARED' });
        }
      });
      break;

    case 'GET_TILE_CACHE_SIZE':
      caches.open(TILE_CACHE).then(function(cache) {
        return cache.keys();
      }).then(function(keys) {
        if (event.source) {
          event.source.postMessage({ type: 'TILE_CACHE_SIZE', count: keys.length });
        }
      }).catch(function() {
        if (event.source) {
          event.source.postMessage({ type: 'TILE_CACHE_SIZE', count: 0 });
        }
      });
      break;

    case 'WELFARE_SHIFT_START':
      console.log('[SW] Welfare shift started for officer', event.data.payload && event.data.payload.officerId);
      // The actual reminder scheduling is handled server-side (send-welfare-reminders cron).
      // This message is informational — the SW dismisses any stale welfare notifications.
      self.registration.getNotifications({ tag: 'welfare-10min' }).then(function(ns) { ns.forEach(function(n) { n.close(); }); });
      self.registration.getNotifications({ tag: 'welfare-5min'  }).then(function(ns) { ns.forEach(function(n) { n.close(); }); });
      self.registration.getNotifications({ tag: 'welfare-overdue' }).then(function(ns) { ns.forEach(function(n) { n.close(); }); });
      break;

    case 'WELFARE_CHECKIN':
      console.log('[SW] Welfare check-in recorded');
      self.registration.getNotifications({ tag: 'welfare-10min'  }).then(function(ns) { ns.forEach(function(n) { n.close(); }); });
      self.registration.getNotifications({ tag: 'welfare-5min'   }).then(function(ns) { ns.forEach(function(n) { n.close(); }); });
      self.registration.getNotifications({ tag: 'welfare-overdue' }).then(function(ns) { ns.forEach(function(n) { n.close(); }); });
      break;

    case 'WELFARE_SHIFT_END':
      console.log('[SW] Welfare shift ended');
      self.registration.getNotifications({ tag: 'welfare-10min'  }).then(function(ns) { ns.forEach(function(n) { n.close(); }); });
      self.registration.getNotifications({ tag: 'welfare-5min'   }).then(function(ns) { ns.forEach(function(n) { n.close(); }); });
      self.registration.getNotifications({ tag: 'welfare-overdue' }).then(function(ns) { ns.forEach(function(n) { n.close(); }); });
      break;

    default:
      // Unknown message type — ignore
      break;
  }
});

console.log('[SW] Service Worker loaded - version', CACHE_VERSION);

