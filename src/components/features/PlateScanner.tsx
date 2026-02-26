import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Camera, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

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
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      })

      // Convert base64 to blob
      const blob = await fetch(capturedImage).then(r => r.blob())
      
      // Upload to Supabase Storage
      const fileName = `scan-${Date.now()}.jpg`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(`temp/${fileName}`, blob)

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('evidence')
        .getPublicUrl(`temp/${fileName}`)

      // Call ALPR edge function
      const { data: alprData, error: alprError } = await supabase.functions.invoke('alpr-process', {
        body: {
          photoUrl: urlData.publicUrl,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }
      })

      if (alprError) throw alprError

      if (alprData?.plate_number) {
        onScanComplete({
          plateNumber: alprData.plate_number,
          photoUrl: urlData.publicUrl,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        stopCamera()
      } else {
        toast.error('No plate number detected. Please try again.')
      }
    } catch (error: any) {
      toast.error('Scan failed: ' + error.message)
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
