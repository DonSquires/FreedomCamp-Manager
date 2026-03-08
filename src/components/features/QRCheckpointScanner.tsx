/**
 * QRCheckpointScanner
 *
 * Allows field officers to check in at patrol checkpoints by:
 *  1. Scanning a QR code printed at the physical checkpoint location, OR
 *  2. Entering the checkpoint code manually (keyboard / URL deep-link).
 *
 * Records a checkpoint_visit with GPS and method metadata.
 * Supports the Lone Worker Protocol (Health & Safety at Work Act 2015).
 */

import { useState, useRef, useCallback } from 'react'
import { QrCode, Keyboard, CheckCircle2, Loader2, MapPin, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRecordCheckpointVisit, useMyCheckpointVisits } from '@/hooks/usePatrolCheckpoints'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'

interface Props {
  patrolId?: string | null
  onVisitRecorded?: (checkpointId: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// GPS helper
// ─────────────────────────────────────────────────────────────────────────────

async function getCurrentGPS(): Promise<GeolocationCoordinates | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// QR scanning via camera + canvas (no external library)
// ─────────────────────────────────────────────────────────────────────────────

interface QRScannerProps {
  onCode: (code: string) => void
  onCancel: () => void
}

function CameraQRScanner({ onCode, onCancel }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current != null) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStarted(false)
  }, [])

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setStarted(true)

      // Use BarcodeDetector API if available (Chrome/Android)
      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current) { return }
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes.length > 0) {
              stopCamera()
              onCode(codes[0].rawValue)
            }
          } catch {
            // detector not ready yet — keep trying
          }
        }, 500)
      }
    } catch (err: any) {
      setError(err.message || 'Camera not available')
    }
  }, [onCode, stopCamera])

  const handleCancel = () => {
    stopCamera()
    onCancel()
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {!started ? (
        <Button onClick={startCamera} className="w-full">
          <QrCode className="h-4 w-4 mr-2" />
          Open Camera
        </Button>
      ) : (
        <div className="relative w-full max-w-xs">
          <video
            ref={videoRef}
            className="rounded-lg w-full"
            playsInline
            muted
          />
          {/* Targeting overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-40 h-40 border-2 border-white rounded-md opacity-70" />
          </div>
          {!('BarcodeDetector' in window) && (
            <p className="mt-2 text-xs text-gray-500 text-center">
              QR auto-detection not supported — use manual entry below.
            </p>
          )}
        </div>
      )}

      <Button variant="outline" onClick={handleCancel} className="w-full">
        Cancel
      </Button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function QRCheckpointScanner({ patrolId, onVisitRecorded }: Props) {
  const [manualCode, setManualCode] = useState('')
  const [showCamera, setShowCamera] = useState(false)
  const [processing, setProcessing] = useState(false)

  const recordVisit = useRecordCheckpointVisit()
  const { data: recentVisits } = useMyCheckpointVisits(5)

  const processCode = useCallback(async (code: string, method: 'qr_camera' | 'manual_code') => {
    const trimmedCode = code.trim()
    if (!trimmedCode) {
      toast.error('Please enter a checkpoint code.')
      return
    }

    setProcessing(true)
    try {
      // Get GPS
      const gps = await getCurrentGPS()

      await recordVisit.mutateAsync({
        checkpointId: trimmedCode,
        patrolId: patrolId ?? null,
        scanMethod: method,
        gpsLatitude: gps?.latitude ?? null,
        gpsLongitude: gps?.longitude ?? null,
        gpsAccuracy: gps?.accuracy ?? null,
      })

      setManualCode('')
      onVisitRecorded?.(trimmedCode)
    } finally {
      setProcessing(false)
    }
  }, [patrolId, recordVisit, onVisitRecorded])

  const handleQRCode = useCallback((code: string) => {
    setShowCamera(false)
    processCode(code, 'qr_camera')
  }, [processCode])

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    processCode(manualCode, 'manual_code')
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="qr">
        <TabsList className="w-full">
          <TabsTrigger value="qr" className="flex-1">
            <QrCode className="h-4 w-4 mr-1" />
            Scan QR
          </TabsTrigger>
          <TabsTrigger value="manual" className="flex-1">
            <Keyboard className="h-4 w-4 mr-1" />
            Enter Code
          </TabsTrigger>
        </TabsList>

        <TabsContent value="qr" className="mt-4">
          {showCamera ? (
            <CameraQRScanner
              onCode={handleQRCode}
              onCancel={() => setShowCamera(false)}
            />
          ) : (
            <Button
              className="w-full h-14 text-base"
              onClick={() => setShowCamera(true)}
              disabled={processing}
            >
              {processing ? (
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              ) : (
                <QrCode className="h-5 w-5 mr-2" />
              )}
              {processing ? 'Recording visit...' : 'Scan Checkpoint QR Code'}
            </Button>
          )}
        </TabsContent>

        <TabsContent value="manual" className="mt-4">
          <form onSubmit={handleManualSubmit} className="space-y-3">
            <div>
              <Label htmlFor="checkpoint-code">Checkpoint ID</Label>
              <Input
                id="checkpoint-code"
                placeholder="Paste or type checkpoint code..."
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="mt-1 font-mono"
                autoComplete="off"
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter the checkpoint UUID printed on the sign or in the deep-link URL.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={processing || !manualCode.trim()}>
              {processing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {processing ? 'Recording...' : 'Check In'}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      {/* Recent visits */}
      {recentVisits && recentVisits.length > 0 && (
        <Card className="border-green-100 dark:border-green-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Recent Check-ins
            </CardTitle>
            <CardDescription className="text-xs">Last 5 checkpoint visits this shift</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentVisits.map((v) => (
              <div key={v.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="h-3 w-3 text-gray-400 shrink-0" />
                  <span className="font-medium truncate">
                    {v.patrol_checkpoints?.name ?? v.checkpoint_id.slice(0, 8)}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {v.within_radius === true && (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                      ✓ In range
                    </Badge>
                  )}
                  {v.within_radius === false && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                      ⚠ Out of range
                    </Badge>
                  )}
                  <span className="text-xs text-gray-500">
                    {formatDistanceToNow(new Date(v.visited_at), { addSuffix: true })}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
