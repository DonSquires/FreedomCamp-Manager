/**
 * PTT Store - Push-to-Talk State Management
 * 
 * Manages PTT state including:
 * - Current channel (org-wide, team/deployment, incident, direct)
 * - Connection status
 * - Speaking state (who's talking)
 * - Presence (who's online)
 * - Audio mute state
 * - Input mode (PTT, VOX, Toggle)
 * - Bluetooth device state
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

/** Input mode for PTT */
export type PTTInputMode = 'ptt' | 'vox' | 'toggle'

/** Channel type */
export type PTTChannelType = 'org' | 'team' | 'deployment' | 'incident' | 'direct'

/** Bluetooth device info */
export interface BluetoothDevice {
  id: string
  name: string
  connected: boolean
  batteryLevel?: number
}

interface PTTState {
  // Connection
  connectionStatus: PTTConnectionStatus
  wsUrl: string | null
  token: string | null
  iceServers: RTCIceServer[]

  // Channel
  channelId: string | null
  channelType: PTTChannelType | null
  channelName: string | null

  // Speaking
  isSpeaking: boolean
  speakerId: string | null
  speakerName: string | null

  // Presence
  presence: PTTPresence[]

  // Audio
  isMuted: boolean
  audioEnabled: boolean
  audioLevel: number // 0-100 for VOX visualization

  // Input Mode
  inputMode: PTTInputMode
  voxThreshold: number // 0-100, audio level to trigger VOX
  voxEnabled: boolean
  toggleState: boolean // For toggle mode: true = transmitting

  // Bluetooth
  bluetoothEnabled: boolean
  bluetoothDevice: BluetoothDevice | null
  bluetoothPttButtonPressed: boolean

  // Clips
  lastClips: PTTClip[]
  maxClipsToKeep: number

  // Emergency broadcast state (org-wide)
  emergencyBroadcastActive: boolean
  emergencyBroadcastInitiatedBy: string | null
  emergencyBroadcastInitiatedByName: string | null
  emergencyBroadcastAt: string | null

  // Error
  error: string | null

  // Degraded mode — PTT server unreachable for >15s (P1-6)
  degradedMode: boolean

  // Actions
  setConnection: (status: PTTConnectionStatus, wsUrl?: string, token?: string) => void
  setIceServers: (servers: RTCIceServer[]) => void
  setChannel: (channelId: string | null, type?: PTTChannelType | null, name?: string | null) => void
  setSpeaking: (isSpeaking: boolean) => void
  setSpeaker: (speakerId: string | null, speakerName?: string | null) => void
  setPresence: (presence: PTTPresence[]) => void
  addPresence: (user: PTTPresence) => void
  removePresence: (userId: string) => void
  updatePresenceStatus: (userId: string, status: PTTPresence['status']) => void
  setMuted: (muted: boolean) => void
  setAudioEnabled: (enabled: boolean) => void
  setAudioLevel: (level: number) => void
  setInputMode: (mode: PTTInputMode) => void
  setVoxThreshold: (threshold: number) => void
  setVoxEnabled: (enabled: boolean) => void
  setToggleState: (state: boolean) => void
  setBluetoothEnabled: (enabled: boolean) => void
  setBluetoothDevice: (device: BluetoothDevice | null) => void
  setBluetoothPttButtonPressed: (pressed: boolean) => void
  addClip: (clip: PTTClip) => void
  setEmergencyBroadcastState: (active: boolean, initiatedBy?: string | null, initiatedByName?: string | null, at?: string | null) => void
  setError: (error: string | null) => void
  setDegradedMode: (degraded: boolean) => void
  reset: () => void
}

const initialState = {
  connectionStatus: 'disconnected' as PTTConnectionStatus,
  wsUrl: null,
  token: null,
  iceServers: [],
  channelId: null,
  channelType: null,
  channelName: null,
  isSpeaking: false,
  speakerId: null,
  speakerName: null,
  presence: [],
  isMuted: false,
  audioEnabled: true,
  audioLevel: 0,
  inputMode: 'ptt' as PTTInputMode,
  voxThreshold: 30, // Default VOX threshold
  voxEnabled: false,
  toggleState: false,
  bluetoothEnabled: false,
  bluetoothDevice: null,
  bluetoothPttButtonPressed: false,
  lastClips: [],
  maxClipsToKeep: 10,
  emergencyBroadcastActive: false,
  emergencyBroadcastInitiatedBy: null,
  emergencyBroadcastInitiatedByName: null,
  emergencyBroadcastAt: null,
  error: null,
  degradedMode: false,
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

      setChannel: (channelId, type, name) =>
        set({
          channelId,
          channelType: type ?? null,
          channelName: name ?? null,
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

      setAudioLevel: (level) => set({ audioLevel: Math.min(100, Math.max(0, level)) }),

      setInputMode: (mode) => set({ inputMode: mode, toggleState: false }),

      setVoxThreshold: (threshold) => set({ voxThreshold: Math.min(100, Math.max(0, threshold)) }),

      setVoxEnabled: (enabled) => set({ voxEnabled: enabled }),

      setToggleState: (state) => set({ toggleState: state }),

      setBluetoothEnabled: (enabled) => set({ bluetoothEnabled: enabled }),

      setBluetoothDevice: (device) => set({ bluetoothDevice: device }),

      setBluetoothPttButtonPressed: (pressed) => set({ bluetoothPttButtonPressed: pressed }),

      addClip: (clip) =>
        set((state) => {
          const clips = [clip, ...state.lastClips].slice(0, state.maxClipsToKeep)
          return { lastClips: clips }
        }),

      setEmergencyBroadcastState: (active, initiatedBy, initiatedByName, at) =>
        set({
          emergencyBroadcastActive: active,
          emergencyBroadcastInitiatedBy: initiatedBy ?? null,
          emergencyBroadcastInitiatedByName: initiatedByName ?? null,
          emergencyBroadcastAt: at ?? null,
        }),

      setError: (error) => set({ error }),

      setDegradedMode: (degraded) => set({ degradedMode: degraded }),

      reset: () => set(initialState),
    }),
    {
      name: 'ptt-state',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // Only persist user preferences
      partialize: (state) => ({
        isMuted: state.isMuted,
        audioEnabled: state.audioEnabled,
        maxClipsToKeep: state.maxClipsToKeep,
        inputMode: state.inputMode,
        voxThreshold: state.voxThreshold,
        voxEnabled: state.voxEnabled,
        bluetoothEnabled: state.bluetoothEnabled,
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

/**
 * Selector for checking if VOX should trigger transmission
 */
export const usePTTVoxActive = () =>
  usePTTStore(
    (state) =>
      state.inputMode === 'vox' &&
      state.voxEnabled &&
      state.audioLevel >= state.voxThreshold &&
      !state.isMuted &&
      state.audioEnabled
  )

/**
 * Selector for checking if Bluetooth PTT is active
 */
export const usePTTBluetoothActive = () =>
  usePTTStore(
    (state) =>
      state.bluetoothEnabled &&
      state.bluetoothDevice?.connected &&
      state.bluetoothPttButtonPressed
  )
