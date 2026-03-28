/**
 * Utility Library: pushNotifications
 * Push notification token management and delivery — Web Push (VAPID) + Expo
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
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied')  return false
  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

export function isNotificationSupported(): boolean {
  return 'Notification' in window
}

export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) return 'denied'
  return Notification.permission
}

/** Convert a base64url VAPID public key to a Uint8Array for pushManager.subscribe(). */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

/**
 * Subscribe the current browser to web push and save the subscription JSON to
 * user_profiles.push_subscription.  Also sets push_token to a 'web-push'
 * placeholder so existing checks still pass.
 *
 * Requires VITE_VAPID_PUBLIC_KEY to be set in the app's environment.
 */
export async function subscribeWebPush(userId: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Web Push not supported in this browser')
    return false
  }

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
  if (!vapidPublicKey) {
    console.error('VITE_VAPID_PUBLIC_KEY is not configured')
    return false
  }

  try {
    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
    }

    const subJson = subscription.toJSON()

    const { error } = await supabase
      .from('user_profiles')
      .update({
        push_subscription:        subJson,
        push_token:               'web-push',
        push_token_updated_at:    new Date().toISOString(),
      })
      .eq('id', userId)

    if (error) throw error
    console.log('[push] Web push subscription saved')
    return true
  } catch (err) {
    console.error('[push] subscribe failed:', err)
    return false
  }
}

/**
 * Unsubscribe from web push and clear the subscription from user_profiles.
 */
export async function unsubscribeWebPush(userId: string): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) await subscription.unsubscribe()
    } catch (err) {
      console.warn('[push] unsubscribe error:', err)
    }
  }
  await supabase
    .from('user_profiles')
    .update({ push_subscription: null, push_token: null, push_token_updated_at: null })
    .eq('id', userId)
}

/**
 * Register push token with user profile (Expo / legacy)
 */
export async function registerPushToken(token: string, userId: string): Promise<void> {
  const { error } = await supabase.from('user_profiles')
    .update({ push_token: token, push_token_updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}

export async function unregisterPushToken(userId: string): Promise<void> {
  const { error } = await supabase.from('user_profiles')
    .update({ push_token: null, push_token_updated_at: null })
    .eq('id', userId)
  if (error) throw error
}

/**
 * Show a local (same-tab) notification as a fallback when the app is open.
 */
export async function sendLocalNotification(
  title: string,
  body: string,
  options?: NotificationOptions
): Promise<void> {
  const hasPermission = await requestNotificationPermission()
  if (!hasPermission) return
  try {
    new Notification(title, {
      body,
      icon: '/iron-eagle-security-logo.jpg',
      badge: '/iron-eagle-security-logo.jpg',
      ...options,
    })
  } catch (err) {
    console.error('Local notification failed:', err)
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
    user_id:  userId,
    type:     notification.type,
    title:    notification.title,
    body:     notification.body,
    data:     notification.data,
    priority: notification.priority || 'normal',
  })
  if (error) throw error
}

/** @deprecated Use subscribeWebPush() instead */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  try {
    const registration = await navigator.serviceWorker.ready
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
    if (!vapidKey) return null
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })
  } catch (err) {
    console.error('Failed to subscribe to push:', err)
    return null
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) await subscription.unsubscribe()
  } catch (err) {
    console.error('Failed to unsubscribe from push:', err)
  }
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  try {
    const registration = await navigator.serviceWorker.ready
    return await registration.pushManager.getSubscription()
  } catch (err) {
    console.error('Failed to get push subscription:', err)
    return null
  }
}

export async function updateNotificationPreferences(
  userId: string,
  preferences: {
    breach_alerts?: boolean
    investigation_assignments?: boolean
    flagged_vehicle_alerts?: boolean
    welfare_alerts?: boolean
    system_alerts?: boolean
    shift_alerts?: boolean
  }
): Promise<void> {
  const { data: current, error: fetchError } = await supabase.from('user_profiles')
    .select('notification_preferences')
    .eq('id', userId)
    .single()
  if (fetchError) throw fetchError

  const updated = {
    ...((current?.notification_preferences as Record<string, unknown> | null) ?? {}),
    ...preferences,
  }
  const { error } = await supabase.from('user_profiles')
    .update({ notification_preferences: updated })
    .eq('id', userId)
  if (error) throw error
}

export async function hasNotificationEnabled(userId: string, notificationType: string): Promise<boolean> {
  const { data, error } = await supabase.from('user_profiles')
    .select('notification_preferences')
    .eq('id', userId)
    .single()
  if (error || !data || !data.notification_preferences) return true
  return (data.notification_preferences as Record<string, unknown>)[notificationType] !== false
}

