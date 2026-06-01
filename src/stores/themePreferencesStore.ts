import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark' | 'high-contrast' | 'night-patrol' | 'system'

/**
 * The localStorage key used to persist theme preferences.
 * This constant is intentionally duplicated as a plain string in the inline FOUC-prevention
 * script in index.html (which runs before any module loading).  If you rename this key,
 * update index.html accordingly.
 */
export const THEME_STORAGE_KEY = 'theme-preferences-storage'

interface ThemePreferencesState {
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
}

export const useThemePreferencesStore = create<ThemePreferencesState>()(
  persist(
    (set) => ({
      themeMode: 'dark',
      setThemeMode: (mode) => set({ themeMode: mode }),
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
