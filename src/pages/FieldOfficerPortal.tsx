import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { monitorGeofenceAndPatrol } from '@/lib/geofence'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLayout } from '@/components/features/AppLayout'
import { CameraCapture } from '@/components/features/CameraCapture'
import { Camera, Map, FileText, History, AlertTriangle, MapPin, X } from 'lucide-react'
import { toast } from 'sonner'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { railwayServices } from '@/lib/railwayServices'
import { supabase } from '@/lib/supabase'

export default function FieldOfficerPortal() {
  const { user } = useAuthStore()
  const { zoneId, setZone } = useGlobalFiltersStore()
  const navigate = useNavigate()
  const [showScanner, setShowScanner] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentPatrolZone, setCurrentPatrolZone] = useState<string | null>(zoneId)
  
  // Auto-monitor geofence and manage patrol
  useEffect(() => {
    if (!user?.id || !user?.organization_id) return
    
    // Initial check
    monitorGeofenceAndPatrol(
      user.id,
      user.organization_id,
      currentPatrolZone,
      (newZoneId, newZoneName) => {
        setCurrentPatrolZone(newZoneId)
        setZone(newZoneId, newZoneName)
      }
    )
    
    // Check every 30 seconds
    const interval = setInterval(() => {
      monitorGeofenceAndPatrol(
        user.id,
        user.organization_id!,
        currentPatrolZone,
        (newZoneId, newZoneName) => {
          setCurrentPatrolZone(newZoneId)
          setZone(newZoneId, newZoneName)
        }
      )
    }, 30000) // 30 seconds
    
    return () => clearInterval(interval)
  }, [user, currentPatrolZone])

  const handleCapture = async (file: File, metadata: any) => {
    setIsProcessing(true)
    
    try {
      // ========================================================================
      // CRITICAL: Validate session data BEFORE proceeding
      // ========================================================================
      if (!user?.id) {
        toast.error('Session expired. Please log out and log back in.')
        setShowScanner(false)
        setIsProcessing(false)
        return
      }

      if (!user?.organization_id) {
        toast.error('No organization assigned. Please contact administrator.')
        setShowScanner(false)
        setIsProcessing(false)
        return
      }

      // Zone should be auto-detected, but fallback to "Other Location" if null
      const effectiveZoneId = zoneId || 'other-location' // Create "Other Location" zone in database

      console.log('✅ Session validation passed:', {
        user_id: user.id,
        organization_id: user.organization_id,
        zone_id: zoneId,
      })

      // Get GPS location
      toast.info('Getting GPS location...')
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      })

      // Upload photo to Supabase Storage
      toast.info('Uploading photo...')
      const fileName = `scan-${Date.now()}.jpg`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(`temp/${fileName}`, file)

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('evidence')
        .getPublicUrl(`temp/${fileName}`)

      const photoUrl = urlData.publicUrl
      let plateNumber: string | null = null

      // Try ALPR first
      toast.info('Detecting plate number...')
      const { data: alprData, error: alprError } = await edgeFunctions.processALPR({
        photo_url: photoUrl,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      })

      if (!alprError && alprData?.plate_number) {
        plateNumber = alprData.plate_number
        toast.success(`Plate detected: ${plateNumber}`)
      } else {
        // Fallback to Railway OCR
        toast.info('ALPR failed, trying OCR...')
        const { data: ocrData, error: ocrError } = await railwayServices.performOCR(photoUrl)
        
        if (!ocrError && ocrData?.plate_number) {
          plateNumber = ocrData.plate_number
          toast.success(`OCR detected: ${plateNumber}`)
        } else {
          toast.error('No plate detected. Use manual entry.')
          setShowScanner(false)
          setIsProcessing(false)
          return
        }
      }

      // ========================================================================
      // CRITICAL: Build complete payload with ALL required fields
      // ========================================================================
      const payload = {
        // Required for RLS policy validation
        recorded_by: user.id,                      // ✅ User ID from session
        organization_id: user.organization_id,     // ✅ Organization from profile
        zone_id: effectiveZoneId,                  // ✅ Zone from geofence or "Other Location"
        
        // Vehicle data
        plate_number: plateNumber,
        photo_url: photoUrl,
        
        // GPS data
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        gps_accuracy: position.coords.accuracy,
        
        // Metadata
        recorded_at: new Date().toISOString(),
        idempotency_key: `${user.id}-${Date.now()}`, // Offline sync support
      }

      console.log('📦 Payload being sent to vehicle-ingest:', payload)

      // Create observation
      toast.info('Creating observation...')
      const { data: ingestData, error: ingestError } = await edgeFunctions.ingestVehicleObservation(payload)

      if (ingestError) throw new Error(ingestError)

      console.log('✅ Observation created successfully:', ingestData)

      // Success!
      if (ingestData?.breach_detected) {
        toast.warning(`⚠️ Breach Detected: ${ingestData.breach_type}`, { duration: 10000 })
      } else {
        toast.success('✅ Vehicle scanned successfully')
      }

      setShowScanner(false)
    } catch (error: any) {
      console.error('❌ Scan failed:', error)
      toast.error(error.message || 'Scan failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleStartScanner = () => {
    // ========================================================================
    // Pre-flight validation: Check required session data BEFORE opening camera
    // ========================================================================
    if (!user?.id) {
      toast.error('Session expired. Please refresh the page.')
      return
    }

    if (!user?.organization_id) {
      toast.error('No organization assigned. Contact your administrator.')
      return
    }

    // Zone is now auto-selected via geofence monitoring
    // If no zone detected, it will be set to "Other Location" automatically

    // Check camera availability
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Camera not available on this device')
      return
    }
    
    console.log('✅ Starting scanner with:', {
      user_id: user.id,
      organization_id: user.organization_id,
      zone_id: zoneId,
    })
    
    setShowScanner(true)
  }

  return (
    <AppLayout title="Field Officer Portal" description={`Welcome, ${user?.first_name || 'Officer'}`}>
      {/* Camera Scanner - Opens immediately */}
      {showScanner ? (
        <CameraCapture
          onCapture={handleCapture}
          onCancel={() => setShowScanner(false)}
          facing="environment"
          showControls={true}
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Quick Action Cards */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <Camera className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                Scan Vehicle
              </CardTitle>
              <CardDescription>
                Capture vehicle plate and location
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full" 
                onClick={handleStartScanner}
                disabled={isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Open Scanner'}
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                  <Map className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                Active Patrol
              </CardTitle>
              <CardDescription>
                Start or end your patrol session
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full" 
                variant="outline"
                onClick={() => toast.info('Patrol management coming soon')}
              >
                Start Patrol
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                  <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                Create Report
              </CardTitle>
              <CardDescription>
                Submit incident or H&S report
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full" 
                variant="outline"
                onClick={() => navigate('/incidents')}
              >
                New Report
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                  <History className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                My Scans
              </CardTitle>
              <CardDescription>
                View recent observations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full" 
                variant="outline"
                onClick={() => navigate('/compliance')}
              >
                View History
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                Breach Alerts
              </CardTitle>
              <CardDescription>
                View active breach notifications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full" 
                variant="outline"
                onClick={() => navigate('/breaches')}
              >
                View Alerts
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-teal-100 dark:bg-teal-900 rounded-lg">
                  <MapPin className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                </div>
                Zones
              </CardTitle>
              <CardDescription>
                View enforcement zones
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full" 
                variant="outline"
                onClick={() => navigate('/zones')}
              >
                View Zones
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Officer Tips */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Quick Tips</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <li>• Always ensure GPS is enabled for accurate location tracking</li>
            <li>• Capture clear photos of vehicle plates and self-contained stickers</li>
            <li>• The PlateScanner uses AI-powered plate recognition for quick scanning</li>
            <li>• Report any safety concerns immediately</li>
            <li>• Check breach alerts before starting your patrol</li>
          </ul>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
