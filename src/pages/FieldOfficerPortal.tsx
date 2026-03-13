import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { monitorGeofenceAndPatrol } from '@/lib/geofence'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLayout } from '@/components/features/AppLayout'
import { SplitScanCamera } from '@/components/features/SplitScanCamera'
import { LocationAuthorizationStatus } from '@/components/features/LocationAuthorizationStatus'
import { QRCheckpointScanner } from '@/components/features/QRCheckpointScanner'
import { useManDownDetection } from '@/hooks/useManDownDetection'
import { Camera, Map, FileText, History, AlertTriangle, MapPin, QrCode, ShieldAlert, CheckCircle, Shield, Megaphone, FileWarning, XCircle, Clock, Home, X, Car } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { resolveObservationZoneForOrg } from '@/lib/zoneResolution'
import { formatDateTime } from '@/lib/utils'
import { fetchWeatherOnDevice } from '@/lib/weather'

// Enforcement workflow mode labels shown in the status card
const WORKFLOW_LABELS: Record<string, string> = {
  admin_first:    'Admin First',
  officer_direct: 'Officer Direct',
  hybrid:         'Hybrid',
}

/** Converts snake_case breach type keys to human-readable labels. */
const formatBreachType = (breachType: string | null | undefined): string => {
  if (!breachType) return 'Breach'
  return breachType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
// ── Scan pipeline constants ───────────────────────────────────────────────────
// Poll the DB every 2 s for enrichment results; give up after 90 s (45 attempts)
const POLL_INTERVAL_MS     = 2000
const MAX_POLL_ATTEMPTS    = 45
/** Duration (ms) the "processing" toast stays on screen. */
const PROCESSING_TOAST_DURATION_MS = 6000



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
  const [lastScanResult, setLastScanResult] = useState<{
    observationId: string | null
    photoUrl: string | null
    plateNumber: string | null
    isCompliant: boolean | null
    breachType: string | null
    processingPending: boolean
    zoneName: string | null
    observationZoneId: string | null
    recordedAt: string
    vehicleMake: string | null
    vehicleModel: string | null
    vehicleYear: string | null
    isSelfContained: boolean
    selfContainedExpiry: string | null
    cscStatus: string | null
    vehicleMoved: boolean | null
    isNewVehicle: boolean
  } | null>(null)
  const [scanTabFilter, setScanTabFilter] = useState<'all' | 'compliant' | 'breach' | 'at_risk' | 'homeless'>('all')

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
      return ((data as any)?.enforcement_workflow as string) || 'admin_first'
    },
    enabled: !!user?.organization_id,
    staleTime: 1000 * 60 * 10,
  })

  // ── Fetch officer's recent observations ───────────────────────────────────
  const { data: recentScans = [], refetch: refetchScans } = useQuery({
    queryKey: ['my-recent-scans', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const historyCutoffIso = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString()

      // Live schema: PK is observation_id, photo cols are photo + photo_url, no processing_status
      const selectCandidates = [
        [
          'observation_id, plate_number, recorded_at, is_compliant',
          'photo, photo_url, zone_id, breach_type, consecutive_nights, nights_stayed_this_month',
          'zone:zones!zone_id(name)',
          'vehicle:canonical_vehicles!plate_number(homeless_status, is_exempt)',
        ].join(', '),
        // Fallback: try id alias in case schema cache is stale
        [
          'id:observation_id, plate_number, recorded_at, is_compliant',
          'photo, photo_url, zone_id, breach_type, consecutive_nights, nights_stayed_this_month',
          'zone:zones!zone_id(name)',
          'vehicle:canonical_vehicles!plate_number(homeless_status, is_exempt)',
        ].join(', '),
        // Minimal fallback
        [
          'observation_id, plate_number, recorded_at, is_compliant',
          'photo, photo_url, zone_id, breach_type',
          'zone:zones!zone_id(name)',
        ].join(', '),
      ]

      for (const selectClause of selectCandidates) {
        const { data, error } = await supabase
          .from('observations')
          .select(selectClause)
          .eq('recorded_by', user.id)
          .gte('recorded_at', historyCutoffIso)
          .order('recorded_at', { ascending: false })
          .limit(20)

        if (error) continue

        const rows = (data || []).map((row: any) => ({
          ...row,
          id: row.observation_id ?? row.id,
          // No processing_status in live schema — use plate_number to infer ALPR state
          photo_url: row.photo ?? row.photo_url ?? null,
        }))

        return rows as any[]
      }

      return []
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
      const { error } = await (supabase
        .from('enforcement_actions') as any)
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
  }, [user, currentPatrolZone, setZone])

  // ── Polling: update lastScanResult once process-officer-scan completes ───
  useEffect(() => {
    if (!lastScanResult?.observationId || !lastScanResult.processingPending) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0

    const poll = async () => {
      if (cancelled) return
      attempts++

      const { data: obs } = await (supabase.from('observations') as any)
        .select(
          'observation_id, plate_number, is_compliant, breach_type, ' +
          'vehicle_make, vehicle_model, vehicle_year, vehicle_color, ' +
          'self_contained, self_contained_expiry, zone_id, ' +
          'zone:zones!zone_id(name)'
        )
        .eq('observation_id', lastScanResult.observationId)
        .maybeSingle()

      const resolved =
        obs &&
        obs.plate_number &&
        obs.plate_number !== 'PROCESSING...' &&
        obs.plate_number !== 'MANUAL_REQUIRED'

      if (resolved) {
        const compliant: boolean | null =
          typeof obs.is_compliant === 'boolean' ? obs.is_compliant : null

        setLastScanResult(prev =>
          prev
            ? {
                ...prev,
                plateNumber:         obs.plate_number,
                isCompliant:         compliant,
                breachType:          obs.breach_type ?? null,
                processingPending:   false,
                zoneName:            obs.zone?.name ?? prev.zoneName,
                observationZoneId:   obs.zone_id ?? prev.observationZoneId,
                vehicleMake:         obs.vehicle_make ?? null,
                vehicleModel:        obs.vehicle_model ?? null,
                vehicleYear:         obs.vehicle_year != null ? String(obs.vehicle_year) : null,
                isSelfContained:     !!obs.self_contained,
                selfContainedExpiry: obs.self_contained_expiry ?? null,
              }
            : null
        )

        if (compliant === true) {
          toast.success(`✅ Compliant — ${obs.plate_number}`)
        } else if (compliant === false) {
          toast.warning(`⚠️ Breach: ${formatBreachType(obs.breach_type)} — ${obs.plate_number}`)
        } else {
          toast.info(`Scan processed — ${obs.plate_number}`)
        }
        return
      }

      // Not yet resolved — also show partial updates (vehicle details without plate yet)
      if (obs?.vehicle_make && !resolved) {
        setLastScanResult(prev =>
          prev
            ? {
                ...prev,
                vehicleMake:         obs.vehicle_make ?? null,
                vehicleModel:        obs.vehicle_model ?? null,
                vehicleYear:         obs.vehicle_year != null ? String(obs.vehicle_year) : null,
                isSelfContained:     !!obs.self_contained,
                selfContainedExpiry: obs.self_contained_expiry ?? null,
              }
            : null
        )
      }

      if (attempts < MAX_POLL_ATTEMPTS) {
        timer = setTimeout(poll, POLL_INTERVAL_MS)
      } else {
        // Timeout — mark as no longer pending so UI stops spinning
        setLastScanResult(prev => prev ? { ...prev, processingPending: false } : null)
        toast.info('Scan saved. Plate detection is taking longer than expected.')
      }
    }

    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [lastScanResult?.observationId, lastScanResult?.processingPending])

  // ─── Scan pipeline ────────────────────────────────────────────────────────
  const handleCapture = async (file: File) => {
    setIsProcessing(true)
    try {
      // ── Step 1: Session validation ────────────────────────────────────
      if (!user?.id || !user?.organization_id) {
        throw new Error('Session expired. Please log out and log back in.')
      }

      // ── Step 2: GPS ───────────────────────────────────────────────────
      toast.info('Getting GPS location…')
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      )
      const { latitude, longitude, accuracy } = position.coords

      setCurrentLocation({ latitude, longitude })
      recordGPSUpdate(latitude, longitude)

      // ── Step 3: Weather (non-blocking — failure is acceptable) ────────
      let weatherConditions = 'Unknown'
      try {
        const w = await fetchWeatherOnDevice(latitude, longitude)
        if (w) weatherConditions = w
      } catch { /* non-critical */ }

      // ── Step 4: Compute SHA-256 hash + upload photo ───────────────────
      toast.info('Uploading photo…')
      const timestamp  = Date.now()
      const uniqueId   = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map(b => b.toString(16).padStart(2, '0')).join('')
      const filePath   = `${user.id}/${timestamp}-${uniqueId}.jpg`
      const idempotencyKey = `scan-${user.id}-${timestamp}`

      // Compute hash before upload so the edge function can skip re-download
      let photoHash = `sha256:${uniqueId}`   // fallback if SubtleCrypto fails
      try {
        const buf    = await file.arrayBuffer()
        const digest = await crypto.subtle.digest('SHA-256', buf)
        const hex    = Array.from(new Uint8Array(digest))
          .map(b => b.toString(16).padStart(2, '0')).join('')
        photoHash = `sha256:${hex}`
      } catch { /* fallback already set */ }

      const { error: uploadError } = await supabase.storage
        .from('scans')
        .upload(filePath, file, { contentType: 'image/jpeg', upsert: false })

      if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`)

      const { data: urlData } = supabase.storage.from('scans').getPublicUrl(filePath)
      const photoUrl = urlData.publicUrl

      // ── Step 5: Resolve zone ──────────────────────────────────────────
      const { zoneId: finalZoneId } = await resolveObservationZoneForOrg(
        user.organization_id,
        zoneId
      )
      if (!finalZoneId) throw new Error('Could not resolve patrol zone')

      // ── Step 6: Fast initial save (plate = PROCESSING…) ──────────────
      toast.info('Saving observation…')
      const nowIso = new Date().toISOString()

      const { data: rpcData, error: rpcError } = await (supabase as any).rpc(
        'safe_insert_observation',
        {
          p_data: {
            plate_number:    'PROCESSING...',
            photo:           photoUrl,
            photo_url:       photoUrl,
            photo_hash:      photoHash,
            recorded_at:     nowIso,
            zone_id:         finalZoneId,
            organization_id: user.organization_id,
            gps_latitude:    latitude,
            gps_longitude:   longitude,
            gps_accuracy:    accuracy,
            recorded_by:     user.id,
            idempotency_key: idempotencyKey,
            officer_notes:   weatherConditions !== 'Unknown'
              ? `Weather: ${weatherConditions}`
              : null,
          },
        }
      )

      // Fallback: direct insert if RPC not yet deployed
      let observationId: string | null = null
      if (!rpcError && rpcData) {
        observationId = (rpcData as any).observation_id ?? (rpcData as any).id ?? null
      } else {
        const isMissing =
          rpcError?.message?.includes('schema cache') ||
          rpcError?.message?.includes('Could not find') ||
          rpcError?.code === 'PGRST202'

        if (isMissing) {
          const { data: directData, error: directError } = await (
            supabase.from('observations') as any
          )
            .insert({
              plate_number:    'PROCESSING...',
              photo:           photoUrl,
              photo_url:       photoUrl,
              photo_hash:      photoHash,
              recorded_at:     nowIso,
              zone_id:         finalZoneId,
              organization_id: user.organization_id,
              gps_latitude:    latitude,
              gps_longitude:   longitude,
              gps_accuracy:    accuracy,
              recorded_by:     user.id,
              idempotency_key: idempotencyKey,
            })
            .select('observation_id')
            .single()

          if (directError || !directData) {
            throw new Error(`Save failed: ${directError?.message ?? 'Unknown error'}`)
          }
          observationId = (directData as any).observation_id ?? null
        } else {
          throw new Error(`Save failed: ${rpcError?.message ?? 'Unknown error'}`)
        }
      }

      if (!observationId) throw new Error('Observation saved but ID not returned')

      // ── Step 7: Immediate user feedback ──────────────────────────────
      toast.success('✅ Observation captured — processing plate & vehicle details…', {
        duration: PROCESSING_TOAST_DURATION_MS,
      })

      setLastScanResult({
        observationId,
        photoUrl,
        plateNumber:         null,
        isCompliant:         null,
        breachType:          null,
        processingPending:   true,
        zoneName:            null,
        observationZoneId:   finalZoneId,
        recordedAt:          nowIso,
        vehicleMake:         null,
        vehicleModel:        null,
        vehicleYear:         null,
        isSelfContained:     false,
        selfContainedExpiry: null,
        cscStatus:           null,
        vehicleMoved:        null,
        isNewVehicle:        false,
      })

      setShowScanner(false)
      refetchScans()

      // ── Step 8: Fire-and-forget enrichment ────────────────────────────
      // process-officer-scan runs: inference → ALPR → NZSCV → movement →
      // compliance → DB update.  The polling useEffect above picks up the
      // result and updates lastScanResult when plate_number is resolved.
      edgeFunctions.processOfficerScan({
        observation_id: observationId,
        photo_url:      photoUrl,
        photo_hash:     photoHash,
      }).then(({ data, error }) => {
        if (error) {
          console.warn('⚠️ process-officer-scan returned error:', error)
        } else if (data) {
          // Eagerly apply enrichment result so we don't have to wait for DB poll
          const d = data as any
          setLastScanResult(prev =>
            prev
              ? {
                  ...prev,
                  plateNumber:         d.plate ?? prev.plateNumber,
                  isCompliant:         d.compliance?.is_compliant ?? prev.isCompliant,
                  breachType:          d.compliance?.breach_type ?? prev.breachType,
                  processingPending:   false,
                  vehicleMake:         d.vehicle?.make ?? prev.vehicleMake,
                  vehicleModel:        d.vehicle?.model ?? prev.vehicleModel,
                  vehicleYear:         d.vehicle?.year != null ? String(d.vehicle.year) : prev.vehicleYear,
                  isSelfContained:     d.vehicle?.self_contained ?? prev.isSelfContained,
                  selfContainedExpiry: d.vehicle?.self_contained_expiry ?? prev.selfContainedExpiry,
                  cscStatus:           d.vehicle?.csc_status ?? prev.cscStatus,
                  vehicleMoved:        d.movement?.vehicle_moved ?? prev.vehicleMoved,
                  isNewVehicle:        d.movement?.is_new_vehicle ?? prev.isNewVehicle,
                }
              : null
          )
        }
      }).catch((err) => {
        console.warn('⚠️ process-officer-scan invoke error:', err?.message ?? err)
      })

    } catch (error: any) {
      console.error('❌ Scan failed:', error)
      toast.error(error.message || 'Scan failed', {
        description: 'Please try again or contact support if the issue persists.',
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
    setLastScanResult(null)
    setShowScanner(true)
  }

  const handleCloseScanner = useCallback(() => {
    setShowScanner(false)
  }, [])

  const handleViewHistory = () => {
    if (user?.role === 'officer') {
      const panel = document.getElementById('recent-scans-panel')
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    navigate('/compliance')
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
        <div className="flex flex-col gap-3">
          {/* Processing indicator when scan is uploading */}
          {isProcessing && (
            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-3">
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                Uploading &amp; saving observation…
              </span>
            </div>
          )}
          {/* ── Camera viewfinder ── */}
          <div
            className="w-full rounded-xl overflow-hidden border border-gray-700 shadow-lg"
            style={{ height: isProcessing ? '65vh' : '75vh', minHeight: '300px' }}
          >
            <SplitScanCamera
              onCapture={handleCapture}
              onCancel={handleCloseScanner}
              isProcessing={isProcessing}
            />
          </div>
        </div>
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
        <>
          {/* ── Last Scan Result Panel ─────────────────────────────────── */}
          {lastScanResult && (
            <Card className={`mb-4 border-2 ${
              lastScanResult.processingPending
                ? 'border-blue-300 bg-blue-50/60 dark:bg-blue-950/20'
                : lastScanResult.isCompliant === false
                ? 'border-red-400 bg-red-50 dark:bg-red-950/40'
                : 'border-green-400 bg-green-50 dark:bg-green-950/40'
            }`}>
              <CardHeader className="pb-2 pt-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Last Scan
                    {lastScanResult.processingPending && (
                      <Badge variant="secondary" className="text-[10px] animate-pulse">
                        <Clock className="h-2.5 w-2.5 mr-1" />Processing…
                      </Badge>
                    )}
                  </CardTitle>
                  <Button variant="ghost" size="icon" className="h-6 w-6"
                    onClick={() => setLastScanResult(null)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-3">
                <div className="flex gap-3 items-start">
                  {/* Photo thumbnail */}
                  {lastScanResult.photoUrl ? (
                    <img src={lastScanResult.photoUrl} alt="Scan"
                      className="h-20 w-20 rounded-lg object-cover shrink-0 border" />
                  ) : (
                    <div className="h-20 w-20 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0 border">
                      <Camera className="h-7 w-7 text-gray-400" />
                    </div>
                  )}
                  {/* Plate + compliance badge */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-lg">
                        {lastScanResult.plateNumber || (
                          lastScanResult.processingPending
                            ? <span aria-label="Scanning in progress">Scanning…</span>
                            : '—'
                        )}
                      </span>
                      {!lastScanResult.processingPending && lastScanResult.isCompliant !== null && (
                        lastScanResult.isCompliant ? (
                          <Badge className="bg-green-600 text-white text-[10px]">
                            <CheckCircle className="h-3 w-3 mr-1" />Compliant
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">
                            <XCircle className="h-3 w-3 mr-1" />
                            {formatBreachType(lastScanResult.breachType)}
                          </Badge>
                        )
                      )}
                    </div>

                    {/* Vehicle details row */}
                    {(lastScanResult.vehicleMake || lastScanResult.vehicleModel) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Car className="h-3 w-3 shrink-0" />
                        {[lastScanResult.vehicleMake, lastScanResult.vehicleModel, lastScanResult.vehicleYear]
                          .filter(Boolean).join(' ')}
                      </p>
                    )}

                    {/* CSC status */}
                    {!lastScanResult.processingPending && (
                      lastScanResult.isSelfContained ? (
                        <Badge className="text-[10px] bg-emerald-600 text-white">
                          <CheckCircle className="h-2.5 w-2.5 mr-1" />
                          Self-Contained
                          {lastScanResult.selfContainedExpiry
                            ? ` (exp ${lastScanResult.selfContainedExpiry.slice(0, 10)})`
                            : ''}
                        </Badge>
                      ) : lastScanResult.plateNumber ? (
                        <Badge variant="outline" className="text-[10px] border-orange-400 text-orange-700">
                          No CSC on record
                        </Badge>
                      ) : null
                    )}

                    {/* Zone */}
                    {lastScanResult.zoneName && (
                      <p className="text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 inline mr-1" />{lastScanResult.zoneName}
                      </p>
                    )}
                  </div>
                </div>

                {/* Movement / new-vehicle badge row */}
                {!lastScanResult.processingPending && lastScanResult.plateNumber && (
                  <div className="flex flex-wrap gap-1.5">
                    {lastScanResult.isNewVehicle && (
                      <Badge variant="secondary" className="text-[10px]">🆕 New vehicle in zone</Badge>
                    )}
                    {lastScanResult.vehicleMoved === true && (
                      <Badge variant="secondary" className="text-[10px]">📍 Vehicle has moved</Badge>
                    )}
                    {lastScanResult.vehicleMoved === false && (
                      <Badge variant="secondary" className="text-[10px]">🅿️ Vehicle stationary</Badge>
                    )}
                  </div>
                )}

                {/* Enforcement action buttons */}
                {!lastScanResult.processingPending && lastScanResult.isCompliant === false && lastScanResult.observationId && (
                  <div className="flex gap-2 flex-wrap pt-1">
                    {(orgWorkflow === 'officer_direct' || orgWorkflow === 'hybrid') && (
                      <Button size="sm" variant="outline"
                        className="h-7 text-[11px] border-yellow-400 text-yellow-700 hover:bg-yellow-50"
                        disabled={issueAction.isPending}
                        onClick={() => issueAction.mutate({
                          observationId: lastScanResult.observationId!,
                          zoneId: lastScanResult.observationZoneId || '',
                          plateNumber: lastScanResult.plateNumber || '',
                          actionType: 'warning',
                        })}>
                        <FileWarning className="h-3 w-3 mr-1" />Issue Warning
                      </Button>
                    )}
                    {orgWorkflow === 'officer_direct' && (
                      <Button size="sm" variant="outline"
                        className="h-7 text-[11px] border-red-400 text-red-700 hover:bg-red-50"
                        disabled={issueAction.isPending}
                        onClick={() => issueAction.mutate({
                          observationId: lastScanResult.observationId!,
                          zoneId: lastScanResult.observationZoneId || '',
                          plateNumber: lastScanResult.plateNumber || '',
                          actionType: 'notice_to_vacate',
                        })}>
                        <Megaphone className="h-3 w-3 mr-1" />Notice to Vacate
                      </Button>
                    )}
                    {(!orgWorkflow || orgWorkflow === 'admin_first') && (
                      <Badge variant="secondary" className="text-[10px]">
                        <Shield className="h-2.5 w-2.5 mr-1" />Reported to Admin
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

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
                {isProcessing ? 'Processing…' : 'Open Scanner'}
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
              <Button className="w-full" variant="outline" onClick={handleViewHistory}>
                {user?.role === 'officer' ? 'View 24h History' : 'View History'}
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
        </>
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
              <span>Organisation:</span>
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
        <Card className="mt-6" id="recent-scans-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" />
              Recent Scans
            </CardTitle>
            {user?.role === 'officer' && (
              <div className="inline-flex items-center w-fit rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                Showing last 24 hours only
              </div>
            )}
            <CardDescription className="text-xs">
              {orgWorkflow === 'officer_direct' && 'Officer Direct mode — you can issue warnings and notices on-site.'}
              {orgWorkflow === 'hybrid' && 'Hybrid mode — you can issue warnings on-site; notices require admin approval.'}
              {(!orgWorkflow || orgWorkflow === 'admin_first') && 'Admin First mode — breaches are automatically reported to admin.'}
            </CardDescription>
            {/* Compliance filter tabs */}
            <div className="flex gap-1 flex-wrap mt-2">
              {([
                { key: 'all', label: 'All', icon: null, style: '' },
                { key: 'compliant', label: 'Compliant', icon: CheckCircle, style: 'text-green-700 border-green-400 bg-green-50 dark:bg-green-950/40' },
                { key: 'breach', label: 'Breach', icon: XCircle, style: 'text-red-700 border-red-400 bg-red-50 dark:bg-red-950/40' },
                { key: 'at_risk', label: 'At Risk', icon: AlertTriangle, style: 'text-yellow-700 border-yellow-400 bg-yellow-50 dark:bg-yellow-950/40' },
                { key: 'homeless', label: 'Homeless/Exempt', icon: Home, style: 'text-purple-700 border-purple-400 bg-purple-50 dark:bg-purple-950/40' },
              ] as const).map(({ key, label, icon: Icon, style }) => (
                <button
                  key={key}
                  onClick={() => setScanTabFilter(key)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                    scanTabFilter === key
                      ? style || 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'
                  }`}
                >
                  {Icon && <Icon className="h-2.5 w-2.5" />}
                  {label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {recentScans.filter((scan: any) => {
              if (scanTabFilter === 'all') return true
              const isProcessingAI = scan.plate_number === 'PROCESSING...' || scan.plate_number === 'MANUAL_REQUIRED'
              if (scanTabFilter === 'compliant') return scan.is_compliant === true && !isProcessingAI
              if (scanTabFilter === 'breach') return scan.is_compliant === false && !isProcessingAI
              if (scanTabFilter === 'at_risk') return isProcessingAI || (scan.is_compliant && (scan.consecutive_nights ?? 0) >= 2)
              if (scanTabFilter === 'homeless') {
                const vehicle = scan.vehicle as any
                const homelessStatus = vehicle?.homeless_status
                const isExempt = Boolean(vehicle?.is_exempt)
                return homelessStatus === 'confirmed' || homelessStatus === 'claimed' || isExempt
              }
              return true
            }).map((scan: any) => {
              const isProcessingAI = scan.plate_number === 'PROCESSING...' || scan.plate_number === 'MANUAL_REQUIRED'
              const inBreach = scan.is_compliant === false && !isProcessingAI
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
                      {!isProcessingAI && scan.is_compliant !== null && (
                        <Badge
                          variant={scan.is_compliant ? 'default' : 'destructive'}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {scan.is_compliant ? 'Compliant' : 'Breach'}
                        </Badge>
                      )}
                      {!isProcessingAI && scan.is_compliant === null && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Pending
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
