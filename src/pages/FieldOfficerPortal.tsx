import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { monitorGeofenceAndPatrol, calculateDistance } from '@/lib/geofence'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AppLayout } from '@/components/features/AppLayout'
import { OfficerLanguageSelector } from '@/components/features/OfficerLanguageSelector'
import { useOfficerLocale } from '@/hooks/useOfficerLocale'
import { SplitScanCamera } from '@/components/features/SplitScanCamera'
import { LocationAuthorizationStatus } from '@/components/features/LocationAuthorizationStatus'
import { QRCheckpointScanner } from '@/components/features/QRCheckpointScanner'
import { ScanDetailPanel, type DetailScanData } from '@/components/features/ScanDetailPanel'
import { LivePatrolCamera } from '@/components/features/LivePatrolCamera'
import { BulkScanSession } from '@/components/features/BulkScanSession'
import { OfficerFollowUpQueue } from '@/components/features/OfficerFollowUpQueue'
import { PostShiftFeedback } from '@/components/features/PostShiftFeedback'
import { VOILookup } from '@/components/features/VOILookup'
import { captureAndSave, SCAN_PROGRESS_LABELS, type ScanProgressStage } from '@/lib/scanPipeline'
import { useManDownDetection } from '@/hooks/useManDownDetection'
import { useWelfareCheckin } from '@/hooks/useWelfareCheckin'
import { usePatrolCheckpointProgress } from '@/hooks/usePatrolCheckpointProgress'
import { useRosteredShift } from '@/hooks/useRosteredShift'
import { useShiftGate } from '@/hooks/useShiftGate'
import {
  useFieldOfficerRouteTestOverride,
  useOfficerActiveRouteInstance,
  usePatrolRouteInstanceStops,
  useUpdatePatrolRouteStopStatus,
} from '@/hooks/usePatrolRouteInstances'
import { useDispatchCompletion } from '@/hooks/useDispatchCompletion'
import { useSpeechIntent, type SpeechIntentResult } from '@/hooks/useSpeechIntent'
import { GeofenceWarningBanner } from '@/components/features/GeofenceWarningBanner'
import { reverseGeocode } from '@/lib/geocoding'
import { useThemePreferencesStore } from '@/stores/themePreferencesStore'
import {
  Camera, Map, FileText, History, AlertTriangle, MapPin, QrCode,
  ShieldAlert, CheckCircle, Shield, Megaphone, FileWarning, XCircle,
  Clock, Home, X, Car, Zap, Search, Printer, PlusCircle, Wrench, Heart, Users,
  Moon, Sun, ParkingSquare, Volume2, Video, Eye, Tent, Timer,
  ScanFace, CalendarPlus, Siren, Bell, PhoneCall, Lock, Leaf, Wind, Loader2, Mic,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { formatDateTime } from '@/lib/utils'
import { publishEmergencyAssistRequest } from '@/lib/emergencyAssistBridge'
import { useOfflineQueue, useOfflineQueueStats } from '@/hooks/useOfflineQueue'
import {
  useInsertWelfareAlert,
  useMarkNotificationRead,
  useStartOfficerShift,
  useEndOfficerShift,
  useIssueEnforcementAction,
  useDeactivateWelfarePushSchedule,
} from '@/hooks/useFieldOfficerMutations'
import {
  useAccessibleOrgsForShift,
  useShiftZones,
  useOfficerUnreadNotifications,
  useOrgWorkflow,
  useManualZones,
  useMyRecentScans,
  useOfficerActiveShift,
  fetchWelfareIntervalMinutes,
} from '@/hooks/useFieldOfficerData'
import type { Database } from '@/types/database'

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKFLOW_LABELS: Record<string, string> = {
  admin_first:    'Admin First',
  officer_direct: 'Officer Direct',
  hybrid:         'Hybrid',
}

/** Converts snake_case breach type keys to human-readable labels. */
const formatBreachType = (bt: string | null | undefined): string => {
  if (!bt) return 'Breach'
  return bt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Duration (ms) the "observation captured" toast stays on screen. */
const CAPTURE_TOAST_DURATION_MS = 5000

// ─── Service Types ────────────────────────────────────────────────────────────

/** Service types an officer can select — determines which tools are shown. */
type ServiceType = 'freedom_camping' | 'guarding' | 'parking' | 'noise' | 'biosecurity_inspection' | 'smoke_complaint_ooh'

const SERVICE_TYPE_CONFIG: Record<ServiceType, {
  label: string
  description: string
  Icon: typeof Shield
  color: string
  bgColor: string
  borderColor: string
}> = {
  freedom_camping: {
    label: 'Freedom Camping Patrol',
    description: 'Vehicle scanning, breach detection, compliance',
    Icon: Tent,
    color: 'text-green-700 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900',
    borderColor: 'border-green-400 dark:border-green-700',
  },
  guarding: {
    label: 'Guarding',
    description: 'Site security, checkpoints, POI, face recognition',
    Icon: Shield,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900',
    borderColor: 'border-blue-400 dark:border-blue-700',
  },
  parking: {
    label: 'Parking Enforcement',
    description: 'Chalk pass, recheck, infringement notices',
    Icon: ParkingSquare,
    color: 'text-orange-700 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900',
    borderColor: 'border-orange-400 dark:border-orange-700',
  },
  noise: {
    label: 'Noise Control',
    description: 'Assessment matrix, AN/DN/END notices, seizures',
    Icon: Volume2,
    color: 'text-yellow-700 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900',
    borderColor: 'border-yellow-400 dark:border-yellow-700',
  },
  biosecurity_inspection: {
    label: 'Biosecurity Inspection',
    description: 'CNG/plant ID, density assessment, RPMP notices',
    Icon: Leaf,
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900',
    borderColor: 'border-emerald-400 dark:border-emerald-700',
  },
  smoke_complaint_ooh: {
    label: 'Smoke Complaint (OOH)',
    description: 'Smoke opacity, prohibited materials, RMA s.17A notices',
    Icon: Wind,
    color: 'text-amber-700 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900',
    borderColor: 'border-amber-400 dark:border-amber-700',
  },
}

/** Format shift duration from ms to human-readable. */
function formatShiftDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const totalMins = Math.floor(ms / 60000)
  const hrs = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hrs > 0) return `${hrs}h ${mins}m`
  return `${mins}m`
}

function extractRapidReference(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized) return null

  const patrolMatch = normalized.match(/\bpatrol\s*([a-z0-9-]{2,12})\b/i)
  if (patrolMatch?.[1]) return patrolMatch[1].toUpperCase()

  const callsignMatch = normalized.match(/\bcallsign\s*([a-z0-9-]{1,12})\b/i)
  if (callsignMatch?.[1]) return callsignMatch[1].toUpperCase()

  const numericMatch = normalized.match(/\b([0-9]{2,4}[a-z]?)\b/i)
  if (numericMatch?.[1]) return numericMatch[1].toUpperCase()

  return null
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function readSupabaseAccessTokenFromStorage(): string | null {
  if (typeof window === 'undefined') return null

  const storages: Storage[] = [window.localStorage, window.sessionStorage]
  for (const storage of storages) {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (!key || !key.startsWith('sb-') || !key.includes('-auth-token')) continue

      const raw = storage.getItem(key)
      if (!raw) continue

      try {
        const parsed = JSON.parse(raw)
        if (typeof parsed?.access_token === 'string' && parsed.access_token.length > 20) {
          return parsed.access_token
        }
      } catch {
        // Ignore malformed auth storage values.
      }
    }
  }

  return null
}

