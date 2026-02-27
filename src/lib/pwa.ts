/**
 * Utility Library: pwa
 * Progressive Web App (PWA) service worker management
 */

interface ServiceWorkerStatus {
  registered: boolean
  active: boolean
  installing: boolean
  waiting: boolean
  controllerUrl?: string
}

interface UpdateAvailableEvent {
  type: 'update-available'
  waiting: ServiceWorker
}

interface CacheConfig {
  name: string
  version: string
  urls: string[]
  strategy: 'cache-first' | 'network-first' | 'cache-only' | 'network-only'
}

/**
 * Register service worker
 */
export async function registerServiceWorker(
  swPath: string = '/sw.js'
): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service workers not supported')
    return null
  }

  try {
    const registration = await navigator.serviceWorker.register(swPath, {
      scope: '/',
    })

    console.log('Service Worker registered:', registration.scope)

    // Check for updates immediately
    registration.update()

    return registration
  } catch (error) {
    console.error('Service Worker registration failed:', error)
    return null
  }
}

/**
 * Unregister service worker
 */
export async function unregisterServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    
    if (registration) {
      const success = await registration.unregister()
      console.log('Service Worker unregistered:', success)
      return success
    }
    
    return false
  } catch (error) {
    console.error('Service Worker unregistration failed:', error)
    return false
  }
}

/**
 * Get service worker status
 */
export async function getServiceWorkerStatus(): Promise<ServiceWorkerStatus> {
  const status: ServiceWorkerStatus = {
    registered: false,
    active: false,
    installing: false,
    waiting: false,
  }

  if (!('serviceWorker' in navigator)) {
    return status
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    
    if (registration) {
      status.registered = true
      status.active = !!registration.active
      status.installing = !!registration.installing
      status.waiting = !!registration.waiting
      
      if (registration.active) {
        status.controllerUrl = registration.active.scriptURL
      }
    }
  } catch (error) {
    console.error('Failed to get service worker status:', error)
  }

  return status
}

/**
 * Check for service worker updates
 */
export async function checkForUpdates(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    
    if (registration) {
      await registration.update()
      return !!registration.waiting
    }
    
    return false
  } catch (error) {
    console.error('Update check failed:', error)
    return false
  }
}

/**
 * Skip waiting and activate new service worker
 */
export async function skipWaitingAndActivate(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
  } catch (error) {
    console.error('Skip waiting failed:', error)
  }
}

/**
 * Listen for service worker updates
 */
export function onUpdateAvailable(
  callback: (event: UpdateAvailableEvent) => void
): () => void {
  if (!('serviceWorker' in navigator)) {
    return () => {}
  }

  const handleStateChange = async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    
    if (registration?.waiting) {
      callback({
        type: 'update-available',
        waiting: registration.waiting,
      })
    }
  }

  navigator.serviceWorker.addEventListener('controllerchange', handleStateChange)

  // Check immediately
  handleStateChange()

  return () => {
    navigator.serviceWorker.removeEventListener('controllerchange', handleStateChange)
  }
}

/**
 * Send message to service worker
 */
export async function sendMessageToServiceWorker(message: any): Promise<any> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers not supported')
  }

  return new Promise((resolve, reject) => {
    const messageChannel = new MessageChannel()

    messageChannel.port1.onmessage = (event) => {
      if (event.data.error) {
        reject(event.data.error)
      } else {
        resolve(event.data)
      }
    }

    navigator.serviceWorker.controller?.postMessage(message, [messageChannel.port2])
  })
}

/**
 * Clear all caches
 */
export async function clearAllCaches(): Promise<void> {
  if (!('caches' in window)) {
    return
  }

  try {
    const cacheNames = await caches.keys()
    
    await Promise.all(
      cacheNames.map(cacheName => caches.delete(cacheName))
    )
    
    console.log(`Cleared ${cacheNames.length} caches`)
  } catch (error) {
    console.error('Failed to clear caches:', error)
  }
}

/**
 * Get cache storage estimate
 */
