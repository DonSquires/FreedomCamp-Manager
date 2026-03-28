/**
 * SplitScanCamera
 *
 * Compact inline camera for the split-screen scan layout.
 * Renders inside its container — NOT fullscreen.
 * Top quarter of screen: live viewfinder + single capture button + close.
 * Bottom three-quarters: handled by the parent (results / recent scans).
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Camera, FlipHorizontal, X, ZoomIn, ZoomOut } from 'lucide-react'
import { toast } from 'sonner'

interface SplitScanCameraProps {
  /** Called with the captured JPEG File */
  onCapture: (file: File) => void
  /** Called when the officer taps the close / cancel button */
  onCancel: () => void
  /** Disable the capture button while a scan is in-flight */
  isProcessing?: boolean
  /** Current pipeline step shown while capture is in flight */
  statusLabel?: string
}

export function SplitScanCamera({ onCapture, onCancel, isProcessing = false, statusLabel }: SplitScanCameraProps) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [facingMode,  setFacingMode]  = useState<'environment' | 'user'>('environment')
  const [zoom,        setZoom]        = useState(1)
  const [hasZoom,     setHasZoom]     = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)

  // ── Camera lifecycle ──────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setIsStreaming(false)
  }, [])

  const startCamera = useCallback(async (facing: 'environment' | 'user') => {
    stopCamera()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
      const caps = stream.getVideoTracks()[0].getCapabilities()
      setHasZoom('zoom' in caps)
      setIsStreaming(true)
    } catch {
      toast.error('Camera access denied or unavailable. Use Manual Entry to continue.')
      setIsStreaming(false)
    }
  }, [stopCamera, onCancel])

  useEffect(() => {
    startCamera(facingMode)
    return () => stopCamera()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // mount/unmount only — facing changes handled by flipCamera

  // ── Controls ──────────────────────────────────────────────────────────────

  const flipCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(next)
    startCamera(next)
  }

  const applyZoom = async (level: number) => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ zoom: level } as any] })
      setZoom(level)
    } catch { /* zoom not supported on this device */ }
  }

  const capture = () => {
    if (!videoRef.current || !canvasRef.current || !isStreaming) return
    const video  = videoRef.current
    const canvas = canvasRef.current
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) { toast.error('Failed to capture photo'); return }
      onCapture(new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.95)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* Live viewfinder */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        autoPlay
        muted
      />

      {/* Hidden capture canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* ── Top-right: Close ── */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onCancel}
        className="absolute top-2 right-2 z-20 text-white bg-black/40 hover:bg-black/60"
        aria-label="Close scanner"
      >
        <X className="h-5 w-5" />
      </Button>

      {/* ── Top-left: Flip camera ── */}
      <Button
        variant="ghost"
        size="icon"
        onClick={flipCamera}
        className="absolute top-2 left-2 z-20 text-white bg-black/40 hover:bg-black/60"
        aria-label="Flip camera"
      >
        <FlipHorizontal className="h-5 w-5" />
      </Button>

      {/* ── Bottom centre: Capture button ── */}
      <div className="absolute bottom-4 left-0 right-0 z-20 flex flex-col items-center gap-2">
        {/* Zoom controls (only shown when device supports zoom) */}
        {hasZoom && (
          <div className="flex items-center gap-3 bg-black/50 rounded-full px-4 py-1">
            <Button
              variant="ghost" size="icon"
              onClick={() => applyZoom(Math.max(1, zoom - 0.5))}
              disabled={zoom <= 1}
              className="h-6 w-6 text-white hover:bg-white/20"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-white text-xs font-semibold w-8 text-center">{zoom.toFixed(1)}×</span>
            <Button
              variant="ghost" size="icon"
              onClick={() => applyZoom(Math.min(5, zoom + 0.5))}
              disabled={zoom >= 5}
              className="h-6 w-6 text-white hover:bg-white/20"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Shutter button */}
        <button
          onClick={capture}
          disabled={!isStreaming || isProcessing}
          aria-label="Capture photo"
          className={`
            w-16 h-16 rounded-full border-4 border-white bg-white/20
            flex items-center justify-center
            transition-opacity
            ${(!isStreaming || isProcessing) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/40 active:scale-95'}
          `}
        >
          <Camera className="h-7 w-7 text-white" />
        </button>

        <div className="min-h-5 text-center text-xs font-medium text-white/90 drop-shadow">
          {isProcessing ? (statusLabel || 'Processing…') : 'Tap to capture'}
        </div>
      </div>
    </div>
  )
}
