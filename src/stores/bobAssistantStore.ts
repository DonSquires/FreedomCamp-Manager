import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useAuthStore } from './authStore'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'

export type BobVoiceGender = 'male' | 'female' | 'neutral'
export type BobAccent = 'en-NZ' | 'en-AU' | 'en-GB' | 'en-US'
export type BobTone = 'professional' | 'friendly' | 'coach'
export type BobSpeechStyle = 'default' | 'bridge_lead' | 'wise_mentor'
export type EmergencyCancelVerificationMode = 'platform_biometric' | 'voiceprint'

export type BobAssistantPersistedSettings = {
  displayName: string
  tone: BobTone
  voiceGender: BobVoiceGender
  accent: BobAccent
  speechStyle: BobSpeechStyle
  speechRate: number
  speechEnabled: boolean
  autoSpeakReplies: boolean
  voiceActivatedConversation: boolean
  expressUserDataPermission: boolean
  permittedUserIdentity: string
  voicePatternLearningConsent: boolean
  faceClarificationConsent: boolean
  secureCancelVerificationEnabled: boolean
  cancelVerificationMode: EmergencyCancelVerificationMode
}

interface BobAssistantState {
  displayName: string
  tone: BobTone
  voiceGender: BobVoiceGender
  accent: BobAccent
  speechStyle: BobSpeechStyle
  speechRate: number
  speechEnabled: boolean
  autoSpeakReplies: boolean
  voiceActivatedConversation: boolean
  expressUserDataPermission: boolean
  permittedUserIdentity: string
  voicePatternLearningConsent: boolean
  faceClarificationConsent: boolean
  secureCancelVerificationEnabled: boolean
  cancelVerificationMode: EmergencyCancelVerificationMode
  setDisplayName: (value: string) => void
  setTone: (value: BobTone) => void
  setVoiceGender: (value: BobVoiceGender) => void
  setAccent: (value: BobAccent) => void
  setSpeechStyle: (value: BobSpeechStyle) => void
  setSpeechRate: (value: number) => void
  setSpeechEnabled: (value: boolean) => void
  setAutoSpeakReplies: (value: boolean) => void
  setVoiceActivatedConversation: (value: boolean) => void
  setExpressUserDataPermission: (value: boolean) => void
  setPermittedUserIdentity: (value: string) => void
  setVoicePatternLearningConsent: (value: boolean) => void
  setFaceClarificationConsent: (value: boolean) => void
  setSecureCancelVerificationEnabled: (value: boolean) => void
  setCancelVerificationMode: (value: EmergencyCancelVerificationMode) => void
  hydrateForUser: (userId?: string | null) => void
}

const BOB_ASSISTANT_STORAGE_NAME = 'bob-assistant-settings'
const BOB_ASSISTANT_CLOUD_NAMESPACE = 'bob_preferences_v1'

const DEFAULT_BOB_ASSISTANT_SETTINGS: BobAssistantPersistedSettings = {
  displayName: 'Bob' as const,
  tone: 'friendly' as BobTone,
  voiceGender: 'male' as BobVoiceGender,
  accent: 'en-NZ' as BobAccent,
  speechStyle: 'default' as BobSpeechStyle,
  speechRate: 1,
  speechEnabled: true,
  autoSpeakReplies: true,
  voiceActivatedConversation: false,
  expressUserDataPermission: false,
  permittedUserIdentity: '',
  voicePatternLearningConsent: false,
  faceClarificationConsent: false,
  secureCancelVerificationEnabled: true,
  cancelVerificationMode: 'platform_biometric',
}

function selectPersistableAssistantSettings(state: BobAssistantState): BobAssistantPersistedSettings {
  return {
    displayName: state.displayName,
    tone: state.tone,
    voiceGender: state.voiceGender,
    accent: state.accent,
    speechStyle: state.speechStyle,
    speechRate: state.speechRate,
    speechEnabled: state.speechEnabled,
    autoSpeakReplies: state.autoSpeakReplies,
    voiceActivatedConversation: state.voiceActivatedConversation,
    expressUserDataPermission: state.expressUserDataPermission,
    permittedUserIdentity: state.permittedUserIdentity,
    voicePatternLearningConsent: state.voicePatternLearningConsent,
    faceClarificationConsent: state.faceClarificationConsent,
    secureCancelVerificationEnabled: state.secureCancelVerificationEnabled,
    cancelVerificationMode: state.cancelVerificationMode,
  }
}

