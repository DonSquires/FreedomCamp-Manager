import { useEffect } from 'react'
import { useThemePreferencesStore } from '@/stores/themePreferencesStore'

function resolveTheme(mode: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  if (mode !== 'system') return mode
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useThemeMode() {
  const { themeMode } = useThemePreferencesStore()

  useEffect(() => {
    if (typeof document === 'undefined') return

    const applyTheme = () => {
      const resolved = resolveTheme(themeMode)
      document.documentElement.classList.toggle('dark', resolved === 'dark')
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