async function postgrestInsertWithTimeout(table: string, payload: Record<string, unknown>, timeoutMs: number): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are missing')
  }

  let accessToken = readSupabaseAccessTokenFromStorage()

  if (!accessToken) {
    const {
      data: { session },
    } = await withTimeout(
      supabase.auth.getSession(),
      Math.min(2000, timeoutMs),
      'Session lookup'
    )

    accessToken = session?.access_token ?? null
  }

  if (!accessToken) {
    throw new Error('Session expired. Please sign in again')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (response.ok) return

    const raw = await response.text().catch(() => '')
    let message = `Failed to insert into ${table}`
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        message = parsed?.message || parsed?.error_description || parsed?.hint || raw
      } catch {
        message = raw
      }
    }
    throw new Error(message)
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`${table} insert timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}


export default function FieldOfficerPortal() {
  const { user } = useAuthStore()
  const { zoneId, zoneName, setZone, setOrganization } = useGlobalFiltersStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { t: ot } = useOfficerLocale()
  const { themeMode, setThemeMode } = useThemePreferencesStore()
  const isNightPatrol = themeMode === 'night-patrol'
  const employerOrganizationId = user?.employer_organization_id || user?.organization_id || null
  const routeTestOverride = useFieldOfficerRouteTestOverride()

  const insertWelfareAlert = useInsertWelfareAlert()
  const markNotificationReadMutation = useMarkNotificationRead()
  const startOfficerShift = useStartOfficerShift()
  const endOfficerShift = useEndOfficerShift()
  const deactivateWelfarePushSchedule = useDeactivateWelfarePushSchedule()

  // ── Roster context ────────────────────────────────────────────────────────
  const { rosteredShift } = useRosteredShift()

  // ── Shift gate: redirect to /officer-home if not rostered ─────────────────
  const { gateApplies, canAccessPortal, canUseFeature, geofenceViolation, isLoading: gateLoading } = useShiftGate()
  useEffect(() => {
    if (routeTestOverride?.forceOperationalView) return
    if (!gateLoading && gateApplies && (!canAccessPortal || !canUseFeature('freedom_camping'))) {
      navigate('/officer-home', { replace: true })
    }
  }, [gateApplies, canAccessPortal, canUseFeature, gateLoading, navigate, routeTestOverride?.forceOperationalView])

  // ── Service type selection — pre-fill from URL param or roster ────────────
  const [activeService, setActiveService] = useState<ServiceType | null>(() => {
    const param = searchParams.get('service') as ServiceType | null
    return param && ['freedom_camping','guarding','parking','noise','patrol','alarm_response','biosecurity_inspection','smoke_complaint_ooh'].includes(param)
      ? param as ServiceType
      : null
  })

  // Auto-select service type from rostered shift when no URL param was given
  useEffect(() => {
    if (activeService) return // URL param already set it
    if (!rosteredShift?.service_type) return
    const rosterService = rosteredShift.service_type as ServiceType
    if (['freedom_camping', 'guarding', 'parking', 'noise', 'biosecurity_inspection', 'smoke_complaint_ooh'].includes(rosterService)) {
      setActiveService(rosterService)
    }
  }, [rosteredShift?.service_type]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scan mode: null = portal home, 'detail' = single-vehicle scan,
  //              'bulk' = quick area sweep, 'checkpoint' = QR check-in
  const [scanMode,       setScanMode]       = useState<null | 'detail' | 'bulk' | 'live'>(null)
  const [showCheckpoint, setShowCheckpoint] = useState(false)

  // Detail scan state — camera + result panel
  const [detailCameraOpen,  setDetailCameraOpen]  = useState(false)
  const [isProcessing,      setIsProcessing]       = useState(false)
  const [scanProgressLabel, setScanProgressLabel]  = useState(SCAN_PROGRESS_LABELS.gps)
  const [detailScanData,    setDetailScanData]     = useState<DetailScanData | null>(null)
  const [showDetailPanel,   setShowDetailPanel]    = useState(false)
  const [showManualEntry,   setShowManualEntry]    = useState(false)
  const [manualPlate,       setManualPlate]        = useState('')
  const [manualZoneId,      setManualZoneId]       = useState('')
  const [manualSubmitting,  setManualSubmitting]   = useState(false)

  // Admin-assigned follow-up count — used to show badge on the queue card header
  const [followUpCount,     setFollowUpCount]      = useState(0)

  // ── Offline queue — for saving observations when network is unavailable ──
  const { addToQueue } = useOfflineQueue()
  const { data: offlineStats } = useOfflineQueueStats()
  const pendingSyncCount = offlineStats?.pending ?? 0

  const [currentPatrolZone, setCurrentPatrolZone] = useState<string | null>(zoneId)
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [scanTabFilter, setScanTabFilter] = useState<'all' | 'compliant' | 'breach' | 'at_risk' | 'homeless'>('all')

  // ── Quick standalone report modal ─────────────────────────────────────────
  const [showQuickReport,      setShowQuickReport]      = useState(false)
  const [qrReportType,         setQRReportType]         = useState<'hs'|'incident'|'maintenance'>('incident')
  const [qrIncidentType,       setQRIncidentType]       = useState('general_incident')
  const [qrSeverity,           setQRSeverity]           = useState<'low'|'medium'|'high'|'critical'>('medium')
  const [qrDescription,        setQRDescription]        = useState('')
  const [qrActionTaken,        setQRActionTaken]        = useState('')
  const [qrVehiclePlate,       setQRVehiclePlate]       = useState('')
  const [qrLocationAddress,    setQRLocationAddress]    = useState('')
  const [isSubmittingReport,   setIsSubmittingReport]   = useState(false)
  const [quickReportStatusText, setQuickReportStatusText] = useState<string | null>(null)
  const [quickReportStatusKind, setQuickReportStatusKind] = useState<'success' | 'error'>('success')

  // Man-Down Detection — records GPS updates and fires alert if stationary too long
  const { recordGPSUpdate, isManDownActive } = useManDownDetection()

  // ── SOS/Panic button state ────────────────────────────────────────────────
  const [sosConfirmOpen, setSosConfirmOpen] = useState(false)
  const [sosHoldProgress, setSosHoldProgress] = useState(0)
  const sosHoldRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Long-press SOS: user must hold for 3 s to avoid accidental triggers
  function startSosHold() {
    setSosHoldProgress(0)
    sosHoldRef.current = setInterval(() => {
      setSosHoldProgress(p => {
        if (p >= 100) {
          clearInterval(sosHoldRef.current!)
          triggerSOS()
          return 0
        }
        return p + 10 // 10 steps × ~300ms = 3s
      })
    }, 300)
  }
  function cancelSosHold() {
    if (sosHoldRef.current) clearInterval(sosHoldRef.current)
    setSosHoldProgress(0)
  }
  async function triggerSOS() {
    if (!user?.id || !user?.organization_id) return
    try {
      const officerName = `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim()
      const locationLabel = currentLocation
        ? `${currentLocation.latitude.toFixed(5)}, ${currentLocation.longitude.toFixed(5)}`
        : null

      await insertWelfareAlert.mutateAsync({
        officer_id:       user.id,
        organization_id:  user.organization_id,
        alert_type:       'sos',
        officer_name:     officerName,
        gps_latitude:     currentLocation?.latitude  ?? null,
        gps_longitude:    currentLocation?.longitude ?? null,
        last_activity_at: new Date().toISOString(),
        escalation_level: 2, // SOS always escalates immediately
      })

      publishEmergencyAssistRequest({
        source: 'welfare_panic_button',
        organizationId: user.organization_id,
        officerId: user.id,
        officerName: officerName || null,
        locationLabel,
        latitude: currentLocation?.latitude ?? null,
        longitude: currentLocation?.longitude ?? null,
        reason: 'Welfare panic button activated',
      })

      toast.error('🚨 SOS ALERT SENT – Help is on the way', { duration: 0, id: 'sos-alert' })
    } catch (err: any) {
      toast.error(err?.message ?? 'SOS failed – call emergency services directly')
    }
  }

  // ── Post-shift feedback ───────────────────────────────────────────────────
  const [showShiftFeedback, setShowShiftFeedback] = useState(false)
  const [feedbackShiftId,   setFeedbackShiftId]   = useState<string | null>(null)

  // ── Shift organization/zone selection for ad-hoc shifts ───────────────────
  const [shiftOrgId, setShiftOrgId] = useState<string>(employerOrganizationId ?? '')
  const [shiftZoneId, setShiftZoneId] = useState<string>('')
  const [shareLiveLocationWithClient, setShareLiveLocationWithClient] = useState<boolean>(true)

  // Check if user is a service provider member (has access to multiple organizations)
  const isServiceProviderMember = (user?.authorized_work_locations?.length ?? 0) > 0 ||
    (user?.extra_organization_ids?.length ?? 0) > 0

  // Fetch organizations accessible to this user for shift selection
  const { data: accessibleOrgs = [] } = useAccessibleOrgsForShift({
    userId: user?.id,
    employerOrganizationId,
    organizationId: user?.organization_id,
    authorizedWorkLocations: user?.authorized_work_locations,
    extraOrganizationIds: user?.extra_organization_ids,
    isServiceProviderMember,
  })

  // Fetch zones for the selected shift organization
  const { data: shiftZones = [] } = useShiftZones(shiftOrgId)

  // Reset zone when organization changes
  useEffect(() => {
    setShiftZoneId('')
  }, [shiftOrgId])

  // Set default org when user loads
  useEffect(() => {
    if (employerOrganizationId && !shiftOrgId) {
      setShiftOrgId(employerOrganizationId)
    }
  }, [employerOrganizationId, shiftOrgId])

  // ── Unread notifications ──────────────────────────────────────────────────
  const { data: unreadNotifications = [] } = useOfficerUnreadNotifications(user?.id)

  async function markNotificationRead(notifId: string) {
    await markNotificationReadMutation.mutateAsync(notifId)
    toast.dismiss()
  }

  // ── Dispatched jobs assigned to this officer (GDS CATS job queue) ──────────
  const qcHook = useQueryClient()
  const { data: myDispatchJobs = [] } = useQuery({
    queryKey: ['my-dispatch-jobs', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data } = await (supabase as any)
        .from('dispatch_jobs')
        .select('id, job_number, job_type, priority, status, title, address, description, caller_phone, response_sla_minutes, dispatched_at, created_at')
        .eq('assigned_to', user.id)
        .in('status', ['dispatched', 'acknowledged', 'en_route', 'on_scene'])
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
      return data ?? []
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
  })

  const advanceJobStatus = useMutation({
    mutationFn: async ({ jobId, newStatus }: { jobId: string; newStatus: string }) => {
      const update: any = { status: newStatus }
      if (newStatus === 'acknowledged') update.acknowledged_at = new Date().toISOString()
      if (newStatus === 'en_route')     update.en_route_at     = new Date().toISOString()
      if (newStatus === 'on_scene')     update.on_scene_at     = new Date().toISOString()
      const { error } = await (supabase as any).from('dispatch_jobs').update(update).eq('id', jobId)
      if (error) throw error
    },
    onSuccess: () => { qcHook.invalidateQueries({ queryKey: ['my-dispatch-jobs'] }) },
    onError: (err: any) => toast.error(err?.message ?? 'Update failed'),
  })
  const completeDispatchJob = useDispatchCompletion()

  const { data: activeRouteInstance, isLoading: activeRouteLoading } = useOfficerActiveRouteInstance()
  const { data: activeRouteStops = [], isLoading: activeRouteStopsLoading } = usePatrolRouteInstanceStops(activeRouteInstance?.id)
  const updateRouteStopStatus = useUpdatePatrolRouteStopStatus()
  const lastAutoArrivedStopIdRef = useRef<string | null>(null)
  const lastAutoCompletedStopIdRef = useRef<string | null>(null)
  const stopSeenInZoneRef = useRef<Record<string, boolean>>({})

  const activeRouteTotalStops = activeRouteStops.length
  const activeRouteCompletedStops = activeRouteStops.filter((stop) => stop.visit_status === 'completed').length
  const activeRouteCurrentStop = activeRouteStops.find((stop) => stop.visit_status === 'arrived')
    ?? activeRouteStops.find((stop) => stop.visit_status === 'pending')
  const effectivePatrolZone = routeTestOverride?.currentPatrolZone ?? currentPatrolZone

  // Auto-mark stop as arrived once when geofence indicates officer is in the stop's zone.
  useEffect(() => {
    if (!activeRouteCurrentStop) return
    if (activeRouteCurrentStop.visit_status !== 'pending') return
    if (!activeRouteCurrentStop.zone_id) return
    if (!effectivePatrolZone) return
    if (activeRouteCurrentStop.zone_id !== effectivePatrolZone) return
    if (updateRouteStopStatus.isPending) return
    if (lastAutoArrivedStopIdRef.current === activeRouteCurrentStop.id) return

    lastAutoArrivedStopIdRef.current = activeRouteCurrentStop.id
    updateRouteStopStatus.mutate(
      {
        stopId: activeRouteCurrentStop.id,
        routeInstanceId: activeRouteCurrentStop.route_instance_id,
        status: 'arrived',
        source: 'zone_enter_auto',
      },
      {
        onError: () => {
          lastAutoArrivedStopIdRef.current = null
        },
      }
    )
  }, [activeRouteCurrentStop, effectivePatrolZone, updateRouteStopStatus])

  // Mark stop as eligible for auto-complete once officer has been seen in that stop zone.
  useEffect(() => {
    if (!activeRouteCurrentStop?.id || !activeRouteCurrentStop.zone_id || !effectivePatrolZone) return
    if (activeRouteCurrentStop.visit_status !== 'arrived') return
    if (activeRouteCurrentStop.zone_id !== effectivePatrolZone) return

    stopSeenInZoneRef.current[activeRouteCurrentStop.id] = true
  }, [activeRouteCurrentStop, effectivePatrolZone])

  // Auto-complete the current arrived stop when officer exits the stop zone after minimum dwell.
  useEffect(() => {
    if (!activeRouteCurrentStop) return
    if (activeRouteCurrentStop.visit_status !== 'arrived') return
    if (!activeRouteCurrentStop.zone_id) return
    if (!effectivePatrolZone) return
    if (activeRouteCurrentStop.zone_id === effectivePatrolZone) return
    if (updateRouteStopStatus.isPending) return
    if (!stopSeenInZoneRef.current[activeRouteCurrentStop.id]) return
    if (lastAutoCompletedStopIdRef.current === activeRouteCurrentStop.id) return

    const arrivalTs = activeRouteCurrentStop.actual_arrival_at
      ? new Date(activeRouteCurrentStop.actual_arrival_at).getTime()
      : 0
    if (!arrivalTs) return

    const dwellMs = Date.now() - arrivalTs
    const minDwellMs = activeRouteCurrentStop.planned_dwell_minutes && activeRouteCurrentStop.planned_dwell_minutes > 0
      ? activeRouteCurrentStop.planned_dwell_minutes * 60 * 1000
      : 30 * 1000
    if (dwellMs < minDwellMs) return

    lastAutoCompletedStopIdRef.current = activeRouteCurrentStop.id
    updateRouteStopStatus.mutate(
      {
        stopId: activeRouteCurrentStop.id,
        routeInstanceId: activeRouteCurrentStop.route_instance_id,
        status: 'completed',
        source: 'zone_exit_auto',
      },
      {
        onError: () => {
          lastAutoCompletedStopIdRef.current = null
        },
      }
    )
  }, [activeRouteCurrentStop, effectivePatrolZone, updateRouteStopStatus])

  // Display-friendly zone label for the officer status card
  const displayZone = zoneName || (zoneId ? `${zoneId.substring(0, 8)}...` : 'Scanning Geofence...')

  // ── Fetch org enforcement_workflow ────────────────────────────────────────
  const { data: orgWorkflow } = useOrgWorkflow(user?.organization_id)

  // ── Zones for manual fallback entry ───────────────────────────────────────
  const { data: manualZones = [] } = useManualZones(user?.organization_id)

  useEffect(() => {
    if (!manualZoneId && manualZones.length > 0) {
      setManualZoneId(manualZones[0].zone_id)
    }
  }, [manualZoneId, manualZones])

  // ── Fetch officer's recent observations ───────────────────────────────────
  const { data: recentScans = [], refetch: refetchScans } = useMyRecentScans(user?.id)

  useEffect(() => {
    const refreshPortalData = () => {
      queryClient.invalidateQueries({ queryKey: ['org-workflow'] })
      queryClient.invalidateQueries({ queryKey: ['my-recent-scans'] })
    }

    const onFocus = () => refreshPortalData()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshPortalData()
      }
    }

    refreshPortalData()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [queryClient, user?.id, user?.organization_id])

  // ── Enforcement action mutation ────────────────────────────────────────────
  const issueEnforcementAction = useIssueEnforcementAction()
  const issueAction = {
    mutateAsync: (params: { observationId: string; zoneId: string; plateNumber: string; actionType: 'warning' | 'notice_to_vacate' }) =>
      issueEnforcementAction.mutateAsync({
        ...params,
        organizationId: (activeShift as any)?.organization_id || shiftOrgId || employerOrganizationId,
        createdBy: user?.id ?? null,
      }),
    mutate: (params: { observationId: string; zoneId: string; plateNumber: string; actionType: 'warning' | 'notice_to_vacate' }) =>
      issueEnforcementAction.mutate({
        ...params,
        organizationId: (activeShift as any)?.organization_id || shiftOrgId || employerOrganizationId,
        createdBy: user?.id ?? null,
      }),
    isPending: issueEnforcementAction.isPending,
  }

  // Auto-monitor geofence and manage patrol
  useEffect(() => {
    if (!user?.id || !employerOrganizationId) return
    if (routeTestOverride?.disableGeofenceMonitoring) return

    const geofenceOrgId =
      isServiceProviderMember
        ? (activeShift as any)?.organization_id || shiftOrgId || employerOrganizationId
        : employerOrganizationId

    const gpsActivityType = shareLiveLocationWithClient ? 'gps_update' : 'gps_private'

    const checkGeofence = () => {
      monitorGeofenceAndPatrol(
        user.id,
        geofenceOrgId,
        currentPatrolZone,
        (newZoneId, newZoneName) => {
          setCurrentPatrolZone(newZoneId)
          setZone(newZoneId, newZoneName)
        },
        {
          onLocationUpdate: ({ latitude, longitude }) => {
            setCurrentLocation({ latitude, longitude })
            recordGPSUpdate(latitude, longitude)
          },
          activityType: gpsActivityType,
          currentZoneName: zoneName,
        },
      )
    }

    // Defer first geofence check by 2 s so the portal finishes rendering before
    // the browser GPS permission prompt appears (avoids a blank-screen flash).
    const initialDelay = setTimeout(() => checkGeofence(), 2000)
    const interval = setInterval(checkGeofence, 30000)
    return () => {
      clearTimeout(initialDelay)
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, employerOrganizationId, isServiceProviderMember, shiftOrgId, currentPatrolZone, setZone, recordGPSUpdate, zoneName, shareLiveLocationWithClient, routeTestOverride?.disableGeofenceMonitoring])

  // ── Shift management — explicit Start/End (not auto-start) ──────────────
  // Fetch active shift for current officer
  const { data: activeShift, refetch: refetchShift } = useOfficerActiveShift(user?.id)

  const [isStartingShift, setIsStartingShift] = useState(false)
  const [isEndingShift,   setIsEndingShift]   = useState(false)

  const primaryDispatchJob = (myDispatchJobs as any[])[0] ?? null
  const speechActivityTarget = useMemo(() => {
    if (primaryDispatchJob) {
      const dispatchReference = primaryDispatchJob.job_number
        ? String(primaryDispatchJob.job_number)
        : extractRapidReference(primaryDispatchJob.title ?? null)

      return {
        kind: 'dispatch' as const,
        id: primaryDispatchJob.id as string,
        label: `${dispatchReference ? `Dispatch ${dispatchReference}` : 'Dispatch'} · ${primaryDispatchJob.title ?? 'Untitled job'}`,
        rapidReference: dispatchReference,
      }
    }

    if (activeRouteInstance) {
      const routeLabel = String(activeRouteInstance.patrol_route_name ?? 'Active patrol route')
      return {
        kind: 'patrol' as const,
        id: activeRouteInstance.id as string,
        label: routeLabel,
        rapidReference: extractRapidReference(routeLabel),
      }
    }

    return null
  }, [activeRouteInstance, primaryDispatchJob])

  const handleSpeechIntentResult = useCallback(async (speechResult: SpeechIntentResult) => {
    if (!user?.id || !user.organization_id) return

    const { error } = await (supabase.from('audit_log') as any).insert({
      organization_id: user.organization_id,
      action: 'speech_activity_enriched',
      entity_type: speechActivityTarget?.kind === 'dispatch' ? 'dispatch_job' : 'patrol_route_instance',
      entity_id: speechActivityTarget?.id ?? activeShift?.id ?? user.id,
      performed_by: user.id,
      new_values: {
        source: 'assistive',
        authoritative_target: speechActivityTarget?.kind === 'dispatch' ? 'dispatch_job' : 'patrol_route_instance',
        target_label: speechActivityTarget?.label ?? 'Field session',
        rapid_reference: speechActivityTarget?.rapidReference ?? null,
        transcript: speechResult.transcript,
        summary: speechResult.intent.summary,
        intent: speechResult.intent.intent,
        confidence: speechResult.intent.confidence,
        needs_confirmation: speechResult.intent.needs_confirmation,
        entities: speechResult.intent.entities,
        dispatch_job_id: primaryDispatchJob?.id ?? null,
        patrol_route_instance_id: activeRouteInstance?.id ?? null,
        shift_id: activeShift?.id ?? null,
        zone_id: effectivePatrolZone ?? manualZoneId ?? null,
        active_service: activeService ?? null,
        captured_at: new Date().toISOString(),
      },
    })

    if (error) {
      toast.error(error.message || 'Failed to attach speech activity')
      return
    }

    queryClient.invalidateQueries({ queryKey: ['dispatch-monitor-parity'] })
    setQuickReportStatusKind('success')
    setQuickReportStatusText(`Speech activity attached to ${speechActivityTarget?.label ?? 'field session'}`)
    toast.success('Officer activity enriched from speech capture')
  }, [
    activeRouteInstance?.id,
    activeService,
    activeShift?.id,
    effectivePatrolZone,
    manualZoneId,
    primaryDispatchJob?.id,
    queryClient,
    speechActivityTarget,
    user,
  ])

  const speechIntent = useSpeechIntent({
    orgId: user?.organization_id ?? null,
    context: speechActivityTarget
      ? {
          source: 'rapid-activity-listener',
          target_kind: speechActivityTarget.kind,
          target_id: speechActivityTarget.id,
          target_label: speechActivityTarget.label,
          rapid_reference: speechActivityTarget.rapidReference,
          dispatch_job_id: primaryDispatchJob?.id ?? null,
          patrol_route_instance_id: activeRouteInstance?.id ?? null,
          shift_id: activeShift?.id ?? null,
          zone_id: effectivePatrolZone ?? manualZoneId ?? null,
          active_service: activeService ?? null,
        }
      : undefined,
    maxDurationMs: 12000,
    onResult: handleSpeechIntentResult,
    onError: (message) => {
      setQuickReportStatusKind('error')
      setQuickReportStatusText(message)
    },
  })

  const handleStartShift = useCallback(async () => {
    // Service-provider members can choose a client jurisdiction to work in.
    // Single-organisation officers are bound to their employer jurisdiction.
    const effectiveOrgId = isServiceProviderMember && shiftOrgId ? shiftOrgId : employerOrganizationId
    const effectiveZoneId = shiftZoneId || zoneId || null

    if (!user?.id || !effectiveOrgId) return
    setIsStartingShift(true)
    try {
      let gpsLat: number | null = null
      let gpsLng: number | null = null
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
        })
        gpsLat = pos.coords.latitude
        gpsLng = pos.coords.longitude
      } catch { /* GPS optional */ }

      const shiftRow = await startOfficerShift.mutateAsync({
        officer_id:      user.id,
        organization_id: effectiveOrgId,
        parent_zone_id:  effectiveZoneId,
        gps_start_lat:   gpsLat,
        gps_start_lng:   gpsLng,
      })

      const effectiveOrgName = accessibleOrgs.find((org) => org.id === effectiveOrgId)?.name ?? null
      setOrganization(effectiveOrgId, effectiveOrgName)

      // Register welfare push schedule on server (enables background reminders)
      // Fetch the officer's configured interval so the server-side schedule matches the UI.
      let welfareIntervalMinutes = 30
      try {
        welfareIntervalMinutes = await fetchWelfareIntervalMinutes(user.id)
      } catch { /* non-critical */ }

      await (supabase.rpc as any)('upsert_welfare_push_schedule', {
        p_officer_id:       user.id,
        p_organization_id:  employerOrganizationId,
        p_shift_id:         shiftRow?.id ?? null,
        p_interval_minutes: welfareIntervalMinutes,
        p_last_checkin_at:  new Date().toISOString(),
      }).catch(() => { /* non-critical */ })

      // Notify service worker to clear stale welfare notifications
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'WELFARE_SHIFT_START',
          payload: { officerId: user.id },
        })
      }

      toast.success('Shift started — welfare monitoring active')

      await refetchShift()
      queryClient.invalidateQueries({ queryKey: ['officer-active-shift'] })
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to start shift')
    } finally {
      setIsStartingShift(false)
    }
  }, [user, employerOrganizationId, zoneId, shiftOrgId, shiftZoneId, isServiceProviderMember, refetchShift, queryClient, accessibleOrgs, setOrganization, startOfficerShift])

  const handleEndShift = useCallback(async () => {
    if (!activeShift?.id) return
    setIsEndingShift(true)
    try {
      let gpsLat: number | null = null
      let gpsLng: number | null = null
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
        })
        gpsLat = pos.coords.latitude
        gpsLng = pos.coords.longitude
      } catch { /* GPS optional */ }

      await endOfficerShift.mutateAsync({ shiftId: activeShift.id, gps_end_lat: gpsLat, gps_end_lng: gpsLng })

      // Deactivate welfare push schedule
      if (user?.id) {
        await deactivateWelfarePushSchedule.mutateAsync(user.id).catch(() => { /* non-critical */ })
      }

      // Notify service worker to dismiss welfare notifications
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'WELFARE_SHIFT_END' })
      }

      toast.success('Shift ended — welfare monitoring stopped')

      await refetchShift()
      queryClient.invalidateQueries({ queryKey: ['officer-active-shift'] })
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to end shift')
    } finally {
      setIsEndingShift(false)
    }
  }, [activeShift, user, refetchShift, queryClient, endOfficerShift, deactivateWelfarePushSchedule])

  // Shift duration ticker — re-render every 30s to update displayed duration
  const [, setShiftTick] = useState(0)
  useEffect(() => {
    if (!activeShift) return
    const interval = setInterval(() => setShiftTick(t => t + 1), 30000)
    return () => clearInterval(interval)
  }, [activeShift])

  // ── WelfareFirst: I'm OK check-in (only active while shift is running) ────
  const { state: checkinState, checkIn: rawCheckIn } = useWelfareCheckin({
    officerId:      user?.id ?? null,
    organizationId: employerOrganizationId,
    shiftId:        activeShift?.id ?? null,
    position:       currentLocation,
    isShiftActive:  !!activeShift,
  })

  // Wrap checkIn to also update server schedule + notify SW
  const checkIn = useCallback(() => {
    rawCheckIn()
    // Update server-side welfare push schedule so next reminder is rescheduled
    if (user?.id && employerOrganizationId && activeShift?.id) {
      ;(supabase.rpc as any)('upsert_welfare_push_schedule', {
        p_officer_id:       user.id,
        p_organization_id:  employerOrganizationId,
        p_shift_id:         activeShift.id,
        p_interval_minutes: checkinState.intervalMinutes || 30,
        p_last_checkin_at:  new Date().toISOString(),
      }).catch(() => { /* non-critical */ })
    }
    // Dismiss background welfare notifications
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'WELFARE_CHECKIN' })
    }
  }, [rawCheckIn, user, activeShift, checkinState.intervalMinutes, employerOrganizationId])

  // Listen for the service-worker "I'm OK" action (tapped from notification)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'WELFARE_CHECKIN_ACTION') {
        checkIn()
      }
    }
    navigator.serviceWorker?.addEventListener('message', handler)
    return () => navigator.serviceWorker?.removeEventListener('message', handler)
  }, [checkIn])

  // Auto-dismiss the quick-report status banner after 5 s (errors stay until dismissed)
  useEffect(() => {
    if (!quickReportStatusText || quickReportStatusKind !== 'success') return
    const t = setTimeout(() => setQuickReportStatusText(null), 5000)
    return () => clearTimeout(t)
  }, [quickReportStatusText, quickReportStatusKind])

  // ── Detail scan: capture handler ─────────────────────────────────────────
  const handleDetailCapture = useCallback(async (file: File) => {
    if (!user?.id || !user?.organization_id) {
      toast.error('Session expired — please log out and back in')
      return
    }
    setIsProcessing(true)
    setScanProgressLabel(SCAN_PROGRESS_LABELS.gps)
    try {
      const result = await captureAndSave(
        file,
        { id: user.id, organization_id: user.organization_id, full_name: user.full_name },
        zoneId,
        (lat, lon) => {
          setCurrentLocation({ latitude: lat, longitude: lon })
          recordGPSUpdate(lat, lon)
        },
        (_stage: ScanProgressStage, label: string) => setScanProgressLabel(label),
      )

      toast.success('✅ Observation captured — detecting plate…', {
        duration: CAPTURE_TOAST_DURATION_MS,
      })

      // Open the detail panel — it polls internally for enrichment
      setDetailScanData({
        observationId:       result.observationId,
        photoUrl:            result.photoUrl,
        plateNumber:         null,
        isCompliant:         null,
        isHomelessExempt:    false,
        homelessStatus:      null,
        breachType:          null,
        processingPending:   true,
        zoneName:            zoneName ?? null,
        observationZoneId:   result.zoneId,
        recordedAt:          result.recordedAt,
        vehicleMake:         null,
        vehicleModel:        null,
        vehicleYear:         null,
        vehicleColor:        null,
        vehicleAttributeSources: null,
        isSelfContained:     false,
        selfContainedExpiry: null,
        cscStatus:           null,
        vehicleMoved:        null,
        isNewVehicle:        false,
        officerNotes:        result.weather !== 'Unknown' ? `Weather: ${result.weather}` : null,
        gpsLatitude:         result.gpsLatitude,
        gpsLongitude:        result.gpsLongitude,
        hasDiscrepancies:    false,
        discrepancyFlags:    null,
        consecutiveNights:      null,
        nightsStayedThisMonth:  null,
      })
      setDetailCameraOpen(false)
      setShowDetailPanel(true)
      refetchScans()

    } catch (err: any) {
      toast.error(err.message || 'Scan failed — please try again')
    } finally {
      setIsProcessing(false)
      setScanProgressLabel(SCAN_PROGRESS_LABELS.gps)
    }
  }, [user, zoneId, zoneName, recordGPSUpdate, refetchScans])

  const handleManualEntrySubmit = useCallback(async () => {
    if (!user?.id || !user?.organization_id) {
      toast.error('Session expired — please log out and back in')
      return
    }

    const normalizedPlate = manualPlate.trim().toUpperCase().replace(/\s+/g, '')
    if (!/^[A-Z0-9]{2,8}$/.test(normalizedPlate)) {
      toast.error('Enter a valid plate number')
      return
    }

    if (!manualZoneId) {
      toast.error('Please select a zone')
      return
    }

    setManualSubmitting(true)
    const isOffline = !navigator.onLine

    try {
      if (isOffline) {
        await addToQueue.mutateAsync({
          plate_number: normalizedPlate,
          photo_url: '',
          zone_id: manualZoneId,
          gps_latitude: currentLocation?.latitude ?? 0,
          gps_longitude: currentLocation?.longitude ?? 0,
          gps_accuracy: null,
          recorded_at: new Date().toISOString(),
        })
        // Toast handled by useOfflineQueue addToQueue onSuccess.
      } else {
        const { error } = await edgeFunctions.ingestVehicleObservation({
          officerId: user.id,
          organizationId: user.organization_id,
          zoneId: manualZoneId,
          plate: normalizedPlate,
          requires_manual_entry: true,
          recordedAt: new Date().toISOString(),
          gpsLatitude: currentLocation?.latitude,
          gpsLongitude: currentLocation?.longitude,
          idempotencyKey: `manual-${user.id}-${Date.now()}`,
        })

        if (error) {
          throw new Error(error)
        }

        toast.success(`Vehicle ${normalizedPlate} scanned successfully`)
        refetchScans()
      }

      setManualPlate('')
      setManualZoneId('')
      setShowManualEntry(false)
      setDetailCameraOpen(false)
      setScanMode(null)
    } catch (err: any) {
      toast.error(err?.message || 'Manual entry failed')
    } finally {
      setManualSubmitting(false)
    }
  }, [user, manualPlate, manualZoneId, currentLocation, refetchScans, addToQueue])

  const handleViewHistory = () => {
    if (user?.role === 'officer') {
      const panel = document.getElementById('recent-scans-panel')
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        toast.info('No scans recorded in the last 24 hours')
      }
      return
    }
    navigate('/compliance')
  }

  // ── Open quick-report modal, auto-fill location from GPS ─────────────────
  const handleOpenQuickReport = useCallback(() => {
    setQuickReportStatusText(null)
    setQRVehiclePlate('')
    setQRDescription('')
    setQRActionTaken('')
    setQRLocationAddress('')
    setQRReportType('incident')
    setQRIncidentType('general_incident')
    setQRSeverity('medium')
    setShowQuickReport(true)
    // Auto-fill location from GPS
    if (currentLocation?.latitude && currentLocation?.longitude) {
      reverseGeocode(currentLocation.latitude, currentLocation.longitude)
        .then(result => {
          if (!result) return
          const parts = [
            result.street_number && result.street_name
              ? `${result.street_number} ${result.street_name}`
              : result.street_name,
            result.suburb,
            result.city,
          ].filter(Boolean)
          if (parts.length > 0) setQRLocationAddress(parts.join(', '))
        })
        .catch(() => { /* non-critical */ })
    }
  }, [currentLocation])

  // ── Submit standalone quick report ────────────────────────────────────────
  const handleSubmitQuickReport = useCallback(async () => {
    if (!user || !qrDescription.trim()) {
      toast.warning('Please describe the incident')
      return
    }
    setIsSubmittingReport(true)
    try {
      const descFull = qrDescription.trim() +
        (qrActionTaken.trim() ? `\n\nAction taken: ${qrActionTaken.trim()}` : '') +
        (qrVehiclePlate.trim() ? `\n\nLinked vehicle: ${qrVehiclePlate.trim().toUpperCase()}` : '') +
        (qrLocationAddress.trim() ? `\n\nLocation: ${qrLocationAddress.trim()}` : '')

      if (qrReportType === 'hs') {
        let hsInsertError: unknown | null = null
        try {
          await postgrestInsertWithTimeout('health_safety_reports', {
            organization_id: user.organization_id,
            reported_by: user.id,
            zone_id: zoneId || null,
            incident_type: qrIncidentType,
            severity: qrSeverity,
            description: descFull,
          }, 10000)
        } catch (err) {
          hsInsertError = err
        }

        if (hsInsertError) {
          const hsErrorMessage = String((hsInsertError as any)?.message || '').toLowerCase()
          const shouldFallbackToIncidents =
            hsErrorMessage.includes('row-level security') ||
            hsErrorMessage.includes('violates row-level security')

          if (!shouldFallbackToIncidents) {
            throw hsInsertError
          }

          let hsFallbackUserIdError: unknown | null = null
          try {
            await postgrestInsertWithTimeout('incidents', {
              organization_id: user.organization_id,
              zone_id: zoneId || null,
              user_id: user.id,
              plate_number: qrVehiclePlate.trim().toUpperCase() || null,
              incident_type: 'H&S Report',
              severity: qrSeverity,
              description: descFull,
              location_address: qrLocationAddress.trim() || null,
              location_lat: currentLocation?.latitude ?? null,
              location_lng: currentLocation?.longitude ?? null,
            }, 10000)
          } catch (err) {
            hsFallbackUserIdError = err
          }

          if (hsFallbackUserIdError) {
            const fallbackMessage = String((hsFallbackUserIdError as any)?.message || '').toLowerCase()
            const retryWithReportedBy = fallbackMessage.includes('user_id') || fallbackMessage.includes('reported_by')

            if (!retryWithReportedBy) {
              throw hsFallbackUserIdError
            }

            await postgrestInsertWithTimeout('incidents', {
              organization_id: user.organization_id,
              zone_id: zoneId || null,
              reported_by: user.id,
              plate_number: qrVehiclePlate.trim().toUpperCase() || null,
              incident_type: 'H&S Report',
              severity: qrSeverity,
              description: descFull,
              location_address: qrLocationAddress.trim() || null,
              location_lat: currentLocation?.latitude ?? null,
              location_lng: currentLocation?.longitude ?? null,
            }, 10000)
          }
        }

        const successText = 'H&S report submitted successfully — admin notified'
        setQuickReportStatusKind('success')
        setQuickReportStatusText(successText)
        toast.success(successText)
      } else {
        const incidentPayload = {
          organization_id: user.organization_id,
          zone_id:         zoneId || null,
          plate_number:    qrVehiclePlate.trim().toUpperCase() || null,
          incident_type:   qrReportType === 'maintenance' ? 'Maintenance Report' : qrIncidentType,
          severity:        qrSeverity,
          description:     descFull,
          location_address: qrLocationAddress.trim() || null,
          location_lat:    currentLocation?.latitude ?? null,
          location_lng:    currentLocation?.longitude ?? null,
        }

        let userIdError: unknown | null = null
        try {
          await postgrestInsertWithTimeout('incidents', {
            ...incidentPayload,
            user_id: user.id,
          }, 10000)
        } catch (err) {
          userIdError = err
        }

        if (userIdError) {
          const userIdErrorMessage = String((userIdError as any)?.message || '').toLowerCase()
          const shouldRetryWithReportedBy =
            userIdErrorMessage.includes('user_id') ||
            userIdErrorMessage.includes('reported_by')

          if (!shouldRetryWithReportedBy) {
            throw userIdError
          }

          await postgrestInsertWithTimeout('incidents', {
            ...incidentPayload,
            reported_by: user.id,
          }, 10000)
        }

        const successText =
          qrReportType === 'maintenance'
            ? 'Maintenance report submitted successfully — admin notified'
            : 'Incident report submitted successfully — admin notified'
        setQuickReportStatusKind('success')
        setQuickReportStatusText(successText)
        toast.success(successText)
      }
      setShowQuickReport(false)
      setQRDescription('')
      setQRActionTaken('')
      setQRVehiclePlate('')
    } catch (err: any) {
      const message = err.message || 'Failed to submit report'
      setQuickReportStatusKind('error')
      setQuickReportStatusText(message)
      toast.error(message)
    } finally {
      setIsSubmittingReport(false)
    }
  }, [user, qrReportType, qrIncidentType, qrSeverity, qrDescription, qrActionTaken, qrVehiclePlate, qrLocationAddress, zoneId, currentLocation])

  return (
    <AppLayout
      title="Field Officer Portal"
      description={`Welcome, ${user?.full_name || 'Officer'}${followUpCount > 0 ? ` · ${followUpCount} follow-up${followUpCount > 1 ? 's' : ''} assigned` : ''}`}
    >

      {/* Geofence violation warning — shown when officer drifts out of assigned zone */}
      {geofenceViolation && <GeofenceWarningBanner zoneName={zoneName} />}

      {/* Language selector — top-right of portal content area */}
      <div className="flex justify-end mb-2">
        <OfficerLanguageSelector />
      </div>

      {quickReportStatusText && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm font-medium ${
            quickReportStatusKind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
          }`}
          role="status"
          aria-live="polite"
        >
          {quickReportStatusText}
        </div>
      )}

      {/* ── Man-Down active warning banner ──────────────────────────── */}
      {isManDownActive && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-400 bg-red-50 dark:bg-red-950 p-4">
          <ShieldAlert className="h-6 w-6 text-red-600 shrink-0 animate-pulse" />
          <div>
            <p className="font-semibold text-red-700 dark:text-red-300">🚨 Man-Down Alert Active</p>
            <p className="text-sm text-red-600 dark:text-red-400">Emergency alert sent to admin. Move or acknowledge to clear.</p>
          </div>
        </div>
      )}

      {/* ── Night Patrol mode toggle strip ───────────────────────────── */}
      <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 mb-4 transition-colors ${
        isNightPatrol
          ? 'bg-cyan-950 border border-cyan-700'
          : 'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
      }`}>
        <div className="flex items-center gap-2">
          {isNightPatrol
            ? <Moon className="h-4 w-4 text-cyan-400" />
            : <Sun className="h-4 w-4 text-amber-500" />}
          <div>
            <p className={`text-sm font-semibold ${isNightPatrol ? 'text-cyan-300' : 'text-gray-800 dark:text-gray-200'}`}>
              {isNightPatrol ? 'Night Patrol Mode' : 'Standard Mode'}
            </p>
            <p className={`text-[11px] ${isNightPatrol ? 'text-cyan-500' : 'text-gray-500'}`}>
              {isNightPatrol ? 'Dark display · Large buttons · High contrast' : 'Tap 🌙 for night field work'}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={isNightPatrol ? 'default' : 'outline'}
          className={`h-10 px-4 text-sm font-semibold ${
            isNightPatrol
              ? 'bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-600'
              : 'border-gray-300 dark:border-gray-600'
          }`}
          onClick={() => setThemeMode(isNightPatrol ? 'dark' : 'night-patrol')}
        >
          {isNightPatrol ? <Sun className="h-4 w-4 mr-1.5" /> : <Moon className="h-4 w-4 mr-1.5" />}
          {isNightPatrol ? 'Day Mode' : '🌙 Night Mode'}
        </Button>
      </div>

      {/* ── Shift & Welfare status bar ───────────────────────────────── */}
      {!activeShift ? (
        /* No active shift — show "online" status + Start Shift button */
        <div className="rounded-xl border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 mb-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-full bg-blue-200 dark:bg-blue-800">
                <MapPin className="h-4 w-4 text-blue-700 dark:text-blue-300" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-blue-800 dark:text-blue-200">Online</span>
                {currentLocation && (
                  <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">
                    {currentLocation.latitude.toFixed(5)}, {currentLocation.longitude.toFixed(5)}
                  </p>
                )}
                <p className="text-[11px] text-blue-500 dark:text-blue-500 mt-0.5">
                  Shift not started — welfare monitoring is off
                </p>
                {isServiceProviderMember && (
                  <p className="text-[11px] text-blue-500 dark:text-blue-500 mt-0.5">
                    Live client tracking: {shareLiveLocationWithClient ? 'shared' : 'private to employer'}
                  </p>
                )}
              </div>
            </div>

            {isServiceProviderMember && (
              <div className="pt-2 border-t border-blue-200 dark:border-blue-700 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Share Live Location With Client</p>
                  <p className="text-[11px] text-blue-500 dark:text-blue-500">When off, GPS still drives geofence and welfare but is hidden from client live tracking.</p>
                </div>
                <Button
                  size="sm"
                  variant={shareLiveLocationWithClient ? 'default' : 'outline'}
                  onClick={() => setShareLiveLocationWithClient(v => !v)}
                >
                  {shareLiveLocationWithClient ? 'Sharing On' : 'Sharing Off'}
                </Button>
              </div>
            )}

            {/* Organization/Zone selection for service provider members */}
            {isServiceProviderMember && accessibleOrgs.length > 1 && (
              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                <div className="flex-1">
                  <Label className="text-xs text-blue-700 dark:text-blue-300 mb-1 block">Organisation</Label>
                  <Select value={shiftOrgId} onValueChange={setShiftOrgId}>
                    <SelectTrigger className="h-9 text-sm bg-white dark:bg-gray-900">
                      <SelectValue placeholder="Select organisation…" />
                    </SelectTrigger>
                    <SelectContent>
                      {accessibleOrgs.map(org => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-blue-700 dark:text-blue-300 mb-1 block">Zone / Location</Label>
                  <Select value={shiftZoneId} onValueChange={setShiftZoneId} disabled={!shiftOrgId || shiftZones.length === 0}>
                    <SelectTrigger className="h-9 text-sm bg-white dark:bg-gray-900">
                      <SelectValue placeholder={shiftZones.length === 0 ? 'No zones available' : 'Select zone…'} />
                    </SelectTrigger>
                    <SelectContent>
                      {shiftZones.map(zone => (
                        <SelectItem key={zone.id} value={zone.id}>
                          {zone.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Single-org users: just show zone selection */}
            {!isServiceProviderMember && shiftZones.length > 0 && (
              <div className="pt-2 border-t border-blue-200 dark:border-blue-700">
                <Label className="text-xs text-blue-700 dark:text-blue-300 mb-1 block">Zone / Location</Label>
                <Select value={shiftZoneId} onValueChange={setShiftZoneId}>
                  <SelectTrigger className="h-9 text-sm bg-white dark:bg-gray-900">
                    <SelectValue placeholder="Select zone…" />
                  </SelectTrigger>
                  <SelectContent>
                    {shiftZones.map(zone => (
                      <SelectItem key={zone.id} value={zone.id}>
                        {zone.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Start Shift button */}
            <div className="flex justify-end">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        size="sm"
                        onClick={handleStartShift}
                        disabled={isStartingShift || (isServiceProviderMember && accessibleOrgs.length > 1 && !shiftOrgId)}
                        className="shrink-0 bg-green-600 hover:bg-green-700 text-white font-semibold"
                      >
                        {isStartingShift
                          ? <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />{ot.officer.startingShift}</span>
                          : <><Clock className="h-4 w-4 mr-1.5" />{ot.officer.startShift}</>}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {isServiceProviderMember && accessibleOrgs.length > 1 && !shiftOrgId && (
                    <TooltipContent>Select an organisation above to start your shift</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      ) : (
        /* Shift active — show welfare countdown + I'm OK + End Shift */
        <div className={`rounded-xl border px-4 py-3 mb-4 transition-colors ${
          checkinState.isOverdue
            ? 'border-red-400 bg-red-50 dark:bg-red-950/30'
            : checkinState.isDueSoon5
              ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/30'
              : checkinState.isDueSoon10
                ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30'
                : 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-full ${
              checkinState.isOverdue
                ? 'bg-red-200 dark:bg-red-800'
                : checkinState.isDueSoon5
                  ? 'bg-orange-200 dark:bg-orange-800'
                  : checkinState.isDueSoon10
                    ? 'bg-yellow-200 dark:bg-yellow-800'
                    : 'bg-green-200 dark:bg-green-800'
            }`}>
              <Timer className={`h-4 w-4 ${
                checkinState.isOverdue
                  ? 'text-red-700 dark:text-red-300 animate-pulse'
                  : checkinState.isDueSoon5
                    ? 'text-orange-700 dark:text-orange-300 animate-pulse'
                    : checkinState.isDueSoon10
                      ? 'text-yellow-700 dark:text-yellow-300'
                      : 'text-green-700 dark:text-green-300'
              }`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-semibold ${
                  checkinState.isOverdue
                    ? 'text-red-800 dark:text-red-200'
                    : checkinState.isDueSoon5
                      ? 'text-orange-800 dark:text-orange-200'
                      : 'text-green-800 dark:text-green-200'
                }`}>
                  Shift Active
                </span>
                <Badge variant="outline" className="text-xs border-green-400 text-green-700 dark:text-green-300">
                  <Clock className="h-3 w-3 mr-1" />
                  {formatShiftDuration(activeShift.started_at)}
                </Badge>
                <Badge variant="outline" className="text-xs border-emerald-400 text-emerald-700 dark:text-emerald-300">
                  <Heart className="h-3 w-3 mr-1" />
                  Welfare On
                </Badge>
                {checkinState.isOverdue && (
                  <Badge className="text-xs bg-red-500 text-white animate-pulse border-0">
                    ⚠ Check-in OVERDUE
                  </Badge>
                )}
                {checkinState.isDueSoon5 && !checkinState.isOverdue && (
                  <Badge className="text-xs bg-orange-500 text-white border-0">
                    5 min warning
                  </Badge>
                )}
                {checkinState.isDueSoon10 && !checkinState.isDueSoon5 && !checkinState.isOverdue && (
                  <Badge className="text-xs bg-yellow-500 text-white border-0">
                    10 min warning
                  </Badge>
                )}
              </div>
              {/* Countdown timer */}
              {checkinState.intervalMinutes > 0 && (
                <p className={`text-[12px] font-mono font-semibold mt-0.5 ${
                  checkinState.isOverdue
                    ? 'text-red-700 dark:text-red-300'
                    : checkinState.isDueSoon5
                      ? 'text-orange-700 dark:text-orange-300'
                      : checkinState.isDueSoon10
                        ? 'text-yellow-700 dark:text-yellow-300'
                        : 'text-green-700 dark:text-green-300'
                }`}>
                  {checkinState.secondsUntilDue !== null
                    ? checkinState.secondsUntilDue < 0
                      ? `Overdue by ${Math.abs(Math.ceil(checkinState.secondsUntilDue / 60))}m ${Math.abs(checkinState.secondsUntilDue % 60)}s`
                      : (() => {
                          const s = checkinState.secondsUntilDue
                          const m = Math.floor(s / 60)
                          const sec = s % 60
                          return `Next check-in: ${m}:${String(sec).padStart(2, '0')}`
                        })()
                    : checkinState.lastCheckinAt
                      ? `Last: ${new Date(checkinState.lastCheckinAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: true })}`
                      : `Check in every ${checkinState.intervalMinutes}m to confirm you're safe`
                  }
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              {/* I'm OK button */}
              {checkinState.intervalMinutes > 0 && (
                <Button
                  size="sm"
                  onClick={checkIn}
                  disabled={checkinState.isSubmitting}
                  className={`font-semibold ${
                    checkinState.isOverdue
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : checkinState.isDueSoon5
                        ? 'bg-orange-600 hover:bg-orange-700 text-white'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  <CheckCircle className="h-4 w-4 mr-1.5" />
                  I'm OK
                </Button>
              )}
              {/* End Shift button */}
              <Button
                size="sm"
                variant="outline"
                onClick={handleEndShift}
                disabled={isEndingShift}
                className="text-xs border-gray-400 text-gray-700 dark:text-gray-300 hover:border-red-400 hover:text-red-600"
              >
                {isEndingShift ? ot.officer.endingShift : ot.officer.endShift}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unread high-priority notifications ───────────────────────── */}
      {unreadNotifications.length > 0 && (
        <div className="space-y-2 mb-4">
          {unreadNotifications.map((n: any) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                n.priority === 'urgent'
                  ? 'border-red-300 bg-red-50 dark:bg-red-950/30'
                  : 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30'
              }`}
            >
              <Bell className={`h-4 w-4 mt-0.5 shrink-0 ${n.priority === 'urgent' ? 'text-red-600 animate-pulse' : 'text-yellow-600'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{n.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-xs h-7 px-2"
                onClick={() => markNotificationRead(n.id)}
              >
                ✓ Read
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ── SOS / Panic Button ────────────────────────────────────────── */}
      {!scanMode && !showCheckpoint && !detailCameraOpen && (
        <div className="mb-4">
          <button
            type="button"
            onPointerDown={startSosHold}
            onPointerUp={cancelSosHold}
            onPointerLeave={cancelSosHold}
            className="w-full relative overflow-hidden rounded-xl border-2 border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800 h-14 flex items-center justify-center gap-3 select-none active:scale-[0.98] transition-transform"
            aria-label="SOS – Hold 3 seconds to send emergency alert"
          >
            {/* hold-progress fill */}
            {sosHoldProgress > 0 && (
              <div
                className="absolute inset-0 bg-red-500/20 transition-all"
                style={{ width: `${sosHoldProgress}%` }}
              />
            )}
            <Siren className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
            <span className="text-sm font-bold text-red-700 dark:text-red-300 relative z-10">
              {sosHoldProgress > 0 ? `Hold… ${Math.round(sosHoldProgress)}%` : 'SOS – Hold 3s to send emergency alert'}
            </span>
          </button>
        </div>
      )}

      {/* ── Service Type Selector ────────────────────────────────────── */}
      {!scanMode && !showCheckpoint && !detailCameraOpen && (
        <div className="mb-6">
          <h2 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isNightPatrol ? 'text-cyan-300' : 'text-gray-700 dark:text-gray-300'}`}>
            <Eye className="h-4 w-4" />
            Active Service
            {rosteredShift?.service_type && (
              <Badge variant="outline" className="ml-auto text-xs border-green-400 text-green-700 dark:text-green-300">
                Rostered: {rosteredShift.service_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
              </Badge>
            )}
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {(Object.entries(SERVICE_TYPE_CONFIG) as [ServiceType, typeof SERVICE_TYPE_CONFIG[ServiceType]][]).map(
              ([key, cfg]) => {
                const isActive = activeService === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveService(isActive ? null : key)}
                    aria-pressed={isActive}
                    className={`flex items-center gap-3 rounded-2xl border-2 px-3 py-4 text-left transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                      isActive
                        ? `${cfg.borderColor} ${cfg.bgColor} shadow-lg`
                        : 'border-gray-200/70 dark:border-gray-700/70 bg-white/60 dark:bg-white/5 hover:bg-white/90 dark:hover:bg-white/10'
                    }`}
                  >
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${isActive ? cfg.bgColor : 'bg-gray-100 dark:bg-gray-800'}`}>
                      <cfg.Icon className={`h-5 w-5 ${isActive ? cfg.color : 'text-gray-500 dark:text-gray-400'}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold leading-tight ${isActive ? cfg.color : 'text-gray-800 dark:text-gray-200'}`}>
                        {cfg.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                        {cfg.description}
                      </p>
                    </div>
                    {isActive && (
                      <CheckCircle className={`h-4 w-4 shrink-0 ${cfg.color}`} />
                    )}
                  </button>
                )
              }
            )}
          </div>
        </div>
      )}

      {/* ── BULK SCAN MODE — full screen ────────────────────────────── */}
      {scanMode === 'live' ? (
        /* ── LIVE PATROL CAMERA ─────────────────────────────────────── */
        <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ height: '100dvh' }}>
          <LivePatrolCamera
            recordGPSUpdate={recordGPSUpdate}
            onScanSaved={() => refetchScans()}
            onClose={() => setScanMode(null)}
          />
        </div>

      ) : scanMode === 'bulk' ? (
        <BulkScanSession
          recordGPSUpdate={recordGPSUpdate}
          orgWorkflow={orgWorkflow || 'admin_first'}
          onIssueAction={(p) => issueAction.mutate(p)}
          isIssuingAction={issueAction.isPending}
          onFinish={() => setScanMode(null)}
          onScanSaved={() => { refetchScans() }}
        />

      ) : showCheckpoint ? (
        /* ── CHECKPOINT CHECK-IN ────────────────────────────────────── */
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

      ) : detailCameraOpen ? (
        /* ── DETAIL SCAN — camera ───────────────────────────────────── */
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Vehicle Scanner</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowManualEntry(false); setManualPlate(''); setManualZoneId('') }}
                disabled={isProcessing || manualSubmitting}
              >
                Camera Capture
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowManualEntry(v => !v)}
                disabled={isProcessing || manualSubmitting}
              >
                Manual Entry
              </Button>
            </div>
          </div>

          {showManualEntry && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Manual Entry</CardTitle>
                <CardDescription>Use this fallback when camera capture is unavailable.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="manual-plate">Plate Number</Label>
                  <Input
                    id="manual-plate"
                    placeholder="Enter plate"
                    value={manualPlate}
                    onChange={(e) => setManualPlate(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    maxLength={8}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Zone</Label>
                  <Select value={manualZoneId} onValueChange={setManualZoneId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select zone" />
                    </SelectTrigger>
                    <SelectContent>
                      {manualZones.map((z) => (
                        <SelectItem key={z.zone_id} value={z.zone_id}>{z.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleManualEntrySubmit}
                    disabled={!manualPlate.trim() || !manualZoneId || manualSubmitting}
                  >
                    {manualSubmitting ? 'Submitting...' : 'Submit'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowManualEntry(false)
                      setManualPlate('')
                      setManualZoneId('')
                    }}
                    disabled={manualSubmitting}
                  >
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isProcessing && (
            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-3">
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                {scanProgressLabel}
              </span>
            </div>
          )}
          <div
            className="w-full rounded-xl overflow-hidden border border-gray-700 shadow-lg"
            style={{ height: isProcessing ? '65dvh' : '75dvh', minHeight: '300px' }}
          >
            <SplitScanCamera
              onCapture={handleDetailCapture}
              onCancel={() => { setDetailCameraOpen(false); setScanMode(null) }}
              isProcessing={isProcessing}
              statusLabel={scanProgressLabel}
            />
          </div>

        </div>

      ) : (
        /* ── PORTAL HOME ────────────────────────────────────────────── */
        <>
          {/* ── Offline sync status badge ────────────────────────── */}
          {pendingSyncCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 mb-3 text-sm text-amber-800 dark:text-amber-200">
              <Clock className="h-4 w-4 shrink-0" />
              <span>{pendingSyncCount} pending sync</span>
            </div>
          )}

          <OfficerFollowUpQueue
            onCountChange={setFollowUpCount}
            orgWorkflow={orgWorkflow || 'admin_first'}
            onIssueAction={(p) => issueAction.mutate(p)}
            isIssuingAction={issueAction.isPending}
            onActivity={() => {
              if (currentLocation?.latitude && currentLocation?.longitude) {
                recordGPSUpdate(currentLocation.latitude, currentLocation.longitude)
              }
            }}
          />

          {/* ═══════════════════════════════════════════════════════════
              FREEDOM CAMPING PATROL tools
              ═══════════════════════════════════════════════════════════ */}
          {activeService === 'freedom_camping' && (
            <>
              <h3 className="text-xs font-bold text-green-700 dark:text-green-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Tent className="h-3.5 w-3.5" />
                Freedom Camping Patrol
              </h3>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 mb-6">
                {/* ── Detail Scan ──────────────────────────────────── */}
                <button
                  type="button"
                  className="group flex items-center gap-4 rounded-2xl border-2 border-blue-300 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/30 px-4 py-4 text-left transition-all active:scale-[0.98] hover:shadow-lg hover:border-blue-400 dark:hover:border-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  onClick={() => {
                    if (!user?.id || !user?.organization_id) { toast.error('Session expired'); return }
                    const offline = !navigator.onLine
                    const noCamera = !navigator.mediaDevices?.getUserMedia
                    setScanMode('detail')
                    setDetailCameraOpen(true)
                    setShowManualEntry(offline || noCamera)
                    setManualPlate('')
                    setManualZoneId('')
                    setShowDetailPanel(false)
                    setDetailScanData(null)
                  }}
                >
                  <div className="h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 shadow-md">
                    <Search className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-blue-900 dark:text-blue-100 leading-tight">Scan Vehicle</p>
                    <p className="text-xs text-blue-600 dark:text-blue-300 mt-0.5 leading-snug">One vehicle — full detail, notes &amp; actions</p>
                  </div>
                </button>

                {/* ── Bulk Scan ────────────────────────────────────── */}
                <button
                  type="button"
                  className="group flex items-center gap-4 rounded-2xl border-2 border-yellow-300 dark:border-yellow-800 bg-yellow-50/80 dark:bg-yellow-950/30 px-4 py-4 text-left transition-all active:scale-[0.98] hover:shadow-lg hover:border-yellow-400 dark:hover:border-yellow-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                  onClick={() => {
                    if (!user?.id || !user?.organization_id) { toast.error('Session expired'); return }
                    if (!navigator.mediaDevices?.getUserMedia) { toast.error('Camera not available'); return }
                    setScanMode('bulk')
                  }}
                >
                  <div className="h-12 w-12 rounded-xl bg-yellow-500 flex items-center justify-center shrink-0 shadow-md">
                    <Zap className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-yellow-900 dark:text-yellow-100 leading-tight">Bulk Scan</p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-0.5 leading-snug">Area sweep — multiple vehicles fast</p>
                  </div>
                </button>

                {/* ── Live Patrol ──────────────────────────────────── */}
                <button
                  type="button"
                  className="group flex items-center gap-4 rounded-2xl border-2 border-green-300 dark:border-green-800 bg-green-50/80 dark:bg-green-950/30 px-4 py-4 text-left transition-all active:scale-[0.98] hover:shadow-lg hover:border-green-400 dark:hover:border-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 sm:col-span-1 col-span-1"
                  onClick={() => {
                    if (!user?.id || !user?.organization_id) { toast.error('Session expired'); return }
                    if (!navigator.mediaDevices?.getUserMedia) { toast.error('Camera not available'); return }
                    setScanMode('live')
                  }}
                >
                  <div className="h-12 w-12 rounded-xl bg-green-600 flex items-center justify-center shrink-0 shadow-md">
                    <Video className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-green-900 dark:text-green-100 leading-tight">Live Patrol</p>
                    <p className="text-xs text-green-700 dark:text-green-300 mt-0.5 leading-snug">Auto-scan as you drive</p>
                  </div>
                </button>
              </div>
            </>
          )}
          {/* ═══════════════════════════════════════════════════════════
              GUARDING tools
              ═══════════════════════════════════════════════════════════ */}
          {activeService === 'guarding' && (
            <>
              <h3 className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" />
                Guarding
              </h3>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-6">
                {/* Checkpoint */}
                <button
                  type="button"
                  className="flex items-center gap-4 rounded-2xl border-2 border-indigo-300 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/30 px-4 py-4 text-left transition-all active:scale-[0.98] hover:shadow-lg hover:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  onClick={() => setShowCheckpoint(true)}
                >
                  <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-md">
                    <QrCode className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-indigo-900 dark:text-indigo-100">Checkpoint</p>
                      <Badge variant="outline" className="text-[10px] border-indigo-300 text-indigo-600">Lone Worker</Badge>
                    </div>
                    <p className="text-xs text-indigo-600 dark:text-indigo-300 mt-0.5">Scan QR/NFC at patrol checkpoint</p>
                  </div>
                </button>

                {/* Active Patrol */}
                <button
                  type="button"
                  className="flex items-center gap-4 rounded-2xl border-2 border-green-300 dark:border-green-800 bg-green-50/80 dark:bg-green-950/30 px-4 py-4 text-left transition-all active:scale-[0.98] hover:shadow-lg hover:border-green-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
                  onClick={() => navigate('/live-patrol')}
                >
                  <div className="h-12 w-12 rounded-xl bg-green-600 flex items-center justify-center shrink-0 shadow-md">
                    <Map className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-green-900 dark:text-green-100">Active Patrol</p>
                    <p className="text-xs text-green-600 dark:text-green-300 mt-0.5">Manage your patrol session</p>
                  </div>
                </button>

                {/* Face Recognition */}
                <button
                  type="button"
                  className="flex items-center gap-4 rounded-2xl border-2 border-purple-300 dark:border-purple-800 bg-purple-50/80 dark:bg-purple-950/30 px-4 py-4 text-left transition-all active:scale-[0.98] hover:shadow-lg hover:border-purple-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                  onClick={() => navigate('/face-recognition')}
                >
                  <div className="h-12 w-12 rounded-xl bg-purple-600 flex items-center justify-center shrink-0 shadow-md">
                    <ScanFace className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-purple-900 dark:text-purple-100">Face Recognition</p>
                    <p className="text-xs text-purple-600 dark:text-purple-300 mt-0.5">POI detection &amp; trespass matching</p>
                  </div>
                </button>

                {/* Person Records */}
                <button
                  type="button"
                  className="flex items-center gap-4 rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-4 text-left transition-all active:scale-[0.98] hover:shadow-lg hover:border-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  onClick={() => navigate('/person-records')}
                >
                  <div className="h-12 w-12 rounded-xl bg-amber-600 flex items-center justify-center shrink-0 shadow-md">
                    <Users className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-amber-900 dark:text-amber-100">Person Records</p>
                    <p className="text-xs text-amber-600 dark:text-amber-300 mt-0.5">Persons of interest &amp; observations</p>
                  </div>
                </button>

                {/* Create Report */}
                <button
                  type="button"
                  className="flex items-center gap-4 rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 px-4 py-4 text-left transition-all active:scale-[0.98] hover:shadow-lg hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  onClick={handleOpenQuickReport}
                >
                  <div className="h-12 w-12 rounded-xl bg-slate-700 flex items-center justify-center shrink-0 shadow-md">
                    <PlusCircle className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-slate-900 dark:text-slate-100">New Report</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">H&amp;S, incident or maintenance</p>
                  </div>
                </button>

                {/* VOI Lookup */}
                <div className="rounded-2xl border-2 border-blue-300 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/30 px-4 py-4 md:col-span-2 lg:col-span-3">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 shadow-md">
                      <Car className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">Vehicle of Interest Check</p>
                      <p className="text-xs text-blue-600 dark:text-blue-300">Search flagged / banned vehicles — no geofence required</p>
                    </div>
                    <Badge variant="outline" className="ml-auto text-xs border-blue-300 text-blue-600">Anywhere</Badge>
                  </div>
                  <VOILookup inline />
                </div>

                {/* POI — only when rostered and on shift */}
                {rosteredShift && (
                  <button
                    type="button"
                    className="flex items-center gap-4 rounded-2xl border-2 border-orange-300 dark:border-orange-800 bg-orange-50/80 dark:bg-orange-950/30 px-4 py-4 text-left transition-all active:scale-[0.98] hover:shadow-lg hover:border-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                    onClick={() => {
                      if (rosteredShift.client_site_id) {
                        navigate(`/site-guard?site=${rosteredShift.client_site_id}&roster=${rosteredShift.id}`)
                      } else {
                        navigate('/points-of-interest')
                      }
                    }}
                  >
                    <div className="h-12 w-12 rounded-xl bg-orange-600 flex items-center justify-center shrink-0 shadow-md">
                      <Lock className="h-6 w-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-base font-semibold text-orange-900 dark:text-orange-100">Persons of Interest</p>
                        <Badge variant="outline" className="text-[10px] border-green-400 text-green-700 dark:text-green-400">Rostered</Badge>
                      </div>
                      <p className="text-xs text-orange-600 dark:text-orange-300 mt-0.5">
                        {rosteredShift.client_site_id ? 'Site POI — geofence gated' : 'Org-wide POI — geofence gated'}
                      </p>
                    </div>
                  </button>
                )}
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              PARKING ENFORCEMENT tools
              ═══════════════════════════════════════════════════════════ */}
          {activeService === 'parking' && (
            <>
              <h3 className="text-xs font-bold text-orange-700 dark:text-orange-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ParkingSquare className="h-3.5 w-3.5" />
                Parking Enforcement
              </h3>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 mb-6">
                <button
                  onClick={() => navigate('/parking-officer')}
                  className="flex items-center gap-4 w-full rounded-2xl border-2 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/40 p-4 text-left hover:border-orange-400 hover:shadow-md active:scale-[0.97] transition-all"
                >
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shrink-0">
                    <ParkingSquare className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-orange-800 dark:text-orange-200">Parking Enforcement</p>
                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">Chalk pass · Recheck · Infringement</p>
                  </div>
                </button>
                <button
                  onClick={() => navigate('/infringements')}
                  className="flex items-center gap-4 w-full rounded-2xl border-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-left hover:border-red-400 hover:shadow-md active:scale-[0.97] transition-all"
                >
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center shrink-0">
                    <Shield className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-red-800 dark:text-red-200">Infringement Notices</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Issue fines on-site</p>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              NOISE CONTROL tools
              ═══════════════════════════════════════════════════════════ */}
          {activeService === 'noise' && (
            <>
              <h3 className="text-xs font-bold text-yellow-700 dark:text-yellow-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5" />
                Noise Control
              </h3>
              <div className="grid gap-3 grid-cols-1 mb-6">
                <button
                  onClick={() => navigate('/noise-officer')}
                  className="flex items-center gap-4 w-full rounded-2xl border-2 border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/40 p-4 text-left hover:border-yellow-400 hover:shadow-md active:scale-[0.97] transition-all"
                >
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shrink-0">
                    <Volume2 className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-yellow-800 dark:text-yellow-200">Noise Control</p>
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-0.5">Jobs · AN / DN / END · Seizures</p>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              BIOSECURITY INSPECTION tools
              ═══════════════════════════════════════════════════════════ */}
          {activeService === 'biosecurity_inspection' && (
            <>
              <h3 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Leaf className="h-3.5 w-3.5" />
                Biosecurity Inspection
              </h3>
              <div className="grid gap-3 grid-cols-1 mb-6">
                <button
                  onClick={() => navigate('/biosecurity-officer')}
                  className="flex items-center gap-4 w-full rounded-2xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-left hover:border-emerald-400 hover:shadow-md active:scale-[0.97] transition-all"
                >
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shrink-0">
                    <Leaf className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-emerald-800 dark:text-emerald-200">Biosecurity (CNG)</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Plant ID · RPMP · Notices · Bob</p>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              SMOKE COMPLAINT OOH tools
              ═══════════════════════════════════════════════════════════ */}
          {activeService === 'smoke_complaint_ooh' && (
            <>
              <h3 className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Wind className="h-3.5 w-3.5" />
                Smoke Complaint (OOH)
              </h3>
              <div className="grid gap-3 grid-cols-1 mb-6">
                <button
                  onClick={() => navigate('/smoke-officer')}
                  className="flex items-center gap-4 w-full rounded-2xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 text-left hover:border-amber-400 hover:shadow-md active:scale-[0.97] transition-all"
                >
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0">
                    <Wind className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-amber-800 dark:text-amber-200">Smoke Complaint (OOH)</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">OOH · Opacity · Materials · RMA s.17A</p>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              COMMON TOOLS — always visible (shared across all services)
              ═══════════════════════════════════════════════════════════ */}
          {!activeService && (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 mb-6">
              <button
                onClick={() => setShowCheckpoint(true)}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 p-4 text-left hover:border-indigo-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shrink-0">
                  <QrCode className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-indigo-800 dark:text-indigo-200">Checkpoint</p>
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">Scan QR/NFC at patrol checkpoint</p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">Lone Worker</Badge>
              </button>

              <button
                onClick={() => navigate('/live-patrol')}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-4 text-left hover:border-green-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shrink-0">
                  <Map className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-green-800 dark:text-green-200">Active Patrol</p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Manage your patrol session</p>
                </div>
              </button>

              <button
                onClick={handleOpenQuickReport}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 p-4 text-left hover:border-purple-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shrink-0">
                  <PlusCircle className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-purple-800 dark:text-purple-200">New Quick Report</p>
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">H&amp;S, incident or maintenance</p>
                </div>
              </button>

              <button
                onClick={handleViewHistory}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/40 p-4 text-left hover:border-orange-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shrink-0">
                  <History className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-orange-800 dark:text-orange-200">My Scans</p>
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">{user?.role === 'officer' ? 'View 24h History' : 'View History'}</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/breaches')}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-left hover:border-red-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-red-800 dark:text-red-200">Breach Alerts</p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Active notifications</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/zones')}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 p-4 text-left hover:border-teal-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shrink-0">
                  <MapPin className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-teal-800 dark:text-teal-200">Zones</p>
                  <p className="text-xs text-teal-600 dark:text-teal-400 mt-0.5">Enforcement zones</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/infringements')}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-left hover:border-red-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shrink-0">
                  <Shield className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-red-800 dark:text-red-200">Infringement Notices</p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Issue fines on-site</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/parking-officer')}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/40 p-4 text-left hover:border-orange-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shrink-0">
                  <ParkingSquare className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-orange-800 dark:text-orange-200">Parking Enforcement</p>
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">Chalk pass · Recheck · Infringement</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/noise-officer')}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/40 p-4 text-left hover:border-yellow-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shrink-0">
                  <Volume2 className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-yellow-800 dark:text-yellow-200">Noise Control</p>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-0.5">Jobs · AN / DN / END · Seizures</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/biosecurity-officer')}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-left hover:border-emerald-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shrink-0">
                  <Leaf className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-emerald-800 dark:text-emerald-200">Biosecurity (CNG)</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Plant ID · RPMP · Bob</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/smoke-officer')}
                className="flex items-center gap-4 w-full rounded-2xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 text-left hover:border-amber-400 hover:shadow-md active:scale-[0.97] transition-all"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0">
                  <Wind className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-amber-800 dark:text-amber-200">Smoke Complaint (OOH)</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Opacity · Materials · RMA s.17A</p>
                </div>
              </button>
            </div>
          )}

            {/* ── Active Route Execution (officer-side) ─────────────── */}
            {(activeRouteLoading || activeRouteInstance) && (
              <div className="mb-6 space-y-3">
                <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Map className="h-4 w-4 text-green-600" />
                  Route Execution
                  {activeRouteInstance && (
                    <Badge variant="outline" className="ml-1 text-xs capitalize">
                      {activeRouteInstance.plan_status.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </h2>

                <Card className="border-green-200 dark:border-green-900/60">
                  <CardContent className="p-4 space-y-3">
                    {activeRouteLoading && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading your active route...
                      </div>
                    )}

                    {!activeRouteLoading && activeRouteInstance && (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">
                              {activeRouteInstance.patrol_route_name || 'Patrol Route'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Mode: {activeRouteInstance.planning_mode.replace(/_/g, ' ')}
                            </p>
                          </div>
                          <Badge className="text-xs" variant="secondary">
                            {activeRouteCompletedStops}/{activeRouteTotalStops} complete
                          </Badge>
                        </div>

                        {activeRouteCurrentStop ? (
                          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium">
                                Stop #{activeRouteCurrentStop.sequence_no}: {activeRouteCurrentStop.stop_name}
                              </p>
                              {activeRouteCurrentStop.is_mandatory && (
                                <Badge variant="outline" className="text-[10px]">Mandatory</Badge>
                              )}
                            </div>

                            {activeRouteCurrentStop.planned_arrival_window_start && (
                              <p className="text-xs text-muted-foreground">
                                Window: {formatDateTime(activeRouteCurrentStop.planned_arrival_window_start)}
                              </p>
                            )}

                            <div className="flex flex-wrap gap-2">
                              {activeRouteCurrentStop.visit_status === 'pending' && (
                                <Button
                                  size="sm"
                                  onClick={() => updateRouteStopStatus.mutate({
                                    stopId: activeRouteCurrentStop.id,
                                    routeInstanceId: activeRouteCurrentStop.route_instance_id,
                                    status: 'arrived',
                                    source: 'manual',
                                  })}
                                  disabled={updateRouteStopStatus.isPending}
                                >
                                  Arrived
                                </Button>
                              )}

                              {(activeRouteCurrentStop.visit_status === 'pending' || activeRouteCurrentStop.visit_status === 'arrived') && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => updateRouteStopStatus.mutate({
                                    stopId: activeRouteCurrentStop.id,
                                    routeInstanceId: activeRouteCurrentStop.route_instance_id,
                                    status: 'completed',
                                    source: 'manual',
                                  })}
                                  disabled={updateRouteStopStatus.isPending}
                                >
                                  Complete Stop
                                </Button>
                              )}
                            </div>

                            {activeRouteCurrentStop.zone_id && (
                              <p className="text-[11px] text-muted-foreground">
                                Auto-routing active: entering stop zone marks Arrived, and exiting after dwell marks Complete.
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No pending stops remain on this route instance.</p>
                        )}

                        {activeRouteStopsLoading && (
                          <p className="text-xs text-muted-foreground">Refreshing stop list...</p>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {(speechActivityTarget || speechIntent.result || speechIntent.error) && (
              <Card className="mb-6 border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Mic className="h-4 w-4 text-blue-600" />
                    Officer Activity Capture
                  </CardTitle>
                  <CardDescription>
                    Voice-driven activity capture enriches the active dispatch or patrol context without overwriting authoritative lifecycle data.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className="border-blue-300 text-blue-700 dark:text-blue-300">
                      Assistive enrichment
                    </Badge>
                    {speechActivityTarget && (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300">
                        Target: {speechActivityTarget.label}
                      </Badge>
                    )}
                    {speechActivityTarget?.rapidReference && (
                      <Badge variant="outline" className="border-sky-300 text-sky-700 dark:text-sky-300">
                        Rapid ref: {speechActivityTarget.rapidReference}
                      </Badge>
                    )}
                    <Badge variant="outline" className="capitalize">
                      {speechIntent.state.replace(/_/g, ' ')}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (speechIntent.state === 'listening') {
                          speechIntent.stopListening()
                          return
                        }
                        speechIntent.reset()
                        void speechIntent.startListening()
                      }}
                      disabled={!speechActivityTarget || speechIntent.state === 'processing'}
                    >
                      {speechIntent.state === 'processing' ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          Processing…
                        </>
                      ) : speechIntent.state === 'listening' ? (
                        <>
                          <Mic className="h-4 w-4 mr-1.5" />
                          Stop capture
                        </>
                      ) : (
                        <>
                          <Mic className="h-4 w-4 mr-1.5" />
                          Record activity
                        </>
                      )}
                    </Button>

                    {(speechIntent.result || speechIntent.error) && (
                      <Button size="sm" variant="outline" onClick={speechIntent.reset}>
                        Clear
                      </Button>
                    )}
                  </div>

                  {!speechActivityTarget && (
                    <p className="text-xs text-muted-foreground">
                      Start a patrol route or take a dispatch job to attach speech enrichment to an active operational record.
                    </p>
                  )}

                  {speechIntent.error && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                      {speechIntent.error}
                    </div>
                  )}

                  {speechIntent.result && (
                    <div className="rounded-lg border border-blue-200 bg-white/80 dark:border-blue-900 dark:bg-slate-950/40 p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline">{speechIntent.result.intent.intent}</Badge>
                        <Badge variant="outline">
                          {Math.round(speechIntent.result.intent.confidence * 100)}% confidence
                        </Badge>
                        {speechIntent.result.intent.needs_confirmation && (
                          <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
                            Needs confirmation
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {speechIntent.result.intent.summary || 'No summary returned'}
                      </p>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {speechIntent.result.transcript}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Dispatched Job Queue (GDS CATS-style) ──────────────── */}
            {myDispatchJobs.length > 0 && (
              <div className="mb-6 space-y-3">
                <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Siren className="h-4 w-4 text-blue-600" />
                  Dispatched Jobs
                  <Badge className="ml-1">{myDispatchJobs.length}</Badge>
                </h2>
                {(myDispatchJobs as any[]).map((job: any) => {
                  const NEXT: Record<string, { label: string; next: string }> = {
                    dispatched:   { label: 'Acknowledge',  next: 'acknowledged' },
                    acknowledged: { label: 'En Route',     next: 'en_route'     },
                    en_route:     { label: 'On Scene',     next: 'on_scene'     },
                    on_scene:     { label: 'Complete Job', next: 'completed'    },
                  }
                  const action = NEXT[job.status]
                  const urgentBorder = job.priority === 'urgent' ? 'border-red-400' : job.priority === 'high' ? 'border-orange-300' : 'border-blue-200'
                  return (
                    <Card key={job.id} className={`border-l-4 ${urgentBorder}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-mono text-xs text-muted-foreground">{job.job_number}</span>
                              <Badge variant="outline" className={`text-xs ${job.priority === 'urgent' ? 'border-red-400 text-red-700 animate-pulse' : 'border-blue-300 text-blue-700'}`}>
                                {(job.priority ?? 'normal').toUpperCase()}
                              </Badge>
                              <Badge variant="outline" className="text-xs capitalize">{job.status.replaceAll('_', ' ')}</Badge>
                            </div>
                            <p className="font-semibold text-sm">{job.title}</p>
                            {job.address && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <MapPin className="h-3 w-3" />{job.address}
                              </p>
                            )}
                            {job.caller_phone && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <PhoneCall className="h-3 w-3" />{job.caller_phone}
                              </p>
                            )}
                          </div>
                          {action && (
                            <Button
                              size="sm"
                              className="shrink-0"
                              onClick={() => {
                                if (action.next === 'completed') {
                                  completeDispatchJob.mutate({ dispatchJobId: job.id })
                                  return
                                }
                                advanceJobStatus.mutate({ jobId: job.id, newStatus: action.next })
                              }}
                              disabled={advanceJobStatus.isPending || completeDispatchJob.isPending}
                            >
                              {action.label}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}

          {/* Service-specific common tools */}
          {activeService && (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 mb-6">
              {/* My Scans — shown for freedom_camping and guarding */}
              {(activeService === 'freedom_camping' || activeService === 'guarding') && (
                <button
                  onClick={handleViewHistory}
                  className="flex items-center gap-4 w-full rounded-2xl border-2 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/40 p-4 text-left hover:border-orange-400 hover:shadow-md active:scale-[0.97] transition-all"
                >
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shrink-0">
                    <History className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-orange-800 dark:text-orange-200">My Scans</p>
                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">{user?.role === 'officer' ? 'View 24h History' : 'View History'}</p>
                  </div>
                </button>
              )}

              {/* Breach Alerts — shown for freedom_camping */}
              {activeService === 'freedom_camping' && (
                <>
                  <button
                    onClick={() => navigate('/breaches')}
                    className="flex items-center gap-4 w-full rounded-2xl border-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-left hover:border-red-400 hover:shadow-md active:scale-[0.97] transition-all"
                  >
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center shrink-0">
                      <AlertTriangle className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-red-800 dark:text-red-200">Breach Alerts</p>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Active notifications</p>
                    </div>
                  </button>
                  <button
                    onClick={() => navigate('/zones')}
                    className="flex items-center gap-4 w-full rounded-2xl border-2 border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 p-4 text-left hover:border-teal-400 hover:shadow-md active:scale-[0.97] transition-all"
                  >
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shrink-0">
                      <MapPin className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-teal-800 dark:text-teal-200">Zones</p>
                      <p className="text-xs text-teal-600 dark:text-teal-400 mt-0.5">Enforcement zones</p>
                    </div>
                  </button>
                  <button
                    onClick={() => navigate('/infringements')}
                    className="flex items-center gap-4 w-full rounded-2xl border-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-left hover:border-red-400 hover:shadow-md active:scale-[0.97] transition-all"
                  >
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shrink-0">
                      <Shield className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-red-800 dark:text-red-200">Infringement Notices</p>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Issue fines on-site</p>
                    </div>
                  </button>
                </>
              )}

              {/* Create Report — shown for guarding */}
              {activeService === 'guarding' && (
                <button
                  onClick={handleOpenQuickReport}
                  className="flex items-center gap-4 w-full rounded-2xl border-2 border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 p-4 text-left hover:border-purple-400 hover:shadow-md active:scale-[0.97] transition-all"
                >
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shrink-0">
                    <PlusCircle className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-purple-800 dark:text-purple-200">Create Report</p>
                    <p className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">H&amp;S, incident or maintenance</p>
                  </div>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Location Authorization Status */}
      {scanMode !== 'bulk' && currentLocation && user?.organization_id && (
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
              <span className="font-medium text-right truncate max-w-[60%]">
                {accessibleOrgs.find(o => o.id === (activeShift?.organization_id ?? employerOrganizationId))?.name
                  ?? user?.organization_id?.substring(0, 8) + '…'}
              </span>
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
      {scanMode !== 'bulk' && !showCheckpoint && !detailCameraOpen && recentScans.length > 0 && (
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
              const isManualRequired = scan.plate_number === 'MANUAL_REQUIRED'
              const isProcessingAI = scan.plate_number === 'PROCESSING...' || isManualRequired
              const inBreach = scan.is_compliant === false && !isProcessingAI
              const vehicle = scan.vehicle as any
              const homelessStatus = vehicle?.homeless_status
              const isHomelessExempt = homelessStatus === 'confirmed' || homelessStatus === 'claimed'
              return (
                <div
                  key={scan.id}
                  className={`flex items-center gap-3 rounded-lg border p-2.5 ${
                    isManualRequired
                      ? 'border-orange-300 bg-orange-50 dark:bg-orange-950/20'
                      : inBreach
                      ? 'border-red-200 bg-red-50 dark:bg-red-950/30'
                      : 'border-gray-100 bg-white dark:bg-slate-900'
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
                        {isManualRequired
                          ? <span className="text-orange-600">⚠ Enter Plate</span>
                          : scan.plate_number === 'PROCESSING...'
                          ? '⏳ Scanning...'
                          : (scan.plate_number || '—')}
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
                      {isHomelessExempt && (
                        <Badge className="bg-purple-600 text-white text-[10px] px-1.5 py-0">
                          <Home className="h-2.5 w-2.5 mr-1" />
                          {homelessStatus === 'confirmed' ? 'Confirmed Homeless' : 'Homeless Claimed'}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {scan.zone?.name} · {formatDateTime(scan.recorded_at)}
                    </div>
                  </div>

                  {/* Manual entry — show edit button */}
                  {isManualRequired && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px] border-orange-400 text-orange-700 hover:bg-orange-50"
                        onClick={() => navigate(`/observation-records?observation_id=${encodeURIComponent(scan.id)}`)}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Edit Plate
                      </Button>
                    </div>
                  )}

                  {/* Enforcement action buttons — only shown for breach + AI complete */}
                  {inBreach && (
                    <div className="flex gap-1 shrink-0">
                      {/* Warning: only in officer_direct or hybrid — admin_first handles enforcement server-side */}
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
                          Warn
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
                          Vacate
                        </Button>
                      )}

                      {/* Admin First: reported badge */}
                      {(!orgWorkflow || orgWorkflow === 'admin_first') && (
                        <Badge variant="secondary" className="text-[10px]">
                          <Shield className="h-2.5 w-2.5 mr-1" />
                          Reported
                        </Badge>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px] border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => navigate(`/infringements?observation_id=${encodeURIComponent(scan.id)}`)}
                      >
                        <Printer className="h-3 w-3 mr-1" />
                        Ticket
                      </Button>
                    </div>
                  )}

                  {/* Compliant: green tick only */}
                  {!inBreach && !isProcessingAI && (
                    <div className="flex items-center gap-1 shrink-0">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}



      {/* ── Detail Scan result panel (bottom Sheet) ──────────────────── */}
      <ScanDetailPanel
        open={showDetailPanel}
        onClose={() => {
          setShowDetailPanel(false)
          setScanMode(null)
        }}
        initialData={detailScanData}
        orgWorkflow={orgWorkflow || 'admin_first'}
        onIssueAction={(p) => issueAction.mutate(p)}
        isIssuingAction={issueAction.isPending}
        onActivity={() => {
          if (currentLocation?.latitude && currentLocation?.longitude) {
            recordGPSUpdate(currentLocation.latitude, currentLocation.longitude)
          }
        }}
      />

      {/* ── Quick Standalone Report Modal ─────────────────────────────── */}
      <Dialog open={showQuickReport} onOpenChange={setShowQuickReport}>
        <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-purple-600" />
              New Report
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {/* Report type selector */}
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'incident',    label: 'Incident',    Icon: AlertTriangle, color: 'border-orange-400 text-orange-700 bg-orange-50' },
                { key: 'hs',         label: 'H&S',         Icon: ShieldAlert,   color: 'border-red-400 text-red-700 bg-red-50' },
                { key: 'maintenance', label: 'Maintenance', Icon: Wrench,        color: 'border-blue-400 text-blue-700 bg-blue-50' },
              ] as const).map(({ key, label, Icon, color }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setQRReportType(key)}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2.5 text-xs font-medium transition-colors ${
                    qrReportType === key
                      ? color
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* Incident type (not for maintenance) */}
            {qrReportType !== 'maintenance' && (
              <div className="space-y-1">
                <Label className="text-xs">Incident Type</Label>
                <Select value={qrIncidentType} onValueChange={setQRIncidentType}>
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue placeholder="Select incident type" />
                  </SelectTrigger>
                  <SelectContent>
                    {qrReportType === 'hs' ? (
                      <>
                        <SelectItem value="threatening_behaviour">Threatening Behaviour</SelectItem>
                        <SelectItem value="medical_emergency">Medical Emergency</SelectItem>
                        <SelectItem value="property_damage">Property Damage</SelectItem>
                        <SelectItem value="welfare_concern">Welfare Concern</SelectItem>
                        <SelectItem value="hazard">Hazard / Safety Risk</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="general_incident">General Incident</SelectItem>
                        <SelectItem value="breach_of_rules">Breach of Rules</SelectItem>
                        <SelectItem value="threatening_behaviour">Threatening Behaviour</SelectItem>
                        <SelectItem value="noise_complaint">Noise Complaint</SelectItem>
                        <SelectItem value="vehicle_accident">Vehicle Accident</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Severity */}
            <div className="space-y-1">
              <Label className="text-xs">Severity</Label>
              <Select value={qrSeverity} onValueChange={v => setQRSeverity(v as 'low'|'medium'|'high'|'critical')}>
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High — admin notified</SelectItem>
                  <SelectItem value="critical">Critical — immediate attention</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label className="text-xs">Description <span className="text-red-500">*</span></Label>
              <Textarea
                value={qrDescription}
                onChange={e => setQRDescription(e.target.value)}
                rows={4}
                className="resize-none text-sm"
                placeholder={
                  qrReportType === 'maintenance'
                    ? 'Describe the maintenance issue, location, and urgency'
                    : 'Describe what happened — who, what, where, and any risk'
                }
              />
            </div>

            {/* Action taken */}
            <div className="space-y-1">
              <Label className="text-xs">Action Taken</Label>
              <Textarea
                value={qrActionTaken}
                onChange={e => setQRActionTaken(e.target.value)}
                rows={2}
                className="resize-none text-sm"
                placeholder="Immediate action taken (police called, area secured, etc.)"
              />
            </div>

            {/* Vehicle plate (optional) */}
            <div className="space-y-1">
              <Label className="text-xs">Linked Vehicle Plate (optional)</Label>
              <Input
                value={qrVehiclePlate}
                onChange={e => setQRVehiclePlate(e.target.value.toUpperCase())}
                placeholder="e.g. ABC123"
                className="h-9 text-sm font-mono"
              />
            </div>

            {/* Location (auto-filled, editable) */}
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                Location (auto-filled from GPS)
              </Label>
              <Input
                value={qrLocationAddress}
                onChange={e => setQRLocationAddress(e.target.value)}
                placeholder="Street address or description"
                className="h-9 text-sm"
              />
              {zoneName && (
                <p className="text-[10px] text-muted-foreground">
                  Zone: {zoneName}
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowQuickReport(false)}
                disabled={isSubmittingReport}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={isSubmittingReport || !qrDescription.trim()}
                onClick={handleSubmitQuickReport}
              >
                {isSubmittingReport
                  ? <><span className="animate-spin mr-2">⏳</span>Submitting…</>
                  : 'Submit Report'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
