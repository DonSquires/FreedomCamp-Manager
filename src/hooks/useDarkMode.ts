import { useState, useEffect } from 'react'

import { THEME_STORAGE_KEY } from '@/lib/theme'

/**
 * useDarkMode — persists the user's dark/light theme preference in localStorage
 * (uses the same key as theme.ts so both APIs share a single entry) and syncs
 * with the `dark` class on `document.documentElement`.
 */
export function useDarkMode() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored !== null) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light')
  }, [isDark])

  const toggle = () => setIsDark(prev => !prev)
  const enable = () => setIsDark(true)
  const disable = () => setIsDark(false)

  return { isDark, toggle, enable, disable }
}
