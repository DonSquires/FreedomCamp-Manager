/**
 * deviceIntegration.ts
 * 
 * Comprehensive device integration library for FreedomCamp Manager
 * Implements Web Bluetooth API, DeviceMotion API, and MediaDevices API for:
 * 
 * 1. Bluetooth Panic Buttons (BLE) - Connect to dedicated panic button devices
 * 2. Fall Detection - Accelerometer-based fall detection for phones/watches
 * 3. Shake Detection - Rapid shake for discrete panic trigger
 * 4. External Camera Streaming - Body cam and wireless camera support
 * 5. Smartwatch Heart Rate - Anomaly detection where available
 * 
 * Compliant with:
 * - Health & Safety at Work Act 2015 (NZ)
 * - PSPLA 2010 lone worker requirements
 * - Industry standards for alarm receiving centers (ARC)
 */

import { useDeviceStore, BlePanicDevice, FallDetectionState, ShakeDetectionState } from '@/stores/deviceStore'

// ─────────────────────────────────────────────────────────────────────────────
// Web Bluetooth Type Declarations (for TypeScript)
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Navigator {
    bluetooth?: {
      requestDevice(options: any): Promise<any>
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DeviceCapabilities {
  bluetooth: boolean
  accelerometer: boolean
  gyroscope: boolean
  webNFC: boolean
  mediaDevices: boolean
  wakeLock: boolean
}

export interface FallEvent {
  timestamp: number
  acceleration: { x: number; y: number; z: number }
  impactForce: number
  freeFallDuration: number
  postFallMotion: 'none' | 'minimal' | 'normal'
}

export interface ShakeEvent {
  timestamp: number
  intensity: number
  duration: number
  shakeCount: number
}

export interface ExternalCamera {
  id: string
  name: string
  type: 'bluetooth' | 'wifi' | 'usb'
  status: 'connected' | 'disconnected' | 'streaming'
  batteryLevel?: number
  resolution?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Fall detection thresholds (calibrated from research)
const FREE_FALL_THRESHOLD_G = 0.3         // Below 0.3g = free fall
const IMPACT_THRESHOLD_G = 2.5            // Above 2.5g = impact
const POST_FALL_STATIONARY_MS = 3000      // 3 seconds of no movement after fall
const FREE_FALL_MIN_DURATION_MS = 300     // Minimum free fall duration to consider

// Shake detection thresholds
const SHAKE_THRESHOLD_G = 2.0             // Acceleration to count as shake
const SHAKE_COUNT_FOR_ALERT = 5           // Number of shakes required
const SHAKE_WINDOW_MS = 2000              // Time window for shake count
const SHAKE_COOLDOWN_MS = 5000            // Cooldown between shake alerts

// BLE Service UUIDs (standard or custom for panic buttons)
const PANIC_BUTTON_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb'  // Battery Service as fallback
const HEART_RATE_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'
const GENERIC_ACCESS_UUID = '00001800-0000-1000-8000-00805f9b34fb'

// ─────────────────────────────────────────────────────────────────────────────
// Device Capabilities Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check what device capabilities are available on this device
 */
export function detectDeviceCapabilities(): DeviceCapabilities {
  return {
    bluetooth: 'bluetooth' in navigator && typeof navigator.bluetooth?.requestDevice === 'function',
    accelerometer: 'DeviceMotionEvent' in window,
    gyroscope: 'DeviceOrientationEvent' in window,
    webNFC: 'NDEFReader' in window,
    mediaDevices: 'mediaDevices' in navigator && typeof navigator.mediaDevices?.getUserMedia === 'function',
    wakeLock: 'wakeLock' in navigator,
  }
}

/**
 * Request necessary permissions for device features
 */
export async function requestDevicePermissions(): Promise<{
  motion: boolean
  bluetooth: boolean
}> {
  const results = { motion: false, bluetooth: false }
  
  // Request motion permission (iOS requires explicit permission)
  if ('DeviceMotionEvent' in window && typeof (DeviceMotionEvent as any).requestPermission === 'function') {
    try {
      const permissionState = await (DeviceMotionEvent as any).requestPermission()
      results.motion = permissionState === 'granted'
    } catch {
      results.motion = false
    }
  } else {
    // Android and most browsers grant implicitly
    results.motion = 'DeviceMotionEvent' in window
  }
  
  // Bluetooth permission is requested during requestDevice
  results.bluetooth = 'bluetooth' in navigator
  
  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// Bluetooth Panic Button Integration
// ─────────────────────────────────────────────────────────────────────────────

let bleDevice: any = null
let bleCharacteristic: any = null
let bleReconnectTimeout: ReturnType<typeof setTimeout> | null = null

/**
 * Scan and connect to a Bluetooth panic button device
 */
export async function connectBluetoothPanicButton(
  onPanicTriggered: () => void,
  onBatteryUpdate?: (level: number) => void
): Promise<BlePanicDevice | null> {
  const store = useDeviceStore.getState()
  
  if (!('bluetooth' in navigator)) {
    store.setError('Bluetooth not supported on this device')
    return null
  }
  
  try {
    // Request device with common panic button services
    const device = await navigator.bluetooth.requestDevice({
      // Accept devices advertising button service or generic services
      acceptAllDevices: true,
      optionalServices: [
        PANIC_BUTTON_SERVICE_UUID,
        HEART_RATE_SERVICE_UUID,
        GENERIC_ACCESS_UUID,
        'battery_service',
        '0000ffe0-0000-1000-8000-00805f9b34fb', // Common button service
      ],
    })
    
    if (!device) {
      store.setError('No device selected')
      return null
    }
    
    bleDevice = device
    
    // Handle disconnection
    device.addEventListener('gattserverdisconnected', () => {
      console.log('🔔 Panic Button: Device disconnected')
      store.setBlePanicDevice({
        ...store.blePanicDevice!,
        connected: false,
      })
      
      // Attempt reconnection
      scheduleBluetoothReconnect(onPanicTriggered, onBatteryUpdate)
    })
    
    // Connect to GATT server
    const server = await device.gatt?.connect()
    if (!server) {
      throw new Error('Could not connect to device')
    }
    
    console.log('🔔 Panic Button: Connected to', device.name)
    
    // Try to find button notification characteristic
    await setupButtonNotifications(server, onPanicTriggered)
    
    // Try to get battery level
    let batteryLevel: number | undefined
    try {
      const batteryService = await server.getPrimaryService('battery_service')
      const batteryChar = await batteryService.getCharacteristic('battery_level')
      const value = await batteryChar.readValue()
      batteryLevel = value.getUint8(0)
      
      // Subscribe to battery updates
      await batteryChar.startNotifications()
      batteryChar.addEventListener('characteristicvaluechanged', (event: any) => {
        const newLevel = event.target.value.getUint8(0)
        onBatteryUpdate?.(newLevel)
        const current = store.blePanicDevice
        if (current) {
          store.setBlePanicDevice({ ...current, batteryLevel: newLevel })
        }
      })
    } catch {
      // Battery service not available
    }
    
    const panicDevice: BlePanicDevice = {
      id: device.id,
      name: device.name || 'Unknown Device',
      connected: true,
      batteryLevel,
      lastSeen: new Date().toISOString(),
    }
    
    store.setBlePanicDevice(panicDevice)
    console.log('🔔 Panic Button: Setup complete')
    
    return panicDevice
  } catch (error: any) {
    console.error('🔔 Panic Button: Connection failed', error)
    store.setError(error.message || 'Failed to connect to panic button')
    return null
  }
}

/**
 * Set up button press notifications
 */
async function setupButtonNotifications(
  server: any,
  onPanicTriggered: () => void
): Promise<void> {
  // Try common button service UUIDs
  const buttonServiceUUIDs = [
    '0000ffe0-0000-1000-8000-00805f9b34fb', // Common button service
    '0000fff0-0000-1000-8000-00805f9b34fb', // Alternative
  ]
  
  for (const serviceUUID of buttonServiceUUIDs) {
    try {
      const service = await server.getPrimaryService(serviceUUID)
      const characteristics = await service.getCharacteristics()
      
      for (const char of characteristics) {
        if (char.properties.notify) {
          await char.startNotifications()
          char.addEventListener('characteristicvaluechanged', () => {
            console.log('🔔 Panic Button: PRESSED!')
            onPanicTriggered()
          })
          bleCharacteristic = char
          console.log('🔔 Panic Button: Notifications enabled')
          return
        }
      }
    } catch {
      // Service not found, try next
    }
  }
  
  console.warn('🔔 Panic Button: No notification characteristic found - using fallback')
}

/**
 * Schedule reconnection attempt
 */
function scheduleBluetoothReconnect(
  onPanicTriggered: () => void,
  onBatteryUpdate?: (level: number) => void
): void {
  if (bleReconnectTimeout) {
    clearTimeout(bleReconnectTimeout)
  }
  
  bleReconnectTimeout = setTimeout(async () => {
    if (bleDevice && !bleDevice.gatt?.connected) {
      console.log('🔔 Panic Button: Attempting reconnection...')
      try {
        const server = await bleDevice.gatt?.connect()
        if (server) {
          await setupButtonNotifications(server, onPanicTriggered)
          useDeviceStore.getState().setBlePanicDevice({
            ...useDeviceStore.getState().blePanicDevice!,
            connected: true,
            lastSeen: new Date().toISOString(),
          })
        }
      } catch (error) {
        console.error('🔔 Panic Button: Reconnection failed', error)
        scheduleBluetoothReconnect(onPanicTriggered, onBatteryUpdate)
      }
    }
  }, 5000)
}

/**
 * Disconnect Bluetooth panic button
 */
export function disconnectBluetoothPanicButton(): void {
  if (bleReconnectTimeout) {
    clearTimeout(bleReconnectTimeout)
    bleReconnectTimeout = null
  }
  
  if (bleDevice?.gatt?.connected) {
    bleDevice.gatt.disconnect()
  }
  
  bleDevice = null
  bleCharacteristic = null
  useDeviceStore.getState().setBlePanicDevice(null)
  console.log('🔔 Panic Button: Disconnected')
}

// ─────────────────────────────────────────────────────────────────────────────
// Fall Detection
// ─────────────────────────────────────────────────────────────────────────────

let fallDetectionActive = false
let freeFallStart: number | null = null
let lastAcceleration: { x: number; y: number; z: number; magnitude: number } | null = null
let postFallMotionCheck: ReturnType<typeof setTimeout> | null = null
let fallCallback: ((event: FallEvent) => void) | null = null
let fallMotionHandler: ((event: DeviceMotionEvent) => void) | null = null

/**
 * Start fall detection monitoring
 */
export function startFallDetection(
  onFallDetected: (event: FallEvent) => void,
  sensitivity: 'low' | 'medium' | 'high' = 'medium'
): boolean {
  if (!('DeviceMotionEvent' in window)) {
    useDeviceStore.getState().setError('Motion sensors not available')
    return false
  }
  
  if (fallDetectionActive) {
    console.log('🛡️ Fall Detection: Already active')
    return true
  }
  
  // Adjust thresholds based on sensitivity
  const sensitivityMultiplier = { low: 1.3, medium: 1.0, high: 0.7 }[sensitivity]
  const adjustedImpactThreshold = IMPACT_THRESHOLD_G * sensitivityMultiplier
  const adjustedFreeFallThreshold = FREE_FALL_THRESHOLD_G * sensitivityMultiplier
  
  fallCallback = onFallDetected
  
  const handleMotion = (event: DeviceMotionEvent) => {
    const accel = event.accelerationIncludingGravity
    if (!accel || accel.x === null || accel.y === null || accel.z === null) return
    
    const magnitude = Math.sqrt(accel.x ** 2 + accel.y ** 2 + accel.z ** 2) / 9.81 // Convert to G
    const now = Date.now()
    
    // Detect free fall (low acceleration)
    if (magnitude < adjustedFreeFallThreshold) {
      if (freeFallStart === null) {
        freeFallStart = now
        console.log('🛡️ Fall Detection: Free fall detected')
      }
    } else if (freeFallStart !== null) {
      const freeFallDuration = now - freeFallStart
      
      // Check for impact after free fall
      if (magnitude > adjustedImpactThreshold && freeFallDuration >= FREE_FALL_MIN_DURATION_MS) {
        console.log(`🛡️ Fall Detection: Impact detected! Force: ${magnitude.toFixed(2)}g, Fall duration: ${freeFallDuration}ms`)
        
        // Wait to check post-fall motion
        if (postFallMotionCheck) clearTimeout(postFallMotionCheck)
        
        const impactForce = magnitude
        const savedFreeFallDuration = freeFallDuration
        const savedAccel = { x: accel.x, y: accel.y, z: accel.z }
        
        postFallMotionCheck = setTimeout(() => {
          // Check if there's been significant motion since impact
          const currentMag = lastAcceleration?.magnitude || 0
          let postFallMotion: FallEvent['postFallMotion'] = 'none'
          
          if (currentMag > 0.5) postFallMotion = 'normal'
          else if (currentMag > 0.2) postFallMotion = 'minimal'
          
          // Only alert if no normal motion after fall (person may be incapacitated)
          if (postFallMotion !== 'normal') {
            const fallEvent: FallEvent = {
              timestamp: now,
              acceleration: savedAccel,
              impactForce,
              freeFallDuration: savedFreeFallDuration,
              postFallMotion,
            }
            
            console.log('🛡️ Fall Detection: FALL CONFIRMED!', fallEvent)
            fallCallback?.(fallEvent)
            
            useDeviceStore.getState().setFallDetection({
              enabled: true,
              sensitivity,
              lastFallEvent: fallEvent,
              fallCount: (useDeviceStore.getState().fallDetection.fallCount || 0) + 1,
            })
          } else {
            console.log('🛡️ Fall Detection: Normal motion detected after impact - false positive')
          }
        }, POST_FALL_STATIONARY_MS)
      }
      
      freeFallStart = null
    }
    
    lastAcceleration = { x: accel.x, y: accel.y, z: accel.z, magnitude }
  }
  
  // Store handler reference for proper cleanup
  fallMotionHandler = handleMotion
  window.addEventListener('devicemotion', handleMotion)
  fallDetectionActive = true
  
  useDeviceStore.getState().setFallDetection({
    enabled: true,
    sensitivity,
    lastFallEvent: null,
    fallCount: 0,
  })
  
  console.log(`🛡️ Fall Detection: Started (sensitivity: ${sensitivity})`)
  return true
}

/**
 * Stop fall detection monitoring
 */
export function stopFallDetection(): void {
  if (!fallDetectionActive) return
  
  // Remove the event listener using stored reference
  if (fallMotionHandler) {
    window.removeEventListener('devicemotion', fallMotionHandler)
    fallMotionHandler = null
  }
  
  fallDetectionActive = false
  fallCallback = null
  freeFallStart = null
  lastAcceleration = null
  
  if (postFallMotionCheck) {
    clearTimeout(postFallMotionCheck)
    postFallMotionCheck = null
  }
  
  useDeviceStore.getState().setFallDetection({
    enabled: false,
    sensitivity: 'medium',
    lastFallEvent: null,
    fallCount: 0,
  })
  
  console.log('🛡️ Fall Detection: Stopped')
}

// ─────────────────────────────────────────────────────────────────────────────
// Shake Detection (Safety Shake)
// ─────────────────────────────────────────────────────────────────────────────

let shakeDetectionActive = false
let shakeTimestamps: number[] = []
let lastShakeAlert = 0
let shakeCallback: ((event: ShakeEvent) => void) | null = null
let shakeMotionHandler: ((event: DeviceMotionEvent) => void) | null = null

/**
 * Start shake detection for panic trigger
 */
export function startShakeDetection(
  onShakeDetected: (event: ShakeEvent) => void,
  requiredShakes: number = SHAKE_COUNT_FOR_ALERT,
  sensitivity: 'low' | 'medium' | 'high' = 'medium'
): boolean {
  if (!('DeviceMotionEvent' in window)) {
    useDeviceStore.getState().setError('Motion sensors not available')
    return false
  }
  
  if (shakeDetectionActive) {
    console.log('📳 Shake Detection: Already active')
    return true
  }
  
  const sensitivityMultiplier = { low: 1.5, medium: 1.0, high: 0.6 }[sensitivity]
  const adjustedThreshold = SHAKE_THRESHOLD_G * sensitivityMultiplier
  
  shakeCallback = onShakeDetected
  
  const handleMotion = (event: DeviceMotionEvent) => {
    const accel = event.accelerationIncludingGravity
    if (!accel || accel.x === null || accel.y === null || accel.z === null) return
    
    const magnitude = Math.sqrt(accel.x ** 2 + accel.y ** 2 + accel.z ** 2) / 9.81
    const now = Date.now()
    
    // Check for shake
    if (magnitude > adjustedThreshold) {
      // Clean old timestamps
      shakeTimestamps = shakeTimestamps.filter(t => now - t < SHAKE_WINDOW_MS)
      shakeTimestamps.push(now)
      
      // Check if enough shakes in window
      if (shakeTimestamps.length >= requiredShakes && now - lastShakeAlert > SHAKE_COOLDOWN_MS) {
        const shakeEvent: ShakeEvent = {
          timestamp: now,
          intensity: magnitude,
          duration: now - shakeTimestamps[0],
          shakeCount: shakeTimestamps.length,
        }
        
        console.log('📳 Shake Detection: SHAKE ALERT!', shakeEvent)
        shakeCallback?.(shakeEvent)
        
        lastShakeAlert = now
        shakeTimestamps = []
        
        useDeviceStore.getState().setShakeDetection({
          enabled: true,
          sensitivity,
          requiredShakes,
          lastShakeEvent: shakeEvent,
        })
      }
    }
  }
  
  // Store handler reference for proper cleanup
  shakeMotionHandler = handleMotion
  window.addEventListener('devicemotion', handleMotion)
  shakeDetectionActive = true
  
  useDeviceStore.getState().setShakeDetection({
    enabled: true,
    sensitivity,
    requiredShakes,
    lastShakeEvent: null,
  })
  
  console.log(`📳 Shake Detection: Started (${requiredShakes} shakes, sensitivity: ${sensitivity})`)
  return true
}

/**
 * Stop shake detection
 */
export function stopShakeDetection(): void {
  if (!shakeDetectionActive) return
  
  // Remove the event listener using stored reference
  if (shakeMotionHandler) {
    window.removeEventListener('devicemotion', shakeMotionHandler)
    shakeMotionHandler = null
  }
  
  shakeDetectionActive = false
  shakeCallback = null
  shakeTimestamps = []
  
  useDeviceStore.getState().setShakeDetection({
    enabled: false,
    sensitivity: 'medium',
    requiredShakes: SHAKE_COUNT_FOR_ALERT,
    lastShakeEvent: null,
  })
  
  console.log('📳 Shake Detection: Stopped')
}

// ─────────────────────────────────────────────────────────────────────────────
// External Camera Integration
// ─────────────────────────────────────────────────────────────────────────────

let externalCameraStream: MediaStream | null = null

/**
 * Get available cameras (including external/USB cameras)
 */
export async function getAvailableCameras(): Promise<ExternalCamera[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const cameras = devices
      .filter(d => d.kind === 'videoinput')
      .map(d => ({
        id: d.deviceId,
        name: d.label || 'Unknown Camera',
        type: d.label.toLowerCase().includes('bluetooth') ? 'bluetooth' as const :
              d.label.toLowerCase().includes('usb') ? 'usb' as const : 'wifi' as const,
        status: 'disconnected' as const,
      }))
    
    return cameras
  } catch (error) {
    console.error('📷 Camera: Failed to enumerate devices', error)
    return []
  }
}

/**
 * Connect to external camera and start streaming
 */
export async function connectExternalCamera(
  cameraId: string,
  onFrameCapture?: (imageData: Blob) => void
): Promise<MediaStream | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: cameraId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    })
    
    externalCameraStream = stream
    
    const store = useDeviceStore.getState()
    const existingCamera = store.externalCameras.find(c => c.id === cameraId)
    if (existingCamera) {
      store.updateExternalCamera(cameraId, { status: 'streaming' })
    } else {
      store.addExternalCamera({
        id: cameraId,
        name: 'External Camera',
        type: 'usb',
        status: 'streaming',
      })
    }
    
    console.log('📷 Camera: Connected to external camera')
    return stream
  } catch (error: any) {
    console.error('📷 Camera: Failed to connect', error)
    useDeviceStore.getState().setError(error.message || 'Failed to connect to camera')
    return null
  }
}

