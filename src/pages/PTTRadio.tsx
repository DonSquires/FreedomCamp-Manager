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
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import {
  usePTTStore,
  usePTTAvailable,
  usePTTCanSpeak,
} from '@/stores/pttStore'
import {
  connectToPTT,
  ensureMicrophonePermission,
  getPTTDiagnostics,
  type PTTDiagnostics,
  startSpeaking,
  stopSpeaking,
  startVoxMonitoring,
  stopVoxMonitoring,
  setVoxThreshold,
  toggleMute,
  initBluetoothPTT,
  normalizePTTErrorMessage,
} from '@/lib/ptt'
import { requestWakeLock, releaseWakeLock, requestNotificationPermission } from '@/lib/pttBackground'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
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
}

interface TransmissionEntry {
  id: string
  callsign: string
  name: string
  channelName: string
  channelNumber: number
  durationSeconds: number
  createdAt: string
  isEmergency: boolean
  isLive: boolean
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
  primary: 0, dispatch: 1, team: 2, incident: 3, welfare: 4, admin: 5, emergency: 99,
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getChannelScope(channel: RadioChannel, effectiveOrgId: string): string {
  // Persisted channel rows use UUID ids and map to unique deployment scopes.
  // Fallback defaults are non-UUID and use org scope to stay valid.
  if (UUID_RE.test(channel.id)) {
    return `deployment:${channel.id}`
  }
  return `org:${effectiveOrgId}`
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
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const queryClient = useQueryClient()

  // PTT store state
  const connectionStatus = usePTTStore((s) => s.connectionStatus)
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
  const error = usePTTStore((s) => s.error)
  const setInputMode = usePTTStore((s) => s.setInputMode)
  const setVoxEnabled = usePTTStore((s) => s.setVoxEnabled)
  const setError = usePTTStore((s) => s.setError)

  const isAvailable = usePTTAvailable()
  const canSpeak = usePTTCanSpeak()

  // Component state
  const [activeChannel, setActiveChannel] = useState<RadioChannel | null>(null)
  const [isTransmitting, setIsTransmitting] = useState(false)
  const [scanMode, setScanMode] = useState(false)
  const [scanIndex, setScanIndex] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [emergencyMode, setEmergencyMode] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [callsign, setCallsign] = useState('')
  const [txLog, setTxLog] = useState<TransmissionEntry[]>([])
  const [currentTxStart, setCurrentTxStart] = useState<Date | null>(null)
  const [liveTxSeconds, setLiveTxSeconds] = useState(0)
  const [showNotificationHint, setShowNotificationHint] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [microphoneReady, setMicrophoneReady] = useState(false)
  const [microphoneError, setMicrophoneError] = useState<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [diagnostics, setDiagnostics] = useState<PTTDiagnostics>(() => getPTTDiagnostics())

  const pttButtonRef = useRef<HTMLButtonElement>(null)
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveTxTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wakeLockRef = useRef(false)
  const txLogUnavailableRef = useRef(false)
  const seedRpcUnavailableRef = useRef(false)

  // ── Org ID ────────────────────────────────────────────────
  const effectiveOrgId = useMemo(
    () =>
      user?.role === 'master' || user?.role === 'grand_master'
        ? organizationId || user?.organization_id || null
        : user?.organization_id || null,
    [organizationId, user?.organization_id, user?.role],
  )

  // ── Load channels from DB ─────────────────────────────────
  const { data: dbChannels, isLoading: loadingChannels } = useQuery<RadioChannel[]>({
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
        // Seed defaults for this org
        if (!seedRpcUnavailableRef.current) {
          const { error: seedError } = await (supabase as any).rpc('seed_default_ptt_channels', { p_organization_id: effectiveOrgId })
          if (seedError) {
            // Seeding is best-effort only; do not block radio if rpc is unavailable or rejected.
            seedRpcUnavailableRef.current = true
          }
        }
        // Retry fetch
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

  const channels = useMemo(() => {
    const source = dbChannels?.length ? dbChannels : DEFAULT_CHANNELS
    return [...source].sort(
      (a, b) =>
        (CHANNEL_TYPE_ORDER[a.channel_type] ?? 50) - (CHANNEL_TYPE_ORDER[b.channel_type] ?? 50) ||
        a.channel_number - b.channel_number,
    )
  }, [dbChannels])

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

  const rosterWithSelf = useMemo(() => {
    const base = [...presence]
    if (!user?.id) return base

    const selfName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email || 'You'
    const selfRole = user.role || 'officer'
    const selfStatus = isSpeaking ? 'busy' : 'online'

    const withoutSelf = base.filter((p) => p.userId !== user.id)
    return [{ userId: user.id, name: selfName, role: selfRole, status: selfStatus }, ...withoutSelf]
  }, [presence, user?.id, user?.first_name, user?.last_name, user?.email, user?.role, isSpeaking])

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

  // ── Connect to default channel on mount ───────────────────
  useEffect(() => {
    if (!effectiveOrgId || channels.length === 0) return
    if (connectionStatus === 'connected' && channelId) return // already connected

    const primary = channels.find((c) => c.channel_type === 'primary') ?? channels[0]
    if (primary) {
      setActiveChannel(primary)
      connectToChannel(primary)
    }
  }, [effectiveOrgId, channels.length, connectionStatus])

  // ── Notification permission prompt ───────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (Notification.permission === 'default') setShowNotificationHint(true)
    requestNotificationPermission()
  }, [])

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
  }, [speakerId, isSpeaking])

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
  }, [isAvailable, canSpeak, isMuted])

  // ── Scanner mode ─────────────────────────────────────────
  useEffect(() => {
    if (!scanMode) {
      if (scanTimerRef.current) { clearInterval(scanTimerRef.current); scanTimerRef.current = null }
      return
    }
    const nonEmergency = channels.filter((c) => c.channel_type !== 'emergency')
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
    }, 2500)

    return () => { if (scanTimerRef.current) clearInterval(scanTimerRef.current) }
  }, [scanMode, channels, speakerId])

  // ── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
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
  // Channel connection
  // ─────────────────────────────────────────────────────────

  const connectToChannel = useCallback(
    async (channel: RadioChannel) => {
      if (!effectiveOrgId) return
      setIsConnecting(true)
      setError(null)

      const channelScope = getChannelScope(channel, effectiveOrgId)

      try {
        await connectToPTT(channelScope, channel.name)
        setActiveChannel(channel)
      } catch (err) {
        const msg = normalizePTTErrorMessage(err)
        setError(msg)
        toast.error(msg)
      } finally {
        setIsConnecting(false)
      }
    },
    [effectiveOrgId, setError],
  )

  const handleChannelSelect = useCallback(
    (channel: RadioChannel) => {
      if (isTransmitting) return // don't switch while transmitting
      setScanMode(false)
      connectToChannel(channel)
    },
    [isTransmitting, connectToChannel],
  )

  // ─────────────────────────────────────────────────────────
  // PTT transmit
  // ─────────────────────────────────────────────────────────

  const handlePTTPress = useCallback(async () => {
    if (!canSpeak || !isAvailable || isTransmitting) return

    try {
      if (!microphoneReady) {
        await ensureMicrophonePermission()
        setMicrophoneReady(true)
        setMicrophoneError(null)
      }
      await startSpeaking()
      setIsTransmitting(true)
      playStatusTone('tx_start')

      // Wake lock to keep screen on while transmitting
      if (!wakeLockRef.current) {
        requestWakeLock().then((ok) => { wakeLockRef.current = ok })
      }
    } catch (err) {
      const msg = normalizePTTErrorMessage(err)
      setMicrophoneError(msg)
      toast.error(msg)
    }
  }, [canSpeak, isAvailable, isTransmitting, microphoneReady])

  const handlePTTRelease = useCallback(async () => {
    if (!isTransmitting) return
    const startTime = currentTxStart ?? new Date()
    const durationSeconds = (Date.now() - startTime.getTime()) / 1000

    try {
      await stopSpeaking()
    } catch {
      // ignore — still need to update UI
    }

    setIsTransmitting(false)
    playStatusTone('tx_end')

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
      isEmergency: emergencyMode,
      isLive: false,
    }
    setTxLog((prev) => [entry, ...prev].slice(0, 60))

    // Persist to DB (best-effort)
    if (effectiveOrgId && user?.id && !txLogUnavailableRef.current) {
      ;(supabase as any)
        .from('ptt_transmission_log')
        .insert({
          organization_id: effectiveOrgId,
          channel_number: activeChannel?.channel_number ?? 0,
          channel_name: activeChannel?.name ?? '',
          speaker_id: user.id,
          speaker_name: entry.name,
          speaker_callsign: callsign || '',
          duration_seconds: durationSeconds,
          is_emergency: emergencyMode,
        })
        .then(({ error: e }: any) => {
          if (e) {
            if (e.code === 'PGRST205' || e.code === '42P01') {
              txLogUnavailableRef.current = true
              return
            }
            console.error('PTT TX log persist error:', e)
          }
          else queryClient.invalidateQueries({ queryKey: ['ptt-tx-log', effectiveOrgId] })
        })
    }

    setEmergencyMode(false)
  }, [isTransmitting, currentTxStart, callsign, user, activeChannel, emergencyMode, effectiveOrgId, queryClient])

  const handleEmergencyBroadcast = useCallback(async () => {
    if (!effectiveOrgId) return
    const emergencyChannel = channels.find((c) => c.channel_type === 'emergency')
    if (emergencyChannel) {
      await connectToChannel(emergencyChannel)
    }
    setEmergencyMode(true)
    playStatusTone('emergency')
    toast.warning('EMERGENCY MODE — transmitting on all channels', { duration: 5000 })
    await handlePTTPress()
  }, [effectiveOrgId, channels, connectToChannel, handlePTTPress])

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
                            } ${isEmergencyCh ? 'border border-red-800' : 'border border-transparent'}`}
                            style={isActive ? { borderColor: ch.color, boxShadow: `0 0 12px ${ch.color}33` } : {}}
                            onClick={() => {
                              handleChannelSelect(ch)
                              setMobileMenuOpen(false)
                            }}
                          >
                            <div className="flex flex-col items-center justify-center w-9 h-9 rounded bg-slate-900/80 shrink-0">
                              <span className="text-[9px] text-slate-500 uppercase leading-tight">CH</span>
                              <span className="text-base font-bold leading-tight" style={{ color: ch.color }}>
                                {isEmergencyCh ? '🚨' : ch.channel_number}
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
                <span className="text-xs text-slate-400 uppercase">CH {activeChannel.channel_number}</span>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeChannel.color }} />
                <span className="font-bold text-white text-sm tracking-wide">{activeChannel.name.toUpperCase()}</span>
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
        {error && (
          <div className="px-4 py-2 bg-red-950 border-b border-red-800 text-xs text-red-300 flex items-center gap-2 shrink-0">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
            {error}
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
            <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs text-red-300 hover:text-white"
              onClick={() => { setError(null); if (activeChannel) connectToChannel(activeChannel) }}>
              <RefreshCw className="h-3 w-3 mr-1" />Retry
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
                        } ${isEmergencyCh ? 'border border-red-800' : 'border border-transparent'}`}
                        style={isActive ? { borderColor: ch.color, boxShadow: `0 0 12px ${ch.color}33` } : {}}
                        onClick={() => handleChannelSelect(ch)}
                      >
                        <div className="flex flex-col items-center justify-center w-9 h-9 rounded bg-slate-900/80 shrink-0">
                          <span className="text-[9px] text-slate-500 uppercase leading-tight">CH</span>
                          <span className="text-base font-bold leading-tight" style={{ color: ch.color }}>
                            {isEmergencyCh ? '🚨' : ch.channel_number}
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
                  CH {activeChannel.channel_number} · {activeChannel.name.toUpperCase()}
                </div>
              </div>
            )}

            {/* Speaker indicator (when someone else is talking) */}
            {someoneSpeaking && (
              <div className="flex items-center gap-2 px-5 py-2 rounded-lg bg-green-950 border border-green-700 animate-pulse">
                <Volume2 className="h-4 w-4 text-green-400" />
                <span className="text-green-300 text-sm font-bold">{speakerName || 'Unknown'}</span>
                <span className="text-green-500 text-xs">transmitting…</span>
              </div>
            )}

            {/* Main PTT Button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    ref={pttButtonRef}
                    className={`select-none rounded-full flex items-center justify-center transition-all duration-100 border-4 ${
                      isTransmitting
                        ? 'bg-red-600 border-red-400 shadow-[0_0_40px_#dc262680] scale-105'
                        : emergencyMode
                        ? 'bg-red-900 border-red-600 animate-pulse'
                        : canSpeak && !isMuted
                        ? 'bg-slate-800 border-slate-600 hover:bg-slate-700 hover:border-blue-500 hover:shadow-[0_0_20px_#3b82f633] active:scale-95'
                        : 'bg-slate-900 border-slate-800 opacity-50 cursor-not-allowed'
                    }`}
                    style={{ width: 160, height: 160 }}
                    onMouseDown={(e) => { e.preventDefault(); handlePTTPress() }}
                    onMouseUp={handlePTTRelease}
                    onMouseLeave={() => { if (isTransmitting) handlePTTRelease() }}
                    onTouchStart={(e) => { e.preventDefault(); handlePTTPress() }}
                    onTouchEnd={(e) => { e.preventDefault(); handlePTTRelease() }}
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
                        <Mic className={`h-10 w-10 ${canSpeak ? 'text-slate-300' : 'text-slate-600'}`} />
                      )}
                      <span className={`text-xs font-bold tracking-widest uppercase ${
                        isTransmitting ? 'text-white' : isMuted ? 'text-red-400' : 'text-slate-400'
                      }`}>
                        {isTransmitting
                          ? `TX  ${formatDuration(liveTxSeconds)}`
                          : isMuted
                          ? 'MUTED'
                          : connectionStatus !== 'connected'
                          ? connectionStatus.toUpperCase()
                          : 'PTT'}
                      </span>
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Hold to transmit · Spacebar shortcut
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="text-[10px] text-slate-600 uppercase tracking-widest">
              {inputMode === 'vox' ? 'VOX MODE ACTIVE' : 'Hold button or hold SPACEBAR to transmit'}
            </div>

            {/* Audio level meter */}
            <div className="flex flex-col items-center gap-1.5 w-full max-w-xs">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest">Audio Level</div>
              <AudioLevelMeter level={audioLevel} transmitting={isTransmitting} />
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] text-slate-400"
                    onClick={() => setDiagnostics(getPTTDiagnostics())}
                  >
                    Refresh
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-slate-500">Connection</div>
                  <div className="text-slate-200 uppercase">{diagnostics.connectionStatus}</div>
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
              </div>
            )}

            {/* Emergency broadcast button */}
            <button
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm tracking-widest uppercase border-2 transition-all ${
                isTransmitting && emergencyMode
                  ? 'bg-red-600 border-red-400 text-white animate-pulse shadow-[0_0_30px_#dc2626]'
                  : 'bg-red-950 border-red-800 text-red-400 hover:bg-red-900 hover:border-red-600 hover:text-red-300'
              }`}
              onMouseDown={handleEmergencyBroadcast}
              onMouseUp={handlePTTRelease}
              onTouchStart={(e) => { e.preventDefault(); handleEmergencyBroadcast() }}
              onTouchEnd={(e) => { e.preventDefault(); handlePTTRelease() }}
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
              </div>
            )}
          </div>

        </div>
      </div>
    </AppLayout>
  )
}
