import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
import { useAuthStore } from '@/stores/authStore'
import type { BreachAlert, BreachStatus, Severity } from '@/types'
import { isPhotoUrlExpired, parseStorageUrl } from '@/lib/photoUtils'

interface UseBreachesOptions {
  organizationId?: string | null
  zoneId?: string | null
  searchQuery?: string
  statusFilter?: BreachStatus | 'all'
  severityFilter?: Severity | 'all'
}

interface BreachAlertExtended extends BreachAlert {
  zone: {
    name: string
  }
  organization: {
    name: string
  }
}

interface VehicleEnrichmentDetails {
  make?: string | null
  model?: string | null
  year?: number | null
  colour?: string | null
}

interface BreachAlertQueueOptions {
  effectiveOrganizationId?: string | null
  zoneId?: string | null
  statusFilter?: string
  breachTypeFilter?: string
  searchQuery?: string
  dateFrom?: string | null
  dateTo?: string | null
  startDate?: string | null
  endDate?: string | null
}

interface BreachIntelligenceAlertsOptions {
  effectiveOrganizationId?: string | null
  zoneId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  startDate?: string | null
  endDate?: string | null
}

interface BreachSafetyAlertsOptions {
  effectiveOrganizationId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  startDate?: string | null
  endDate?: string | null
}

type ActiveBreachVehicleContext = {
  id?: string
  organization_id?: string | null
  plate_number?: string | null
}

type BreachAlertLike = {
  id?: string
  organization_id?: string | null
  observation_id?: string | null
  breach_details?: Record<string, any> | null
  plate_number?: string | null
  breach_type?: string | null
  created_at?: string | null
  zones?: { name?: string | null } | null
}

type BreachAlertQueueRow = BreachAlertLike & {
  zone_id?: string | null
  status?: string | null
  resolved_at?: string | null
  due_date?: string | null
  resolution_notes?: string | null
  assigned_to?: string | null
  assigned_at?: string | null
  assigned_by?: string | null
  admin_review_notes?: string | null
  organizations?: { name?: string | null } | null
}

const OBSERVATION_SELECT_FIELDS = 'observation_id, photo, photo_url, recorded_at, gps_latitude, gps_longitude, vehicle_make, vehicle_model, vehicle_year, vehicle_color, has_homeless_claim, homeless_claim_notes, officer_notes, zones!vehicle_observations_v2_zone_id_fkey(name)'
const OBSERVATION_EVIDENCE_PHOTO_SELECT_FIELDS = 'observation_id, photo, photo_url, recorded_at, gps_latitude, gps_longitude, zones!vehicle_observations_v2_zone_id_fkey(name)'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''

/** Zone names that represent generic parent zones rather than specific locations. */
const GENERIC_ZONE_NAMES = ['jurisdiction', 'general', 'other']

/**
 * Extract the observation id from a breach alert, checking both the FK column
 * and the breach_details JSON blob.
 */
export function extractObservationId(alert: BreachAlertLike): string | null {
  const details = extractBreachDetails(alert)
  return (
    alert.observation_id ||
    details.observation_id ||
    details.triggering_observation_id ||
    details.source_observation_id ||
    null
  )
}

function extractBreachDetails(alert: BreachAlertLike): Record<string, any> {
  return alert.breach_details &&
    typeof alert.breach_details === 'object' &&
    !Array.isArray(alert.breach_details)
      ? alert.breach_details
      : {}
}

/**
 * From a bucket of duplicate alerts, pick the best representative.
 * Prefers the alert whose zone name is the most specific.
 */
function pickBestRepresentative<T extends BreachAlertLike>(bucket: T[]): T {
  if (bucket.length === 1) return bucket[0]
  const specific = bucket.find((a) => {
    const zn = ((a.zones as any)?.name ?? '').toLowerCase()
    return zn && !GENERIC_ZONE_NAMES.includes(zn)
  })
  return specific ?? bucket[0]
}

/**
 * Deduplicate breach alerts by linked observation first, then by plate/type/minute bucket.
 */
