import { useState, useEffect, useCallback } from 'react'
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
import { Camera, Map, FileText, History, AlertTriangle, MapPin, QrCode, ShieldAlert, CheckCircle, Shield, Megaphone, FileWarning, XCircle, Clock, Home, X, Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { resolveObservationZoneForOrg } from '@/lib/zoneResolution'
import { formatDateTime } from '@/lib/utils'

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

const isTransientNetworkError = (errorMessage?: string | null) => {
  const msg = (errorMessage || '').toLowerCase()
  return (
    msg.includes('failed to send a request to the edge function') ||
    msg.includes('fetch failed') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed')
  )
}

/**
 * Returns true when alpr-process returned a 500 because a column is missing
 * from the PostgREST schema cache (i.e. the migration ran but the cache
 * hasn't refreshed yet).  In this case we can still save the observation
 * via a direct Supabase insert, which the fallback code below already
 * handles by stripping unrecognised columns adaptively.
 */
const isAlprSchemaCacheError = (errorMessage?: string | null) => {
  const msg = (errorMessage || '').toLowerCase()
  // PostgREST schema-cache miss: "Could not find the '<col>' column of '<table>' in the schema cache"
  return msg.includes('schema cache') ||
    (msg.includes('could not find the') && msg.includes('column'))
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function retryEdgeCall<T>(
  fn: () => Promise<{ data: T | null; error: string | null }>,
  retries = 2,
  delayMs = 700
) {
  let attempt = 0
  let lastError: string | null = null

  while (attempt <= retries) {
    const result = await fn()
    if (!result.error) return result

    lastError = result.error
    if (!isTransientNetworkError(result.error) || attempt === retries) {
      return result
    }

    await wait(delayMs * (attempt + 1))
    attempt += 1
  }

  return { data: null, error: lastError || 'Unknown edge function failure' }
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
  } | null>(null)
  const [scanTabFilter, setScanTabFilter] = useState<'all' | 'compliant' | 'breach' | 'at_risk' | 'homeless'>('all')
  const [scanDebugLines, setScanDebugLines] = useState<string[]>([])
  const [scanDebugStatus, setScanDebugStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')

  const appendScanDebug = (label: string, payload?: unknown) => {
    const ts = new Date().toISOString()
    const text = payload === undefined
      ? `[${ts}] ${label}`
      : `[${ts}] ${label} ${JSON.stringify(payload)}`
    setScanDebugLines((prev) => [...prev, text])
  }

  const copyScanDebug = async () => {
    try {
      const text = scanDebugLines.length > 0
        ? scanDebugLines.join('\n')
        : [
            `[${new Date().toISOString()}] No scan diagnostics captured yet`,
            `status=${scanDebugStatus}`,
            `officer_email=${user?.email ?? 'unknown'}`,
            `officer_id=${user?.id ?? 'unknown'}`,
            `organization_id=${user?.organization_id ?? 'unknown'}`,
          ].join('\n')
      await navigator.clipboard.writeText(text)
      toast.success('Scan diagnostics copied')
    } catch {
      toast.error('Failed to copy diagnostics')
    }
  }

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

      const selectCandidates = [
        [
          'id, plate_number, recorded_at, is_compliant, processing_status',
          'photo_url, zone_id, breach_type, consecutive_nights, nights_stayed_this_month',
          'zone:zones!zone_id(name)',
          'vehicle:canonical_vehicles!plate_number(homeless_status, is_exempt)',
        ].join(', '),
        [
          'id:observation_id, plate_number, recorded_at, is_compliant, processing_status',
          'photo_url, zone_id, breach_type, consecutive_nights, nights_stayed_this_month',
          'zone:zones!zone_id(name)',
          'vehicle:canonical_vehicles!plate_number(homeless_status, is_exempt)',
        ].join(', '),
        [
          'id:observation_id, plate_number, recorded_at, is_compliant',
          'photo_url, zone_id, breach_type, consecutive_nights, nights_stayed_this_month',
          'zone:zones!zone_id(name)',
          'vehicle:canonical_vehicles!plate_number(homeless_status, is_exempt)',
        ].join(', '),
        [
          'id:observation_id, plate_number, recorded_at, is_compliant',
          'zone_id, breach_type, consecutive_nights, nights_stayed_this_month',
          'photo:image_url',
          'zone:zones!zone_id(name)',
          'vehicle:canonical_vehicles!plate_number(homeless_status, is_exempt)',
        ].join(', '),
        [
          'id:observation_id, plate_number, recorded_at, is_compliant',
          'zone_id, breach_type, consecutive_nights, nights_stayed_this_month',
          'photo',
          'zone:zones!zone_id(name)',
          'vehicle:canonical_vehicles!plate_number(homeless_status, is_exempt)',
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
          id: row.id ?? row.observation_id,
          processing_status: row.processing_status ?? null,
          photo_url: row.photo_url ?? row.image_url ?? row.photo ?? null,
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

  // Sync lastScanResult with live compliance data once AI processing completes
  useEffect(() => {
    if (!lastScanResult?.observationId || !lastScanResult.processingPending) return
    const matched = recentScans.find((s: any) => s.id === lastScanResult.observationId)
    if (matched && matched.processing_status !== 'pending') {
      setLastScanResult(prev => prev ? {
        ...prev,
        isCompliant: matched.is_compliant,
        breachType: matched.breach_type ?? null,
        processingPending: false,
        zoneName: matched.zone?.name ?? null,
        observationZoneId: matched.zone_id ?? null,
      } : null)
    }
  }, [recentScans, lastScanResult?.observationId, lastScanResult?.processingPending])

  // Fallback polling: ensure officers get a final compliance/breach result even if list refresh misses the update.
  useEffect(() => {
    if (!lastScanResult?.observationId || !lastScanResult.processingPending) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    const maxAttempts = 12

    const fetchObservation = async (observationId: string) => {
      const lookupCandidates = [
        { select: 'id, is_compliant, breach_type, processing_status, zone_id, zone:zones!zone_id(name)', key: 'id' },
        { select: 'observation_id, is_compliant, breach_type, processing_status, zone_id, zone:zones!zone_id(name)', key: 'observation_id' },
        { select: 'id, is_compliant, breach_type, zone_id, zone:zones!zone_id(name)', key: 'id' },
        { select: 'observation_id, is_compliant, breach_type, zone_id, zone:zones!zone_id(name)', key: 'observation_id' },
      ] as const

      for (const candidate of lookupCandidates) {
        const res = await (supabase.from('observations') as any)
          .select(candidate.select)
          .eq(candidate.key, observationId)
          .maybeSingle()

        if (!res.error && res.data) {
          return {
            ...res.data,
            id: (res.data as any).id ?? (res.data as any).observation_id,
            processing_status: (res.data as any).processing_status ?? null,
          } as any
        }
      }

      return null
    }

    const poll = async () => {
      if (cancelled) return
      attempts += 1

      const obs = await fetchObservation(lastScanResult.observationId!)
      const resolved =
        !!obs &&
        (obs.processing_status !== 'pending' || typeof obs.is_compliant === 'boolean' || !!obs.breach_type)

      if (resolved) {
        const compliant = typeof obs.is_compliant === 'boolean' ? obs.is_compliant : null
        setLastScanResult((prev) =>
          prev
            ? {
                ...prev,
                isCompliant: compliant,
                breachType: obs.breach_type ?? null,
                processingPending: false,
                zoneName: obs.zone?.name ?? prev.zoneName,
                observationZoneId: obs.zone_id ?? prev.observationZoneId,
              }
            : null
        )

        if (compliant === true) {
          toast.success('Compliant')
        } else if (compliant === false) {
          toast.warning(`Breach detected: ${formatBreachType(obs.breach_type)}`)
        } else {
          toast.info('Scan captured. Compliance result pending review.')
        }
        return
      }

      if (attempts < maxAttempts) {
        timer = setTimeout(poll, 1500)
        return
      }

      setLastScanResult((prev) =>
        prev
          ? {
              ...prev,
              processingPending: false,
            }
          : null
      )
      toast.info('Scan captured. Compliance result is still processing.')
    }

    poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [lastScanResult?.observationId, lastScanResult?.processingPending])

  const handleCapture = async (file: File) => {
    setIsProcessing(true)
    setScanDebugStatus('running')
    setScanDebugLines([])
    appendScanDebug('Scan started', {
      officer_email: user?.email ?? null,
      officer_id: user?.id ?? null,
      org_id: user?.organization_id ?? null,
      file_size: file.size,
      file_type: file.type,
    })
    try {
      // ============================================================================
      // STEP 1: SESSION VALIDATION (Pre-flight Check)
      // ============================================================================
      if (!user?.id || !user?.organization_id) {
        appendScanDebug('Session validation failed')
        throw new Error('Session expired. Please log out and log back in.')
      }
      appendScanDebug('Session validated')

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
      appendScanDebug('GPS acquired', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
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
        const { data: weatherData, error: weatherError } = await edgeFunctions.getWeather({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })

        if (!weatherError && weatherData?.weather) {
          weatherConditions = weatherData.weather;
          console.log('🌤️ Weather:', weatherConditions);
          appendScanDebug('Weather fetched', { weather: weatherConditions })
        } else {
          console.warn('⚠️ Weather fetch failed, using fallback');
          appendScanDebug('Weather fetch failed; fallback used')
        }
      } catch (err) {
        console.warn('⚠️ Weather API error (non-critical):', err);
        appendScanDebug('Weather API error; fallback used')
      }

      // ============================================================================
      // STEP 4: GENERATE METADATA
      // ============================================================================
      const timestamp = Date.now()
      const uniqueId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const idempotencyKey = `scan-${user.id}-${timestamp}`

      console.log('📸 Photo Metadata:', {
        size_bytes: file.size,
        type: file.type,
        idempotency_key: idempotencyKey,
        weather: weatherConditions
      })

      // ============================================================================
      // STEP 5: UPLOAD PHOTO TO STORAGE (Evidence preservation) - FAST PATH
      // ============================================================================
      toast.info('Uploading photo...')
      const filePath = `${user.id}/${timestamp}-${uniqueId}.jpg`
      
      const { error: uploadError } = await supabase.storage
        .from('scans')
        .upload(filePath, file, {
          contentType: 'image/jpeg',
          upsert: false
        })

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)
      appendScanDebug('Photo uploaded to scans bucket', { filePath })

      const { data: urlData } = supabase.storage.from('scans').getPublicUrl(filePath)
      const photoUrl = urlData.publicUrl

      console.log('☁️ Photo Uploaded:', { photo_url: photoUrl })

      // ============================================================================
      // STEP 6: GET OR CREATE "OTHER LOCATION" ZONE (If outside geofence)
      // ============================================================================
      const { zoneId: finalZoneId, source: zoneSource } = await resolveObservationZoneForOrg(
        user.organization_id,
        zoneId
      )
      appendScanDebug('Zone resolved', { zone_id: finalZoneId, source: zoneSource })

      if (zoneSource !== 'preferred') {
        console.log('✅ Resolved fallback zone:', { finalZoneId, zoneSource })
      }

      if (!finalZoneId) {
        throw new Error('Could not resolve zone for observation')
      }

      // ============================================================================
      // STEP 7: PHOTO-FIRST APPROACH - Create observation directly
      // ============================================================================
      // The simplified "photo-first" approach:
      // 1. Insert observation with minimal fields (photo, location, zone)
      // 2. Let the database trigger `trg_auto_evaluate_compliance` run compliance
      // 3. Fire-and-forget alpr-process in UPDATE mode for plate recognition
      //
      // Benefits:
      // - Immediate feedback to officer (no waiting for ALPR)
      // - Compliance runs automatically via existing trigger
      // - No schema cache issues (trigger handles compliance, not edge function)
      // - Decoupled concerns: evidence capture separate from plate recognition
      // ============================================================================
      
      toast.info('Saving observation...')
      appendScanDebug('Creating observation (photo-first)', {
        zone_id: finalZoneId,
        photo_url: photoUrl,
      })

      const nowIso = new Date().toISOString()
      const photoHash = `sha256:${uniqueId}` // Placeholder hash - could compute real SHA if needed

      // Minimal payload - let trigger handle compliance
      const observationPayload: Record<string, any> = {
        idempotency_key: idempotencyKey,
        plate_number: 'PROCESSING...', // Placeholder until async ALPR completes
        photo: photoUrl,
        photo_url: photoUrl,
        photo_hash: photoHash,
        recorded_at: nowIso,
        zone_id: finalZoneId,
        organization_id: user.organization_id,
        gps_latitude: position.coords.latitude,
        gps_longitude: position.coords.longitude,
        gps_accuracy: position.coords.accuracy,
        recorded_by: user.id,
        weather_conditions: weatherConditions,
        processing_status: 'pending', // Mark for async ALPR processing
      }

      let ingestData: any = null
      let ingestError: string | null = null

      // Adaptive insert with retries to handle schema cache misses
      const adaptivePayload: Record<string, any> = { ...observationPayload }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const insertAttempt = await (supabase
          .from('observations') as any)
          .insert(adaptivePayload)
          .select('*')
          .single()

        if (!insertAttempt.error) {
          ingestData = insertAttempt.data
          appendScanDebug('Observation created', {
            observation_id: ingestData?.id ?? ingestData?.observation_id,
            is_compliant: ingestData?.is_compliant,
            attempt: attempt + 1,
          })
          break
        }

        const message = String(insertAttempt.error?.message || '')
        
        // Handle missing column errors - remove column and retry
        const missingColumnMatch = message.match(/Could not find the '([^']+)' column/i)
        const missingColumn = missingColumnMatch?.[1]

        if (missingColumn && (missingColumn in adaptivePayload)) {
          delete adaptivePayload[missingColumn]
          appendScanDebug('Adjusting payload - removed column', {
            removed_column: missingColumn,
            attempt: attempt + 1,
          })
          continue
        }

        // Handle COALESCE type mismatch (older trigger versions)
        if (/coalesce types .* integer and text/i.test(message)) {
          const complianceColumns = [
            'nights_stayed_this_month',
            'consecutive_nights',
            'is_compliant',
            'self_contained',
          ]
          let removedAny = false
          for (const col of complianceColumns) {
            if (col in adaptivePayload) {
              delete adaptivePayload[col]
              removedAny = true
            }
          }
          if (removedAny) {
            appendScanDebug('Adjusting payload - removed compliance columns', { attempt: attempt + 1 })
            continue
          }
        }

        // Can't recover - set error and break
        ingestError = insertAttempt.error.message
        appendScanDebug('Insert failed', { error: ingestError, attempt: attempt + 1 })
        break
      }

      if (ingestError || !ingestData) {
        throw new Error(`Save failed: ${ingestError || 'Unknown error'}`)
      }

      // Extract observation ID (handle both `id` and `observation_id` schemas)
      const observationId = ingestData.id ?? ingestData.observation_id

      // ============================================================================
      // STEP 8: FIRE-AND-FORGET ALPR (UPDATE mode)
      // ============================================================================
      // Now that the observation is saved, trigger plate recognition asynchronously.
      // This updates the observation with plate_number once ALPR completes.
      // We don't await this - the officer gets immediate feedback.
      // If ALPR fails, the observation will have plate_number='PROCESSING...' or
      // 'MANUAL_REQUIRED' and the existing polling mechanism will update the UI.
      appendScanDebug('Triggering async ALPR', { observation_id: observationId })

      edgeFunctions.processALPR({
        observation_id: observationId,
        photo_url: photoUrl,
      }).then(({ data: alprResult, error: alprError }) => {
        if (alprError) {
          console.warn('⚠️ Async ALPR failed:', alprError)
          // The observation will remain with plate_number='PROCESSING...' 
          // The existing polling mechanism will still update the UI when complete
          // Officer can manually edit the plate via the scan history view
        } else {
          console.log('✅ Async ALPR completed:', {
            plate: alprResult?.plate,
            confidence: alprResult?.confidence,
          })
          // Trigger refetch to update UI with plate number
          refetchScans()
        }
      }).catch((err) => {
        console.warn('⚠️ Async ALPR error:', err)
      })

      console.log('✅ Observation created (photo-first):', {
        observation_id: observationId,
        is_compliant: ingestData.is_compliant,
        breach_type: ingestData.breach_type,
        plate: 'PROCESSING...',
      })

      // ============================================================================
      // STEP 9: IMMEDIATE SUCCESS (User can scan next vehicle)
      // ============================================================================
      // With photo-first approach, we show compliance result immediately
      // (from trigger) and plate is being processed in background.
      // The compliance trigger defaults to is_compliant=true for new observations
      // without prior history, but breach_type indicates actual violations.
      const isCompliant = typeof ingestData.is_compliant === 'boolean' 
        ? ingestData.is_compliant 
        : null // Keep as null if unknown - let UI handle pending state
      
      const hasBreachType = !!ingestData.breach_type

      toast.success('✅ Observation captured', {
        duration: 5000,
        description: hasBreachType 
          ? `Breach detected: ${formatBreachType(ingestData.breach_type)}`
          : isCompliant === false
            ? 'Non-compliant observation recorded'
            : 'Photo saved. Plate detection in progress...',
      })

      setLastScanResult({
        observationId: observationId,
        photoUrl: photoUrl,
        plateNumber: null, // Will be populated when ALPR completes
        isCompliant: isCompliant,
        breachType: ingestData.breach_type ?? null,
        processingPending: true, // ALPR is running in background
        zoneName: null,
        observationZoneId: finalZoneId ?? null,
        recordedAt: nowIso,
      })

      setShowScanner(false)
      refetchScans()
      setScanDebugStatus('success')
      appendScanDebug('Scan completed successfully')

    } catch (error: any) {
      console.error('❌ Scan Pipeline Failed:', error)
      appendScanDebug('Scan failed', {
        message: error?.message || 'Unknown error',
      })
      setScanDebugStatus('error')
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
    setLastScanResult(null)
    setScanDebugStatus('idle')
    setScanDebugLines([
      `[${new Date().toISOString()}] Scanner opened`,
      `[${new Date().toISOString()}] Officer context ${JSON.stringify({
        officer_email: user?.email ?? null,
        officer_id: user?.id ?? null,
        org_id: user?.organization_id ?? null,
      })}`,
      `[${new Date().toISOString()}] Waiting for capture`,
    ])
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
        <>
          <CameraCapture 
            onCapture={handleCapture} 
            onCancel={handleCloseScanner} 
            facing="environment" 
            showControls={true} 
            onDiagnosticEvent={(label, payload) => appendScanDebug(label, payload)}
            menuItems={[
              {
                label: 'Copy Scan Diagnostics',
                onClick: copyScanDebug,
              },
              {
                label: 'Close Scanner',
                onClick: handleCloseScanner,
              },
            ]}
          />

          <Card className="mt-4 border-blue-300 bg-blue-50/70 dark:bg-blue-950/30">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">Scan Diagnostics</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={
                      scanDebugStatus === 'error'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        : scanDebugStatus === 'success'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    }
                  >
                    {scanDebugStatus === 'error' ? 'Error' : scanDebugStatus === 'success' ? 'Success' : 'Running'}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={copyScanDebug}
                    disabled={scanDebugLines.length === 0}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </Button>
                </div>
              </div>
              <CardDescription className="text-xs">
                {scanDebugLines.length > 0
                  ? 'Copy and paste this block into chat for scan troubleshooting.'
                  : 'Start a scan to populate diagnostics logs.'}
              </CardDescription>
            </CardHeader>
            {scanDebugLines.length > 0 && (
              <CardContent className="px-4 pb-3">
                <pre className="max-h-48 overflow-auto rounded border bg-white/70 dark:bg-slate-900 p-2 text-[11px] leading-4 whitespace-pre-wrap break-words">
                  {scanDebugLines.join('\n')}
                </pre>
              </CardContent>
            )}
          </Card>
        </>
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
          {/* ── Scan Diagnostics ─────────────────────────────────────── */}
          {scanDebugLines.length > 0 && (
            <Card className="mb-4 border-blue-300 bg-blue-50/70 dark:bg-blue-950/30">
              <CardHeader className="pb-2 pt-3 px-4">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">Scan Diagnostics</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={
                        scanDebugStatus === 'error'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          : scanDebugStatus === 'success'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                      }
                    >
                      {scanDebugStatus === 'error' ? 'Error' : scanDebugStatus === 'success' ? 'Success' : 'Running'}
                    </Badge>
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={copyScanDebug}>
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                </div>
                <CardDescription className="text-xs">
                  Copy and paste this block into chat for scan troubleshooting.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <pre className="max-h-48 overflow-auto rounded border bg-white/70 dark:bg-slate-900 p-2 text-[11px] leading-4 whitespace-pre-wrap break-words">
                  {scanDebugLines.join('\n')}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* ── Last Scan Result Panel ──────────────────────────────────── */}
          {lastScanResult && (
            <Card className={`mb-4 border-2 ${
              lastScanResult.processingPending
                ? 'border-gray-300 bg-gray-50 dark:bg-gray-900'
                : lastScanResult.isCompliant === false
                ? 'border-red-400 bg-red-50 dark:bg-red-950/40'
                : 'border-green-400 bg-green-50 dark:bg-green-950/40'
            }`}>
              <CardHeader className="pb-2 pt-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Last Scan Result
                    {lastScanResult.processingPending && (
                      <Badge variant="secondary" className="text-[10px] animate-pulse">
                        <Clock className="h-2.5 w-2.5 mr-1" />
                        Processing…
                      </Badge>
                    )}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setLastScanResult(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="flex gap-3 items-start">
                  {/* Photo */}
                  {lastScanResult.photoUrl ? (
                    <img
                      src={lastScanResult.photoUrl}
                      alt="Scan"
                      className="h-24 w-24 rounded-lg object-cover shrink-0 border"
                    />
                  ) : (
                    <div className="h-24 w-24 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0 border">
                      <Camera className="h-8 w-8 text-gray-400" />
                    </div>
                  )}

                  {/* Details */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-lg">
                        {lastScanResult.plateNumber || '—'}
                      </span>
                      {!lastScanResult.processingPending && lastScanResult.isCompliant !== null && (
                        lastScanResult.isCompliant ? (
                          <Badge className="bg-green-600 text-white">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Compliant
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <XCircle className="h-3 w-3 mr-1" />
                            {formatBreachType(lastScanResult.breachType)}
                          </Badge>
                        )
                      )}
                    </div>
                    {lastScanResult.zoneName && (
                      <p className="text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 inline mr-1" />
                        {lastScanResult.zoneName}
                      </p>
                    )}

                    {/* Quick action buttons for breach */}
                    {!lastScanResult.processingPending && lastScanResult.isCompliant === false && (
                      <div className="flex gap-2 flex-wrap mt-1">
                        {(orgWorkflow === 'officer_direct' || orgWorkflow === 'hybrid') && lastScanResult.observationId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] border-yellow-400 text-yellow-700 hover:bg-yellow-50"
                            disabled={issueAction.isPending}
                            onClick={() => issueAction.mutate({
                              observationId: lastScanResult.observationId!,
                              zoneId: lastScanResult.observationZoneId || '',
                              plateNumber: lastScanResult.plateNumber || '',
                              actionType: 'warning',
                            })}
                          >
                            <FileWarning className="h-3 w-3 mr-1" />
                            Issue Warning
                          </Button>
                        )}
                        {orgWorkflow === 'officer_direct' && lastScanResult.observationId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] border-red-400 text-red-700 hover:bg-red-50"
                            disabled={issueAction.isPending}
                            onClick={() => issueAction.mutate({
                              observationId: lastScanResult.observationId!,
                              zoneId: lastScanResult.observationZoneId || '',
                              plateNumber: lastScanResult.plateNumber || '',
                              actionType: 'notice_to_vacate',
                            })}
                          >
                            <Megaphone className="h-3 w-3 mr-1" />
                            Notice to Vacate
                          </Button>
                        )}
                        {(!orgWorkflow || orgWorkflow === 'admin_first') && (
                          <Badge variant="secondary" className="text-[10px]">
                            <Shield className="h-2.5 w-2.5 mr-1" />
                            Reported to Admin
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
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
              const isProcessingAI = scan.processing_status === 'pending'
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
              const isProcessingAI = scan.processing_status === 'pending'
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
