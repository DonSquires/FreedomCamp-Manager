/**
 * DispatchConsole — GDS CATS / Zoho FSM-inspired real-time dispatch board.
 *
 * Left panel  : Priority-sorted job queue (pending → dispatched → on-scene).
 * Right panel : Available officers with GPS status.
 * Admin clicks an unassigned job, selects an officer, and dispatches in one step.
 * Officers receive a notification and update their status through the lifecycle:
 *   pending → dispatched → acknowledged → en_route → on_scene → completed
 *
 * Jobs overdue on SLA are highlighted automatically.
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { formatDistance, estimateEtaMinutes, formatEta, haversineKm } from '@/lib/geo'
import { useAuthStore } from '@/stores/authStore'
import { useClientOrgIds } from '@/hooks/useClientOrgIds'
import { useDispatchReplan } from '@/hooks/useDispatchReplan'
import {
  assignAndDispatchJob,
  cancelDispatchJob,
  useDispatchClientSitesLookup,
  useDispatchZonesLookup,
} from '@/hooks/useDispatchConsoleData'
import {
  useOperationalCases,
  useCreateDispatchEvent,
  useFeatureFlag,
} from '@/hooks/useOperationalCases'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertTriangle, Clock, MapPin, User, Radio, CheckCircle,
  XCircle, Navigation, Siren, Plus, RefreshCw, Car, Zap,
  PhoneCall, FileText, Building2, Wand2, LayoutList, ListChecks,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DispatchJob {
  id: string
  job_number: string
  job_type: string
  alarm_type: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'pending' | 'dispatched' | 'acknowledged' | 'en_route' | 'on_scene' | 'completed' | 'cancelled'
  title: string
  description: string | null
  address: string | null
  gps_lat: number | null
  gps_lng: number | null
  caller_name: string | null
  caller_phone: string | null
  created_at: string
  dispatched_at: string | null
  acknowledged_at: string | null
  on_scene_at: string | null
  completed_at: string | null
  response_sla_minutes: number
  sla_breached: boolean
  escalation_level: number
  assigned_officer: {
    id: string
    first_name: string
    last_name: string
    phone: string | null
    last_gps_latitude: number | null
    last_gps_longitude: number | null
    last_gps_update: string | null
  } | null
  client_site: { name: string; address: string | null } | null
  zone: { name: string } | null
}

interface OfficerStatus {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  role: string
  last_gps_lat: number | null
  last_gps_lng: number | null
  last_gps_update: string | null
  gps_age_minutes: number | null
  active_job_count: number
  is_on_shift: boolean
  distance_km: number | null   // populated when dispatching a job with GPS coords
}

interface RecognitionAlertSummary {
  faceMatches: Array<{
    id: string
    created_at: string
    person_record_id: string | null
  }>
  vehicleMatches: Array<{
    id: string
    created_at: string
    plate_number: string | null
  }>
}

// ── Haversine distance helper imported from @/lib/geo


interface JobForm {
  job_type: string
  alarm_type: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  title: string
  description: string
  address: string
  caller_name: string
  caller_phone: string
  client_site_id: string
  zone_id: string
  response_sla_minutes: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; colour: string; bg: string; border: string }> = {
  pending:      { label: 'Pending',      colour: 'text-gray-600',   bg: 'bg-gray-50',    border: 'border-gray-200'   },
  dispatched:   { label: 'Dispatched',   colour: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-200'   },
  acknowledged: { label: 'Acknowledged', colour: 'text-indigo-700', bg: 'bg-indigo-50',  border: 'border-indigo-200' },
  en_route:     { label: 'En Route',     colour: 'text-cyan-700',   bg: 'bg-cyan-50',    border: 'border-cyan-200'   },
  on_scene:     { label: 'On Scene',     colour: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-200'  },
  completed:    { label: 'Completed',    colour: 'text-emerald-700',bg: 'bg-emerald-50', border: 'border-emerald-200'},
  cancelled:    { label: 'Cancelled',    colour: 'text-gray-400',   bg: 'bg-gray-50',    border: 'border-gray-200'   },
}

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  low:    { label: 'Low',    className: 'border-gray-300   text-gray-500'    },
  normal: { label: 'Normal', className: 'border-blue-300   text-blue-700'    },
  high:   { label: 'High',   className: 'border-orange-300 text-orange-700'  },
  urgent: { label: 'URGENT', className: 'border-red-400    text-red-700 font-bold animate-pulse' },
}

const JOB_TYPE_LABELS: Record<string, string> = {
  // WILSAR core types
  alarm_response:       'Alarm Response',
  noise_complaint:      'Noise Complaint',
  biosecurity_inspection: 'Biosecurity Inspection',
  freedom_camping:      'Freedom Camping',
  permanent_patrol:     'Permanent Patrol',
  casual_patrol:        'Casual Patrol',
  escort:               'Escort',
  key_collection:       'Key Collection',
  key_return:           'Key Return',
  let_in:               'Let In',
  let_out:              'Let Out',
  lockup:               'Lockup',
  open:                 'Open',
  alarm_reset:          'Alarm Reset',
  first_line_one_guard: 'First Line One Guard',
  first_line_two_guard: 'First Line Two Guard',
  second_line_response: 'Second Line Response',
  cash_in_transit:      'Cash In Transit',
  // FieldOps-native types
  patrol:               'Patrol',
  welfare_check:        'Welfare Check',
  parking:              'Parking',
  medical:              'Medical',
  fire:                 'Fire',
  suspicious_activity:  'Suspicious Activity',
  lock_unlock:          'Lock/Unlock',
  property_check:       'Property Check',
  vandalism:            'Vandalism',
  smoke_complaint_ooh:    'Smoke Complaint (OOH)',
  general:              'General',
  other:                'Other',
}

const ALARM_TYPE_LABELS: Record<string, string> = {
  intruder_alarm:  'Intruder Alarm',
  duress_hold_up:  'Duress / Hold Up',
  animal_control:  'Animal Control',
  cardreader_fault:'Cardreader Fault',
  late_to_close:   'Late to Close',
  lock_broken:     'Lock Broken',
  noise:           'Noise',
  parking:         'Parking',
  traffic:         'Traffic',
  vandalism:       'Vandalism',
  alarm_reset:     'Alarm Reset',
  other:           'Other',
}

const ACTIVE_STATUSES = ['pending', 'dispatched', 'acknowledged', 'en_route', 'on_scene']

const DISPATCH_JOB_SELECT = `
  id, job_number, job_type, priority, status, title, description,
  address, gps_lat, gps_lng, caller_name, caller_phone, created_at, dispatched_at,
  acknowledged_at, on_scene_at, completed_at,
  response_sla_minutes, sla_breached, escalation_level,
  assigned_officer:user_profiles!assigned_to(id, first_name, last_name, phone, last_gps_latitude, last_gps_longitude, last_gps_update),
  client_site:client_sites!client_site_id(name, address),
  zone:zones!zone_id(name)
`

const ALARM_JOB_TYPES = new Set([
  'alarm_response', 'first_line_one_guard', 'first_line_two_guard', 'second_line_response',
])

function minutesSince(dateStr: string | null): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000)
}

function emptyForm(): JobForm {
  return {
    job_type: 'general', alarm_type: '', priority: 'normal', title: '', description: '',
    address: '', caller_name: '', caller_phone: '', client_site_id: '', zone_id: '', response_sla_minutes: 60,
  }
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

function cacheRecentDispatchTitle(title: string) {
  if (typeof window === 'undefined') return

  const normalized = title.trim()
  if (!normalized) return

  const key = 'fc_recent_dispatch_titles'
  let existing: string[] = []

  try {
    const raw = window.sessionStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        existing = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      }
    }
  } catch {
    existing = []
  }

  const next = [normalized, ...existing.filter((item) => item !== normalized)].slice(0, 25)
  window.sessionStorage.setItem(key, JSON.stringify(next))
}

async function postgrestCreateDispatchJob(payload: Record<string, unknown>, timeoutMs = 12000): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are missing')
  }

  let accessToken = readSupabaseAccessTokenFromStorage()
  if (!accessToken) {
    const {
      data: { session },
    } = await withTimeout(supabase.auth.getSession(), 3000, 'Session lookup')
    accessToken = session?.access_token ?? null
  }

  if (!accessToken) {
    throw new Error('Session expired. Please sign in again')
  }

  const tryInsert = async (bodyPayload: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/dispatch_jobs`, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      })

      if (response.ok) return { ok: true }

      const raw = await response.text().catch(() => '')
      if (!raw) return { ok: false, message: 'Failed to create job' }

      try {
        const parsed = JSON.parse(raw)
        return {
          ok: false,
          message: parsed?.message || parsed?.error_description || parsed?.hint || raw,
        }
      } catch {
        return { ok: false, message: raw }
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`Dispatch create timed out after ${Math.round(timeoutMs / 1000)}s`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  const initial = await tryInsert(payload)
  if (initial.ok) return

  const message = (initial.message || '').toLowerCase()
  const alarmTypeMissing =
    message.includes("'alarm_type' column of 'dispatch_jobs'") ||
    message.includes('dispatch_jobs.alarm_type')

  if (alarmTypeMissing && 'alarm_type' in payload) {
    const { alarm_type: _unused, ...fallbackPayload } = payload
    const fallback = await tryInsert(fallbackPayload)
    if (fallback.ok) return
    throw new Error(fallback.message || 'Failed to create job')
  }

  throw new Error(initial.message || 'Failed to create job')
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DispatchConsole() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'master' || user?.role === 'admin_officer'
  const { organizationId: filterOrgId } = useGlobalFiltersStore()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const orgId = filterOrgId || user?.organization_id
  const { orgIds: clientOrgIds, isLoading: clientOrgIdsLoading } = useClientOrgIds()

  const [statusFilter, setStatusFilter] = useState<'active' | 'completed' | 'all'>('active')
  const [selectedJob, setSelectedJob] = useState<DispatchJob | null>(null)
  const [assignTarget, setAssignTarget] = useState<string>('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<JobForm>(emptyForm())

  // Offline detection
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline  = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  // Auto-refresh every 30s for real-time feel
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // ── Jobs query ──────────────────────────────────────────────────────────────
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<DispatchJob[]>({
    queryKey: ['dispatch-jobs', orgId, statusFilter, tick],
    queryFn: async () => {
      let q = (supabase as any)
        .from('dispatch_jobs')
        .select(DISPATCH_JOB_SELECT)
        .eq('organization_id', orgId ?? '')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })

      if (statusFilter === 'active') q = q.in('status', ACTIVE_STATUSES)
      else if (statusFilter === 'completed') q = q.in('status', ['completed', 'cancelled'])

      const { data, error } = await q.limit(100)
      if (error) throw error
      return (data ?? []) as unknown as DispatchJob[]
    },
    enabled: !!orgId,
  })

  const caseStatusFilter = statusFilter === 'active' ? undefined : statusFilter === 'completed' ? 'completed' : undefined
  const [denseMode, setDenseMode] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('fc_dispatch_dense_mode') === 'true'
  })

  useEffect(() => {
    try {
      window.localStorage.setItem('fc_dispatch_dense_mode', String(denseMode))
    } catch {
      // Ignore storage failures; the toggle still works for the current session.
    }
  }, [denseMode])

  const { data: operationalCases = [] } = useOperationalCases({
    caseType: 'dispatch_job',
    status: caseStatusFilter,
    limit: 100,
  })

  // ── Phase A/B: Case model dispatch events (feature flagged) ────────────────
  const { data: dispatchEventsEnabled } = useFeatureFlag('FF_PHASE_B_DISPATCH_EVENTS')
  const createDispatchEvent = useCreateDispatchEvent()

  // ── Officers query — uses proximity ranking when selected job has GPS ──────
  const { data: officers = [], isLoading: officersLoading, isError: officersError } = useQuery<OfficerStatus[]>({
    queryKey: ['dispatch-officers', orgId, tick, selectedJob?.id ?? null],
    queryFn: async () => {
      // If the selected job has GPS coordinates, use the proximity RPC
      if (selectedJob?.gps_lat && selectedJob?.gps_lng) {
        const { data, error } = await (supabase as any).rpc('get_nearest_officers', {
          p_job_lat:          selectedJob.gps_lat,
          p_job_lng:          selectedJob.gps_lng,
          p_organization_id:  orgId ?? null,
          p_max_results:      30,
          p_max_age_minutes:  120,
        })
        if (error) throw error
        return (data ?? []).map((o: any) => ({
          id:               o.officer_id,
          first_name:       o.first_name,
          last_name:        o.last_name,
          phone:            o.phone,
          role:             o.role,
          is_on_shift:      o.is_on_shift,
          active_job_count: Number(o.active_job_count ?? 0),
          last_gps_lat:     o.last_gps_latitude ?? null,
          last_gps_lng:     o.last_gps_longitude ?? null,
          last_gps_update:  o.last_gps_update ?? null,
          gps_age_minutes:  o.gps_age_minutes ?? null,
          distance_km:      o.distance_km ?? null,
        })) as OfficerStatus[]
      }

      // Fallback: no GPS on job — return all on-shift officers
      const { data: shiftData } = await supabase
        .from('officer_shifts')
        .select('officer_id')
        .eq('organization_id', orgId ?? '')
        .is('ended_at', null)

      const onShiftIds = (shiftData ?? []).map((r: any) => r.officer_id)

      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, phone, role')
        .eq('organization_id', orgId ?? '')
        .in('role', ['officer', 'admin_officer'])
        .eq('is_active', true)

      if (error) throw error

      // Count active jobs per officer
      const { data: jobCounts } = await (supabase as any)
        .from('dispatch_jobs')
        .select('assigned_to')
        .eq('organization_id', orgId ?? '')
        .in('status', ACTIVE_STATUSES)

      const countMap: Record<string, number> = {}
      for (const j of jobCounts ?? []) {
        if (j.assigned_to) countMap[j.assigned_to] = (countMap[j.assigned_to] || 0) + 1
      }

      return (data ?? []).map((o: any) => ({
        ...o,
        is_on_shift:     onShiftIds.includes(o.id),
        active_job_count: countMap[o.id] ?? 0,
        last_gps_lat:    null,
        last_gps_lng:    null,
        last_gps_update: null,
        gps_age_minutes: null,
        distance_km:     null,
      })) as OfficerStatus[]
    },
    enabled: !!orgId,
  })

  const { data: recognitionAlerts = { faceMatches: [], vehicleMatches: [] } } = useQuery<RecognitionAlertSummary>({
    queryKey: ['dispatch-recognition-alerts', orgId, tick],
    queryFn: async () => {
      if (!orgId) return { faceMatches: [], vehicleMatches: [] }

      const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const [faceResult, vehicleResult] = await Promise.all([
        (supabase as any)
          .from('face_records')
          .select('id, created_at, person_record_id')
          .eq('organization_id', orgId)
          .not('person_record_id', 'is', null)
          .gte('created_at', cutoffIso)
          .order('created_at', { ascending: false })
          .limit(5),
        (supabase as any)
          .from('plate_scans')
          .select('id, created_at, plate_number')
          .eq('organization_id', orgId)
          .eq('flagged_vehicle_detected', true)
          .gte('created_at', cutoffIso)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      if (faceResult.error) throw faceResult.error
      if (vehicleResult.error) throw vehicleResult.error

      return {
        faceMatches: (faceResult.data ?? []) as RecognitionAlertSummary['faceMatches'],
        vehicleMatches: (vehicleResult.data ?? []) as RecognitionAlertSummary['vehicleMatches'],
      }
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  })

  // ── Client sites for create form ────────────────────────────────────────────
  const { data: clientSites = [] } = useDispatchClientSitesLookup({
    orgId,
    clientOrgIds,
    clientOrgIdsLoading,
  })

  // ── Zones for create form ───────────────────────────────────────────────────
  const { data: dispatchZones = [] } = useDispatchZonesLookup({ orgId })

  // ── Summary stats ────────────────────────────────────────────────────────────
  const pending    = jobs.filter(j => j.status === 'pending').length
  const active     = jobs.filter(j => ACTIVE_STATUSES.includes(j.status) && j.status !== 'pending').length
  const breached   = jobs.filter(j => j.sla_breached && ACTIVE_STATUSES.includes(j.status)).length
  const onShift    = officers.filter(o => o.is_on_shift).length

  // ── Assign + dispatch mutation ───────────────────────────────────────────────
  const dispatchMutation = useMutation({
    mutationFn: async ({ jobId, officerId }: { jobId: string; officerId: string }) => {
      const dispatchResult = await assignAndDispatchJob({
        jobId,
        officerId,
      })
      if (!dispatchResult.ok) throw dispatchResult.error

      // Phase B: Create dispatch_event in case model if flag enabled
      if (dispatchEventsEnabled && jobId) {
        try {
          const job = jobs.find(j => j.id === jobId)
          if (job) {
            await createDispatchEvent.mutateAsync({
              caseId: jobId, // Dispatch job acts as case anchor in Phase A
              eventType: 'dispatch_assigned',
              dispatchJobId: jobId,
              statusAtEvent: 'dispatched',
              assignedTo: officerId,
            })
          }
        } catch (err) {
          // Non-blocking: log but continue
          console.warn('Failed to create dispatch_event:', err)
        }
      }

      if (dispatchResult.notificationSent === false) {
        toast.error('Job dispatched, but officer notification failed.')
      }
    },
    onSuccess: () => {
      toast.success('Job dispatched')
      qc.invalidateQueries({ queryKey: ['dispatch-jobs'] })
      setSelectedJob(null)
    },
    onError: (err: any) => toast.error(err.message ?? 'Dispatch failed'),
  })

  // ── Status update mutation (cancel) ────────────────────────────────────────
  const replanMutation = useDispatchReplan()

  const cancelMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const cancelResult = await cancelDispatchJob({ jobId })
      if (!cancelResult.ok) throw cancelResult.error
    },
    onSuccess: () => {
      toast.success('Job cancelled')
      qc.invalidateQueries({ queryKey: ['dispatch-jobs'] })
      setSelectedJob(null)
    },
    onError: (err: any) => toast.error(err.message ?? 'Cancel failed'),
  })

  // ── Create job mutation ─────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (f: JobForm) => {
      const effectiveOrgId = orgId || useAuthStore.getState().user?.organization_id
      if (!effectiveOrgId) {
        throw new Error('Organization context is still loading. Please retry in a moment.')
      }

      const payload = {
        organization_id:      effectiveOrgId,
        job_type:             f.job_type,
        alarm_type:           f.alarm_type || null,
        priority:             f.priority,
        title:                f.title,
        description:          f.description || null,
        address:              f.address || null,
        caller_name:          f.caller_name || null,
        caller_phone:         f.caller_phone || null,
        client_site_id:       f.client_site_id || null,
        zone_id:              f.zone_id || null,
        response_sla_minutes: f.response_sla_minutes,
      }

      try {
        const edgeResult = await withTimeout(
          edgeFunctions.createDispatchJob({ payload }),
          45000,
          'Dispatch create'
        )

        if (edgeResult?.error) {
          throw new Error(edgeResult.error)
        }
      } catch {
        await postgrestCreateDispatchJob(payload)
      }
    },
    onSuccess: (_data, variables) => {
      toast.success('Job created')
      cacheRecentDispatchTitle(variables.title)
      qc.invalidateQueries({ queryKey: ['dispatch-jobs'] })
      setShowCreate(false)
      setForm(emptyForm())
    },
    onError: (err: any) => toast.error(err.message ?? 'Create failed'),
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (createMutation.isPending) return
    if (!form.title.trim()) { toast.error('Title is required'); return }
    const snapshot = { ...form }
    createMutation.mutate(snapshot)
  }

  // Pre-compute nearest on-shift officer with GPS for the selected job
  const nearestOfficer = useMemo(() => {
    if (!selectedJob?.gps_lat) return null
    return officers.find(o => o.is_on_shift && o.distance_km !== null) ?? null
  }, [officers, selectedJob])

  // Top-3 recommended officers: on-shift, sorted by distance then active-job-count
  const topRecommendedOfficers = useMemo(() => {
    const onShift = officers.filter(o => o.is_on_shift)
    const withGPS = onShift.filter(o => o.distance_km !== null)
    const noGPS   = onShift.filter(o => o.distance_km === null)
    // Primary sort: distance asc; secondary: fewest active jobs
    const sorted = [...withGPS].sort((a, b) => {
      const distDiff = (a.distance_km ?? 0) - (b.distance_km ?? 0)
      if (distDiff !== 0) return distDiff
      return a.active_job_count - b.active_job_count
    })
    // If fewer than 3 with GPS, pad with no-GPS officers sorted by job count
    const padded = noGPS.sort((a, b) => a.active_job_count - b.active_job_count)
    return [...sorted, ...padded].slice(0, 3)
  }, [officers])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <GlobalFilterRibbon />
      <div className={denseMode ? 'p-3 md:p-5 space-y-3 max-w-screen-2xl mx-auto' : 'p-4 md:p-6 space-y-4 max-w-screen-2xl mx-auto'}>

      {/* Offline warning */}
        {isOffline && (
          <div className="flex items-center gap-2 rounded-md bg-yellow-50 border border-yellow-300 text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-200 px-4 py-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            You are offline. Dispatch actions are unavailable until connectivity is restored.
          </div>
        )}

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 data-testid="console-title" className={denseMode ? 'text-xl font-bold flex items-center gap-2' : 'text-2xl font-bold flex items-center gap-2'}>
              <Radio className="h-6 w-6 text-primary" />
              Dispatch Console
            </h1>
            <p className={denseMode ? 'text-xs text-muted-foreground mt-0.5 max-w-3xl' : 'text-sm text-muted-foreground mt-0.5 max-w-3xl'}>
              GDS CATS-style job dispatch — assign jobs to officers in real time and coordinate on the employer-wide dispatch radio net
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant={denseMode ? 'default' : 'outline'} size="sm" onClick={() => setDenseMode((value) => !value)} className="gap-1.5">
              <LayoutList className="h-4 w-4" /> {denseMode ? 'Dense' : 'Dense mode'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/radio?mode=dispatch')} className="gap-1.5">
              <Radio className="h-4 w-4" /> Dispatch Radio
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/dispatch-monitor')} className="gap-1.5">
              <LayoutList className="h-4 w-4" /> Monitor
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/dispatched-jobs')} className="gap-1.5">
              <ListChecks className="h-4 w-4" /> Job List
            </Button>
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['dispatch-jobs'] })}>
              <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
            </Button>
            <Button onClick={() => navigate('/dispatch-wizard')} variant="outline" size="sm" className="gap-1.5">
              <Wand2 className="h-4 w-4" /> Wizard
            </Button>
            <Button data-testid="dispatch-new-job-button" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New Job
            </Button>
          </div>
        </div>

        {/* Summary row */}
        <div className={denseMode ? 'grid grid-cols-2 md:grid-cols-4 gap-2' : 'grid grid-cols-2 md:grid-cols-4 gap-3'}>
          {[
            { label: 'Awaiting Dispatch', value: pending,  icon: Clock,         cls: 'text-gray-600'   },
            { label: 'Active Jobs',        value: active,   icon: Navigation,    cls: 'text-blue-600'   },
            { label: 'SLA Breached',       value: breached, icon: AlertTriangle, cls: 'text-red-600'    },
            { label: 'Officers On Shift',  value: onShift,  icon: User,          cls: 'text-green-600'  },
            { label: 'Case Model',         value: operationalCases.length, icon: FileText, cls: 'text-violet-600' },
          ].map(({ label, value, icon: Icon, cls }) => (
            <Card key={label} className={breached > 0 && label === 'SLA Breached' ? 'border-red-300 bg-red-50/30' : ''}>
              <CardContent className={denseMode ? 'pt-2.5 pb-2' : 'pt-3 pb-2'}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 ${cls}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <p className="text-2xl font-bold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {(recognitionAlerts.faceMatches.length > 0 || recognitionAlerts.vehicleMatches.length > 0) && (
          <div className="rounded-md border border-red-300 bg-red-50/70 dark:bg-red-950/20 px-3 py-2 text-xs text-red-800 dark:text-red-200 flex flex-wrap items-center gap-3">
            <span className="font-semibold inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Recognition Alerts
            </span>
            {recognitionAlerts.faceMatches.length > 0 && (
              <span>
                Face: <strong>{recognitionAlerts.faceMatches.length}</strong> POI match{recognitionAlerts.faceMatches.length !== 1 ? 'es' : ''} in last 24h
              </span>
            )}
            {recognitionAlerts.vehicleMatches.length > 0 && (
              <span>
                Vehicle: <strong>{recognitionAlerts.vehicleMatches.length}</strong> flagged plate hit{recognitionAlerts.vehicleMatches.length !== 1 ? 's' : ''} in last 24h
              </span>
            )}
            <Button size="sm" variant="outline" className="h-6 text-[11px] ml-auto" onClick={() => navigate('/face-recognition')}>
              Review
            </Button>
          </div>
        )}

        {/* Status filter */}
        <div className={denseMode ? 'flex gap-1.5 flex-wrap' : 'flex gap-2 flex-wrap'}>
          {(['active', 'completed', 'all'] as const).map(f => (
            <Button key={f} size="sm" variant={statusFilter === f ? 'default' : 'outline'}
              className="capitalize" onClick={() => setStatusFilter(f)}>
              {f === 'active' ? 'Active Jobs' : f === 'completed' ? 'Completed' : 'All'}
            </Button>
          ))}
        </div>

        {/* Main two-panel layout */}
        <div className={denseMode ? 'grid grid-cols-1 lg:grid-cols-3 gap-3' : 'grid grid-cols-1 lg:grid-cols-3 gap-4'}>

          {/* ── Job Queue (2/3 width) ──────────────────────────────────── */}
          <div className={denseMode ? 'lg:col-span-2 space-y-2.5' : 'lg:col-span-2 space-y-3'} data-testid="job-list">
            {jobsLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Card key={`job-skel-${i}`} className="animate-pulse border-l-4 border-l-gray-300">
                    <CardContent className={denseMode ? 'p-3 space-y-2' : 'p-4 space-y-2'}>
                      <div className="h-3 w-24 rounded bg-muted" />
                      <div className="h-4 w-2/3 rounded bg-muted" />
                      <div className="h-3 w-1/2 rounded bg-muted" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {!jobsLoading && jobs.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                No jobs found. Create your first job with "New Job".
              </div>
            )}
            {jobs.map(job => {
              const sc    = STATUS_CONFIG[job.status]
              const pc    = PRIORITY_CONFIG[job.priority]
              const ageM    = minutesSince(job.created_at)
              const minsLeft = job.response_sla_minutes - ageM
              const slaOk   = !job.sla_breached && ageM < job.response_sla_minutes
              const slaWarn = !job.sla_breached && minsLeft > 0 && minsLeft <= 15
              return (
                <Card
                  key={job.id}
                  data-testid="case-card"
                  onClick={() => setSelectedJob(job)}
                  className={`cursor-pointer transition-all hover:shadow-md border-l-4 ${
                    job.priority === 'urgent' ? 'border-l-red-500' :
                    job.priority === 'high'   ? 'border-l-orange-400' :
                    job.priority === 'normal' ? 'border-l-blue-400' : 'border-l-gray-300'
                  } ${job.sla_breached ? 'bg-red-50/30 dark:bg-red-950/10' : slaWarn ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-xs text-muted-foreground">{job.job_number}</span>
                          <Badge variant="outline" className={pc.className}>{pc.label}</Badge>
                          <Badge variant="outline" className={`${sc.colour} ${sc.border}`}>{sc.label}</Badge>
                          {job.sla_breached && (
                            <Badge variant="destructive" className="text-xs animate-pulse">SLA ⚠</Badge>
                          )}
                          {slaWarn && (
                            <Badge className="text-xs bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">SLA {minsLeft}m</Badge>
                          )}
                        </div>
                        <p className="font-semibold text-sm leading-tight">{job.title}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                          {job.address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{job.address}</span>}
                          {job.client_site && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{job.client_site.name}</span>}
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{ageM}m ago</span>
                          {job.caller_name && <span className="flex items-center gap-1"><PhoneCall className="h-3 w-3" />{job.caller_name}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {job.assigned_officer ? (
                          <div className="flex items-center gap-1 text-xs">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{job.assigned_officer.first_name} {job.assigned_officer.last_name}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Unassigned</span>
                        )}
                        {/* B-07: Live ETA — shown for active dispatched/en_route jobs with GPS */}
                        {job.assigned_officer?.last_gps_latitude != null &&
                         job.assigned_officer?.last_gps_longitude != null &&
                         job.gps_lat != null && job.gps_lng != null &&
                         ['dispatched', 'acknowledged', 'en_route'].includes(job.status) && (
                          <div className="flex items-center justify-end gap-1 text-[11px] text-cyan-700 font-medium mt-0.5">
                            <Navigation className="h-3 w-3" />
                            {formatEta(estimateEtaMinutes(haversineKm(
                              job.assigned_officer.last_gps_latitude,
                              job.assigned_officer.last_gps_longitude,
                              job.gps_lat,
                              job.gps_lng,
                            )))}
                          </div>
                        )}
                        <div className={`text-[11px] mt-0.5 ${job.sla_breached ? 'text-red-600 font-semibold' : slaWarn ? 'text-amber-600 font-semibold' : 'text-muted-foreground'}`}>
                          SLA: {job.response_sla_minutes}m
                          {slaOk && minsLeft > 15 ? ` (${minsLeft}m left)` : ''}
                          {slaWarn ? ` ⚠ ${minsLeft}m left` : ''}
                          {job.sla_breached ? ' — Breached' : ''}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* ── Officer Panel (1/3 width) ──────────────────────────────── */}
          <div className="space-y-3">
            <Card>
              <CardHeader className={denseMode ? 'pb-1.5 pt-3 px-4' : 'pb-2 pt-4 px-4'}>
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4" /> Officers
                  <Badge variant="secondary" className="ml-auto">{onShift} on shift</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className={denseMode ? 'px-4 pb-3 space-y-2' : 'px-4 pb-4 space-y-2'}>
                {officers.map(o => (
                  <div key={o.id} className={`flex items-center gap-3 rounded-lg p-2 border ${
                    o.is_on_shift ? 'border-green-200 bg-green-50/50 dark:bg-green-950/20' : 'border-gray-100 opacity-60'
                  }`}>
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                      o.is_on_shift && o.active_job_count === 0 ? 'bg-green-500' :
                      o.is_on_shift ? 'bg-orange-400' : 'bg-gray-300'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">
                        {o.first_name} {o.last_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {o.is_on_shift
                          ? o.active_job_count === 0 ? 'Available' : `${o.active_job_count} active job${o.active_job_count > 1 ? 's' : ''}`
                          : 'Off shift'}
                      </p>
                    </div>
                  </div>
                ))}
                {officersLoading && (
                  <p className="text-sm text-muted-foreground text-center py-4">Loading officers…</p>
                )}
                {!officersLoading && officersError && (
                  <div className="flex flex-col items-center gap-1 py-4 text-center">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    <p className="text-sm text-destructive">Failed to load officers</p>
                    <p className="text-xs text-muted-foreground">Check your network and try refreshing</p>
                  </div>
                )}
                {!officersLoading && !officersError && officers.length === 0 && (
                  <div className="flex flex-col items-center gap-1 py-4 text-center">
                    <User className="h-6 w-6 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground font-medium">No officers on shift</p>
                    <p className="text-xs text-muted-foreground">Start a shift or assign manually</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* ── Job Detail / Dispatch Dialog ────────────────────────────────────── */}
      {selectedJob && (
        <Dialog open onOpenChange={() => setSelectedJob(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">{selectedJob.job_number}</span>
                {selectedJob.title}
              </DialogTitle>
              <DialogDescription className="flex gap-2 flex-wrap mt-1">
                <Badge variant="outline" className={PRIORITY_CONFIG[selectedJob.priority].className}>
                  {PRIORITY_CONFIG[selectedJob.priority].label}
                </Badge>
                <Badge variant="outline" className={`${STATUS_CONFIG[selectedJob.status].colour} ${STATUS_CONFIG[selectedJob.status].border}`}>
                  {STATUS_CONFIG[selectedJob.status].label}
                </Badge>
                {selectedJob.sla_breached && <Badge variant="destructive">SLA Breached</Badge>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 bg-muted/40 rounded-lg p-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Job Type</p><p className="font-medium">{JOB_TYPE_LABELS[selectedJob.job_type] ?? selectedJob.job_type}</p></div>
                <div><p className="text-xs text-muted-foreground">Created</p><p className="font-medium">{formatDateTime(selectedJob.created_at)}</p></div>
                {selectedJob.alarm_type && <div className="col-span-2"><p className="text-xs text-muted-foreground">Alarm Type</p><p className="font-medium">{ALARM_TYPE_LABELS[selectedJob.alarm_type] ?? selectedJob.alarm_type}</p></div>}
                {selectedJob.address && <div className="col-span-2"><p className="text-xs text-muted-foreground">Address</p><p className="font-medium">{selectedJob.address}</p></div>}
                {selectedJob.client_site && <div className="col-span-2"><p className="text-xs text-muted-foreground">Site</p><p className="font-medium">{selectedJob.client_site.name}</p></div>}
                {selectedJob.caller_name && <div><p className="text-xs text-muted-foreground">Caller</p><p className="font-medium">{selectedJob.caller_name}</p></div>}
                {selectedJob.caller_phone && <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{selectedJob.caller_phone}</p></div>}
                {selectedJob.description && <div className="col-span-2"><p className="text-xs text-muted-foreground">Details</p><p>{selectedJob.description}</p></div>}
              </div>

              {/* Timeline */}
              <div className="space-y-1 text-xs">
                {[
                  { label: 'Created',     time: selectedJob.created_at     },
                  { label: 'Dispatched',  time: selectedJob.dispatched_at  },
                  { label: 'Acknowledged',time: selectedJob.acknowledged_at},
                  { label: 'On Scene',    time: selectedJob.on_scene_at    },
                  { label: 'Completed',   time: selectedJob.completed_at   },
                ].filter(t => t.time).map(t => (
                  <div key={t.label} className="flex justify-between text-muted-foreground">
                    <span>{t.label}</span>
                    <span>{formatDateTime(t.time!)}</span>
                  </div>
                ))}
              </div>

              {/* Biosecurity context panel */}
              {selectedJob.job_type === 'biosecurity_inspection' && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3 space-y-2 text-xs">
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                    🌿 Biosecurity Context
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(selectedJob as any).context?.species_suspected && (
                      <div className="col-span-2"><span className="text-muted-foreground">Species Suspected: </span><span className="font-medium">{(selectedJob as any).context.species_suspected}</span></div>
                    )}
                    {(selectedJob as any).context?.has_infestation_zone !== undefined && (
                      <div><span className="text-muted-foreground">Known Zone: </span><span className="font-medium">{(selectedJob as any).context.has_infestation_zone ? 'Yes' : 'No'}</span></div>
                    )}
                    {(selectedJob as any).context?.prior_notices !== undefined && (
                      <div><span className="text-muted-foreground">Prior Notices: </span><span className="font-medium">{(selectedJob as any).context.prior_notices}</span></div>
                    )}
                    {(selectedJob as any).context?.management_plan_status && (
                      <div className="col-span-2"><span className="text-muted-foreground">Mgmt Plan: </span><span className="font-medium capitalize">{(selectedJob as any).context.management_plan_status}</span></div>
                    )}
                  </div>
                </div>
              )}

              {/* Smoke Complaint OOH context panel */}
              {selectedJob.job_type === 'smoke_complaint_ooh' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2 text-xs">
                  <p className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    💨 Smoke Complaint Context
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(selectedJob as any).context?.complaint_time && (
                      <div className="col-span-2"><span className="text-muted-foreground">Complaint Received: </span><span className="font-medium">{formatDateTime((selectedJob as any).context.complaint_time)}</span></div>
                    )}
                    {(selectedJob as any).context?.is_out_of_hours !== undefined && (
                      <div><span className="text-muted-foreground">OOH: </span>
                        {(selectedJob as any).context.is_out_of_hours
                          ? <span className="font-semibold text-amber-700 bg-amber-100 rounded px-1">YES</span>
                          : <span className="font-medium">No</span>}
                      </div>
                    )}
                    {(selectedJob as any).context?.prior_incidents !== undefined && (
                      <div><span className="text-muted-foreground">Prior Incidents: </span><span className="font-medium">{(selectedJob as any).context.prior_incidents}</span></div>
                    )}
                    {(selectedJob as any).context?.complaint_description && (
                      <div className="col-span-2"><span className="text-muted-foreground">Description: </span><span>{(selectedJob as any).context.complaint_description}</span></div>
                    )}
                  </div>
                </div>
              )}

              {/* Dispatch controls */}
              {selectedJob.status === 'pending' && (
                <div className="space-y-2 pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <Label>Assign to Officer</Label>
                    {selectedJob.gps_lat && selectedJob.gps_lng && (
                      <span className="text-[10px] text-green-700 dark:text-green-400 flex items-center gap-1">
                        <Navigation className="h-3 w-3" />
                        Ranked by proximity
                      </span>
                    )}
                  </div>
                  <Select value={assignTarget} onValueChange={setAssignTarget}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select officer…" />
                    </SelectTrigger>
                    <SelectContent>
                      {officers.filter(o => o.is_on_shift).map((o, idx) => (
                        <SelectItem key={o.id} value={o.id}>
                          <div className="flex items-center gap-2 w-full">
                            {/* Rank badge when proximity-sorted */}
                            {selectedJob.gps_lat && idx < 3 && (
                              <span className={`text-[10px] font-bold rounded px-1 leading-tight shrink-0 ${
                                idx === 0 ? 'bg-green-100 text-green-700' :
                                idx === 1 ? 'bg-blue-100 text-blue-700' :
                                            'bg-gray-100 text-gray-600'
                              }`}>
                                #{idx + 1}
                              </span>
                            )}
                            <span>
                              {o.first_name} {o.last_name}
                            </span>
                            {/* Distance badge */}
                            {o.distance_km !== null && (
                              <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5 font-medium shrink-0">
                                {formatDistance(o.distance_km)}
                              </span>
                            )}
                            {/* GPS age warning */}
                            {o.gps_age_minutes !== null && o.gps_age_minutes > 30 && (
                              <span className="text-[10px] text-amber-600 shrink-0">
                                GPS {o.gps_age_minutes}m old
                              </span>
                            )}
                            {/* No GPS */}
                            {o.distance_km === null && !selectedJob.gps_lat && (
                              <span className="text-[10px] text-muted-foreground">
                                {o.active_job_count > 0 ? `${o.active_job_count} jobs` : 'Available'}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                      {/* Off-shift officers (below fold) */}
                      {officers.filter(o => !o.is_on_shift).length > 0 && (
                        <>
                          <div className="px-2 py-1.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide border-t mt-1">
                            Off shift
                          </div>
                          {officers.filter(o => !o.is_on_shift).map(o => (
                            <SelectItem key={o.id} value={o.id} className="opacity-60">
                              {o.first_name} {o.last_name}
                              {o.distance_km !== null && (
                                <span className="ml-2 text-[10px] text-muted-foreground">
                                  {formatDistance(o.distance_km)}
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>

                  {/* Top-3 Recommended Officers — quick-assign panel (B-03) */}
                  {topRecommendedOfficers.length > 0 && selectedJob.status === 'pending' && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <Zap className="h-3 w-3 text-amber-500" />
                        Recommended
                        {selectedJob.gps_lat && <span className="text-green-600"> · sorted by proximity</span>}
                      </p>
                      {topRecommendedOfficers.map((o, idx) => {
                        const isSelected = assignTarget === o.id
                        const rankColors = [
                          'border-green-300 bg-green-50 dark:bg-green-950/20',
                          'border-blue-200 bg-blue-50 dark:bg-blue-950/20',
                          'border-gray-200 bg-gray-50 dark:bg-[#1E1E1E]/70',
                        ]
                        const rankBadgeColors = [
                          'bg-green-100 text-green-700',
                          'bg-blue-100 text-blue-700',
                          'bg-gray-100 text-gray-600',
                        ]
                        return (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => setAssignTarget(o.id)}
                            className={`w-full flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 ${
                              isSelected
                                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                                : rankColors[idx]
                            }`}
                          >
                            <span className={`text-[10px] font-bold rounded px-1 leading-tight shrink-0 ${rankBadgeColors[idx]}`}>
                              #{idx + 1}
                            </span>
                            <span className="font-medium truncate flex-1">
                              {o.first_name} {o.last_name}
                            </span>
                            {o.distance_km !== null && (
                              <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5 font-medium shrink-0">
                                {formatDistance(o.distance_km)}
                              </span>
                            )}
                            {o.distance_km !== null && (
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {formatEta(estimateEtaMinutes(o.distance_km))}
                              </span>
                            )}
                            {o.active_job_count > 0 && (
                              <span className="text-[10px] text-amber-600 shrink-0">
                                {o.active_job_count} job{o.active_job_count !== 1 ? 's' : ''}
                              </span>
                            )}
                            {o.distance_km === null && o.active_job_count === 0 && (
                              <span className="text-[10px] text-muted-foreground shrink-0">Available</span>
                            )}
                            {isSelected && (
                              <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* Nearest officer hint (shown when no top-recommended cards rendered) */}
                  {nearestOfficer && topRecommendedOfficers.length === 0 && (
                    <p className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/20 rounded px-2 py-1.5 flex items-center gap-1.5">
                      <Navigation className="h-3 w-3 shrink-0" />
                      Nearest: <strong>{nearestOfficer.first_name} {nearestOfficer.last_name}</strong>
                      <span className="ml-1 font-semibold">{formatDistance(nearestOfficer.distance_km)}</span>
                      {nearestOfficer.distance_km !== null && (
                        <span className="ml-0.5">· {formatEta(estimateEtaMinutes(nearestOfficer.distance_km))}</span>
                      )}
                      away
                      {nearestOfficer.active_job_count > 0 && (
                        <span className="ml-1 text-amber-600">· {nearestOfficer.active_job_count} active job{nearestOfficer.active_job_count !== 1 ? 's' : ''}</span>
                      )}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground rounded px-2 py-1.5 bg-muted/40">
                    Dispatcher traffic runs on the employer-wide dispatch radio net so branch dispatchers can coordinate across all authorized employer locations.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              {['pending', 'dispatched', 'acknowledged', 'en_route'].includes(selectedJob.status) && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive mr-auto"
                  onClick={() => cancelMutation.mutate(selectedJob.id)}
                  disabled={cancelMutation.isPending}
                >
                  <XCircle className="h-4 w-4 mr-1.5" /> Cancel Job
                </Button>
              )}
              {/* Replan Route — visible when job is active and officer has a route instance */}
              {['dispatched', 'acknowledged', 'en_route'].includes(selectedJob.status) && selectedJob.assigned_officer && isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    replanMutation.mutate({
                      dispatchJobId: selectedJob.id,
                      replannedBy:   user?.id,
                    })
                  }
                  disabled={replanMutation.isPending}
                  title="Pause active patrol route and replan remaining stops around this job"
                >
                  {replanMutation.isPending ? 'Replanning…' : '🔀 Replan Route'}
                </Button>
              )}
              <Button variant="outline" onClick={() => setSelectedJob(null)}>Close</Button>
              {selectedJob.status === 'pending' && (
                <Button
                  disabled={!assignTarget || dispatchMutation.isPending}
                  onClick={() => dispatchMutation.mutate({ jobId: selectedJob.id, officerId: assignTarget })}
                >
                  <Zap className="h-4 w-4 mr-1.5" /> Dispatch
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Create Job Dialog ────────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={v => { setShowCreate(v); if (!v) setForm(emptyForm()) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="dispatch-form-title">New Dispatch Job</DialogTitle>
            <DialogDescription>Create a new job and optionally dispatch it immediately.</DialogDescription>
          </DialogHeader>
          <form data-testid="dispatch-form" onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Job Type</Label>
                <Select value={form.job_type} onValueChange={v => setForm(f => ({ ...f, job_type: v, alarm_type: ALARM_JOB_TYPES.has(v) ? f.alarm_type : '' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(JOB_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as JobForm['priority'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['low','normal','high','urgent'].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {ALARM_JOB_TYPES.has(form.job_type) && (
              <div className="space-y-1.5">
                <Label>Alarm Type</Label>
                <Select value={form.alarm_type || '__none__'} onValueChange={v => setForm(f => ({ ...f, alarm_type: v === '__none__' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Select alarm type…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not specified —</SelectItem>
                    {Object.entries(ALARM_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input placeholder="Brief job description…" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Address / Location</Label>
                <Input placeholder="Street address…" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Zone</Label>
                <Select value={form.zone_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, zone_id: v === '__none__' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Select zone…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No zone</SelectItem>
                    {(dispatchZones as any[]).map((z: any) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Client Site</Label>
                <Select value={form.client_site_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, client_site_id: v === '__none__' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {(clientSites as any[]).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Caller Name</Label>
                <Input value={form.caller_name} onChange={e => setForm(f => ({ ...f, caller_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Caller Phone</Label>
                <Input type="tel" value={form.caller_phone} onChange={e => setForm(f => ({ ...f, caller_phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Response SLA (mins)</Label>
                <Input type="number" min="5" value={form.response_sla_minutes} onChange={e => setForm(f => ({ ...f, response_sla_minutes: parseInt(e.target.value) || 60 }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Additional Details</Label>
              <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Job'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
