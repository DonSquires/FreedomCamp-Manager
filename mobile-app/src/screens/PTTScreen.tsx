/**
 * PTTScreen – Push-to-Talk radio for FieldOps Manager mobile officers.
 *
 * Connects to the PTT signaling server via WebSocket.
 * Provides:
 *  - Channel join / leave
 *  - Presence roster (who's online)
 *  - Real audio recording with expo-av (Audio.Recording)
 *  - Clip upload to Supabase Storage → signed URL sent in stop_speaking
 *  - Playback of incoming clips from other speakers
 *  - Emergency broadcast display
 *  - Keep-alive reconnect loop for foreground recovery
 *  - Background-friendly audio mode for receive continuity
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Audio } from 'expo-av'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { supabase } from '../lib/supabase'
import { edgeFunctions } from '../lib/edgeFunctions'
import { uploadPTTClip, writeSynthesizedSpeechToCache, deleteTTSCacheFile } from '../lib/pttAudio'
import {
  emitPTTAiTelemetry,
  normalizePTTTranscriptionPayload,
  normalizePTTTranslationPayload,
  type PTTTranslationContract,
} from '../lib/pttAiContract'
import { useAuthStore } from '../stores/authStore'
import { highVis } from '../lib/highVisTheme'

const MIN_TOKEN_REFRESH_DELAY_MS = 15_000
const MAX_TOKEN_MINT_RETRIES = 3
const TOKEN_MINT_RETRY_DELAY_MS = 2000
const MAX_WS_RECONNECT_ATTEMPTS = 8
const PTT_TRANSLATION_PREF_KEY = 'ptt.translation.language.v1'
const INCOMING_CLIP_NORMAL_VOLUME = 1
const INCOMING_CLIP_DUCK_VOLUME = 0.05

const TRANSLATION_OPTIONS = [
  { value: 'mi', label: 'Māori' },
  { value: 'zh-Hans', label: 'Chinese' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ko', label: 'Korean' },
  { value: 'en', label: 'English' },
] as const

type TranslationOptionValue = typeof TRANSLATION_OPTIONS[number]['value']

type MobileTranslationResult = PTTTranslationContract

type DomainLane = 'freedom_camping' | 'biosecurity' | 'noise_control' | 'smoke_control' | 'parking_enforcement'

type DomainAssistResult = {
  lane: DomainLane
  label: string
  answer: string
  provider: string | null
  model: string | null
  updatedAt: string
}

const DOMAIN_LANES: Array<{ value: DomainLane; label: string; promptLabel: string }> = [
  { value: 'freedom_camping', label: 'Freedom Camping', promptLabel: 'Freedom camping' },
  { value: 'biosecurity', label: 'Biosecurity', promptLabel: 'Biosecurity' },
  { value: 'noise_control', label: 'Noise Control', promptLabel: 'Noise control' },
  { value: 'smoke_control', label: 'Smoke Control', promptLabel: 'Smoke control' },
  { value: 'parking_enforcement', label: 'Parking', promptLabel: 'Parking enforcement' },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PresenceRecord {
  userId: string
  name: string
  role: string
  status: 'online' | 'talking'
  lastSeen: string
}

interface SyncMessage {
  type: 'sync'
  channelId: string
  presence: PresenceRecord[]
  speakerId: string | null
  emergencyBroadcast?: {
    active: boolean
    initiatedBy?: string
    initiatedAt?: string
    message?: string
  } | null
}

interface PresenceMessage {
  type: 'presence'
  event: 'join' | 'leave'
  userId: string
  name: string
  role: string
  timestamp: string
}

interface SpeakerMessage {
  type: 'speaker_update'
  channelId: string
  speakerId: string | null
}

interface SpeakingMessage {
  type: 'speaking'
  event: 'start' | 'stop'
  userId: string
  name: string
  clipUrl?: string | null
  duration?: number | null
  timestamp: string
}

interface ErrorMessage {
  type: 'error'
  code: string
  message: string
  speakerId?: string
}

interface EmergencyMessage {
  type: 'emergency_update'
  organizationId: string
  emergency: SyncMessage['emergencyBroadcast']
}

interface PTTTokenResponse {
  token: string
  channelScope: string
  expiresIn: number
  wsUrl: string
}

type ServerMessage = SyncMessage | PresenceMessage | SpeakerMessage | SpeakingMessage | EmergencyMessage | ErrorMessage

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function parseRetryAfterSeconds(raw: string): number | null {
  const match = raw.match(/retryAfter["']?\s*[:=]\s*(\d+)/i) || raw.match(/retry in\s+(\d+)\s*s/i)
  if (!match?.[1]) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function roleColor(role: string): string {
  if (role === 'admin' || role === 'master') return highVis.colors.actionBlue
  if (role === 'admin_officer') return highVis.colors.warningAmber
  return highVis.colors.compliantGreen
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PTTScreen() {
  const { user } = useAuthStore()

  // WS state
  const wsRef = useRef<WebSocket | null>(null)
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')
  const [wsError, setWsError] = useState<string | null>(null)

  // Channel state
  const orgId = user?.organization_id ?? 'default'
  const [channelId] = useState<string>(`org:${orgId}`)

  // Radio state
  const [presence, setPresence] = useState<PresenceRecord[]>([])
  const [speakerId, setSpeakerId] = useState<string | null>(null)
  const [emergency, setEmergency] = useState<SyncMessage['emergencyBroadcast']>(null)

  // Audio state
  const recordingRef = useRef<Audio.Recording | null>(null)
  const recordingStartRef = useRef<number>(0)
  const [transmitting, setTransmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const soundRef = useRef<Audio.Sound | null>(null)
  const ttsRef = useRef<Audio.Sound | null>(null)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tokenRefreshTargetAtRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const connectionStartedAtRef = useRef<number | null>(null)
  const [degradedMode, setDegradedMode] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const [lastCloseCode, setLastCloseCode] = useState<number | null>(null)
  const [lastCloseReason, setLastCloseReason] = useState<string | null>(null)
  const [tokenRefreshInSeconds, setTokenRefreshInSeconds] = useState<number | null>(null)
  const [lastClipTranscript, setLastClipTranscript] = useState<string | null>(null)
  const [transcriptUpdatedAt, setTranscriptUpdatedAt] = useState<string | null>(null)
  const [lastTranscriptLabel, setLastTranscriptLabel] = useState<string>('Latest local transmission')
  const [selectedTranslationLanguage, setSelectedTranslationLanguage] = useState<TranslationOptionValue>('mi')
  const [translationResult, setTranslationResult] = useState<MobileTranslationResult | null>(null)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [selectedDomainLane, setSelectedDomainLane] = useState<DomainLane>('freedom_camping')
  const [isRunningDomainAssist, setIsRunningDomainAssist] = useState(false)
  const [domainAssistResult, setDomainAssistResult] = useState<DomainAssistResult | null>(null)
  const [domainAssistError, setDomainAssistError] = useState<string | null>(null)
  const [isTranscribingIncoming, setIsTranscribingIncoming] = useState(false)
  const transcribedClipUrlsRef = useRef<Set<string>>(new Set())

  // ------------------------------------------------------------------
  // Play incoming clip
  // ------------------------------------------------------------------
  const playClip = useCallback(async (url: string) => {
    try {
      // Unload any previous sound
      if (soundRef.current) {
        await soundRef.current.unloadAsync()
        soundRef.current = null
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: true })
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true })
      soundRef.current = sound
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync()
          soundRef.current = null
        }
      })
    } catch {
      // Non-critical – clip may have expired
    }
  }, [])

  const playTTSOverlay = useCallback(async (localUri: string) => {
    const incomingSound = soundRef.current
    let didDuckIncoming = false

    // If an older TTS clip is still active, stop it and ensure incoming audio is restored first.
    if (ttsRef.current) {
      await ttsRef.current.unloadAsync().catch(() => {})
      ttsRef.current = null
      if (soundRef.current) {
        await soundRef.current.setVolumeAsync(INCOMING_CLIP_NORMAL_VOLUME).catch(() => {})
      }
    }

    if (incomingSound) {
      await incomingSound.setVolumeAsync(INCOMING_CLIP_DUCK_VOLUME).catch(() => {})
      didDuckIncoming = true
    }

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: true })
      const { sound } = await Audio.Sound.createAsync({ uri: localUri }, { shouldPlay: true })
      ttsRef.current = sound
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {})
          ttsRef.current = null
          if (didDuckIncoming && soundRef.current === incomingSound && incomingSound) {
            void incomingSound.setVolumeAsync(INCOMING_CLIP_NORMAL_VOLUME).catch(() => {})
          }
          void deleteTTSCacheFile(localUri)
        }
      })
    } catch (err) {
      if (didDuckIncoming && soundRef.current === incomingSound && incomingSound) {
        await incomingSound.setVolumeAsync(INCOMING_CLIP_NORMAL_VOLUME).catch(() => {})
      }
      throw err
    }
  }, [])

  const translateTranscriptText = useCallback(async (
    transcript: string,
    targetLanguage: TranslationOptionValue,
  ): Promise<MobileTranslationResult> => {
    const startedAt = Date.now()
    const { data, error } = await edgeFunctions.translateText({
      text: transcript,
      target_lang: targetLanguage,
    })

    const latencyMs = Date.now() - startedAt
    if (error) {
      emitPTTAiTelemetry({
        surface: 'mobile',
        stage: 'translate',
        success: false,
        latency_ms: latencyMs,
        reason: error,
      })
      throw new Error(error)
    }

    const normalized = normalizePTTTranslationPayload(data, {
      targetLanguage,
      latencyMs,
    })

    emitPTTAiTelemetry({
      surface: 'mobile',
      stage: 'translate',
      success: normalized.translated_text.length > 0,
      latency_ms: normalized.latency_ms,
      details: {
        target_language: normalized.target_language,
        fallback: normalized.fallback,
      },
    })

    if (normalized.translated_text) return normalized
    return {
      ...normalized,
      translated_text: transcript,
    }
  }, [])

  const presentTranscript = useCallback(async (params: {
    transcript: string
    label: string
    autoTranslate?: boolean
    speakVoice?: string
  }) => {
    const transcript = String(params.transcript || '').trim()
    if (!transcript || !mountedRef.current) return

    setLastClipTranscript(transcript)
    setTranscriptUpdatedAt(new Date().toISOString())
    setLastTranscriptLabel(params.label)
    setTranslationError(null)
    setDomainAssistError(null)
    setDomainAssistResult(null)

    if (!params.autoTranslate || selectedTranslationLanguage === 'en') {
      setTranslationResult(null)
      return
    }

    setIsTranslating(true)
    try {
      const result = await translateTranscriptText(transcript, selectedTranslationLanguage)
      if (!mountedRef.current) return
      setTranslationResult(result)

      // Speak the translated text aloud via the synthesize-speech edge function.
      const translatedText = result?.translated_text?.trim()
      if (translatedText) {
        void (async () => {
          try {
            const synthStartedAt = Date.now()
            const blob = await edgeFunctions.synthesizeSpeech({
              text: translatedText,
              voice: params.speakVoice,
            })
            emitPTTAiTelemetry({
              surface: 'mobile',
              stage: 'synthesize',
              success: !!blob,
              latency_ms: Date.now() - synthStartedAt,
              details: {
                voice: params.speakVoice || null,
              },
            })
            if (!blob || !mountedRef.current) return
            const localUri = await writeSynthesizedSpeechToCache(blob)
            if (!localUri || !mountedRef.current) return
            await playTTSOverlay(localUri)
          } catch {
            // TTS playback is best-effort; do not surface errors to the officer
          }
        })()
      }
    } catch (err: any) {
      if (!mountedRef.current) return
      setTranslationResult(null)
      setTranslationError(err?.message ?? 'Translation failed')
    } finally {
      if (mountedRef.current) {
        setIsTranslating(false)
      }
    }
  }, [playTTSOverlay, selectedTranslationLanguage, translateTranscriptText])

  // ------------------------------------------------------------------
  // Message handler
  // ------------------------------------------------------------------
  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'sync') {
      setPresence(msg.presence ?? [])
      setSpeakerId(msg.speakerId)
      setEmergency(msg.emergencyBroadcast ?? null)
      return
    }

    if (msg.type === 'presence') {
      setPresence((prev) => {
        if (msg.event === 'join') {
          const existing = prev.find((p) => p.userId === msg.userId)
          if (existing) return prev
          return [...prev, { userId: msg.userId, name: msg.name, role: msg.role, status: 'online', lastSeen: msg.timestamp }]
        }
        // leave
        return prev.filter((p) => p.userId !== msg.userId)
      })
      return
    }

    if (msg.type === 'speaking') {
      if (msg.event === 'start') {
        setSpeakerId(msg.userId)
        setPresence((prev) => prev.map((p) =>
          p.userId === msg.userId ? { ...p, status: 'talking' as const } : p
        ))
      } else {
        // stop
        setSpeakerId((prev) => prev === msg.userId ? null : prev)
        setPresence((prev) => prev.map((p) =>
          p.userId === msg.userId ? { ...p, status: 'online' as const } : p
        ))
        // Play incoming clip if from another user
        if (msg.clipUrl && msg.userId !== user?.id) {
          playClip(msg.clipUrl)
          if (!transcribedClipUrlsRef.current.has(msg.clipUrl)) {
            transcribedClipUrlsRef.current.add(msg.clipUrl)
            setIsTranscribingIncoming(true)
            const transcribeStartedAt = Date.now()
            void edgeFunctions.transcribeAudio({ clip_url: msg.clipUrl, language: 'en' })
              .then(({ data, error }) => {
                if (error) throw new Error(error)
                const normalized = normalizePTTTranscriptionPayload(data, Date.now() - transcribeStartedAt)
                emitPTTAiTelemetry({
                  surface: 'mobile',
                  stage: 'transcribe',
                  success: normalized.transcript.length > 0,
                  latency_ms: normalized.latency_ms,
                  details: {
                    provider: normalized.provider,
                  },
                })
                const transcript = normalized.transcript.trim()
                if (!transcript) return
                return presentTranscript({
                  transcript,
                  label: `Incoming from ${msg.name || 'another unit'}`,
                  autoTranslate: true,
                  speakVoice: 'en_nz',
                })
              })
              .catch((err: any) => {
                emitPTTAiTelemetry({
                  surface: 'mobile',
                  stage: 'transcribe',
                  success: false,
                  latency_ms: Date.now() - transcribeStartedAt,
                  reason: err?.message || 'unknown-error',
                })
                // best effort only
              })
              .finally(() => {
                if (mountedRef.current) setIsTranscribingIncoming(false)
              })
          }
        }
      }
      return
    }

    if (msg.type === 'speaker_update') {
      setSpeakerId(msg.speakerId)
      return
    }

    if (msg.type === 'emergency_update') {
      setEmergency(msg.emergency ?? null)
      return
    }

    if (msg.type === 'error') {
      if (msg.code === 'CHANNEL_BUSY') {
        setAudioError('Channel busy: another officer is currently transmitting.')
        setTransmitting(false)
        if (recordingRef.current) {
          recordingRef.current.stopAndUnloadAsync().catch(() => {})
          recordingRef.current = null
        }
      } else {
        setAudioError(msg.message || 'Radio error')
      }
    }
  }, [playClip, presentTranscript, user?.id])

  const clearTokenRefreshTimer = useCallback(() => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current)
      tokenRefreshTimerRef.current = null
    }
    tokenRefreshTargetAtRef.current = null
    setTokenRefreshInSeconds(null)
  }, [])

  const scheduleTokenRefresh = useCallback((expiresInSeconds?: number) => {
    clearTokenRefreshTimer()

    const ttl = Number.isFinite(expiresInSeconds) && (expiresInSeconds || 0) > 0
      ? Number(expiresInSeconds)
      : 300
    const delayMs = Math.max(MIN_TOKEN_REFRESH_DELAY_MS, Math.floor(ttl * 1000 * 0.5))
    tokenRefreshTargetAtRef.current = Date.now() + delayMs
    setTokenRefreshInSeconds(Math.ceil(delayMs / 1000))

    tokenRefreshTimerRef.current = setTimeout(() => {
      tokenRefreshTimerRef.current = null
      tokenRefreshTargetAtRef.current = null
      setTokenRefreshInSeconds(null)
      if (!mountedRef.current) return
      if (appStateRef.current !== 'active') return
      connect().catch(() => {})
    }, delayMs)
  }, [clearTokenRefreshTimer])

  const persistTransmissionLog = useCallback(async (clipUrl: string | null, durationSeconds: number) => {
    if (!user?.id || !orgId) return

    const basePayload: Record<string, any> = {
      organization_id: orgId,
      channel_number: 0,
      channel_name: channelId,
      speaker_id: user.id,
      speaker_name: user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
      speaker_callsign: user.first_name || user.email,
      duration_seconds: durationSeconds,
      is_emergency: !!emergency?.active,
      transcript: null,
    }

    let insertedId: string | null = null
    let insertResult = await (supabase as any)
      .from('ptt_transmission_log')
      .insert({
        ...basePayload,
        clip_url: clipUrl,
      })
      .select('id')
      .single()

    if (insertResult.error && (String(insertResult.error?.message || '').includes('clip_url') || insertResult.error?.code === '42703')) {
      insertResult = await (supabase as any)
        .from('ptt_transmission_log')
        .insert(basePayload)
        .select('id')
        .single()
    }

    if (insertResult.error) {
      return
    }

    insertedId = insertResult.data?.id || null
    if (!clipUrl) return

    try {
      const transcribeStartedAt = Date.now()
      const { data, error } = await edgeFunctions.transcribeAudio({ clip_url: clipUrl, language: 'en' })
      if (error) {
        emitPTTAiTelemetry({
          surface: 'mobile',
          stage: 'transcribe',
          success: false,
          latency_ms: Date.now() - transcribeStartedAt,
          reason: error,
        })
        return
      }

      const normalized = normalizePTTTranscriptionPayload(data, Date.now() - transcribeStartedAt)
      emitPTTAiTelemetry({
        surface: 'mobile',
        stage: 'transcribe',
        success: normalized.transcript.length > 0,
        latency_ms: normalized.latency_ms,
        details: {
          provider: normalized.provider,
        },
      })

      const transcript = normalized.transcript.trim()
      if (!transcript || !insertedId) return

      void presentTranscript({
        transcript,
        label: 'Latest local transmission',
        autoTranslate: true,
      })

      await (supabase as any)
        .from('ptt_transmission_log')
        .update({ transcript })
        .eq('id', insertedId)
    } catch {
      // best effort only
    }
  }, [channelId, emergency?.active, orgId, presentTranscript, user])

  const translateTranscript = useCallback(async () => {
    const transcript = String(lastClipTranscript || '').trim()
    if (!transcript) return

    setIsTranslating(true)
    setTranslationError(null)

    try {
      const data = await translateTranscriptText(transcript, selectedTranslationLanguage)

      if (mountedRef.current) {
        setTranslationResult(data)
      }

      // Speak the translated text aloud (same as auto-translate path)
      const translatedText = data?.translated_text?.trim()
      if (translatedText && mountedRef.current) {
        void (async () => {
          try {
            const synthStartedAt = Date.now()
            const blob = await edgeFunctions.synthesizeSpeech({ text: translatedText })
            emitPTTAiTelemetry({
              surface: 'mobile',
              stage: 'synthesize',
              success: !!blob,
              latency_ms: Date.now() - synthStartedAt,
            })
            if (!blob || !mountedRef.current) return
            const localUri = await writeSynthesizedSpeechToCache(blob)
            if (!localUri || !mountedRef.current) return
            await playTTSOverlay(localUri)
          } catch {
            // TTS is best-effort
          }
        })()
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setTranslationResult(null)
        setTranslationError(err?.message ?? 'Translation failed')
      }
    } finally {
      if (mountedRef.current) {
        setIsTranslating(false)
      }
    }
  }, [lastClipTranscript, playTTSOverlay, selectedTranslationLanguage, translateTranscriptText])

  const runDomainAssist = useCallback(async () => {
    const transcript = String(lastClipTranscript || '').trim()
    if (!transcript) return

    const lane = DOMAIN_LANES.find((item) => item.value === selectedDomainLane)
    const laneLabel = lane?.promptLabel || 'Operations'

    setIsRunningDomainAssist(true)
    setDomainAssistError(null)
    try {
      const prompt = [
        `You are assisting a New Zealand ${laneLabel} operations team via radio transcript triage.`,
        'Return concise actionable guidance with this structure:',
        '1) Risk level: Low/Medium/High.',
        '2) Immediate actions: maximum 3 bullet points.',
        '3) Evidence checklist: short practical list.',
        `Transcript: ${transcript}`,
      ].join('\n')

      const { data, error } = await edgeFunctions.askBob({
        prompt,
        organization_id: user?.organization_id ?? orgId,
      })

      if (error) throw new Error(error)

      const answer = String((data as any)?.answer || '').trim()
      if (!answer) throw new Error('No assistive guidance returned')

      setDomainAssistResult({
        lane: selectedDomainLane,
        label: DOMAIN_LANES.find((item) => item.value === selectedDomainLane)?.label || selectedDomainLane,
        answer,
        provider: typeof (data as any)?.provider === 'string' ? (data as any).provider : null,
        model: typeof (data as any)?.model === 'string' ? (data as any).model : null,
        updatedAt: new Date().toISOString(),
      })
    } catch (err: any) {
      setDomainAssistResult(null)
      setDomainAssistError(err?.message ?? 'Domain assist unavailable right now')
    } finally {
      if (mountedRef.current) {
        setIsRunningDomainAssist(false)
      }
    }
  }, [lastClipTranscript, orgId, selectedDomainLane, user?.organization_id])

  useEffect(() => {
    let cancelled = false

    AsyncStorage.getItem(PTT_TRANSLATION_PREF_KEY)
      .then((value) => {
        if (cancelled || !value) return
        if (TRANSLATION_OPTIONS.some((option) => option.value === value)) {
          setSelectedTranslationLanguage(value as TranslationOptionValue)
        }
      })
      .catch(() => {
        // Ignore persisted preference failures.
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    AsyncStorage.setItem(PTT_TRANSLATION_PREF_KEY, selectedTranslationLanguage).catch(() => {
      // Ignore persisted preference failures.
    })
  }, [selectedTranslationLanguage])

  // ------------------------------------------------------------------
  // Connect to PTT server
  // ------------------------------------------------------------------
  const connect = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setWsStatus('connecting')
    connectionStartedAtRef.current = Date.now()
    setWsError(null)
    setDegradedMode(false)

    try {
      let tokenData: PTTTokenResponse | null = null
      let mintError: string | null = null

      for (let attempt = 1; attempt <= MAX_TOKEN_MINT_RETRIES; attempt++) {
        const { data, error } = await edgeFunctions.pttSignalingToken({ channelScope: channelId })

        if (!error && data?.token && data?.wsUrl) {
          tokenData = data as PTTTokenResponse
          mintError = null
          break
        }

        mintError = error || 'Unable to mint PTT token.'
        const retryAfter = parseRetryAfterSeconds(mintError)
        if (retryAfter && retryAfter > 0) {
          await delay(retryAfter * 1000)
          continue
        }

        const lower = mintError.toLowerCase()
        const isTransient =
          lower.includes('failed to fetch') ||
          lower.includes('network') ||
          lower.includes('timeout') ||
          lower.includes('401')

        if (!isTransient || attempt === MAX_TOKEN_MINT_RETRIES) break
        await delay(TOKEN_MINT_RETRY_DELAY_MS)
      }

      if (!tokenData) {
        setWsStatus('error')
        setWsError(mintError || 'Unable to mint PTT token.')
        return
      }

      if (!tokenData.wsUrl.startsWith('ws://') && !tokenData.wsUrl.startsWith('wss://')) {
        setWsStatus('error')
        setWsError('PTT websocket URL is invalid.')
        return
      }

      const openSocket = (mode: 'subprotocol' | 'query', attemptedFallback = false) => {
        const fallbackUrl = `${tokenData.wsUrl}?token=${encodeURIComponent(tokenData.token)}`
        const ws = mode === 'subprotocol'
          ? new WebSocket(tokenData.wsUrl, ['ptt.v2', `auth.${tokenData.token}`])
          : new WebSocket(fallbackUrl)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          setWsStatus('connected')
          setReconnectAttempts(0)
          setLastCloseCode(null)
          setLastCloseReason(null)
          setWsError(null)
          setDegradedMode(false)
          connectionStartedAtRef.current = null
          scheduleTokenRefresh(tokenData.expiresIn)
        }

        ws.onerror = () => {
          if (!mountedRef.current) return
          setWsStatus('error')
          setWsError('Connection failed. Tap to retry.')
        }

        ws.onclose = (event) => {
          if (!mountedRef.current) return
          wsRef.current = null
          setLastCloseCode(event.code)
          setLastCloseReason(event.reason || null)

          // Proxy chains may reject long subprotocol headers; retry once with query-token auth.
          if (!attemptedFallback && mode === 'subprotocol' && event.code !== 1000) {
            openSocket('query', true)
            return
          }

          setWsStatus('disconnected')
          if (event.code !== 1000) {
            setReconnectAttempts((prev) => prev + 1)
          }
        }

        ws.onmessage = (event) => {
          try {
            const msg: ServerMessage = JSON.parse(event.data as string)
            handleMessage(msg)
          } catch {
            // ignore malformed frames
          }
        }
      }

      openSocket('subprotocol')
    } catch (err: any) {
      setWsStatus('error')
      setWsError(err?.message ?? 'Unknown error')
    }
  }, [channelId, handleMessage, scheduleTokenRefresh])

  const disconnect = useCallback(() => {
    clearTokenRefreshTimer()
    // Stop recording if active
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {})
      recordingRef.current = null
    }
    // Unload any playing incoming clip
    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {})
      soundRef.current = null
    }
    // Unload any playing synthesized TTS clip
    if (ttsRef.current) {
      ttsRef.current.unloadAsync().catch(() => {})
      ttsRef.current = null
    }
    wsRef.current?.close(1000, 'screen_cleanup')
    wsRef.current = null
    setWsStatus('disconnected')
    setTransmitting(false)
    setUploading(false)
    setPresence([])
    setSpeakerId(null)
    setEmergency(null)
  }, [clearTokenRefreshTimer])

  // ------------------------------------------------------------------
  // Audio permissions (requested once on first connect)
  // ------------------------------------------------------------------
  const requestAudioPermission = useCallback(async (): Promise<boolean> => {
    const { status } = await Audio.requestPermissionsAsync()
    if (status !== 'granted') {
      setAudioError('Microphone permission denied.')
      return false
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    })
    return true
  }, [])

  // ------------------------------------------------------------------
  // PTT start (press down)
  // ------------------------------------------------------------------
  const startTransmit = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    if (transmitting || uploading) return

    setAudioError(null)

    const granted = await requestAudioPermission()
    if (!granted) return

    // Tell server we're starting to speak
    wsRef.current.send(JSON.stringify({ type: 'start_speaking', channelId }))

    try {
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      )
      recordingRef.current = recording
      recordingStartRef.current = Date.now()
      setTransmitting(true)
      Vibration.vibrate(200)
    } catch (err: any) {
      setAudioError(`Mic error: ${err?.message ?? 'unknown'}`)
      // Retract start_speaking if recording setup failed
      wsRef.current?.send(JSON.stringify({ type: 'stop_speaking', channelId }))
    }
  }, [channelId, transmitting, uploading, requestAudioPermission])

  // ------------------------------------------------------------------
  // PTT stop (release)
  // ------------------------------------------------------------------
  const stopTransmit = useCallback(async () => {
    if (!transmitting) return

    setTransmitting(false)
    setUploading(true)
    Vibration.vibrate([100, 50, 100])

    const recording = recordingRef.current
    recordingRef.current = null
    const duration = Math.round((Date.now() - recordingStartRef.current) / 1000)

    let clipUrl: string | null = null

    if (recording) {
      try {
        await recording.stopAndUnloadAsync()
        const uri = recording.getURI()

        if (uri && user?.id && orgId) {
          const result = await uploadPTTClip({
            localUri: uri,
            userId: user.id,
            orgId,
          })
          clipUrl = result.clipUrl

          // Persist log + transcript as best effort (non-blocking).
          void persistTransmissionLog(clipUrl, duration)
        }
      } catch (err: any) {
        setAudioError(`Upload failed: ${err?.message ?? 'unknown'}`)
      }
    }

    // Reset audio mode
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false })

    // Notify server
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'stop_speaking',
        channelId,
        clipUrl,
        duration,
      }))
    }

    setUploading(false)
  }, [transmitting, channelId, orgId, persistTransmissionLog, user?.id])

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true
    connect()

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      const prev = appStateRef.current
      appStateRef.current = nextState

      // When returning to foreground, aggressively reconnect if needed.
      if ((prev === 'background' || prev === 'inactive') && nextState === 'active') {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          connect().catch(() => {})
        }
      }
    })

    // Keep-alive reconnect loop while app is active.
    reconnectTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return
      if (appStateRef.current !== 'active') return
      if (reconnectAttempts >= MAX_WS_RECONNECT_ATTEMPTS) return
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        connect().catch(() => {})
      }
    }, 8000)

    const tokenRefreshCountdown = setInterval(() => {
      const target = tokenRefreshTargetAtRef.current
      if (!target) {
        setTokenRefreshInSeconds(null)
        return
      }
      const remaining = Math.ceil((target - Date.now()) / 1000)
      if (remaining <= 0) {
        setTokenRefreshInSeconds(0)
        return
      }
      setTokenRefreshInSeconds(remaining)
    }, 1000)

    const degradedTimer = setInterval(() => {
      if (!mountedRef.current) return
      if (appStateRef.current !== 'active') return
      if (wsStatus === 'connected') {
        setDegradedMode(false)
        return
      }

      const startedAt = connectionStartedAtRef.current
      if (!startedAt) return
      if (Date.now() - startedAt >= 15_000) {
        setDegradedMode(true)
      }
    }, 1000)

    return () => {
      mountedRef.current = false
      appStateSub.remove()
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      clearInterval(tokenRefreshCountdown)
      clearInterval(degradedTimer)
      disconnect()
    }
  }, [connect, disconnect, reconnectAttempts, wsStatus])

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------
  const renderPresenceItem = ({ item }: { item: PresenceRecord }) => {
    const isSpeaking = item.userId === speakerId
    return (
      <View style={[styles.presenceRow, isSpeaking && styles.presenceRowSpeaking]}>
        <View style={[styles.presenceDot, { backgroundColor: roleColor(item.role) }]} />
        <View style={styles.presenceInfo}>
          <Text style={styles.presenceName}>{item.name}</Text>
          <Text style={styles.presenceRole}>{item.role.replace('_', ' ')}</Text>
        </View>
        {isSpeaking && (
          <Ionicons name="mic" size={18} color={highVis.colors.compliantGreen} />
        )}
      </View>
    )
  }

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.container}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Radio</Text>
        <View style={styles.statusBadge}>
          {wsStatus === 'connecting' && <ActivityIndicator size="small" color={highVis.colors.actionBlue} />}
          {wsStatus === 'connected' && <Ionicons name="radio" size={16} color={highVis.colors.compliantGreen} />}
          {(wsStatus === 'disconnected' || wsStatus === 'error') && (
            <Ionicons name="radio-outline" size={16} color={highVis.colors.nightTextSecondary} />
          )}
          <Text style={[styles.statusText, wsStatus === 'connected' && styles.statusConnected]}>
            {wsStatus === 'connecting' ? 'Connecting…'
              : wsStatus === 'connected' ? 'Live'
              : wsStatus === 'error' ? 'Error'
              : 'Off'}
          </Text>
          <Pressable
            style={styles.diagToggle}
            onPress={() => setShowDiagnostics((prev) => !prev)}
          >
            <Ionicons name="information-circle-outline" size={16} color={highVis.colors.nightTextSecondary} />
          </Pressable>
        </View>
      </View>

      {showDiagnostics && (
        <View style={styles.diagPanel}>
          <Text style={styles.diagHeading}>PTT Diagnostics</Text>
          <View style={styles.diagRow}>
            <Text style={styles.diagKey}>WS</Text>
            <Text style={styles.diagValue}>{wsStatus.toUpperCase()}</Text>
          </View>
          <View style={styles.diagRow}>
            <Text style={styles.diagKey}>Reconnects</Text>
            <Text style={styles.diagValue}>{reconnectAttempts}</Text>
          </View>
          <View style={styles.diagRow}>
            <Text style={styles.diagKey}>Last Close</Text>
            <Text style={styles.diagValue}>{lastCloseCode ?? 'none'}</Text>
          </View>
          <View style={styles.diagRow}>
            <Text style={styles.diagKey}>Reason</Text>
            <Text style={styles.diagValue} numberOfLines={1}>{lastCloseReason || 'none'}</Text>
          </View>
          <View style={styles.diagRow}>
            <Text style={styles.diagKey}>Token Refresh</Text>
            <Text style={styles.diagValue}>{tokenRefreshInSeconds == null ? 'n/a' : `${tokenRefreshInSeconds}s`}</Text>
          </View>
          <View style={styles.diagRow}>
            <Text style={styles.diagKey}>Presence</Text>
            <Text style={styles.diagValue}>{presence.length}</Text>
          </View>
        </View>
      )}

      {/* ── Channel label ── */}
      <View style={styles.channelBar}>
        <Ionicons name="layers-outline" size={14} color={highVis.colors.nightTextSecondary} />
        <Text style={styles.channelLabel}>{channelId}</Text>
      </View>

      {/* ── Emergency banner ── */}
      {emergency?.active && (
        <View style={styles.emergencyBanner}>
          <Ionicons name="warning" size={18} color="#fff" />
          <Text style={styles.emergencyText}>
            EMERGENCY{emergency.message ? ` – ${emergency.message}` : ''}
          </Text>
        </View>
      )}

      {/* ── Error / retry ── */}
      {wsStatus === 'error' && (
        <Pressable style={styles.retryBar} onPress={connect}>
          <Ionicons name="refresh" size={14} color={highVis.colors.actionBlue} />
          <Text style={styles.retryText}>{wsError ?? 'Tap to retry'}</Text>
        </Pressable>
      )}

      {degradedMode && wsStatus !== 'connected' && (
        <View style={styles.degradedBar}>
          <Ionicons name="warning-outline" size={14} color={highVis.colors.warningAmber} />
          <Text style={styles.degradedText}>PTT server unreachable - check your connection or use mobile phone direct.</Text>
          <Pressable onPress={connect}>
            <Text style={styles.degradedRetryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* ── Presence roster ── */}
      <View style={styles.rosterContainer}>
        <Text style={styles.rosterHeading}>
          On channel · {presence.length} online
        </Text>
        {wsStatus === 'connecting' ? (
          <ActivityIndicator color={highVis.colors.actionBlue} style={{ marginTop: 24 }} />
        ) : presence.length === 0 ? (
          <Text style={styles.emptyRoster}>No one else is on this channel</Text>
        ) : (
          <FlatList
            data={presence}
            keyExtractor={(p) => p.userId}
            renderItem={renderPresenceItem}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>

      <View style={styles.transcriptPanel}>
        <View style={styles.transcriptHeader}>
          <View style={styles.transcriptHeaderCopy}>
            <Text style={styles.transcriptHeading}>Latest transcript</Text>
            <Text style={styles.transcriptSubheading}>{lastTranscriptLabel}</Text>
          </View>
          {transcriptUpdatedAt && (
            <Text style={styles.transcriptMeta}>
              {new Date(transcriptUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>

        {isTranscribingIncoming && !lastClipTranscript ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator size="small" color={highVis.colors.actionBlue} />
            <Text style={styles.transcriptPlaceholder}>Transcribing incoming transmission…</Text>
          </View>
        ) : lastClipTranscript ? (
          <>
            <Text style={styles.transcriptBody}>{lastClipTranscript}</Text>

            <View style={styles.translationControls}>
              {TRANSLATION_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  style={[
                    styles.translationChip,
                    selectedTranslationLanguage === option.value && styles.translationChipActive,
                  ]}
                  onPress={() => setSelectedTranslationLanguage(option.value)}
                >
                  <Text
                    style={[
                      styles.translationChipText,
                      selectedTranslationLanguage === option.value && styles.translationChipTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.domainLanePanel}>
              <Text style={styles.domainLaneHeading}>AI focus lane</Text>
              <View style={styles.domainLaneControls}>
                {DOMAIN_LANES.map((lane) => (
                  <Pressable
                    key={lane.value}
                    style={[
                      styles.domainLaneChip,
                      selectedDomainLane === lane.value && styles.domainLaneChipActive,
                    ]}
                    onPress={() => setSelectedDomainLane(lane.value)}
                  >
                    <Text
                      style={[
                        styles.domainLaneChipText,
                        selectedDomainLane === lane.value && styles.domainLaneChipTextActive,
                      ]}
                    >
                      {lane.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                style={[styles.domainAssistButton, isRunningDomainAssist && styles.translateButtonDisabled]}
                onPress={runDomainAssist}
                disabled={isRunningDomainAssist}
              >
                {isRunningDomainAssist ? (
                  <ActivityIndicator size="small" color={highVis.colors.nightBlack} />
                ) : (
                  <Ionicons name="sparkles-outline" size={16} color={highVis.colors.nightBlack} />
                )}
                <Text style={styles.translateButtonText}>
                  {isRunningDomainAssist ? 'Generating assist…' : 'Run domain assist'}
                </Text>
              </Pressable>
            </View>

            <Pressable
              style={[styles.translateButton, isTranslating && styles.translateButtonDisabled]}
              onPress={translateTranscript}
              disabled={isTranslating}
            >
              {isTranslating ? (
                <ActivityIndicator size="small" color={highVis.colors.nightBlack} />
              ) : (
                <Ionicons name="language-outline" size={16} color={highVis.colors.nightBlack} />
              )}
              <Text style={styles.translateButtonText}>
                {isTranslating ? 'Translating…' : 'Translate transcript'}
              </Text>
            </Pressable>

            {translationError && (
              <Text style={styles.translationErrorText}>{translationError}</Text>
            )}

            {translationResult?.translated_text ? (
              <View style={styles.translationResultCard}>
                <Text style={styles.translationResultHeading}>
                  Translation · {TRANSLATION_OPTIONS.find((option) => option.value === selectedTranslationLanguage)?.label || selectedTranslationLanguage}
                </Text>
                <Text style={styles.translationResultBody}>{translationResult.translated_text}</Text>
                {(translationResult.provider || translationResult.model || translationResult.detected_language || translationResult.translation_confidence != null || translationResult.fallback) && (
                  <Text style={styles.translationResultMeta}>
                    {translationResult.detected_language ? `Source ${translationResult.detected_language}` : 'Source auto'}
                    {translationResult.provider ? ` · ${translationResult.provider}` : ''}
                    {translationResult.model ? ` · ${translationResult.model}` : ''}
                    {translationResult.translation_confidence != null ? ` · ${(translationResult.translation_confidence * 100).toFixed(0)}%` : ''}
                    {translationResult.fallback ? ' · fallback' : ''}
                  </Text>
                )}
              </View>
            ) : null}

            {domainAssistError ? (
              <Text style={styles.translationErrorText}>{domainAssistError}</Text>
            ) : null}

            {domainAssistResult?.answer ? (
              <View style={styles.domainAssistResultCard}>
                <Text style={styles.domainAssistResultHeading}>
                  Domain assist · {domainAssistResult.label}
                </Text>
                <Text style={styles.domainAssistResultBody}>{domainAssistResult.answer}</Text>
                {(domainAssistResult.provider || domainAssistResult.model || domainAssistResult.updatedAt) && (
                  <Text style={styles.translationResultMeta}>
                    {domainAssistResult.provider ? domainAssistResult.provider : 'provider unknown'}
                    {domainAssistResult.model ? ` · ${domainAssistResult.model}` : ''}
                    {domainAssistResult.updatedAt ? ` · ${new Date(domainAssistResult.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </Text>
                )}
              </View>
            ) : null}
          </>
        ) : isTranscribingIncoming ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <ActivityIndicator size="small" color={highVis.colors.actionBlue} />
            <Text style={styles.transcriptPlaceholder}>Transcribing incoming transmission…</Text>
          </View>
        ) : (
          <Text style={styles.transcriptPlaceholder}>
            Send a transmission to generate a transcript and translation assist.
          </Text>
        )}
      </View>

      {/* ── PTT button ── */}
      <View style={styles.pttContainer}>
        {wsStatus !== 'connected' ? (
          <Pressable style={[styles.pttButton, styles.pttButtonDisabled]} disabled>
            <Ionicons name="mic-off" size={40} color={highVis.colors.nightTextSecondary} />
            <Text style={styles.pttLabelDisabled}>Not connected</Text>
          </Pressable>
        ) : uploading ? (
          <View style={[styles.pttButton, styles.pttButtonUploading]}>
            <ActivityIndicator size="large" color={highVis.colors.actionBlue} />
            <Text style={styles.pttLabelUploading}>Sending…</Text>
          </View>
        ) : (
          <Pressable
            style={[styles.pttButton, !transmitting && styles.pttButtonReady, transmitting && styles.pttButtonActive]}
            onPressIn={startTransmit}
            onPressOut={stopTransmit}
          >
            <Ionicons
              name={transmitting ? 'mic' : 'mic-outline'}
              size={40}
              color={transmitting ? '#fff' : highVis.colors.nightTextPrimary}
            />
            <Text style={[styles.pttLabel, transmitting && styles.pttLabelActive]}>
              {transmitting ? 'Transmitting…' : 'Hold to Talk'}
            </Text>
          </Pressable>
        )}
        {audioError && (
          <Text style={styles.audioErrorText}>{audioError}</Text>
        )}
      </View>

    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: highVis.colors.nightBlack,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: highVis.spacing.md,
    paddingTop: highVis.spacing.sm,
    paddingBottom: highVis.spacing.xs,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: highVis.colors.nightTextPrimary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  diagToggle: {
    marginLeft: 4,
  },
  diagPanel: {
    marginHorizontal: highVis.spacing.md,
    marginBottom: highVis.spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: highVis.colors.nightTextSecondary,
    backgroundColor: highVis.colors.nightSurface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  diagHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: highVis.colors.nightTextSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  diagKey: {
    fontSize: 11,
    color: highVis.colors.nightTextSecondary,
  },
  diagValue: {
    fontSize: 11,
    color: highVis.colors.nightTextPrimary,
    maxWidth: '65%',
    textAlign: 'right',
  },
  statusText: {
    fontSize: 13,
    color: highVis.colors.nightTextSecondary,
    fontWeight: '600',
  },
  statusConnected: {
    color: highVis.colors.compliantGreen,
  },
  channelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: highVis.spacing.md,
    paddingBottom: highVis.spacing.sm,
  },
  channelLabel: {
    fontSize: 13,
    color: highVis.colors.nightTextSecondary,
    fontFamily: 'monospace',
  },
  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: highVis.spacing.md,
    marginBottom: highVis.spacing.sm,
    backgroundColor: highVis.colors.infringementRed,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  emergencyText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
  },
  retryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: highVis.spacing.md,
    marginBottom: highVis.spacing.sm,
    backgroundColor: highVis.colors.nightSurfaceAlt,
    borderRadius: 8,
    padding: 10,
  },
  retryText: {
    color: highVis.colors.actionBlue,
    fontSize: 13,
  },
  degradedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: highVis.spacing.md,
    marginBottom: highVis.spacing.sm,
    backgroundColor: '#2b200a',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  degradedText: {
    flex: 1,
    color: highVis.colors.warningAmber,
    fontSize: 12,
  },
  degradedRetryText: {
    color: highVis.colors.actionBlue,
    fontSize: 12,
    fontWeight: '700',
  },
  rosterContainer: {
    flex: 1,
    marginHorizontal: highVis.spacing.md,
    marginBottom: highVis.spacing.sm,
  },
  rosterHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: highVis.colors.nightTextSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  emptyRoster: {
    fontSize: 14,
    color: highVis.colors.nightTextSecondary,
    marginTop: 24,
    textAlign: 'center',
  },
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: highVis.colors.nightSurface,
  },
  presenceRowSpeaking: {
    backgroundColor: '#0d2a1a',
    borderWidth: 1,
    borderColor: highVis.colors.compliantGreen,
  },
  presenceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  presenceInfo: {
    flex: 1,
  },
  presenceName: {
    fontSize: 15,
    fontWeight: '600',
    color: highVis.colors.nightTextPrimary,
  },
  presenceRole: {
    fontSize: 12,
    color: highVis.colors.nightTextSecondary,
    textTransform: 'capitalize',
  },
  separator: {
    height: 6,
  },
  transcriptPanel: {
    marginHorizontal: highVis.spacing.md,
    marginBottom: highVis.spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: highVis.colors.nightTextSecondary,
    backgroundColor: highVis.colors.nightSurface,
    padding: 12,
    gap: 10,
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  transcriptHeaderCopy: {
    flex: 1,
    paddingRight: 10,
  },
  transcriptHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: highVis.colors.nightTextSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  transcriptSubheading: {
    marginTop: 2,
    fontSize: 12,
    color: highVis.colors.nightTextSecondary,
  },
  transcriptMeta: {
    fontSize: 11,
    color: highVis.colors.nightTextSecondary,
  },
  transcriptBody: {
    fontSize: 14,
    lineHeight: 20,
    color: highVis.colors.nightTextPrimary,
  },
  transcriptPlaceholder: {
    fontSize: 13,
    lineHeight: 18,
    color: highVis.colors.nightTextSecondary,
  },
  translationControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  domainLanePanel: {
    gap: 8,
  },
  domainLaneHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: highVis.colors.nightTextSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  domainLaneControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  domainLaneChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0284c7',
    backgroundColor: highVis.colors.nightBlack,
  },
  domainLaneChipActive: {
    backgroundColor: '#38bdf8',
    borderColor: '#38bdf8',
  },
  domainLaneChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7dd3fc',
  },
  domainLaneChipTextActive: {
    color: highVis.colors.nightBlack,
  },
  domainAssistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    backgroundColor: '#38bdf8',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  translationChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: highVis.colors.nightTextSecondary,
    backgroundColor: highVis.colors.nightBlack,
  },
  translationChipActive: {
    borderColor: highVis.colors.actionBlue,
    backgroundColor: highVis.colors.actionBlue,
  },
  translationChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: highVis.colors.nightTextSecondary,
  },
  translationChipTextActive: {
    color: highVis.colors.nightBlack,
  },
  translateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    backgroundColor: highVis.colors.actionBlue,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  translateButtonDisabled: {
    opacity: 0.7,
  },
  translateButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: highVis.colors.nightBlack,
  },
  translationErrorText: {
    fontSize: 12,
    color: highVis.colors.infringementRed,
  },
  translationResultCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: highVis.colors.compliantGreen,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    padding: 10,
    gap: 6,
  },
  translationResultHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: highVis.colors.compliantGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  translationResultBody: {
    fontSize: 14,
    lineHeight: 20,
    color: highVis.colors.nightTextPrimary,
  },
  translationResultMeta: {
    fontSize: 11,
    color: highVis.colors.nightTextSecondary,
  },
  domainAssistResultCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0284c7',
    backgroundColor: 'rgba(14, 165, 233, 0.12)',
    padding: 10,
    gap: 6,
  },
  domainAssistResultHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7dd3fc',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  domainAssistResultBody: {
    fontSize: 14,
    lineHeight: 20,
    color: highVis.colors.nightTextPrimary,
  },
  pttContainer: {
    paddingHorizontal: highVis.spacing.md,
    paddingBottom: highVis.spacing.lg,
    alignItems: 'center',
  },
  pttButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#062513',
    borderWidth: 3,
    borderColor: '#1f7a3f',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pttButtonReady: {
    backgroundColor: '#0b3a1d',
    borderColor: '#2fbf6a',
  },
  pttButtonActive: {
    backgroundColor: '#0e7a2e',
    borderColor: highVis.colors.compliantGreen,
    shadowColor: highVis.colors.compliantGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 12,
  },
  pttButtonDisabled: {
    opacity: 0.4,
  },
  pttButtonUploading: {
    backgroundColor: '#0d1f3a',
    borderColor: highVis.colors.actionBlue,
  },
  pttLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#c7f9d8',
  },
  pttLabelActive: {
    color: '#fff',
  },
  pttLabelDisabled: {
    fontSize: 13,
    color: highVis.colors.nightTextSecondary,
  },
  pttLabelUploading: {
    fontSize: 13,
    color: highVis.colors.actionBlue,
    fontWeight: '600',
  },
  audioErrorText: {
    marginTop: 10,
    fontSize: 12,
    color: highVis.colors.infringementRed,
    textAlign: 'center',
  },
})