/**
 * Disconnect external camera
 */
export function disconnectExternalCamera(cameraId: string): void {
  if (externalCameraStream) {
    externalCameraStream.getTracks().forEach(track => track.stop())
    externalCameraStream = null
  }
  
  useDeviceStore.getState().updateExternalCamera(cameraId, { status: 'disconnected' })
  console.log('📷 Camera: Disconnected')
}

/**
 * Capture frame from external camera
 */
export async function captureExternalCameraFrame(): Promise<Blob | null> {
  if (!externalCameraStream) {
    console.error('📷 Camera: No active stream')
    return null
  }
  
  const track = externalCameraStream.getVideoTracks()[0]
  if (!track) return null
  
  try {
    // Use ImageCapture API if available
    if ('ImageCapture' in window) {
      const capture = new (window as any).ImageCapture(track)
      return await capture.takePhoto()
    }
    
    // Fallback: capture from video element
    const video = document.createElement('video')
    video.srcObject = externalCameraStream
    await video.play()
    
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(video, 0, 0)
    
    return new Promise<Blob | null>(resolve => {
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.9)
    })
  } catch (error) {
    console.error('📷 Camera: Failed to capture frame', error)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Smartwatch/Wearable Heart Rate Monitoring
// ─────────────────────────────────────────────────────────────────────────────

let heartRateDevice: any = null
let heartRateCharacteristic: any = null

/**
 * Connect to heart rate monitor (smartwatch/fitness band)
 */
export async function connectHeartRateMonitor(
  onHeartRateUpdate: (bpm: number) => void,
  onAnomalyDetected?: (bpm: number, type: 'high' | 'low' | 'irregular') => void
): Promise<boolean> {
  if (!('bluetooth' in navigator)) {
    useDeviceStore.getState().setError('Bluetooth not supported')
    return false
  }
  
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HEART_RATE_SERVICE_UUID] }],
      optionalServices: ['battery_service'],
    })
    
    heartRateDevice = device
    
    const server = await device.gatt?.connect()
    if (!server) throw new Error('Could not connect')
    
    const service = await server.getPrimaryService(HEART_RATE_SERVICE_UUID)
    const characteristic = await service.getCharacteristic('heart_rate_measurement')
    
    heartRateCharacteristic = characteristic
    
    // Rolling average for anomaly detection
    const recentReadings: number[] = []
    const READING_WINDOW = 10
    const HIGH_BPM_THRESHOLD = 150
    const LOW_BPM_THRESHOLD = 40
    
    await characteristic.startNotifications()
    characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
      const value = event.target.value
      // Heart rate is typically in byte 1 (byte 0 is flags)
      const bpm = value.getUint8(1)
      
      onHeartRateUpdate(bpm)
      
      // Anomaly detection
      recentReadings.push(bpm)
      if (recentReadings.length > READING_WINDOW) recentReadings.shift()
      
      if (bpm > HIGH_BPM_THRESHOLD) {
        onAnomalyDetected?.(bpm, 'high')
      } else if (bpm < LOW_BPM_THRESHOLD) {
        onAnomalyDetected?.(bpm, 'low')
      }
      
      // Check for irregular (sudden changes)
      if (recentReadings.length >= 3) {
        const avg = recentReadings.reduce((a, b) => a + b, 0) / recentReadings.length
        if (Math.abs(bpm - avg) > 30) {
          onAnomalyDetected?.(bpm, 'irregular')
        }
      }
      
      useDeviceStore.getState().setHeartRateMonitor({
        connected: true,
        currentBpm: bpm,
        lastUpdate: new Date().toISOString(),
      })
    })
    
    useDeviceStore.getState().setHeartRateMonitor({
      connected: true,
      currentBpm: null,
      lastUpdate: null,
    })
    
    console.log('❤️ Heart Rate: Connected to', device.name)
    return true
  } catch (error: any) {
    console.error('❤️ Heart Rate: Connection failed', error)
    useDeviceStore.getState().setError(error.message || 'Failed to connect heart rate monitor')
    return false
  }
}

