/**
 * PTT Library - Push-to-Talk WebRTC & WebSocket Utilities
 * 
 * Provides:
 * - WebSocket connection management to PTT signaling server
 * - WebRTC audio stream handling
 * - Microphone capture with noise suppression
 * - Audio playback for incoming streams
 * - Fallback clip upload to Supabase Storage
 * - VOX (Voice Operated Exchange) mode
 * - Bluetooth headset support with PTT button mapping
 */

import { supabase } from './supabase'
import { edgeFunctions } from './edgeFunctions'
import { usePTTStore, PTTPresence, PTTClip, PTTChannelType } from '@/stores/pttStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PTTTokenResponse {
  token: string
  channelScope: string
  expiresIn: number
  iceServers: RTCIceServer[]
  wsUrl: string
  iceTransportPolicy?: RTCIceTransportPolicy
  transport?: {
    turnConfigured?: boolean
    forceTurnRelay?: boolean
  }
}

interface SignalMessage {
  type: 'signal'
  fromUserId: string
  fromName: string
  signal: {
    type: 'offer' | 'answer' | 'candidate'
    sdp?: string
    candidate?: RTCIceCandidateInit
  }
}

interface PTTMessage {
  type: string
  event?: string
  userId?: string
  name?: string
  role?: string
  status?: string
  presence?: PTTPresence[]
  channelId?: string
  speakerId?: string
  clipUrl?: string
  duration?: number
  timestamp?: string
  signal?: SignalMessage['signal']
  fromUserId?: string
  fromName?: string
  code?: string
  message?: string
  transport?: {
    turnConfigured?: boolean
    forceTurnRelay?: boolean
    iceTransportPolicy?: RTCIceTransportPolicy
  }
}

export interface PTTDiagnostics {
  connectionStatus: string
  channelScope: string | null
  requestedChannelScope: string | null
  websocketReadyState: string
  reconnectAttempts: number
  activePeerConnections: number
  peerStates: Array<{
    peerId: string
    connectionState: RTCPeerConnectionState
    iceConnectionState: RTCIceConnectionState
    signalingState: RTCSignalingState
    iceGatheringState: RTCIceGatheringState
  }>
  transport: {
    turnConfigured: boolean
    forceTurnRelay: boolean
    iceTransportPolicy: RTCIceTransportPolicy
  }
  lastClose: {
    code: number | null
    reason: string | null
  }
  lastNegotiationAttempt: {
    at: string | null
    peerId: string | null
    stage: string | null
  }
  lastNegotiationError: {
    at: string | null
    peerId: string | null
    message: string | null
  }
  lastTransmitAttempt: {
    at: string | null
    presenceCount: number
    microphoneReady: boolean
    channelScope: string | null
  }
  iceCandidates: {
    sent: number
    received: number
    gatherComplete: number
    errors: number
    lastError: string | null
  }
}

async function requestLocalAudioStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch (strictError) {
    // Some mobile browsers reject strict constraints; fallback to basic audio.
    return await navigator.mediaDevices.getUserMedia({ audio: true })
  }
}

export async function ensureMicrophonePermission(): Promise<boolean> {
  const testStream = await requestLocalAudioStream()
  testStream.getTracks().forEach((track) => track.stop())
  return true
}

function extractPTTBackendCode(raw: string): string | null {
  const patterns = [
    /\[code:\s*(\d{3})\]/i,
    /\bhttp\s*(\d{3})\b/i,
    /\bstatus\s*(\d{3})\b/i,
  ]

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match?.[1]) return match[1]
  }

  return null
}

export function normalizePTTErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || 'Failed to connect')
  const text = raw.toLowerCase()
  const code = extractPTTBackendCode(raw)
  const codeSuffix = code ? ` (Code ${code})` : ''

  // Most common production failure mode: token edge function unavailable.
  // Keep this non-blocking and user-friendly because text chat can still work.
  if (
    text.includes('unable to reach the edge function') ||
    text.includes('not be deployed') ||
    text.includes('network connectivity issue') ||
    text.includes('failed to fetch')
  ) {
    return `Push to Talk is currently unavailable. You can continue using text chat.${codeSuffix}`
  }

  if (text.includes('unauthorized') || text.includes('[code: 401]') || text.includes('invalid user token')) {
    return `Push to Talk authorization failed. Please sign in again.${codeSuffix}`
  }

  if (text.includes('no organization') || text.includes('profile not found')) {
    return `Push to Talk requires an assigned organization profile. Please contact an administrator.${codeSuffix}`
  }

  if (text.includes('ptt server not configured') || text.includes('ptt proxy secret not configured')) {
    return `Push to Talk server configuration is incomplete. Please contact an administrator.${codeSuffix}`
  }

  return raw
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 8
let pingInterval: ReturnType<typeof setInterval> | null = null
let activeChannelScope: string | null = null  // Tracks the last requested scope for visibility-triggered reconnects
let lastRequestedChannelScope: string | null = null

