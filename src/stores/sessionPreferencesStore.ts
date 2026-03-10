import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface SessionPreferencesState {
  autoLogoffEnabled: boolean
  inactivityMinutes: number
  setAutoLogoffEnabled: (enabled: boolean) => void
  setInactivityMinutes: (minutes: number) => void
}

const MIN_MINUTES = 5
const MAX_MINUTES = 120

export const useSessionPreferencesStore = create<SessionPreferencesState>()(
  persist(
    (set) => ({
      autoLogoffEnabled: true,
      inactivityMinutes: 10,
      setAutoLogoffEnabled: (enabled) => set({ autoLogoffEnabled: enabled }),
      setInactivityMinutes: (minutes) => {
        const bounded = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.floor(minutes || MIN_MINUTES)))
        set({ inactivityMinutes: bounded })
      },
    }),
    {
      name: 'session-preferences-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
