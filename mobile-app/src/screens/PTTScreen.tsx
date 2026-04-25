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
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Audio } from 'expo-av'

import { supabase } from '../lib/supabase'
import { edgeFunctions } from '../lib/edgeFunctions'
import { uploadPTTClip } from '../lib/pttAudio'
import { useAuthStore } from '../stores/authStore'
import { highVis } from '../lib/highVisTheme'

const MIN_TOKEN_REFRESH_DELAY_MS = 15_000

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
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const connectionStartedAtRef = useRef<number | null>(null)
  const [degradedMode, setDegradedMode] = useState(false)

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
  }, [playClip, user?.id])

  const clearTokenRefreshTimer = useCallback(() => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current)
      tokenRefreshTimerRef.current = null
    }
  }, [])

  const scheduleTokenRefresh = useCallback((expiresInSeconds?: number) => {
    clearTokenRefreshTimer()

    const ttl = Number.isFinite(expiresInSeconds) && (expiresInSeconds || 0) > 0
      ? Number(expiresInSeconds)
      : 300
    const delayMs = Math.max(MIN_TOKEN_REFRESH_DELAY_MS, Math.floor(ttl * 1000 * 0.5))

    tokenRefreshTimerRef.current = setTimeout(() => {
      tokenRefreshTimerRef.current = null
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
      const { data, error } = await edgeFunctions.transcribeAudio({ clip_url: clipUrl, language: 'en' })
      if (error) return

      const transcript = String((data as any)?.transcript ?? (data as any)?.text ?? '').trim()
      if (!transcript || !insertedId) return

      await (supabase as any)
        .from('ptt_transmission_log')
        .update({ transcript })
        .eq('id', insertedId)
    } catch {
      // best effort only
    }
  }, [channelId, emergency?.active, orgId, user])

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
      const { data, error } = await edgeFunctions.pttSignalingToken({ channelScope: channelId })
      if (error || !data?.token || !data?.wsUrl) {
        setWsStatus('error')
        setWsError(error || 'Unable to mint PTT token.')
        return
      }

      const tokenData = data as PTTTokenResponse
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

          // Proxy chains may reject long subprotocol headers; retry once with query-token auth.
          if (!attemptedFallback && mode === 'subprotocol' && event.code !== 1000) {
            openSocket('query', true)
            return
          }

          setWsStatus('disconnected')
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
    // Unload any playing sound
    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {})
      soundRef.current = null
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
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        connect().catch(() => {})
      }
    }, 8000)

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
      clearInterval(degradedTimer)
      disconnect()
    }
  }, [connect, disconnect, wsStatus])

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
        </View>
      </View>

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
            style={[styles.pttButton, transmitting && styles.pttButtonActive]}
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
  pttContainer: {
    paddingHorizontal: highVis.spacing.md,
    paddingBottom: highVis.spacing.lg,
    alignItems: 'center',
  },
  pttButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: highVis.colors.nightSurface,
    borderWidth: 3,
    borderColor: highVis.colors.nightTextSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
    color: highVis.colors.nightTextPrimary,
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
