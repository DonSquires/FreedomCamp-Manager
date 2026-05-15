/**
 * Service Worker Registration and Offline Cache Helper
 * 
 * Coordinates service worker lifecycle, offline detection, and cache strategies
 */

export interface OfflineQueueItem {
  id: string
  timestamp: number
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  payload?: any
  priority: 'high' | 'normal' | 'low'
  retryCount: number
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Worker not supported')
    return null
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    })
    console.log('[SW] Registered:', registration)
    return registration
  } catch (err) {
    console.error('[SW] Registration failed:', err)
    return null
  }
}

export async function syncOfflineQueue(): Promise<void> {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    console.warn('[SW Sync] No service worker active')
    return
  }

  try {
    const registration = await navigator.serviceWorker.ready
    if (!registration.sync) {
      console.warn('[SW Sync] Background Sync not supported')
      return
    }

    // Trigger background sync tag: "sync-queue"
    await registration.sync.register('sync-queue')
    console.log('[SW Sync] Background sync registered')
  } catch (err) {
    console.error('[SW Sync] Failed to register:', err)
  }
}

export function listenForOfflineQueue(
  callback: (items: OfflineQueueItem[]) => void
): VoidFunction {
  if (!('serviceWorker' in navigator)) {
    return () => {}
  }

  const controller = navigator.serviceWorker.controller
  if (!controller) {
    return () => {}
  }

  const handleMessage = (event: MessageEvent) => {
    if (event.data.type === 'offline-queue-update') {
      callback(event.data.items || [])
    }
  }

  navigator.serviceWorker.addEventListener('message', handleMessage)

  // Return unsubscribe function
  return () => {
    navigator.serviceWorker.removeEventListener('message', handleMessage)
  }
}

export async function requestOfflineQueueStatus(): Promise<OfflineQueueItem[]> {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    return []
  }

  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data.type === 'offline-queue-status') {
        navigator.serviceWorker.removeEventListener('message', listener)
        resolve(event.data.items || [])
      }
    }

    navigator.serviceWorker.addEventListener('message', listener)
    navigator.serviceWorker.controller.postMessage({ type: 'get-offline-queue-status' })

    // Timeout after 5s
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', listener)
      resolve([])
    }, 5000)
  })
}