export function deduplicateBreachAlerts<T extends BreachAlertLike>(alerts: T[]): T[] {
  if (!alerts || alerts.length === 0) return alerts

  const obsBuckets = new Map<string, T[]>()
  const noObsAlerts: T[] = []

  for (const alert of alerts) {
    const obsId = extractObservationId(alert)
    if (obsId) {
      const bucket = obsBuckets.get(obsId) ?? []
      bucket.push(alert)
      obsBuckets.set(obsId, bucket)
    } else {
      noObsAlerts.push(alert)
    }
  }

  const result: T[] = []
  for (const [, bucket] of obsBuckets) {
    result.push(pickBestRepresentative(bucket))
  }

  const timeBuckets = new Map<string, T[]>()
  for (const alert of noObsAlerts) {
    const plate = (alert.plate_number ?? '').toLowerCase()
    const type = alert.breach_type ?? ''
    const ts = alert.created_at ? new Date(alert.created_at) : null
    const minuteBucket = ts ? ts.toISOString().slice(0, 16) : 'unknown'
    const key = `${plate}|${type}|${minuteBucket}`
    const bucket = timeBuckets.get(key) ?? []
    bucket.push(alert)
    timeBuckets.set(key, bucket)
  }

  for (const [, bucket] of timeBuckets) {
    result.push(pickBestRepresentative(bucket))
  }

  result.sort(
    (a, b) => (b.created_at ? new Date(b.created_at).getTime() : 0) - (a.created_at ? new Date(a.created_at).getTime() : 0),
  )

  return result
}

function deriveSeverityFromBreachType(breachType?: string): 'critical' | 'high' | 'medium' {
  const bt = String(breachType || '').toLowerCase()
  if (bt.includes('tow') || bt.includes('danger')) return 'critical'
  // Match canonical breach type values from the compliance engine
  if (
    bt === 'consecutive_nights' ||
    bt === 'monthly_limit' ||
    bt.includes('consecutive')
  ) return 'high'
  return 'medium'
}

// PostgREST OR-filter strings that mirror the severity classification above.
// Keep these in sync with deriveSeverityFromBreachType if rules change.
const CRITICAL_BREACH_FILTER = 'breach_type.ilike.%tow%,breach_type.ilike.%danger%'
const HIGH_BREACH_FILTER = 'breach_type.eq.consecutive_nights,breach_type.eq.monthly_limit,breach_type.ilike.%consecutive%'

export function useBreaches(options: UseBreachesOptions = {}) {
  const { 
    organizationId, 
    zoneId, 
    searchQuery = '', 
    statusFilter = 'all', 
    severityFilter = 'all' 
  } = options
  const { operationalOrganizationId } = useOperationalOrganization()
  const effectiveOrganizationId = organizationId ?? operationalOrganizationId

  return useQuery({
    queryKey: ['breach-alerts', effectiveOrganizationId, zoneId, statusFilter, severityFilter, searchQuery],
    queryFn: async () => {
      let query = supabase.from('breach_alerts')
        .select(`
          *,
          zone:zones(name),
          organization:organizations(name)
        `)
        .order('created_at', { ascending: false })

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      if (searchQuery) {
        query = query.ilike('plate_number', `%${searchQuery}%`)
      }

      const { data, error } = await query.limit(100)

      if (error) throw error

      const rows = (data || []) as any[]
      const withSeverity = rows.map((row) => ({
        ...row,
        severity: row.severity || deriveSeverityFromBreachType(row.breach_type),
      })) as BreachAlertExtended[]

      if (severityFilter !== 'all') {
        return withSeverity.filter((b: any) => b.severity === severityFilter)
      }

      return withSeverity
    },
  })
}

export function useBreach(breachId: string) {
  const { operationalOrganizationId } = useOperationalOrganization()
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['breach', breachId, operationalOrganizationId, user?.role],
    queryFn: async () => {
      let query = supabase
        .from('breach_alerts')
        .select(`
          *,
          zone:zones(name),
          organization:organizations(name)
        `)
        .eq('id', breachId)

      if (user?.role !== 'master' && operationalOrganizationId) {
        query = query.eq('organization_id', operationalOrganizationId)
      }

      const { data, error } = await query.single()

      if (error) throw error
      return data as unknown as BreachAlertExtended
    },
    enabled: !!breachId,
  })
}

