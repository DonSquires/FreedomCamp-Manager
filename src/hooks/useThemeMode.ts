import { useEffect } from 'react'
import { useThemePreferencesStore } from '@/stores/themePreferencesStore'

function resolveTheme(mode: 'light' | 'dark' | 'high-contrast' | 'night-patrol' | 'system'): 'light' | 'dark' | 'high-contrast' | 'night-patrol' {
  if (mode === 'light' || mode === 'dark' || mode === 'high-contrast' || mode === 'night-patrol') return mode
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useThemeMode() {
  const { themeMode } = useThemePreferencesStore()

  useEffect(() => {
    if (typeof document === 'undefined') return

    const applyTheme = () => {
      const resolved = resolveTheme(themeMode)
      document.documentElement.classList.remove('dark', 'high-contrast', 'night-patrol')
      if (resolved === 'dark') {
        document.documentElement.classList.add('dark')
      } else if (resolved === 'high-contrast') {
        document.documentElement.classList.add('high-contrast')
      } else if (resolved === 'night-patrol') {
        // Night patrol overlays dark mode as a base
        document.documentElement.classList.add('dark', 'night-patrol')
      }
    }

    applyTheme()

    if (themeMode !== 'system' || typeof window === 'undefined') {
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme()

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    }

    media.addListener(onChange)
    return () => media.removeListener(onChange)
  }, [themeMode])
}
