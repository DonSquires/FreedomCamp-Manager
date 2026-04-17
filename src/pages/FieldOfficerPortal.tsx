import { useState, useEffect, useCallback, useRef } from 'react'
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
import { useRosteredShift } from '@/hooks/useRosteredShift'
import { useShiftGate } from '@/hooks/useShiftGate'
import { GeofenceWarningBanner } from '@/components/features/GeofenceWarningBanner'
import { reverseGeocode } from '@/lib/geocoding'
import { useThemePreferencesStore } from '@/stores/themePreferencesStore'
import {
  Camera, Map, FileText, History, AlertTriangle, MapPin, QrCode,
  ShieldAlert, CheckCircle, Shield, Megaphone, FileWarning, XCircle,
  Clock, Home, X, Car, Zap, Search, Printer, PlusCircle, Wrench, Heart, Users,
  Moon, Sun, ParkingSquare, Volume2, Video, Eye, Tent, Timer,
  ScanFace, CalendarPlus, Siren, Bell, PhoneCall, Lock, Leaf, Wind,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { formatDateTime } from '@/lib/utils'
import { publishEmergencyAssistRequest } from '@/lib/emergencyAssistBridge'
import { useOfflineQueue, useOfflineQueueStats } from '@/hooks/useOfflineQueue'
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
type ZoneOption = { zone_id: string; name: string }
type ZoneRow = Pick<Database['public']['Tables']['zones']['Row'], 'id' | 'name'>

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
  const { themeMode, setThemeMode } = useThemePreferencesStore()
  const isNightPatrol = themeMode === 'night-patrol'
  const employerOrganizationId = user?.employer_organization_id || user?.organization_id || null

  // ── Roster context ────────────────────────────────────────────────────────
  const { rosteredShift } = useRosteredShift()

  // ── Shift gate: redirect to /officer-home if not rostered ─────────────────
  const { gateApplies, canAccessPortal, canUseFeature, geofenceViolation, isLoading: gateLoading } = useShiftGate()
  useEffect(() => {
    if (!gateLoading && gateApplies && (!canAccessPortal || !canUseFeature('freedom_camping'))) {
      navigate('/officer-home', { replace: true })
    }
  }, [gateApplies, canAccessPortal, canUseFeature, gateLoading, navigate])

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

      await supabase.from('officer_welfare_alerts').insert({
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
  const { data: accessibleOrgs = [] } = useQuery({
    queryKey: ['accessible-orgs-for-shift', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const orgIds = new Set<string>()
      if (employerOrganizationId) orgIds.add(employerOrganizationId)
      if (user.organization_id) orgIds.add(user.organization_id)
      user.authorized_work_locations?.forEach(id => orgIds.add(id))
      user.extra_organization_ids?.forEach(id => orgIds.add(id))

      if (orgIds.size === 0) return []

      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, organization_type')
        .in('id', Array.from(orgIds))
        .eq('is_active', true)
        .order('name')

      if (error) return []
      return data as { id: string; name: string; organization_type: string }[]
    },
    enabled: !!user?.id && isServiceProviderMember,
    staleTime: 5 * 60_000,
  })

  // Fetch zones for the selected shift organization
  const { data: shiftZones = [] } = useQuery({
    queryKey: ['shift-zones', shiftOrgId],
    queryFn: async () => {
      if (!shiftOrgId) return []
      const { data, error } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', shiftOrgId)
        .eq('is_active', true)
        .order('name')

      if (error) return []
      return data as { id: string; name: string }[]
    },
    enabled: !!shiftOrgId,
    staleTime: 5 * 60_000,
  })

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
  const { data: unreadNotifications = [] } = useQuery({
    queryKey: ['officer-unread-notifications', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data } = await supabase
        .from('notifications')
        .select('id, title, body, priority, created_at')
        .eq('user_id', user.id)
        .eq('read', false)
        .in('priority', ['high', 'urgent'])
        .order('created_at', { ascending: false })
        .limit(5)
      return data ?? []
    },
    enabled: !!user?.id,
    refetchInterval: 60_000,
  })

  async function markNotificationRead(notifId: string) {
    await supabase.from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', notifId)
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
      if (newStatus === 'completed')    update.completed_at    = new Date().toISOString()
      const { error } = await (supabase as any).from('dispatch_jobs').update(update).eq('id', jobId)
      if (error) throw error
    },
    onSuccess: () => { qcHook.invalidateQueries({ queryKey: ['my-dispatch-jobs'] }) },
    onError: (err: any) => toast.error(err?.message ?? 'Update failed'),
  })

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
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
  })

  // ── Zones for manual fallback entry ───────────────────────────────────────
  const { data: manualZones = [] } = useQuery({
    queryKey: ['manual-zones', user?.organization_id],
    queryFn: async () => {
      if (!user?.organization_id) return []

      const fetchOrgScoped = async () => {
        const { data, error } = await supabase
          .from('zones')
          .select('id, name')
          .eq('organization_id', user.organization_id)
          .order('name', { ascending: true })
        if (error) return []
        return ((data ?? []) as ZoneRow[]).map((z): ZoneOption => ({ zone_id: z.id, name: z.name }))
      }

      const orgZones = await fetchOrgScoped()
      if (orgZones.length > 0) return orgZones

      // Fallback: under RLS this still returns only zones visible to the user.
      const { data: fallback, error: fallbackError } = await supabase
        .from('zones')
        .select('id, name')
        .order('name', { ascending: true })
        .limit(50)
      if (fallbackError) return []
      return ((fallback ?? []) as ZoneRow[]).map((z): ZoneOption => ({ zone_id: z.id, name: z.name }))
    },
    enabled: !!user?.organization_id,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })

  useEffect(() => {
    if (!manualZoneId && manualZones.length > 0) {
      setManualZoneId(manualZones[0].zone_id)
    }
  }, [manualZoneId, manualZones])

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
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    refetchInterval: 15000,  // auto-refresh every 15 s so AI results appear
  })

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
          organization_id: (activeShift as any)?.organization_id || shiftOrgId || employerOrganizationId,
          created_by: user?.id,
          zone_id: obsZoneId,
          plate_number: plateNumber,
          action_type: actionType,
          observation_id: observationId,
          status: 'pending',
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
    if (!user?.id || !employerOrganizationId) return

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
  }, [user, employerOrganizationId, isServiceProviderMember, shiftOrgId, currentPatrolZone, setZone, recordGPSUpdate, zoneName, shareLiveLocationWithClient])

  // ── Shift management — explicit Start/End (not auto-start) ──────────────
  // Fetch active shift for current officer
  const { data: activeShift, refetch: refetchShift } = useQuery({
    queryKey: ['officer-active-shift', user?.id],
    queryFn: async () => {
      if (!user?.id) return null
      const { data, error } = await (supabase
        .from('officer_shifts') as any)
        .select('id, organization_id, started_at, parent_zone_id, gps_start_lat, gps_start_lng')
        .eq('officer_id', user.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) return null
      return data as { id: string; organization_id: string; started_at: string; parent_zone_id: string | null; gps_start_lat: number | null; gps_start_lng: number | null } | null
    },
    enabled: !!user?.id,
    refetchInterval: 300000,
  })

  const [isStartingShift, setIsStartingShift] = useState(false)
  const [isEndingShift,   setIsEndingShift]   = useState(false)

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

      const { data: shiftRow, error } = await (supabase.from('officer_shifts') as any).insert({
        officer_id:      user.id,
        organization_id: effectiveOrgId,
        parent_zone_id:  effectiveZoneId,
        gps_start_lat:   gpsLat,
        gps_start_lng:   gpsLng,
      }).select('id').single()
      if (error) throw error

      const effectiveOrgName = accessibleOrgs.find((org) => org.id === effectiveOrgId)?.name ?? null
      setOrganization(effectiveOrgId, effectiveOrgName)

      // Register welfare push schedule on server (enables background reminders)
      // Fetch the officer's configured interval so the server-side schedule matches the UI.
      let welfareIntervalMinutes = 30
      try {
        const { data: welfareSettings } = await supabase
          .from('officer_welfare_settings')
          .select('check_in_interval_minutes')
          .eq('user_id', user.id)
          .maybeSingle()
        if ((welfareSettings as any)?.check_in_interval_minutes) {
          welfareIntervalMinutes = (welfareSettings as any).check_in_interval_minutes
        }
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

      // Refresh the page to reflect the current state (as per user requirement)
      await refetchShift()
      queryClient.invalidateQueries({ queryKey: ['officer-active-shift'] })
      // Brief delay to allow the toast to show before reload
      setTimeout(() => window.location.reload(), 500)
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to start shift')
    } finally {
      setIsStartingShift(false)
    }
  }, [user, employerOrganizationId, zoneId, shiftOrgId, shiftZoneId, isServiceProviderMember, refetchShift, queryClient, accessibleOrgs, setOrganization])

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

      const { error } = await (supabase.from('officer_shifts') as any)
        .update({ ended_at: new Date().toISOString(), gps_end_lat: gpsLat, gps_end_lng: gpsLng })
        .eq('id', activeShift.id)
      if (error) throw error

      // Deactivate welfare push schedule
      if (user?.id) {
          const { error: deactivateError } = await supabase
          .from('welfare_push_schedule' as any)
          .update({ is_active: false })
          .eq('officer_id', user.id)
          .eq('is_active', true)
          if (deactivateError) {
            // non-critical: shift has ended even if schedule cleanup fails
          }
      }

      // Notify service worker to dismiss welfare notifications
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'WELFARE_SHIFT_END' })
      }

      toast.success('Shift ended — welfare monitoring stopped')

      // Refresh the page to reflect the current state (as per user requirement)
      await refetchShift()
      queryClient.invalidateQueries({ queryKey: ['officer-active-shift'] })
      // Brief delay to allow the toast to show before reload
      setTimeout(() => window.location.reload(), 500)
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to end shift')
    } finally {
      setIsEndingShift(false)
    }
  }, [activeShift, user, refetchShift, queryClient])

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
                          ? <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />Starting…</span>
                          : <><Clock className="h-4 w-4 mr-1.5" />Start Shift</>}
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
                {isEndingShift ? 'Ending…' : 'End Shift'}
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
          <div className="grid grid-cols-2 gap-3">
            {(Object.entries(SERVICE_TYPE_CONFIG) as [ServiceType, typeof SERVICE_TYPE_CONFIG[ServiceType]][]).map(
              ([key, cfg]) => {
                const isActive = activeService === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveService(isActive ? null : key)}
                    className={`flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-all ${
                      isActive
                        ? `${cfg.borderColor} ${cfg.bgColor} shadow-md ring-1 ring-opacity-30`
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${cfg.bgColor} shrink-0`}>
                      <cfg.Icon className={`h-5 w-5 ${cfg.color}`} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${isActive ? cfg.color : 'text-gray-800 dark:text-gray-200'}`}>
                        {cfg.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                        {cfg.description}
                      </p>
                    </div>
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
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 mb-6">
                {/* ── Detail Scan card ────────────────────────────── */}
                <Card
                  className="hover:shadow-xl transition-all hover:scale-[1.01] active:scale-[0.99] border-2 border-blue-300 dark:border-blue-800 cursor-pointer"
                  onClick={() => {
                    if (!user?.id || !user?.organization_id) { toast.error('Session expired'); return }
                    const offline = !navigator.onLine
                    const noCamera = !navigator.mediaDevices?.getUserMedia
                    setScanMode('detail')
                    setDetailCameraOpen(true)
                    // Auto-open manual entry form when offline or camera unavailable
                    setShowManualEntry(offline || noCamera)
                    setManualPlate('')
                    setManualZoneId('')
                    setShowDetailPanel(false)
                    setDetailScanData(null)
                  }}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg shrink-0">
                        <Search className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">Scan Vehicle (Detail)</CardTitle>
                        <CardDescription className="text-xs leading-snug">
                          One vehicle — full details, notes &amp; actions
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-[11px] text-muted-foreground">
                      Targeted inspection. Edit corrections, add H&amp;S, issue warnings or notices.
                    </p>
                  </CardContent>
                </Card>

                {/* ── Bulk (Zoom) Scan card ────────────────────────── */}
                <Card
                  className="hover:shadow-xl transition-all hover:scale-[1.01] active:scale-[0.99] border-2 border-yellow-300 dark:border-yellow-800 cursor-pointer"
                  onClick={() => {
                    if (!user?.id || !user?.organization_id) { toast.error('Session expired'); return }
                    if (!navigator.mediaDevices?.getUserMedia) { toast.error('Camera not available'); return }
                    setScanMode('bulk')
                  }}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-yellow-100 dark:bg-yellow-900 rounded-lg shrink-0">
                        <Zap className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">Bulk Scan</CardTitle>
                        <CardDescription className="text-xs leading-snug">
                          Area sweep — multiple vehicles fast
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-[11px] text-muted-foreground">
                      Camera stays open. Scan one after another with live breach tally.
                    </p>
                  </CardContent>
                </Card>

                {/* ── Live Patrol Scan card ─────────────────────────── */}
                <Card
                  className="hover:shadow-xl transition-all hover:scale-[1.01] active:scale-[0.99] border-2 border-green-300 dark:border-green-800 cursor-pointer col-span-2 sm:col-span-1"
                  onClick={() => {
                    if (!user?.id || !user?.organization_id) { toast.error('Session expired'); return }
                    if (!navigator.mediaDevices?.getUserMedia) { toast.error('Camera not available'); return }
                    setScanMode('live')
                  }}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg shrink-0">
                        <Video className="h-5 w-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">Live Patrol</CardTitle>
                        <CardDescription className="text-xs leading-snug">
                          Auto-scan as you drive
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-[11px] text-muted-foreground">
                      Continuous camera feed auto-captures plates every few seconds. Breach alerts show instantly.
                    </p>
                  </CardContent>
                </Card>
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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
                {/* QR Checkpoint */}
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

                {/* Active Patrol */}
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
                    <Button className="w-full" variant="outline" onClick={() => navigate('/live-patrol')}>
                      Patrol Status
                    </Button>
                  </CardContent>
                </Card>

                {/* Face Recognition / POI */}
                <Card className="hover:shadow-lg transition-shadow border-purple-200 dark:border-purple-800">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                        <ScanFace className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      Face Recognition
                    </CardTitle>
                    <CardDescription>POI detection &amp; trespass matching</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full" variant="outline" onClick={() => navigate('/face-recognition')}>
                      Open Face Scan
                    </Button>
                  </CardContent>
                </Card>

                {/* Person Records / POI */}
                <Card className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <div className="p-2 bg-amber-100 dark:bg-amber-900 rounded-lg">
                        <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                      </div>
                      Person Records
                    </CardTitle>
                    <CardDescription>Persons of interest &amp; observations</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full" variant="outline" onClick={() => navigate('/person-records')}>
                      View Records
                    </Button>
                  </CardContent>
                </Card>

                {/* Create Report */}
                <Card className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                        <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      Create Report
                    </CardTitle>
                    <CardDescription>H&amp;S, incident or maintenance</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button className="w-full" onClick={handleOpenQuickReport}>
                      <PlusCircle className="h-4 w-4 mr-2" />
                      New Quick Report
                    </Button>
                    <Button className="w-full" variant="outline" onClick={() => navigate('/incidents')}>
                      View All Reports
                    </Button>
                  </CardContent>
                </Card>

                {/* VOI Lookup — available everywhere, no geofence restriction */}
                <Card className="hover:shadow-lg transition-shadow border-blue-200 dark:border-blue-900 border-2 md:col-span-2 lg:col-span-3">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                        <Car className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      Vehicle of Interest Check
                      <Badge variant="outline" className="ml-auto text-xs border-blue-200 text-blue-600">Anywhere</Badge>
                    </CardTitle>
                    <CardDescription>Search flagged / banned vehicles — no geofence required</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <VOILookup inline />
                  </CardContent>
                </Card>

                {/* POI — only when rostered and on shift */}
                {rosteredShift && (
                  <Card className="hover:shadow-lg transition-shadow border-orange-200 dark:border-orange-800 border-2">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                          <Lock className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        Persons of Interest
                        <Badge variant="outline" className="ml-auto text-xs border-green-300 text-green-700">Rostered</Badge>
                      </CardTitle>
                      <CardDescription>
                        {rosteredShift.client_site_id
                          ? `Site POI — geofence gated`
                          : 'Org-wide POI — geofence gated'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {rosteredShift.client_site_id ? (
                        <Button
                          className="w-full"
                          variant="outline"
                          onClick={() => navigate(`/site-guard?site=${rosteredShift.client_site_id}&roster=${rosteredShift.id}`)}
                        >
                          <Users className="h-4 w-4 mr-2" />
                          View Site POI
                        </Button>
                      ) : (
                        <Button className="w-full" variant="outline" onClick={() => navigate('/points-of-interest')}>
                          <Users className="h-4 w-4 mr-2" />
                          View POI
                        </Button>
                      )}
                    </CardContent>
                  </Card>
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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
                <Card className="hover:shadow-lg transition-shadow border-orange-200 dark:border-orange-900 border-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                        <ParkingSquare className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                      </div>
                      Parking Enforcement
                    </CardTitle>
                    <CardDescription>Chalk pass · Recheck · Infringement</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full" variant="outline" onClick={() => navigate('/parking-officer')}>
                      Open Parking Portal
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

          {/* ═══════════════════════════════════════════════════════════
              NOISE CONTROL tools
              ═══════════════════════════════════════════════════════════ */}
          {activeService === 'noise' && (
            <>
              <h3 className="text-xs font-bold text-yellow-700 dark:text-yellow-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5" />
                Noise Control
              </h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
                <Card className="hover:shadow-lg transition-shadow border-yellow-200 dark:border-yellow-900 border-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <div className="p-2 bg-yellow-100 dark:bg-yellow-900 rounded-lg">
                        <Volume2 className="h-5 w-5 text-yellow-700 dark:text-yellow-400" />
                      </div>
                      Noise Control
                    </CardTitle>
                    <CardDescription>Jobs · AN / DN / END · Seizures</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full" variant="outline" onClick={() => navigate('/noise-officer')}>
                      Open Noise Portal
                    </Button>
                  </CardContent>
                </Card>
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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
                <Card className="hover:shadow-lg transition-shadow border-emerald-200 dark:border-emerald-900 border-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <div className="p-2 bg-emerald-100 dark:bg-emerald-900 rounded-lg">
                        <Leaf className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                      </div>
                      Biosecurity (CNG)
                    </CardTitle>
                    <CardDescription>Plant ID · RPMP · Notices · Bob AI</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => navigate('/biosecurity-officer')}>
                      Open Biosecurity Portal
                    </Button>
                  </CardContent>
                </Card>
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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
                <Card className="hover:shadow-lg transition-shadow border-amber-200 dark:border-amber-900 border-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <div className="p-2 bg-amber-100 dark:bg-amber-900 rounded-lg">
                        <Wind className="h-5 w-5 text-amber-700 dark:text-amber-400" />
                      </div>
                      Smoke Complaint
                    </CardTitle>
                    <CardDescription>OOH · Opacity · Materials · RMA s.17A</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full bg-amber-600 hover:bg-amber-700 text-white" onClick={() => navigate('/smoke-officer')}>
                      Open Smoke Portal
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              COMMON TOOLS — always visible (shared across all services)
              ═══════════════════════════════════════════════════════════ */}
          {!activeService && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
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

              {/* Active Patrol */}
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
                  <Button className="w-full" variant="outline" onClick={() => navigate('/live-patrol')}>
                    Patrol Status
                  </Button>
                </CardContent>
              </Card>

              {/* Create Report */}
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                      <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    Create Report
                  </CardTitle>
                  <CardDescription>H&amp;S, incident or maintenance</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button className="w-full" onClick={handleOpenQuickReport}>
                    <PlusCircle className="h-4 w-4 mr-2" />
                    New Quick Report
                  </Button>
                  <Button className="w-full" variant="outline" onClick={() => navigate('/incidents')}>
                    View All Reports
                  </Button>
                </CardContent>
              </Card>

              {/* My Scans */}
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

              {/* Breach Alerts */}
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

              {/* Zones */}
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

              {/* Infringements */}
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

              {/* Parking Enforcement */}
              <Card className="hover:shadow-lg transition-shadow border-orange-200 dark:border-orange-900">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                      <ParkingSquare className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                    </div>
                    Parking Enforcement
                  </CardTitle>
                  <CardDescription>Chalk pass · Recheck · Infringement</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" variant="outline" onClick={() => navigate('/parking-officer')}>
                    Open Parking Portal
                  </Button>
                </CardContent>
              </Card>

              {/* Noise Control */}
              <Card className="hover:shadow-lg transition-shadow border-yellow-200 dark:border-yellow-900">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <div className="p-2 bg-yellow-100 dark:bg-yellow-900 rounded-lg">
                      <Volume2 className="h-5 w-5 text-yellow-700 dark:text-yellow-400" />
                    </div>
                    Noise Control
                  </CardTitle>
                  <CardDescription>Jobs · AN / DN / END · Seizures</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" variant="outline" onClick={() => navigate('/noise-officer')}>
                    Open Noise Portal
                  </Button>
                </CardContent>
              </Card>

              {/* Biosecurity Inspection */}
              <Card className="hover:shadow-lg transition-shadow border-emerald-200 dark:border-emerald-900">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <div className="p-2 bg-emerald-100 dark:bg-emerald-900 rounded-lg">
                      <Leaf className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                    </div>
                    Biosecurity (CNG)
                  </CardTitle>
                  <CardDescription>Plant ID · RPMP · Bob AI</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => navigate('/biosecurity-officer')}>
                    Open Biosecurity Portal
                  </Button>
                </CardContent>
              </Card>

              {/* Smoke Complaint OOH */}
              <Card className="hover:shadow-lg transition-shadow border-amber-200 dark:border-amber-900">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <div className="p-2 bg-amber-100 dark:bg-amber-900 rounded-lg">
                      <Wind className="h-5 w-5 text-amber-700 dark:text-amber-400" />
                    </div>
                    Smoke Complaint (OOH)
                  </CardTitle>
                  <CardDescription>Opacity · Materials · RMA s.17A</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full bg-amber-600 hover:bg-amber-700 text-white" onClick={() => navigate('/smoke-officer')}>
                    Open Smoke Portal
                  </Button>
                </CardContent>
              </Card>
            </div>
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
                              onClick={() => advanceJobStatus.mutate({ jobId: job.id, newStatus: action.next })}
                              disabled={advanceJobStatus.isPending}
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
              {/* My Scans — shown for freedom_camping and guarding */}
              {(activeService === 'freedom_camping' || activeService === 'guarding') && (
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
              )}

              {/* Breach Alerts — shown for freedom_camping */}
              {activeService === 'freedom_camping' && (
                <>
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
                </>
              )}

              {/* Create Report — shown for guarding */}
              {activeService === 'guarding' && (
                <Card className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                        <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      Create Report
                    </CardTitle>
                    <CardDescription>H&amp;S, incident or maintenance</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button className="w-full" onClick={handleOpenQuickReport}>
                      <PlusCircle className="h-4 w-4 mr-2" />
                      New Quick Report
                    </Button>
                    <Button className="w-full" variant="outline" onClick={() => navigate('/incidents')}>
                      View All Reports
                    </Button>
                  </CardContent>
                </Card>
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
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
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
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
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
