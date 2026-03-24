/**
 * LivePatrolCamera
 *
 * Continuous auto-capture patrol mode for freedom camping and parking enforcement.
 * Inspired by ParkPow / TicketOr2 drive-and-scan approach:
 *  - Camera viewfinder stays live at all times
 *  - Officer presses "Start Patrol Scan" to begin auto-capture loop
 *  - Frame is captured every N seconds (default 4 s), submitted to the ALPR pipeline
 *  - Results appear in a live feed below the viewfinder as plates are read
 *  - Breach plates are highlighted immediately with a red banner
 *  - Officer can also tap the shutter for a manual capture at any time
 *  - Session summary shows total scanned, breaches, compliant
 *
 * The auto-interval can be adjusted (2 s / 4 s / 6 s / manual only).
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Camera, X, FlipHorizontal, Play, Square, ZoomIn, ZoomOut,
  CheckCircle, AlertTriangle, Clock, Wifi, WifiOff, Timer,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { captureAndSave } from '@/lib/scanPipeline'

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS  = 2500
const MAX_POLL_ATTEMPTS = 12  // ~30 s max wait per frame

// ── Types ─────────────────────────────────────────────────────────────────────

interface PatrolScanResult {
  id: string
  observationId: string | null
  plate: string | null
  photoUrl: string
  isCompliant: boolean | null
  breachType: string | null
  recordedAt: string
  pending: boolean
}

interface LivePatrolCameraProps {
  onScanSaved?: () => void
  onClose: () => void
  recordGPSUpdate?: (lat: number, lng: number) => Promise<void>
}

const INTERVAL_OPTIONS = [
  { label: '2 s', value: 2000 },
  { label: '4 s', value: 4000 },
  { label: '6 s', value: 6000 },
  { label: 'Manual', value: 0 },
] as const

// ── Component ─────────────────────────────────────────────────────────────────

export function LivePatrolCamera({ onScanSaved, onClose, recordGPSUpdate }: LivePatrolCameraProps) {
  const { user } = useAuthStore()
  const { zoneId } = useGlobalFiltersStore()

  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const processingRef = useRef(false)

  const [facingMode,   setFacingMode]   = useState<'environment' | 'user'>('environment')
  const [zoom,         setZoom]         = useState(1)
  const [hasZoom,      setHasZoom]      = useState(false)
  const [isStreaming,  setIsStreaming]   = useState(false)
  const [isRunning,    setIsRunning]    = useState(false)
  const [isCapturing,  setIsCapturing]  = useState(false)
  const [intervalMs,   setIntervalMs]   = useState<number>(4000)
  const [results,      setResults]      = useState<PatrolScanResult[]>([])
  const [countdown,    setCountdown]    = useState(0)

  const resultsRef = useRef<PatrolScanResult[]>([])
  resultsRef.current = results

  const totalScanned   = results.length
  const totalBreaches  = results.filter(r => r.isCompliant === false).length
  const totalCompliant = results.filter(r => r.isCompliant === true).length

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
      toast.error('Camera access denied or unavailable')
      onClose()
    }
  }, [stopCamera, onClose])

  useEffect(() => {
    startCamera(facingMode)
    return () => {
      stopCamera()
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (tickerRef.current) clearInterval(tickerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Background polling for pending results ────────────────────────────────

  useEffect(() => {
    const pending = results.filter(r => r.pending && r.observationId)
    if (!pending.length) return

    const controllers = new Map<string, { cancelled: boolean; timer: ReturnType<typeof setTimeout> | null }>()

    pending.forEach(scan => {
      if (controllers.has(scan.id)) return
      const ctrl = { cancelled: false, timer: null as ReturnType<typeof setTimeout> | null }
      controllers.set(scan.id, ctrl)

      let attempts = 0

      const poll = async () => {
        if (ctrl.cancelled) return
        attempts++

        const { data } = await (supabase.from('observations') as any)
          .select('observation_id, plate_number, is_compliant, breach_type')
          .eq('observation_id', scan.observationId)
          .maybeSingle()

        if (!data) {
          if (attempts < MAX_POLL_ATTEMPTS) ctrl.timer = setTimeout(poll, POLL_INTERVAL_MS)
          return
        }

        const resolved = data.plate_number &&
          data.plate_number !== 'PROCESSING...' &&
          data.plate_number !== 'MANUAL_REQUIRED'

        const compliant = typeof data.is_compliant === 'boolean' ? data.is_compliant : null

        setResults(prev => prev.map(r =>
          r.id !== scan.id ? r : {
            ...r,
            plate: data.plate_number ?? null,
            isCompliant: compliant,
            breachType: data.breach_type ?? null,
            pending: !resolved,
          }
        ))

        if (resolved) {
          onScanSaved?.()
          if (compliant === false) {
            toast.error(`⚠ Breach — ${data.plate_number}`, { duration: 5000 })
          }
        } else if (attempts < MAX_POLL_ATTEMPTS) {
          ctrl.timer = setTimeout(poll, POLL_INTERVAL_MS)
        } else {
          // Give up polling — mark as no longer pending
          setResults(prev => prev.map(r => r.id === scan.id ? { ...r, pending: false } : r))
        }
      }

      void poll()
    })

    return () => {
      controllers.forEach(ctrl => {
        ctrl.cancelled = true
        if (ctrl.timer) clearTimeout(ctrl.timer)
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.filter(r => r.pending && r.observationId).map(r => r.id).join(',')])

  // ── Zoom ──────────────────────────────────────────────────────────────────

  const applyZoom = async (level: number) => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ zoom: level } as any] })
      setZoom(level)
    } catch { /* not supported */ }
  }

  // ── Capture helpers ───────────────────────────────────────────────────────

  const captureFrame = useCallback((): File | null => {
    if (!videoRef.current || !canvasRef.current || !isStreaming) return null
    const video  = videoRef.current
    const canvas = canvasRef.current
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    const arr  = dataUrl.split(',')
    const mime = arr[0].match(/:(.*?);/)![1]
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8 = new Uint8Array(n)
    while (n--) u8[n] = bstr.charCodeAt(n)
    return new File([u8], `patrol_${Date.now()}.jpg`, { type: mime })
  }, [isStreaming])

  const submitFrame = useCallback(async (file: File) => {
    if (!user?.id || !user?.organization_id) return
    if (processingRef.current) return
    processingRef.current = true
    setIsCapturing(true)

    const clientId = `live-${Date.now()}`
    const stub: PatrolScanResult = {
      id: clientId,
      observationId: null,
      plate: null,
      photoUrl: '',
      isCompliant: null,
      breachType: null,
      recordedAt: new Date().toISOString(),
      pending: true,
    }
    setResults(prev => [stub, ...prev.slice(0, 49)])

    try {
      const result = await captureAndSave(
        file,
        { id: user.id, organization_id: user.organization_id, full_name: user.full_name },
        zoneId,
        recordGPSUpdate,
        () => {},
      )

      setResults(prev => prev.map(r =>
        r.id === clientId ? {
          ...r,
          observationId: result.observationId,
          photoUrl: result.photoUrl,
          pending: true,  // will be resolved by polling effect
        } : r
      ))
    } catch {
      setResults(prev => prev.map(r =>
        r.id === clientId ? { ...r, pending: false } : r
      ))
    } finally {
      processingRef.current = false
      setIsCapturing(false)
    }
  }, [user, zoneId, recordGPSUpdate])

  // ── Auto-capture loop ─────────────────────────────────────────────────────

  const stopPatrol = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (tickerRef.current)   { clearInterval(tickerRef.current);   tickerRef.current   = null }
    setIsRunning(false)
    setCountdown(0)
  }, [])

  const startPatrol = useCallback(() => {
    if (!isStreaming) return
    setIsRunning(true)

    if (intervalMs === 0) return  // manual-only mode

    let remaining = Math.round(intervalMs / 1000)
    setCountdown(remaining)
    tickerRef.current = setInterval(() => {
      remaining = remaining <= 1 ? Math.round(intervalMs / 1000) : remaining - 1
      setCountdown(remaining)
    }, 1000)

    intervalRef.current = setInterval(() => {
      const frame = captureFrame()
      if (frame) void submitFrame(frame)
    }, intervalMs)
  }, [isStreaming, intervalMs, captureFrame, submitFrame])

  const manualCapture = () => {
    const frame = captureFrame()
    if (frame) void submitFrame(frame)
  }

  const flipCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(next)
    startCamera(next)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-black">
      {/* ── Viewfinder ─────────────────────────────────────────────── */}
      <div className="relative w-full flex-shrink-0" style={{ height: '55dvh', minHeight: '250px' }}>
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          autoPlay
          muted
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Status bar overlay */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex items-center gap-2">
            {isRunning ? (
              <div className="flex items-center gap-1.5 text-green-400 text-xs font-semibold">
                <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                LIVE PATROL
                {intervalMs > 0 && countdown > 0 && (
                  <span className="ml-1 text-white/70">({countdown}s)</span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-white/60 text-xs">
                <div className="h-2 w-2 rounded-full bg-white/40" />
                STANDBY
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-white bg-black/50 rounded-full px-2.5 py-0.5">
              <span className="text-gray-300">{totalScanned}</span>
              {totalBreaches > 0 && <span className="text-red-400 font-bold">{totalBreaches}⚠</span>}
              {totalCompliant > 0 && <span className="text-green-400">{totalCompliant}✓</span>}
            </div>
            <button
              onClick={() => { stopPatrol(); onClose() }}
              className="text-white bg-black/50 hover:bg-black/70 rounded-full p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Processing scan-line overlay */}
        {isCapturing && (
          <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
            <div className="border-4 border-yellow-400 rounded-md opacity-60" style={{ width: '70%', height: '45%' }} />
          </div>
        )}

        {/* Bottom controls */}
        <div className="absolute bottom-0 left-0 right-0 z-20 px-3 pb-3">
          {hasZoom && (
            <div className="flex items-center justify-center gap-3 mb-2 bg-black/50 rounded-full px-4 py-1 mx-auto w-fit">
              <button onClick={() => applyZoom(Math.max(1, zoom - 0.5))} disabled={zoom <= 1} className="text-white p-0.5 disabled:opacity-30">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-white text-xs font-semibold w-8 text-center">{zoom.toFixed(1)}×</span>
              <button onClick={() => applyZoom(Math.min(5, zoom + 0.5))} disabled={zoom >= 5} className="text-white p-0.5 disabled:opacity-30">
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <button onClick={flipCamera} className="text-white bg-black/50 rounded-full p-2 hover:bg-black/70">
              <FlipHorizontal className="h-5 w-5" />
            </button>

            {isRunning ? (
              <button
                onClick={stopPatrol}
                className="flex items-center gap-2 bg-red-600 text-white rounded-full px-5 py-2.5 font-semibold text-sm hover:bg-red-700 active:scale-95"
              >
                <Square className="h-4 w-4 fill-white" />
                Stop Patrol
              </button>
            ) : (
              <button
                onClick={startPatrol}
                disabled={!isStreaming}
                className="flex items-center gap-2 bg-green-600 text-white rounded-full px-5 py-2.5 font-semibold text-sm hover:bg-green-700 active:scale-95 disabled:opacity-40"
              >
                <Play className="h-4 w-4 fill-white" />
                Start Patrol
              </button>
            )}

            <button
              onClick={manualCapture}
              disabled={!isStreaming || isCapturing}
              className="bg-white/20 border-2 border-white text-white rounded-full p-2.5 hover:bg-white/40 active:scale-95 disabled:opacity-30"
              title="Manual capture"
            >
              <Camera className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Config bar ─────────────────────────────────────────────── */}
      <div className="bg-gray-900 border-t border-gray-700 px-3 py-2 flex items-center gap-2 flex-shrink-0">
        <Timer className="h-3.5 w-3.5 text-gray-400" />
        <span className="text-xs text-gray-400 mr-1">Auto-capture:</span>
        {INTERVAL_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => { setIntervalMs(opt.value); if (isRunning) stopPatrol() }}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              intervalMs === opt.value
                ? 'bg-green-600 border-green-500 text-white font-semibold'
                : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-400'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 text-xs text-gray-400">
          {isStreaming ? <Wifi className="h-3.5 w-3.5 text-green-400" /> : <WifiOff className="h-3.5 w-3.5 text-red-400" />}
          <span>{isStreaming ? 'Camera live' : 'No camera'}</span>
        </div>
      </div>

      {/* ── Live results feed ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-gray-950 divide-y divide-gray-800">
        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-500 text-sm gap-2">
            <Camera className="h-8 w-8 opacity-30" />
            <span>No plates scanned yet</span>
            <span className="text-xs opacity-60">Press Start Patrol to begin auto-scanning</span>
          </div>
        ) : (
          results.map(r => (
            <div
              key={r.id}
              className={`flex items-center gap-3 px-3 py-2 ${
                r.isCompliant === false ? 'bg-red-950/30' : ''
              }`}
            >
              {r.photoUrl ? (
                <img src={r.photoUrl} alt="scan" className="h-10 w-14 object-cover rounded shrink-0" />
              ) : (
                <div className="h-10 w-14 bg-gray-800 rounded shrink-0 flex items-center justify-center">
                  <Camera className="h-4 w-4 text-gray-600" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                {r.pending ? (
                  <div className="flex items-center gap-1.5 text-yellow-400 text-sm">
                    <div className="h-3 w-3 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
                    <span className="font-mono text-xs">Processing…</span>
                  </div>
                ) : (
                  <>
                    <p className="font-mono font-bold text-sm text-white truncate">
                      {r.plate || <span className="text-gray-500 font-normal text-xs">No plate read</span>}
                    </p>
                    {r.isCompliant === false && (
                      <p className="text-xs text-red-400 truncate">{r.breachType?.replace(/_/g,' ') || 'Breach detected'}</p>
                    )}
                  </>
                )}
              </div>

              <div className="shrink-0">
                {r.pending ? null : r.isCompliant === false ? (
                  <Badge variant="destructive" className="text-xs gap-1">
                    <AlertTriangle className="h-3 w-3" /> Breach
                  </Badge>
                ) : r.isCompliant === true ? (
                  <Badge variant="outline" className="text-xs text-green-400 border-green-700 gap-1">
                    <CheckCircle className="h-3 w-3" /> OK
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-gray-500 gap-1">
                    <Clock className="h-3 w-3" /> –
                  </Badge>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}


