import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
import { useAuthStore } from '@/stores/authStore'
import type { BreachAlert, BreachStatus, Severity } from '@/types'

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

/** Zone names that represent generic parent zones rather than specific locations. */
const GENERIC_ZONE_NAMES = ['jurisdiction', 'general', 'other']

/**
 * Extract the observation id from a breach alert, checking both the FK column
 * and the breach_details JSON blob.
 */
export function extractObservationId(alert: any): string | null {
  const details = alert.breach_details || {}
  return (
    alert.observation_id ||
    details.observation_id ||
    details.triggering_observation_id ||
    details.source_observation_id ||
    null
  )
}

/**
 * From a bucket of duplicate alerts, pick the best representative.
 * Prefers the alert whose zone name is the most specific.
 */
function pickBestRepresentative(bucket: any[]): any {
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
export function deduplicateBreachAlerts(alerts: any[]): any[] {
  if (!alerts || alerts.length === 0) return alerts

  const obsBuckets = new Map<string, any[]>()
  const noObsAlerts: any[] = []

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

  const result: any[] = []
  for (const [, bucket] of obsBuckets) {
    result.push(pickBestRepresentative(bucket))
  }

  const timeBuckets = new Map<string, any[]>()
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
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
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
      if (!primary.error) return deduplicateBreachAlerts(primary.data || [])

      let fallbackQuery = (supabase.from('breach_alerts') as any)
        .select('*')
        .order('created_at', { ascending: false })
        .abortSignal(signal)

      fallbackQuery = applyFilters(fallbackQuery)
      const fallback = await fallbackQuery.limit(500)
      if (fallback.error) throw fallback.error

      return deduplicateBreachAlerts(
        (fallback.data || []).map((row: any) => ({
          ...row,
          zones: null,
          organizations: null,
        }))
      )
    },
    retry: 1,
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