export function useResolveBreach() {
  const queryClient = useQueryClient()
  const { operationalOrganizationId } = useOperationalOrganization()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ breachId, userId }: { breachId: string; userId: string }) => {
      let query = supabase
        .from('breach_alerts')
        .update({ 
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          // Note: breach_alerts has no resolved_by column; userId is kept in the
          // admin_reviewed_by field when the action comes from a formal review.
          admin_reviewed_by: userId,
          admin_reviewed_at: new Date().toISOString(),
        })
        .eq('id', breachId)

      if (user?.role !== 'master' && operationalOrganizationId) {
        query = query.eq('organization_id', operationalOrganizationId)
      }

      const { error } = await query

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Breach marked as resolved')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to resolve breach')
    },
  })
}

export function useNotifyBreach() {
  const queryClient = useQueryClient()
  const { operationalOrganizationId } = useOperationalOrganization()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (breachId: string) => {
      let query = supabase
        .from('breach_alerts')
        .update({ status: 'acknowledged' })
        .eq('id', breachId)

      if (user?.role !== 'master' && operationalOrganizationId) {
        query = query.eq('organization_id', operationalOrganizationId)
      }

      const { error } = await query

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Notification sent')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to send notification')
    },
  })
}

export function useBreachStats(organizationId?: string | null) {
  const { operationalOrganizationId } = useOperationalOrganization()
  const effectiveOrganizationId = organizationId ?? operationalOrganizationId

  return useQuery({
    queryKey: ['breach-stats', effectiveOrganizationId],
    queryFn: async () => {
      const buildCount = (extraFilter?: (q: any) => any) => {
        let q = supabase.from('breach_alerts')
          .select('*', { count: 'exact', head: true })
        if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
        if (extraFilter) q = extraFilter(q)
        return q
      }

      const [totalRes, pendingRes, acknowledgedRes, enforcementRes, resolvedRes, dismissedRes, criticalRes, highRes] =
        await Promise.all([
          buildCount(),
          buildCount(q => q.eq('status', 'pending')),
          buildCount(q => q.eq('status', 'acknowledged')),
          buildCount(q => q.eq('status', 'enforcement_started')),
          buildCount(q => q.eq('status', 'resolved')),
          buildCount(q => q.eq('status', 'dismissed')),
          buildCount(q => q.or(CRITICAL_BREACH_FILTER)),
          buildCount(q => q.or(HIGH_BREACH_FILTER)),
        ])

      if (totalRes.error) throw totalRes.error

      return {
        total: totalRes.count || 0,
        pending: pendingRes.count || 0,
        acknowledged: acknowledgedRes.count || 0,
        enforcement_started: enforcementRes.count || 0,
        resolved: resolvedRes.count || 0,
        dismissed: dismissedRes.count || 0,
        critical: criticalRes.count || 0,
        high: highRes.count || 0,
      }
    },
  })
}

export function useBreachIntelligenceAlerts({
  effectiveOrganizationId,
  zoneId,
  dateFrom,
  dateTo,
  startDate,
  endDate,
}: BreachIntelligenceAlertsOptions) {
  return useQuery({
    queryKey: ['intelligence-alerts', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async ({ signal }) => {
      let q = (supabase.from('breach_alerts') as any)
        .select('id, plate_number, breach_type, created_at, status, zones!zone_id(name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50)
        .abortSignal(signal)

      if (effectiveOrganizationId) {
        q = q.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate) q = q.lte('created_at', endDate)

      const { data } = await q
      return deduplicateBreachAlerts(data || []).slice(0, 10)
    },
  })
}

export function useBreachAlertQueue({
  effectiveOrganizationId,
  zoneId,
  statusFilter = 'all',
  breachTypeFilter = 'all',
  searchQuery = '',
  dateFrom,
  dateTo,
  startDate,
  endDate,
}: BreachAlertQueueOptions) {
  return useQuery({
    queryKey: ['breach-alerts', effectiveOrganizationId, zoneId, statusFilter, breachTypeFilter, searchQuery, dateFrom, dateTo],
    queryFn: async ({ signal }) => {
      const applyFilters = (query: any) => {
        if (effectiveOrganizationId) query = query.eq('organization_id', effectiveOrganizationId)
        if (zoneId) query = query.eq('zone_id', zoneId)
        if (startDate) query = query.gte('created_at', startDate)
        if (endDate) query = query.lte('created_at', endDate)
        if (statusFilter !== 'all') query = query.eq('status', statusFilter)
        if (breachTypeFilter !== 'all') query = query.eq('breach_type', breachTypeFilter)
        if (searchQuery) query = query.ilike('plate_number', `%${searchQuery}%`)
        return query
      }

      let primaryQuery = (supabase.from('breach_alerts') as any)
        .select(`
          *,
          zones!zone_id(name),
          organizations!organization_id(name)
        `)
        .order('created_at', { ascending: false })
        .abortSignal(signal)

      primaryQuery = applyFilters(primaryQuery)
      const primary = await primaryQuery.limit(500)
      if (!primary.error) return deduplicateBreachAlerts((primary.data || []) as BreachAlertQueueRow[])

      let fallbackQuery = (supabase.from('breach_alerts') as any)
        .select('*')
        .order('created_at', { ascending: false })
        .abortSignal(signal)

      fallbackQuery = applyFilters(fallbackQuery)
      const fallback = await fallbackQuery.limit(500)
      if (fallback.error) throw fallback.error

      return deduplicateBreachAlerts(
        ((fallback.data || []) as BreachAlertQueueRow[]).map((row) => ({
          ...row,
          zones: null,
          organizations: null,
        }))
      )
    },
    retry: 1,
  })
}

export function useBreachSafetyAlerts({
  effectiveOrganizationId,
  dateFrom,
  dateTo,
  startDate,
  endDate,
}: BreachSafetyAlertsOptions) {
  return useQuery({
    queryKey: ['safety-alerts', effectiveOrganizationId, dateFrom, dateTo],
    queryFn: async ({ signal }) => {
      let q = (supabase.from('officer_welfare_alerts') as any)
        .select('id, officer_name, alert_type, status, created_at, gps_latitude, gps_longitude')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10)
        .abortSignal(signal)

      if (effectiveOrganizationId) {
        q = q.eq('organization_id', effectiveOrganizationId)
      }
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate) q = q.lte('created_at', endDate)

      const { data } = await q
      return data || []
    },
  })
}

