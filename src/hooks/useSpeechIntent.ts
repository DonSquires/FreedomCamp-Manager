/**
 * useSpeechIntent
 *
 * Wake-word adapter abstraction for the self-hosted speech stack.
 *
 * Architecture:
 *   - Browser adapter: MediaRecorder → base64 → Supabase speech-to-intent edge shim
 *   - Mobile adapter: provided externally (React Native Expo audio APIs)
 *   - Manual fallback: always available regardless of wake-word support
 *
 * Usage:
 *   const { state, startListening, stopListening, result, error } = useSpeechIntent({ orgId })
 */

import { useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpeechIntentState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'done'
  | 'error'
  | 'unsupported'

export interface SpeechIntentResult {
  transcript: string
  intent: {
    intent: string
    confidence: number
    needs_confirmation: boolean
    summary: string
    entities: Record<string, unknown>
  }
  provider: { stt: string; intent: string }
}

export interface UseSpeechIntentOptions {
  orgId?: string | null
  language?: string
  context?: Record<string, unknown>
  /** Max recording duration in ms before auto-stop. Default: 10000 */
  maxDurationMs?: number
  /** Audio MIME type for MediaRecorder. Default: browser-determined */
  mimeType?: string
  /** Called when a final result is received */
  onResult?: (result: SpeechIntentResult) => void
  /** Called on any error */
  onError?: (error: string) => void
}

export interface UseSpeechIntentReturn {
  state: SpeechIntentState
  isSupported: boolean
  startListening: () => Promise<void>
  stopListening: () => void
  result: SpeechIntentResult | null
  error: string | null
  reset: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      resolve(dataUrl.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function detectSupportedMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  if (typeof MediaRecorder === 'undefined') return ''
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSpeechIntent(options: UseSpeechIntentOptions = {}): UseSpeechIntentReturn {
  const {
    orgId = null,
    language = 'en',
    context,
    maxDurationMs = 10000,
    mimeType,
    onResult,
    onError,
  } = options

  const [state, setState] = useState<SpeechIntentState>(
    typeof MediaRecorder === 'undefined' ? 'unsupported' : 'idle',
  )
  const [result, setResult] = useState<SpeechIntentResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSupported = typeof MediaRecorder !== 'undefined'

  const reset = useCallback(() => {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    chunksRef.current = []
    if (autoStopRef.current) clearTimeout(autoStopRef.current)
    setState('idle')
    setResult(null)
    setError(null)
  }, [])

  const _handleError = useCallback(
    (msg: string) => {
      setState('error')
      setError(msg)
      onError?.(msg)
    },
    [onError],
  )

  const _processAudio = useCallback(
    async (audioBlob: Blob) => {
      setState('processing')
      try {
        const audio_base64 = await blobToBase64(audioBlob)

        const { data, error: fnError } = await supabase.functions.invoke('speech-to-intent', {
          body: {
            audio_base64,
            language,
            org_id: orgId,
            context: context ?? {},
          },
          headers: orgId ? { 'x-org-id': orgId } : undefined,
        })

        if (fnError) throw new Error(fnError.message)
        if (!data) throw new Error('Empty response from speech-to-intent')

        const parsed = data as SpeechIntentResult
        setResult(parsed)
        setState('done')
        onResult?.(parsed)
      } catch (err: unknown) {
        _handleError(err instanceof Error ? err.message : 'Speech processing failed')
      }
    },
    [context, language, orgId, onResult, _handleError],
  )

  const stopListening = useCallback(() => {
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current)
      autoStopRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const startListening = useCallback(async () => {
    if (!isSupported) {
      _handleError('Audio capture is not supported in this browser')
      return
    }
    if (state === 'listening' || state === 'processing') return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const resolvedMimeType = mimeType || detectSupportedMimeType()
      const recorder = new MediaRecorder(
        stream,
        resolvedMimeType ? { mimeType: resolvedMimeType } : undefined,
      )
      chunksRef.current = []
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, {
          type: resolvedMimeType || 'audio/webm',
        })
        chunksRef.current = []
        await _processAudio(blob)
      }

      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop())
        _handleError('MediaRecorder error')
      }

      recorder.start(250) // collect chunks every 250 ms
      setState('listening')

      // Auto-stop after maxDurationMs
      autoStopRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, maxDurationMs)
    } catch (err: unknown) {
      _handleError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : 'Could not start audio capture',
      )
    }
  }, [isSupported, state, mimeType, maxDurationMs, _processAudio, _handleError])

  return {
    state,
    isSupported,
    startListening,
    stopListening,
    result,
    error,
    reset,
  }
}
