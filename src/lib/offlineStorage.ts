/**
 * Utility Library: offlineStorage
 * IndexedDB wrapper for offline data persistence
 */

const DB_NAME = 'FreedomCampOfflineDB'
const DB_VERSION = 2

interface StoreName {
  OBSERVATIONS: 'observations_queue'
  PHOTOS: 'photos_cache'
  METADATA: 'metadata'
  SYNC_LOG: 'sync_log'
}

const STORES: StoreName = {
  OBSERVATIONS: 'observations_queue',
  PHOTOS: 'photos_cache',
  METADATA: 'metadata',
  SYNC_LOG: 'sync_log',
}

let dbInstance: IDBDatabase | null = null

/**
 * Open IndexedDB connection
 */
export async function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Observations queue store
      if (!db.objectStoreNames.contains(STORES.OBSERVATIONS)) {
        const obsStore = db.createObjectStore(STORES.OBSERVATIONS, { keyPath: 'id' })
        obsStore.createIndex('status', 'status', { unique: false })
        obsStore.createIndex('created_at', 'created_at', { unique: false })
        obsStore.createIndex('plate_number', 'plate_number', { unique: false })
      }

      // Photos cache store
      if (!db.objectStoreNames.contains(STORES.PHOTOS)) {
        const photoStore = db.createObjectStore(STORES.PHOTOS, { keyPath: 'id' })
        photoStore.createIndex('observation_id', 'observation_id', { unique: false })
        photoStore.createIndex('cached_at', 'cached_at', { unique: false })
      }

      // Metadata store
      if (!db.objectStoreNames.contains(STORES.METADATA)) {
        db.createObjectStore(STORES.METADATA, { keyPath: 'key' })
      }

      // Sync log store
      if (!db.objectStoreNames.contains(STORES.SYNC_LOG)) {
        const syncStore = db.createObjectStore(STORES.SYNC_LOG, { keyPath: 'id', autoIncrement: true })
        syncStore.createIndex('timestamp', 'timestamp', { unique: false })
        syncStore.createIndex('status', 'status', { unique: false })
      }
    }
  })
}

/**
 * Generic get operation
 */
export async function get<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.get(key)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result || null)
  })
}

/**
 * Generic getAll operation
 */
export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.getAll()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result || [])
  })
}

/**
 * Generic put operation (insert or update)
 */
export async function put<T>(storeName: string, data: T): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.put(data)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * Generic delete operation
 */
export async function remove(storeName: string, key: string): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.delete(key)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * Clear all data from a store
 */
export async function clear(storeName: string): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.clear()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * Query by index
 */
export async function getByIndex<T>(
  storeName: string,
  indexName: string,
  value: any
): Promise<T[]> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)
    const index = store.index(indexName)
    const request = index.getAll(value)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result || [])
  })
}

/**
 * Count items in store
 */
export async function count(storeName: string): Promise<number> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.count()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

/**
 * Get database size estimate
 */
export async function getDatabaseSize(): Promise<{ usage: number; quota: number }> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate()
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
    }
  }
  
  return { usage: 0, quota: 0 }
}

/**
 * Check if storage is available
 */
export function isStorageAvailable(): boolean {
  return 'indexedDB' in window
}

/**
 * Export store data as JSON
 */
export async function exportStore<T>(storeName: string): Promise<T[]> {
  return getAll<T>(storeName)
}

/**
 * Import data to store
 */
export async function importStore<T>(storeName: string, data: T[]): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)

    data.forEach(item => {
      store.put(item)
    })

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

/**
 * Store names constant for external use
 */
export { STORES }
