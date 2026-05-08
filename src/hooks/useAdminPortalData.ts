import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function useAdminRecentHistoricalObservations(options: {
  organizationId?: string | null
  zoneId?: string | null
  startDate?: string | null
  endDate?: string | null
  enabled?: boolean
}) {
  const { organizationId, zoneId, startDate, endDate, enabled = true } = options

  return useQuery({
    queryKey: ['admin-recent-historical-observations', organizationId, zoneId, startDate, endDate],
    queryFn: async () => {
      let q = (supabase.from('observations') as any)
        .select('observation_id, plate_number, recorded_at, breach_type, is_compliant, zone:zones!zone_id(name)')
        .order('recorded_at', { ascending: false })
        .limit(8)

      if (organizationId) q = q.eq('organization_id', organizationId)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('recorded_at', startDate)
      if (endDate) q = q.lte('recorded_at', endDate)

      const { data: rows, error: rowsError } = await q
      if (rowsError) throw rowsError
      return (rows || []) as any[]
    },
    enabled,
  })
}

export function useAdminWelfareAlertCount(organizationId?: string | null) {
  return useQuery({
    queryKey: ['admin-welfare-alert-count', organizationId],
    queryFn: async () => {
      let q = (supabase.from('officer_welfare_alerts') as any)
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'acknowledged'])
      if (organizationId) q = q.eq('organization_id', organizationId)
      const { count } = await q
      return count ?? 0
    },
    staleTime: 1000 * 30,
  })
}

export function useAdminActivePatrolCount(organizationId?: string | null) {
  return useQuery({
    queryKey: ['admin-active-patrol-count', organizationId],
    queryFn: async () => {
      const nzToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
      let q = (supabase.from('patrols') as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'in_progress')
        .eq('patrol_date', nzToday)
      if (organizationId) q = q.eq('organization_id', organizationId)
      const { count } = await q
      return count ?? 0
    },
    staleTime: 1000 * 30,
  })
}

export function useAdminTodayRosterShifts(organizationId?: string | null) {
  return useQuery({
    queryKey: ['admin-today-roster', organizationId],
    queryFn: async () => {
      const nzToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
      let q = (supabase.from('roster_shifts') as any)
        .select(`id, start_time, end_time, status, position_title, service_type,
          officer:user_profiles!roster_shifts_officer_id_fkey(first_name, last_name)`)
        .eq('shift_date', nzToday)
        .in('status', ['published', 'confirmed', 'in_progress'])
        .order('start_time', { ascending: true })
        .limit(8)
      if (organizationId) q = q.eq('organization_id', organizationId)
      const { data } = await q
      return (data ?? []) as any[]
    },
    staleTime: 1000 * 60,
  })
}