function sanitizeCloudAssistantSettings(input: unknown): Partial<BobAssistantPersistedSettings> {
  const candidate = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {}

  return {
    displayName: typeof candidate.displayName === 'string' ? candidate.displayName : undefined,
    tone: candidate.tone === 'professional' || candidate.tone === 'friendly' || candidate.tone === 'coach'
      ? candidate.tone
      : undefined,
    voiceGender: candidate.voiceGender === 'male' || candidate.voiceGender === 'female' || candidate.voiceGender === 'neutral'
      ? candidate.voiceGender
      : undefined,
    accent: candidate.accent === 'en-NZ' || candidate.accent === 'en-AU' || candidate.accent === 'en-GB' || candidate.accent === 'en-US'
      ? candidate.accent
      : undefined,
    speechStyle: candidate.speechStyle === 'default' || candidate.speechStyle === 'bridge_lead' || candidate.speechStyle === 'wise_mentor'
      ? candidate.speechStyle
      : undefined,
    speechRate: typeof candidate.speechRate === 'number' ? Math.max(0.7, Math.min(1.3, candidate.speechRate)) : 1,
    speechEnabled: typeof candidate.speechEnabled === 'boolean' ? candidate.speechEnabled : undefined,
    autoSpeakReplies: typeof candidate.autoSpeakReplies === 'boolean' ? candidate.autoSpeakReplies : undefined,
    voiceActivatedConversation: typeof candidate.voiceActivatedConversation === 'boolean' ? candidate.voiceActivatedConversation : undefined,
    expressUserDataPermission: typeof candidate.expressUserDataPermission === 'boolean' ? candidate.expressUserDataPermission : undefined,
    permittedUserIdentity: typeof candidate.permittedUserIdentity === 'string' ? candidate.permittedUserIdentity : undefined,
    voicePatternLearningConsent: typeof candidate.voicePatternLearningConsent === 'boolean' ? candidate.voicePatternLearningConsent : undefined,
    faceClarificationConsent: typeof candidate.faceClarificationConsent === 'boolean' ? candidate.faceClarificationConsent : undefined,
    secureCancelVerificationEnabled: typeof candidate.secureCancelVerificationEnabled === 'boolean' ? candidate.secureCancelVerificationEnabled : undefined,
    cancelVerificationMode: candidate.cancelVerificationMode === 'voiceprint' || candidate.cancelVerificationMode === 'platform_biometric'
      ? candidate.cancelVerificationMode
      : undefined,
  }
}

async function loadCloudAssistantSettings(userId: string): Promise<Partial<BobAssistantPersistedSettings>> {
  try {
    const { data, error } = await (supabase.from('bob_user_profiles') as any)
      .select('permissions')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !data) {
      return {}
    }

    const permissions = (data.permissions ?? {}) as Record<string, unknown>
    return sanitizeCloudAssistantSettings(permissions[BOB_ASSISTANT_CLOUD_NAMESPACE])
  } catch {
    return {}
  }
}

async function saveCloudAssistantSettings(userId: string, settings: BobAssistantPersistedSettings): Promise<void> {
  try {
    const { data: existing } = await (supabase.from('bob_user_profiles') as any)
      .select('id, permissions')
      .eq('user_id', userId)
      .maybeSingle()

    const permissions = {
      ...((existing?.permissions as Record<string, unknown> | null) ?? {}),
      [BOB_ASSISTANT_CLOUD_NAMESPACE]: settings,
    } as Json

    if (existing?.id) {
      await (supabase.from('bob_user_profiles') as any)
        .update({ permissions, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await (supabase.from('bob_user_profiles') as any)
        .insert({ user_id: userId, permissions })
    }
  } catch {
    // Non-blocking: local user-scoped persistence remains source of truth if cloud sync fails.
  }
}

function resolveUserScopedBobAssistantKey(userId?: string | null): string {
  return `${BOB_ASSISTANT_STORAGE_NAME}:${userId || 'anon'}`
}

function getCurrentUserId(): string | null {
  try {
    return useAuthStore.getState().user?.id ?? null
  } catch {
    return null
  }
}

function loadUserScopedBobAssistantState(userId?: string | null): Partial<BobAssistantState> {
  if (typeof window === 'undefined') {
    return {}
  }

  const scopedKey = resolveUserScopedBobAssistantKey(userId)
  let raw = window.localStorage.getItem(scopedKey)

  // One-time migration for pre-user-scoped settings.
  if (!raw && userId) {
    const legacy = window.localStorage.getItem(BOB_ASSISTANT_STORAGE_NAME)
    if (legacy) {
      window.localStorage.setItem(scopedKey, legacy)
      window.localStorage.removeItem(BOB_ASSISTANT_STORAGE_NAME)
      raw = legacy
    }
  }

  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    const state = parsed?.state && typeof parsed.state === 'object' ? parsed.state : parsed
    if (!state || typeof state !== 'object') {
      return {}
    }
    return state as Partial<BobAssistantState>
  } catch {
    return {}
  }
}

const bobAssistantScopedStorage = {
  getItem: (name: string): string | null => {
    if (typeof window === 'undefined') return null
    const key = resolveUserScopedBobAssistantKey(getCurrentUserId())
    const scoped = window.localStorage.getItem(key)
    if (scoped !== null) return scoped

    // Legacy fallback for first run after upgrade.
    const legacy = window.localStorage.getItem(name)
    if (legacy !== null) {
      window.localStorage.setItem(key, legacy)
      window.localStorage.removeItem(name)
      return legacy
    }

    return null
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === 'undefined') return
    const key = resolveUserScopedBobAssistantKey(getCurrentUserId())
    window.localStorage.setItem(key, value)
  },
  removeItem: (name: string): void => {
    if (typeof window === 'undefined') return
    const key = resolveUserScopedBobAssistantKey(getCurrentUserId())
    window.localStorage.removeItem(key)
  },
}