// Reconnect when the page/tab becomes visible again (handles mobile browser backgrounding).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (!activeChannelScope) return
    // If the WS is gone or closing, reconnect immediately without waiting for backoff.
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      console.log('🎤 PTT: Page visible – reconnecting dropped WS', activeChannelScope)
      reconnectAttempts = 0
      connectToPTT(activeChannelScope).catch((err) => {
        console.error('🎤 PTT: Visibility reconnect failed', err)
      })
    }
  })
}
let localStream: MediaStream | null = null
const peerConnections: Map<string, RTCPeerConnection> = new Map()
let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
let recordingStartTime: number | null = null
const remoteAudioElements: Map<string, HTMLAudioElement> = new Map()
let currentIceTransportPolicy: RTCIceTransportPolicy = 'all'
const peerConnectionStates: Map<string, {
  connectionState: RTCPeerConnectionState
  iceConnectionState: RTCIceConnectionState
  signalingState: RTCSignalingState
  iceGatheringState: RTCIceGatheringState
}> = new Map()
const pendingIceCandidates: Map<string, RTCIceCandidateInit[]> = new Map()
let turnConfigured = false
let forceTurnRelay = false
let lastSocketCloseCode: number | null = null
let lastSocketCloseReason: string | null = null
let lastNegotiationAttemptAt: string | null = null
let lastNegotiationPeerId: string | null = null
let lastNegotiationStage: string | null = null
let lastNegotiationErrorAt: string | null = null
let lastNegotiationErrorPeerId: string | null = null
let lastNegotiationErrorMessage: string | null = null
let lastTransmitAttemptAt: string | null = null
let lastTransmitPresenceCount = 0
let lastTransmitMicrophoneReady = false
let lastTransmitChannelScope: string | null = null
let iceCandidatesSent = 0
let iceCandidatesReceived = 0
let iceGatherCompleteCount = 0
let iceCandidateErrors = 0
let lastIceCandidateError: string | null = null

function markNegotiationAttempt(peerId: string, stage: string): void {
  lastNegotiationAttemptAt = new Date().toISOString()
  lastNegotiationPeerId = peerId
  lastNegotiationStage = stage
}

function markNegotiationError(peerId: string, error: unknown, stage: string): void {
  markNegotiationAttempt(peerId, stage)
  lastNegotiationErrorAt = new Date().toISOString()
  lastNegotiationErrorPeerId = peerId
  lastNegotiationErrorMessage = error instanceof Error ? error.message : String(error)
}

function clearNegotiationError(): void {
  lastNegotiationErrorAt = null
  lastNegotiationErrorPeerId = null
  lastNegotiationErrorMessage = null
}

async function flushPendingIceCandidates(peerId: string, pc: RTCPeerConnection): Promise<void> {
  const pending = pendingIceCandidates.get(peerId)
  if (!pending || pending.length === 0) return

  for (const candidate of pending) {
    try {
      await pc.addIceCandidate(candidate)
      iceCandidatesReceived++
      markNegotiationAttempt(peerId, 'queued_candidate_applied')
    } catch (error) {
      markNegotiationError(peerId, error, 'queued_candidate_apply_failed')
      console.warn('🎤 PTT: Failed queued ICE candidate apply', peerId, error)
    }
  }

  pendingIceCandidates.delete(peerId)
}

function markTransmitAttempt(presenceCount: number, microphoneReady: boolean): void {
  const store = usePTTStore.getState()
  lastTransmitAttemptAt = new Date().toISOString()
  lastTransmitPresenceCount = presenceCount
  lastTransmitMicrophoneReady = microphoneReady
  lastTransmitChannelScope = store.channelId || activeChannelScope || null
}

function applyTransportDiagnostics(transport?: {
  turnConfigured?: boolean
  forceTurnRelay?: boolean
  iceTransportPolicy?: RTCIceTransportPolicy
}): void {
  if (!transport) return

  turnConfigured = !!transport.turnConfigured
  forceTurnRelay = !!transport.forceTurnRelay

  if (transport.iceTransportPolicy === 'relay') {
    currentIceTransportPolicy = 'relay'
  } else {
    currentIceTransportPolicy = 'all'
  }

  if (transport.forceTurnRelay && !transport.turnConfigured) {
    const store = usePTTStore.getState()
    store.setError('Push to Talk relay is required but TURN is not configured on the signaling server.')
  }

  if (!transport.turnConfigured) {
    console.warn('🎤 PTT: TURN is not configured; live audio may fail across NAT/carrier networks')
  }
}

function getOrCreateRemoteAudio(peerId: string): HTMLAudioElement {
  let audio = remoteAudioElements.get(peerId)
  if (audio) return audio

  audio = new Audio()
  audio.autoplay = true
  audio.controls = false
  audio.muted = false
  audio.volume = 1
  audio.setAttribute('playsinline', 'true')
  audio.setAttribute('webkit-playsinline', 'true')
  audio.style.position = 'fixed'
  audio.style.width = '1px'
  audio.style.height = '1px'
  audio.style.opacity = '0'
  audio.style.pointerEvents = 'none'
  audio.style.bottom = '0'
  audio.style.left = '0'
  document.body.appendChild(audio)

  remoteAudioElements.set(peerId, audio)
  return audio
}

function getWebSocketReadyStateLabel(socket: WebSocket | null): string {
  if (!socket) return 'none'
  switch (socket.readyState) {
    case WebSocket.CONNECTING:
      return 'connecting'
    case WebSocket.OPEN:
      return 'open'
    case WebSocket.CLOSING:
      return 'closing'
    case WebSocket.CLOSED:
      return 'closed'
    default:
      return 'unknown'
  }
}

