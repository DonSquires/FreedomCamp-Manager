import { create } from 'zustand'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase } from '../lib/supabase'

async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('default', {
    name: 'FieldOps Alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1d4ed8',
  })
}

async function registerPushToken(userId: string): Promise<string | null> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }
    if (finalStatus !== 'granted') return null

    const tokenData = await Notifications.getExpoPushTokenAsync()
    const token = tokenData.data
    if (!token) return null

    await supabase
      .from('user_profiles')
      .update({
        push_token: token,
        push_token_updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    await ensureNotificationChannel()
    return token
  } catch (error) {
    console.warn('Push token registration failed:', error)
    // Non-critical — notifications degraded gracefully
    return null
  }
}

export interface AuthUser {
  id: string
  email: string
  role: 'grand_master' | 'master' | 'admin' | 'officer' | 'admin_officer'
  organization_id: string | null
  full_name: string
  first_name: string
  last_name: string
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  loading: boolean
  enforcementWorkflow: string
  notificationStandby: boolean
  pushToken: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkSession: () => Promise<void>
  initializeNotificationRuntime: () => Promise<void>
}

async function hasGrantedNotificationPermission(): Promise<boolean> {
  const permissionResult = await Notifications.getPermissionsAsync().catch(() => ({
    status: 'undetermined' as const,
  }))
  return permissionResult.status === 'granted'
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  loading: true,
  enforcementWorkflow: 'admin_first',
  notificationStandby: false,
  pushToken: null,

  initializeNotificationRuntime: async () => {
    await ensureNotificationChannel().catch(() => {})
    const notificationsGranted = await hasGrantedNotificationPermission()
    set((state) => ({
      ...state,
      notificationStandby: !state.isAuthenticated && notificationsGranted,
    }))
  },

  login: async (email: string, password: string) => {
    set({ loading: true })

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, email, role, organization_id, first_name, last_name')
      .eq('id', data.user.id)
      .single()

    if (profileError) throw profileError

    const user: AuthUser = {
      id: profile.id,
      email: profile.email,
      role: profile.role as AuthUser['role'],
      organization_id: profile.organization_id,
      full_name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email,
      first_name: profile.first_name,
      last_name: profile.last_name,
    }

    // Fetch org enforcement workflow
    let workflow = 'admin_first'
    if (profile.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('enforcement_workflow')
        .eq('id', profile.organization_id)
        .single()
      if (org?.enforcement_workflow) workflow = org.enforcement_workflow
    }

    set({
      user,
      isAuthenticated: true,
      loading: false,
      enforcementWorkflow: workflow,
      notificationStandby: false,
    })

    // Register push token non-blocking
    registerPushToken(user.id)
      .then((token) => {
        if (token) {
          set((state) => ({ ...state, pushToken: token }))
        }
      })
      .catch(() => {})
  },

  logout: async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      // Keep local logout resilient even if sign-out has issues.
    }
    const hasStoredPushToken = !!get().pushToken
    const notificationsGranted = await hasGrantedNotificationPermission()
    const hasPushCapability = hasStoredPushToken || notificationsGranted
    set({
      user: null,
      isAuthenticated: false,
      loading: false,
      enforcementWorkflow: 'admin_first',
      notificationStandby: hasPushCapability,
    })
  },

  checkSession: async () => {
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      const notificationsGranted = await hasGrantedNotificationPermission()
      set({ loading: false, notificationStandby: notificationsGranted })
      return
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, email, role, organization_id, first_name, last_name')
      .eq('id', session.user.id)
      .single()

    if (!profile) {
      set({ loading: false })
      return
    }

    const user: AuthUser = {
      id: profile.id,
      email: profile.email,
      role: profile.role as AuthUser['role'],
      organization_id: profile.organization_id,
      full_name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email,
      first_name: profile.first_name,
      last_name: profile.last_name,
    }

    let workflow = 'admin_first'
    if (profile.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('enforcement_workflow')
        .eq('id', profile.organization_id)
        .single()
      if (org?.enforcement_workflow) workflow = org.enforcement_workflow
    }

    set({
      user,
      isAuthenticated: true,
      loading: false,
      enforcementWorkflow: workflow,
      notificationStandby: false,
    })
  },
}))
