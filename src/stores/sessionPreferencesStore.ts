import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface SessionPreferencesState {
  autoLogoffEnabled: boolean
  inactivityMinutes: number
  setAutoLogoffEnabled: (enabled: boolean) => void
  setInactivityMinutes: (minutes: number) => void
}

type PersistedSessionPreferences = {
  autoLogoffEnabled?: boolean
  inactivityMinutes?: number
}

const MIN_MINUTES = 15
const MAX_MINUTES = 120
const DEFAULT_INACTIVITY_MINUTES = 15

function clampInactivityMinutes(minutes: unknown): number {
  const parsed = Number(minutes)
  if (!Number.isFinite(parsed)) return DEFAULT_INACTIVITY_MINUTES
  return Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.floor(parsed)))
}

export const useSessionPreferencesStore = create<SessionPreferencesState>()(
  persist(
    (set) => ({
      autoLogoffEnabled: true,
      inactivityMinutes: DEFAULT_INACTIVITY_MINUTES,
      setAutoLogoffEnabled: (enabled) => set({ autoLogoffEnabled: enabled }),
      setInactivityMinutes: (minutes) => {
        const bounded = clampInactivityMinutes(minutes)
        set({ inactivityMinutes: bounded })
      },
    }),
    {
      name: 'session-preferences-storage',
      version: 1,
      merge: (persistedState, currentState) => {
        const state = (persistedState || {}) as PersistedSessionPreferences
        return {
          ...currentState,
          autoLogoffEnabled: typeof state.autoLogoffEnabled === 'boolean' ? state.autoLogoffEnabled : currentState.autoLogoffEnabled,
          inactivityMinutes: clampInactivityMinutes(state.inactivityMinutes),
        }
      },
      migrate: (persistedState) => {
        const state = (persistedState || {}) as PersistedSessionPreferences
        return {
          autoLogoffEnabled: typeof state.autoLogoffEnabled === 'boolean' ? state.autoLogoffEnabled : true,
          inactivityMinutes: clampInactivityMinutes(state.inactivityMinutes),
        }
      },
      storage: createJSONStorage(() => localStorage),
    }
  )
)
