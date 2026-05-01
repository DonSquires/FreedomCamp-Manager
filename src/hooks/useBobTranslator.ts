import { useEffect, useMemo, useRef, useState } from 'react'
import { radioManager } from '@/lib/radioSingleton'

type UseBobTranslatorOptions = {
  workspaceId?: string | null
  enabled?: boolean
  targetLanguage?: string
}

type TranslatorStreamMessage = {
  original?: string
  translated?: string
  context?: string
  target_language?: string
  [key: string]: unknown
}

function normalizeWsUrl(raw: string): string {
  const value = String(raw || '').trim()
  if (!value) return ''
  return value.replace(/\/$/, '')
}

function parseConnectionState(readyState: number): 'idle' | 'connecting' | 'open' | 'closing' | 'closed' {
  if (readyState === WebSocket.CONNECTING) return 'connecting'
  if (readyState === WebSocket.OPEN) return 'open'
  if (readyState === WebSocket.CLOSING) return 'closing'
  if (readyState === WebSocket.CLOSED) return 'closed'
  return 'idle'
}

export function useBobTranslator({
  workspaceId,
  enabled = false,
  targetLanguage = 'hi-IN',
}: UseBobTranslatorOptions) {
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'open' | 'closing' | 'closed'>('idle')
  const [lastMessage, setLastMessage] = useState<TranslatorStreamMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const subscriptionCleanupRef = useRef<(() => void) | null>(null)

  const translatorBaseUrl = useMemo(() => {
    const envUrl = normalizeWsUrl(import.meta.env.VITE_BOB_TRANSLATOR_WS_URL || '')
    return envUrl || 'wss://your-runpod-pod.runpod.net/ws/translate'
  }, [])

  const translatorUrl = useMemo(() => {
    if (!workspaceId) return ''

    const delimiter = translatorBaseUrl.includes('?') ? '&' : '?'
    return `${translatorBaseUrl}${delimiter}workspace_id=${encodeURIComponent(workspaceId)}&target_lang=${encodeURIComponent(targetLanguage)}`
  }, [targetLanguage, translatorBaseUrl, workspaceId])

  useEffect(() => {
    if (!enabled || !translatorUrl) {
      subscriptionCleanupRef.current?.()
      subscriptionCleanupRef.current = null
      radioManager.disconnect()
      setConnectionState('idle')
      return
    }

    setConnectionState(parseConnectionState(WebSocket.CONNECTING))
    setError(null)

    subscriptionCleanupRef.current?.()
    subscriptionCleanupRef.current = radioManager.subscribe((payload) => {
      if (payload && typeof payload === 'object') {
        setLastMessage(payload as TranslatorStreamMessage)
      }
    })

    radioManager.connect(translatorUrl, {
      onOpen: () => setConnectionState('open'),
      onClose: () => setConnectionState('closed'),
      onError: () => {
        setConnectionState('closed')
        setError('Translator socket error')
      },
    })

    return () => {
      subscriptionCleanupRef.current?.()
      subscriptionCleanupRef.current = null
      radioManager.disconnect()
      setConnectionState('closed')
    }
  }, [enabled, translatorUrl])

  return {
    connectionState,
    error,
    lastMessage,
    sendAudioChunk: (audioChunkBase64: string, mimeType = 'audio/webm') => {
      radioManager.send({
        action: 'translate_audio_chunk',
        workspace_id: workspaceId,
        target_language: targetLanguage,
        mime_type: mimeType,
        audio_base64: audioChunkBase64,
      })
    },
  }
}