export async function getCacheStorageEstimate(): Promise<{
  usage: number
  quota: number
  usagePercent: number
}> {
  if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
    return { usage: 0, quota: 0, usagePercent: 0 }
  }

  try {
    const estimate = await navigator.storage.estimate()
    const usage = estimate.usage || 0
    const quota = estimate.quota || 0
    const usagePercent = quota > 0 ? (usage / quota) * 100 : 0

    return { usage, quota, usagePercent }
  } catch (error) {
    console.error('Failed to get storage estimate:', error)
    return { usage: 0, quota: 0, usagePercent: 0 }
  }
}

/**
 * Preload URLs into cache
 */
export async function preloadUrls(urls: string[], cacheName: string = 'preload-cache'): Promise<void> {
  if (!('caches' in window)) {
    return
  }

  try {
    const cache = await caches.open(cacheName)
    await cache.addAll(urls)
    console.log(`Preloaded ${urls.length} URLs into ${cacheName}`)
  } catch (error) {
    console.error('Failed to preload URLs:', error)
  }
}

/**
 * Check if app is running in standalone mode (PWA)
 */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  )
}

/**
 * Check if app is installable
 */
export function canInstallPWA(): boolean {
  return 'beforeinstallprompt' in window
}

/**
 * Prompt user to install PWA
 */
export async function promptInstall(
  deferredPrompt: BeforeInstallPromptEvent | null
): Promise<'accepted' | 'dismissed' | null> {
  if (!deferredPrompt) {
    console.warn('Install prompt not available')
    return null
  }

  try {
    deferredPrompt.prompt()
    const result = await deferredPrompt.userChoice
    return result.outcome
  } catch (error) {
    console.error('Install prompt failed:', error)
    return null
  }
}

/**
 * Listen for install prompt
 */
export function onBeforeInstallPrompt(
  callback: (event: BeforeInstallPromptEvent) => void
): () => void {
  const handler = (e: Event) => {
    e.preventDefault()
    callback(e as BeforeInstallPromptEvent)
  }

  window.addEventListener('beforeinstallprompt', handler)

  return () => {
    window.removeEventListener('beforeinstallprompt', handler)
  }
}

/**
 * Detect if running on iOS
 */
export function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/**
 * Check if app is installed on iOS
 */
export function isIOSInstalled(): boolean {
  return isIOS() && (window.navigator as any).standalone === true
}

/**
 * Get network information
 */
export function getNetworkInfo(): {
  online: boolean
  effectiveType?: string
  downlink?: number
  rtt?: number
  saveData?: boolean
} {
  const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection

  return {
    online: navigator.onLine,
    effectiveType: connection?.effectiveType,
    downlink: connection?.downlink,
    rtt: connection?.rtt,
    saveData: connection?.saveData,
  }
}

/**
 * Listen for online/offline events
 */
export function onNetworkStatusChange(
  callback: (online: boolean) => void
): () => void {
  const handleOnline = () => callback(true)
  const handleOffline = () => callback(false)

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}

/**
 * Request persistent storage
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator) || !('persist' in navigator.storage)) {
    return false
  }

  try {
    const isPersisted = await navigator.storage.persisted()
    
    if (isPersisted) {
      return true
    }

    const granted = await navigator.storage.persist()
    return granted
  } catch (error) {
    console.error('Failed to request persistent storage:', error)
    return false
  }
}

/**
 * Keep screen awake (for field officers)
 */
export async function keepScreenAwake(): Promise<WakeLockSentinel | null> {
  if (!('wakeLock' in navigator)) {
    console.warn('Wake Lock API not supported')
    return null
  }

  try {
    const wakeLock = await (navigator as any).wakeLock.request('screen')
    console.log('Screen wake lock active')
    return wakeLock
  } catch (error) {
    console.error('Wake lock request failed:', error)
    return null
  }
}

/**
 * Release screen wake lock
 */
export async function releaseScreenAwake(wakeLock: WakeLockSentinel | null): Promise<void> {
  if (!wakeLock) return

  try {
    await wakeLock.release()
    console.log('Screen wake lock released')
  } catch (error) {
    console.error('Wake lock release failed:', error)
  }
}

// Type definitions for PWA-specific events
declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }

  interface WakeLockSentinel {
    release(): Promise<void>
    released: boolean
    type: 'screen'
  }
}
