import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export function usePTTTranslationPrefs() {
  const readInterpreterTargetLanguagePreference = useCallback(async (userId?: string | null): Promise<string | null> => {
    if (!userId) return null

    const { data, error } = await (supabase.from('user_profiles') as any)
      .select('notification_preferences')
      .eq('id', userId)
      .single()

    if (error) return null

    const prefs = (data?.notification_preferences as Record<string, any> | null) ?? {}
    const translation = (prefs.translation as Record<string, any> | undefined) ?? {}
    const dbTargetLanguage = typeof translation.target_language === 'string'
      ? translation.target_language.trim()
      : ''

    return dbTargetLanguage || null
  }, [])

  const saveInterpreterTargetLanguagePreference = useCallback(async (userId?: string | null, targetLanguage?: string) => {
    if (!userId) return

    const { data } = await (supabase.from('user_profiles') as any)
      .select('notification_preferences')
      .eq('id', userId)
      .single()

    const currentPrefs = (data?.notification_preferences as Record<string, any> | null) ?? {}
    const nextPrefs = {
      ...currentPrefs,
      translation: {
        ...(currentPrefs.translation || {}),
        target_language: targetLanguage,
        primary_language: 'en-NZ',
        region: 'NZ',
      },
    }

    await (supabase.from('user_profiles') as any)
      .update({ notification_preferences: nextPrefs } as never)
      .eq('id', userId)
  }, [])

  return {
    readInterpreterTargetLanguagePreference,
    saveInterpreterTargetLanguagePreference,
  }
}