export function getPTTDiagnostics(): PTTDiagnostics {
  const store = usePTTStore.getState()
  return {
    connectionStatus: store.connectionStatus,
    channelScope: store.channelId || null,
    requestedChannelScope: lastRequestedChannelScope,
    websocketReadyState: getWebSocketReadyStateLabel(ws),
    reconnectAttempts,
    activePeerConnections: peerConnections.size,
    peerStates: Array.from(peerConnectionStates.entries()).map(([peerId, state]) => ({
      peerId,
      connectionState: state.connectionState,
      iceConnectionState: state.iceConnectionState,
      signalingState: state.signalingState,
      iceGatheringState: state.iceGatheringState,
    })),
    transport: {
      turnConfigured,
      forceTurnRelay,
      iceTransportPolicy: currentIceTransportPolicy,
    },
    lastClose: {
      code: lastSocketCloseCode,
      reason: lastSocketCloseReason,
    },
    lastNegotiationAttempt: {
      at: lastNegotiationAttemptAt,
      peerId: lastNegotiationPeerId,
      stage: lastNegotiationStage,
    },
    lastNegotiationError: {
      at: lastNegotiationErrorAt,
      peerId: lastNegotiationErrorPeerId,
      message: lastNegotiationErrorMessage,
    },
    lastTransmitAttempt: {
      at: lastTransmitAttemptAt,
      presenceCount: lastTransmitPresenceCount,
      microphoneReady: lastTransmitMicrophoneReady,
      channelScope: lastTransmitChannelScope,
    },
    iceCandidates: {
      sent: iceCandidatesSent,
      received: iceCandidatesReceived,
      gatherComplete: iceGatherCompleteCount,
      errors: iceCandidateErrors,
      lastError: lastIceCandidateError,
    },
  }
}

// VOX state
let audioContext: AudioContext | null = null
let analyserNode: AnalyserNode | null = null
let voxCheckInterval: ReturnType<typeof setInterval> | null = null
let voxSilenceTimeout: ReturnType<typeof setTimeout> | null = null
const VOX_SILENCE_DELAY_MS = 500 // Stop transmitting after 500ms of silence

// Bluetooth state
let bluetoothMediaSession: MediaSession | null = null

// ---------------------------------------------------------------------------
// Token Management
// ---------------------------------------------------------------------------

/**
 * Request a PTT channel token from the Edge Function
 */
export async function requestPTTToken(channelScope: string): Promise<PTTTokenResponse> {
  const { data, error } = await edgeFunctions.pttSignalingToken({ channelScope })

  if (error) throw new Error(normalizePTTErrorMessage(error))
  if (!data) throw new Error('No token data received')

  return data as PTTTokenResponse
}

// ---------------------------------------------------------------------------
// WebSocket Connection
// ---------------------------------------------------------------------------

/**
 * Connect to the PTT signaling server
 */
export async function connectToPTT(channelScope: string, channelName?: string): Promise<void> {
  const store = usePTTStore.getState()
  lastRequestedChannelScope = channelScope

  // If already connected (or connecting) to the same channel, avoid churn.
  const sameChannel = store.channelId === channelScope
  if (sameChannel && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    if (channelName) {
      const currentType = channelScope.split(':')[0] as PTTChannelType
      store.setChannel(channelScope, currentType, channelName)
    }
    return
  }

  // Disconnect existing connection
  if (ws) {
    disconnectFromPTT()
  }

  store.setConnection('connecting')
  const channelType = channelScope.split(':')[0] as PTTChannelType
  store.setChannel(channelScope, channelType, channelName || null)
  activeChannelScope = channelScope  // Remember for visibility-triggered reconnects

  try {
    // Get token from Edge Function
    const tokenData = await requestPTTToken(channelScope)

    store.setConnection('connecting', tokenData.wsUrl, tokenData.token)
    store.setIceServers(tokenData.iceServers)
    applyTransportDiagnostics(tokenData.transport || {
      turnConfigured: tokenData.iceServers.some((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
        return urls.some((url) => typeof url === 'string' && (url.startsWith('turn:') || url.startsWith('turns:')))
      }),
      forceTurnRelay: tokenData.iceTransportPolicy === 'relay',
      iceTransportPolicy: tokenData.iceTransportPolicy,
    })

    // Connect WebSocket
    const socket = new WebSocket(`${tokenData.wsUrl}?token=${tokenData.token}`)
    ws = socket

    socket.onopen = () => {
      if (ws !== socket) return
      console.log('🎤 PTT: Connected to signaling server')
      reconnectAttempts = 0
      lastSocketCloseCode = null
      lastSocketCloseReason = null
      store.setConnection('connected')
      startPingInterval()
    }

    socket.onclose = (event) => {
      if (ws !== socket) return
      console.log('🎤 PTT: Disconnected', event.code, event.reason)
      lastSocketCloseCode = event.code
      lastSocketCloseReason = event.reason || null
      cleanupConnection()

      if (event.code === 4000) {
        // Older socket replaced by a newer session. Do not auto-reconnect.
        store.setConnection('disconnected')
        return
      }

      if (event.code === 4001 || event.code === 4002) {
        // Token/auth failures are terminal until backend config or auth state is corrected.
        store.setConnection('error')
        store.setError('Push to Talk authorization failed. Please sign in again or contact support.')
        return
      }

      if (event.code === 4003) {
        store.setConnection('error')
        store.setError('Push to Talk channel is full. Please try again shortly.')
        return
      }

      if (event.code !== 1000) {
        // Attempt reconnect for unexpected disconnects
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          store.setConnection('error')
          store.setError('Push to Talk connection lost. Please refresh the page to reconnect.')
          return
        }
        store.setConnection('reconnecting')
        scheduleReconnect(channelScope)
      } else {
        reconnectAttempts = 0
        store.setConnection('disconnected')
      }
    }

    socket.onerror = (_error) => {
      if (ws !== socket) return
      // onerror always fires before onclose and carries no useful message (isTrusted:true only).
      // Let onclose drive state and reconnect logic.
      console.warn('🎤 PTT: WebSocket transport error — waiting for close event')
    }

    socket.onmessage = (event) => {
      if (ws !== socket) return
      handleServerMessage(JSON.parse(event.data))
    }
  } catch (error: any) {
    console.error('🎤 PTT: Connection failed', error)
    const normalizedMessage = normalizePTTErrorMessage(error)
    store.setConnection('error')
    store.setError(normalizedMessage)
    throw new Error(normalizedMessage)
  }
}