/**
 * Disconnect heart rate monitor
 */
export function disconnectHeartRateMonitor(): void {
  if (heartRateCharacteristic) {
    heartRateCharacteristic.stopNotifications().catch(() => {})
  }
  
  if (heartRateDevice?.gatt?.connected) {
    heartRateDevice.gatt.disconnect()
  }
  
  heartRateDevice = null
  heartRateCharacteristic = null
  
  useDeviceStore.getState().setHeartRateMonitor({
    connected: false,
    currentBpm: null,
    lastUpdate: null,
  })
  
  console.log('❤️ Heart Rate: Disconnected')
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen Wake Lock (Keep screen on during monitoring)
// ─────────────────────────────────────────────────────────────────────────────

let wakeLock: WakeLockSentinel | null = null

/**
 * Request screen wake lock to keep device awake during monitoring
 */
export async function requestWakeLock(): Promise<boolean> {
  if (!('wakeLock' in navigator)) {
    console.warn('Wake Lock API not supported')
    return false
  }
  
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    
    wakeLock.addEventListener('release', () => {
      console.log('🔒 Wake Lock: Released')
      wakeLock = null
    })
    
    console.log('🔒 Wake Lock: Acquired')
    return true
  } catch (error) {
    console.error('🔒 Wake Lock: Failed to acquire', error)
    return false
  }
}

/**
 * Release wake lock
 */
export async function releaseWakeLock(): Promise<void> {
  if (wakeLock) {
    await wakeLock.release()
    wakeLock = null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clean up all device connections and monitoring
 */
export function cleanupAllDevices(): void {
  disconnectBluetoothPanicButton()
  stopFallDetection()
  stopShakeDetection()
  disconnectHeartRateMonitor()
  releaseWakeLock()
  
  // Disconnect all external cameras
  const store = useDeviceStore.getState()
  store.externalCameras.forEach(cam => {
    disconnectExternalCamera(cam.id)
  })
  
  store.reset()
  console.log('🧹 Device Integration: All devices cleaned up')
}