export function useBreachVehicleDetails(plateNumber?: string | null) {
  return useQuery({
    queryKey: ['breach-vehicle', plateNumber],
    queryFn: async ({ signal }) => {
      if (!plateNumber) return null
      const { data } = await (supabase.from('canonical_vehicles') as any)
        .select('*')
        .eq('plate_number', plateNumber)
        .abortSignal(signal)
        .single()
      return data
    },
    enabled: !!plateNumber,
  })
}

export function useBreachVehicleHistory(activeBreach?: ActiveBreachVehicleContext | null) {
  return useQuery({
    queryKey: ['breach-history', activeBreach?.plate_number],
    queryFn: async ({ signal }) => {
      if (!activeBreach?.plate_number) return []
      const { data } = await (supabase.from('breach_alerts') as any)
        .select('id, breach_type, status, created_at, resolved_at, observation_id, breach_details, zones!zone_id(name)')
        .eq('organization_id', activeBreach.organization_id)
        .eq('plate_number', activeBreach.plate_number)
        .neq('id', activeBreach.id)
        .order('created_at', { ascending: false })
        .limit(50)
        .abortSignal(signal)
      return deduplicateBreachAlerts(data || [])
    },
    enabled: !!activeBreach?.plate_number,
  })
}

export function useBreachTriggeringObservation(activeBreach?: BreachAlertLike | null) {
  return useQuery({
    queryKey: ['breach-triggering-obs', activeBreach?.id],
    queryFn: async ({ signal }) => {
      if (!activeBreach) return null

      const observationId = extractObservationId(activeBreach)
      if (observationId) {
        const { data } = await (supabase.from('observations') as any)
          .select(OBSERVATION_SELECT_FIELDS)
          .eq('observation_id', observationId)
          .abortSignal(signal)
          .single()
        return data || null
      }

      const { data } = await (supabase.from('observations') as any)
        .select(OBSERVATION_SELECT_FIELDS)
        .eq('plate_number', activeBreach.plate_number)
        .eq('organization_id', activeBreach.organization_id)
        .lte('recorded_at', activeBreach.created_at)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .abortSignal(signal)
        .single()

      return data || null
    },
    enabled: !!activeBreach,
  })
}

async function resolveViaDownload(bucket: string, path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path)
    if (error || !data) return null
    return URL.createObjectURL(data)
  } catch {
    return null
  }
}