/**
 * Disconnect from the PTT signaling server
 */
export function disconnectFromPTT(): void {
  activeChannelScope = null  // Stop visibility-triggered reconnects after an intentional disconnect
  cleanupConnection()
  usePTTStore.getState().reset()
}

/**
 * Clean up connection resources
 */
function cleanupConnection(): void {
  reconnectAttempts = 0
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }

  if (pingInterval) {
    clearInterval(pingInterval)
    pingInterval = null
  }

  if (ws) {
    ws.close(1000, 'User disconnect')
    ws = null
  }

  // Clean up WebRTC
  peerConnections.forEach((pc) => pc.close())
  peerConnections.clear()
  peerConnectionStates.clear()
  pendingIceCandidates.clear()

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop())
    localStream = null
  }

  if (mediaRecorder) {
    mediaRecorder.stop()
    mediaRecorder = null
  }
  recordedChunks = []

  // Clean up any active remote audio playback elements.
  remoteAudioElements.forEach((audio) => {
    try {
      audio.pause()
      audio.srcObject = null
      audio.remove()
    } catch {
      // Ignore cleanup failures.
    }
  })
  remoteAudioElements.clear()
  clearNegotiationError()
  lastNegotiationAttemptAt = null
  lastNegotiationPeerId = null
  lastNegotiationStage = null
  lastTransmitAttemptAt = null
  lastTransmitPresenceCount = 0
  lastTransmitMicrophoneReady = false
  lastTransmitChannelScope = null
  iceCandidatesSent = 0
  iceCandidatesReceived = 0
  iceGatherCompleteCount = 0
  iceCandidateErrors = 0
  lastIceCandidateError = null
}

/**
 * Schedule a reconnection attempt
 */
function scheduleReconnect(channelScope: string): void {
  if (reconnectTimeout) return

  reconnectAttempts++
  // Exponential backoff: 2s, 4s, 8s, 16s … capped at 30s
  const delay = Math.min(2000 * Math.pow(2, reconnectAttempts - 1), 30000)
  console.log(`🎤 PTT: Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`)

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null
    connectToPTT(channelScope).catch((err) => {
      console.error('🎤 PTT: Reconnect failed', err)
    })
  }, delay)
}

/**
 * Start ping interval to keep connection alive
 */
function startPingInterval(): void {
  if (pingInterval) clearInterval(pingInterval)

  // 10 second interval keeps mobile browser WebSockets alive before iOS/Android kills idle connections.
  pingInterval = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }))
    } else if (ws && ws.readyState !== WebSocket.CONNECTING) {
      // WS died silently (common on mobile). scheduleReconnect will be triggered by onclose.
      // If somehow onclose never fired, force a cleanup so the next visibility event recovers.
      console.warn('🎤 PTT: Ping found dead socket, clearing')
      ws = null
    }
  }, 10000)
}

// ---------------------------------------------------------------------------
// Message Handling
// ---------------------------------------------------------------------------

/**
 * Handle incoming server messages
 */
function handleServerMessage(message: PTTMessage): void {
  const store = usePTTStore.getState()

  switch (message.type) {
    case 'sync':
      // Initial sync on connect
      if (message.presence) {
        store.setPresence(message.presence)

        // If user starts speaking before sync arrives, negotiate as soon as
        // peers become visible to avoid missing the first live transmission.
        if (store.isSpeaking && localStream) {
          for (const peer of message.presence) {
            if (!peer.userId) continue
            void negotiatePeerAudio(peer.userId)
          }
        }
      }
      if (message.speakerId) {
        store.setSpeaker(message.speakerId)
      }
      applyTransportDiagnostics(message.transport)
      break

    case 'presence':
      handlePresenceMessage(message)
      break

    case 'speaking':
      handleSpeakingMessage(message)
      break

    case 'signal':
      handleSignalMessage(message as SignalMessage)
      break

    case 'error':
      console.error('🎤 PTT: Server error', message.code, message.message)
      store.setError(normalizePTTErrorMessage(message.message || 'Server error'))
      break

    case 'pong':
      // Heartbeat response - no action needed
      break

    default:
      console.warn('🎤 PTT: Unknown message type', message.type)
  }
}

function handlePresenceMessage(message: PTTMessage): void {
  const store = usePTTStore.getState()

  switch (message.event) {
    case 'join':
      if (message.userId && message.name && message.role) {
        store.addPresence({
          userId: message.userId,
          name: message.name,
          role: message.role,
          status: 'online',
        })

        // If we are already speaking, immediately negotiate audio with the new peer.
        if (store.isSpeaking && localStream) {
          void negotiatePeerAudio(message.userId)
        }
      }
      break

    case 'leave':
      if (message.userId) {
        store.removePresence(message.userId)
      }
      break

    case 'status':
      if (message.userId && message.status) {
        store.updatePresenceStatus(message.userId, message.status as PTTPresence['status'])
      }
      break
  }
}

