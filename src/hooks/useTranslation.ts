/**
 * useTranslation — B-28 Real-time Translation
 *
 * Wraps the translate-text edge function for use inside React components.
 * Maintains a per-component translation cache keyed by (text, target_lang)
 * to avoid redundant API calls when the same snippet is requested twice.
 */

import { useState, useCallback, useRef } from 'react'
import { edgeFunctions } from '@/lib/edgeFunctions'

export type SupportedLang = 'en' | 'mi' | 'zh-Hans' | 'hi' | 'ko' | 'fr' | 'de' | 'es' | 'ja'

export const TRANSLATION_LANG_LABELS: Record<SupportedLang, string> = {
  en:       'English',
  mi:       'Māori',
  'zh-Hans': '中文',
  hi:       'हिन्दी',
  ko:       '한국어',
  fr:       'Français',
  de:       'Deutsch',
  es:       'Español',
  ja:       '日本語',
}

interface TranslationResult {
  translated_text: string
  detected_language?: string
  provider: string
}

interface UseTranslationState {
  isLoading: boolean
  error: string | null
  result: TranslationResult | null
}

interface UseTranslationReturn extends UseTranslationState {
  translate: (text: string, targetLang: SupportedLang) => Promise<void>
  clearResult: () => void
}

/**
 * @example
 * const { translate, result, isLoading } = useTranslation()
 * await translate('Vehicle was parked in breach of rules', 'mi')
 * // result.translated_text → Māori translation (or mock prefix in dev)
 */
export function useTranslation(): UseTranslationReturn {
  const [state, setState] = useState<UseTranslationState>({
    isLoading: false,
    error: null,
    result: null,
  })

  // Simple in-memory cache: key = `${text}:::${targetLang}`
  const cache = useRef<Map<string, TranslationResult>>(new Map())

  const translate = useCallback(async (text: string, targetLang: SupportedLang) => {
    if (!text.trim()) return

    const cacheKey = `${text}:::${targetLang}`
    const cached = cache.current.get(cacheKey)
    if (cached) {
      setState({ isLoading: false, error: null, result: cached })
      return
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const response = await edgeFunctions.translateText({
        text,
        target_lang: targetLang,
      })

      if (response.error) {
        throw new Error(response.error as string)
      }

      const result = response.data as TranslationResult
      cache.current.set(cacheKey, result)
      setState({ isLoading: false, error: null, result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Translation failed'
      setState({ isLoading: false, error: message, result: null })
    }
  }, [])

  const clearResult = useCallback(() => {
    setState({ isLoading: false, error: null, result: null })
  }, [])

  return { ...state, translate, clearResult }
}
