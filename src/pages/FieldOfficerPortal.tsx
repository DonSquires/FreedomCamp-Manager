import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { monitorGeofenceAndPatrol } from '@/lib/geofence'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLayout } from '@/components/features/AppLayout'
import { CameraCapture } from '@/components/features/CameraCapture'
import { LocationAuthorizationStatus } from '@/components/features/LocationAuthorizationStatus'
import { QRCheckpointScanner } from '@/components/features/QRCheckpointScanner'
import { useManDownDetection } from '@/hooks/useManDownDetection'
import { Camera, Map, FileText, History, AlertTriangle, MapPin, QrCode, ShieldAlert, CheckCircle, Shield, Megaphone, FileWarning } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'

// ============================================================================
// FALLBACK ZONE: Use NULL for scans outside geofences
// Database will handle missing zones via default constraints
// ============================================================================
const OTHER_LOCATION_ZONE_ID = null;

// Enforcement workflow mode labels shown in the status card
const WORKFLOW_LABELS: Record<string, string> = {
  admin_first:    'Admin First',
  officer_direct: 'Officer Direct',
  hybrid:         'Hybrid',
}

export default function FieldOfficerPortal() {
  const { user } = useAuthStore()
  const { zoneId, zoneName, setZone } = useGlobalFiltersStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showScanner, setShowScanner] = useState(false)
  const [showCheckpoint, setShowCheckpoint] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentPatrolZone, setCurrentPatrolZone] = useState<string | null>(zoneId)
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null)

  // Man-Down Detection — records GPS updates and fires alert if stationary too long
  const { recordGPSUpdate, isManDownActive } = useManDownDetection()

  // Display-friendly zone label for the officer status card
  const displayZone = zoneName || (zoneId ? `${zoneId.substring(0, 8)}...` : 'Scanning Geofence...')

  // ── Fetch org enforcement_workflow ────────────────────────────────────────
  const { data: orgWorkflow } = useQuery({
    queryKey: ['org-workflow', user?.organization_id],
    queryFn: async () => {
      if (!user?.organization_id) return 'admin_first'
      const { data, error } = await supabase
        .from('organizations')
        .select('enforcement_workflow')
        .eq('id', user.organization_id)
        .single()
      if (error) return 'admin_first'
      return (data?.enforcement_workflow as string) || 'admin_first'
    },
    enabled: !!user?.organization_id,
    staleTime: 1000 * 60 * 10,
  })

  // ── Fetch officer's recent observations ───────────────────────────────────
  const { data: recentScans = [], refetch: refetchScans } = useQuery({
    queryKey: ['my-recent-scans', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('observations')
        .select('id, plate_number, recorded_at, is_compliant, processing_status, photo_url, zone:zones!zone_id(name)')
        .eq('recorded_by', user.id)
        .order('recorded_at', { ascending: false })
        .limit(10)
      if (error) return []
      return data as any[]
    },
    enabled: !!user?.id,
    refetchInterval: 15000,  // auto-refresh every 15 s so AI results appear
  })

  // ── Enforcement action mutation ────────────────────────────────────────────
  const issueAction = useMutation({
    mutationFn: async ({ observationId, zoneId: obsZoneId, plateNumber, actionType }: {
      observationId: string
      zoneId: string
      plateNumber: string
      actionType: 'warning' | 'notice_to_vacate'
    }) => {
      const { error } = await supabase
        .from('enforcement_actions')
        .insert({
          organization_id: user?.organization_id,
          user_id: user?.id,
          zone_id: obsZoneId,
          plate_number: plateNumber,
          action_type: actionType,
          observation_id: observationId,
          status: 'pending',
          recorded_at: new Date().toISOString(),
        })
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.actionType === 'warning'
          ? '⚠️ Warning issued'
          : '📋 Notice to Vacate issued'
      )
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to issue enforcement action')
    },
  })

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

      // Feed location into Man-Down detection (resets stationary timer when officer moves)
      recordGPSUpdate(position.coords.latitude, position.coords.longitude)

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

        if (!weatherError && weatherData?.weather) {
          weatherConditions = weatherData.weather;
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
      const filePath = `${user.id}/${timestamp}-${photoHash}.jpg`
      
      const { error: uploadError } = await supabase.storage
        .from('scans')
        .upload(filePath, file, {
          contentType: 'image/jpeg',
          upsert: false
        })

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

      const { data: urlData } = supabase.storage.from('scans').getPublicUrl(filePath)
      const photoUrl = urlData.publicUrl

      console.log('☁️ Photo Uploaded:', { photo_url: photoUrl })

      // ============================================================================
      // STEP 6: GET OR CREATE "OTHER LOCATION" ZONE (If outside geofence)
      // ============================================================================
      let finalZoneId = zoneId;

      if (!finalZoneId) {
        // Scan is outside geofences - get/create "Other Location" zone using RPC
        // (Officers can't INSERT into zones table directly due to RLS)
        const { data: otherZoneId, error: rpcError } = await supabase
          .rpc('ensure_other_location_zone', { p_organization_id: user.organization_id });

        if (rpcError) {
          console.error('❌ Failed to get Other Location zone:', rpcError);
          throw new Error('Zone setup failed - contact support');
        }

        finalZoneId = otherZoneId;
        console.log('✅ Using Other Location zone:', finalZoneId);
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
      {/* Man-Down active warning banner */}
      {isManDownActive && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-400 bg-red-50 dark:bg-red-950 p-4">
          <ShieldAlert className="h-6 w-6 text-red-600 shrink-0 animate-pulse" />
          <div>
            <p className="font-semibold text-red-700 dark:text-red-300">🚨 Man-Down Alert Active</p>
            <p className="text-sm text-red-600 dark:text-red-400">Emergency alert sent to admin. Move or acknowledge to clear.</p>
          </div>
        </div>
      )}

      {showScanner ? (
        <CameraCapture 
          onCapture={handleCapture} 
          onCancel={() => setShowScanner(false)} 
          facing="environment" 
          showControls={true} 
        />
      ) : showCheckpoint ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-indigo-600" />
              Checkpoint Check-In
            </CardTitle>
            <CardDescription>Scan QR code or enter code at patrol checkpoint</CardDescription>
          </CardHeader>
          <CardContent>
            <QRCheckpointScanner
              patrolId={currentPatrolZone}
              onVisitRecorded={() => setShowCheckpoint(false)}
            />
            <Button variant="ghost" className="w-full mt-4" onClick={() => setShowCheckpoint(false)}>
              Back to Portal
            </Button>
          </CardContent>
        </Card>
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

          {/* QR Checkpoint Check-In */}
          <Card className="hover:shadow-lg transition-shadow border-indigo-200 dark:border-indigo-900 border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900 rounded-lg">
                  <QrCode className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                Checkpoint
                <Badge variant="outline" className="ml-auto text-xs">Lone Worker</Badge>
              </CardTitle>
              <CardDescription>Scan QR/NFC at patrol checkpoint</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => setShowCheckpoint(true)}>
                Check In at Checkpoint
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

          <Card className="hover:shadow-lg transition-shadow border-red-200 dark:border-red-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                  <Shield className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                Infringement Notices
              </CardTitle>
              <CardDescription>Issue fines on-site</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/infringements')}>
                Issue / View Notices
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

      {/* Info Card — includes enforcement workflow badge */}
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
            <div className="flex justify-between items-center">
              <span>Enforcement Mode:</span>
              <Badge
                variant="outline"
                className={
                  orgWorkflow === 'officer_direct'
                    ? 'border-green-500 text-green-700 bg-green-50'
                    : orgWorkflow === 'hybrid'
                    ? 'border-yellow-500 text-yellow-700 bg-yellow-50'
                    : 'border-blue-400 text-blue-700 bg-blue-50'
                }
              >
                {WORKFLOW_LABELS[orgWorkflow || 'admin_first'] || orgWorkflow}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Recent Scans with enforcement actions ─────────────────────────── */}
      {!showScanner && !showCheckpoint && recentScans.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" />
              Recent Scans
            </CardTitle>
            <CardDescription className="text-xs">
              {orgWorkflow === 'officer_direct' && 'Officer Direct mode — you can issue warnings and notices on-site.'}
              {orgWorkflow === 'hybrid' && 'Hybrid mode — you can issue warnings on-site; notices require admin approval.'}
              {(!orgWorkflow || orgWorkflow === 'admin_first') && 'Admin First mode — breaches are automatically reported to admin.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {recentScans.map((scan: any) => {
              const isProcessingAI = scan.processing_status === 'pending'
              const inBreach = !scan.is_compliant && !isProcessingAI
              return (
                <div
                  key={scan.id}
                  className={`flex items-center gap-3 rounded-lg border p-2.5 ${
                    inBreach ? 'border-red-200 bg-red-50 dark:bg-red-950/30' : 'border-gray-100 bg-white dark:bg-slate-900'
                  }`}
                >
                  {/* Thumbnail */}
                  {scan.photo_url ? (
                    <img
                      src={scan.photo_url}
                      alt={scan.plate_number}
                      className="h-10 w-10 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-gray-100 flex items-center justify-center shrink-0">
                      <Camera className="h-5 w-5 text-gray-400" />
                    </div>
                  )}

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-bold text-sm">
                        {isProcessingAI ? '⏳ Scanning...' : (scan.plate_number || '—')}
                      </span>
                      {!isProcessingAI && (
                        <Badge
                          variant={scan.is_compliant ? 'default' : 'destructive'}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {scan.is_compliant ? 'Compliant' : 'Breach'}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {scan.zone?.name} · {formatDateTime(scan.recorded_at)}
                    </div>
                  </div>

                  {/* Enforcement action buttons — only shown for breach + AI complete */}
                  {inBreach && (
                    <div className="flex gap-1 shrink-0">
                      {/* Warning: shown for officer_direct AND hybrid */}
                      {(orgWorkflow === 'officer_direct' || orgWorkflow === 'hybrid') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px] border-yellow-400 text-yellow-700 hover:bg-yellow-50"
                          disabled={issueAction.isPending}
                          onClick={() =>
                            issueAction.mutate({
                              observationId: scan.id,
                              zoneId: scan.zone_id || '',
                              plateNumber: scan.plate_number,
                              actionType: 'warning',
                            })
                          }
                        >
                          <FileWarning className="h-3 w-3 mr-1" />
                          Warning
                        </Button>
                      )}

                      {/* Notice to Vacate: officer_direct only */}
                      {orgWorkflow === 'officer_direct' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px] border-red-400 text-red-700 hover:bg-red-50"
                          disabled={issueAction.isPending}
                          onClick={() =>
                            issueAction.mutate({
                              observationId: scan.id,
                              zoneId: scan.zone_id || '',
                              plateNumber: scan.plate_number,
                              actionType: 'notice_to_vacate',
                            })
                          }
                        >
                          <Megaphone className="h-3 w-3 mr-1" />
                          Notice
                        </Button>
                      )}

                      {/* Admin First: read-only badge */}
                      {(!orgWorkflow || orgWorkflow === 'admin_first') && (
                        <Badge variant="secondary" className="text-[10px]">
                          <Shield className="h-2.5 w-2.5 mr-1" />
                          Reported
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Compliant: green tick */}
                  {!inBreach && !isProcessingAI && (
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </AppLayout>
  )
}
