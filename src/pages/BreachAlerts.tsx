import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  XCircle, 
  Search,
  Bell,
  Database,
  RefreshCw,
  ShieldAlert,
  UserX,
  Zap,
  Eye,
  MapPin,
  Car,
  Calendar,
  ChevronRight,
  Shield,
  Image as ImageIcon,
  History,
  Keyboard,
  Info,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { enrichVehicleFromMotorWeb } from '@/lib/railwayServices'
import { isPhotoUrlExpired, parseStorageUrl } from '@/lib/photoUtils'

// Schema-aligned BreachAlert type
// breach_alerts table columns (from 20260218_rebuild_breach_alerts_system.sql):
// - created_at (NOT detected_at)
// - status: pending | acknowledged | enforcement_started | resolved | dismissed
// - breach_type: consecutive_nights | monthly_limit | self_contained | after_hours | day_visit_violation | allowed_days_violation
// - NO resolved_by column (only resolved_at)
interface BreachAlert {
  id: string
  organization_id: string
  zone_id: string
  plate_number: string | null
  breach_type: string
  breach_details: any
  observation_id: string | null
  status: string
  created_at: string
  resolved_at: string | null
  notified_at: string | null
  notified_by: string | null
  due_date: string | null
  resolution_notes: string | null
  assigned_to: string | null
  assigned_at: string | null
  assigned_by: string | null
  admin_review_notes: string | null
}

const OBSERVATION_SELECT_FIELDS = 'id, photo_url, recorded_at, gps_latitude, gps_longitude, vehicle_make, vehicle_model, vehicle_year, vehicle_color, has_homeless_claim, homeless_claim_notes, officer_notes, zones!observations_zone_id_fkey(name)'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''

function getBreachObservationId(breach: BreachAlert | null): string | null {
  if (!breach) return null

  const details = breach.breach_details || {}
  return (
    breach.observation_id ||
    details.observation_id ||
    details.triggering_observation_id ||
    details.source_observation_id ||
    null
  )
}

