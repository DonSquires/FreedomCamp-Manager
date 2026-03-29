/**
 * PTT Store - Push-to-Talk State Management
 * 
 * Manages PTT state including:
 * - Current channel (org-wide, incident, direct)
 * - Connection status
 * - Speaking state (who's talking)
 * - Presence (who's online)
 * - Audio mute state
 * - Last clip metadata for replay
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** User presence in a PTT channel */
export interface PTTPresence {
  userId: string
  name: string
  role: string
  status: 'online' | 'busy' | 'offshift'
}

/** Audio clip metadata */
export interface PTTClip {
  id: string
  senderId: string
  senderName: string
  channelId: string
  clipUrl?: string
  duration?: number
  createdAt: string
}

/** WebSocket connection status */
export type PTTConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

interface PTTState {
  // Connection
  connectionStatus: PTTConnectionStatus
  wsUrl: string | null
  token: string | null
  iceServers: RTCIceServer[]

  // Channel
  channelId: string | null
  channelType: 'org' | 'incident' | 'direct' | null

  // Speaking
  isSpeaking: boolean
  speakerId: string | null
  speakerName: string | null

  // Presence
  presence: PTTPresence[]

  // Audio
  isMuted: boolean
  audioEnabled: boolean

  // Clips
  lastClips: PTTClip[]
  maxClipsToKeep: number

  // Error
  error: string | null

  // Actions
  setConnection: (status: PTTConnectionStatus, wsUrl?: string, token?: string) => void
  setIceServers: (servers: RTCIceServer[]) => void
  setChannel: (channelId: string | null, type?: 'org' | 'incident' | 'direct' | null) => void
  setSpeaking: (isSpeaking: boolean) => void
  setSpeaker: (speakerId: string | null, speakerName?: string | null) => void
  setPresence: (presence: PTTPresence[]) => void
  addPresence: (user: PTTPresence) => void
  removePresence: (userId: string) => void
  updatePresenceStatus: (userId: string, status: PTTPresence['status']) => void
  setMuted: (muted: boolean) => void
  setAudioEnabled: (enabled: boolean) => void
  addClip: (clip: PTTClip) => void
  setError: (error: string | null) => void
  reset: () => void
}

const initialState = {
  connectionStatus: 'disconnected' as PTTConnectionStatus,
  wsUrl: null,
  token: null,
  iceServers: [],
  channelId: null,
  channelType: null,
  isSpeaking: false,
  speakerId: null,
  speakerName: null,
  presence: [],
  isMuted: false,
  audioEnabled: true,
  lastClips: [],
  maxClipsToKeep: 10,
  error: null,
}

export const usePTTStore = create<PTTState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setConnection: (status, wsUrl, token) =>
        set({
          connectionStatus: status,
          ...(wsUrl !== undefined && { wsUrl }),
          ...(token !== undefined && { token }),
          ...(status === 'connected' && { error: null }),
        }),

      setIceServers: (servers) => set({ iceServers: servers }),

      setChannel: (channelId, type) =>
        set({
          channelId,
          channelType: type ?? null,
          // Reset state when changing channels
          presence: [],
          speakerId: null,
          speakerName: null,
          isSpeaking: false,
        }),

      setSpeaking: (isSpeaking) => set({ isSpeaking }),

      setSpeaker: (speakerId, speakerName) =>
        set({ speakerId, speakerName: speakerName ?? null }),

      setPresence: (presence) => set({ presence }),

      addPresence: (user) =>
        set((state) => {
          // Don't add duplicates
          if (state.presence.some((p) => p.userId === user.userId)) {
            return { presence: state.presence.map((p) => (p.userId === user.userId ? user : p)) }
          }
          return { presence: [...state.presence, user] }
        }),

      removePresence: (userId) =>
        set((state) => ({
          presence: state.presence.filter((p) => p.userId !== userId),
        })),

      updatePresenceStatus: (userId, status) =>
        set((state) => ({
          presence: state.presence.map((p) => (p.userId === userId ? { ...p, status } : p)),
        })),

      setMuted: (muted) => set({ isMuted: muted }),

      setAudioEnabled: (enabled) => set({ audioEnabled: enabled }),

      addClip: (clip) =>
        set((state) => {
          const clips = [clip, ...state.lastClips].slice(0, state.maxClipsToKeep)
          return { lastClips: clips }
        }),

      setError: (error) => set({ error }),

      reset: () => set(initialState),
    }),
    {
      name: 'ptt-state',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Only persist non-sensitive state
      partialize: (state) => ({
        isMuted: state.isMuted,
        audioEnabled: state.audioEnabled,
        maxClipsToKeep: state.maxClipsToKeep,
      }),
    }
  )
)

/**
 * Selector for checking if PTT is available
 */
export const usePTTAvailable = () =>
  usePTTStore((state) => state.connectionStatus === 'connected' && state.channelId !== null)

/**
 * Selector for checking if user can speak
 */
export const usePTTCanSpeak = () =>
  usePTTStore(
    (state) =>
      state.connectionStatus === 'connected' &&
      !state.isMuted &&
      state.audioEnabled &&
      (state.speakerId === null || state.isSpeaking)
  )
