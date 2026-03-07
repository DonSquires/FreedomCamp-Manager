import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Camera, X, Loader2, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { railwayServices } from '@/lib/railwayServices'
import { useAuthStore } from '@/stores/authStore'

interface PlateScannerProps {
  onScanComplete: (result: {
    plateNumber: string
    photoUrl: string
    latitude: number
    longitude: number
  }) => void
  onCancel?: () => void
}

export function PlateScanner({ onScanComplete, onCancel }: PlateScannerProps) {
  const { user } = useAuthStore()
  const [isScanning, setIsScanning] = useState(false)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        setIsCameraOpen(true)
      }
    } catch (error: any) {
      toast.error('Failed to access camera: ' + error.message)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setIsCameraOpen(false)
    setCapturedImage(null)
  }

  const capturePhoto = () => {
    if (!videoRef.current) return

    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    const ctx = canvas.getContext('2d')
    
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0)
      const imageData = canvas.toDataURL('image/jpeg')
      setCapturedImage(imageData)
    }
  }

  const processPhoto = async () => {
    if (!capturedImage) return

    setIsScanning(true)

    try {
      // Get current GPS location
      toast.info('Getting GPS location...')
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      })

      // Convert base64 to blob
      const blob = await fetch(capturedImage).then(r => r.blob())
      
      // Upload to Supabase Storage
      toast.info('Uploading photo...')
      const fileName = `scan-${Date.now()}.jpg`
      const userId = (await supabase.auth.getUser()).data.user?.id || 'unknown'
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('scans')
        .upload(`${userId}/${fileName}`, blob)

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('scans')
        .getPublicUrl(`${userId}/${fileName}`)

      const photoUrl = urlData.publicUrl
      let plateNumber: string | null = null
      let detectedConfidence: number | null = null

      // Step 1: Try ALPR first
      toast.info('Detecting plate number...')
      const { data: alprData, error: alprError } = await edgeFunctions.processALPR({
        photo_url: photoUrl,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      })

      if (!alprError && alprData?.plate_number) {
        plateNumber = alprData.plate_number
        detectedConfidence = alprData?.confidence ?? null
        toast.success(`Plate detected: ${plateNumber}`)
      } else {
        // Step 2: Fallback to Railway inference OCR
        toast.info('ALPR failed, trying OCR fallback...')
        const { data: ocrData, error: ocrError } = await railwayServices.performOCR(photoUrl)
        
        if (!ocrError && ocrData?.plate_number) {
          plateNumber = ocrData.plate_number
          detectedConfidence = ocrData?.confidence ?? null
          toast.success(`OCR detected: ${plateNumber}`)
        } else {
          toast.error('No plate number detected. Please try manual entry.')
          setIsScanning(false)
          return
        }
      }

      // Resolve a valid zone for ingest (fallback to org's Other Location zone)
      if (!user?.organization_id) {
        throw new Error('No organization is assigned to the current user')
      }

      const { data: zoneId, error: zoneError } = await (supabase as any).rpc('ensure_other_location_zone', {
        p_organization_id: user.organization_id,
      })

      if (zoneError || !zoneId) {
        throw new Error(zoneError?.message || 'Could not resolve zone for observation')
      }

      // Step 3: Create full observation via vehicle-ingest
      toast.info('Creating observation...')
      const { data: ingestData, error: ingestError } = await edgeFunctions.ingestVehicleObservation({
        image: capturedImage,
        gpsLatitude: position.coords.latitude,
        gpsLongitude: position.coords.longitude,
        gpsAccuracy: position.coords.accuracy,
        recordedAt: new Date().toISOString(),
        officerId: user?.id,
        organizationId: user?.organization_id,
        zoneId,
        idempotencyKey: `web-scan-${user?.id}-${Date.now()}`,
        plate: plateNumber,
        confidence: detectedConfidence,
        requires_manual_entry: !plateNumber,
      })

      if (ingestError) {
        toast.error(`Observation creation failed: ${ingestError}`)
        // Still return scan result for manual processing
        onScanComplete({
          plateNumber,
          photoUrl,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        stopCamera()
        return
      }

      // Step 4: Check NZSCV status (don't block on failure)
      if (plateNumber) {
        railwayServices.checkNZSCVCertification(plateNumber).then(({ data: nzscvData, error: nzscvError }) => {
          if (!nzscvError && nzscvData?.is_certified) {
            toast.success(`Self-contained verified: ${nzscvData.warrant_type}`, {
              duration: 5000,
              icon: <CheckCircle className="h-4 w-4" />,
            })
          }
        })
      }

      // Step 5: Enrich from MotorWeb (don't block on failure)
      if (plateNumber) {
        railwayServices.enrichVehicleFromMotorWeb(plateNumber).then(({ data: motorwebData, error: motorwebError }) => {
          if (!motorwebError && motorwebData) {
            toast.info(`Vehicle enriched: ${motorwebData.make} ${motorwebData.model}`, {
              duration: 3000,
            })
          }
        })
      }

      // Success!
      if (ingestData.breach_detected) {
        toast.warning(`⚠️ Breach Detected: ${ingestData.breach_type}`, {
          duration: 10000,
        })
      } else if (ingestData.is_compliant) {
        toast.success('✅ Vehicle is compliant')
      }

      onScanComplete({
        plateNumber,
        photoUrl,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      })
      stopCamera()
    } catch (error: any) {
      toast.error('Scan failed: ' + (error.message || 'Unknown error'))
    } finally {
      setIsScanning(false)
    }
  }

  const handleCancel = () => {
    stopCamera()
    onCancel?.()
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardContent className="p-6">
        {!isCameraOpen ? (
          <div className="text-center space-y-4">
            <Camera className="h-16 w-16 mx-auto text-gray-400" />
            <div>
              <h3 className="text-lg font-semibold mb-2">Scan Vehicle Plate</h3>
              <p className="text-sm text-gray-600">
                Use your camera to capture a vehicle registration plate
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button onClick={startCamera}>
                <Camera className="h-4 w-4 mr-2" />
                Start Camera
              </Button>
              {onCancel && (
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative bg-black rounded-lg overflow-hidden">
              {capturedImage ? (
                <img src={capturedImage} alt="Captured" className="w-full" />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full"
                />
              )}
            </div>

            <div className="flex gap-2">
              {!capturedImage ? (
                <>
                  <Button onClick={capturePhoto} className="flex-1">
                    <Camera className="h-4 w-4 mr-2" />
                    Capture Photo
                  </Button>
                  <Button variant="outline" onClick={handleCancel}>
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button 
                    onClick={processPhoto} 
                    className="flex-1"
                    disabled={isScanning}
                  >
                    {isScanning ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Process Scan'
                    )}
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setCapturedImage(null)}
                    disabled={isScanning}
                  >
                    Retake
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