export const useBobAssistantStore = create<BobAssistantState>()(
  persist(
    (set) => ({
      ...DEFAULT_BOB_ASSISTANT_SETTINGS,
      setDisplayName: (value) => set({ displayName: value.trim() || 'Bob' }),
      setTone: (value) => set({ tone: value }),
      setVoiceGender: (value) => set({ voiceGender: value }),
      setAccent: (value) => set({ accent: value }),
      setSpeechStyle: (value) => set({ speechStyle: value }),
      setSpeechRate: (value) => set({ speechRate: Math.max(0.7, Math.min(1.3, value || 1)) }),
      setSpeechEnabled: (value) => set({ speechEnabled: value }),
      setAutoSpeakReplies: (value) => set({ autoSpeakReplies: value }),
      setVoiceActivatedConversation: (value) => set({ voiceActivatedConversation: value }),
      setExpressUserDataPermission: (value) => set({ expressUserDataPermission: value }),
      setPermittedUserIdentity: (value) => set({ permittedUserIdentity: value.trim() }),
      setVoicePatternLearningConsent: (value) => set({ voicePatternLearningConsent: value }),
      setFaceClarificationConsent: (value) => set({ faceClarificationConsent: value }),
      setSecureCancelVerificationEnabled: (value) => set({ secureCancelVerificationEnabled: value }),
      setCancelVerificationMode: (value) => set({ cancelVerificationMode: value }),
      hydrateForUser: (userId) =>
        set({
          ...DEFAULT_BOB_ASSISTANT_SETTINGS,
          ...loadUserScopedBobAssistantState(userId),
        }),
    }),
    {
      name: BOB_ASSISTANT_STORAGE_NAME,
      storage: createJSONStorage(() => bobAssistantScopedStorage),
    },
  ),
)

let bobAssistantAuthScopeBridgeInitialized = false
let bobAssistantCloudSyncTimer: ReturnType<typeof setTimeout> | null = null
let bobAssistantStoreUnsubscribe: (() => void) | null = null
let bobAssistantCloudSyncSuppress = false

function initializeBobAssistantAuthScopeBridge() {
  if (bobAssistantAuthScopeBridgeInitialized || typeof window === 'undefined') {
    return
  }
  bobAssistantAuthScopeBridgeInitialized = true

  let previousUserId: string | null = useAuthStore.getState().user?.id ?? null
  const applyScopedState = async (userId: string | null) => {
    bobAssistantCloudSyncSuppress = true
    useBobAssistantStore.getState().hydrateForUser(userId)

    if (userId) {
      const cloud = await loadCloudAssistantSettings(userId)
      useBobAssistantStore.setState((state) => ({
        ...state,
        ...cloud,
      }))
    }
    bobAssistantCloudSyncSuppress = false

    if (bobAssistantStoreUnsubscribe) {
      bobAssistantStoreUnsubscribe()
      bobAssistantStoreUnsubscribe = null
    }

    if (!userId) {
      return
    }

    let previousSerialized = JSON.stringify(selectPersistableAssistantSettings(useBobAssistantStore.getState()))
    bobAssistantStoreUnsubscribe = useBobAssistantStore.subscribe((state) => {
      if (bobAssistantCloudSyncSuppress) return

      const snapshot = selectPersistableAssistantSettings(state)
      const serialized = JSON.stringify(snapshot)
      if (serialized === previousSerialized) return
      previousSerialized = serialized

      if (bobAssistantCloudSyncTimer) {
        clearTimeout(bobAssistantCloudSyncTimer)
      }

      bobAssistantCloudSyncTimer = setTimeout(() => {
        void saveCloudAssistantSettings(userId, snapshot)
      }, 600)
    })
  }

  void applyScopedState(previousUserId)

  useAuthStore.subscribe((state) => {
    const nextUserId = state.user?.id ?? null
    if (nextUserId === previousUserId) {
      return
    }
    previousUserId = nextUserId
    void applyScopedState(nextUserId)
  })
}

initializeBobAssistantAuthScopeBridge()