function handleSpeakingMessage(message: PTTMessage): void {
  const store = usePTTStore.getState()

  switch (message.event) {
    case 'start':
      store.setSpeaker(message.userId || null, message.name || null)
      break

    case 'stop':
      store.setSpeaker(null)
      // Add clip to history if available
      if (message.clipUrl && message.userId) {
        const clip: PTTClip = {
          id: crypto.randomUUID(),
          senderId: message.userId,
          senderName: message.name || 'Unknown',
          channelId: store.channelId || '',
          clipUrl: message.clipUrl,
          duration: message.duration,
          createdAt: message.timestamp || new Date().toISOString(),
        }
        store.addClip(clip)
      }
      break
  }
}

async function handleSignalMessage(message: SignalMessage): Promise<void> {
  const store = usePTTStore.getState()
  const fromUserId = message.fromUserId
  const signal = message.signal

  markNegotiationAttempt(fromUserId, `incoming_${signal.type}`)

  let pc = peerConnections.get(fromUserId)

  if (!pc) {
    // Create new peer connection for incoming offer
    pc = createPeerConnection(fromUserId)
    peerConnections.set(fromUserId, pc)
  }

  try {
    if (signal.type === 'offer' && signal.sdp) {
      clearNegotiationError()
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
      markNegotiationAttempt(fromUserId, 'remote_offer_applied')
      await flushPendingIceCandidates(fromUserId, pc)
      const answer = await pc.createAnswer()
      markNegotiationAttempt(fromUserId, 'answer_created')
      await pc.setLocalDescription(answer)
      markNegotiationAttempt(fromUserId, 'answer_sent')

      sendSignal(fromUserId, { type: 'answer', sdp: answer.sdp })
    } else if (signal.type === 'answer' && signal.sdp) {
      clearNegotiationError()
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
      markNegotiationAttempt(fromUserId, 'remote_answer_applied')
      await flushPendingIceCandidates(fromUserId, pc)
    } else if (signal.type === 'candidate' && signal.candidate) {
      if (!pc.remoteDescription) {
        const queue = pendingIceCandidates.get(fromUserId) || []
        queue.push(signal.candidate)
        pendingIceCandidates.set(fromUserId, queue)
        markNegotiationAttempt(fromUserId, 'candidate_queued')
      } else {
        await pc.addIceCandidate(signal.candidate)
        iceCandidatesReceived++
        markNegotiationAttempt(fromUserId, 'candidate_applied')
      }
    }
  } catch (error) {
    markNegotiationError(fromUserId, error, `incoming_${signal.type}_failed`)
    console.error('🎤 PTT: Signal handling error', error)
  }
}

// ---------------------------------------------------------------------------
// WebRTC
// ---------------------------------------------------------------------------

function createPeerConnection(peerId: string): RTCPeerConnection {
  const store = usePTTStore.getState()

  const pc = new RTCPeerConnection({
    iceServers: store.iceServers,
    iceTransportPolicy: currentIceTransportPolicy,
  })

  peerConnectionStates.set(peerId, {
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    signalingState: pc.signalingState,
    iceGatheringState: pc.iceGatheringState,
  })

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      iceCandidatesSent++
      sendSignal(peerId, { type: 'candidate', candidate: event.candidate.toJSON() })
    } else {
      iceGatherCompleteCount++
    }
  }

  pc.ontrack = (event) => {
    // Keep a persistent audio element per peer for stable playback on mobile/desktop.
    const audio = getOrCreateRemoteAudio(peerId)

    audio.srcObject = event.streams[0]
    audio.play().catch((playErr) => {
      console.error('🎤 PTT: Remote audio autoplay blocked', playErr)
    })
  }

  pc.oniceconnectionstatechange = () => {
    console.log('🎤 PTT: ICE state', peerId, pc.iceConnectionState)
    const current = peerConnectionStates.get(peerId)
    peerConnectionStates.set(peerId, {
      connectionState: current?.connectionState || pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState,
      iceGatheringState: current?.iceGatheringState || pc.iceGatheringState,
    })
    if (pc.iceConnectionState === 'failed') {
      const store = usePTTStore.getState()
      store.setError('Live PTT audio path failed (ICE). TURN relay may be required for cross-network audio.')
    }
  }

  pc.onicecandidateerror = (event) => {
    iceCandidateErrors++
    lastIceCandidateError = `${event.errorCode}: ${event.errorText || 'unknown'}`
    console.warn('🎤 PTT: ICE candidate error', peerId, event.errorCode, event.errorText)
  }

  pc.onconnectionstatechange = () => {
    const current = peerConnectionStates.get(peerId)
    peerConnectionStates.set(peerId, {
      connectionState: pc.connectionState,
      iceConnectionState: current?.iceConnectionState || pc.iceConnectionState,
      signalingState: pc.signalingState,
      iceGatheringState: current?.iceGatheringState || pc.iceGatheringState,
    })
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      peerConnections.delete(peerId)
      peerConnectionStates.delete(peerId)
      pc.close()
    }
  }

  pc.onsignalingstatechange = () => {
    const current = peerConnectionStates.get(peerId)
    peerConnectionStates.set(peerId, {
      connectionState: current?.connectionState || pc.connectionState,
      iceConnectionState: current?.iceConnectionState || pc.iceConnectionState,
      signalingState: pc.signalingState,
      iceGatheringState: current?.iceGatheringState || pc.iceGatheringState,
    })
  }

  pc.onicegatheringstatechange = () => {
    const current = peerConnectionStates.get(peerId)
    peerConnectionStates.set(peerId, {
      connectionState: current?.connectionState || pc.connectionState,
      iceConnectionState: current?.iceConnectionState || pc.iceConnectionState,
      signalingState: current?.signalingState || pc.signalingState,
      iceGatheringState: pc.iceGatheringState,
    })
  }

  return pc
}

