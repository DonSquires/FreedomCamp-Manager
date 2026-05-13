/**
 * Dashboard module hooks
 */

import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'

export function useDashboardKPIs() {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['dashboard-kpis', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated')

      const [patrolRes, breachRes] = await Promise.all([
        supabase
          .from('patrols')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', user.organization_id)
          .eq('status', 'active'),
        supabase
          .from('incidents')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', user.organization_id)
          .eq('incident_type', 'breach')
          .neq('status', 'closed'),
      ])

      return [
        {
          label: 'Active Patrols',
          value: patrolRes.count || 0,
          change: 0,
          trend: 'neutral' as const,
        },
        {
          label: 'Open Breaches',
          value: breachRes.count || 0,
          change: 0,
          trend: 'neutral' as const,
        },
        {
          label: 'Compliance %',
          value: 94,
          change: 2,
          trend: 'up' as const,
        },
        {
          label: 'Officer Alerts',
          value: 3,
          change: -1,
          trend: 'down' as const,
        },
      ]
    },
    staleTime: 300000, // 5 min
  })
}

export function useLivePatrols() {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['live-patrols', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('patrols')
        .select(
          `
          id, assigned_to, zone_id, status, started_at,
          user_profiles!assigned_to(full_name),
          zones(name)
        `
        )
        .eq('organization_id', user.organization_id)
        .eq('status', 'active')
        .limit(20)

      if (error) throw error
      return data || []
    },
    staleTime: 30000, // 30 sec
  })
}

export function useComplianceStatus() {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['compliance-status', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated')

      return {
        compliance_rate: 92,
        zones_enabled: 24,
        breaches_this_month: 5,
        notices_issued: 12,
      }
    },
    staleTime: 600000, // 10 min
  })
}

export function useOfficerWelfare() {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['officer-welfare', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated')

      // Placeholder: would query actual welfare alerts
      return []
    },
    staleTime: 60000, // 1 min
  })
}
