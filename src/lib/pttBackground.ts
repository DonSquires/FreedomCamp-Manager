/**
 * PTT Background Service
 * 
 * Provides always-on PTT connectivity that:
 * 1. Auto-connects to org channel on user login
 * 2. Runs in background while using other parts of the app
 * 3. Uses Web Notifications API for incoming call alerts
 * 4. Maintains WebSocket connection with heartbeats
 * 5. Reconnects automatically on connection loss
 * 
 * For mobile (Expo), this would be implemented as a foreground service
 * with persistent notification.
 */

import { usePTTStore } from '@/stores/pttStore'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import {
  connectToOrgChannel,
  disconnectFromPTT,
  normalizePTTErrorMessage,
  initBluetoothPTT,
} from '@/lib/ptt'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isServiceRunning = false
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_DELAY_MS = 3000
const STEADY_STATE_RECONNECT_DELAY_MS = 30000
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let visibilityHandler: (() => void) | null = null
let storeUnsubscribe: (() => void) | null = null

function resolveOperationalOrganizationId(): string | null {
  const { user } = useAuthStore.getState()
  const { organizationId } = useGlobalFiltersStore.getState()

  if (!user) return null

  if (user.role === 'master' || user.role === 'grand_master') {
    return organizationId || user.organization_id || null
  }

  return user.organization_id || null
}

function isTransientPTTError(message: string): boolean {
  const text = message.toLowerCase()
  return (
    text.includes('reconnecting too quickly') ||
    text.includes('retry shortly') ||
    text.includes('currently unavailable')
  )
}

// ---------------------------------------------------------------------------
// Notification Support
// ---------------------------------------------------------------------------

/**
 * Request notification permission for PTT alerts
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('🎤 PTT Background: Notifications not supported')
    return false
  }

  if (Notification.permission === 'granted') {
    return true
  }

  if (Notification.permission === 'denied') {
    console.warn('🎤 PTT Background: Notification permission denied')
    return false
  }

  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

/**
 * Show a notification for incoming PTT transmission
 */
export function showIncomingCallNotification(speakerName: string, channelName: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return
  }

  // Only show if page is not visible
  if (document.visibilityState === 'visible') {
    return
  }

  const notification = new Notification('Incoming PTT', {
    body: `${speakerName} is speaking on ${channelName}`,
    icon: '/icons/ptt-icon.png',
    tag: 'ptt-incoming',
    requireInteraction: false,
    silent: false,
  })

  // Auto-close after 5 seconds
  setTimeout(() => notification.close(), 5000)

  // Focus window when clicked
  notification.onclick = () => {
    window.focus()
    notification.close()
  }
}

// ---------------------------------------------------------------------------
// Background Service
// ---------------------------------------------------------------------------

/**
 * Start the PTT background service
 * Auto-connects to org channel and maintains connection
 */
export async function startPTTBackgroundService(): Promise<void> {
  if (isServiceRunning) {
    console.log('🎤 PTT Background: Service already running')
    return
  }

  const operationalOrganizationId = resolveOperationalOrganizationId()
  if (!operationalOrganizationId) {
    console.warn('🎤 PTT Background: No user or organization')
    return
  }

  isServiceRunning = true
  reconnectAttempts = 0

  console.log('🎤 PTT Background: Starting service')

  // Request notification permission
  await requestNotificationPermission()

  // Initialize Bluetooth PTT if enabled
  const { bluetoothEnabled } = usePTTStore.getState()
  if (bluetoothEnabled) {
    initBluetoothPTT()
  }

  // Connect to org channel
  try {
    await connectToOrgChannel(operationalOrganizationId, 'Organization')
    reconnectAttempts = 0
    console.log('🎤 PTT Background: Connected to org channel')
  } catch (err) {
    const message = normalizePTTErrorMessage(err)
    if (isTransientPTTError(message)) {
      console.warn('🎤 PTT Background: Initial connect deferred', message)
    } else {
      console.error('🎤 PTT Background: Failed to connect', err)
    }
    scheduleReconnect()
  }

  // Handle page visibility changes
  visibilityHandler = () => {
    const store = usePTTStore.getState()
    
    if (document.visibilityState === 'hidden') {
      // Page is now hidden - keep connection alive
      console.log('🎤 PTT Background: Page hidden, maintaining connection')
    } else {
      // Page is visible again - check connection
      if (store.connectionStatus !== 'connected') {
        console.log('🎤 PTT Background: Page visible, reconnecting')
        reconnect()
      }
    }
  }
  document.addEventListener('visibilitychange', visibilityHandler)

  // Subscribe to speaking state changes for notifications
  storeUnsubscribe = usePTTStore.subscribe((state, prevState) => {
    // Show notification when someone starts speaking
    if (state.speakerId && !prevState.speakerId && !state.isSpeaking) {
      showIncomingCallNotification(
        state.speakerName || 'Unknown',
        state.channelName || 'PTT Channel'
      )
    }

    // Handle disconnection
    if (prevState.connectionStatus === 'connected' && state.connectionStatus !== 'connected') {
      console.log('🎤 PTT Background: Connection lost, reconnecting')
      scheduleReconnect()
    }
  })

  console.log('🎤 PTT Background: Service started')
}

