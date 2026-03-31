/**
 * ParkingPhotoCapture.tsx
 *
 * Compact camera-capture component for parking enforcement.
 * Opens a dialog with a live camera view, captures a JPEG, uploads to
 * Supabase Storage, and optionally runs ALPR (via the Railway inference
 * service) to auto-detect the plate number and vehicle details.
 *
 * Usage modes:
 *   runInference=true  — vehicle photo: auto-fills plate, make/model/colour
 *   runInference=false — evidence photo: just upload and return the URL
 */
import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Camera, X, Loader2, CheckCircle, Trash2, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { railwayServices } from '@/lib/railwayServices'
import { useAuthStore } from '@/stores/authStore'

// ─── Public result type ───────────────────────────────────────────────────────

export interface ParkingPhotoCaptureResult {
  plateNumber: string | null
  photoUrl: string
  latitude: number | null
  longitude: number | null
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleColour: string | null
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ParkingPhotoCaptureProps {
  /** Label shown on the trigger button and dialog heading */
  label: string
  /** Short hint displayed inside the dashed trigger button */
  hint?: string
  /** When set, shows a photo thumbnail instead of the trigger button */
  existingPhotoUrl?: string
  /**
   * When true the component runs the Railway ALPR inference pipeline after
   * uploading the photo and returns detected plate / vehicle details.
   * When false (default) it simply uploads and returns the photo URL.
   */
  runInference?: boolean
  onCapture: (result: ParkingPhotoCaptureResult) => void
  /** Called when the officer taps the trash icon on an existing photo */
  onClear?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ParkingPhotoCapture({
  label,
  hint,
  existingPhotoUrl,
  runInference = false,
  onCapture,
  onClear,
}: ParkingPhotoCaptureProps) {
  const { user } = useAuthStore()

  const [open, setOpen]             = useState(false)
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [captured, setCaptured]     = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  const videoRef  = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // ── Camera helpers ──────────────────────────────────────────────────────────

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        setIsCameraOn(true)
      }
    } catch (err: any) {
      toast.error('Camera access failed: ' + err.message)
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setIsCameraOn(false)
    setCaptured(null)
  }

  const captureFrame = () => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width  = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0)
      setCaptured(canvas.toDataURL('image/jpeg', 0.92))
    }
  }

  // ── GPS helper ──────────────────────────────────────────────────────────────

  const getGPS = (): Promise<{ latitude: number; longitude: number } | null> =>
    new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        ()  => { toast.warning('GPS unavailable — location not recorded'); resolve(null) },
        { enableHighAccuracy: true, timeout: 10_000 },
      )
    })

  // ── Main process ────────────────────────────────────────────────────────────

  const processPhoto = async () => {
    if (!captured) return
    setProcessing(true)

    try {
      // 1. GPS (in parallel with upload for speed)
      const [gpsResult, blob] = await Promise.all([
        getGPS(),
        fetch(captured).then(r => r.blob()),
      ])

      const latitude  = gpsResult?.latitude  ?? null
      const longitude = gpsResult?.longitude ?? null

      // 2. Upload to Supabase Storage (scans bucket, prefixed with user UUID)
      const userId = (await supabase.auth.getUser()).data.user?.id ?? user?.id
      if (!userId) throw new Error('Not authenticated — please sign in and try again')
      const fileName = `parking-${Date.now()}.jpg`
      const { error: uploadErr } = await supabase.storage
        .from('scans')
        .upload(`${userId}/${fileName}`, blob, { contentType: 'image/jpeg' })
      if (uploadErr) throw uploadErr

      const { data: urlData } = supabase.storage
        .from('scans')
        .getPublicUrl(`${userId}/${fileName}`)
      const photoUrl = urlData.publicUrl

      let plateNumber:  string | null = null
      let vehicleMake:  string | null = null
      let vehicleModel: string | null = null
      let vehicleColour: string | null = null

      // 3. (Optional) ALPR inference via Railway inference service
      if (runInference) {
        toast.info('Detecting plate number…')
        const { data: inferData, error: inferErr } = await railwayServices.inferVehicle(photoUrl)

        if (!inferErr && inferData?.plate_number) {
          plateNumber   = inferData.plate_number
          vehicleMake   = inferData.vehicle_make   ?? null
          vehicleModel  = inferData.vehicle_model  ?? null
          vehicleColour = inferData.vehicle_colour ?? null
          toast.success(`Plate detected: ${plateNumber}`)
        } else {
          toast.warning('No plate detected — enter plate manually')
        }
      }

      onCapture({ plateNumber, photoUrl, latitude, longitude, vehicleMake, vehicleModel, vehicleColour })
      stopCamera()
      setOpen(false)
    } catch (err: any) {
      toast.error('Photo processing failed: ' + (err.message ?? 'Unknown error'))
    } finally {
      setProcessing(false)
    }
  }

  // ── Open / close ────────────────────────────────────────────────────────────

  const handleOpen = () => {
    setOpen(true)
    // Short delay so the Dialog can render before getUserMedia is called
    setTimeout(startCamera, 250)
  }

  const handleClose = () => {
    stopCamera()
    setOpen(false)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Trigger / thumbnail ─── */}
      {existingPhotoUrl ? (
        <div className="relative rounded-lg overflow-hidden border">
          <img
            src={existingPhotoUrl}
            alt="Captured"
            className="w-full max-h-40 object-cover"
          />
          <div className="absolute top-1.5 right-1.5 flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs"
              onClick={handleOpen}
            >
              <Camera className="h-3 w-3 mr-1" />
              Retake
            </Button>
            {onClear && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-7 w-7 p-0"
                onClick={onClear}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full h-20 border-dashed flex-col gap-1 text-muted-foreground hover:text-foreground"
          onClick={handleOpen}
        >
          <Camera className="h-5 w-5" />
          <span className="text-sm font-medium">{label}</span>
          {hint && <span className="text-xs opacity-70">{hint}</span>}
        </Button>
      )}

      {/* ── Camera dialog ──────── */}
      <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
        <DialogContent className="max-w-sm p-4" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Camera className="h-4 w-4" />
              {label}
            </DialogTitle>
          </DialogHeader>

          {runInference && (
            <p className="text-xs text-muted-foreground -mt-1 mb-1">
              Position camera to show the number plate, front-left tyre, and nearby road sign.
              GPS location will be recorded automatically.
            </p>
          )}

          {isCameraOn || captured ? (
            <div className="space-y-3">
              {/* Preview / viewfinder */}
              <div className="relative bg-black rounded-lg overflow-hidden aspect-[4/3]">
                {captured ? (
                  <img src={captured} alt="Preview" className="w-full h-full object-contain" />
                ) : (
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                )}
                {runInference && !captured && (
                  <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
                    <div className="bg-black/50 text-white text-xs rounded px-2 py-1 flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> GPS + ALPR will run on capture
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {!captured ? (
                <div className="flex gap-2">
                  <Button onClick={captureFrame} className="flex-1">
                    <Camera className="h-4 w-4 mr-2" />
                    Capture Photo
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={handleClose}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    onClick={processPhoto}
                    className="flex-1"
                    disabled={processing}
                  >
                    {processing ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…</>
                    ) : (
                      <><CheckCircle className="h-4 w-4 mr-2" />Use This Photo</>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCaptured(null)}
                    disabled={processing}
                  >
                    Retake
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* Waiting for camera to initialise */
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Starting camera…</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