function sendSignal(targetUserId: string, signal: SignalMessage['signal']): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'signal', targetUserId, signal }))
  }
}

/**
 * Ensure a peer connection exists and send an offer using the current local stream.
 */
async function negotiatePeerAudio(peerId: string): Promise<void> {
  if (!localStream) return

  try {
    markNegotiationAttempt(peerId, 'begin_offer')

    let pc = peerConnections.get(peerId)
    if (!pc) {
      markNegotiationAttempt(peerId, 'creating_peer')
      pc = createPeerConnection(peerId)
      peerConnections.set(peerId, pc)
      markNegotiationAttempt(peerId, 'peer_created')
    }

    for (const track of localStream.getTracks()) {
      const alreadySending = pc.getSenders().some((s) => s.track?.id === track.id)
      if (!alreadySending) {
        pc.addTrack(track, localStream)
      }
    }

    if (pc.signalingState !== 'stable') {
      // If signaling got stuck (e.g. interrupted prior negotiation), rebuild the peer
      // so the next offer can proceed cleanly.
      try {
        pc.close()
      } catch {
        // Ignore close errors.
      }
      peerConnections.delete(peerId)
      markNegotiationAttempt(peerId, 'recreating_peer')
      pc = createPeerConnection(peerId)
      peerConnections.set(peerId, pc)
      markNegotiationAttempt(peerId, 'peer_rebuilt')

      for (const track of localStream.getTracks()) {
        const alreadySending = pc.getSenders().some((s) => s.track?.id === track.id)
        if (!alreadySending) {
          pc.addTrack(track, localStream)
        }
      }
    }

    const offer = await pc.createOffer()
    markNegotiationAttempt(peerId, 'offer_created')
    await pc.setLocalDescription(offer)
    markNegotiationAttempt(peerId, 'offer_local_set')
    sendSignal(peerId, { type: 'offer', sdp: offer.sdp })
    markNegotiationAttempt(peerId, 'offer_sent')
    clearNegotiationError()
  } catch (error) {
    markNegotiationError(peerId, error, 'negotiate_failed')
    throw error
  }
}

// ---------------------------------------------------------------------------
// Audio Capture
// ---------------------------------------------------------------------------

/**
 * Start speaking (hold-to-talk)
 */
export async function startSpeaking(): Promise<void> {
  const store = usePTTStore.getState()
  markTransmitAttempt(store.presence.length, false)

  if (store.isMuted || !store.audioEnabled) {
    throw new Error('Audio is muted or disabled')
  }

  if (store.speakerId && !store.isSpeaking) {
    throw new Error('Channel is busy')
  }

  try {
    // Request microphone with mobile-safe fallback.
    localStream = await requestLocalAudioStream()
    markTransmitAttempt(store.presence.length, true)

    // Start recording for fallback clip
    recordedChunks = []
    recordingStartTime = Date.now()
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    
    mediaRecorder = new MediaRecorder(localStream, { mimeType })
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data)
      }
    }
    mediaRecorder.start(100) // Collect data every 100ms

    // Notify server
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'start_speaking' }))
    }

    store.setSpeaking(true)
    console.log('🎤 PTT: Started speaking')

    const negotiatedPeerIds = new Set<string>()

    // Negotiate WebRTC with all currently present peers.
    for (const peer of store.presence) {
      if (!peer.userId) continue
      try {
        await negotiatePeerAudio(peer.userId)
        negotiatedPeerIds.add(peer.userId)
      } catch (peerErr) {
        console.error('🎤 PTT: Failed to negotiate peer audio', peer.userId, peerErr)
      }
    }

    // Presence can lag just behind push-to-talk on reconnect/join. Retry once
    // with fresh presence so late join/sync peers still get the live stream.
    setTimeout(() => {
      if (!usePTTStore.getState().isSpeaking || !localStream) return

      const latestPeers = usePTTStore.getState().presence
      for (const peer of latestPeers) {
        if (!peer.userId || negotiatedPeerIds.has(peer.userId)) continue
        void negotiatePeerAudio(peer.userId).then(() => {
          negotiatedPeerIds.add(peer.userId)
        }).catch((peerErr) => {
          console.error('🎤 PTT: Delayed peer negotiation failed', peer.userId, peerErr)
        })
      }
    }, 700)
  } catch (error: any) {
    console.error('🎤 PTT: Failed to start speaking', error)
    store.setError(error.message || 'Failed to access microphone')
    throw error
  }
}

/**
 * Stop speaking (release)
 */