/**
 * Stop the PTT background service
 */
export function stopPTTBackgroundService(): void {
  if (!isServiceRunning) return

  console.log('🎤 PTT Background: Stopping service')

  isServiceRunning = false

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }

  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }

  if (storeUnsubscribe) {
    storeUnsubscribe()
    storeUnsubscribe = null
  }

  disconnectFromPTT()

  console.log('🎤 PTT Background: Service stopped')
}

/**
 * Schedule a reconnection attempt
 */
function scheduleReconnect(): void {
  if (!isServiceRunning) return
  if (reconnectTimeout) return

  reconnectAttempts++
  // After initial burst attempts, keep retrying in steady-state mode instead
  // of hard-stopping behind a refresh requirement.
  const steadyState = reconnectAttempts > MAX_RECONNECT_ATTEMPTS
  const MAX_BACKOFF_MULTIPLIER = 5
  const delay = steadyState
    ? STEADY_STATE_RECONNECT_DELAY_MS
    : RECONNECT_DELAY_MS * Math.min(reconnectAttempts, MAX_BACKOFF_MULTIPLIER)

  if (steadyState) {
    usePTTStore
      .getState()
      .setError('Push to Talk is reconnecting in the background. Text chat remains available.')
  }

  console.log(`🎤 PTT Background: Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempts})`)

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null
    reconnect()
  }, delay)
}

/**
 * Attempt to reconnect
 */
async function reconnect(): Promise<void> {
  if (!isServiceRunning) return

  const operationalOrganizationId = resolveOperationalOrganizationId()
  if (!operationalOrganizationId) {
    console.warn('🎤 PTT Background: No user for reconnect')
    return
  }

  console.log('🎤 PTT Background: Reconnecting...')

  try {
    await connectToOrgChannel(operationalOrganizationId, 'Organization')
    reconnectAttempts = 0
    console.log('🎤 PTT Background: Reconnected')
  } catch (err) {
    const message = normalizePTTErrorMessage(err)
    if (isTransientPTTError(message)) {
      console.warn('🎤 PTT Background: Reconnect deferred', message)
    } else {
      console.error('🎤 PTT Background: Reconnect failed', err)
    }
    scheduleReconnect()
  }
}

/**
 * Check if the service is running
 */
export function isPTTBackgroundServiceRunning(): boolean {
  return isServiceRunning
}

// ---------------------------------------------------------------------------
// React Hook for Auto-Start
// ---------------------------------------------------------------------------

/**
 * Hook to auto-start PTT background service on login
 * Place this in App.tsx or a top-level component
 */
export function usePTTAutoStart(): void {
  const { user, isAuthenticated } = useAuthStore()

  // Use effect is in the component that uses this hook
  // This function just provides the logic
}

/**
 * Initialize PTT on auth state change
 * Call this when user logs in
 */
export function initializePTTOnLogin(): void {
  const { isAuthenticated } = useAuthStore.getState()
  const operationalOrganizationId = resolveOperationalOrganizationId()

  if (isAuthenticated && operationalOrganizationId) {
    startPTTBackgroundService()
  }
}

/**
 * Cleanup PTT on logout
 * Call this when user logs out
 */
export function cleanupPTTOnLogout(): void {
  stopPTTBackgroundService()
}

// ---------------------------------------------------------------------------
// Wake Lock (Keep Screen Active During Calls)
// ---------------------------------------------------------------------------

let wakeLock: WakeLockSentinel | null = null

/**
 * Request a wake lock to keep the screen on during PTT
 */
export async function requestWakeLock(): Promise<boolean> {
  if (!('wakeLock' in navigator)) {
    console.warn('🎤 PTT Background: Wake Lock not supported')
    return false
  }

  try {
    wakeLock = await navigator.wakeLock.request('screen')
    console.log('🎤 PTT Background: Wake lock acquired')

    wakeLock.addEventListener('release', () => {
      console.log('🎤 PTT Background: Wake lock released')
    })

    return true
  } catch (err) {
    console.error('🎤 PTT Background: Failed to acquire wake lock', err)
    return false
  }
}

/**
 * Release the wake lock
 */
export async function releaseWakeLock(): Promise<void> {
  if (wakeLock) {
    await wakeLock.release()
    wakeLock = null
    console.log('🎤 PTT Background: Wake lock released')
  }
}
