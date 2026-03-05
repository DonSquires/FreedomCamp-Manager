// Service Worker for FreedomCamp Manager PWA
// Handles offline caching, background sync, and auto-updates
// NOW WITH: IndexedDB sync, offline API queue, Background Sync API

var CACHE_VERSION = '2.4.0'; // Bumped: postcss/tailwind CSS fix
var CACHE_NAME = 'freedomcamp-v' + CACHE_VERSION;
var API_CACHE = 'freedomcamp-api-v' + CACHE_VERSION;
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
            if (cacheName !== CACHE_NAME && cacheName !== API_CACHE) {
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

  var isApiRequest = 
    event.request.url.indexOf('/api/') !== -1 ||
    event.request.url.indexOf('supabase.co') !== -1 ||
    event.request.url.indexOf('functions/v1') !== -1;

  // Navigation requests (HTML pages) - always Network first so index.html
  // is never served stale after a new deployment changes asset hashes.
  var isNavigationRequest = event.request.mode === 'navigate';

  // API requests - Network first with offline fallback
  if (isApiRequest) {
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
        // Return offline page if available
        return caches.match('/index.html');
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

// Push notification handler
self.addEventListener('push', function(event) {
  console.log('[SW] Push notification received:', event);
  
  if (!event.data) return;

  var data = event.data.json();
  var options = {
    body: data.body || '',
    icon: '/iron-eagle-security-logo.jpg',
    badge: '/iron-eagle-security-logo.jpg',
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
