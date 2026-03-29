/**
 * PTT Library - Push-to-Talk WebRTC & WebSocket Utilities
 * 
 * Provides:
 * - WebSocket connection management to PTT signaling server
 * - WebRTC audio stream handling
 * - Microphone capture with noise suppression
 * - Audio playback for incoming streams
 * - Fallback clip upload to Supabase Storage
 */

import { supabase } from './supabase'
import { edgeFunctions } from './edgeFunctions'
import { usePTTStore, PTTPresence, PTTClip } from '@/stores/pttStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PTTTokenResponse {
  token: string
  channelScope: string
  expiresIn: number
  iceServers: RTCIceServer[]
  wsUrl: string
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
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let pingInterval: ReturnType<typeof setInterval> | null = null
let localStream: MediaStream | null = null
const peerConnections: Map<string, RTCPeerConnection> = new Map()
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const audioContext: AudioContext | null = null
let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []

// ---------------------------------------------------------------------------
// Token Management
// ---------------------------------------------------------------------------

/**
 * Request a PTT channel token from the Edge Function
 */
export async function requestPTTToken(channelScope: string): Promise<PTTTokenResponse> {
  const { data, error } = await edgeFunctions.pttSignalingToken({ channelScope })

  if (error) throw new Error(error)
  if (!data) throw new Error('No token data received')

  return data as PTTTokenResponse
}

// ---------------------------------------------------------------------------
// WebSocket Connection
// ---------------------------------------------------------------------------

/**
 * Connect to the PTT signaling server
 */
export async function connectToPTT(channelScope: string): Promise<void> {
  const store = usePTTStore.getState()

  // Disconnect existing connection
  if (ws) {
    disconnectFromPTT()
  }

  store.setConnection('connecting')
  store.setChannel(channelScope, channelScope.split(':')[0] as 'org' | 'incident' | 'direct')

  try {
    // Get token from Edge Function
    const tokenData = await requestPTTToken(channelScope)

    store.setConnection('connecting', tokenData.wsUrl, tokenData.token)
    store.setIceServers(tokenData.iceServers)

    // Connect WebSocket
    ws = new WebSocket(`${tokenData.wsUrl}?token=${tokenData.token}`)

    ws.onopen = () => {
      console.log('🎤 PTT: Connected to signaling server')
      store.setConnection('connected')
      startPingInterval()
    }

    ws.onclose = (event) => {
      console.log('🎤 PTT: Disconnected', event.code, event.reason)
      cleanupConnection()
      
      if (event.code !== 1000 && event.code !== 4001 && event.code !== 4002) {
        // Attempt reconnect for unexpected disconnects
        store.setConnection('reconnecting')
        scheduleReconnect(channelScope)
      } else {
        store.setConnection('disconnected')
      }
    }

    ws.onerror = (error) => {
      console.error('🎤 PTT: WebSocket error', error)
      store.setError('Connection error')
    }

    ws.onmessage = (event) => {
      handleServerMessage(JSON.parse(event.data))
    }
  } catch (error: any) {
    console.error('🎤 PTT: Connection failed', error)
    store.setConnection('error')
    store.setError(error.message || 'Failed to connect')
    throw error
  }
}

/**
 * Disconnect from the PTT signaling server
 */
export function disconnectFromPTT(): void {
  cleanupConnection()
  usePTTStore.getState().reset()
}

/**
 * Clean up connection resources
 */
function cleanupConnection(): void {
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

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop())
    localStream = null
  }

  if (mediaRecorder) {
    mediaRecorder.stop()
    mediaRecorder = null
  }
  recordedChunks = []
}

/**
 * Schedule a reconnection attempt
 */
function scheduleReconnect(channelScope: string): void {
  if (reconnectTimeout) return

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null
    connectToPTT(channelScope).catch((err) => {
      console.error('🎤 PTT: Reconnect failed', err)
    })
  }, 3000)
}

/**
 * Start ping interval to keep connection alive
 */
function startPingInterval(): void {
  if (pingInterval) clearInterval(pingInterval)

  pingInterval = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }))
    }
  }, 30000)
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
      }
      if (message.speakerId) {
        store.setSpeaker(message.speakerId)
      }
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
      store.setError(message.message || 'Server error')
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

  let pc = peerConnections.get(fromUserId)

  if (!pc) {
    // Create new peer connection for incoming offer
    pc = createPeerConnection(fromUserId)
    peerConnections.set(fromUserId, pc)
  }

  try {
    if (signal.type === 'offer' && signal.sdp) {
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      sendSignal(fromUserId, { type: 'answer', sdp: answer.sdp })
    } else if (signal.type === 'answer' && signal.sdp) {
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
    } else if (signal.type === 'candidate' && signal.candidate) {
      await pc.addIceCandidate(signal.candidate)
    }
  } catch (error) {
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
  })

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(peerId, { type: 'candidate', candidate: event.candidate.toJSON() })
    }
  }

  pc.ontrack = (event) => {
    // Play incoming audio
    const audio = new Audio()
    audio.srcObject = event.streams[0]
    audio.play().catch(console.error)
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      peerConnections.delete(peerId)
      pc.close()
    }
  }

  return pc
}

function sendSignal(targetUserId: string, signal: SignalMessage['signal']): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'signal', targetUserId, signal }))
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

  if (store.isMuted || !store.audioEnabled) {
    throw new Error('Audio is muted or disabled')
  }

  if (store.speakerId && !store.isSpeaking) {
    throw new Error('Channel is busy')
  }

  try {
    // Request microphone
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    // Start recording for fallback clip
    recordedChunks = []
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

    // Broadcast to peers via WebRTC
    for (const [peerId, pc] of peerConnections) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream!)
      })

      // Create offer for peers
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      sendSignal(peerId, { type: 'offer', sdp: offer.sdp })
    }
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
      duration = Math.round(blob.size / 8000) // Rough estimate

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

  // Get signed URL
  const { data: signedData } = await supabase.storage
    .from('ptt-clips')
    .createSignedUrl(data.path, 86400) // 24 hour expiry

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
