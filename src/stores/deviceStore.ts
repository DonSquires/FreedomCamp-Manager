/**
 * deviceStore.ts
 * 
 * Zustand store for managing connected devices state:
 * - Bluetooth panic buttons
 * - Fall detection status
 * - Shake detection status  
 * - External cameras
 * - Heart rate monitors
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BlePanicDevice {
  id: string
  name: string
  connected: boolean
  batteryLevel?: number
  lastSeen: string
}

export interface FallEvent {
  timestamp: number
  acceleration: { x: number; y: number; z: number }
  impactForce: number
  freeFallDuration: number
  postFallMotion: 'none' | 'minimal' | 'normal'
}

export interface FallDetectionState {
  enabled: boolean
  sensitivity: 'low' | 'medium' | 'high'
  lastFallEvent: FallEvent | null
  fallCount: number
}

export interface ShakeEvent {
  timestamp: number
  intensity: number
  duration: number
  shakeCount: number
}

export interface ShakeDetectionState {
  enabled: boolean
  sensitivity: 'low' | 'medium' | 'high'
  requiredShakes: number
  lastShakeEvent: ShakeEvent | null
}

export interface ExternalCamera {
  id: string
  name: string
  type: 'bluetooth' | 'wifi' | 'usb'
  status: 'connected' | 'disconnected' | 'streaming'
  batteryLevel?: number
  resolution?: string
}

export interface HeartRateMonitorState {
  connected: boolean
  currentBpm: number | null
  lastUpdate: string | null
}

export interface NoticePrinterAssignment {
  id: string
  name: string
  printerType: 'portable' | 'fixed'
}

interface DeviceState {
  // Bluetooth Panic Button
  blePanicDevice: BlePanicDevice | null
  blePanicEnabled: boolean
  
  // Fall Detection
  fallDetection: FallDetectionState
  
  // Shake Detection
  shakeDetection: ShakeDetectionState
  
  // External Cameras
  externalCameras: ExternalCamera[]
  
  // Heart Rate Monitor
  heartRateMonitor: HeartRateMonitorState

  // Notice printing
  assignedNoticePrinter: NoticePrinterAssignment | null
  requireAssignedPrinterForNotices: boolean
  
  // General
  error: string | null
  permissionsGranted: {
    motion: boolean
    bluetooth: boolean
    camera: boolean
  }
  
  // Actions
  setBlePanicDevice: (device: BlePanicDevice | null) => void
  setBlePanicEnabled: (enabled: boolean) => void
  setFallDetection: (state: Partial<FallDetectionState>) => void
  setShakeDetection: (state: Partial<ShakeDetectionState>) => void
  addExternalCamera: (camera: ExternalCamera) => void
  updateExternalCamera: (id: string, updates: Partial<ExternalCamera>) => void
  removeExternalCamera: (id: string) => void
  setHeartRateMonitor: (state: Partial<HeartRateMonitorState>) => void
  setAssignedNoticePrinter: (printer: NoticePrinterAssignment) => void
  clearAssignedNoticePrinter: () => void
  setRequireAssignedPrinterForNotices: (required: boolean) => void
  setError: (error: string | null) => void
  setPermissions: (permissions: Partial<DeviceState['permissionsGranted']>) => void
  reset: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial State
// ─────────────────────────────────────────────────────────────────────────────

const initialState = {
  blePanicDevice: null,
  blePanicEnabled: false,
  
  fallDetection: {
    enabled: false,
    sensitivity: 'medium' as const,
    lastFallEvent: null,
    fallCount: 0,
  },
  
  shakeDetection: {
    enabled: false,
    sensitivity: 'medium' as const,
    requiredShakes: 5,
    lastShakeEvent: null,
  },
  
  externalCameras: [],
  
  heartRateMonitor: {
    connected: false,
    currentBpm: null,
    lastUpdate: null,
  },

  assignedNoticePrinter: null,
  requireAssignedPrinterForNotices: false,
  
  error: null,
  
  permissionsGranted: {
    motion: false,
    bluetooth: false,
    camera: false,
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      setBlePanicDevice: (device) => set({ blePanicDevice: device }),
      
      setBlePanicEnabled: (enabled) => set({ blePanicEnabled: enabled }),
      
      setFallDetection: (state) => set((prev) => ({
        fallDetection: { ...prev.fallDetection, ...state },
      })),
      
      setShakeDetection: (state) => set((prev) => ({
        shakeDetection: { ...prev.shakeDetection, ...state },
      })),
      
      addExternalCamera: (camera) => set((prev) => ({
        externalCameras: [...prev.externalCameras, camera],
      })),
      
      updateExternalCamera: (id, updates) => set((prev) => ({
        externalCameras: prev.externalCameras.map((c) =>
          c.id === id ? { ...c, ...updates } : c
        ),
      })),
      
      removeExternalCamera: (id) => set((prev) => ({
        externalCameras: prev.externalCameras.filter((c) => c.id !== id),
      })),
      
      setHeartRateMonitor: (state) => set((prev) => ({
        heartRateMonitor: { ...prev.heartRateMonitor, ...state },
      })),

      setAssignedNoticePrinter: (printer) => set({ assignedNoticePrinter: printer }),
      clearAssignedNoticePrinter: () => set({ assignedNoticePrinter: null }),
      setRequireAssignedPrinterForNotices: (required) => set({ requireAssignedPrinterForNotices: required }),
      
      setError: (error) => set({ error }),
      
      setPermissions: (permissions) => set((prev) => ({
        permissionsGranted: { ...prev.permissionsGranted, ...permissions },
      })),
      
      reset: () => set(initialState),
    }),
    {
      name: 'device-state',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persistedState: any, version) => {
        if (version < 2) {
          return {
            ...persistedState,
            assignedNoticePrinter: persistedState?.assignedNoticePrinter ?? null,
            requireAssignedPrinterForNotices: persistedState?.requireAssignedPrinterForNotices ?? false,
          }
        }
        return persistedState as DeviceState
      },
      // Only persist user preferences, not runtime state
      partialize: (state) => ({
        blePanicEnabled: state.blePanicEnabled,
        fallDetection: {
          enabled: state.fallDetection.enabled,
          sensitivity: state.fallDetection.sensitivity,
        },
        shakeDetection: {
          enabled: state.shakeDetection.enabled,
          sensitivity: state.shakeDetection.sensitivity,
          requiredShakes: state.shakeDetection.requiredShakes,
        },
        assignedNoticePrinter: state.assignedNoticePrinter,
        requireAssignedPrinterForNotices: state.requireAssignedPrinterForNotices,
      }),
    }
  )
)

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if any safety monitoring is active
 */
export const useAnySafetyActive = () =>
  useDeviceStore((state) =>
    state.fallDetection.enabled ||
    state.shakeDetection.enabled ||
    state.blePanicDevice?.connected ||
    state.heartRateMonitor.connected
  )

/**
 * Get connected devices count
 */
export const useConnectedDevicesCount = () =>
  useDeviceStore((state) => {
    let count = 0
    if (state.blePanicDevice?.connected) count++
    if (state.heartRateMonitor.connected) count++
    count += state.externalCameras.filter((c) => c.status !== 'disconnected').length
    return count
  })

/**
 * Check if fall detection recently triggered
 */
export const useFallAlertActive = () =>
  useDeviceStore((state) => {
    if (!state.fallDetection.lastFallEvent) return false
    const elapsed = Date.now() - state.fallDetection.lastFallEvent.timestamp
    return elapsed < 60000 // Alert active for 1 minute
  })

/**
 * Check if shake alert recently triggered
 */
export const useShakeAlertActive = () =>
  useDeviceStore((state) => {
    if (!state.shakeDetection.lastShakeEvent) return false
    const elapsed = Date.now() - state.shakeDetection.lastShakeEvent.timestamp
    return elapsed < 30000 // Alert active for 30 seconds
  })
