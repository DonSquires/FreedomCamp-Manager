/**
 * Progressive Web App (PWA) Utilities
 * Handles offline scanning capability with IndexedDB queue and background sync
 */

interface QueuedScan {
  id: string;
  type: 'vehicle_scan' | 'incident_report' | 'plate_scan';
  data: any;
  photos: Array<{ file: Blob; hash: string; type: string }>;
  timestamp: number;
  retryCount: number;
}

const DB_NAME = 'freedomcamp_offline';
const DB_VERSION = 1;
const STORE_NAME = 'scan_queue';

/**
 * Initialize IndexedDB for offline queue
 */
export function initOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    };
  });
}

/**
 * Add scan to offline queue
 */
export async function queueOfflineScan(scan: Omit<QueuedScan, 'id' | 'retryCount'>): Promise<void> {
  const db = await initOfflineDB();
  
  const queuedScan: QueuedScan = {
    ...scan,
    id: `scan_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    retryCount: 0,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(queuedScan);

    request.onsuccess = () => {
      console.log('Scan queued for offline sync:', queuedScan.id);
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all queued scans
 */
export async function getQueuedScans(): Promise<QueuedScan[]> {
  const db = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove scan from queue
 */
export async function removeScanFromQueue(scanId: string): Promise<void> {
  const db = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(scanId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Process offline queue (sync when back online)
 */
export async function processOfflineQueue(
  supabase: any,
  onProgress?: (current: number, total: number, scan: QueuedScan) => void
): Promise<{ synced: number; failed: number }> {
  const scans = await getQueuedScans();
  let synced = 0;
  let failed = 0;

  for (let i = 0; i < scans.length; i++) {
    const scan = scans[i];
    onProgress?.(i + 1, scans.length, scan);

    try {
      // Upload photos first
      const photoUrls: string[] = [];
      for (const photo of scan.photos) {
        const fileName = `offline_sync/${scan.id}/${Date.now()}_${photo.hash.slice(0, 8)}.jpg`;
        const { error } = await supabase.storage
          .from('evidence')
          .upload(fileName, photo.file);

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
          .from('evidence')
          .getPublicUrl(fileName);

        photoUrls.push(publicUrl);
      }

      // Submit scan data based on type
      if (scan.type === 'vehicle_scan') {
        await supabase.from('vehicle_records').insert({
          ...scan.data,
          evidence_photos: photoUrls,
        });
      } else if (scan.type === 'incident_report') {
        await supabase.from('incidents').insert({
          ...scan.data,
          photos: photoUrls,
        });
      } else if (scan.type === 'plate_scan') {
        await supabase.from('plate_scans').insert({
          ...scan.data,
          scanned_photo: photoUrls[0],
        });
      }

      // Remove from queue on success
      await removeScanFromQueue(scan.id);
      synced++;
    } catch (error) {
      console.error(`Failed to sync scan ${scan.id}:`, error);
      failed++;

      // Update retry count
      const db = await initOfflineDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      scan.retryCount++;
      store.put(scan);
    }
  }

  return { synced, failed };
}

/**
 * Check if online
 */
export function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * Listen for online/offline events
 */
export function setupOnlineListener(
  onOnline: () => void,
  onOffline: () => void
): () => void {
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

/**
 * Register service worker for PWA
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null;
  
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered:', registration);
      
      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              console.log('New version available');
              // Trigger custom event for UI to show update notification
              window.dispatchEvent(new CustomEvent('app-update-available'));
            }
          });
        }
      });
      
      return registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      return null;
    }
  }
  return null;
}

/**
 * Check for app updates
 */
export async function checkForUpdates(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.update();
      return true;
    }
  } catch (error) {
    console.error('Update check failed:', error);
  }
  return false;
}

/**
 * Get current app version from localStorage
 */
export function getStoredVersion(): string | null {
  return localStorage.getItem('app-version');
}

/**
 * Store current app version
 */
export function storeVersion(version: string): void {
  localStorage.setItem('app-version', version);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  oldestTimestamp: number | null;
  totalSize: number;
}> {
  const scans = await getQueuedScans();

  const stats = {
    total: scans.length,
    byType: {} as Record<string, number>,
    oldestTimestamp: scans.length > 0 ? Math.min(...scans.map(s => s.timestamp)) : null,
    totalSize: 0,
  };

  scans.forEach(scan => {
    stats.byType[scan.type] = (stats.byType[scan.type] || 0) + 1;
    stats.totalSize += scan.photos.reduce((sum, p) => sum + p.file.size, 0);
  });

  return stats;
}
