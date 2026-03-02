import { useState, useEffect } from 'react'

const STORAGE_KEY = 'fcm-dark-mode'

/**
 * useDarkMode — persists the user's dark/light theme preference in localStorage
 * and syncs it with the `dark` class on `document.documentElement`.
 */
export function useDarkMode() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) return stored === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem(STORAGE_KEY, String(isDark))
  }, [isDark])

  const toggle = () => setIsDark(prev => !prev)
  const enable = () => setIsDark(true)
  const disable = () => setIsDark(false)

  return { isDark, toggle, enable, disable }
}
