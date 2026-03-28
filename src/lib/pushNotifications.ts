/**
 * Utility Library: pushNotifications
 * Push notification token management and delivery
 */

import { supabase } from './supabase'

/**
 * Request notification permission
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('Notifications not supported')
    return false
  }

  if (Notification.permission === 'granted') {
    return true
  }

  if (Notification.permission === 'denied') {
    return false
  }

  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

/**
 * Check if notifications are supported
 */
export function isNotificationSupported(): boolean {
  return 'Notification' in window
}

/**
 * Check current notification permission status
 */
export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) {
    return 'denied'
  }
  return Notification.permission
}

/**
 * Register push token with user profile
 */
export async function registerPushToken(token: string, userId: string): Promise<void> {
  const { error } = await supabase.from('user_profiles')
    .update({
      push_token: token,
      push_token_updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    console.error('Failed to register push token:', error)
    throw error
  }
}

/**
 * Unregister push token
 */
export async function unregisterPushToken(userId: string): Promise<void> {
  const { error } = await supabase.from('user_profiles')
    .update({
      push_token: null,
      push_token_updated_at: null,
    })
    .eq('id', userId)

  if (error) {
    console.error('Failed to unregister push token:', error)
    throw error
  }
}

/**
 * Send local notification (fallback when push not available)
 */
export async function sendLocalNotification(
  title: string,
  body: string,
  options?: NotificationOptions
): Promise<void> {
  const hasPermission = await requestNotificationPermission()
  
  if (!hasPermission) {
    console.warn('Notification permission denied')
    return
  }

  try {
    new Notification(title, {
      body,
      icon: '/iron-eagle-security-logo.jpg',
      badge: '/iron-eagle-security-logo.jpg',
      ...options,
    })
  } catch (error) {
    console.error('Failed to show notification:', error)
  }
}

/**
 * Send notification via Edge Function
 */
export async function sendPushNotification(
  userId: string,
  notification: {
    type: string
    title: string
    body: string
    data?: any
    priority?: 'low' | 'normal' | 'high' | 'urgent'
  }
): Promise<void> {
  const { edgeFunctions } = await import('./edgeFunctions')
  const { error } = await edgeFunctions.sendPushNotification({
    user_id: userId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    priority: notification.priority || 'normal',
  })

  if (error) {
    console.error('Failed to send push notification:', error)
    throw error
  }
}

/**
 * Subscribe to push notifications (Service Worker)
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications not supported')
    return null
  }

  try {
    const registration = await navigator.serviceWorker.ready
    
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        // In production, use actual VAPID public key
        import.meta.env.VITE_VAPID_PUBLIC_KEY || ''
      ) as unknown as BufferSource,
    })

    return subscription
  } catch (error) {
    console.error('Failed to subscribe to push:', error)
    return null
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return
  }

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    
    if (subscription) {
      await subscription.unsubscribe()
    }
  } catch (error) {
    console.error('Failed to unsubscribe from push:', error)
  }
}

/**
 * Get current push subscription
 */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null
  }

  try {
    const registration = await navigator.serviceWorker.ready
    return await registration.pushManager.getSubscription()
  } catch (error) {
    console.error('Failed to get push subscription:', error)
    return null
  }
}

/**
 * Helper: Convert VAPID key
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  
  return outputArray
}

/**
 * Update notification preferences
 */
export async function updateNotificationPreferences(
  userId: string,
  preferences: {
    breach_alerts?: boolean
    investigation_assignments?: boolean
    flagged_vehicle_alerts?: boolean
    welfare_alerts?: boolean
    system_alerts?: boolean
  }
): Promise<void> {
  const { data: current, error: fetchError } = await supabase.from('user_profiles')
    .select('notification_preferences')
    .eq('id', userId)
    .single()

  if (fetchError) {
    console.error('Failed to fetch current preferences:', fetchError)
    throw fetchError
  }

  const updatedPreferences = {
    ...((current?.notification_preferences as Record<string, unknown> | null) || {}),
    ...preferences,
  }

  const { error: updateError } = await supabase.from('user_profiles')
    .update({ notification_preferences: updatedPreferences })
    .eq('id', userId)

  if (updateError) {
    console.error('Failed to update preferences:', updateError)
    throw updateError
  }
}

/**
 * Check if user has enabled specific notification type
 */
export async function hasNotificationEnabled(
  userId: string,
  notificationType: string
): Promise<boolean> {
  const { data, error } = await supabase.from('user_profiles')
    .select('notification_preferences')
    .eq('id', userId)
    .single()

  if (error || !data || !data.notification_preferences) {
    return true // Default to enabled if no preferences set
  }

  return (data.notification_preferences as Record<string, unknown>)[notificationType] !== false
}