export async function stopSpeaking(): Promise<void> {
  const store = usePTTStore.getState()

  if (!store.isSpeaking) return

  store.setSpeaking(false)

  // Stop recording and upload clip
  let clipUrl: string | undefined
  let duration: number | undefined

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()

    // Wait for final data
    await new Promise<void>((resolve) => {
      if (mediaRecorder) {
        mediaRecorder.onstop = () => resolve()
      } else {
        resolve()
      }
    })

    // Upload clip to Supabase Storage
    if (recordedChunks.length > 0) {
      const blob = new Blob(recordedChunks, { type: 'audio/webm' })
      // Calculate actual duration from recording start time
      duration = recordingStartTime
        ? Math.round((Date.now() - recordingStartTime) / 1000)
        : undefined

      try {
        const result = await uploadClip(blob, store.channelId || 'unknown')
        clipUrl = result.url
      } catch (error) {
        console.error('🎤 PTT: Failed to upload clip', error)
      }
    }
  }

  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop())
    localStream = null
  }

  // Notify server
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop_speaking', clipUrl, duration }))
  }

  recordedChunks = []
  mediaRecorder = null
  recordingStartTime = null

  console.log('🎤 PTT: Stopped speaking')
}

/**
 * Upload audio clip to Supabase Storage
 */
async function uploadClip(blob: Blob, channelId: string): Promise<{ url: string }> {
  const filename = `${channelId}/${Date.now()}-${crypto.randomUUID()}.webm`

  const { data, error } = await supabase.storage
    .from('ptt-clips')
    .upload(filename, blob, {
      contentType: 'audio/webm',
      upsert: false,
    })

  if (error) throw error

  // Get signed URL with 24-hour expiry for clip playback
  // 24 hours (86400 seconds) allows replay during/after a shift while limiting long-term access
  const CLIP_URL_EXPIRY_SECONDS = 86400
  const { data: signedData } = await supabase.storage
    .from('ptt-clips')
    .createSignedUrl(data.path, CLIP_URL_EXPIRY_SECONDS)

  return { url: signedData?.signedUrl || '' }
}

// ---------------------------------------------------------------------------
// Audio Playback
// ---------------------------------------------------------------------------

/**
 * Play a recorded clip
 */
export async function playClip(clipUrl: string): Promise<void> {
  const audio = new Audio(clipUrl)
  await audio.play()
}

// ---------------------------------------------------------------------------
// Status Updates
// ---------------------------------------------------------------------------

/**
 * Update user status
 */
export function updateStatus(status: 'online' | 'busy' | 'offshift'): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'status', status }))
  }
}

/**
 * Toggle mute state
 */
export function toggleMute(): boolean {
  const store = usePTTStore.getState()
  const newMuted = !store.isMuted
  store.setMuted(newMuted)
  return newMuted
}

// ---------------------------------------------------------------------------
// VOX (Voice Operated Exchange) Mode
// ---------------------------------------------------------------------------

/**
 * Start VOX monitoring - automatically transmits when voice is detected
 */
export async function startVoxMonitoring(): Promise<void> {
  const store = usePTTStore.getState()

  if (store.inputMode !== 'vox') {
    store.setInputMode('vox')
  }

  try {
    // Get microphone for monitoring with mobile-safe fallback.
    const stream = await requestLocalAudioStream()

    // Create audio context for level monitoring
    audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    analyserNode = audioContext.createAnalyser()
    analyserNode.fftSize = 256
    analyserNode.smoothingTimeConstant = 0.8
    source.connect(analyserNode)

    // Start monitoring audio levels
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount)

    voxCheckInterval = setInterval(() => {
      if (!analyserNode) return

      analyserNode.getByteFrequencyData(dataArray)
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      const normalizedLevel = Math.round((average / 255) * 100)

      store.setAudioLevel(normalizedLevel)

      const threshold = store.voxThreshold
      const isSpeaking = store.isSpeaking

      // Start speaking if level exceeds threshold
      if (normalizedLevel >= threshold && !isSpeaking && store.voxEnabled) {
        if (voxSilenceTimeout) {
          clearTimeout(voxSilenceTimeout)
          voxSilenceTimeout = null
        }
        startSpeaking().catch(console.error)
      }

      // Stop speaking after silence delay
      if (normalizedLevel < threshold && isSpeaking) {
        if (!voxSilenceTimeout) {
          voxSilenceTimeout = setTimeout(() => {
            stopSpeaking().catch(console.error)
            voxSilenceTimeout = null
          }, VOX_SILENCE_DELAY_MS)
        }
      } else if (normalizedLevel >= threshold && voxSilenceTimeout) {
        clearTimeout(voxSilenceTimeout)
        voxSilenceTimeout = null
      }
    }, 50) // Check every 50ms

    store.setVoxEnabled(true)
    console.log('🎤 PTT: VOX monitoring started')
  } catch (error: any) {
    console.error('🎤 PTT: Failed to start VOX monitoring', error)
    store.setError(error.message || 'Failed to access microphone for VOX')
    throw error
  }
}

/**
 * Stop VOX monitoring
 */
export function stopVoxMonitoring(): void {
  const store = usePTTStore.getState()

  if (voxCheckInterval) {
    clearInterval(voxCheckInterval)
    voxCheckInterval = null
  }

  if (voxSilenceTimeout) {
    clearTimeout(voxSilenceTimeout)
    voxSilenceTimeout = null
  }

  if (audioContext) {
    audioContext.close().catch(console.error)
    audioContext = null
  }

  analyserNode = null
  store.setVoxEnabled(false)
  store.setAudioLevel(0)

  console.log('🎤 PTT: VOX monitoring stopped')
}

