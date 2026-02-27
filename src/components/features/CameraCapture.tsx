/**
 * CameraCapture Component
 * Enhanced camera controls for evidence photo capture
 */

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Camera, 
  FlipHorizontal, 
  Zap, 
  ZapOff, 
  Focus, 
  Maximize2,
  X,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'

interface CameraCaptureProps {
  onCapture: (file: File, metadata: CameraMetadata) => void
  onCancel: () => void
  facing?: 'user' | 'environment'
  showControls?: boolean
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
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [isStreaming, setIsStreaming] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(facing)
  const [flashEnabled, setFlashEnabled] = useState(false)
  const [isFocusing, setIsFocusing] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [hasFlash, setHasFlash] = useState(false)
  const [hasZoom, setHasZoom] = useState(false)

  // Start camera stream
  const startCamera = async () => {
    try {
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
      toast.error('Camera access denied or unavailable')
      onCancel()
    }
  }

  // Stop camera stream
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setIsStreaming(false)
  }

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

      onCapture(file, metadata)
      stopCamera()
    }, 'image/jpeg', 0.95)
  }

  // Start camera on mount
  useEffect(() => {
    startCamera()
    return () => stopCamera()
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

      {/* Top controls */}
      {showControls && (
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/50 to-transparent">
          <div className="flex items-center justify-between">
            {/* Flash toggle */}
            {hasFlash && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleFlash}
                className="text-white"
              >
                {flashEnabled ? (
                  <Zap className="h-6 w-6 fill-yellow-400 text-yellow-400" />
                ) : (
                  <ZapOff className="h-6 w-6" />
                )}
              </Button>
            )}

            {/* Status badges */}
            <div className="flex gap-2">
              {flashEnabled && <Badge variant="secondary">Flash On</Badge>}
              {zoom > 1 && <Badge variant="secondary">{zoom}x</Badge>}
            </div>

            {/* Cancel */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onCancel}
              className="text-white"
            >
              <X className="h-6 w-6" />
            </Button>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/50 to-transparent">
          <div className="flex items-center justify-center gap-6">
            {/* Flip camera */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFacing}
              className="text-white"
            >
              <FlipHorizontal className="h-6 w-6" />
            </Button>

            {/* Capture button */}
            <Button
              size="lg"
              onClick={capturePhoto}
              className="w-20 h-20 rounded-full bg-white hover:bg-gray-200"
              disabled={!isStreaming}
            >
              <Camera className="h-8 w-8 text-black" />
            </Button>

            {/* Focus */}
            <Button
              variant="ghost"
              size="icon"
              onClick={triggerFocus}
              className="text-white"
            >
              <Focus className="h-6 w-6" />
            </Button>
          </div>

          {/* Zoom controls */}
          {hasZoom && (
            <div className="mt-4 flex items-center justify-center gap-4">
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

      {/* Tap to focus overlay */}
      <div
        className="absolute inset-0"
        onClick={triggerFocus}
        style={{ WebkitTapHighlightColor: 'transparent' }}
      />
    </div>
  )
}