export async function resolveBreachEvidencePhotoUrl(rawUrl: string | null | undefined): Promise<string | null> {
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

      const downloadedUrl = await resolveViaDownload(maybeParsed.bucket, maybeParsed.path)
      if (downloadedUrl) {
        return downloadedUrl
      }

      const { data: publicData } = supabase.storage.from(maybeParsed.bucket).getPublicUrl(maybeParsed.path)
      return publicData.publicUrl || url
    }

    if (url.includes('/storage/v1/object/public/')) {
      const { data, error } = await supabase.storage
        .from(maybeParsed.bucket)
        .createSignedUrl(maybeParsed.path, 60 * 60)

      if (!error && data?.signedUrl) {
        return data.signedUrl
      }

      const downloadedUrl = await resolveViaDownload(maybeParsed.bucket, maybeParsed.path)
      if (downloadedUrl) {
        return downloadedUrl
      }

      return url
    }

    if (isPhotoUrlExpired(url)) {
      const { data, error } = await supabase.storage
        .from(maybeParsed.bucket)
        .createSignedUrl(maybeParsed.path, 60 * 60)

      if (!error && data?.signedUrl) {
        return data.signedUrl
      }

      const downloadedUrl = await resolveViaDownload(maybeParsed.bucket, maybeParsed.path)
      if (downloadedUrl) {
        return downloadedUrl
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

    const downloadedUrl = await resolveViaDownload(bucket, path)
    if (downloadedUrl) {
      return downloadedUrl
    }

    const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path)
    return publicData.publicUrl || null
  }

  const { data: signedData, error } = await supabase.storage.from('scans').createSignedUrl(normalizedPath, 60 * 60)
  if (!error && signedData?.signedUrl) {
    return signedData.signedUrl
  }

  const downloadedUrl = await resolveViaDownload('scans', normalizedPath)
  if (downloadedUrl) {
    return downloadedUrl
  }

  const { data: publicData } = supabase.storage.from('scans').getPublicUrl(normalizedPath)
  return publicData.publicUrl || null
}

async function normalizeBreachEvidencePhotos(rows: any[], signal: AbortSignal) {
  if (signal.aborted) return []

  const normalizedRows = (rows || []).map((row: any) => ({
    ...row,
    id: row.observation_id ?? row.id,
  }))

  const missingPhotoObservationIds = normalizedRows
    .filter((row: any) => !row.photo && !row.photo_url && !!row.id)
    .map((row: any) => row.id)

  const fallbackPhotoByObservationId: Record<string, string> = {}
  if (missingPhotoObservationIds.length > 0) {
    const { data: metadataRows } = await (supabase.from('photo_metadata') as any)
      .select('observation_id, bucket_name, storage_path, file_name, created_at')
      .in('observation_id', missingPhotoObservationIds)
      .order('created_at', { ascending: false })
      .abortSignal(signal)

    for (const meta of metadataRows || []) {
      const observationId = meta.observation_id
      if (!observationId || fallbackPhotoByObservationId[observationId]) continue

      const candidate =
        (meta.bucket_name && meta.storage_path ? `${meta.bucket_name}/${meta.storage_path}` : null)
        || meta.storage_path
        || meta.file_name
        || null

      if (candidate) {
        fallbackPhotoByObservationId[observationId] = candidate
      }
    }
  }

  const BATCH_SIZE = 3
  const resolved: any[] = []
  for (let i = 0; i < normalizedRows.length; i += BATCH_SIZE) {
    if (signal.aborted) break
    const batch = normalizedRows.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (row: any) => {
        if (signal.aborted) return null
        const primary = await resolveBreachEvidencePhotoUrl(row.photo ?? row.photo_url)
        const fallback = primary
          ? null
          : await resolveBreachEvidencePhotoUrl(fallbackPhotoByObservationId[row.id] ?? null)

        return {
          ...row,
          display_url: primary ?? fallback,
          fallback_urls: [row.photo_url, row.photo, fallbackPhotoByObservationId[row.id] ?? null]
            .map((v: any) => (typeof v === 'string' ? v.trim() : null))
            .filter((v: string | null): v is string => !!v)
            .filter((v: string) => v !== (primary ?? fallback)),
        }
      })
    )
    resolved.push(...batchResults.filter((r: any) => r !== null))
  }

  return resolved.filter((row: any) => !!row.display_url)
}

