import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface DashboardStatsParams {
  organizationId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
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
  const { organizationId, dateFrom, dateTo } = params

  return useQuery({
    queryKey: ['dashboard-stats', organizationId, dateFrom, dateTo],
    queryFn: async () => {
      // Try RPC function first
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_admin_dashboard_stats', {
        p_organization_id: organizationId || null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      })

      if (!rpcError && rpcData) {
        return rpcData as DashboardStats
      }

      // Fallback to manual calculation
      return await calculateStatsManually(organizationId, dateFrom, dateTo)
    },
  })
}

async function calculateStatsManually(
  organizationId?: string | null,
  dateFrom?: string | null,
  dateTo?: string | null
): Promise<DashboardStats> {
  let obsQuery = supabase.from('observations').select('is_compliant', { count: 'exact' })
  let breachQuery = supabase.from('breach_alerts').select('*', { count: 'exact' }).eq('status', 'pending')
  let vehicleQuery = supabase.from('canonical_vehicles').select('*', { count: 'exact' })
  let patrolQuery = supabase.from('patrols').select('*', { count: 'exact' }).eq('status', 'in_progress')

  if (organizationId) {
    obsQuery = obsQuery.eq('organization_id', organizationId)
    breachQuery = breachQuery.eq('organization_id', organizationId)
    vehicleQuery = vehicleQuery.eq('organization_id', organizationId)
    patrolQuery = patrolQuery.eq('organization_id', organizationId)
  }

  if (dateFrom) {
    obsQuery = obsQuery.gte('recorded_at', dateFrom)
  }
  if (dateTo) {
    obsQuery = obsQuery.lte('recorded_at', dateTo)
  }

  const [obsResult, breachResult, vehicleResult, patrolResult] = await Promise.all([
    obsQuery,
    breachQuery,
    vehicleQuery,
    patrolQuery,
  ])

  const totalObs = obsResult.count || 0
  const compliantObs = obsResult.data?.filter(o => o.is_compliant).length || 0
  const complianceRate = totalObs > 0 ? (compliantObs / totalObs) * 100 : 0

  return {
    total_observations: totalObs,
    compliant_observations: compliantObs,
    non_compliant_observations: totalObs - compliantObs,
    active_breaches: breachResult.count || 0,
    total_vehicles: vehicleResult.count || 0,
    active_patrols: patrolResult.count || 0,
    compliance_rate: complianceRate,
    trend_direction: 'stable',
    trend_percentage: 0,
  }
}

export function useRecentActivity(organizationId?: string | null) {
  return useQuery({
    queryKey: ['recent-activity', organizationId],
    queryFn: async () => {
      let query = supabase
        .from('observations')
        .select(`
          id,
          plate_number,
          recorded_at,
          zones:zone_id(name)
        `)
        .order('recorded_at', { ascending: false })
        .limit(5)

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
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
