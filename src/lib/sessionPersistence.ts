/**
 * Utility Library: sessionPersistence
 * Session storage and local storage utilities with encryption support
 */

interface StorageOptions {
  encrypt?: boolean
  expiresIn?: number // milliseconds
}

interface StoredItem<T> {
  value: T
  encrypted: boolean
  expiresAt?: number
  createdAt: number
}

/**
 * Save to localStorage with optional encryption and expiry
 */
export function saveToLocalStorage<T>(
  key: string,
  value: T,
  options: StorageOptions = {}
): void {
  try {
    const item: StoredItem<T> = {
      value,
      encrypted: options.encrypt || false,
      createdAt: Date.now(),
    }

    if (options.expiresIn) {
      item.expiresAt = Date.now() + options.expiresIn
    }

    const serialized = JSON.stringify(item)
    const stored = options.encrypt ? btoa(serialized) : serialized

    localStorage.setItem(key, stored)
  } catch (error) {
    console.error('Failed to save to localStorage:', error)
  }
}

/**
 * Load from localStorage with automatic expiry check
 */
export function loadFromLocalStorage<T>(key: string): T | null {
  try {
    const stored = localStorage.getItem(key)
    if (!stored) return null

    const item: StoredItem<T> = JSON.parse(
      stored.startsWith('{') ? stored : atob(stored)
    )

    // Check expiry
    if (item.expiresAt && Date.now() > item.expiresAt) {
      localStorage.removeItem(key)
      return null
    }

    return item.value
  } catch (error) {
    console.error('Failed to load from localStorage:', error)
    return null
  }
}

/**
 * Remove from localStorage
 */
export function removeFromLocalStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    console.error('Failed to remove from localStorage:', error)
  }
}

/**
 * Clear all localStorage
 */
export function clearLocalStorage(): void {
  try {
    localStorage.clear()
  } catch (error) {
    console.error('Failed to clear localStorage:', error)
  }
}

/**
 * Save to sessionStorage
 */
export function saveToSessionStorage<T>(
  key: string,
  value: T,
  options: StorageOptions = {}
): void {
  try {
    const item: StoredItem<T> = {
      value,
      encrypted: options.encrypt || false,
      createdAt: Date.now(),
    }

    if (options.expiresIn) {
      item.expiresAt = Date.now() + options.expiresIn
    }

    const serialized = JSON.stringify(item)
    const stored = options.encrypt ? btoa(serialized) : serialized

    sessionStorage.setItem(key, stored)
  } catch (error) {
    console.error('Failed to save to sessionStorage:', error)
  }
}

/**
 * Load from sessionStorage with automatic expiry check
 */
export function loadFromSessionStorage<T>(key: string): T | null {
  try {
    const stored = sessionStorage.getItem(key)
    if (!stored) return null

    const item: StoredItem<T> = JSON.parse(
      stored.startsWith('{') ? stored : atob(stored)
    )

    // Check expiry
    if (item.expiresAt && Date.now() > item.expiresAt) {
      sessionStorage.removeItem(key)
      return null
    }

    return item.value
  } catch (error) {
    console.error('Failed to load from sessionStorage:', error)
    return null
  }
}

/**
 * Remove from sessionStorage
 */
export function removeFromSessionStorage(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch (error) {
    console.error('Failed to remove from sessionStorage:', error)
  }
}

/**
 * Clear all sessionStorage
 */
export function clearSessionStorage(): void {
  try {
    sessionStorage.clear()
  } catch (error) {
    console.error('Failed to clear sessionStorage:', error)
  }
}

/**
 * Check if localStorage is available
 */
export function isLocalStorageAvailable(): boolean {
  try {
    const test = '__storage_test__'
    localStorage.setItem(test, test)
    localStorage.removeItem(test)
    return true
  } catch {
    return false
  }
}

/**
 * Check if sessionStorage is available
 */
export function isSessionStorageAvailable(): boolean {
  try {
    const test = '__storage_test__'
    sessionStorage.setItem(test, test)
    sessionStorage.removeItem(test)
    return true
  } catch {
    return false
  }
}

/**
 * Get storage size estimate
 */
export function getStorageSize(): {
  localStorageSize: number
  sessionStorageSize: number
} {
  const getSize = (storage: Storage) => {
    let size = 0
    for (const key in storage) {
      if (Object.prototype.hasOwnProperty.call(storage, key)) {
        size += storage[key].length + key.length
      }
    }
    return size
  }

  return {
    localStorageSize: isLocalStorageAvailable() ? getSize(localStorage) : 0,
    sessionStorageSize: isSessionStorageAvailable() ? getSize(sessionStorage) : 0,
  }
}

