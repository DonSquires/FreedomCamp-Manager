/**
 * Offline Storage with IndexedDB
 * Provides offline-first data persistence for field operations
 * 
 * Features:
 * - Store scans offline when network unavailable
 * - Auto-sync when connection restored
 * - Photo caching for offline viewing
 * - Queue management with retry logic
 */

const DB_NAME = 'fc_manager_offline';
const DB_VERSION = 1;
const SCAN_STORE = 'offline_scans';
const PHOTO_STORE = 'offline_photos';
const SYNC_QUEUE_STORE = 'sync_queue';

export interface OfflineScan {
  id: string;
  plateNumber: string;
  zoneId: string;
  zoneName: string;
  organizationId: string;
  timestamp: string;
  gpsLocation: {
    lat: number;
    lng: number;
    accuracy: number;
  } | null;
  photoDataUrl: string | null;
  vehicleDetails?: {
    make?: string;
    model?: string;
    color?: string;
    year?: string;
  };
  detectionMethod: 'alpr' | 'ocr' | 'manual';
  isSelfContained?: boolean;
  notes?: string;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  syncAttempts: number;
  lastSyncAttempt?: string;
  errorMessage?: string;
}

export interface OfflinePhoto {
  id: string;
  scanId: string;
  dataUrl: string;
  type: 'full' | 'cropped';
  timestamp: string;
}

class OfflineStorageManager {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  /**
   * Initialize IndexedDB
   */
  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB failed to open:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ IndexedDB initialized:', DB_NAME);
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        console.log('⬆️ Upgrading IndexedDB schema...');

        // Create offline scans store
        if (!db.objectStoreNames.contains(SCAN_STORE)) {
          const scanStore = db.createObjectStore(SCAN_STORE, { keyPath: 'id' });
          scanStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          scanStore.createIndex('timestamp', 'timestamp', { unique: false });
          scanStore.createIndex('zoneId', 'zoneId', { unique: false });
          console.log('Created offline_scans store');
        }

        // Create offline photos store
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          const photoStore = db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
          photoStore.createIndex('scanId', 'scanId', { unique: false });
          photoStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('Created offline_photos store');
        }

        // Create sync queue store
        if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
          const queueStore = db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' });
          queueStore.createIndex('priority', 'priority', { unique: false });
          queueStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('Created sync_queue store');
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Add scan to offline queue
   */
  async addScan(scan: Omit<OfflineScan, 'id' | 'syncStatus' | 'syncAttempts'>): Promise<string> {
    const db = await this.init();
    const id = `scan_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const offlineScan: OfflineScan = {
      ...scan,
      id,
      syncStatus: 'pending',
      syncAttempts: 0,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCAN_STORE], 'readwrite');
      const store = transaction.objectStore(SCAN_STORE);
      const request = store.add(offlineScan);

      request.onsuccess = () => {
        console.log('✅ Scan stored offline:', id);
        resolve(id);
      };

      request.onerror = () => {
        console.error('❌ Failed to store scan offline:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get all pending scans (need sync)
   */
  async getPendingScans(): Promise<OfflineScan[]> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCAN_STORE], 'readonly');
      const store = transaction.objectStore(SCAN_STORE);
      const index = store.index('syncStatus');
      const request = index.getAll('pending');

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Get all scans (for offline viewing)
   */
  async getAllScans(): Promise<OfflineScan[]> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCAN_STORE], 'readonly');
      const store = transaction.objectStore(SCAN_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Update scan sync status
   */
  async updateScanStatus(
    id: string,
    status: OfflineScan['syncStatus'],
    errorMessage?: string
  ): Promise<void> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCAN_STORE], 'readwrite');
      const store = transaction.objectStore(SCAN_STORE);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const scan = getRequest.result;
        if (!scan) {
          reject(new Error('Scan not found'));
          return;
        }

        scan.syncStatus = status;
        scan.syncAttempts += 1;
        scan.lastSyncAttempt = new Date().toISOString();
        if (errorMessage) scan.errorMessage = errorMessage;

        const updateRequest = store.put(scan);

        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = () => reject(updateRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Delete synced scan from offline storage
   */
  async deleteScan(id: string): Promise<void> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCAN_STORE], 'readwrite');
      const store = transaction.objectStore(SCAN_STORE);
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log('✅ Deleted synced scan:', id);
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Store photo for offline access
   */
  async addPhoto(photo: Omit<OfflinePhoto, 'id'>): Promise<string> {
    const db = await this.init();
    const id = `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const offlinePhoto: OfflinePhoto = {
      ...photo,
      id,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([PHOTO_STORE], 'readwrite');
      const store = transaction.objectStore(PHOTO_STORE);
      const request = store.add(offlinePhoto);

      request.onsuccess = () => {
        console.log('✅ Photo stored offline:', id);
        resolve(id);
      };

      request.onerror = () => {
        console.error('❌ Failed to store photo offline:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get photos for a scan
   */
  async getPhotosForScan(scanId: string): Promise<OfflinePhoto[]> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([PHOTO_STORE], 'readonly');
      const store = transaction.objectStore(PHOTO_STORE);
      const index = store.index('scanId');
      const request = index.getAll(scanId);

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Clear all synced scans (cleanup)
   */
  async clearSyncedScans(): Promise<number> {
    const db = await this.init();
    const syncedScans = await this.getSyncedScans();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCAN_STORE], 'readwrite');
      const store = transaction.objectStore(SCAN_STORE);

      let deleted = 0;
      syncedScans.forEach((scan) => {
        store.delete(scan.id);
        deleted++;
      });

      transaction.oncomplete = () => {
        console.log(`✅ Cleared ${deleted} synced scans`);
        resolve(deleted);
      };

      transaction.onerror = () => {
        reject(transaction.error);
      };
    });
  }

  /**
   * Get synced scans for cleanup
   */
  private async getSyncedScans(): Promise<OfflineScan[]> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCAN_STORE], 'readonly');
      const store = transaction.objectStore(SCAN_STORE);
      const index = store.index('syncStatus');
      const request = index.getAll('synced');

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Get storage usage estimate
   */
  async getStorageEstimate(): Promise<{ usage: number; quota: number; percentage: number }> {
    if (!navigator.storage || !navigator.storage.estimate) {
      return { usage: 0, quota: 0, percentage: 0 };
    }

    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percentage = quota > 0 ? (usage / quota) * 100 : 0;

    return { usage, quota, percentage };
  }
}

// Export singleton instance
export const offlineStorage = new OfflineStorageManager();