export function useBreachEvidencePhotos(
  activeBreach: BreachAlertLike | null | undefined,
) {
  return useQuery({
    queryKey: ['breach-evidence-photos', activeBreach?.id, activeBreach?.plate_number, activeBreach?.created_at],
    queryFn: async ({ signal }) => {
      if (!activeBreach?.plate_number) return []

      const observationId = extractObservationId(activeBreach)
      if (observationId) {
        const byId = await (supabase.from('observations') as any)
          .select(OBSERVATION_EVIDENCE_PHOTO_SELECT_FIELDS)
          .eq('observation_id', observationId)
          .limit(1)
          .abortSignal(signal)

        const normalized = await normalizeBreachEvidencePhotos(byId.data || [], signal)
        if (normalized.length > 0) {
          return normalized
        }
      }

      if (signal.aborted) return []

      const strictQuery = (supabase.from('observations') as any)
        .select(OBSERVATION_EVIDENCE_PHOTO_SELECT_FIELDS)
        .eq('plate_number', activeBreach.plate_number)
        .eq('organization_id', activeBreach.organization_id)
        .lte('recorded_at', activeBreach.created_at)
        .order('recorded_at', { ascending: false })
        .limit(12)
        .abortSignal(signal)

      const strict = await strictQuery
      const strictNormalized = await normalizeBreachEvidencePhotos(strict.data || [], signal)
      if (strictNormalized.length > 0) {
        return strictNormalized
      }

      if (signal.aborted) return []

      const fallback = await (supabase.from('observations') as any)
        .select(OBSERVATION_EVIDENCE_PHOTO_SELECT_FIELDS)
        .eq('plate_number', activeBreach.plate_number)
        .order('recorded_at', { ascending: false })
        .limit(12)
        .abortSignal(signal)

      return await normalizeBreachEvidencePhotos(fallback.data || [], signal)
    },
    enabled: !!activeBreach?.plate_number,
  })
}

export async function acknowledgeBreachAlert(breachId: string, userId?: string | null) {
  const { error } = await (supabase.from('breach_alerts') as any)
    .update({
      status: 'acknowledged',
      notified_at: new Date().toISOString(),
      // Service/admin automation can acknowledge without a user-bound actor.
      notified_by: userId,
    })
    .eq('id', breachId)

  if (error) throw error
}

export async function startBreachEnforcement(breachId: string, userId?: string | null) {
  const { error } = await (supabase.from('breach_alerts') as any)
    .update({ status: 'enforcement_started', assigned_by: userId, assigned_at: new Date().toISOString() })
    .eq('id', breachId)

  if (error) throw error
}

export async function resolveBreachAlert({ breachId, notes }: { breachId: string; notes: string }) {
  const { error } = await (supabase.from('breach_alerts') as any)
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolution_notes: notes || null,
    })
    .eq('id', breachId)

  if (error) throw error
}

export async function dismissBreachAlert({ breachId, reason }: { breachId: string; reason?: string }) {
  const { error } = await (supabase.from('breach_alerts') as any)
    .update({
      status: 'dismissed',
      resolution_notes: reason || null,
    })
    .eq('id', breachId)

  if (error) throw error
}

export async function acknowledgeWelfareAlert(alertId: string, userId?: string | null) {
  const { error } = await (supabase.from('officer_welfare_alerts') as any)
    // Service/admin automation can acknowledge without a user-bound actor.
    .update({ status: 'acknowledged', acknowledged_by: userId, acknowledged_at: new Date().toISOString() })
    .eq('id', alertId)

  if (error) throw error
}

export async function updateCanonicalVehicleFromEnrichment(plateNumber: string, data: VehicleEnrichmentDetails) {
  const { error } = await (supabase.from('canonical_vehicles') as any)
    .update({
      vehicle_make: data.make,
      vehicle_model: data.model,
      vehicle_year: data.year ?? null,
      vehicle_color: data.colour,
    })
    .eq('plate_number', plateNumber)

  if (error) throw error
}

export async function updateBreachManualPlate({
  breachId,
  observationId,
  plateNumber,
}: {
  breachId: string
  observationId: string
  plateNumber: string
}) {
  const { error: obsErr } = await (supabase.from('observations') as any)
    .update({ plate_number: plateNumber })
    .eq('observation_id', observationId)

  if (obsErr) throw obsErr

  const { error: breachErr } = await (supabase.from('breach_alerts') as any)
    .update({ plate_number: plateNumber })
    .eq('id', breachId)

  if (breachErr) throw breachErr
}
