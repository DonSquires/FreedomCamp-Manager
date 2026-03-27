import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { getEffectiveOrgId } from '@/lib/orgUtils'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'

interface DashboardStatsParams {
  organizationId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  zoneId?: string | null
  userRole?: string | null
  userOrgId?: string | null
}

interface DashboardStats {
  total_observations: number
  compliant_observations: number
  non_compliant_observations: number
  active_breaches: number
  total_vehicles: number
  active_patrols: number
  compliance_rate: number
  trend_direction: 'up' | 'down' | 'stable'
  trend_percentage: number
}

export function useDashboardStats(params: DashboardStatsParams = {}) {
  const { organizationId, dateFrom, dateTo, zoneId, userRole, userOrgId } = params

  // Compute the effective org ID using the shared utility
  const effectiveOrgId = getEffectiveOrgId(
    { role: userRole, organization_id: userOrgId },
    organizationId,
  )

  return useQuery({
    queryKey: ['dashboard-stats', effectiveOrgId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      // Try RPC function first
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_admin_dashboard_stats', {
        p_organization_id: effectiveOrgId || null,
        p_start_date: dateFrom || null,
        p_end_date: dateTo || null,
      })

      if (!rpcError && rpcData) {
        return rpcData as unknown as DashboardStats
      }

      // Fallback to manual calculation
      return await calculateStatsManually(effectiveOrgId, zoneId, dateFrom, dateTo)
    },
  })
}

async function calculateStatsManually(
  organizationId?: string | null,
  zoneId?: string | null,
  dateFrom?: string | null,
  dateTo?: string | null,
): Promise<DashboardStats> {
  // Use separate HEAD count queries so pagination never under-counts
  let totalObsQuery = supabase.from('observations').select('*', { count: 'exact', head: true })
  let compliantObsQuery = supabase.from('observations').select('*', { count: 'exact', head: true }).eq('is_compliant', true)
  let breachQuery = supabase.from('breach_alerts').select('observation_id').in('status', ['pending', 'acknowledged', 'enforcement_started']).not('observation_id', 'is', null)
  let vehicleQuery: any = supabase.from('canonical_vehicles').select('*', { count: 'exact', head: true })
  let patrolQuery = supabase.from('patrols').select('*', { count: 'exact', head: true }).eq('status', 'in_progress')

  if (organizationId) {
    totalObsQuery = totalObsQuery.eq('organization_id', organizationId)
    compliantObsQuery = compliantObsQuery.eq('organization_id', organizationId)
    breachQuery = breachQuery.eq('organization_id', organizationId)
    vehicleQuery = vehicleQuery.eq('organization_id', organizationId)
    patrolQuery = patrolQuery.eq('organization_id', organizationId)
  }

  if (zoneId) {
    totalObsQuery = totalObsQuery.eq('zone_id', zoneId)
    compliantObsQuery = compliantObsQuery.eq('zone_id', zoneId)
    breachQuery = breachQuery.eq('zone_id', zoneId)
  }

  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  if (startDate) {
    totalObsQuery = totalObsQuery.gte('recorded_at', startDate)
    compliantObsQuery = compliantObsQuery.gte('recorded_at', startDate)
    breachQuery = breachQuery.gte('created_at', startDate)
  }
  if (endDate) {
    totalObsQuery = totalObsQuery.lte('recorded_at', endDate)
    compliantObsQuery = compliantObsQuery.lte('recorded_at', endDate)
    breachQuery = breachQuery.lte('created_at', endDate)
  }

  const [totalObsResult, compliantObsResult, breachResult, vehicleResult, patrolResult] = await Promise.all([
    totalObsQuery,
    compliantObsQuery,
    breachQuery,
    vehicleQuery,
    patrolQuery,
  ])

  const totalObs = totalObsResult.count || 0
  const compliantObs = compliantObsResult.count || 0
  const complianceRate = totalObs > 0 ? (compliantObs / totalObs) * 100 : 0
  const activeBreaches = new Set((breachResult.data ?? []).map((r: any) => r.observation_id)).size

  return {
    total_observations: totalObs,
    compliant_observations: compliantObs,
    non_compliant_observations: totalObs - compliantObs,
    active_breaches: activeBreaches,
    total_vehicles: vehicleResult.count || 0,
    active_patrols: patrolResult.count || 0,
    compliance_rate: complianceRate,
    trend_direction: 'stable',
    trend_percentage: 0,
  }
}

export function useRecentActivity(organizationId?: string | null, zoneId?: string | null) {
  return useQuery({
    queryKey: ['recent-activity', organizationId, zoneId],
    queryFn: async () => {
      let query = supabase.from('observations')
        .select(`
          id:observation_id,
          plate_number,
          recorded_at,
          zones:zone_id(name)
        `)
        .order('recorded_at', { ascending: false })
        .limit(5)

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }
      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      const { data, error } = await query

      if (error) throw error

      return (data || []).map(obs => ({
        id: obs.id,
        type: 'observation' as const,
        plate_number: obs.plate_number,
        zone_name: (obs.zones as any)?.name || 'Unknown Zone',
        created_at: obs.recorded_at,
        status: 'recorded',
      }))
    },
  })
}
