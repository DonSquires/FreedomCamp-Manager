import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { monitorGeofenceAndPatrol } from '@/lib/geofence'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLayout } from '@/components/features/AppLayout'
import { CameraCapture } from '@/components/features/CameraCapture'
import { Camera, Map, FileText, History, AlertTriangle, MapPin } from 'lucide-react'
import { toast } from 'sonner'
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

    const checkGeofence = () => {
      monitorGeofenceAndPatrol(
        user.id,
        user.organization_id!,
        currentPatrolZone,
        (newZoneId, newZoneName) => {
          setCurrentPatrolZone(newZoneId)
          setZone(newZoneId, newZoneName)
        }
      )
    }

    checkGeofence()
    const interval = setInterval(checkGeofence, 30000)
    return () => clearInterval(interval)
  }, [user, currentPatrolZone])

  /**
   * OPTIMIZED SCAN LOGIC - PHOTO FIRST, THEN ANALYZE
   * 1. Upload photo to /scans/{user_id}/ and get public URL
   * 2. Call alpr-process with photo URL + metadata
   * 3. Edge Function downloads photo and sends to ALPR service
   * 4. Handle success/failure gracefully
   */
  const handleCapture = async (file: File) => {
    setIsProcessing(true)
    try {
      // ============================================================================
      // STEP 1: SESSION VALIDATION (Pre-flight Check)
      // ============================================================================
      if (!user?.id || !user?.organization_id) {
        throw new Error('Session expired. Please log out and log back in.')
      }

      console.log('🔒 Pre-flight Check:', {
        user_id: user.id,
        organization_id: user.organization_id,
        zone_id: zoneId || 'other-location',
        timestamp: new Date().toISOString()
      })

      // ============================================================================
      // STEP 2: GPS LOCATION (Required for geofence validation)
      // ============================================================================
      toast.info('Getting GPS location...')
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      })

      console.log('📍 GPS Location:', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      })

      // ============================================================================
      // STEP 3: GENERATE METADATA
      // ============================================================================
      const timestamp = Date.now()
      const photoHash = `sha256-${timestamp}-${Math.random().toString(36).substring(7)}`
      const idempotencyKey = `scan-${user.id}-${timestamp}`

      console.log('📸 Photo Metadata:', {
        size_bytes: file.size,
        type: file.type,
        photo_hash: photoHash,
        idempotency_key: idempotencyKey
      })

      // ============================================================================
      // STEP 4: UPLOAD PHOTO TO STORAGE (Evidence preservation)
      // ============================================================================
      toast.info('Uploading photo...')
      const filePath = `scans/${user.id}/${timestamp}-${photoHash}.jpg`
      
      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(filePath, file, {
          contentType: 'image/jpeg',
          upsert: false // Prevent overwriting
        })

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

      const { data: urlData } = supabase.storage.from('evidence').getPublicUrl(filePath)
      const photoUrl = urlData.publicUrl

      console.log('☁️ Photo Uploaded:', { photo_url: photoUrl })

      // ============================================================================
      // STEP 5: CALL ALPR PIPELINE (Plate Recognizer → Railway Inference)
      // ============================================================================
      toast.info('Analyzing vehicle...')
      
      const payload = {
        // CRITICAL: Photo evidence (already uploaded)
        photo_url: photoUrl,
        photo_hash: photoHash,
        
        // CRITICAL: Identity fields
        officerId: user.id,
        organizationId: user.organization_id,
        zoneId: zoneId || 'other-location',
        
        // CRITICAL: GPS coordinates
        gpsLatitude: position.coords.latitude,
        gpsLongitude: position.coords.longitude,
        gpsAccuracy: position.coords.accuracy,
        
        // CRITICAL: Timestamp & deduplication
        recordedAt: new Date().toISOString(),
        idempotencyKey: idempotencyKey,
        
        // OPTIONAL: ALPR configuration
        regions: ['nz'],
        mmc: true, // Make, Model, Color detection
      }

      console.log('📦 Payload Validation:', {
        has_photo_url: !!payload.photo_url,
        has_photo_hash: !!payload.photo_hash,
        has_idempotency: !!payload.idempotencyKey,
        has_gps: !!(payload.gpsLatitude && payload.gpsLongitude),
        has_identity: !!(payload.officerId && payload.organizationId && payload.zoneId),
      })

      // Call Edge Function (automatically includes Authorization header)
      const { data, error: ingestError } = await supabase.functions.invoke('alpr-process', {
        body: payload
      })

      console.log('🔄 ALPR Response:', { data, error: ingestError })

      if (ingestError) {
        console.error('❌ ALPR Error:', ingestError)
        throw new Error(`Server Error: ${ingestError.message || 'Check logs'}`)
      }

      if (!data?.success) {
        console.error('❌ ALPR Failed:', data)
        throw new Error(data?.error || 'AI Analysis failed to return a valid result.')
      }

      // ============================================================================
      // STEP 6: SUCCESS HANDLING
      // ============================================================================
      const plate = data.plate || data.observation?.plate_number
      const stage = data.stage || 'unknown'
      const confidence = data.confidence || 0

      console.log('✅ Scan Success:', {
        plate,
        stage,
        confidence,
        observation_id: data.observation_id
      })

      if (!plate || plate === 'MANUAL_REQUIRED') {
        toast.warning('⚠️ Plate not detected - Manual entry required', { 
          duration: 6000,
          description: `AI Stage: ${stage}` 
        })
      } else {
        toast.success(`✅ Vehicle Sighted: ${plate}`, { 
          duration: 5000,
          description: `Detected by: ${stage} (${Math.round(confidence * 100)}% confidence)`
        })
      }

      setShowScanner(false)

    } catch (error: any) {
      console.error('❌ Scan Pipeline Failed:', error)
      toast.error(error.message || 'Scan failed', {
        description: 'Please try again or contact support if issue persists'
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleStartScanner = () => {
    if (!user?.id || !user?.organization_id) {
      toast.error('Session expired. Please re-login.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Camera not available on this device')
      return
    }
    setShowScanner(true)
  }

  return (
    <AppLayout title="Field Officer Portal" description={`Welcome, ${user?.full_name || 'Officer'}`}>
      {showScanner ? (
        <CameraCapture 
          onCapture={handleCapture} 
          onCancel={() => setShowScanner(false)} 
          facing="environment" 
          showControls={true} 
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Main Action: Scan */}
          <Card className="hover:shadow-lg transition-shadow border-blue-200 dark:border-blue-900 border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <Camera className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                Scan Vehicle
              </CardTitle>
              <CardDescription>Capture plate and GPS location</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full h-12 text-lg" onClick={handleStartScanner} disabled={isProcessing}>
                {isProcessing ? 'Processing...' : 'Open Scanner'}
              </Button>
            </CardContent>
          </Card>

          {/* Secondary Actions */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                  <Map className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                Active Patrol
              </CardTitle>
              <CardDescription>Manage your patrol session</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => toast.info('Patrol tracking active via geofence')}>
                Patrol Status
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
              <CardDescription>Submit incident or H&S</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/incidents')}>
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
              <CardDescription>Recent observations</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/compliance')}>
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
              <CardDescription>Active notifications</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/breaches')}>
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
              <CardDescription>Enforcement zones</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/zones')}>
                View Zones
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Info Card */}
      <Card className="mt-6 bg-slate-50 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-sm">Officer Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-xs text-gray-500">
            <div className="flex justify-between">
              <span>Current Zone:</span>
              <span className="font-semibold text-blue-600">{zoneId || 'Scanning Geofence...'}</span>
            </div>
            <div className="flex justify-between">
              <span>Organization:</span>
              <span>{user?.organization_id?.substring(0, 8)}...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
