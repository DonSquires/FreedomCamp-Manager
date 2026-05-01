import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'

type AskBobBrainParams = {
  prompt: string
  lat?: number | null
  lng?: number | null
  organizationId?: string | null
}

type AskBobBrainResponse = {
  answer: string
  jurisdiction?: string
  is_client_owned?: boolean
  provider?: string
  model?: string
}

export function useBobBrain() {
  const [isLoading, setIsLoading] = useState(false)
  const [response, setResponse] = useState<AskBobBrainResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completedAt, setCompletedAt] = useState<string | null>(null)

  const clearResponse = useCallback(() => {
    setResponse(null)
    setError(null)
    setCompletedAt(null)
  }, [])

  const askBobBrain = useCallback(async ({
    prompt,
    lat,
    lng,
    organizationId,
  }: AskBobBrainParams) => {
    const trimmedPrompt = String(prompt || '').trim()
    if (!trimmedPrompt) {
      setError('Prompt is required.')
      return null
    }

    setIsLoading(true)
    setError(null)

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('ask-bob', {
        body: {
          prompt: trimmedPrompt,
          lat: typeof lat === 'number' ? lat : undefined,
          lng: typeof lng === 'number' ? lng : undefined,
          organization_id: organizationId || undefined,
        },
      })

      if (invokeError || !data) {
        throw new Error(invokeError?.message || 'ask-bob request failed')
      }

      const payload = data as AskBobBrainResponse
      const answer = String(payload.answer || '').trim()
      if (!answer) {
        throw new Error('ask-bob returned an empty answer')
      }

      const normalized: AskBobBrainResponse = {
        answer,
        jurisdiction: payload.jurisdiction,
        is_client_owned: payload.is_client_owned,
        provider: payload.provider,
        model: payload.model,
      }

      setResponse(normalized)
      setCompletedAt(new Date().toISOString())
      return normalized
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    askBobBrain,
    clearResponse,
    isLoading,
    error,
    response,
    completedAt,
  }
}