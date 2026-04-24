import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Camera, Keyboard, QrCode } from 'lucide-react'

type BarcodeScannerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  onScan: (value: string) => void
}

type BarcodeDetection = { rawValue?: string }
type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<BarcodeDetection[]>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const win = window as Window & { BarcodeDetector?: BarcodeDetectorCtor }
  return win.BarcodeDetector ?? null
}

export function BarcodeScannerDialog({
  open,
  onOpenChange,
  title = 'Scan Barcode or QR',
  description = 'Use camera scanning on mobile, or use a Bluetooth/USB scanner in device mode.',
  onScan,
}: BarcodeScannerDialogProps) {
  const [mode, setMode] = useState('camera')
  const [manualValue, setManualValue] = useState('')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<number | null>(null)
  const detectorRef = useRef<BarcodeDetectorLike | null>(null)

  const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const detectorSupported = typeof window !== 'undefined' && !!getBarcodeDetectorCtor()

  const stopCamera = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setCameraReady(false)
  }, [])

  const submitScan = useCallback((raw: string) => {
    const value = raw.trim()
    if (!value) return
    onScan(value)
    onOpenChange(false)
    setManualValue('')
  }, [onOpenChange, onScan])

  useEffect(() => {
    if (!open) {
      stopCamera()
      setCameraError(null)
      return
    }

    if (mode !== 'camera') {
      stopCamera()
      return
    }

    if (!cameraSupported) {
      setCameraError('Camera access is not available in this browser.')
      return
    }

    if (!detectorSupported) {
      setCameraError('Barcode detection is not supported in this browser. Use device/manual mode.')
      return
    }

    let cancelled = false

    const setup = async () => {
      try {
        setCameraError(null)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setCameraReady(true)

        const BarcodeDetectorCtor = getBarcodeDetectorCtor()
        detectorRef.current = BarcodeDetectorCtor
          ? new BarcodeDetectorCtor({
              formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar'],
            })
          : null

        intervalRef.current = window.setInterval(async () => {
          try {
            if (!videoRef.current || !detectorRef.current) return
            const detections = await detectorRef.current.detect(videoRef.current)
            const found = detections.find((d) => !!d.rawValue)?.rawValue
            if (found) {
              submitScan(found)
            }
          } catch {
            // Keep scanner running even if one detect attempt fails.
          }
        }, 350)
      } catch (error) {
        setCameraError(error instanceof Error ? error.message : 'Unable to start camera scanner.')
      }
    }

    void setup()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [open, mode, cameraSupported, detectorSupported, stopCamera, submitScan])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={setMode}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="camera" className="flex items-center gap-1.5">
              <Camera className="h-4 w-4" /> Camera
            </TabsTrigger>
            <TabsTrigger value="device" className="flex items-center gap-1.5">
              <Keyboard className="h-4 w-4" /> Device
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-1.5">
              <QrCode className="h-4 w-4" /> Manual
            </TabsTrigger>
          </TabsList>

          <TabsContent value="camera" className="mt-4 space-y-3">
            <div className="rounded-lg border bg-muted/20 p-2">
              <video ref={videoRef} className="w-full rounded-md aspect-video object-cover bg-black" playsInline muted />
            </div>
            {cameraReady && <p className="text-xs text-muted-foreground">Point the camera at a barcode or QR code.</p>}
            {cameraError && <p className="text-sm text-red-600">{cameraError}</p>}
          </TabsContent>

          <TabsContent value="device" className="mt-4 space-y-3">
            <div className="rounded-lg border p-3 bg-muted/20">
              <p className="text-sm">
                Use Bluetooth or USB scanners configured as keyboard-wedge devices.
                Most scanners auto-submit with Enter.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="device-scan-input">Scan Input</Label>
              <Input
                id="device-scan-input"
                autoFocus
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitScan(manualValue)
                  }
                }}
                placeholder="Focus here and scan..."
              />
            </div>
          </TabsContent>

          <TabsContent value="manual" className="mt-4 space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="manual-scan-input">Code</Label>
              <Input
                id="manual-scan-input"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                placeholder="Enter barcode/QR text"
              />
            </div>
            <Button onClick={() => submitScan(manualValue)} disabled={!manualValue.trim()}>
              Use Code
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
