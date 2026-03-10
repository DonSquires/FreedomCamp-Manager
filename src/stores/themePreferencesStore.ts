import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemePreferencesState {
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
}

export const useThemePreferencesStore = create<ThemePreferencesState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      setThemeMode: (mode) => set({ themeMode: mode }),
    }),
    {
      name: 'theme-preferences-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