/**
 * Get all keys from localStorage
 */
export function getLocalStorageKeys(): string[] {
  if (!isLocalStorageAvailable()) return []
  return Object.keys(localStorage)
}

/**
 * Get all keys from sessionStorage
 */
export function getSessionStorageKeys(): string[] {
  if (!isSessionStorageAvailable()) return []
  return Object.keys(sessionStorage)
}

/**
 * Cleanup expired items from localStorage
 */
export function cleanupExpiredLocalStorage(): number {
  if (!isLocalStorageAvailable()) return 0

  const keys = getLocalStorageKeys()
  let cleaned = 0

  keys.forEach(key => {
    const item = loadFromLocalStorage(key)
    if (item === null) {
      cleaned++
    }
  })

  return cleaned
}

/**
 * Cleanup expired items from sessionStorage
 */
export function cleanupExpiredSessionStorage(): number {
  if (!isSessionStorageAvailable()) return 0

  const keys = getSessionStorageKeys()
  let cleaned = 0

  keys.forEach(key => {
    const item = loadFromSessionStorage(key)
    if (item === null) {
      cleaned++
    }
  })

  return cleaned
}

/**
 * Migrate data from localStorage to sessionStorage
 */
export function migrateToSessionStorage(keys: string[]): void {
  keys.forEach(key => {
    const value = loadFromLocalStorage(key)
    if (value !== null) {
      saveToSessionStorage(key, value)
      removeFromLocalStorage(key)
    }
  })
}

/**
 * Migrate data from sessionStorage to localStorage
 */
export function migrateToLocalStorage(keys: string[]): void {
  keys.forEach(key => {
    const value = loadFromSessionStorage(key)
    if (value !== null) {
      saveToLocalStorage(key, value)
      removeFromSessionStorage(key)
    }
  })
}

/**
 * Create namespaced storage helper
 */
export function createNamespacedStorage(namespace: string) {
  const prefix = `${namespace}:`

  return {
    save: <T>(key: string, value: T, options?: StorageOptions) => {
      saveToLocalStorage(`${prefix}${key}`, value, options)
    },
    load: <T>(key: string): T | null => {
      return loadFromLocalStorage<T>(`${prefix}${key}`)
    },
    remove: (key: string) => {
      removeFromLocalStorage(`${prefix}${key}`)
    },
    clear: () => {
      const keys = getLocalStorageKeys().filter(k => k.startsWith(prefix))
      keys.forEach(key => removeFromLocalStorage(key))
    },
    getAllKeys: (): string[] => {
      return getLocalStorageKeys()
        .filter(k => k.startsWith(prefix))
        .map(k => k.substring(prefix.length))
    },
  }
}

/**
 * Watch localStorage changes
 */
export function watchLocalStorage(
  key: string,
  callback: (newValue: any, oldValue: any) => void
): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === key && e.storageArea === localStorage) {
      const oldValue = e.oldValue ? JSON.parse(e.oldValue) : null
      const newValue = e.newValue ? JSON.parse(e.newValue) : null
      callback(newValue, oldValue)
    }
  }

  window.addEventListener('storage', handler)

  return () => {
    window.removeEventListener('storage', handler)
  }
}

/**
 * Batch save multiple items
 */
export function batchSaveToLocalStorage(
  items: Record<string, any>,
  options?: StorageOptions
): void {
  Object.entries(items).forEach(([key, value]) => {
    saveToLocalStorage(key, value, options)
  })
}

/**
 * Batch load multiple items
 */
export function batchLoadFromLocalStorage<T = any>(keys: string[]): Record<string, T | null> {
  const result: Record<string, T | null> = {}
  
  keys.forEach(key => {
    result[key] = loadFromLocalStorage<T>(key)
  })

  return result
}

/**
 * Export all localStorage data as JSON
 */
export function exportLocalStorage(): Record<string, any> {
  const data: Record<string, any> = {}
  
  getLocalStorageKeys().forEach(key => {
    data[key] = loadFromLocalStorage(key)
  })

  return data
}

/**
 * Import data to localStorage from JSON
 */
export function importToLocalStorage(data: Record<string, any>): void {
  Object.entries(data).forEach(([key, value]) => {
    saveToLocalStorage(key, value)
  })
}
