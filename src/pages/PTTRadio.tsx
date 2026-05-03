interface TranslationResult {
  translated_text: string;
  target_language: string;
  detected_source?: string | null;
  translation_confidence?: number;
  confidence_reason?: string;
  provider?: string;
  fallback?: boolean;
}
/**
 * PTTRadio — Independent 2-way radio system
 *
 * A full-screen tactical radio console inspired by police/fire/ambulance
 * dispatch systems. Completely independent from Team Chat.
 *
 * Features:
 *  - Multi-channel grid with tap-to-select
 *  - Hold-to-talk PTT button (mouse + touch + spacebar)
 *  - One-tap emergency all-call button
 *  - Real-time audio level meter
 *  - Scanner mode (auto-cycles channels, pauses on activity)
 *  - VOX mode (voice-activated transmission)
 *  - Transmission log with callsign + duration
 *  - Unit presence grid (who's online)
 *  - Status tones (TX start/end beeps via Web Audio API)
 *  - Bluetooth PTT button support
 *  - Wake lock during active transmission
 *  - Notification permission for background incoming calls
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { canAccessPTTChannel } from '@/lib/pttChannelAccess'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { useBobBrain } from '@/hooks/useBobBrain'
import { useHybridWorkspaceHandshake } from '@/hooks/useHybridWorkspaceHandshake'
import { useBobTranslator } from '@/hooks/useBobTranslator'
import {
  usePTTStore,
  usePTTAvailable,
  usePTTCanSpeak,
} from '@/stores/pttStore'
import {
  connectToPTT,
  extractPTTRetryAfterSeconds,
  ensureMicrophonePermission,
  getPTTDiagnostics,
  type PTTDiagnostics,
  startSpeaking,
  stopSpeaking,
  startVoxMonitoring,
  stopVoxMonitoring,
  setVoxThreshold,
  toggleMute,
  sendEmergencyBroadcast,
  initBluetoothPTT,
  normalizePTTErrorMessage,
  primePTTRemoteAudioPlayback,
} from '@/lib/ptt'
import { requestWakeLock, releaseWakeLock, requestNotificationPermission } from '@/lib/pttBackground'
import { radioFeatureFlags } from '@/lib/radio/radioFeatureFlags'
import { radioCaptionService, type CaptionSegment } from '@/lib/radio/radioCaptionService'
import { radioTranslationService, type TranslationSegment } from '@/lib/radio/radioTranslationService'
import { checkInferenceHealth } from '@/lib/proxyServices'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Bluetooth,
  BluetoothOff,
  Radio,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  AlertTriangle,
  RefreshCw,
  Scan,
  Settings,
  Clock,
  Users,
  Loader2,
  Play,
  Signal,
  PhoneOff,
  Menu,
  BrainCircuit,
  Languages,
  History,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RadioChannel {
  id: string
  channel_number: number
  name: string
  channel_type: string
  color: string
  is_priority: boolean
  description: string | null
  is_active: boolean
  scope_override?: string | null
  badge_label?: string | null
  scope_label?: string | null
}

interface OrganizationSummary {
  id: string
  name: string
}

interface TransmissionEntry {
  id: string
  callsign: string
  name: string
  channelName: string
  channelNumber: number
  durationSeconds: number
  createdAt: string
  clipUrl?: string | null
  transcript?: string | null
  isEmergency: boolean
  isLive: boolean
}

interface SyntheticAudioRender {
  translationSegmentId: string
  targetLanguage: string
  provider: string
  isSynthetic: boolean
  renderLatencyMs: number | null
  durationMs: number | null
  storagePath: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHANNELS: RadioChannel[] = [
  { id: 'default-1', channel_number: 1, name: 'All Units',         channel_type: 'primary',   color: '#3b82f6', is_priority: false, description: 'Org-wide primary channel',      is_active: true },
  { id: 'default-2', channel_number: 2, name: 'Dispatch',          channel_type: 'dispatch',  color: '#f97316', is_priority: false, description: 'Dispatch coordination',          is_active: true },
  { id: 'default-3', channel_number: 3, name: 'Operations',        channel_type: 'team',      color: '#22c55e', is_priority: false, description: 'Operational team channel',       is_active: true },
  { id: 'default-4', channel_number: 4, name: 'Incident Primary',  channel_type: 'incident',  color: '#ef4444', is_priority: false, description: 'Active incident response',       is_active: true },
  { id: 'default-5', channel_number: 5, name: 'Incident 2',        channel_type: 'incident',  color: '#dc2626', is_priority: false, description: 'Secondary incident channel',     is_active: true },
  { id: 'default-6', channel_number: 6, name: 'Welfare',           channel_type: 'welfare',   color: '#a855f7', is_priority: false, description: 'Officer welfare monitoring',     is_active: true },
  { id: 'default-7', channel_number: 7, name: 'Admin',             channel_type: 'admin',     color: '#6b7280', is_priority: false, description: 'Administrative use only',        is_active: true },
  { id: 'default-9', channel_number: 9, name: 'EMERGENCY',         channel_type: 'emergency', color: '#ff0000', is_priority: true,  description: 'All-call emergency broadcast',  is_active: true },
]

const CHANNEL_TYPE_ORDER: Record<string, number> = {
  primary: 0, cross_org: 1, dispatch: 2, team: 3, incident: 4, welfare: 5, admin: 6, emergency: 99,
}

const TRANSLATION_LANGUAGE_OPTIONS = [
  { value: 'en-NZ', label: 'English (NZ)' },
  { value: 'mi-NZ', label: 'Te Reo Maori' },
  { value: 'zh-CN', label: 'Chinese (Mandarin)' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'tl-PH', label: 'Filipino (Tagalog)' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'ar-SA', label: 'Arabic' },
] as const

const TEAM_CHAT_TRANSLATION_PREF_KEY = 'team-chat-translation-pref-v1'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHANNEL_SWITCH_DEBOUNCE_MS = 400
const CONNECT_ACTION_COOLDOWN_MS = 800
const MANUAL_CONNECT_MIN_GAP_MS = 900
const AUTO_RETRY_MIN_GAP_MS = 4000
const CONNECT_STORM_WINDOW_MS = 15000
const CONNECT_STORM_MAX_ATTEMPTS = 6
const CONNECT_STORM_COOLDOWN_MS = 20000
const CONNECTION_WARNING_TIMEOUT_MS = 12000
const CAPTION_DELAY_THRESHOLD_MS = 6000
const CAPTION_LOW_CONFIDENCE_THRESHOLD = 0.65
const SYNTHETIC_RELAY_DELAY_THRESHOLD_MS = 1500

function isLowConfidenceCaption(seg: CaptionSegment): boolean {
  return seg.isFinal
    && Number.isFinite(seg.confidence)
    && seg.confidence > 0
    && seg.confidence < CAPTION_LOW_CONFIDENCE_THRESHOLD
}

function deriveTranslatorRestUrlFromWs(raw: string): string {
  const trimmed = String(raw || '').trim().replace(/\/$/, '')
  if (!trimmed || trimmed.includes('your-runpod-pod.runpod.net')) return ''

  const asHttp = trimmed
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://')

  const withoutWsRoute = asHttp.replace(/\/ws\/translate(?:\?.*)?$/i, '')
  if (!withoutWsRoute.startsWith('http://') && !withoutWsRoute.startsWith('https://')) return ''

  return `${withoutWsRoute}/translate`
}

function getChannelScope(channel: RadioChannel, effectiveOrgId: string): string {
  if (channel.scope_override) {
    return channel.scope_override
  }

  // Primary channel must always be org-wide so all clients converge on the
  // same scope even when one device falls back to default channel metadata.
  if (channel.channel_type === 'primary' || channel.channel_number === 1) {
    return `org:${effectiveOrgId}`
  }

  // Persisted channel rows use UUID ids and map to unique deployment scopes.
  // Fallback defaults are non-UUID and use org scope to stay valid.
  if (UUID_RE.test(channel.id)) {
    return `deployment:${channel.id}`
  }
  return `org:${effectiveOrgId}`
}

function buildPTTAssessmentPrompt(params: {
  diagnostics: PTTDiagnostics
  activeChannel: RadioChannel | null
  effectiveOrgId: string | null
  callsign: string
  connectionStatus: string
  isAvailable: boolean
  canSpeak: boolean
  isMuted: boolean
  isTransmitting: boolean
  someoneSpeaking: boolean
  speakerName: string | null
  microphoneReady: boolean
  microphoneError: string | null
  rosterCount: number
  liveClipsCount: number
  channelsError: unknown
}) {
  const {
    diagnostics,
    activeChannel,
    effectiveOrgId,
    callsign,
    connectionStatus,
    isAvailable,
    canSpeak,
    isMuted,
    isTransmitting,
    someoneSpeaking,
    speakerName,
    microphoneReady,
    microphoneError,
    rosterCount,
    liveClipsCount,
    channelsError,
  } = params

  const snapshot = {
    capturedAt: new Date().toISOString(),
    activeChannel: activeChannel
      ? {
          id: activeChannel.id,
          number: activeChannel.channel_number,
          name: activeChannel.name,
          type: activeChannel.channel_type,
        }
      : null,
    organizationId: effectiveOrgId,
    operator: {
      callsign: callsign || 'unknown',
      microphoneReady,
      microphoneError,
      canSpeak,
      isAvailable,
      isMuted,
      isTransmitting,
    },
    session: {
      connectionStatus,
      someoneSpeaking,
      speakerName,
      rosterCount,
      liveClipsCount,
      channelsMetadataUnavailable: Boolean(channelsError),
    },
    diagnostics,
  }

  return [
    'PTT radio assessment request from the live Radio screen.',
    'Your job is to assess whether audio transmission is actually happening, likely blocked, or still unproven from this diagnostic snapshot.',
    'Do not answer generically. Use the exact values below.',
    'Return four sections only:',
    '1. Verdict: PROVEN / LIKELY / BLOCKED / INCONCLUSIVE.',
    '2. Failure layer: microphone, websocket/signaling, channel scope, SDP negotiation, ICE/TURN, remote playback, or other.',
    '3. Evidence: cite the exact fields that support the verdict.',
    '4. Next actions: the next 3 concrete checks or fixes, ordered.',
    'If TURN or ICE relay auth is the most likely blocker, say that explicitly.',
    `Diagnostic snapshot: ${JSON.stringify(snapshot)}`,
  ].join(' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Web Audio helpers — status tones like real radios
// ─────────────────────────────────────────────────────────────────────────────

function playStatusTone(type: 'tx_start' | 'tx_end' | 'emergency', volume = 0.25) {
  if (typeof window === 'undefined') return
  try {
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    gain.gain.value = volume
    gain.connect(ctx.destination)

    if (type === 'tx_start') {
      // Single short beep: 1350 Hz, 65 ms
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = 1350
      osc.connect(gain)
      osc.start()
      osc.stop(ctx.currentTime + 0.065)
    } else if (type === 'tx_end') {
      // Two-tone descending chirp: 1090 → 975 Hz over 150 ms
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1090, ctx.currentTime)
      osc.frequency.linearRampToValueAtTime(975, ctx.currentTime + 0.15)
      osc.connect(gain)
      osc.start()
      osc.stop(ctx.currentTime + 0.15)
    } else if (type === 'emergency') {
      // Rapid warble: 970 Hz pulsed 3 times
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator()
        osc.type = 'square'
        osc.frequency.value = 970
        const g = ctx.createGain()
        g.gain.value = volume * 0.6
        osc.connect(g)
        g.connect(ctx.destination)
        const offset = i * 0.22
        osc.start(ctx.currentTime + offset)
        osc.stop(ctx.currentTime + offset + 0.18)
      }
    }

    setTimeout(() => ctx.close(), 1000)
  } catch {
    // Web Audio not available — silent fallback
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clock component
// ─────────────────────────────────────────────────────────────────────────────

function NZClock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('en-NZ', { timeZone: 'Pacific/Auckland', hour12: false }),
  )
  useEffect(() => {
    const iv = setInterval(() => {
      setTime(new Date().toLocaleTimeString('en-NZ', { timeZone: 'Pacific/Auckland', hour12: false }))
    }, 1000)
    return () => clearInterval(iv)
  }, [])
  return <span className="font-mono tabular-nums">{time}</span>
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio level bar
// ─────────────────────────────────────────────────────────────────────────────

function AudioLevelMeter({ level, transmitting }: { level: number; transmitting: boolean }) {
  const segments = 20
  const filled = Math.round((level / 100) * segments)
  return (
    <div className="flex gap-0.5 items-end h-6">
      {Array.from({ length: segments }, (_, i) => {
        const active = i < filled
        const color = i < 12 ? '#22c55e' : i < 16 ? '#f97316' : '#ef4444'
        return (
          <div
            key={i}
            className="w-1.5 rounded-sm transition-all duration-75"
            style={{
              height: `${Math.min(100, 40 + (i / segments) * 60)}%`,
              backgroundColor: active
                ? transmitting ? '#ef4444' : color
                : transmitting ? '#7f1d1d' : '#1e293b',
            }}
          />
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main PTTRadio component
// ─────────────────────────────────────────────────────────────────────────────

export default function PTTRadio() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const {
    askBobBrain,
    response: bobResponse,
    isLoading: isWaiting,
    error: bobResponseError,
    completedAt: bobResponseCompletedAt,
    clearResponse,
  } = useBobBrain()

  // PTT store state
  const connectionStatus = usePTTStore((s) => s.connectionStatus)
  const wsUrl = usePTTStore((s) => s.wsUrl)
  const channelId = usePTTStore((s) => s.channelId)
  const isSpeaking = usePTTStore((s) => s.isSpeaking)
  const speakerId = usePTTStore((s) => s.speakerId)
  const speakerName = usePTTStore((s) => s.speakerName)
  const isMuted = usePTTStore((s) => s.isMuted)
  const audioLevel = usePTTStore((s) => s.audioLevel)
  const voxEnabled = usePTTStore((s) => s.voxEnabled)
  const voxThreshold = usePTTStore((s) => s.voxThreshold)
  const inputMode = usePTTStore((s) => s.inputMode)
  const presence = usePTTStore((s) => s.presence)
  const lastClips = usePTTStore((s) => s.lastClips)
  const emergencyBroadcastActive = usePTTStore((s) => s.emergencyBroadcastActive)
  const emergencyBroadcastInitiatedByName = usePTTStore((s) => s.emergencyBroadcastInitiatedByName)
  const error = usePTTStore((s) => s.error)
  const setInputMode = usePTTStore((s) => s.setInputMode)
  const setVoxEnabled = usePTTStore((s) => s.setVoxEnabled)
  const setError = usePTTStore((s) => s.setError)

  const isAvailable = usePTTAvailable()
  const canSpeak = usePTTCanSpeak()
  const hasPttSupervisorControls = user?.role === 'master' || user?.role === 'grand_master'

  // Component state
  const [activeChannel, setActiveChannel] = useState<RadioChannel | null>(null)
  const [isTransmitting, setIsTransmitting] = useState(false)
  const [scanMode, setScanMode] = useState(false)
  const [scanIndex, setScanIndex] = useState(0)
  const [scanDwellMs, setScanDwellMs] = useState(8000)
  const [showSettings, setShowSettings] = useState(false)
  const [emergencyMode, setEmergencyMode] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectCooldownUntil, setConnectCooldownUntil] = useState(0)
  const [retryCountdownSeconds, setRetryCountdownSeconds] = useState<number | null>(null)
  const [connectionWarningArmed, setConnectionWarningArmed] = useState(false)
  const [callsign, setCallsign] = useState('')
  const [txLog, setTxLog] = useState<TransmissionEntry[]>([])
  const [currentTxStart, setCurrentTxStart] = useState<Date | null>(null)
  const [liveTxSeconds, setLiveTxSeconds] = useState(0)
  const [showNotificationHint, setShowNotificationHint] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [microphoneReady, setMicrophoneReady] = useState(false)
  const [microphoneError, setMicrophoneError] = useState<string | null>(null)
  const [audioPrimed, setAudioPrimed] = useState(false)
  const [isPrimingAudio, setIsPrimingAudio] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [diagnostics, setDiagnostics] = useState<PTTDiagnostics>(() => getPTTDiagnostics())
  const [showVoxCalibrator, setShowVoxCalibrator] = useState(false)
  const [degradedMode, setDegradedMode] = useState(false)
  const [disconnectingUserId, setDisconnectingUserId] = useState<string | null>(null)
  const [handoffGeoPoint, setHandoffGeoPoint] = useState<{ latitude: number; longitude: number } | null>(null)
  const [handoffGpsUnavailable, setHandoffGpsUnavailable] = useState(false)
  const [translationRailEnabled, setTranslationRailEnabled] = useState(true)
  const [pttStreamMode, setPttStreamMode] = useState<'tactical' | 'diplomatic'>('tactical')
  const [interpreterInput, setInterpreterInput] = useState('')
  const [interpreterOutput, setInterpreterOutput] = useState('')
  const [interpreterTranslationMeta, setInterpreterTranslationMeta] = useState<TranslationResult | null>(null)
  const [interpreterTargetLanguage, setInterpreterTargetLanguage] = useState('en-NZ')
  const [interpreterPrefsHydrated, setInterpreterPrefsHydrated] = useState(false)
  const [isInterpreterListening, setIsInterpreterListening] = useState(false)
  const [isInterpreterTranslating, setIsInterpreterTranslating] = useState(false)
  const signalingDebugLabel = useMemo(() => {
    if (!wsUrl) return 'Signal URL unavailable'
    try {
      const parsed = new URL(wsUrl)
      const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : ''
      return `${parsed.protocol}//${parsed.host}${path}`
    } catch {
      return wsUrl
    }
  }, [wsUrl])
  const signalingTransportState = useMemo(() => {
    if (!wsUrl) return 'SIGNAL UNKNOWN'
    if (wsUrl.startsWith('wss://')) return 'WSS OK'
    if (wsUrl.startsWith('ws://')) {
      if (typeof window !== 'undefined' && window.location.protocol === 'https:') return 'WS BLOCKED'
      return 'WS INSECURE'
    }
    return 'SIGNAL UNKNOWN'
  }, [wsUrl])
  const radioMode = useMemo(() => {
    const search = new URLSearchParams(location.search)
    return search.get('mode') || ''
  }, [location.search])
  const radioTargetUserId = useMemo(() => {
    const search = new URLSearchParams(location.search)
    return search.get('targetUserId') || ''
  }, [location.search])
  const radioTargetName = useMemo(() => {
    const search = new URLSearchParams(location.search)
    return search.get('targetName') || ''
  }, [location.search])

  // Auto-transcription state – populated after each incoming clip
  const [lastClipTranscript, setLastClipTranscript] = useState<string | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const transcribedClipIdRef = useRef<string | null>(null)

  const pttButtonRef = useRef<HTMLButtonElement>(null)
  const speechRecognitionRef = useRef<any>(null)
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveTxTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wakeLockRef = useRef(false)
  const txLogUnavailableRef = useRef(false)
  const initialConnectRef = useRef(false)
  const connectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRetryChannelRef = useRef<RadioChannel | null>(null)
  const connectInFlightRef = useRef(false)
  const connectAttemptTimestampsRef = useRef<number[]>([])
  const connectCircuitOpenUntilRef = useRef(0)
  const lastConnectAttemptAtRef = useRef(0)
  const lastConnectCircuitToastAtRef = useRef(0)
  const handoffGeoPollInFlightRef = useRef(false)

  // ── Live Captions (Phase 2 — gated by radioFeatureFlags.captionsEnabled) ──
  const [liveCaptions, setLiveCaptions] = useState<CaptionSegment[]>([])
  const [liveTranslations, setLiveTranslations] = useState<TranslationSegment[]>([])
  const [syntheticRenders, setSyntheticRenders] = useState<SyntheticAudioRender[]>([])
  const [lastCaptionAtMs, setLastCaptionAtMs] = useState<number | null>(null)
  const [captionsDelayed, setCaptionsDelayed] = useState(false)
  const remoteTransmissionStartedAtRef = useRef<number | null>(null)

  const { data: captionInferenceHealth } = useQuery({
    queryKey: ['radio-caption-inference-health'],
    queryFn: checkInferenceHealth,
    enabled: radioFeatureFlags.captionsEnabled,
    refetchInterval: 30000,
    staleTime: 15000,
  })

  useEffect(() => {
    if (!radioFeatureFlags.captionsEnabled) return
    const unsub = radioCaptionService.subscribe((seg) => {
      setLastCaptionAtMs(Date.now())
      setLiveCaptions((prev) => {
        const idx = prev.findIndex(
          (s) => s.transmissionId === seg.transmissionId && s.sequenceNum === seg.sequenceNum,
        )
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = seg
          return next
        }
        return [...prev, seg].slice(-50)
      })
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!radioFeatureFlags.captionsEnabled || typeof window === 'undefined') return

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CaptionSegment>).detail
      if (!detail?.transmissionId || typeof detail.sequenceNum !== 'number') return
      radioCaptionService.emit(detail)
    }

    window.addEventListener('radio:inject-caption', handler as EventListener)
    return () => {
      window.removeEventListener('radio:inject-caption', handler as EventListener)
    }
  }, [])

  useEffect(() => {
    if (!radioFeatureFlags.translationEnabled) return
    const unsub = radioTranslationService.subscribe((seg) => {
      setLiveTranslations((prev) => {
        const idx = prev.findIndex(
          (s) => s.transcriptSegmentId === seg.transcriptSegmentId && s.targetLanguage === seg.targetLanguage,
        )
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = seg
          return next
        }
        return [...prev, seg].slice(-50)
      })
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!radioFeatureFlags.translationEnabled || typeof window === 'undefined') return

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TranslationSegment>).detail
      if (!detail?.transcriptSegmentId || !detail?.targetLanguage) return
      radioTranslationService.emit(detail)
    }

    window.addEventListener('radio:inject-translation', handler as EventListener)
    return () => {
      window.removeEventListener('radio:inject-translation', handler as EventListener)
    }
  }, [])

  useEffect(() => {
    if (!radioFeatureFlags.syntheticAudioEnabled || typeof window === 'undefined') return

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SyntheticAudioRender>).detail
      if (!detail?.translationSegmentId || !detail?.targetLanguage) return
      setSyntheticRenders((prev) => {
        const idx = prev.findIndex(
          (r) => r.translationSegmentId === detail.translationSegmentId && r.targetLanguage === detail.targetLanguage,
        )
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = detail
          return next
        }
        return [...prev, detail].slice(-60)
      })
    }

    window.addEventListener('radio:inject-tts-render', handler as EventListener)
    return () => {
      window.removeEventListener('radio:inject-tts-render', handler as EventListener)
    }
  }, [])

  const captionPipeline = captionInferenceHealth?.radioPipeline
  const captionProcessorEnabled = captionPipeline?.processor_enabled === true
  const captionUnavailableReason = captionInferenceHealth?.status === 'offline'
    ? captionInferenceHealth.error || 'Inference service offline'
    : captionPipeline && captionPipeline.processor_enabled === false
      ? 'Speech processor is disabled on inference service'
      : null
  const captionsUnavailable = Boolean(captionUnavailableReason)
  const remoteTransmissionActive = Boolean(speakerId && !isSpeaking)
  const recentCaptions = useMemo(() => liveCaptions.slice(-8), [liveCaptions])
  const recentTranslations = useMemo(() => liveTranslations.slice(-6), [liveTranslations])
  const recentSyntheticRenders = useMemo(
    () => syntheticRenders.filter((r) => r.targetLanguage === interpreterTargetLanguage).slice(-6),
    [interpreterTargetLanguage, syntheticRenders],
  )
  const lowConfidenceCaptionCount = useMemo(
    () => recentCaptions.filter((seg) => isLowConfidenceCaption(seg)).length,
    [recentCaptions],
  )
  const lowConfidenceTranslationCount = useMemo(
    () => recentTranslations.filter((seg) => seg.isLowConfidence).length,
    [recentTranslations],
  )
  const delayedSyntheticRenderCount = useMemo(
    () => recentSyntheticRenders.filter((render) => (render.renderLatencyMs ?? 0) > SYNTHETIC_RELAY_DELAY_THRESHOLD_MS).length,
    [recentSyntheticRenders],
  )

  useEffect(() => {
    if (!radioFeatureFlags.captionsEnabled) return
    if (remoteTransmissionActive) {
      remoteTransmissionStartedAtRef.current = Date.now()
      return
    }
    remoteTransmissionStartedAtRef.current = null
    setCaptionsDelayed(false)
  }, [remoteTransmissionActive])

  useEffect(() => {
    if (!radioFeatureFlags.captionsEnabled) return
    if (captionsUnavailable || !captionProcessorEnabled) {
      setCaptionsDelayed(false)
      return
    }

    const iv = setInterval(() => {
      if (!remoteTransmissionActive) {
        setCaptionsDelayed(false)
        return
      }

      const reference = Math.max(lastCaptionAtMs || 0, remoteTransmissionStartedAtRef.current || 0)
      if (!reference) {
        setCaptionsDelayed(false)
        return
      }

      setCaptionsDelayed(Date.now() - reference > CAPTION_DELAY_THRESHOLD_MS)
    }, 1000)

    return () => clearInterval(iv)
  }, [captionProcessorEnabled, captionsUnavailable, lastCaptionAtMs, remoteTransmissionActive])

  // ── Org ID ────────────────────────────────────────────────

  const effectiveOrgId = useMemo(
    () =>
      user?.role === 'master' || user?.role === 'grand_master'
        ? organizationId || user?.organization_id || null
        : user?.organization_id || null,
    [organizationId, user?.organization_id, user?.role],
  )
  const homeOrganizationId = user?.organization_id || effectiveOrgId || null
  const employerOrganizationId = user?.employer_organization_id || null
  const providerOrgId = employerOrganizationId || homeOrganizationId || null

  useEffect(() => {
    if (!radioFeatureFlags.translationEnabled) return
    radioTranslationService.setTargetLanguage(interpreterTargetLanguage)
  }, [interpreterTargetLanguage])

  useEffect(() => {
    if (!radioFeatureFlags.captionsEnabled || !effectiveOrgId) return

    const toCaptionSegment = (row: any): CaptionSegment | null => {
      if (!row?.transmission_id || typeof row.sequence_num !== 'number') return null
      return {
        transmissionId: String(row.transmission_id),
        sequenceNum: Number(row.sequence_num),
        segmentStartMs: Number(row.segment_start_ms || 0),
        segmentEndMs: Number(row.segment_end_ms || 0),
        text: String(row.text || ''),
        language: String(row.language || 'en'),
        confidence: row.confidence == null ? 1 : Number(row.confidence),
        isFinal: Boolean(row.is_final),
      }
    }

    const channel = supabase
      .channel(`radio-captions-${effectiveOrgId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'radio_transcript_segments',
          filter: `org_id=eq.${effectiveOrgId}`,
        },
        (payload: any) => {
          const seg = toCaptionSegment(payload?.new)
          if (!seg) return
          radioCaptionService.emit(seg)
        },
      )
      .subscribe()

    // Catch-up fetch so clients joining mid-transmission can render recent segments.
    const sinceIso = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    void (supabase as any)
      .from('radio_transcript_segments')
      .select('transmission_id, sequence_num, segment_start_ms, segment_end_ms, text, language, confidence, is_final, created_at')
      .eq('org_id', effectiveOrgId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(40)
      .then(({ data, error }: any) => {
        if (error || !Array.isArray(data)) return
        for (const row of data) {
          const seg = toCaptionSegment(row)
          if (seg) radioCaptionService.emit(seg)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [effectiveOrgId])

  useEffect(() => {
    if (!radioFeatureFlags.translationEnabled || !effectiveOrgId || !interpreterTargetLanguage) return

    const toTranslationSegment = (row: any): TranslationSegment | null => {
      if (!row?.transcript_segment_id || !row?.target_language) return null
      const confidence = row.confidence == null ? 1 : Number(row.confidence)
      return {
        transcriptSegmentId: String(row.transcript_segment_id),
        targetLanguage: String(row.target_language),
        text: String(row.text || ''),
        confidence,
        provider: String(row.provider || 'unknown'),
        isLowConfidence: typeof row.is_low_confidence === 'boolean' ? row.is_low_confidence : confidence < 0.7,
      }
    }

    const channel = supabase
      .channel(`radio-translations-${effectiveOrgId}-${interpreterTargetLanguage}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'radio_translation_segments',
          filter: `org_id=eq.${effectiveOrgId}`,
        },
        (payload: any) => {
          const seg = toTranslationSegment(payload?.new)
          if (!seg) return
          if (seg.targetLanguage !== interpreterTargetLanguage) return
          radioTranslationService.emit(seg)
        },
      )
      .subscribe()

    const sinceIso = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    void (supabase as any)
      .from('radio_translation_segments')
      .select('transcript_segment_id, target_language, text, confidence, provider, is_low_confidence, created_at')
      .eq('org_id', effectiveOrgId)
      .eq('target_language', interpreterTargetLanguage)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(40)
      .then(({ data, error }: any) => {
        if (error || !Array.isArray(data)) return
        for (const row of data) {
          const seg = toTranslationSegment(row)
          if (seg) radioTranslationService.emit(seg)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [effectiveOrgId, interpreterTargetLanguage])

  useEffect(() => {
    if (!radioFeatureFlags.syntheticAudioEnabled || !effectiveOrgId || !interpreterTargetLanguage) return

    const toSyntheticRender = (row: any): SyntheticAudioRender | null => {
      if (!row?.translation_segment_id || !row?.target_language) return null
      return {
        translationSegmentId: String(row.translation_segment_id),
        targetLanguage: String(row.target_language),
        provider: String(row.provider || 'unknown'),
        isSynthetic: row.is_synthetic !== false,
        renderLatencyMs: Number.isFinite(Number(row.render_latency_ms)) ? Number(row.render_latency_ms) : null,
        durationMs: Number.isFinite(Number(row.duration_ms)) ? Number(row.duration_ms) : null,
        storagePath: row.storage_path ? String(row.storage_path) : null,
      }
    }

    const upsertRender = (render: SyntheticAudioRender) => {
      setSyntheticRenders((prev) => {
        const idx = prev.findIndex(
          (r) => r.translationSegmentId === render.translationSegmentId && r.targetLanguage === render.targetLanguage,
        )
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = render
          return next
        }
        return [...prev, render].slice(-60)
      })
    }

    const channel = supabase
      .channel(`radio-synthetic-renders-${effectiveOrgId}-${interpreterTargetLanguage}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'radio_tts_renders',
          filter: `org_id=eq.${effectiveOrgId}`,
        },
        (payload: any) => {
          const render = toSyntheticRender(payload?.new)
          if (!render) return
          if (render.targetLanguage !== interpreterTargetLanguage) return
          upsertRender(render)
        },
      )
      .subscribe()

    const sinceIso = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    void (supabase as any)
      .from('radio_tts_renders')
      .select('translation_segment_id, target_language, provider, is_synthetic, render_latency_ms, duration_ms, storage_path, created_at')
      .eq('org_id', effectiveOrgId)
      .eq('target_language', interpreterTargetLanguage)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(40)
      .then(({ data, error }: any) => {
        if (error || !Array.isArray(data)) return
        for (const row of data) {
          const render = toSyntheticRender(row)
          if (render) upsertRender(render)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [effectiveOrgId, interpreterTargetLanguage])

  const { data: hybridHandshake } = useHybridWorkspaceHandshake({
    providerOrgId,
    longitude: handoffGeoPoint?.longitude,
    latitude: handoffGeoPoint?.latitude,
    preferredClientOrgId: organizationId || null,
    userId: user?.id,
    defaultTranslationLang: interpreterTargetLanguage,
    enabled: !!user,
  })

  const translationRailAvailable = hybridHandshake?.handshake_active === true
  const translatorWorkspaceId = hybridHandshake?.workspace_id || null
  const translatorClientOrgId = hybridHandshake?.client_org_id || null
  const translatorTargetLanguage = hybridHandshake?.target_translation_language || interpreterTargetLanguage
  const translatorAuthorizedOrgIds = useMemo(() => {
    const ids = new Set<string>()
    if (homeOrganizationId) ids.add(homeOrganizationId)
    if (employerOrganizationId) ids.add(employerOrganizationId)
    for (const id of user?.authorized_work_locations || []) {
      if (id) ids.add(id)
    }
    for (const id of user?.extra_organization_ids || []) {
      if (id) ids.add(id)
    }
    return Array.from(ids)
  }, [employerOrganizationId, homeOrganizationId, user?.authorized_work_locations, user?.extra_organization_ids])
  const { connectionState: translatorConnectionState, sendAudioChunk, hasEndpoint: translatorHasEndpoint } = useBobTranslator({
    workspaceId: translatorWorkspaceId,
    enabled: translationRailEnabled && !!providerOrgId,
    targetLanguage: translatorTargetLanguage,
    providerOrgId,
    clientOrgId: translatorClientOrgId,
    officerId: user?.id || null,
    employerOrgId: employerOrganizationId,
    authorizedOrganizations: translatorAuthorizedOrgIds,
  })
  const translatorStatusLabel = !translationRailEnabled
    ? 'Bob Ear STANDBY'
    : !translatorHasEndpoint
      ? 'Bob Ear NO ENDPOINT'
      : translatorConnectionState === 'closed'
        ? 'Bob Ear STANDBY'
        : `Bob Ear ${translatorConnectionState.toUpperCase()}`
  const streamModeLabel = pttStreamMode === 'diplomatic' ? 'Diplomatic Route' : 'Tactical Route'
  const isDiplomaticMode = pttStreamMode === 'diplomatic'

  const translationRailSubtitle = translationRailAvailable
    ? `${hybridHandshake?.workspace_name || 'Client Workspace'} • ${hybridHandshake?.translation_active ? 'Translation Available' : 'Translation Ready'} • ${streamModeLabel}`
    : handoffGpsUnavailable
      ? 'GPS unavailable • translator standby'
      : 'Provider tactical mode'

  const translatorRestUrl = useMemo(
    () => deriveTranslatorRestUrlFromWs(import.meta.env.VITE_BOB_TRANSLATOR_WS_URL || ''),
    [],
  )

  const crossOrgIds = useMemo(() => {
    const ids = new Set<string>()
    const excluded = new Set<string>([homeOrganizationId || ''])

    if (employerOrganizationId && employerOrganizationId !== homeOrganizationId) {
      ids.add(employerOrganizationId)
      excluded.add(employerOrganizationId)
    }

    for (const id of user?.authorized_work_locations || []) {
      if (id && !excluded.has(id)) ids.add(id)
    }

    for (const id of user?.extra_organization_ids || []) {
      if (id && !excluded.has(id)) ids.add(id)
    }

    return Array.from(ids)
  }, [employerOrganizationId, homeOrganizationId, user?.authorized_work_locations, user?.extra_organization_ids])
  const crossOrgQueryIds = useMemo(
    () => (crossOrgIds.length ? [...crossOrgIds].sort() : []),
    [crossOrgIds],
  )
  const shouldEnforceChannelAcl = user?.role === 'officer' || user?.role === 'admin_officer'

  const canAccessChannel = useCallback((channel: RadioChannel) => {
    return canAccessPTTChannel({
      channel,
      effectiveOrgId,
      userRole: shouldEnforceChannelAcl ? user?.role : null,
      allowedChannelScopes: user?.ptt_channel_access ?? null,
      getScope: getChannelScope,
    })
  }, [effectiveOrgId, shouldEnforceChannelAcl, user?.ptt_channel_access, user?.role])

  // ── Load channels from DB ─────────────────────────────────
  const { data: dbChannels, isLoading: loadingChannels, error: channelsError } = useQuery<RadioChannel[]>({
    queryKey: ['ptt-channels', effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return []
      const { data, error } = await (supabase as any)
        .from('ptt_channels')
        .select('*')
        .eq('organization_id', effectiveOrgId)
        .eq('is_active', true)
        .order('channel_number', { ascending: true })
      if (error) {
        // Graceful fallback when PTT schema is not yet present in an environment.
        if (error.code === 'PGRST205' || error.code === '42P01') return []
        throw error
      }
      if (!data?.length) {
        // No persisted channels yet in this environment; keep radio usable with in-memory defaults.
        const { data: seeded } = await (supabase as any)
          .from('ptt_channels')
          .select('*')
          .eq('organization_id', effectiveOrgId)
          .eq('is_active', true)
          .order('channel_number', { ascending: true })
        return (seeded || []) as RadioChannel[]
      }
      return (data || []) as RadioChannel[]
    },
    enabled: !!effectiveOrgId,
    staleTime: 60_000,
    retry: false,
  })

  const { data: crossOrgMetadata = [] } = useQuery<OrganizationSummary[]>({
    queryKey: ['ptt-cross-org-metadata', crossOrgQueryIds.join(',')],
    queryFn: async () => {
      if (!crossOrgQueryIds.length) return []
      const { data, error } = await (supabase as any)
        .from('organizations')
        .select('id, name')
        .in('id', crossOrgQueryIds)

      if (error) throw error
      return (data || []) as OrganizationSummary[]
    },
    enabled: crossOrgQueryIds.length > 0,
    staleTime: 60_000,
  })

  const crossOrgMap = useMemo(() => {
    const map = new Map<string, OrganizationSummary>()
    for (const org of crossOrgMetadata) {
      map.set(org.id, org)
    }
    return map
  }, [crossOrgMetadata])

  const crossOrgChannels = useMemo(() => {
    const scopedChannels: RadioChannel[] = []

    if (employerOrganizationId && employerOrganizationId !== homeOrganizationId) {
      const employerName = crossOrgMap.get(employerOrganizationId)?.name || 'Employer'
      scopedChannels.push({
        id: `employer-dispatch-${employerOrganizationId}`,
        channel_number: 80,
        badge_label: 'DSP',
        name: `${employerName} Dispatch`,
        channel_type: 'cross_org',
        color: '#0ea5e9',
        is_priority: true,
        description: `Employer-wide dispatcher channel for all ${employerName} operations staff.`,
        is_active: true,
        scope_override: `org:${employerOrganizationId}`,
        scope_label: `${employerName} Dispatch Net`,
      })
      scopedChannels.push({
        id: `employer-scope-${employerOrganizationId}`,
        channel_number: 81,
        badge_label: 'EMP',
        name: `${employerName} Global`,
        channel_type: 'cross_org',
        color: '#f59e0b',
        is_priority: false,
        description: `Employer-wide channel for all staff in ${employerName}.`,
        is_active: true,
        scope_override: `org:${employerOrganizationId}`,
        scope_label: employerName,
      })
    }

    const authorizedIds = crossOrgIds.filter((id) => id !== employerOrganizationId)
    authorizedIds.forEach((orgId, index) => {
      const orgName = crossOrgMap.get(orgId)?.name || `Authorized Org ${index + 1}`
      scopedChannels.push({
        id: `authorized-scope-${orgId}`,
        channel_number: 82 + index,
        badge_label: 'ORG',
        name: `${orgName} Channel`,
        channel_type: 'cross_org',
        color: '#14b8a6',
        is_priority: false,
        description: `Switch to the authorized ${orgName} organization radio channel.`,
        is_active: true,
        scope_override: `org:${orgId}`,
        scope_label: orgName,
      })
    })

    return scopedChannels
  }, [crossOrgIds, crossOrgMap, employerOrganizationId, homeOrganizationId])

  const launchChannels = useMemo(() => {
    if (radioMode !== 'direct' || !radioTargetUserId) return [] as RadioChannel[]

    return [
      {
        id: `direct-launch-${radioTargetUserId}`,
        channel_number: 90,
        badge_label: 'DIR',
        name: radioTargetName ? `Direct: ${radioTargetName}` : 'Direct Call',
        channel_type: 'direct',
        color: '#e11d48',
        is_priority: true,
        description: radioTargetName
          ? `Private dispatcher call with ${radioTargetName}.`
          : 'Private dispatcher direct call.',
        is_active: true,
        scope_override: `direct:${radioTargetUserId}`,
        scope_label: 'Direct Call',
      },
    ]
  }, [radioMode, radioTargetName, radioTargetUserId])

  const baseChannels = useMemo(() => {
    const source = dbChannels?.length ? dbChannels : DEFAULT_CHANNELS
    return [...source]
      .filter((channel) => canAccessChannel(channel))
      .sort(
        (a, b) =>
          (CHANNEL_TYPE_ORDER[a.channel_type] ?? 50) - (CHANNEL_TYPE_ORDER[b.channel_type] ?? 50) ||
          a.channel_number - b.channel_number,
      )
  }, [canAccessChannel, dbChannels])

  const visibleCrossOrgChannels = useMemo(
    () => crossOrgChannels.filter((channel) => canAccessChannel(channel)),
    [canAccessChannel, crossOrgChannels],
  )

  const visibleLaunchChannels = useMemo(
    () => launchChannels.filter((channel) => canAccessChannel(channel)),
    [canAccessChannel, launchChannels],
  )

  const channels = useMemo(
    () => [...visibleLaunchChannels, ...visibleCrossOrgChannels, ...baseChannels],
    [visibleLaunchChannels, visibleCrossOrgChannels, baseChannels],
  )

  // ── Load recent transmission log from DB ──────────────────
  const { data: dbTxLog = [] } = useQuery<TransmissionEntry[]>({
    queryKey: ['ptt-tx-log', effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return []
      if (txLogUnavailableRef.current) return []
      const { data, error } = await (supabase as any)
        .from('ptt_transmission_log')
        .select('*')
        .eq('organization_id', effectiveOrgId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) {
        // Treat missing optional audit table as empty log for compatibility.
        if (error.code === 'PGRST205' || error.code === '42P01') {
          txLogUnavailableRef.current = true
          return []
        }
        throw error
      }
      return ((data || []) as any[]).map((r) => ({
        id: r.id,
        callsign: r.speaker_callsign || r.speaker_name || 'Unknown',
        name: r.speaker_name || 'Unknown',
        channelName: r.channel_name,
        channelNumber: r.channel_number,
        durationSeconds: parseFloat(r.duration_seconds ?? '0'),
        createdAt: r.created_at,
        clipUrl: r.clip_url ?? null,
        transcript: r.transcript ?? null,
        isEmergency: r.is_emergency ?? false,
        isLive: false,
      }))
    },
    enabled: !!effectiveOrgId,
    staleTime: 30_000,
    refetchInterval: txLogUnavailableRef.current ? false : 15_000,
    retry: false,
  })

  // Merge DB log with in-memory log (local transmissions appear immediately)
  const allTxLog = useMemo(() => {
    const merged = [...txLog, ...dbTxLog]
    const seen = new Set<string>()
    return merged
      .filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return true })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 60)
  }, [txLog, dbTxLog])

  const cooldownSecondsRemaining = Math.max(0, Math.ceil((connectCooldownUntil - Date.now()) / 1000))
  const isConnectCoolingDown = cooldownSecondsRemaining > 0
  const connectCooldownLabel = retryCountdownSeconds ?? cooldownSecondsRemaining

  const rosterWithSelf = useMemo(() => {
    const base = [...presence]
    if (!user?.id) return base

    const selfName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email || 'You'
    const selfRole = user.role || 'officer'
    const selfStatus = isSpeaking ? 'busy' : 'online'

    const withoutSelf = base.filter((p) => p.userId !== user.id)
    return [{ userId: user.id, name: selfName, role: selfRole, status: selfStatus }, ...withoutSelf]
  }, [presence, user?.id, user?.first_name, user?.last_name, user?.email, user?.role, isSpeaking])

  const renderChannelBadge = useCallback((channel: RadioChannel) => {
    if (channel.channel_type === 'emergency') return '🚨'
    return channel.badge_label || channel.channel_number
  }, [])

  const handleForceDisconnect = useCallback(async (targetUserId: string, targetName: string) => {
    if (!hasPttSupervisorControls) {
      toast.error('Only Master and Grand Master profiles can force disconnect PTT sessions.')
      return
    }
    if (!targetUserId || targetUserId === user?.id) {
      return
    }

    setDisconnectingUserId(targetUserId)
    try {
      const { error: disconnectError } = await edgeFunctions.disconnectUserPtt({ user_id: targetUserId })
      if (disconnectError) throw new Error(String(disconnectError))
      toast.success(`Disconnect requested for ${targetName || 'selected unit'}.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to disconnect ${targetName || 'unit'}: ${message}`)
    } finally {
      setDisconnectingUserId(null)
    }
  }, [hasPttSupervisorControls, user?.id])

  // ─────────────────────────────────────────────────────────
  // Channel connection callbacks (before effects that use them)
  // ─────────────────────────────────────────────────────────

  const connectToChannel = useCallback(
    async (channel: RadioChannel, options?: { autoRetry?: boolean }) => {
      if (!effectiveOrgId) return

      const requestedScope = getChannelScope(channel, effectiveOrgId)
      if (connectionStatus === 'connected' && channelId === requestedScope) {
        setActiveChannel(channel)
        return
      }

      const now = Date.now()
      const circuitRemainingMs = connectCircuitOpenUntilRef.current - now
      if (circuitRemainingMs > 0) {
        const remainingSeconds = Math.max(1, Math.ceil(circuitRemainingMs / 1000))
        const message = `Push to Talk reconnect protection is active. Retrying in ${remainingSeconds}s…`
        setError(message)
        setRetryCountdownSeconds(remainingSeconds)
        if (!options?.autoRetry && now - lastConnectCircuitToastAtRef.current > 2500) {
          lastConnectCircuitToastAtRef.current = now
          toast.warning(message)
        }
        return
      }

      const minGapMs = options?.autoRetry ? AUTO_RETRY_MIN_GAP_MS : MANUAL_CONNECT_MIN_GAP_MS
      if (now - lastConnectAttemptAtRef.current < minGapMs) {
        return
      }

      if (connectInFlightRef.current) {
        return
      }

      const attemptWindowStart = now - CONNECT_STORM_WINDOW_MS
      const recentAttempts = connectAttemptTimestampsRef.current.filter((ts) => ts >= attemptWindowStart)
      recentAttempts.push(now)
      connectAttemptTimestampsRef.current = recentAttempts
      lastConnectAttemptAtRef.current = now

      if (recentAttempts.length > CONNECT_STORM_MAX_ATTEMPTS && connectionStatus !== 'connected') {
        connectCircuitOpenUntilRef.current = now + CONNECT_STORM_COOLDOWN_MS
        const cooldownSeconds = Math.ceil(CONNECT_STORM_COOLDOWN_MS / 1000)
        const message = `Push to Talk is reconnecting too frequently. Pausing retries for ${cooldownSeconds}s.`
        setError(message)
        setRetryCountdownSeconds(cooldownSeconds)
        if (!options?.autoRetry) {
          toast.warning(message)
        }
        return
      }

      if (!options?.autoRetry && (isConnecting || isConnectCoolingDown || retryCountdownSeconds !== null)) {
        return
      }

      connectInFlightRef.current = true
      setIsConnecting(true)
      setError(null)
      setConnectCooldownUntil(Date.now() + CONNECT_ACTION_COOLDOWN_MS)

      const channelScope = getChannelScope(channel, effectiveOrgId)

      try {
        await connectToPTT(channelScope, channel.name)
        setActiveChannel(channel)
        setRetryCountdownSeconds(null)
        pendingRetryChannelRef.current = null
        connectAttemptTimestampsRef.current = []
        connectCircuitOpenUntilRef.current = 0
        if (connectRetryTimeoutRef.current) {
          clearTimeout(connectRetryTimeoutRef.current)
          connectRetryTimeoutRef.current = null
        }
      } catch (err) {
        const retryAfterSeconds = extractPTTRetryAfterSeconds(err)
        if (retryAfterSeconds) {
          const retryMsg = `Push to Talk is reconnecting. Retrying in ${retryAfterSeconds}s…`
          setError(retryMsg)
          setRetryCountdownSeconds(retryAfterSeconds)
          pendingRetryChannelRef.current = channel

          if (connectRetryTimeoutRef.current) clearTimeout(connectRetryTimeoutRef.current)
          connectRetryTimeoutRef.current = setTimeout(() => {
            connectRetryTimeoutRef.current = null
            const pendingChannel = pendingRetryChannelRef.current
            pendingRetryChannelRef.current = null
            setRetryCountdownSeconds(null)
            if (pendingChannel) void connectToChannel(pendingChannel, { autoRetry: true })
          }, retryAfterSeconds * 1000)

          if (!options?.autoRetry) {
            toast.warning(`PTT rate limited. Retrying in ${retryAfterSeconds}s.`)
          }
          return
        }

        const msg = normalizePTTErrorMessage(err)
        setError(msg)
        if (!options?.autoRetry) {
          toast.error(msg)
        }
      } finally {
        connectInFlightRef.current = false
        setIsConnecting(false)
      }
    },
    [channelId, connectionStatus, effectiveOrgId, isConnectCoolingDown, isConnecting, retryCountdownSeconds, setError],
  )

  useEffect(() => {
    if (connectionStatus !== 'connected') return
    connectAttemptTimestampsRef.current = []
    connectCircuitOpenUntilRef.current = 0
  }, [connectionStatus])

  const handleChannelSelect = useCallback(
    (channel: RadioChannel) => {
      if (isTransmitting || isConnecting || isConnectCoolingDown || retryCountdownSeconds !== null) return // don't switch while transmitting/cooldown
      setScanMode(false)
      if (connectDebounceRef.current) clearTimeout(connectDebounceRef.current)
      connectDebounceRef.current = setTimeout(() => {
        connectDebounceRef.current = null
        void connectToChannel(channel)
      }, CHANNEL_SWITCH_DEBOUNCE_MS)
    },
    [isTransmitting, isConnecting, isConnectCoolingDown, retryCountdownSeconds, connectToChannel],
  )

  useEffect(() => {
    if (retryCountdownSeconds === null || retryCountdownSeconds <= 0) return
    const timer = setTimeout(() => {
      setRetryCountdownSeconds((prev) => (prev && prev > 1 ? prev - 1 : null))
    }, 1000)
    return () => clearTimeout(timer)
  }, [retryCountdownSeconds])

  useEffect(() => {
    if (!activeChannel || connectionStatus === 'connected') {
      setConnectionWarningArmed(false)
      return
    }

    const timer = setTimeout(() => {
      setConnectionWarningArmed(true)
    }, CONNECTION_WARNING_TIMEOUT_MS)

    return () => clearTimeout(timer)
  }, [activeChannel, connectionStatus])

  useEffect(() => {
    return () => {
      if (connectDebounceRef.current) clearTimeout(connectDebounceRef.current)
      if (connectRetryTimeoutRef.current) clearTimeout(connectRetryTimeoutRef.current)
    }
  }, [])

  // ── Load user callsign ────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return

    const fallbackCallsign = (firstName?: string | null, lastName?: string | null) =>
      `${firstName?.[0] ?? ''}${lastName?.toUpperCase().slice(0, 4) ?? 'UNIT'}`

    ;(async () => {
      const withCallsign = await (supabase as any)
        .from('user_profiles')
        .select('callsign, first_name, last_name')
        .eq('id', user.id)
        .single()

      if (!withCallsign.error && withCallsign.data) {
        const data = withCallsign.data as any
        setCallsign(data.callsign || fallbackCallsign(data.first_name, data.last_name))
        return
      }

      // Compatibility path for environments where callsign column has not been applied yet.
      const noCallsign = await (supabase as any)
        .from('user_profiles')
        .select('first_name, last_name')
        .eq('id', user.id)
        .single()

      if (!noCallsign.error && noCallsign.data) {
        const data = noCallsign.data as any
        setCallsign(fallbackCallsign(data.first_name, data.last_name))
      }
    })()
  }, [user?.id])

  // ── Auto-connect to Channel 1 on initial load ────────────
  useEffect(() => {
    if (!effectiveOrgId || channels.length === 0) return
    if (initialConnectRef.current) return // Already attempted initial connect

    const directLaunch =
      radioMode === 'direct'
        ? channels.find((c) => c.id === `direct-launch-${radioTargetUserId}`)
        : null

    const dispatcherDefault =
      radioMode === 'dispatch'
        ? channels.find((c) => c.id.startsWith('employer-dispatch-')) ??
          channels.find((c) => c.id.startsWith('employer-scope-'))
        : null

    // Prioritize dispatcher employer net when requested; otherwise fall back
    // to the local branch primary channel so operators land in a real net.
    const channel1 = directLaunch ??
                     dispatcherDefault ??
                     channels.find((c) => c.channel_number === 1) ??
                     channels.find((c) => c.channel_type === 'primary') ??
                     channels[0]
    
    if (channel1) {
      setActiveChannel(channel1)
      if (radioMode === 'dispatch' || radioMode === 'direct') {
        void connectToChannel(channel1)
      }
      initialConnectRef.current = true
    }
  }, [connectToChannel, effectiveOrgId, channels, radioMode, radioTargetUserId])

  // ── Notification permission prompt ───────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (Notification.permission === 'default') setShowNotificationHint(true)
    requestNotificationPermission()
  }, [])

  // ── Hybrid handshake geolocation polling ─────────────────
  useEffect(() => {
    if (!user || !navigator?.geolocation) {
      setHandoffGpsUnavailable(true)
      return
    }

    let cancelled = false

    const pollGeo = async () => {
      if (handoffGeoPollInFlightRef.current) return
      handoffGeoPollInFlightRef.current = true
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10_000,
            maximumAge: 20_000,
          })
        })

        if (!cancelled) {
          setHandoffGpsUnavailable(false)
          setHandoffGeoPoint({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          })
        }
      } catch {
        if (!cancelled) {
          setHandoffGpsUnavailable(true)
        }
      } finally {
        handoffGeoPollInFlightRef.current = false
      }
    }

    void pollGeo()
    const interval = setInterval(() => void pollGeo(), 30_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [user])

  useEffect(() => {
    if (!providerOrgId && translationRailEnabled) {
      setTranslationRailEnabled(false)
    }
    if (providerOrgId && !translationRailEnabled) {
      setTranslationRailEnabled(true)
    }
  }, [providerOrgId, translationRailEnabled])

  useEffect(() => {
    if (!providerOrgId) {
      setPttStreamMode('tactical')
      return
    }

    let cancelled = false

    edgeFunctions.pttMultiplexContext({
      provider_org_id: providerOrgId,
      client_org_id: hybridHandshake?.client_org_id || null,
      branch_id: hybridHandshake?.branch_id || null,
    })
      .then((result: any) => {
        if (cancelled) return
        const stream = String(result?.data?.stream || '').toLowerCase()
        setPttStreamMode(stream === 'diplomatic' ? 'diplomatic' : 'tactical')
      })
      .catch(() => {
        if (!cancelled) setPttStreamMode('tactical')
      })

    return () => {
      cancelled = true
    }
  }, [providerOrgId, hybridHandshake?.client_org_id, hybridHandshake?.branch_id])

  const requestMicrophoneAccess = useCallback(async () => {
    try {
      await ensureMicrophonePermission()
      setMicrophoneReady(true)
      setMicrophoneError(null)
      toast.success('Microphone access enabled')
    } catch (err: any) {
      const msg = normalizePTTErrorMessage(err)
      setMicrophoneReady(false)
      setMicrophoneError(msg)
      toast.error(msg)
    }
  }, [])

  const primeAudioOutput = useCallback(async (silent = false) => {
    if (isPrimingAudio || audioPrimed) return
    setIsPrimingAudio(true)
    try {
      const primed = await primePTTRemoteAudioPlayback()
      if (primed) {
        setAudioPrimed(true)
        if (!silent) {
          toast.success('Audio output primed for live radio playback')
        }
      }
    } catch {
      if (!silent) {
        toast.warning('Tap and hold Push to Talk once to unlock mobile audio playback')
      }
    } finally {
      setIsPrimingAudio(false)
    }
  }, [audioPrimed, isPrimingAudio])

  // Auto-prime remote audio on the first user interaction so mobile devices
  // do not require a dedicated "Prime" action before incoming playback works.
  useEffect(() => {
    if (audioPrimed) return

    let priming = false

    const attemptPrime = () => {
      if (priming || audioPrimed) return
      priming = true
      void primeAudioOutput(true).finally(() => {
        priming = false
      })
    }

    window.addEventListener('pointerdown', attemptPrime, { passive: true })
    window.addEventListener('keydown', attemptPrime)

    return () => {
      window.removeEventListener('pointerdown', attemptPrime)
      window.removeEventListener('keydown', attemptPrime)
    }
  }, [audioPrimed, primeAudioOutput])

  // ── Incoming transmission detection ──────────────────────
  useEffect(() => {
    if (speakerId && !isSpeaking) {
      // Someone else is transmitting
      const name = speakerName || 'Unknown'
      const ch = activeChannel?.name ?? 'Channel'
      // Log it locally
      const entry: TransmissionEntry = {
        id: `live-${Date.now()}`,
        callsign: name,
        name,
        channelName: ch,
        channelNumber: activeChannel?.channel_number ?? 0,
        durationSeconds: 0,
        createdAt: new Date().toISOString(),
        isEmergency: emergencyMode,
        isLive: true,
      }
      setTxLog((prev) => [entry, ...prev].slice(0, 60))
    }
  }, [speakerId, isSpeaking, speakerName, activeChannel?.name, activeChannel?.channel_number, emergencyMode])

  // ── Live TX timer ─────────────────────────────────────────
  useEffect(() => {
    if (isTransmitting) {
      setCurrentTxStart(new Date())
      setLiveTxSeconds(0)
      liveTxTimerRef.current = setInterval(() => {
        setLiveTxSeconds((s) => s + 1)
      }, 1000)
    } else {
      if (liveTxTimerRef.current) { clearInterval(liveTxTimerRef.current); liveTxTimerRef.current = null }
      setCurrentTxStart(null)
      setLiveTxSeconds(0)
    }
    return () => { if (liveTxTimerRef.current) clearInterval(liveTxTimerRef.current) }
  }, [isTransmitting])

  // ── VOX monitoring ────────────────────────────────────────
  useEffect(() => {
    if (voxEnabled && isAvailable) {
      startVoxMonitoring()
    } else {
      stopVoxMonitoring()
    }
    return () => stopVoxMonitoring()
  }, [voxEnabled, isAvailable])

  // ── Scanner mode ─────────────────────────────────────────
  useEffect(() => {
    if (!scanMode) {
      if (scanTimerRef.current) { clearInterval(scanTimerRef.current); scanTimerRef.current = null }
      return
    }
    const nonEmergency = channels.filter((c) => c.channel_type !== 'emergency' && c.channel_type !== 'cross_org')
    if (!nonEmergency.length) return

    scanTimerRef.current = setInterval(async () => {
      // Pause scan if someone is transmitting
      if (speakerId) return
      setScanIndex((prev) => {
        const next = (prev + 1) % nonEmergency.length
        const ch = nonEmergency[next]
        if (ch) {
          setActiveChannel(ch)
          connectToChannel(ch)
        }
        return next
      })
    }, scanDwellMs)

    return () => { if (scanTimerRef.current) clearInterval(scanTimerRef.current) }
  }, [scanMode, channels, speakerId, connectToChannel, scanDwellMs])

  // ── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setInterpreterPrefsHydrated(false)

    const hydrateInterpreterPrefs = async () => {
      let nextTargetLanguage = 'en-NZ'

      try {
        const raw = localStorage.getItem(TEAM_CHAT_TRANSLATION_PREF_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (typeof parsed?.targetLanguage === 'string' && parsed.targetLanguage.trim()) {
            nextTargetLanguage = parsed.targetLanguage.trim()
          }
        }
      } catch {
        // Ignore malformed preference payloads.
      }

      if (!cancelled) setInterpreterTargetLanguage(nextTargetLanguage)

      if (!user?.id) {
        if (!cancelled) setInterpreterPrefsHydrated(true)
        return
      }

      const { data, error } = await (supabase.from('user_profiles') as any)
        .select('notification_preferences')
        .eq('id', user.id)
        .single()

      if (!cancelled && !error) {
        const prefs = (data?.notification_preferences as Record<string, any> | null) ?? {}
        const translation = (prefs.translation as Record<string, any> | undefined) ?? {}
        const dbTargetLanguage = typeof translation.target_language === 'string' ? translation.target_language.trim() : ''
        if (dbTargetLanguage) {
          setInterpreterTargetLanguage(dbTargetLanguage)
        }
      }

      if (!cancelled) setInterpreterPrefsHydrated(true)
    }

    void hydrateInterpreterPrefs()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    if (!interpreterPrefsHydrated) return

    try {
      const raw = localStorage.getItem(TEAM_CHAT_TRANSLATION_PREF_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      localStorage.setItem(
        TEAM_CHAT_TRANSLATION_PREF_KEY,
        JSON.stringify({
          ...parsed,
          targetLanguage: interpreterTargetLanguage,
        }),
      )
    } catch {
      // Ignore storage errors.
    }

    if (!user?.id) return

    const timer = setTimeout(async () => {
      const { data } = await (supabase.from('user_profiles') as any)
        .select('notification_preferences')
        .eq('id', user.id)
        .single()

      const currentPrefs = (data?.notification_preferences as Record<string, any> | null) ?? {}
      const nextPrefs = {
        ...currentPrefs,
        translation: {
          ...(currentPrefs.translation || {}),
          target_language: interpreterTargetLanguage,
          primary_language: 'en-NZ',
          region: 'NZ',
        },
      }

      await (supabase.from('user_profiles') as any)
        .update({ notification_preferences: nextPrefs } as never)
        .eq('id', user.id)
    }, 350)

    return () => clearTimeout(timer)
  }, [user?.id, interpreterTargetLanguage, interpreterPrefsHydrated])

  // Auto-transcribe the latest incoming PTT clip whenever it changes
  useEffect(() => {
    const clip = lastClips[0]
    if (!clip?.clipUrl || clip.id === transcribedClipIdRef.current) return

    transcribedClipIdRef.current = clip.id
    setLastClipTranscript(null)
    setIsTranscribing(true)

    edgeFunctions.transcribeAudio({ clip_url: clip.clipUrl, language: 'en' })
      .then((result: any) => {
        const text = result?.transcript ?? result?.text ?? null
        setLastClipTranscript(text)
      })
      .catch(() => {
        // Transcription is best-effort — silently fail
      })
      .finally(() => setIsTranscribing(false))
  }, [lastClips])

  useEffect(() => {
    return () => {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop()
        } catch {
          // best-effort cleanup for browser recognizer
        }
      }
      stopVoxMonitoring()
      if (liveTxTimerRef.current) clearInterval(liveTxTimerRef.current)
      if (scanTimerRef.current) clearInterval(scanTimerRef.current)
      if (wakeLockRef.current) releaseWakeLock()
    }
  }, [])

  // ── PTT diagnostics polling ───────────────────────────────
  useEffect(() => {
    setDiagnostics(getPTTDiagnostics())
    const iv = setInterval(() => {
      setDiagnostics(getPTTDiagnostics())
    }, 1200)

    return () => clearInterval(iv)
  }, [])
  // ─────────────────────────────────────────────────────────
  // PTT transmit
  // ─────────────────────────────────────────────────────────

  const handlePTTPress = useCallback(async () => {
    if (!canSpeak || !isAvailable || isTransmitting) return

    try {
      if (!audioPrimed) {
        await primeAudioOutput(true)
      }

      if (!microphoneReady) {
        await ensureMicrophonePermission()
        setMicrophoneReady(true)
        setMicrophoneError(null)
      }
      await startSpeaking()
      setIsTransmitting(true)
      playStatusTone('tx_start')
      // Haptic feedback on TX start.
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(200)

      // Wake lock to keep screen on while transmitting
      if (!wakeLockRef.current) {
        requestWakeLock().then((ok) => { wakeLockRef.current = ok })
      }
    } catch (err) {
      const msg = normalizePTTErrorMessage(err)
      setMicrophoneError(msg)
      toast.error(msg)
    }
  }, [audioPrimed, canSpeak, isAvailable, isTransmitting, microphoneReady, primeAudioOutput])

  const handlePTTRelease = useCallback(async () => {
    if (!isTransmitting) return
    const startTime = currentTxStart ?? new Date()
    let durationSeconds = (Date.now() - startTime.getTime()) / 1000
    let clipUrl: string | null = null

    try {
      const stopMeta = await stopSpeaking()
      durationSeconds = typeof stopMeta?.duration === 'number' ? stopMeta.duration : durationSeconds
      clipUrl = stopMeta?.clipUrl || null
    } catch {
      // ignore — still need to update UI
    }

    setIsTransmitting(false)
    playStatusTone('tx_end')
    // Haptic feedback on TX end.
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([100, 50, 100])

    if (wakeLockRef.current) {
      releaseWakeLock()
      wakeLockRef.current = false
    }

    // Log transmission
    const entry: TransmissionEntry = {
      id: `local-${Date.now()}`,
      callsign: callsign || user?.first_name || 'Me',
      name: `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() || 'Me',
      channelName: activeChannel?.name ?? 'Unknown',
      channelNumber: activeChannel?.channel_number ?? 0,
      durationSeconds,
      createdAt: startTime.toISOString(),
      clipUrl,
      transcript: null,
      isEmergency: emergencyMode,
      isLive: false,
    }
    setTxLog((prev) => [entry, ...prev].slice(0, 60))

    // Persist to DB (best-effort)
    if (effectiveOrgId && user?.id && !txLogUnavailableRef.current) {
      void (async () => {
        const basePayload = {
          organization_id: effectiveOrgId,
          channel_number: activeChannel?.channel_number ?? 0,
          channel_name: activeChannel?.name ?? '',
          speaker_id: user.id,
          speaker_name: entry.name,
          speaker_callsign: callsign || '',
          duration_seconds: durationSeconds,
          is_emergency: emergencyMode,
        }

        let insertedId: string | null = null
        let insertResult = await (supabase as any)
          .from('ptt_transmission_log')
          .insert({
            ...basePayload,
            clip_url: clipUrl,
            transcript: null,
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
          const e = insertResult.error
          if (e.code === 'PGRST205' || e.code === '42P01') {
            txLogUnavailableRef.current = true
            return
          }
          console.error('PTT TX log persist error:', e)
          return
        }

        insertedId = insertResult.data?.id || null
        queryClient.invalidateQueries({ queryKey: ['ptt-tx-log', effectiveOrgId] })

        if (!clipUrl) return

        try {
          const result = await edgeFunctions.transcribeAudio({ clip_url: clipUrl, language: 'en' })
          const transcript = String((result as any)?.transcript ?? (result as any)?.text ?? '').trim()
          if (!transcript) return

          setTxLog((prev) => prev.map((item) => (item.id === entry.id ? { ...item, transcript } : item)))

          if (insertedId) {
            await (supabase as any)
              .from('ptt_transmission_log')
              .update({ transcript })
              .eq('id', insertedId)
          }

          queryClient.invalidateQueries({ queryKey: ['ptt-tx-log', effectiveOrgId] })
        } catch (transcribeErr) {
          console.warn('PTT TX transcript unavailable:', transcribeErr)
        }
      })()
    }

    if (emergencyMode) {
      sendEmergencyBroadcast(false)
    }

    if (clipUrl && translationRailEnabled) {
      void (async () => {
        try {
          const clipResponse = await fetch(clipUrl)
          if (!clipResponse.ok) return
          const buffer = await clipResponse.arrayBuffer()
          const bytes = new Uint8Array(buffer)
          let binary = ''
          const chunkSize = 0x8000
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
          }
          const audioBase64 = btoa(binary)
          sendAudioChunk(audioBase64, 'audio/webm')
        } catch {
          // Translation forwarding is best-effort and should not block radio UX.
        }
      })()
    }

    setEmergencyMode(false)
  }, [
    isTransmitting,
    currentTxStart,
    callsign,
    user,
    activeChannel,
    emergencyMode,
    effectiveOrgId,
    queryClient,
    translationRailEnabled,
    sendAudioChunk,
  ])

  // ── Spacebar PTT shortcut ─────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        handlePTTPress()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        handlePTTRelease()
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [handlePTTPress, handlePTTRelease])

  // ── Degraded connection warning (15s non-connected state → amber banner) ───
  useEffect(() => {
    if (!activeChannel || connectionStatus === 'connected') {
      setDegradedMode(false)
      return
    }

    const timer = setTimeout(() => setDegradedMode(true), 15000)
    return () => clearTimeout(timer)
  }, [activeChannel, connectionStatus])

  // ── Auto-retry while degraded (best-effort, no user spam) ─────────────────
  useEffect(() => {
    if (!degradedMode || !activeChannel || isTransmitting || isConnecting) return

    const retryIv = setInterval(() => {
      if (!isTransmitting && !isConnecting) {
        void connectToChannel(activeChannel, { autoRetry: true })
      }
    }, 20000)

    return () => clearInterval(retryIv)
  }, [activeChannel, connectToChannel, degradedMode, isConnecting, isTransmitting])

  // ── Safety release guard for mobile/background interruptions ───────────────
  useEffect(() => {
    const forceRelease = () => {
      if (isTransmitting) {
        void handlePTTRelease()
      }
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        forceRelease()
      }
    }

    window.addEventListener('blur', forceRelease)
    window.addEventListener('pagehide', forceRelease)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('blur', forceRelease)
      window.removeEventListener('pagehide', forceRelease)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [handlePTTRelease, isTransmitting])

  const handleEmergencyBroadcast = useCallback(async () => {
    if (!effectiveOrgId) return
    const emergencyChannel = channels.find((c) => c.channel_type === 'emergency')
    if (emergencyChannel) {
      await connectToChannel(emergencyChannel)
    }
    sendEmergencyBroadcast(true)
    setEmergencyMode(true)
    playStatusTone('emergency')
    toast.warning('EMERGENCY MODE — transmitting on all channels', { duration: 5000 })
    await handlePTTPress()
  }, [effectiveOrgId, channels, connectToChannel, handlePTTPress])

  const translateInterpreterInput = useCallback(async () => {
    const text = interpreterInput.trim()
    if (!text) return

    setIsInterpreterTranslating(true)
    try {
      let translatedText = ''
      let meta: TranslationResult | null = null

      const { data, error } = await edgeFunctions.translateMessage({
        text,
        target_language: interpreterTargetLanguage,
      })

      if (!error && data) {
        translatedText = String((data as any)?.translated_text || '').trim()
        if (translatedText) {
          meta = {
            translated_text: translatedText,
            target_language: String((data as any)?.target_language || interpreterTargetLanguage),
            detected_source: typeof (data as any)?.detected_source === 'string' ? (data as any).detected_source : null,
            translation_confidence: typeof (data as any)?.translation_confidence === 'number' ? (data as any).translation_confidence : undefined,
            confidence_reason: typeof (data as any)?.confidence_reason === 'string' ? (data as any).confidence_reason : undefined,
            provider: typeof (data as any)?.provider === 'string' ? (data as any).provider : undefined,
            fallback: (data as any)?.fallback === true,
          }
        }
      }

      // Tactical fallback: use translator pod REST when edge translation path fails.
      if (!translatedText && translatorRestUrl) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        try {
          const resp = await fetch(translatorRestUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              source_lang: 'en-NZ',
              target_lang: interpreterTargetLanguage,
              context: 'ptt-radio',
              provider_org_id: providerOrgId,
              client_org_id: translatorClientOrgId,
              officer_id: user?.id,
              employer_org_id: employerOrganizationId,
              authorized_organizations: translatorAuthorizedOrgIds,
            }),
            signal: controller.signal,
          })

          if (resp.ok) {
            const fallbackData = await resp.json().catch(() => null)
            const fallbackText = String(fallbackData?.translated || fallbackData?.translated_text || '').trim()
            if (fallbackText) {
              translatedText = fallbackText
              meta = {
                translated_text: fallbackText,
                target_language: String(fallbackData?.target_lang || interpreterTargetLanguage),
                detected_source: typeof fallbackData?.source_lang === 'string' ? fallbackData.source_lang : null,
                translation_confidence: 0.7,
                confidence_reason: 'Direct translator pod fallback path used.',
                provider: 'translator-rest-fallback',
                fallback: true,
              }
            }
          }
        } catch (fetchErr: any) {
          // Translator pod unreachable — log quietly and allow outer handler to surface degraded message
          console.warn('PTT interpreter translator pod unavailable:', fetchErr?.message || fetchErr)
        } finally {
          clearTimeout(timeout)
        }
      }

      if (!translatedText || !meta) {
        throw new Error('Translation unavailable right now')
      }

      setInterpreterOutput(translatedText)
      setInterpreterTranslationMeta(meta)
    } catch (err: any) {
      console.error('PTT interpreter translation failed:', err)
      toast.error('PTT interpreter could not translate right now.')
    } finally {
      setIsInterpreterTranslating(false)
    }
  }, [interpreterInput, interpreterTargetLanguage, translatorRestUrl, providerOrgId, translatorClientOrgId, user?.id, employerOrganizationId, translatorAuthorizedOrgIds])

  const captureSpeechForInterpreter = useCallback(() => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Ctor) {
      toast.error('Browser speech recognition is not available on this device.')
      return
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop()
      } catch {
        // no-op
      }
      speechRecognitionRef.current = null
    }

    const recognition = new Ctor()
    speechRecognitionRef.current = recognition
    recognition.lang = 'en-NZ'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.maxAlternatives = 1

    recognition.onresult = (event: any) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || '').trim()
      if (transcript) {
        setInterpreterInput(transcript)
      }
    }

    recognition.onerror = () => {
      toast.error('Speech capture failed. Try text input instead.')
    }

    recognition.onend = () => {
      setIsInterpreterListening(false)
      speechRecognitionRef.current = null
    }

    setIsInterpreterListening(true)
    recognition.start()
  }, [])

  // ─────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────

  const connectionColor = {
    connected:     'text-green-400',
    connecting:    'text-yellow-400',
    reconnecting:  'text-yellow-400',
    disconnected:  'text-red-400',
    error:         'text-red-500',
  }[connectionStatus] ?? 'text-gray-400'

  const connectionDot = {
    connected:    'bg-green-400 shadow-[0_0_6px_#4ade80]',
    connecting:   'bg-yellow-400 animate-pulse',
    reconnecting: 'bg-yellow-400 animate-pulse',
    disconnected: 'bg-red-400',
    error:        'bg-red-500',
  }[connectionStatus] ?? 'bg-gray-400'

  const canFallbackToTextChat = Boolean(error && /text chat/i.test(error))

  function formatDuration(secs: number) {
    const s = Math.round(secs)
    const m = Math.floor(s / 60)
    const r = s % 60
    return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `0:${r.toString().padStart(2, '0')}`
  }

  const someoneSpeaking = !!speakerId && !isSpeaking

  const handleAskBobAssessment = useCallback(() => {
    const snapshot = getPTTDiagnostics()
    setDiagnostics(snapshot)

    void askBobBrain({
      prompt: buildPTTAssessmentPrompt({
        diagnostics: snapshot,
        activeChannel,
        effectiveOrgId,
        callsign,
        connectionStatus,
        isAvailable,
        canSpeak,
        isMuted,
        isTransmitting,
        someoneSpeaking,
        speakerName: speakerName || null,
        microphoneReady,
        microphoneError,
        rosterCount: rosterWithSelf.length,
        liveClipsCount: lastClips.length,
        channelsError,
      }),
      lat: handoffGeoPoint?.latitude,
      lng: handoffGeoPoint?.longitude,
      organizationId: effectiveOrgId,
    })
  }, [
    activeChannel,
    askBobBrain,
    callsign,
    canSpeak,
    channelsError,
    connectionStatus,
    effectiveOrgId,
    isAvailable,
    isMuted,
    isTransmitting,
    lastClips.length,
    microphoneError,
    microphoneReady,
    rosterWithSelf.length,
    someoneSpeaking,
    speakerName,
    handoffGeoPoint?.latitude,
    handoffGeoPoint?.longitude,
  ])

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="Radio"
      description="Push-to-Talk radio console — independent 2-way radio system"
    >
      {/* Full-screen dark console */}
      <div className="flex flex-col h-[calc(100vh-64px)] bg-slate-950 text-slate-100 font-mono overflow-hidden">

        {/* ── Top status bar ──────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0 flex-wrap gap-2">
          {/* Mobile hamburger */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="md:hidden h-9 w-9 rounded-lg border-slate-700 bg-slate-800 text-slate-200"
                aria-label="Open channel and settings menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[92vw] max-w-sm bg-slate-950 border-slate-800 text-slate-100 p-0">
              <SheetHeader className="px-4 py-3 border-b border-slate-800">
                <SheetTitle className="text-slate-100 text-sm uppercase tracking-widest">Radio Menu</SheetTitle>
              </SheetHeader>

              <div className="h-full flex flex-col">
                <div className="px-3 pt-3 pb-1.5 shrink-0">
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Channels</div>
                </div>
                <ScrollArea className="flex-1 px-2">
                  <div className="space-y-1.5 pb-3">
                    {loadingChannels ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                      </div>
                    ) : (
                      channels.map((ch) => {
                        const isActive = activeChannel?.id === ch.id
                        const isEmergencyCh = ch.channel_type === 'emergency'
                        return (
                          <button
                            key={`mobile-${ch.id}`}
                            className={`w-full flex items-center gap-2.5 px-3 py-3 rounded-lg text-left transition-all ${
                              isActive
                                ? 'bg-slate-700 shadow-[0_0_12px_rgba(59,130,246,0.3)]'
                                : 'bg-slate-800/60 hover:bg-slate-800'
                            } ${isEmergencyCh ? 'border border-red-800' : 'border border-transparent'} ${
                              isConnecting || retryCountdownSeconds !== null || isConnectCoolingDown
                                ? 'opacity-60 cursor-not-allowed'
                                : ''
                            }`}
                            style={isActive ? { borderColor: ch.color, boxShadow: `0 0 12px ${ch.color}33` } : {}}
                            disabled={isConnecting || retryCountdownSeconds !== null || isConnectCoolingDown}
                            onClick={() => {
                              handleChannelSelect(ch)
                              setMobileMenuOpen(false)
                            }}
                          >
                            <div className="flex flex-col items-center justify-center w-9 h-9 rounded bg-slate-900/80 shrink-0">
                              <span className="text-[9px] text-slate-500 uppercase leading-tight">CH</span>
                              <span className="text-base font-bold leading-tight" style={{ color: ch.color }}>
                                {renderChannelBadge(ch)}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white truncate tracking-wide">{ch.name.toUpperCase()}</div>
                              {ch.description && (
                                <div className="text-[10px] text-slate-500 truncate">{ch.description}</div>
                              )}
                            </div>
                            {isActive && (
                              <div className="ml-auto w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                            )}
                          </button>
                        )
                      })
                    )}
                  </div>
                </ScrollArea>

                <div className="border-t border-slate-800 px-3 py-2 shrink-0">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-widest mb-2">
                    <Users className="h-3 w-3" />
                    Units Online ({rosterWithSelf.length})
                  </div>
                  {rosterWithSelf.length === 0 ? (
                    <p className="text-xs text-slate-600">No presence data — connect to a channel</p>
                  ) : (
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {rosterWithSelf.map((p) => (
                        <div key={`mobile-roster-${p.userId}`} className="flex items-center gap-2 text-xs">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${
                            p.status === 'online' ? 'bg-green-400' : p.status === 'busy' ? 'bg-yellow-400' : 'bg-slate-600'
                          }`} />
                          <span className="text-slate-300 truncate font-medium">{p.name}</span>
                          {hasPttSupervisorControls && p.userId !== user?.id && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded border border-red-900 bg-red-950/60 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => void handleForceDisconnect(p.userId, p.name)}
                              disabled={disconnectingUserId === p.userId}
                              title="Force disconnect PTT session"
                            >
                              {disconnectingUserId === p.userId ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <PhoneOff className="h-3 w-3" />
                              )}
                              Drop
                            </button>
                          )}
                          <span className="text-slate-600 capitalize ml-auto shrink-0">{p.role}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-800 px-3 py-2 shrink-0 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Scan className="h-3.5 w-3.5" />
                    Scanner
                  </div>
                  <Switch
                    checked={scanMode}
                    onCheckedChange={(v) => { setScanMode(v); if (!v && activeChannel) connectToChannel(activeChannel) }}
                    className="data-[state=checked]:bg-yellow-500"
                  />
                </div>

                <div className="border-t border-slate-800 p-4 space-y-4 shrink-0">
                  <div className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Settings</div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-slate-200">VOX Mode</div>
                      <div className="text-xs text-slate-500">Voice-activated transmission</div>
                    </div>
                    <Switch
                      checked={voxEnabled}
                      onCheckedChange={(v) => {
                        setVoxEnabled(v)
                        setInputMode(v ? 'vox' : 'ptt')
                      }}
                      className="data-[state=checked]:bg-green-600"
                    />
                  </div>

                  {voxEnabled && (
                    <div>
                      <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>VOX Threshold</span>
                        <span>{voxThreshold}%</span>
                      </div>
                      <Slider
                        value={[voxThreshold]}
                        onValueChange={([v]) => setVoxThreshold(v)}
                        min={5} max={80} step={5}
                        className="w-full"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-slate-200">Bluetooth PTT</div>
                      <div className="text-xs text-slate-500">Use headset PTT button</div>
                    </div>
                    <Switch
                      checked={usePTTStore.getState().bluetoothEnabled}
                      onCheckedChange={(v) => {
                        usePTTStore.getState().setBluetoothEnabled(v)
                        if (v) initBluetoothPTT()
                      }}
                      className="data-[state=checked]:bg-blue-600"
                    />
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          {/* Left: callsign + org */}
          <div className="flex items-center gap-3">
            <Radio className="h-5 w-5 text-blue-400" />
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-widest">Callsign</div>
              <div className="text-lg font-bold text-white tracking-wider">{callsign || '---'}</div>
            </div>
          </div>

          {/* Center: active channel */}
          <div className="flex items-center gap-2 px-4 py-1.5 rounded bg-slate-800 border border-slate-700 min-w-[180px] justify-center">
            {activeChannel ? (
              <>
                <span className="text-xs text-slate-400 uppercase">
                  {activeChannel.badge_label || `CH ${activeChannel.channel_number}`}
                </span>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeChannel.color }} />
                <span className="font-bold text-white text-sm tracking-wide">{activeChannel.name.toUpperCase()}</span>
                {activeChannel.scope_label && (
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">{activeChannel.scope_label}</span>
                )}
                {scanMode && <span className="text-xs text-yellow-400 animate-pulse ml-1">SCAN</span>}
              </>
            ) : (
              <span className="text-slate-500 text-xs">NO CHANNEL</span>
            )}
          </div>

          {/* Right: connection + clock */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`w-2 h-2 rounded-full ${connectionDot}`} />
              <span className={`uppercase tracking-wide ${connectionColor}`}>{connectionStatus}</span>
              {isConnecting && <Loader2 className="h-3 w-3 animate-spin text-yellow-400 ml-1" />}
              {retryCountdownSeconds !== null && (
                <span className="ml-1 text-yellow-300 tabular-nums">retry {retryCountdownSeconds}s</span>
              )}
            </div>
            <div className="flex items-center gap-1 text-slate-300">
              <Clock className="h-3.5 w-3.5 text-slate-500" />
              <NZClock />
            </div>
            {isMuted && (
              <Badge variant="destructive" className="text-xs px-1.5 py-0">MUTED</Badge>
            )}
          </div>
        </div>

        {/* ── Error banner ─────────────────────────────────── */}
        {!connectionWarningArmed && activeChannel && connectionStatus !== 'connected' && (
          <div className="px-4 py-2 bg-slate-900 border-b border-slate-700 text-xs text-slate-300 flex items-center gap-2 shrink-0">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-300 shrink-0" />
            <div className="min-w-0">
              <div>Connecting to radio signaling service…</div>
              <div className="text-[10px] text-slate-400/80 uppercase tracking-wider mt-1">
                Signaling: {signalingDebugLabel} ({signalingTransportState})
              </div>
            </div>
          </div>
        )}

        {error && connectionWarningArmed && (
          <div className="px-4 py-2 bg-red-950 border-b border-red-800 text-xs text-red-300 flex items-center gap-2 shrink-0">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
            <div className="min-w-0">
              <div>{error}</div>
              <div className="text-[10px] text-red-400/80 uppercase tracking-wider mt-1">
                Signaling: {signalingDebugLabel} ({signalingTransportState})
              </div>
            </div>
            {canFallbackToTextChat && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-red-300 hover:text-white"
                onClick={() => navigate('/team-chat')}
              >
                Open Team Chat
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 text-xs text-red-300 hover:text-white"
              disabled={isConnecting || retryCountdownSeconds !== null || isConnectCoolingDown}
              onClick={() => { setError(null); if (activeChannel) connectToChannel(activeChannel) }}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              {connectCooldownLabel > 0 ? `Retry in ${connectCooldownLabel}s` : 'Retry'}
            </Button>
          </div>
        )}

        {/* ── Microphone banner ────────────────────────────── */}
        {microphoneError && (
          <div className="px-4 py-2 bg-amber-950 border-b border-amber-800 text-xs text-amber-300 flex items-center gap-2 shrink-0">
            <MicOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            Microphone access is required to transmit from this device.
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 text-xs text-amber-300 hover:text-white"
              onClick={requestMicrophoneAccess}
            >
              Enable Microphone
            </Button>
          </div>
        )}

        {/* ── Degraded connection banner ──────────────────── */}
        {degradedMode && !error && (
          <div className="px-4 py-2 bg-amber-950 border-b border-amber-700 text-xs text-amber-300 flex items-center gap-2 shrink-0">
            <WifiOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <div>PTT server unreachable - check your connection or use mobile phone direct.</div>
              <div className="text-[10px] text-amber-400/80 uppercase tracking-wider mt-1">
                Signaling: {signalingDebugLabel} ({signalingTransportState})
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 text-xs text-amber-300 hover:text-white"
              disabled={isConnecting}
              onClick={() => { setDegradedMode(false); if (activeChannel) connectToChannel(activeChannel) }}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
          </div>
        )}

        {/* ── Translation rail status ─────────────────────── */}
        <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/80 shrink-0 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`h-2.5 w-2.5 rounded-full ${isDiplomaticMode ? 'bg-yellow-400 animate-pulse' : 'bg-blue-400 animate-pulse'}`} />
            <span className="text-xs uppercase tracking-wide text-slate-200">
              {isDiplomaticMode ? 'Diplomatic Bus' : 'Tactical Bus'}
            </span>
            <span className="text-[10px] text-slate-400 truncate">{translationRailSubtitle}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={isDiplomaticMode ? 'border-yellow-500 text-yellow-300' : 'border-blue-500 text-blue-300'}>
              {isDiplomaticMode ? 'Gold Pulse' : 'Blue Pulse'}
            </Badge>
            <Badge variant="outline" className="border-emerald-500/60 text-emerald-300">
              {translatorStatusLabel}
            </Badge>
            <Switch
              checked={translationRailEnabled}
              onCheckedChange={setTranslationRailEnabled}
              disabled={!providerOrgId}
              aria-label="Universal translator toggle"
            />
          </div>
        </div>

        {/* ── Notification hint ────────────────────────────── */}
        {showNotificationHint && (
          <div className="px-4 py-1.5 bg-blue-950 border-b border-blue-800 text-xs text-blue-300 flex items-center gap-2 shrink-0">
            <Signal className="h-3.5 w-3.5 shrink-0" />
            Enable notifications to be alerted when someone transmits while this page is in the background.
            <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs text-blue-300 hover:text-white"
              onClick={async () => { await requestNotificationPermission(); setShowNotificationHint(false) }}>
              Allow
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs text-slate-400"
              onClick={() => setShowNotificationHint(false)}>
              Dismiss
            </Button>
          </div>
        )}

        {emergencyBroadcastActive && (
          <>
            <div className="pointer-events-none fixed inset-0 z-40 border-[10px] border-red-500/70 animate-pulse" />
            <div className="pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-40 rounded-xl border border-red-500 bg-red-950/95 px-4 py-2 text-center shadow-xl shadow-red-900/40">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-red-300">Emergency Broadcast Active</div>
              <div className="text-xs text-red-100 mt-1">
                {emergencyBroadcastInitiatedByName ? `Initiated by ${emergencyBroadcastInitiatedByName}` : 'All units acknowledge and respond'}
              </div>
            </div>
          </>
        )}

        {/* ── Main console body ────────────────────────────── */}
        <div className="flex-1 flex gap-0 overflow-hidden">

          {/* ── LEFT: Channel grid ────────────────────────── */}
          <div className="hidden md:flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/50">
            <div className="px-3 pt-3 pb-1.5 shrink-0">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Channels</div>
            </div>
            <ScrollArea className="flex-1 px-2">
              <div className="space-y-1.5 pb-2">
                {loadingChannels ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                  </div>
                ) : (
                  channels.map((ch) => {
                    const isActive = activeChannel?.id === ch.id
                    const isEmergencyCh = ch.channel_type === 'emergency'
                    return (
                      <button
                        key={ch.id}
                        className={`w-full flex items-center gap-2.5 px-3 py-3 rounded-lg text-left transition-all ${
                          isActive
                            ? 'bg-slate-700 shadow-[0_0_12px_rgba(59,130,246,0.3)]'
                            : 'bg-slate-800/60 hover:bg-slate-800'
                        } ${isEmergencyCh ? 'border border-red-800' : 'border border-transparent'} ${
                          isConnecting || retryCountdownSeconds !== null || isConnectCoolingDown
                            ? 'opacity-60 cursor-not-allowed'
                            : ''
                        }`}
                        style={isActive ? { borderColor: ch.color, boxShadow: `0 0 12px ${ch.color}33` } : {}}
                        disabled={isConnecting || retryCountdownSeconds !== null || isConnectCoolingDown}
                        onClick={() => handleChannelSelect(ch)}
                      >
                        <div className="flex flex-col items-center justify-center w-9 h-9 rounded bg-slate-900/80 shrink-0">
                          <span className="text-[9px] text-slate-500 uppercase leading-tight">CH</span>
                          <span className="text-base font-bold leading-tight" style={{ color: ch.color }}>
                            {renderChannelBadge(ch)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate tracking-wide">{ch.name.toUpperCase()}</div>
                          {ch.description && (
                            <div className="text-[10px] text-slate-500 truncate">{ch.description}</div>
                          )}
                        </div>
                        {isActive && (
                          <div className="ml-auto w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </ScrollArea>

            {/* Scanner toggle */}
            <div className="border-t border-slate-800 px-3 py-2 shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Scan className="h-3.5 w-3.5" />
                Scanner
              </div>
              <Switch
                checked={scanMode}
                onCheckedChange={(v) => { setScanMode(v); if (!v && activeChannel) connectToChannel(activeChannel) }}
                className="data-[state=checked]:bg-yellow-500"
              />
            </div>
          </div>

          {/* ── CENTER: PTT controls ─────────────────────── */}
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-3 md:px-6 bg-slate-950 relative overflow-auto py-4">

            {/* Active channel header */}
            {activeChannel && (
              <div className="text-center">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest">Active Channel</div>
                <div className="text-2xl font-bold tracking-wider mt-0.5" style={{ color: activeChannel.color }}>
                  {(activeChannel.badge_label || `CH ${activeChannel.channel_number}`)} · {activeChannel.name.toUpperCase()}
                </div>
                {activeChannel.scope_label && (
                  <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-1">{activeChannel.scope_label}</div>
                )}
              </div>
            )}

            {/* Speaker indicator (when someone else is talking) */}
            {someoneSpeaking && (
              <div className="w-full flex flex-col items-center gap-1 shrink-0 pointer-events-none select-none">
                <div className="relative flex items-center justify-center">
                  <div className="absolute w-44 h-44 rounded-full border-4 border-green-500/50 animate-ping" />
                  <div className="w-32 h-32 rounded-full bg-green-600/15 border border-green-500/60 flex items-center justify-center">
                    <Volume2 className="h-8 w-8 text-green-300" />
                  </div>
                </div>
                <span className="text-green-300 font-black text-sm tracking-[0.16em] uppercase animate-pulse">
                  RECEIVING - {(speakerName || 'Unknown').toUpperCase()}
                </span>
              </div>
            )}

            {/* TX pulsing ring indicator — unmissable in the dark */}
            {isTransmitting && (
              <div className="w-full flex flex-col items-center gap-1 shrink-0 pointer-events-none select-none">
                <div className="relative flex items-center justify-center">
                  <div className="absolute w-52 h-52 rounded-full border-4 border-red-500 animate-ping opacity-40" />
                  <div className="absolute w-44 h-44 rounded-full border-2 border-red-400 animate-ping opacity-60" style={{ animationDelay: '0.15s' }} />
                  <div className="w-36 h-36 rounded-full bg-red-600/20 flex items-center justify-center">
                    <span className="text-red-300 font-black text-sm tracking-[0.3em] uppercase">TX</span>
                  </div>
                </div>
                <span className="text-red-400 font-black text-base tracking-[0.2em] uppercase animate-pulse">TRANSMITTING</span>
              </div>
            )}

            {/* Main PTT Button — full-width bottom bar on mobile, round on desktop */}
            <div className="fixed bottom-3 left-3 right-3 z-30 md:static md:bottom-auto md:left-auto md:right-auto md:z-auto">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      ref={pttButtonRef}
                      className={[
                        // Mobile: bottom full-width control; Desktop: round control.
                        'select-none touch-none flex items-center justify-center transition-all duration-100 border-4 w-full',
                        'min-h-[84px] rounded-2xl md:rounded-full md:min-h-0 md:w-40 md:h-40',
                        isTransmitting
                          ? 'bg-red-600 border-red-400 shadow-[0_0_40px_#dc262680] scale-[1.02]'
                          : emergencyMode
                          ? 'bg-red-900 border-red-600 animate-pulse'
                          : canSpeak && !isMuted
                          ? 'bg-emerald-900/45 border-emerald-600 hover:bg-emerald-800/60 hover:border-emerald-400 hover:shadow-[0_0_20px_#34d39955] active:scale-95'
                          : 'bg-slate-900 border-slate-800 opacity-50 cursor-not-allowed',
                      ].join(' ')}
                      onPointerDown={(e) => {
                        if (e.pointerType === 'mouse' && e.button !== 0) return
                        e.preventDefault()
                        void handlePTTPress()
                      }}
                      onPointerUp={(e) => {
                        e.preventDefault()
                        void handlePTTRelease()
                      }}
                      onPointerCancel={() => { void handlePTTRelease() }}
                      onPointerLeave={() => {
                        if (isTransmitting) {
                          void handlePTTRelease()
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      disabled={!canSpeak && !isTransmitting}
                      aria-label="Push to talk"
                    >
                      <div className="flex flex-col items-center gap-1.5">
                        {isMuted ? (
                          <MicOff className="h-10 w-10 text-red-400" />
                        ) : isTransmitting ? (
                          <Mic className="h-10 w-10 text-white" />
                        ) : (
                          <Mic className={`h-10 w-10 ${canSpeak ? 'text-emerald-200' : 'text-slate-600'}`} />
                        )}
                        <span className={`text-xs font-bold tracking-widest uppercase ${
                          isTransmitting ? 'text-white' : isMuted ? 'text-red-400' : 'text-emerald-200'
                        }`}>
                          {isTransmitting
                            ? `TX  ${formatDuration(liveTxSeconds)}`
                            : isMuted
                            ? 'MUTED'
                            : connectionStatus !== 'connected'
                            ? connectionStatus.toUpperCase()
                            : 'HOLD TO TALK'}
                        </span>
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Hold to transmit · Spacebar shortcut
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="text-[10px] text-slate-600 uppercase tracking-widest">
              {inputMode === 'vox' ? 'VOX MODE ACTIVE' : 'Hold button or hold SPACEBAR to transmit'}
            </div>

            {/* Audio level meter */}
            <div className="flex flex-col items-center gap-1.5 w-full max-w-xs">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest">Audio Level</div>
              <AudioLevelMeter level={audioLevel} transmitting={isTransmitting} />
            </div>

            <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-400 uppercase tracking-widest">PTT Interpreter</div>
                <div className="flex items-center gap-2">
                  <Languages className="h-3.5 w-3.5 text-slate-400" />
                  <Select value={interpreterTargetLanguage} onValueChange={setInterpreterTargetLanguage}>
                    <SelectTrigger className="h-8 w-[170px] border-slate-700 bg-slate-950 text-slate-200">
                      <SelectValue placeholder="Target language" />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSLATION_LANGUAGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Textarea
                value={interpreterInput}
                onChange={(e) => {
                  setInterpreterInput(e.target.value)
                  setInterpreterTranslationMeta(null)
                }}
                placeholder="Enter message or capture speech, then translate for radio relay"
                className="min-h-[76px] border-slate-700 bg-slate-950 text-slate-200 placeholder:text-slate-500"
              />

              {interpreterOutput && (
                <div className={`rounded-md border p-3 text-sm whitespace-pre-wrap ${(interpreterTranslationMeta?.translation_confidence ?? 1) < 0.7 || interpreterTranslationMeta?.fallback ? 'border-amber-700/40 bg-amber-950/30 text-amber-100' : 'border-emerald-700/40 bg-emerald-950/30 text-emerald-200'}`}>
                  <div>{interpreterOutput}</div>
                  {(interpreterTranslationMeta?.translation_confidence != null || interpreterTranslationMeta?.detected_source || interpreterTranslationMeta?.confidence_reason || interpreterTranslationMeta?.provider) && (
                    <div className="mt-2 text-xs opacity-80">
                      {interpreterTranslationMeta?.translation_confidence != null ? `Confidence ${(interpreterTranslationMeta.translation_confidence * 100).toFixed(0)}%` : 'Confidence unknown'}
                      {interpreterTranslationMeta?.detected_source ? ` · Source ${interpreterTranslationMeta.detected_source}` : ''}
                      {interpreterTranslationMeta?.provider ? ` · ${interpreterTranslationMeta.provider}` : ''}
                      {interpreterTranslationMeta?.confidence_reason ? ` · ${interpreterTranslationMeta.confidence_reason}` : ''}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={captureSpeechForInterpreter}
                  disabled={isInterpreterListening}
                  className="border-slate-700 bg-slate-800 text-slate-200"
                >
                  {isInterpreterListening ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Mic className="h-3.5 w-3.5 mr-1" />}
                  {isInterpreterListening ? 'Listening...' : 'Capture Speech'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={translateInterpreterInput}
                  disabled={!interpreterInput.trim() || isInterpreterTranslating}
                  className="border-slate-700 bg-slate-800 text-slate-200"
                >
                  {isInterpreterTranslating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Languages className="h-3.5 w-3.5 mr-1" />}
                  Translate
                </Button>
              </div>
            </div>

            {/* Quick controls row */}
            <div className="flex gap-3">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className={`h-11 w-11 rounded-xl border-slate-700 bg-slate-800 hover:bg-slate-700 ${isMuted ? 'border-red-700 text-red-400' : 'text-slate-300'}`}
                      onClick={() => toggleMute()}
                    >
                      {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isMuted ? 'Unmute' : 'Mute'}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className={`h-11 w-11 rounded-xl border-slate-700 bg-slate-800 hover:bg-slate-700 ${audioPrimed ? 'text-emerald-300 border-emerald-700' : 'text-slate-300'}`}
                      onClick={() => void primeAudioOutput()}
                      disabled={isPrimingAudio}
                    >
                      {isPrimingAudio ? <Loader2 className="h-5 w-5 animate-spin" /> : <Volume2 className="h-5 w-5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{audioPrimed ? 'Audio output ready' : 'Prime mobile audio output'}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className={`h-11 w-11 rounded-xl border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 ${scanMode ? 'border-yellow-600 text-yellow-400' : ''}`}
                      onClick={() => setScanMode(!scanMode)}
                    >
                      <Scan className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{scanMode ? 'Stop scanner' : 'Start scanner'}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="hidden md:inline-flex h-11 w-11 rounded-xl border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300"
                      onClick={() => navigate('/radio/log')}
                    >
                      <History className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>View Transmission Log</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="hidden md:inline-flex h-11 w-11 rounded-xl border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300"
                      onClick={() => setShowSettings(!showSettings)}
                    >
                      <Settings className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Settings</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className={`h-11 w-11 rounded-xl border-slate-700 bg-slate-800 hover:bg-slate-700 ${showDiagnostics ? 'text-cyan-300 border-cyan-700' : 'text-slate-300'}`}
                      onClick={() => setShowDiagnostics(!showDiagnostics)}
                    >
                      <Signal className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>PTT Diagnostics</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Diagnostics panel */}
            {showDiagnostics && (
              <div className="w-full max-w-sm bg-slate-900 border border-cyan-900 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-cyan-300 uppercase tracking-widest font-semibold">PTT Diagnostics</div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] text-cyan-300"
                      onClick={handleAskBobAssessment}
                      disabled={isWaiting}
                    >
                      {isWaiting ? (
                        <>
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          Bob Assessing
                        </>
                      ) : (
                        <>
                          <BrainCircuit className="mr-1 h-3 w-3" />
                          Ask Bob
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] text-slate-400"
                      onClick={() => setDiagnostics(getPTTDiagnostics())}
                    >
                      Refresh
                    </Button>
                  </div>
                </div>

                {(isWaiting || bobResponse) && (
                  <div className="rounded border border-cyan-900 bg-slate-950 px-2.5 py-2 text-[11px] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-cyan-300 uppercase tracking-wide">
                        {isWaiting ? 'Bob Assessment Pending' : 'Bob Assessment'}
                      </div>
                      {bobResponse && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] text-slate-400"
                          onClick={clearResponse}
                        >
                          Clear
                        </Button>
                      )}
                    </div>

                    {isWaiting && (
                      <div className="text-slate-400">
                        Bob Brain is processing the latest radio diagnostics snapshot.
                      </div>
                    )}

                    {bobResponse && (
                      <div className="space-y-1">
                        <div className="text-slate-500">
                          Returned {bobResponseCompletedAt ? formatDateTime(bobResponseCompletedAt) : 'just now'}
                        </div>
                        <div className="whitespace-pre-wrap text-slate-200">{bobResponse.answer}</div>
                        {(bobResponse.jurisdiction || bobResponse.provider || bobResponse.model) && (
                          <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                            {bobResponse.jurisdiction ? `Jurisdiction: ${bobResponse.jurisdiction}` : 'Jurisdiction: General'}
                            {bobResponse.provider ? ` • Provider: ${bobResponse.provider}` : ''}
                            {bobResponse.model ? ` • Model: ${bobResponse.model}` : ''}
                          </div>
                        )}
                      </div>
                    )}

                    {bobResponseError && !isWaiting && (
                      <div className="text-amber-300">
                        Bob assessment error: {bobResponseError}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-slate-500">Connection</div>
                  <div className="text-slate-200 uppercase">{diagnostics.connectionStatus}</div>
                  <div className="text-slate-500">Channel Scope</div>
                  <div className="text-slate-200 truncate" title={diagnostics.channelScope || 'none'}>
                    {diagnostics.channelScope || 'none'}
                  </div>
                  <div className="text-slate-500">WebSocket</div>
                  <div className="text-slate-200 uppercase">{diagnostics.websocketReadyState}</div>
                  <div className="text-slate-500">Reconnects</div>
                  <div className="text-slate-200 tabular-nums">{diagnostics.reconnectAttempts}</div>
                  <div className="text-slate-500">ICE Policy</div>
                  <div className="text-slate-200 uppercase">{diagnostics.transport.iceTransportPolicy}</div>
                  <div className="text-slate-500">TURN Configured</div>
                  <div className={diagnostics.transport.turnConfigured ? 'text-green-300' : 'text-amber-300'}>
                    {diagnostics.transport.turnConfigured ? 'YES' : 'NO'}
                  </div>
                  <div className="text-slate-500">Force Relay</div>
                  <div className={diagnostics.transport.forceTurnRelay ? 'text-cyan-300' : 'text-slate-300'}>
                    {diagnostics.transport.forceTurnRelay ? 'ENABLED' : 'DISABLED'}
                  </div>
                  <div className="text-slate-500">Peer Connections</div>
                  <div className="text-slate-200 tabular-nums">{diagnostics.activePeerConnections}</div>
                </div>

                {diagnostics.lastClose.code !== null && (
                  <div className="rounded bg-slate-950 border border-slate-800 px-2.5 py-2 text-[11px]">
                    <div className="text-slate-500 uppercase tracking-wide">Last Socket Close</div>
                    <div className="text-slate-300">Code {diagnostics.lastClose.code}</div>
                    {diagnostics.lastClose.reason && <div className="text-slate-500 truncate">{diagnostics.lastClose.reason}</div>}
                  </div>
                )}

                {diagnostics.peerStates.length > 0 && (
                  <div className="rounded bg-slate-950 border border-slate-800 px-2.5 py-2 space-y-1">
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest">Peer States</div>
                    {diagnostics.peerStates.slice(0, 4).map((peer) => (
                      <div key={peer.peerId} className="text-[11px] text-slate-300 grid grid-cols-3 gap-2">
                        <span className="truncate" title={peer.peerId}>{peer.peerId.slice(0, 8)}</span>
                        <span className="text-slate-400 truncate">{peer.connectionState}</span>
                        <span className="text-slate-400 truncate">{peer.iceConnectionState}</span>
                      </div>
                    ))}
                  </div>
                )}

                {channelsError && (
                  <div className="rounded bg-amber-950/30 border border-amber-900 px-2.5 py-2 text-[11px] text-amber-300">
                    Channel metadata unavailable on this device. Some channels may not align with other users.
                  </div>
                )}
              </div>
            )}

            {/* Settings panel */}
            {showSettings && (
              <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-4">
                <div className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Radio Settings</div>

                {/* VOX */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-200">VOX Mode</div>
                    <div className="text-xs text-slate-500">Voice-activated transmission</div>
                  </div>
                  <Switch
                    checked={voxEnabled}
                    onCheckedChange={(v) => {
                      setVoxEnabled(v)
                      setInputMode(v ? 'vox' : 'ptt')
                    }}
                    className="data-[state=checked]:bg-green-600"
                  />
                </div>

                {voxEnabled && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>VOX Threshold</span>
                      <span>{voxThreshold}%</span>
                    </div>
                    <Slider
                      value={[voxThreshold]}
                      onValueChange={([v]) => setVoxThreshold(v)}
                      min={5} max={80} step={5}
                      className="w-full"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-slate-700 bg-slate-800 text-slate-200 text-xs"
                      onClick={() => setShowVoxCalibrator(!showVoxCalibrator)}
                    >
                      {showVoxCalibrator ? 'Hide Calibrator' : 'Calibrate VOX'}
                    </Button>
                    {showVoxCalibrator && (
                      <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span className="uppercase tracking-widest">Live dB Level</span>
                          <span className="tabular-nums font-bold text-slate-200">{audioLevel}%</span>
                        </div>
                        <div className="relative h-3 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-75 ${
                              audioLevel >= voxThreshold ? 'bg-red-500' : audioLevel > voxThreshold * 0.7 ? 'bg-amber-400' : 'bg-green-500'
                            }`}
                            style={{ width: `${audioLevel}%` }}
                          />
                          {/* Threshold marker */}
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-white opacity-70"
                            style={{ left: `${voxThreshold}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {audioLevel >= voxThreshold
                            ? '🔴 Would transmit now — raise threshold if wind is triggering it'
                            : `Mic below threshold — speak to test. Threshold: ${voxThreshold}%`}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Bluetooth */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-200">Bluetooth PTT</div>
                    <div className="text-xs text-slate-500">Use headset PTT button</div>
                  </div>
                  <Switch
                    checked={usePTTStore.getState().bluetoothEnabled}
                    onCheckedChange={(v) => {
                      usePTTStore.getState().setBluetoothEnabled(v)
                      if (v) initBluetoothPTT()
                    }}
                    className="data-[state=checked]:bg-blue-600"
                  />
                </div>

                {/* Scanner dwell */}
                <div>
                  <div className="text-sm text-slate-200 mb-1">Scanner Dwell</div>
                  <div className="flex gap-2">
                    {[5000, 8000, 15000].map((ms) => (
                      <button
                        key={ms}
                        className={`flex-1 py-1.5 rounded text-xs font-bold border transition-colors ${
                          scanDwellMs === ms
                            ? 'bg-yellow-500/20 border-yellow-600 text-yellow-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                        }`}
                        onClick={() => setScanDwellMs(ms)}
                      >
                        {ms / 1000}s
                      </button>
                    ))}
                  </div>
                  <div className="text-[10px] text-slate-600 mt-1">Time on each channel before cycling</div>
                </div>
              </div>
            )}

            {/* Emergency broadcast button */}
            <button
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm tracking-widest uppercase border-2 transition-all ${
                isTransmitting && emergencyMode
                  ? 'bg-red-600 border-red-400 text-white animate-pulse shadow-[0_0_30px_#dc2626]'
                  : 'bg-red-950 border-red-800 text-red-400 hover:bg-red-900 hover:border-red-600 hover:text-red-300'
              }`}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return
                e.preventDefault()
                void handleEmergencyBroadcast()
              }}
              onPointerUp={(e) => {
                e.preventDefault()
                void handlePTTRelease()
              }}
              onPointerCancel={() => { void handlePTTRelease() }}
            >
              <AlertTriangle className="h-4 w-4" />
              Emergency — All Channels
            </button>
          </div>

          {/* ── RIGHT: Presence + TX log ─────────────────── */}
          <div className="hidden lg:flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-900/50">

            {/* Units online */}
            <div className="border-b border-slate-800 p-3 shrink-0">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-widest mb-2">
                <Users className="h-3 w-3" />
                Units Online ({rosterWithSelf.length})
              </div>
              {rosterWithSelf.length === 0 ? (
                <p className="text-xs text-slate-600">No presence data — connect to a channel</p>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {rosterWithSelf.map((p) => (
                    <div key={p.userId} className="flex items-center gap-2 text-xs">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        p.status === 'online' ? 'bg-green-400' : p.status === 'busy' ? 'bg-yellow-400' : 'bg-slate-600'
                      }`} />
                      <span className="text-slate-300 truncate font-medium">{p.name}</span>
                      {hasPttSupervisorControls && p.userId !== user?.id && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded border border-red-900 bg-red-950/60 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void handleForceDisconnect(p.userId, p.name)}
                          disabled={disconnectingUserId === p.userId}
                          title="Force disconnect PTT session"
                        >
                          {disconnectingUserId === p.userId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <PhoneOff className="h-3 w-3" />
                          )}
                          Drop
                        </button>
                      )}
                      <span className="text-slate-600 capitalize ml-auto shrink-0">{p.role}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Transmission log */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-widest px-3 pt-3 pb-1.5 shrink-0">
                <Play className="h-3 w-3" />
                Transmission Log
              </div>
              <ScrollArea className="flex-1 px-3">
                <div className="space-y-1 pb-3">
                  {allTxLog.length === 0 ? (
                    <p className="text-xs text-slate-600 py-2">No recent transmissions</p>
                  ) : (
                    allTxLog.map((entry) => (
                      <div
                        key={entry.id}
                        className={`flex items-start gap-2 py-1.5 border-b border-slate-800 ${entry.isEmergency ? 'text-red-400' : 'text-slate-300'}`}
                      >
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-xs truncate">{entry.callsign}</span>
                            {entry.isLive ? (
                              <span className="text-[9px] text-green-400 animate-pulse shrink-0">LIVE</span>
                            ) : (
                              <span className="text-[9px] text-slate-500 tabular-nums shrink-0">
                                {formatDuration(entry.durationSeconds)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            <span className="uppercase">{entry.channelName}</span>
                            <span>·</span>
                            <span className="tabular-nums">
                              {new Date(entry.createdAt).toLocaleTimeString('en-NZ', {
                                timeZone: 'Pacific/Auckland', hour12: false, hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          </div>
                          {entry.transcript && (
                            <div className="mt-1 text-[11px] text-slate-400 italic leading-snug break-words">
                              "{entry.transcript}"
                            </div>
                          )}
                            {radioFeatureFlags.syntheticAudioEnabled && recentSyntheticRenders.length > 0 && (
                              <div className="mt-0.5">
                                <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[8px] uppercase tracking-wide bg-violet-900/60 text-violet-300 border border-violet-700/50">
                                  Synthetic relay
                                </span>
                              </div>
                            )}
                        </div>
                        {entry.isEmergency && (
                          <AlertTriangle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

              {/* Live Caption Panel — Phase 2, gated by radioFeatureFlags.captionsEnabled */}
              {radioFeatureFlags.captionsEnabled && (
                <div className="border-t border-slate-800 shrink-0">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-widest px-3 pt-2 pb-1">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${captionsUnavailable ? 'bg-red-500' : captionsDelayed ? 'bg-amber-400 animate-pulse' : 'bg-green-500 animate-pulse'}`}
                    />
                    {captionsUnavailable ? 'Live Captions Unavailable' : captionsDelayed ? 'Live Captions Delayed' : 'Live Captions'}
                    {lowConfidenceCaptionCount > 0 && (
                      <span className="ml-1 inline-flex items-center rounded border border-amber-700/70 bg-amber-900/40 px-1 py-0 text-[8px] uppercase tracking-wide text-amber-200">
                        {lowConfidenceCaptionCount} low-confidence
                      </span>
                    )}
                  </div>
                  <ScrollArea className="h-20 px-3 pb-2">
                    {captionsUnavailable ? (
                      <p className="text-[11px] text-red-400 italic">{captionUnavailableReason}</p>
                    ) : captionsDelayed ? (
                      <p className="text-[11px] text-amber-300 italic">Caption stream delayed for current transmission…</p>
                    ) : liveCaptions.length === 0 ? (
                      <p className="text-[11px] text-slate-600 italic">
                        {captionProcessorEnabled ? 'Waiting for captions…' : 'Caption pipeline standby…'}
                      </p>
                    ) : (
                      <div className="space-y-0.5">
                        {recentCaptions.map((seg) => (
                          (() => {
                            const isLowConfidence = isLowConfidenceCaption(seg)

                            return (
                              <div
                                key={`${seg.transmissionId}-${seg.sequenceNum}`}
                                className={`text-[11px] leading-snug ${seg.isFinal ? isLowConfidence ? 'text-amber-300' : 'text-slate-300' : 'text-slate-500 italic'}`}
                              >
                                {seg.text}
                                {isLowConfidence && (
                                  <span className="ml-1 inline-flex items-center rounded border border-amber-700/70 bg-amber-900/40 px-1 py-0 text-[8px] uppercase tracking-wide text-amber-200">
                                    Low confidence
                                  </span>
                                )}
                                {!seg.isFinal && (
                                  <span className="text-slate-600 animate-pulse"> …</span>
                                )}
                              </div>
                            )
                          })()
                        ))}
                      </div>
                    )}
                  </ScrollArea>

                  {radioFeatureFlags.translationEnabled && (
                    <div className="border-t border-slate-800 px-3 pt-2 pb-2">
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-widest pb-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        Live Translation ({interpreterTargetLanguage})
                        {lowConfidenceTranslationCount > 0 && (
                          <span className="ml-1 inline-flex items-center rounded border border-amber-700/70 bg-amber-900/40 px-1 py-0 text-[8px] uppercase tracking-wide text-amber-200">
                            {lowConfidenceTranslationCount} low-confidence
                          </span>
                        )}
                      </div>

                      {recentTranslations.length === 0 ? (
                        <p className="text-[11px] text-slate-600 italic">Waiting for translations…</p>
                      ) : (
                        <div className="space-y-0.5 max-h-16 overflow-y-auto pr-1">
                          {recentTranslations.map((seg) => (
                            <div
                              key={`${seg.transcriptSegmentId}-${seg.targetLanguage}`}
                              className={`text-[11px] leading-snug ${seg.isLowConfidence ? 'text-amber-300' : 'text-cyan-200'}`}
                            >
                              {seg.text}
                              {seg.isLowConfidence && (
                                <span className="ml-1 inline-flex items-center rounded border border-amber-700/70 bg-amber-900/40 px-1 py-0 text-[8px] uppercase tracking-wide text-amber-200">
                                  Low confidence
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {radioFeatureFlags.syntheticAudioEnabled && (
                        <div className="mt-2 border-t border-slate-800/80 pt-2">
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-widest pb-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                            Translated Audio Relay
                            <span className="inline-flex items-center rounded border border-violet-700/70 bg-violet-900/35 px-1 py-0 text-[8px] uppercase tracking-wide text-violet-200">
                              Synthetic
                            </span>
                            {delayedSyntheticRenderCount > 0 && (
                              <span className="ml-1 inline-flex items-center rounded border border-amber-700/70 bg-amber-900/40 px-1 py-0 text-[8px] uppercase tracking-wide text-amber-200">
                                {delayedSyntheticRenderCount} delayed
                              </span>
                            )}
                          </div>

                          {recentSyntheticRenders.length === 0 ? (
                            <p className="text-[11px] text-slate-600 italic">Waiting for translated audio renders…</p>
                          ) : (
                            <div className="space-y-0.5 max-h-14 overflow-y-auto pr-1">
                              {recentSyntheticRenders.map((render) => {
                                const isDelayed = (render.renderLatencyMs ?? 0) > SYNTHETIC_RELAY_DELAY_THRESHOLD_MS
                                return (
                                  <div
                                    key={`${render.translationSegmentId}-${render.targetLanguage}`}
                                    className={`text-[11px] leading-snug ${isDelayed ? 'text-amber-300' : 'text-violet-200'}`}
                                  >
                                    {render.provider}
                                    {render.renderLatencyMs != null && (
                                      <span className="ml-1 text-[10px] text-slate-400">{render.renderLatencyMs} ms</span>
                                    )}
                                    {isDelayed && (
                                      <span className="ml-1 inline-flex items-center rounded border border-amber-700/70 bg-amber-900/40 px-1 py-0 text-[8px] uppercase tracking-wide text-amber-200">
                                        Delayed
                                      </span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            {/* Recent clips from PTT store */}
            {lastClips.length > 0 && (
              <div className="border-t border-slate-800 p-3 shrink-0">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Last Clip</div>
                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <button
                    className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    onClick={() => lastClips[0]?.clipUrl && new Audio(lastClips[0].clipUrl).play()}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Replay
                  </button>
                  <span className="text-slate-600">{lastClips[0]?.senderName}</span>
                  <span className="text-slate-600 tabular-nums ml-auto">
                    {lastClips[0]?.duration ? formatDuration(lastClips[0].duration) : ''}
                  </span>
                </div>
                {isTranscribing && (
                  <div className="mt-1 text-[10px] text-slate-500 italic">Transcribing…</div>
                )}
                {!isTranscribing && lastClipTranscript && (
                  <div className="mt-1 text-[11px] text-slate-300 italic leading-snug">
                    "{lastClipTranscript}"
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </AppLayout>
  )
}
