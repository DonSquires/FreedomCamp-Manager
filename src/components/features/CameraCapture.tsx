/**
 * CameraCapture Component
 * Enhanced camera controls for evidence photo capture with metadata overlay
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Camera, 
  FlipHorizontal, 
  Zap, 
  ZapOff, 
  Focus,
  Menu,
  X,
  MapPin,
  Calendar,
  Clock,
  CloudRain,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { useZones } from '@/hooks/useZones'
import { fetchWeatherOnDevice } from '@/lib/weather'

interface CameraCaptureProps {
  onCapture: (file: File, metadata: CameraMetadata) => void
  onCancel: () => void
  facing?: 'user' | 'environment'
  showControls?: boolean
  onDiagnosticEvent?: (label: string, payload?: Record<string, unknown>) => void
  menuItems?: Array<{
    label: string
    onClick: () => void
    disabled?: boolean
  }>
}

interface CameraMetadata {
  timestamp: Date
  deviceInfo: string
  facing: 'user' | 'environment'
  flash: boolean
  width: number
  height: number
}

export function CameraCapture({
  onCapture,
  onCancel,
  facing = 'environment',
  showControls = true,
  onDiagnosticEvent,
  menuItems = [],
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const onCancelRef = useRef(onCancel)
  const onDiagnosticEventRef = useRef(onDiagnosticEvent)

  const [isStreaming, setIsStreaming] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(facing)
  const [flashEnabled, setFlashEnabled] = useState(false)
  const [isFocusing, setIsFocusing] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [hasFlash, setHasFlash] = useState(false)
  const [hasZoom, setHasZoom] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Context data for overlay
  const { user } = useAuthStore()
  const { zoneId, zoneName } = useGlobalFiltersStore()
  const { data: zones } = useZones()
  const [currentTime, setCurrentTime] = useState(new Date())
  const [weather, setWeather] = useState('Clear')
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [autoDetectedZone, setAutoDetectedZone] = useState<string | null>(null)

  // Stable refs for props that change every render — prevents useEffect/useCallback
  // from creating new references and triggering camera restarts.
  const zonesRef = useRef(zones)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    onDiagnosticEventRef.current = onDiagnosticEvent
  }, [onDiagnosticEvent])

  useEffect(() => {
    zonesRef.current = zones
  }, [zones])

  // Start camera stream
  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      onDiagnosticEventRef.current?.('camera.stream.started', {
        facingMode,
      })

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }

      // Check for flash capability
      const track = stream.getVideoTracks()[0]
      const capabilities = track.getCapabilities()
      
      if ('torch' in capabilities) {
        setHasFlash(true)
      }

      if ('zoom' in capabilities) {
        setHasZoom(true)
      }

      setIsStreaming(true)
    } catch (error: any) {
      console.error('Camera access failed:', error)
      onDiagnosticEventRef.current?.('camera.stream.error', {
        message: error?.message || 'Unknown camera error',
      })
      toast.error('Camera access denied or unavailable')
      onCancelRef.current()
    }
  }, [facingMode])

  // Stop camera stream
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setIsStreaming(false)
  }, [])

  // Toggle flash
  const toggleFlash = async () => {
    if (!streamRef.current || !hasFlash) return

    try {
      const track = streamRef.current.getVideoTracks()[0]
      await track.applyConstraints({
        advanced: [{ torch: !flashEnabled } as any],
      })
      setFlashEnabled(!flashEnabled)
    } catch (error) {
      console.error('Flash toggle failed:', error)
    }
  }

  // Toggle camera facing
  const toggleFacing = async () => {
    stopCamera()
    setFacingMode(facingMode === 'user' ? 'environment' : 'user')
    await startCamera()
  }

  // Apply zoom
  const applyZoom = async (newZoom: number) => {
    if (!streamRef.current || !hasZoom) return

    try {
      const track = streamRef.current.getVideoTracks()[0]
      await track.applyConstraints({
        advanced: [{ zoom: newZoom } as any],
      })
      setZoom(newZoom)
    } catch (error) {
      console.error('Zoom failed:', error)
    }
  }

  // Trigger focus (tap to focus simulation)
  const triggerFocus = async () => {
    if (!streamRef.current) return

    setIsFocusing(true)
    
    setTimeout(() => {
      setIsFocusing(false)
    }, 500)
  }

  // Capture photo
  const capturePhoto = () => {
    onDiagnosticEventRef.current?.('camera.capture.button_pressed')

    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current

    // Set canvas dimensions to video dimensions
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Draw video frame to canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Convert to blob
    canvas.toBlob((blob) => {
      if (!blob) {
        onDiagnosticEventRef.current?.('camera.capture.blob_failed')
        toast.error('Failed to capture photo')
        return
      }

      const file = new File([blob], `capture_${Date.now()}.jpg`, {
        type: 'image/jpeg',
      })

      const metadata: CameraMetadata = {
        timestamp: new Date(),
        deviceInfo: navigator.userAgent,
        facing: facingMode,
        flash: flashEnabled,
        width: canvas.width,
        height: canvas.height,
      }

      onDiagnosticEventRef.current?.('camera.capture.blob_created', {
        fileSize: file.size,
        width: canvas.width,
        height: canvas.height,
      })

      onCapture(file, metadata)
      stopCamera()
    }, 'image/jpeg', 0.95)
  }

  // Initialize camera and metadata on mount only.
  // Props (onCancel, onDiagnosticEvent) and zones are accessed via stable refs,
  // so this effect never re-runs due to prop identity changes — preventing the
  // infinite camera-restart loop that occurred when parent state updates
  // (e.g. scan diagnostics) triggered new function references on every render.
  useEffect(() => {
    startCamera()

    return () => {
      stopCamera()
    }
  }, [startCamera, stopCamera])

  // Metadata side-effects only.
  useEffect(() => {
    // Update time every second
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    
    // Get GPS location and fetch real weather from Open-Meteo once coordinates are known
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude
          const lng = position.coords.longitude

          setGpsLocation({ lat, lng })
          
          // Auto-detect zone based on GPS — read from ref so we always get the
          // latest zones data without this effect depending on zones directly.
          const currentZones = zonesRef.current
          if (currentZones) {
            const nearbyZone = currentZones.find((zone: any) => {
              // Simple distance check (can be improved with proper geofence)
              if (!zone.location_lat || !zone.location_lng) return false
              const distance = Math.sqrt(
                Math.pow(zone.location_lat - lat, 2) +
                Math.pow(zone.location_lng - lng, 2)
              )
              return distance < 0.01 // ~1km radius
            })
            
            if (nearbyZone) {
              setAutoDetectedZone(nearbyZone.name)
            } else {
              setAutoDetectedZone('Other Location')
            }
          }

          // Fetch real weather directly from Open-Meteo using the device GPS.
          // No API key, no server round-trip — called straight from the phone.
          try {
            const weatherStr = await fetchWeatherOnDevice(lat, lng)
            if (weatherStr) setWeather(weatherStr)
          } catch (weatherErr) {
            // Non-critical — overlay stays as 'Clear' fallback
            console.warn('⚠️ On-device weather fetch failed (non-critical):', weatherErr)
          }
        },
        (error) => {
          console.error('GPS error:', error)
          setAutoDetectedZone('GPS Unavailable')
        },
        { enableHighAccuracy: true }
      )
    }

    return () => {
      clearInterval(timeInterval)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Video stream */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        autoPlay
        muted
      />

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Focus indicator */}
      {isFocusing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-32 h-32 border-2 border-white rounded-full animate-pulse" />
        </div>
      )}

      {/* Metadata Overlay - 50% opacity — starts below the top controls row */}
      <div className="absolute top-20 left-4 right-4 bg-black bg-opacity-50 text-white p-3 rounded-lg space-y-1 text-sm z-20">
        {/* Officer & Organization */}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold">{user?.full_name || 'Unknown Officer'}</span>
        </div>
        
        {/* Zone - PROMINENT */}
        <div className="flex items-center gap-2 bg-blue-600 bg-opacity-70 px-2 py-1 rounded">
          <MapPin className="h-4 w-4" />
          <span className="font-bold text-base">
            {autoDetectedZone || zoneName || 'No Zone Selected'}
          </span>
        </div>
        
        {/* Date & Time */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>{currentTime.toLocaleDateString('en-NZ')}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{currentTime.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
        
        {/* Weather & GPS */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <CloudRain className="h-3 w-3" />
            <span>{weather}</span>
          </div>
          {gpsLocation && (
            <span className="text-xs text-gray-300">
              GPS: {gpsLocation.lat.toFixed(4)}, {gpsLocation.lng.toFixed(4)}
            </span>
          )}
        </div>
      </div>

      {/* Top controls — rendered above metadata overlay (z-30) */}
      {showControls && (
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/50 to-transparent z-30">
          <div className="flex items-center justify-between gap-2">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMenuOpen((v) => !v)}
                className="text-white"
                style={{ zIndex: 10 }}
              >
                <Menu className="h-6 w-6" />
              </Button>

              {menuOpen && (
                <div className="absolute left-0 mt-2 min-w-[220px] rounded-md border bg-black/85 p-1 shadow-lg backdrop-blur z-40">
                  {menuItems.length === 0 ? (
                    <button
                      type="button"
                      disabled
                      className="w-full rounded px-3 py-2 text-left text-sm text-gray-300 opacity-70"
                    >
                      No actions available
                    </button>
                  ) : (
                    menuItems.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        disabled={item.disabled}
                        onClick={() => {
                          item.onClick()
                          setMenuOpen(false)
                        }}
                        className="w-full rounded px-3 py-2 text-left text-sm text-white hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        {item.label}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
            {/* Flash toggle */}
            {hasFlash && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleFlash}
                className="text-white"
                style={{ zIndex: 10 }}
              >
                {flashEnabled ? (
                  <Zap className="h-6 w-6 fill-yellow-400 text-yellow-400" />
                ) : (
                  <ZapOff className="h-6 w-6" />
                )}
              </Button>
            )}

            {/* Status badges */}
            {flashEnabled && <Badge variant="secondary">Flash On</Badge>}
            {zoom > 1 && <Badge variant="secondary">{zoom}x</Badge>}

            {/* Cancel */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onCancel}
              className="text-white"
              style={{ zIndex: 10 }}
            >
              <X className="h-6 w-6" />
            </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/50 to-transparent z-10">
          <div className="flex items-center justify-center gap-6">
            {/* Flip camera */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFacing}
              className="text-white"
              style={{ zIndex: 10 }}
            >
              <FlipHorizontal className="h-6 w-6" />
            </Button>

            {/* Capture button */}
            <Button
              size="lg"
              onClick={capturePhoto}
              className="w-20 h-20 rounded-full bg-white hover:bg-gray-200"
              disabled={!isStreaming}
              style={{ zIndex: 10 }}
            >
              <Camera className="h-8 w-8 text-black" />
            </Button>

            {/* Focus */}
            <Button
              variant="ghost"
              size="icon"
              onClick={triggerFocus}
              className="text-white"
              style={{ zIndex: 10 }}
            >
              <Focus className="h-6 w-6" />
            </Button>
          </div>

          {/* Zoom controls */}
          {hasZoom && (
            <div className="mt-4 flex items-center justify-center gap-4" style={{ zIndex: 10 }}>
              <span className="text-white text-sm">1x</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.1"
                value={zoom}
                onChange={(e) => applyZoom(parseFloat(e.target.value))}
                className="w-48"
              />
              <span className="text-white text-sm">3x</span>
            </div>
          )}
        </div>
      )}

      {/* Tap to focus overlay - only covers center area, not buttons */}
      <div
        className="absolute inset-0"
        onClick={triggerFocus}
        style={{ 
          WebkitTapHighlightColor: 'transparent',
          pointerEvents: 'none' // Don't block button clicks
        }}
      />
    </div>
  )
}
