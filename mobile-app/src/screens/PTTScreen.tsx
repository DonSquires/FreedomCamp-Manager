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
 *  - Graceful disconnect on screen blur / app background
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { Audio } from 'expo-av'

import { supabase } from '../lib/supabase'
import { uploadPTTClip } from '../lib/pttAudio'
import { useAuthStore } from '../stores/authStore'
import { highVis } from '../lib/highVisTheme'

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
const PTT_SERVER_URL: string = (
  process.env.EXPO_PUBLIC_PTT_SERVER_URL || 'wss://ptt.yourdomain.com'
).replace(/\/$/, '')

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

type ServerMessage = SyncMessage | PresenceMessage | SpeakerMessage | SpeakingMessage | EmergencyMessage | ErrorMessage

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildWsUrl(channelId: string, token: string): string {
  return `${PTT_SERVER_URL}/ws?channel=${encodeURIComponent(channelId)}&token=${encodeURIComponent(token)}`
}

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

  // ------------------------------------------------------------------
  // Connect to PTT server
  // ------------------------------------------------------------------
  const connect = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setWsStatus('connecting')
    setWsError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setWsStatus('error')
        setWsError('Not authenticated – please log in again.')
        return
      }

      const url = buildWsUrl(channelId, token)
      const ws = new WebSocket(url, ['ptt.v2'])
      wsRef.current = ws

      ws.onopen = () => setWsStatus('connected')

      ws.onerror = () => {
        setWsStatus('error')
        setWsError('Connection failed. Tap to retry.')
      }

      ws.onclose = () => {
        if (wsStatus !== 'error') setWsStatus('disconnected')
        wsRef.current = null
      }

      ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data as string)
          handleMessage(msg)
        } catch {
          // ignore malformed frames
        }
      }
    } catch (err: any) {
      setWsStatus('error')
      setWsError(err?.message ?? 'Unknown error')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  const disconnect = useCallback(() => {
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
    wsRef.current?.close()
    wsRef.current = null
    setWsStatus('disconnected')
    setTransmitting(false)
    setUploading(false)
    setPresence([])
    setSpeakerId(null)
    setEmergency(null)
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
  }, [user?.id, playClip])

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
      staysActiveInBackground: false,
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
  }, [transmitting, channelId, orgId, user?.id])

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
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true })
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
  // Lifecycle
  // ------------------------------------------------------------------
  useFocusEffect(
    useCallback(() => {
      connect()
      return () => disconnect()
    }, [connect, disconnect])
  )

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