/**
 * Set VOX threshold (0-100)
 */
export function setVoxThreshold(threshold: number): void {
  const store = usePTTStore.getState()
  store.setVoxThreshold(Math.min(100, Math.max(0, threshold)))
}

// ---------------------------------------------------------------------------
// Bluetooth Support
// ---------------------------------------------------------------------------

/**
 * Initialize Bluetooth PTT button support using Media Session API
 * Maps the answer/hangup button to PTT (press=talk, release=stop)
 */
export function initBluetoothPTT(): void {
  const store = usePTTStore.getState()

  if (!('mediaSession' in navigator)) {
    console.warn('🎤 PTT: Media Session API not supported')
    store.setError('Bluetooth PTT not supported on this device')
    return
  }

  try {
    // Silent audio data URI enables the Media Session API for Bluetooth button access.
    // This is a minimal valid WAV file (44 bytes) that plays silently on loop to keep
    // the browser's media session active, allowing us to capture hardware button events.
    const SILENT_AUDIO_DATA_URI = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
    const silentAudio = new Audio()
    silentAudio.src = SILENT_AUDIO_DATA_URI
    silentAudio.loop = true

    // Set up Media Session handlers for Bluetooth buttons
    navigator.mediaSession.setActionHandler('play', () => {
      // Answer/Play button pressed - start talking
      console.log('🎤 PTT: Bluetooth PTT button pressed')
      store.setBluetoothPttButtonPressed(true)
      startSpeaking().catch(console.error)
    })

    navigator.mediaSession.setActionHandler('pause', () => {
      // Hangup/Pause button pressed - stop talking
      console.log('🎤 PTT: Bluetooth PTT button released')
      store.setBluetoothPttButtonPressed(false)
      stopSpeaking().catch(console.error)
    })

    navigator.mediaSession.setActionHandler('stop', () => {
      // Stop button - stop talking
      console.log('🎤 PTT: Bluetooth stop button pressed')
      store.setBluetoothPttButtonPressed(false)
      stopSpeaking().catch(console.error)
    })

    // Set metadata for Bluetooth display
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Push to Talk',
      artist: 'FieldOps Manager',
      album: 'PTT Channel',
    })

    // Play silent audio to keep Media Session active
    silentAudio.play().catch(() => {
      // Autoplay may be blocked - user interaction required
      console.log('🎤 PTT: Bluetooth PTT requires user interaction to activate')
    })

    bluetoothMediaSession = navigator.mediaSession
    store.setBluetoothEnabled(true)

    console.log('🎤 PTT: Bluetooth PTT initialized')
  } catch (error: any) {
    console.error('🎤 PTT: Failed to initialize Bluetooth PTT', error)
    store.setError(error.message || 'Failed to initialize Bluetooth PTT')
  }
}

/**
 * Clean up Bluetooth PTT handlers
 */
export function cleanupBluetoothPTT(): void {
  const store = usePTTStore.getState()

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', null)
    navigator.mediaSession.setActionHandler('pause', null)
    navigator.mediaSession.setActionHandler('stop', null)
    navigator.mediaSession.metadata = null
  }

  bluetoothMediaSession = null
  store.setBluetoothEnabled(false)
  store.setBluetoothPttButtonPressed(false)

  console.log('🎤 PTT: Bluetooth PTT cleaned up')
}

/**
 * Check if Bluetooth audio devices are available
 */
export async function getBluetoothDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter(
      (device) =>
        device.kind === 'audioinput' &&
        (device.label.toLowerCase().includes('bluetooth') ||
          device.label.toLowerCase().includes('wireless') ||
          device.label.toLowerCase().includes('headset'))
    )
  } catch (error) {
    console.error('🎤 PTT: Failed to enumerate Bluetooth devices', error)
    return []
  }
}

// ---------------------------------------------------------------------------
// Channel Helpers
// ---------------------------------------------------------------------------

/**
 * Connect to organization-wide channel (global call)
 */
export async function connectToOrgChannel(organizationId: string, orgName?: string): Promise<void> {
  await connectToPTT(`org:${organizationId}`, orgName || 'Organization')
}

/**
 * Connect to team/deployment channel
 */
export async function connectToTeamChannel(teamId: string, teamName?: string): Promise<void> {
  await connectToPTT(`team:${teamId}`, teamName || 'Team')
}

/**
 * Connect to deployment channel
 */
export async function connectToDeploymentChannel(deploymentId: string, deploymentName?: string): Promise<void> {
  await connectToPTT(`deployment:${deploymentId}`, deploymentName || 'Deployment')
}

/**
 * Connect to direct 1:1 channel (ad-hoc call)
 */
export async function connectToDirectChannel(targetUserId: string, targetUserName?: string): Promise<void> {
  await connectToPTT(`direct:${targetUserId}`, targetUserName || 'Direct')
}

/**
 * Connect to incident channel
 */
export async function connectToIncidentChannel(incidentId: string, incidentName?: string): Promise<void> {
  await connectToPTT(`incident:${incidentId}`, incidentName || 'Incident')
}

/**
 * Reconnect to the currently selected PTT channel.
 */
export async function reconnectCurrentPTTChannel(): Promise<void> {
  const { channelId, channelName } = usePTTStore.getState()
  if (!channelId) {
    throw new Error('No active PTT channel to reconnect')
  }

  await connectToPTT(channelId, channelName || undefined)
}
