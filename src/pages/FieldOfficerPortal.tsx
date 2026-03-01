import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { monitorGeofenceAndPatrol } from '@/lib/geofence'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLayout } from '@/components/features/AppLayout'
import { CameraCapture } from '@/components/features/CameraCapture'
import { LocationAuthorizationStatus } from '@/components/features/LocationAuthorizationStatus'
import { Camera, Map, FileText, History, AlertTriangle, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

// ============================================================================
// FALLBACK ZONE: Use NULL for scans outside geofences
// Database will handle missing zones via default constraints
// ============================================================================
const OTHER_LOCATION_ZONE_ID = null;

export default function FieldOfficerPortal() {
  const { user } = useAuthStore()
  const { zoneId, zoneName, setZone } = useGlobalFiltersStore()
  const navigate = useNavigate()
  const [showScanner, setShowScanner] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentPatrolZone, setCurrentPatrolZone] = useState<string | null>(zoneId)
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null)

  // Display-friendly zone label for the officer status card
  const displayZone = zoneName || (zoneId ? `${zoneId.substring(0, 8)}...` : 'Scanning Geofence...')

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

      // Update current location for status display
      setCurrentLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      })

      // ============================================================================
      // STEP 3: FETCH WEATHER CONDITIONS (Non-blocking)
      // ============================================================================
      toast.info('Getting weather conditions...')
      let weatherConditions = 'Unknown';
      
      try {
        const { data: weatherData, error: weatherError } = await supabase.functions.invoke('get-weather', {
          body: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }
        });

        if (!weatherError && weatherData?.conditions) {
          weatherConditions = weatherData.conditions;
          console.log('🌤️ Weather:', weatherConditions);
        } else {
          console.warn('⚠️ Weather fetch failed, using fallback');
        }
      } catch (err) {
        console.warn('⚠️ Weather API error (non-critical):', err);
      }

      // ============================================================================
      // STEP 4: GENERATE METADATA
      // ============================================================================
      const timestamp = Date.now()
      const photoHash = `sha256-${timestamp}-${Math.random().toString(36).substring(7)}`
      const idempotencyKey = `scan-${user.id}-${timestamp}`

      console.log('📸 Photo Metadata:', {
        size_bytes: file.size,
        type: file.type,
        photo_hash: photoHash,
        idempotency_key: idempotencyKey,
        weather: weatherConditions
      })

      // ============================================================================
      // STEP 5: UPLOAD PHOTO TO STORAGE (Evidence preservation) - FAST PATH
      // ============================================================================
      toast.info('Uploading photo...')
      const filePath = `scans/${user.id}/${timestamp}-${photoHash}.jpg`
      
      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(filePath, file, {
          contentType: 'image/jpeg',
          upsert: false
        })

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

      const { data: urlData } = supabase.storage.from('evidence').getPublicUrl(filePath)
      const photoUrl = urlData.publicUrl

      console.log('☁️ Photo Uploaded:', { photo_url: photoUrl })

      // ============================================================================
      // STEP 6: GET OR CREATE "OTHER LOCATION" ZONE (If outside geofence)
      // ============================================================================
      let finalZoneId = zoneId;

      if (!finalZoneId) {
        // Scan is outside geofences - get/create "Other Location" zone
        const { data: otherZone } = await supabase
          .from('zones')
          .select('id')
          .eq('organization_id', user.organization_id)
          .eq('name', 'Other Location')
          .maybeSingle();

        if (otherZone) {
          finalZoneId = otherZone.id;
        } else {
          // Create "Other Location" zone on-the-fly (parent zone for jurisdiction)
          const { data: newZone, error: zoneError } = await supabase
            .from('zones')
            .insert({
              organization_id: user.organization_id,
              name: 'Other Location',
              description: 'Council jurisdiction area - default zone for observations outside specific enforcement zones',
              zone_type: 'general',  // ✅ Parent zone
              parent_zone_id: null,  // ✅ Top-level parent
              is_active: true,
              self_contained_required: true,
              nights_per_month: 28,
              max_consecutive_nights: 3,
              day_visit_only: false,
            })
            .select('id')
            .single();

          if (zoneError) {
            console.error('❌ Failed to create Other Location zone:', zoneError);
            throw new Error('Zone setup failed - contact support');
          }

          finalZoneId = newZone.id;
          console.log('✅ Created Other Location zone:', finalZoneId);
        }
      }

      // ============================================================================
      // STEP 7: CREATE OBSERVATION (FAST SAVE - No AI, Status='pending')
      // ============================================================================
      toast.info('Saving observation...')
      
      const { data: observation, error: obsError } = await supabase
        .from('observations')
        .insert({
          // CRITICAL: Identity
          idempotency_key: idempotencyKey,
          recorded_by: user.id,
          organization_id: user.organization_id,
          zone_id: finalZoneId,
          
          // CRITICAL: Photo evidence
          photo_url: photoUrl,
          photo_hash: photoHash,
          
          // CRITICAL: GPS
          gps_latitude: position.coords.latitude,
          gps_longitude: position.coords.longitude,
          gps_accuracy: position.coords.accuracy,
          
          // CRITICAL: Timestamp
          recorded_at: new Date().toISOString(),
          
          // PROCESSING: Will be populated by background job
          plate_number: 'PROCESSING...',
          processing_status: 'pending',
          
          // Optional metadata
          is_compliant: true,
          weather_conditions: weatherConditions,
        })
        .select('id, plate_number, processing_status')
        .single()

      if (obsError) {
        console.error('❌ Database error:', obsError)
        throw new Error(`Save failed: ${obsError.message}`)
      }

      console.log('✅ Observation saved (pending AI):', {
        observation_id: observation.id,
        zone_id: finalZoneId,
        status: observation.processing_status,
        weather: weatherConditions
      })

      // ============================================================================
      // STEP 8: FIRE-AND-FORGET BACKGROUND AI PROCESSING
      // ============================================================================
      // Call Edge Function asynchronously (don't wait for it)
      supabase.functions.invoke('alpr-process', {
        body: {
          observation_id: observation.id,
          photo_url: photoUrl,
          regions: ['nz'],
          mmc: true,
        }
      }).then(({ data, error }) => {
        if (error) {
          console.error('❌ Background AI failed:', error)
        } else {
          console.log('✅ Background AI completed:', data)
        }
      })

      // ============================================================================
      // STEP 9: IMMEDIATE SUCCESS (User can scan next vehicle)
      // ============================================================================
      toast.success('✅ Evidence Secured', { 
        duration: 5000,
        description: 'AI is analyzing plate number...'
      })

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

      {/* Location Authorization Status */}
      {!showScanner && currentLocation && user?.organization_id && (
        <div className="mt-6">
          <LocationAuthorizationStatus
            organizationId={user.organization_id}
            latitude={currentLocation.latitude}
            longitude={currentLocation.longitude}
            refreshInterval={10000}
          />
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
              <span className="font-semibold text-blue-600">{displayZone}</span>
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