async function resolveEvidencePhotoUrl(rawUrl: string | null | undefined): Promise<string | null> {
  if (!rawUrl) return null
  const url = rawUrl.trim()
  if (!url) return null

  if (url.startsWith('data:')) {
    return url
  }

  const maybeParsed = parseStorageUrl(url)
  if (maybeParsed) {
    if (url.includes('/storage/v1/object/sign/')) {
      const { data, error } = await supabase.storage
        .from(maybeParsed.bucket)
        .createSignedUrl(maybeParsed.path, 60 * 60)

      if (!error && data?.signedUrl) {
        return data.signedUrl
      }

      const { data: publicData } = supabase.storage.from(maybeParsed.bucket).getPublicUrl(maybeParsed.path)
      return publicData.publicUrl || url
    }

    if (url.includes('/storage/v1/object/public/')) {
      return url
    }

    if (isPhotoUrlExpired(url)) {
      const { data, error } = await supabase.storage
        .from(maybeParsed.bucket)
        .createSignedUrl(maybeParsed.path, 60 * 60)

      if (!error && data?.signedUrl) {
        return data.signedUrl
      }
    }

    return url
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  if (url.startsWith('/storage/v1/object/')) {
    const absoluteStorageUrl = SUPABASE_URL ? `${SUPABASE_URL}${url}` : null
    if (!absoluteStorageUrl) return null

    const parsedAbsolute = parseStorageUrl(absoluteStorageUrl)
    if (!parsedAbsolute) return absoluteStorageUrl

    if (absoluteStorageUrl.includes('/storage/v1/object/sign/')) {
      const { data, error } = await supabase.storage
        .from(parsedAbsolute.bucket)
        .createSignedUrl(parsedAbsolute.path, 60 * 60)

      if (!error && data?.signedUrl) {
        return data.signedUrl
      }
    }

    return absoluteStorageUrl
  }

  const normalizedPath = url.replace(/^\/+/, '')

  const bucketPrefixed = normalizedPath.match(/^(scans|evidence|incident-evidence)\/(.+)$/)
  if (bucketPrefixed) {
    const [, bucket, path] = bucketPrefixed
    const { data: signedData, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
    if (!error && signedData?.signedUrl) {
      return signedData.signedUrl
    }

    const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path)
    return publicData.publicUrl || null
  }

  const { data: signedData, error } = await supabase.storage.from('scans').createSignedUrl(normalizedPath, 60 * 60)
  if (!error && signedData?.signedUrl) {
    return signedData.signedUrl
  }

  const { data: publicData } = supabase.storage.from('scans').getPublicUrl(normalizedPath)
  return publicData.publicUrl || null
}

function formatVehicleDescription(make: string | null, model: string | null, year: number | null, color: string | null): string {
  return [year, make, model, color].filter(Boolean).join(' ')
}

const CANNED_REJECTION_REASONS = [
  'Evidence Inconclusive',
  'Officer Error',
  'Vehicle Exempt',
  'Within Permitted Limits',
  'Duplicate Submission',
  'Vehicle No Longer Present',
]

export default function BreachAlerts() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const {
    organizationId,
    zoneId,
    dateFrom,
    dateTo,
    setDateRange,
    setOrganization,
    setZone,
  } = useGlobalFiltersStore()
  const [searchParams] = useSearchParams()
  const effectiveOrganizationId =
    user?.role === 'master' ? organizationId || null : user?.organization_id || null
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [enrichingVehicle, setEnrichingVehicle] = useState<string | null>(null)
  const [resolveNotes, setResolveNotes] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [activeTab, setActiveTab] = useState<'evidence' | 'rapsheet'>('evidence')

  // 3-Zone state
  const [activeBreachId, setActiveBreachId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const queryClient = useQueryClient()

  useEffect(() => {
    const status = searchParams.get('status')
    if (status) {
      setStatusFilter(status)
    }

    const search = searchParams.get('search')
    if (search) {
      setSearchQuery(search)
    }

    const qDateFrom = searchParams.get('dateFrom')
    const qDateTo = searchParams.get('dateTo')
    if (qDateFrom && qDateTo) {
      setDateRange(qDateFrom, qDateTo, 'custom')
    }

    const qOrgId = searchParams.get('orgId')
    if (qOrgId && user?.role === 'master') {
      setOrganization(qOrgId, null)
    }

    const qZoneId = searchParams.get('zoneId')
    if (qZoneId) {
      setZone(qZoneId, null)
    }
  }, [searchParams, setDateRange, setOrganization, setZone, user?.role])

  // ── Intelligence Alerts: breach alerts requiring attention ─────────────────
  const { data: intelligenceAlerts } = useQuery({
    queryKey: ['intelligence-alerts', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let q = (supabase.from('breach_alerts') as any)
        .select('id, plate_number, breach_type, created_at, status, zones!zone_id(name)')
        .in('status', ['pending', 'acknowledged', 'enforcement_started'])
        .order('created_at', { ascending: false })
        .limit(10)

      if (effectiveOrganizationId) {
        q = q.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate) q = q.lte('created_at', endDate)

      const { data } = await q
      return data || []
    },
  })

  // ── Safety Alerts: officer unexpected departures (welfare inactivity) ──────
  const { data: safetyAlerts } = useQuery({
    queryKey: ['safety-alerts', effectiveOrganizationId, dateFrom, dateTo],
    queryFn: async () => {
      let q = (supabase.from('officer_welfare_alerts') as any)
        .select('id, officer_name, alert_type, status, created_at, gps_latitude, gps_longitude')
        .in('status', ['pending', 'acknowledged'])
        .order('created_at', { ascending: false })
        .limit(10)

      if (effectiveOrganizationId) {
        q = q.eq('organization_id', effectiveOrganizationId)
      }
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate) q = q.lte('created_at', endDate)

      const { data } = await q
      return data || []
    },
  })

  // Fetch breach alerts (use created_at, not detected_at)
  const { data: breaches, isLoading, isError: breachesIsError, error: breachesError } = useQuery({
    queryKey: ['breach-alerts', effectiveOrganizationId, zoneId, statusFilter, searchQuery, dateFrom, dateTo],
    queryFn: async () => {
      const applyFilters = (query: any) => {
        if (effectiveOrganizationId) query = query.eq('organization_id', effectiveOrganizationId)
        if (zoneId) query = query.eq('zone_id', zoneId)
        if (startDate) query = query.gte('created_at', startDate)
        if (endDate) query = query.lte('created_at', endDate)
        if (statusFilter !== 'all') query = query.eq('status', statusFilter)
        if (searchQuery) query = query.ilike('plate_number', `%${searchQuery}%`)
        return query
      }

      // Primary path with joined labels.
      let primaryQuery = (supabase.from('breach_alerts') as any)
        .select(`
          *,
          zones!zone_id(name),
          organizations!organization_id(name)
        `)
        .order('created_at', { ascending: false })

      primaryQuery = applyFilters(primaryQuery)
      const primary = await primaryQuery.limit(100)
      if (!primary.error) return primary.data || []

      // Fallback path if relationship join is unavailable or policy blocks join targets.
      let fallbackQuery = (supabase.from('breach_alerts') as any)
        .select('*')
        .order('created_at', { ascending: false })

      fallbackQuery = applyFilters(fallbackQuery)
      const fallback = await fallbackQuery.limit(100)
      if (fallback.error) throw fallback.error

      return (fallback.data || []).map((row: any) => ({
        ...row,
        zones: null,
        organizations: null,
      }))
    },
    retry: 1,
  })

  useEffect(() => {
    if (!breachesIsError) return
    toast.error('Failed to load breaches', {
      description: (breachesError as any)?.message || 'Unknown error loading breach queue',
      duration: 8000,
    })
  }, [breachesIsError, breachesError])

  // Derived: active breach from the list
  const activeBreach = breaches?.find((b: any) => b.id === activeBreachId) || null

  // Fetch enriched vehicle data for the active breach
  const { data: detailVehicle } = useQuery({
    queryKey: ['breach-vehicle', activeBreach?.plate_number],
    queryFn: async () => {
      if (!activeBreach?.plate_number) return null
      const { data } = await (supabase.from('canonical_vehicles') as any)
        .select('*')
        .eq('plate_number', activeBreach.plate_number)
        .single()
      return data
    },
    enabled: !!activeBreach?.plate_number,
  })

  // Fetch the specific observation that triggered this breach
  const { data: triggeringObservation } = useQuery({
    queryKey: ['breach-triggering-obs', activeBreach?.id],
    queryFn: async () => {
      if (!activeBreach) return null
      // Try to fetch via the breach's observation_id FK first, then breach_details
      const observationId = getBreachObservationId(activeBreach)
      if (observationId) {
        const { data } = await (supabase.from('observations') as any)
          .select(OBSERVATION_SELECT_FIELDS)
          .eq('id', observationId)
          .single()
        return data || null
      }
      // Fallback: look for the most recent observation at or before the breach was created
      const { data } = await (supabase.from('observations') as any)
        .select(OBSERVATION_SELECT_FIELDS)
        .eq('plate_number', activeBreach.plate_number)
        .eq('organization_id', activeBreach.organization_id)
        .lte('recorded_at', activeBreach.created_at)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single()
      return data || null
    },
    enabled: !!activeBreach,
  })

  // Fetch evidence photos from observations for the active breach
  const { data: evidencePhotos } = useQuery({
    queryKey: ['breach-evidence-photos', activeBreach?.id, activeBreach?.plate_number, activeBreach?.created_at],
    queryFn: async () => {
      if (!activeBreach?.plate_number) return []

      const normalizePhotos = async (rows: any[]) => {
        const resolved = await Promise.all(
          (rows || []).map(async (row: any) => ({
            ...row,
            display_url: await resolveEvidencePhotoUrl(row.photo_url),
          }))
        )

        return resolved.filter((row: any) => !!row.display_url)
      }

      const observationId = getBreachObservationId(activeBreach)
      if (observationId) {
        const byId = await (supabase.from('observations') as any)
          .select('id, photo_url, recorded_at, gps_latitude, gps_longitude, zones!observations_zone_id_fkey(name)')
          .eq('id', observationId)
          .limit(1)

        const normalized = await normalizePhotos(byId.data || [])
        if (normalized.length > 0) {
          return normalized
        }
      }

      const strictQuery = (supabase.from('observations') as any)
        .select('id, photo_url, recorded_at, gps_latitude, gps_longitude, zones!observations_zone_id_fkey(name)')
        .eq('plate_number', activeBreach.plate_number)
        .eq('organization_id', activeBreach.organization_id)
        .lte('recorded_at', activeBreach.created_at)
        .not('photo_url', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(12)

      const strict = await strictQuery
      const strictNormalized = await normalizePhotos(strict.data || [])
      if (strictNormalized.length > 0) {
        return strictNormalized
      }

      // Fallback: ignore org/date constraints when data quality is inconsistent.
      const fallback = await (supabase.from('observations') as any)
        .select('id, photo_url, recorded_at, gps_latitude, gps_longitude, zones!observations_zone_id_fkey(name)')
        .eq('plate_number', activeBreach.plate_number)
        .not('photo_url', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(12)

      return await normalizePhotos(fallback.data || [])
    },
    enabled: !!activeBreach?.plate_number,
  })

  // Fetch vehicle breach history (rap sheet) – all previous breaches for this plate
  const { data: vehicleHistory } = useQuery({
    queryKey: ['breach-history', activeBreach?.plate_number],
    queryFn: async () => {
      if (!activeBreach?.plate_number) return []
      const { data } = await (supabase.from('breach_alerts') as any)
        .select('id, breach_type, status, created_at, resolved_at, zones!zone_id(name)')
        .eq('organization_id', activeBreach.organization_id)
        .eq('plate_number', activeBreach.plate_number)
        .neq('id', activeBreach.id)
        .order('created_at', { ascending: false })
        .limit(20)
      return data || []
    },
    enabled: !!activeBreach?.plate_number,
  })

  // Acknowledge (was "notify") – correct status value per schema
  const acknowledgeMutation = useMutation({
    mutationFn: async (breachId: string) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({ 
          status: 'acknowledged',
          notified_at: new Date().toISOString(),
          notified_by: user?.id,
        })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['intelligence-alerts'] })
      toast.success('Breach acknowledged')
    },
    onError: () => toast.error('Failed to acknowledge breach'),
  })

  // Mark as enforcement started
  const enforcementMutation = useMutation({
    mutationFn: async (breachId: string) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({ status: 'enforcement_started', assigned_by: user?.id, assigned_at: new Date().toISOString() })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Enforcement started')
    },
    onError: () => toast.error('Failed to start enforcement'),
  })

  // Resolve breach – schema has no resolved_by column
  const resolveMutation = useMutation({
    mutationFn: async ({ breachId, notes }: { breachId: string; notes: string }) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({ 
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolution_notes: notes || null,
        })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['intelligence-alerts'] })
      setResolveNotes('')
      toast.success('Breach marked as resolved')
    },
    onError: () => toast.error('Failed to resolve breach'),
  })

  // Dismiss breach
  const dismissMutation = useMutation({
    mutationFn: async ({ breachId, reason }: { breachId: string; reason?: string }) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({ 
          status: 'dismissed',
          resolution_notes: reason || null,
        })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Breach dismissed')
    },
    onError: () => toast.error('Failed to dismiss breach'),
  })

  // Welfare alert acknowledgement
  const acknowledgeWelfareMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await (supabase.from('officer_welfare_alerts') as any)
        .update({ status: 'acknowledged', acknowledged_by: user?.id, acknowledged_at: new Date().toISOString() })
        .eq('id', alertId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safety-alerts'] })
      toast.success('Welfare alert acknowledged')
    },
    onError: () => toast.error('Failed to acknowledge welfare alert'),
  })

  // MotorWeb enrichment
  const handleEnrichVehicle = async (plateNumber: string) => {
    if (!plateNumber) return
    setEnrichingVehicle(plateNumber)
    try {
      const { data, error } = await enrichVehicleFromMotorWeb(plateNumber)
      if (error) {
        toast.error(error)
        return
      }
      if (data) {
        const { error: updateError } = await (supabase.from('canonical_vehicles') as any)
          .update({
            make: data.make,
            model: data.model,
            year: data.year,
            colour: data.colour,
            body_style: data.body_style,
            owner_first_name: data.owner_name?.split(' ')[0] || null,
            owner_last_name: data.owner_name?.split(' ').slice(1).join(' ') || null,
            owner_address: data.owner_address,
          })
          .eq('plate_number', plateNumber)

        if (updateError) {
          toast.error('Failed to save enriched vehicle data')
          return
        }
        queryClient.invalidateQueries({ queryKey: ['breach-vehicle', plateNumber] })
        toast.success('Vehicle data enriched from MotorWeb')
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to enrich from MotorWeb')
    } finally {
      setEnrichingVehicle(null)
    }
  }

  // ── Decision Dock actions ─────────────────────────────────────────────────

  const handleIssueEnforcement = useCallback(() => {
    if (!activeBreach) return
    if (!['pending', 'acknowledged'].includes(activeBreach.status)) {
      toast.warning('Cannot issue enforcement for this status')
      return
    }
    enforcementMutation.mutate(activeBreach.id)
  }, [activeBreach, enforcementMutation])

  const handleIssueWarning = useCallback(() => {
    if (!activeBreach) return
    if (activeBreach.status !== 'pending') {
      toast.warning('Warning can only be issued for pending breaches')
      return
    }
    acknowledgeMutation.mutate(activeBreach.id)
  }, [activeBreach, acknowledgeMutation])

  const handleReject = useCallback(() => {
    if (!activeBreach) return
    if (['resolved', 'dismissed'].includes(activeBreach.status)) {
      toast.warning('Breach is already closed')
      return
    }
    dismissMutation.mutate({ breachId: activeBreach.id, reason: rejectionReason || undefined })
    setRejectionReason('')
  }, [activeBreach, dismissMutation, rejectionReason])

  const handleResolve = () => {
    if (!activeBreach) return
    resolveMutation.mutate({ breachId: activeBreach.id, notes: resolveNotes })
  }

  // ── Queue navigation ──────────────────────────────────────────────────────

  const navigateQueue = useCallback((direction: number) => {
    if (!breaches || breaches.length === 0) return
    if (!activeBreachId) {
      setActiveBreachId(breaches[0].id)
      return
    }
    const currentIndex = breaches.findIndex((b: any) => b.id === activeBreachId)
    const nextIndex = currentIndex + direction
    if (nextIndex >= 0 && nextIndex < breaches.length) {
      setActiveBreachId(breaches[nextIndex].id)
    }
  }, [activeBreachId, breaches])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Navigation: arrow keys always work if queue is loaded
      if (e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement).tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault()
          navigateQueue(1)
        }
        return
      }
      if (e.key === 'ArrowUp' && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement).tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault()
          navigateQueue(-1)
        }
        return
      }
      if (e.key === 'Escape') {
        setActiveBreachId(null)
        return
      }
      if (!activeBreach) return
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'Enter') { e.preventDefault(); handleIssueEnforcement(); return }
        if (e.key === 'w') { e.preventDefault(); handleIssueWarning(); return }
        if (e.key === 'r') { e.preventDefault(); handleReject(); return }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeBreach, handleIssueEnforcement, handleIssueWarning, handleReject, navigateQueue])

  const handleSelectBreach = (breachId: string) => {
    setActiveBreachId(breachId)
    setResolveNotes('')
    setRejectionReason('')
    setActiveTab('evidence')
  }

  const openObservationRecords = useCallback(
    (plateNumber: string | null) => {
      if (!plateNumber) return
      navigate(`/observation-records?plate=${encodeURIComponent(plateNumber)}`)
    },
    [navigate]
  )

  // ── Multi-select helpers ──────────────────────────────────────────────────

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = (checked: boolean) => {
    if (checked && breaches) {
      setSelectedIds(new Set(breaches.map((b: any) => b.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleBulkAcknowledge = async () => {
    const ids = Array.from(selectedIds)
    const pendingIds = ids.filter(id => {
      const b = breaches?.find((b: any) => b.id === id)
      return b?.status === 'pending'
    })
    if (pendingIds.length === 0) { toast.warning('No pending breaches selected'); return }
    await Promise.all(pendingIds.map(id => acknowledgeMutation.mutateAsync(id)))
    setSelectedIds(new Set())
    toast.success(`${pendingIds.length} breach(es) acknowledged`)
  }

  const handleBulkDismiss = async () => {
    const ids = Array.from(selectedIds)
    const dismissableIds = ids.filter(id => {
      const b = breaches?.find((b: any) => b.id === id)
      return b && !['resolved', 'dismissed'].includes(b.status)
    })
    if (dismissableIds.length === 0) { toast.warning('No dismissable breaches selected'); return }
    await Promise.all(dismissableIds.map(id => dismissMutation.mutateAsync({ breachId: id })))
    setSelectedIds(new Set())
    toast.success(`${dismissableIds.length} breach(es) dismissed`)
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  const stats = breaches ? {
    total: breaches.length,
    pending: breaches.filter((b: any) => b.status === 'pending').length,
    acknowledged: breaches.filter((b: any) => b.status === 'acknowledged').length,
    enforcement: breaches.filter((b: any) => b.status === 'enforcement_started').length,
    resolved: breaches.filter((b: any) => b.status === 'resolved').length,
  } : null

  // ── Style helpers ─────────────────────────────────────────────────────────

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-3 w-3" />
      case 'acknowledged': return <Bell className="h-3 w-3" />
      case 'enforcement_started': return <ShieldAlert className="h-3 w-3" />
      case 'resolved': return <CheckCircle className="h-3 w-3" />
      case 'dismissed': return <XCircle className="h-3 w-3" />
      default: return <XCircle className="h-3 w-3" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
      case 'acknowledged': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
      case 'enforcement_started': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
      case 'resolved': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
      case 'dismissed': return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  // Corrected breach type labels per 20260218_rebuild_breach_alerts_system.sql
  const getBreachTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      consecutive_nights: 'Consecutive Nights Exceeded',
      monthly_limit: 'Monthly Night Limit Exceeded',
      self_contained: 'Self-Contained Certification',
      after_hours: 'After Hours / Outside Permitted Period',
      day_visit_violation: 'Day Visit Violation',
      allowed_days_violation: 'Allowed Days Violation',
      // Legacy labels kept for backwards compatibility
      overstay: 'Overstay',
      no_self_contained: 'No Self-Contained',
      unauthorized_zone: 'Unauthorized Zone',
      nights_exceeded: 'Nights Exceeded',
    }
    return labels[type] || type.replace(/_/g, ' ')
  }

  const allSelected = breaches && breaches.length > 0 && selectedIds.size === breaches.length

  return (
    <AppLayout title="Breach & Safety Alerts" description="3-Zone Adjudication Centre" showBackButton>
      <GlobalFilterRibbon />

      {/* ── Intelligence & Safety Alert Banners ──────────────────────────── */}
      {intelligenceAlerts && intelligenceAlerts.length > 0 && (
        <Card className="border-red-400 bg-red-50 dark:bg-red-950/30 mb-3">
          <div className="p-4">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-semibold mb-2">
              <Zap className="h-4 w-4" />
              Intelligence Alert – Restricted Zone / After-Hours Violations ({intelligenceAlerts.length})
            </div>
            <div className="space-y-2">
              {intelligenceAlerts.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-red-600" />
                    <span className="font-bold">{a.plate_number || 'Unknown'}</span>
                    <Badge variant="outline" className="text-xs">
                      {getBreachTypeLabel(a.breach_type)}
                    </Badge>
                    <span className="text-gray-500 flex items-center gap-1 text-xs">
                      <MapPin className="h-3 w-3" />
                      {(a.zones as any)?.name || 'Unknown Zone'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">{formatDateTime(a.created_at)}</span>
                    <Button size="sm" variant="outline" className="text-xs h-6 px-2"
                      onClick={() => acknowledgeMutation.mutate(a.id)}
                      disabled={acknowledgeMutation.isPending}>
                      Acknowledge
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {safetyAlerts && safetyAlerts.length > 0 && (
        <Card className="border-orange-400 bg-orange-50 dark:bg-orange-950/30 mb-3">
          <div className="p-4">
            <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400 font-semibold mb-2">
              <UserX className="h-4 w-4" />
              Safety Alert – Officer Inactivity / GPS Loss ({safetyAlerts.length})
            </div>
            <div className="space-y-2">
              {safetyAlerts.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-600" />
                    <span className="font-bold">{a.officer_name}</span>
                    <Badge variant="outline" className="capitalize text-xs">
                      {a.alert_type?.replace(/_/g, ' ')}
                    </Badge>
                    <Badge className={a.status === 'pending' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}>
                      {a.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">{formatDateTime(a.created_at)}</span>
                    <Button size="sm" variant="outline" className="text-xs h-6 px-2"
                      onClick={() => acknowledgeWelfareMutation.mutate(a.id)}
                      disabled={acknowledgeWelfareMutation.isPending}>
                      Acknowledge
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Stats Bar */}
      {stats && (
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
            <Info className="h-4 w-4" />
            <span className="font-semibold">{stats.total}</span> total
          </div>
          <div className="text-sm text-orange-600 flex items-center gap-1">
            <span className="font-semibold">{stats.pending}</span> pending
          </div>
          <div className="text-sm text-blue-600 flex items-center gap-1">
            <span className="font-semibold">{stats.acknowledged}</span> acknowledged
          </div>
          <div className="text-sm text-purple-600 flex items-center gap-1">
            <span className="font-semibold">{stats.enforcement}</span> enforcement
          </div>
          <div className="text-sm text-green-600 flex items-center gap-1">
            <span className="font-semibold">{stats.resolved}</span> resolved
          </div>
        </div>
      )}

      {/* ── 3-Zone Adjudication Workspace ────────────────────────────────── */}
      <div className="grid lg:grid-cols-[320px_1fr_288px] gap-4">

        {/* ── Zone 1: Queue (Left Rail) ─────────────────────────────────── */}
        <div className="flex flex-col border rounded-lg bg-white dark:bg-gray-800 overflow-hidden" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          {/* Search + Quick Filters */}
          <div className="p-3 border-b dark:border-gray-700 flex-shrink-0">
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search plate number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {[
                { key: 'all', label: 'All' },
                { key: 'pending', label: 'Pending' },
                { key: 'acknowledged', label: 'Ack' },
                { key: 'enforcement_started', label: 'Enforcing' },
                { key: 'resolved', label: 'Resolved' },
                { key: 'dismissed', label: 'Dismissed' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`text-xs px-2 py-1 rounded-full transition-colors ${
                    statusFilter === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Select All + Bulk Actions */}
          {breaches && breaches.length > 0 && (
            <div className="px-3 py-2 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex items-center gap-2 flex-shrink-0">
              <Checkbox
                id="select-all"
                checked={allSelected || false}
                onCheckedChange={(checked) => toggleSelectAll(!!checked)}
              />
              <label htmlFor="select-all" className="text-xs text-gray-500 cursor-pointer select-none">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
              </label>
              {selectedIds.size > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs ml-auto"
                    onClick={handleBulkAcknowledge}
                    disabled={acknowledgeMutation.isPending}
                  >
                    Ack All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs text-red-600 border-red-200 hover:bg-red-50"
                    onClick={handleBulkDismiss}
                    disabled={dismissMutation.isPending}
                  >
                    Dismiss All
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Breach Queue */}
          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="p-6 text-center text-gray-500 text-sm">Loading breaches...</div>
            ) : breachesIsError ? (
              <div className="p-6 text-center text-red-600 text-sm space-y-2">
                <p>Failed to load breaches.</p>
                <p className="text-xs text-gray-500">{(breachesError as any)?.message || 'Unknown error'}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })}
                >
                  Retry
                </Button>
              </div>
            ) : breaches && breaches.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-2" />
                <p className="text-sm">No breach alerts found</p>
              </div>
            ) : (
              breaches?.map((breach: any) => (
                <div
                  key={breach.id}
                  onClick={() => handleSelectBreach(breach.id)}
                  className={`flex items-start gap-2 p-3 border-b dark:border-gray-700 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${
                    activeBreachId === breach.id
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-500'
                      : ''
                  }`}
                >
                  <div
                    className="mt-0.5 flex-shrink-0"
                    onClick={(e) => toggleSelect(breach.id, e)}
                  >
                    <Checkbox checked={selectedIds.has(breach.id)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="font-mono font-bold text-sm">{breach.plate_number || 'Unknown'}</span>
                      {breach.plate_number && (
                        <button
                          type="button"
                          className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1"
                          onClick={(e) => {
                            e.stopPropagation()
                            openObservationRecords(breach.plate_number)
                          }}
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open Records
                        </button>
                      )}
                      <Badge className={`${getStatusColor(breach.status)} text-xs px-1.5 py-0 flex items-center gap-1`}>
                        {getStatusIcon(breach.status)}
                        <span className="capitalize">{breach.status?.replace(/_/g, ' ')}</span>
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {(breach.zones as any)?.name || 'Unknown Zone'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{getBreachTypeLabel(breach.breach_type)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(breach.created_at)}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Zone 2: Evidence Stage (Center) ──────────────────────────── */}
        <div
          className="hidden lg:flex flex-col border rounded-lg bg-white dark:bg-gray-800 overflow-hidden"
          style={{ maxHeight: 'calc(100vh - 260px)' }}
        >
          {activeBreach ? (
            <>
              {/* Header */}
              <div className="p-4 border-b dark:border-gray-700 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Car className="h-5 w-5 text-gray-500" />
                  <span className="font-mono font-bold text-xl">{activeBreach.plate_number || 'Unknown'}</span>
                  <Badge className={getStatusColor(activeBreach.status)}>
                    {getStatusIcon(activeBreach.status)}
                    <span className="ml-1 capitalize">{activeBreach.status?.replace(/_/g, ' ')}</span>
                  </Badge>
                </div>
                <div className="flex gap-3 mt-1 text-sm text-gray-500 flex-wrap">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {(activeBreach.zones as any)?.name || 'Unknown Zone'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDateTime(activeBreach.created_at)}
                  </span>
                  {activeBreach.due_date && (
                    <span className="flex items-center gap-1 text-red-600">
                      <Clock className="h-3 w-3" />
                      Due: {formatDateTime(activeBreach.due_date)}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-orange-700 dark:text-orange-400 mt-1">
                  {getBreachTypeLabel(activeBreach.breach_type)}
                </p>
                {activeBreach.plate_number && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 text-xs"
                    onClick={() => openObservationRecords(activeBreach.plate_number)}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Open Observation Records
                  </Button>
                )}
              </div>

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'evidence' | 'rapsheet')} className="flex flex-col flex-1 overflow-hidden">
                <TabsList className="mx-4 mt-3 flex-shrink-0 w-auto self-start">
                  <TabsTrigger value="evidence" className="flex items-center gap-1.5">
                    <ImageIcon className="h-4 w-4" />
                    Evidence
                  </TabsTrigger>
                  <TabsTrigger value="rapsheet" className="flex items-center gap-1.5">
                    <History className="h-4 w-4" />
                    Rap Sheet
                    {vehicleHistory && vehicleHistory.length > 0 && (
                      <Badge className="ml-1 bg-red-100 text-red-700 text-xs px-1 py-0">{vehicleHistory.length}</Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* Evidence Tab */}
                <TabsContent value="evidence" className="flex-1 overflow-y-auto p-4 mt-0 space-y-4">
                  {/* Breach details */}
                  {activeBreach.breach_details && Object.keys(activeBreach.breach_details).length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Breach Details</p>
                      <div className="flex flex-wrap gap-2">
                        {activeBreach.breach_details.nights_count && (
                          <Badge variant="outline" className="text-xs">{activeBreach.breach_details.nights_count} nights</Badge>
                        )}
                        {activeBreach.breach_details.consecutive_nights && (
                          <Badge variant="outline" className="text-xs">{activeBreach.breach_details.consecutive_nights} consecutive</Badge>
                        )}
                        {activeBreach.breach_details.max_allowed && (
                          <Badge variant="outline" className="text-xs text-orange-600">Max allowed: {activeBreach.breach_details.max_allowed}</Badge>
                        )}
                        {Object.entries(activeBreach.breach_details).map(([k, v]) => (
                          !['nights_count', 'consecutive_nights', 'max_allowed', 'observation_id'].includes(k) && (
                            <Badge key={k} variant="outline" className="text-xs capitalize">
                              {k.replace(/_/g, ' ')}: {String(v)}
                            </Badge>
                          )
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Homeless Claim Status */}
                  {triggeringObservation && (
                    <div className={`rounded-lg p-3 text-sm border ${triggeringObservation.has_homeless_claim ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800' : 'bg-gray-50 border-gray-200 dark:bg-gray-700/50 dark:border-gray-600'}`}>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Homeless Claim</p>
                      {triggeringObservation.has_homeless_claim ? (
                        <div>
                          <Badge className="bg-amber-500 text-white text-xs mb-1">⚠ Homeless Claim Recorded</Badge>
                          {triggeringObservation.homeless_claim_notes && (
                            <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">{triggeringObservation.homeless_claim_notes}</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">No homeless claim on file</p>
                      )}
                    </div>
                  )}

                  {/* Evidence Photos */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      Photo Evidence ({evidencePhotos?.length || 0})
                    </p>
                    {evidencePhotos && evidencePhotos.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {evidencePhotos.map((photo: any) => (
                          <div
                            key={photo.id}
                            className="relative rounded-lg overflow-hidden aspect-video cursor-pointer group border dark:border-gray-700"
                            onClick={() => window.open(photo.display_url, '_blank')}
                          >
                            <img
                              src={photo.display_url}
                              alt={`Evidence ${formatDateTime(photo.recorded_at)}`}
                              className="w-full h-full object-cover transition-transform group-hover:scale-105"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none'
                                const parent = (e.target as HTMLElement).parentElement
                                if (parent && !parent.querySelector('[data-photo-fallback="true"]')) {
                                  const placeholder = document.createElement('div')
                                  placeholder.setAttribute('data-photo-fallback', 'true')
                                  placeholder.className = 'absolute inset-0 flex items-center justify-center bg-gray-100 text-gray-500 text-xs'
                                  placeholder.innerText = 'Photo unavailable'
                                  parent.appendChild(placeholder)
                                }
                              }}
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDateTime(photo.recorded_at)}
                              </span>
                              {(photo.zones as any)?.name && (
                                <span className="flex items-center gap-1 mt-0.5">
                                  <MapPin className="h-3 w-3" />
                                  {(photo.zones as any).name}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-gray-400 border rounded-lg dark:border-gray-700">
                        <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        <p className="text-sm">No photos on file for this plate</p>
                      </div>
                    )}
                  </div>

                  {/* Vehicle Record */}
                  {detailVehicle ? (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Vehicle Record</p>
                      <div className="bg-blue-50 dark:bg-blue-950/50 rounded-lg p-3 text-sm space-y-1">
                        <p className="font-bold text-lg">{detailVehicle.plate_number}</p>
                        <p>{
                          formatVehicleDescription(detailVehicle.make, detailVehicle.model, detailVehicle.year, detailVehicle.colour) ||
                          (triggeringObservation ? formatVehicleDescription(triggeringObservation.vehicle_make, triggeringObservation.vehicle_model, triggeringObservation.vehicle_year, triggeringObservation.vehicle_color) : '') ||
                          'No vehicle description on file'
                        }</p>
                        {(detailVehicle.owner_first_name || detailVehicle.owner_last_name) && (
                          <p className="text-gray-600 dark:text-gray-400">
                            Owner: {[detailVehicle.owner_first_name, detailVehicle.owner_last_name].filter(Boolean).join(' ')}
                          </p>
                        )}
                        {detailVehicle.owner_address && (
                          <p className="text-gray-600 dark:text-gray-400 text-xs">
                            Address: {detailVehicle.owner_address}
                          </p>
                        )}
                        <div className="flex gap-2 pt-1 flex-wrap">
                          {detailVehicle.self_contained && (
                            <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950">Self-Contained</Badge>
                          )}
                          {detailVehicle.is_flagged && (
                            <Badge variant="outline" className="text-xs bg-red-50 dark:bg-red-950 text-red-700">Flagged</Badge>
                          )}
                          {detailVehicle.is_exempt && (
                            <Badge variant="outline" className="text-xs bg-blue-50 dark:bg-blue-950">Exempt</Badge>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2 w-full text-xs"
                          onClick={() => handleEnrichVehicle(activeBreach.plate_number!)}
                          disabled={!activeBreach.plate_number || enrichingVehicle === activeBreach.plate_number}
                        >
                          {enrichingVehicle === activeBreach.plate_number
                            ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Enriching...</>
                            : <><Database className="h-3 w-3 mr-1" />Re-fetch from MotorWeb</>
                          }
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Vehicle Record</p>
                      <div className="bg-blue-50 dark:bg-blue-950/50 rounded-lg p-3 text-sm space-y-1">
                        <p className="font-bold text-lg">{activeBreach.plate_number}</p>
                        {triggeringObservation && formatVehicleDescription(triggeringObservation.vehicle_make, triggeringObservation.vehicle_model, triggeringObservation.vehicle_year, triggeringObservation.vehicle_color) && (
                          <p className="text-gray-700 dark:text-gray-300">{formatVehicleDescription(triggeringObservation.vehicle_make, triggeringObservation.vehicle_model, triggeringObservation.vehicle_year, triggeringObservation.vehicle_color)}</p>
                        )}
                        {activeBreach.plate_number && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 w-full text-xs"
                            onClick={() => handleEnrichVehicle(activeBreach.plate_number!)}
                            disabled={enrichingVehicle === activeBreach.plate_number}
                          >
                            {enrichingVehicle === activeBreach.plate_number
                              ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enriching from MotorWeb...</>
                              : <><Database className="h-4 w-4 mr-2" />Fetch Vehicle Data (MotorWeb)</>
                            }
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Admin notes */}
                  {activeBreach.admin_review_notes && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Admin Notes</p>
                      <p className="text-sm text-gray-600 bg-yellow-50 dark:bg-yellow-950/30 rounded p-2">
                        {activeBreach.admin_review_notes}
                      </p>
                    </div>
                  )}
                </TabsContent>

                {/* Rap Sheet Tab */}
                <TabsContent value="rapsheet" className="flex-1 overflow-y-auto p-4 mt-0">
                  {vehicleHistory && vehicleHistory.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-3">
                        Previous Breaches for {activeBreach.plate_number} ({vehicleHistory.length})
                      </p>
                      {vehicleHistory.map((b: any) => (
                        <div key={b.id} className="border dark:border-gray-700 rounded-lg p-3 text-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={`${getStatusColor(b.status)} flex items-center gap-1 text-xs`}>
                              {getStatusIcon(b.status)}
                              <span className="capitalize">{b.status?.replace(/_/g, ' ')}</span>
                            </Badge>
                            <span className="text-gray-700 dark:text-gray-300 text-xs">
                              {getBreachTypeLabel(b.breach_type)}
                            </span>
                          </div>
                          <div className="flex gap-3 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {(b.zones as any)?.name || 'Unknown Zone'}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDateTime(b.created_at)}
                            </span>
                          </div>
                          {b.resolved_at && (
                            <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Resolved: {formatDateTime(b.resolved_at)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-400">
                      <History className="h-10 w-10 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">No prior breach history</p>
                      <p className="text-xs mt-1">First recorded breach for this vehicle</p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center p-6">
                <Eye className="h-14 w-14 mx-auto mb-4 opacity-20" />
                <p className="font-medium text-gray-500">Select a breach to review evidence</p>
                <p className="text-sm mt-2">Click any item in the queue to load its evidence here</p>
                <div className="mt-4 text-xs text-gray-400 space-y-1">
                  <p>↑↓ Navigate the queue</p>
                  <p>Esc  Deselect</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Zone 3: Decision Dock (Right) ─────────────────────────────── */}
        <div
          className="hidden lg:flex flex-col border rounded-lg bg-white dark:bg-gray-800 overflow-hidden"
          style={{ maxHeight: 'calc(100vh - 260px)' }}
        >
          {activeBreach ? (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b dark:border-gray-700 flex-shrink-0">
                <h3 className="font-semibold">Decision Dock</h3>
                <p className="text-xs text-gray-500">What is the verdict?</p>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Primary Decision Buttons */}
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white justify-between"
                  onClick={handleIssueEnforcement}
                  disabled={!['pending', 'acknowledged'].includes(activeBreach.status) || enforcementMutation.isPending}
                >
                  <span className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    ISSUE
                  </span>
                  <span className="text-xs opacity-75">⌃↵</span>
                </Button>

                <Button
                  className="w-full bg-yellow-500 hover:bg-yellow-600 text-white justify-between"
                  onClick={handleIssueWarning}
                  disabled={activeBreach.status !== 'pending' || acknowledgeMutation.isPending}
                >
                  <span className="flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    WARNING
                  </span>
                  <span className="text-xs opacity-75">⌃W</span>
                </Button>

                <Button
                  className="w-full bg-red-600 hover:bg-red-700 text-white justify-between"
                  onClick={handleReject}
                  disabled={['resolved', 'dismissed'].includes(activeBreach.status) || dismissMutation.isPending}
                >
                  <span className="flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    REJECT
                  </span>
                  <span className="text-xs opacity-75">⌃R</span>
                </Button>

                <div className="border-t dark:border-gray-700 pt-3">
                  <Label className="text-xs text-gray-500">Rejection Reason</Label>
                  <Select value={rejectionReason} onValueChange={setRejectionReason}>
                    <SelectTrigger className="h-9 mt-1 text-sm">
                      <SelectValue placeholder="Select canned reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CANNED_REJECTION_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-gray-500">Resolution Notes</Label>
                  <Textarea
                    value={resolveNotes}
                    onChange={(e) => setResolveNotes(e.target.value)}
                    placeholder="Add resolution notes..."
                    rows={3}
                    className="mt-1 text-sm resize-none"
                  />
                </div>

                {['pending', 'acknowledged', 'enforcement_started'].includes(activeBreach.status) && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleResolve}
                    disabled={resolveMutation.isPending}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {resolveMutation.isPending ? 'Resolving...' : 'Mark Resolved'}
                  </Button>
                )}

                {activeBreach.resolution_notes && (
                  <div className="p-2 bg-green-50 dark:bg-green-950/30 rounded text-xs text-gray-600 dark:text-gray-400">
                    <p className="font-semibold text-green-700 dark:text-green-400 mb-1">Resolution Notes</p>
                    {activeBreach.resolution_notes}
                  </div>
                )}
              </div>

              {/* Keyboard Shortcuts Footer */}
              <div className="p-3 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex-shrink-0">
                <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-gray-500">
                  <Keyboard className="h-3.5 w-3.5" />
                  Keyboard Shortcuts
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-400">
                  <span>⌃↵ Issue</span>
                  <span>⌃W Warning</span>
                  <span>⌃R Reject</span>
                  <span>↑↓ Navigate</span>
                  <span>Esc Deselect</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center p-6">
                <Shield className="h-14 w-14 mx-auto mb-4 opacity-20" />
                <p className="font-medium text-gray-500">Decision Dock</p>
                <p className="text-sm mt-2">Select a breach from the queue to make a decision</p>
                <div className="mt-5 space-y-2 text-left border dark:border-gray-700 rounded p-3 bg-gray-50 dark:bg-gray-700/50">
                  <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                    <Keyboard className="h-3.5 w-3.5" /> Keyboard Shortcuts
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-400">
                    <span>⌃↵ Issue</span>
                    <span>⌃W Warning</span>
                    <span>⌃R Reject</span>
                    <span>↑↓ Navigate</span>
                    <span>Esc Deselect</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile: Detail view below queue when selected ─────────────── */}
      {activeBreach && (
        <div className="lg:hidden mt-4 border rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
          <div className="p-4 border-b dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Car className="h-5 w-5 text-gray-500" />
                <span className="font-mono font-bold text-xl">{activeBreach.plate_number}</span>
                <Badge className={getStatusColor(activeBreach.status)}>
                  {activeBreach.status?.replace(/_/g, ' ')}
                </Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setActiveBreachId(null)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {(activeBreach.zones as any)?.name} • {getBreachTypeLabel(activeBreach.breach_type)}
            </p>
          </div>

          <div className="p-4 space-y-3">
            {/* Evidence photos */}
            {evidencePhotos && evidencePhotos.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {evidencePhotos.slice(0, 4).map((photo: any) => (
                  <div
                    key={photo.id}
                    className="aspect-video rounded overflow-hidden cursor-pointer border dark:border-gray-700"
                    onClick={() => window.open(photo.display_url, '_blank')}
                  >
                    <img src={photo.display_url} className="w-full h-full object-cover" alt="Evidence" />
                  </div>
                ))}
              </div>
            )}

            {/* Mobile Decision Buttons */}
            <div className="grid grid-cols-3 gap-2 pt-2">
              <Button
                className="bg-green-600 hover:bg-green-700 text-white text-xs h-12"
                onClick={handleIssueEnforcement}
                disabled={!['pending', 'acknowledged'].includes(activeBreach.status)}
              >
                <div className="text-center">
                  <Shield className="h-4 w-4 mx-auto" />
                  ISSUE
                </div>
              </Button>
              <Button
                className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs h-12"
                onClick={handleIssueWarning}
                disabled={activeBreach.status !== 'pending'}
              >
                <div className="text-center">
                  <Bell className="h-4 w-4 mx-auto" />
                  WARNING
                </div>
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white text-xs h-12"
                onClick={handleReject}
                disabled={['resolved', 'dismissed'].includes(activeBreach.status)}
              >
                <div className="text-center">
                  <XCircle className="h-4 w-4 mx-auto" />
                  REJECT
                </div>
              </Button>
            </div>

            {['pending', 'acknowledged', 'enforcement_started'].includes(activeBreach.status) && (
              <Button
                variant="outline"
                className="w-full"
                onClick={handleResolve}
                disabled={resolveMutation.isPending}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {resolveMutation.isPending ? 'Resolving...' : 'Mark Resolved'}
              </Button>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  )
}
