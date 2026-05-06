/**
 * useOfficerLocale — B-19 Multi-language Officer UI hook
 *
 * Priority order for locale resolution:
 *   1. User's `preferred_language` from their profile (Supabase)
 *   2. localStorage key `officer-locale` (manual override)
 *   3. Browser navigator.language
 *
 * Exposes `setLocale` to allow in-app override that also persists to
 * localStorage (and optionally updates the profile row).
 */

import { useState, useCallback, useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import {
  OFFICER_LOCALES,
  detectOfficerLocale,
  type OfficerLocale,
  type OfficerTranslations,
} from '@/lib/officerLocale'

interface UseOfficerLocaleReturn {
  t: OfficerTranslations
  locale: OfficerLocale
  setLocale: (l: OfficerLocale) => void
}

export function useOfficerLocale(): UseOfficerLocaleReturn {
  const user = useAuthStore(s => s.user)

  // Initialize from profile preferred_language if available; otherwise auto-detect
  const [locale, setLocaleState] = useState<OfficerLocale>(() =>
    detectOfficerLocale((user as any)?.preferred_language ?? null)
  )

  const preferredLanguage = (user as any)?.preferred_language as string | undefined

  // When user profile loads/changes, sync locale
  useEffect(() => {
    if (preferredLanguage) {
      setLocaleState(detectOfficerLocale(preferredLanguage))
    }
  }, [preferredLanguage])

  const setLocale = useCallback((l: OfficerLocale) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('officer-locale', l)
    setLocaleState(l)
    // Persist back to user profile if authenticated
    if (user?.id) {
      const langMap: Record<OfficerLocale, string> = {
        en: 'en-NZ',
        mi: 'mi-NZ',
        zh: 'zh-Hans-NZ',
        hi: 'hi-IN',
      }
      ;(supabase.from('user_profiles') as any)
        .update({ preferred_language: langMap[l] })
        .eq('id', user.id)
        .then(() => {}) // fire-and-forget
    }
  }, [user?.id])

  return { t: OFFICER_LOCALES[locale], locale, setLocale }
}
