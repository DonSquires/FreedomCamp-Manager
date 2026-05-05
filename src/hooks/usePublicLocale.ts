/**
 * usePublicLocale — B-11 Multi-language public portal hook
 *
 * Returns:
 *   t      — current translations
 *   locale — current locale code
 *   setLocale — switch locale (persists to localStorage)
 */

import { useState, useCallback } from 'react'
import { LOCALES, detectLocale } from '@/lib/publicLocale'
import type { Locale, PublicTranslations } from '@/lib/publicLocale'

interface UsePublicLocaleReturn {
  t: PublicTranslations
  locale: Locale
  setLocale: (l: Locale) => void
}

export function usePublicLocale(): UsePublicLocaleReturn {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  const setLocale = useCallback((l: Locale) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('public-locale', l)
    setLocaleState(l)
  }, [])

  return { t: LOCALES[locale], locale, setLocale }
}
