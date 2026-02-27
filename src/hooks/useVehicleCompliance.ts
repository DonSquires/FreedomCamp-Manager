/**
 * Custom Hook: useVehicleCompliance
 * Real-time compliance checks and compliance history
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface ComplianceResult {
  id: string
  observation_id: string
  vehicle_id: string | null
  zone_id: string
  status: 'compliant' | 'non_compliant' | 'warning'
  rule_applied: string
  current_stay_count: number
  rule_snapshot: any
  created_at: string
  observation: {
    plate_number: string
    recorded_at: string
    zone: {
      name: string
    }
  }
}

interface ComplianceSummary {
  plate_number: string
  total_observations: number
  compliant_count: number
  breach_count: number
  compliance_rate: number
  zones_visited: string[]
  first_seen: string
  last_seen: string
  current_status: 'compliant' | 'non_compliant' | 'warning'
}

export function useVehicleCompliance(plateNumber?: string, options?: {
  zoneId?: string
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch compliance results for vehicle
  const complianceQuery = useQuery({
    queryKey: ['vehicle-compliance', plateNumber, options],
    queryFn: async () => {
      if (!plateNumber) return []

      let query = supabase
        .from('compliance_results')
        .select(`
          *,
          observation:observations(
            plate_number,
            recorded_at,
            zone:zones(name)
          )
        `)
        .order('created_at', { ascending: false })

      // Filter by plate via observation join
      const { data: observations, error: obsError } = await supabase
        .from('observations')
        .select('id')
        .eq('plate_number', plateNumber)
        .is('deleted_at', null)

      if (obsError) throw obsError

      const observationIds = observations.map(o => o.id)
      query = query.in('observation_id', observationIds)

      if (options?.dateFrom) {
        query = query.gte('created_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('created_at', options.dateTo)
      }

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load compliance history')
        throw error
      }

      return data as ComplianceResult[]
    },
    enabled: !!plateNumber,
  })

  // Fetch compliance summary
  const summaryQuery = useQuery({
    queryKey: ['vehicle-compliance-summary', plateNumber],
    queryFn: async () => {
      if (!plateNumber) return null

      let query = supabase
        .from('observations')
        .select(`
          id,
          is_compliant,
          recorded_at,
          zone_id,
          zones(name)
        `)
        .eq('plate_number', plateNumber)
        .is('deleted_at', null)
        .order('recorded_at', { ascending: true })

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      }

      const { data, error } = await query

      if (error) throw error
      if (!data || data.length === 0) return null

      const total = data.length
      const compliant = data.filter(o => o.is_compliant).length
      const breaches = total - compliant
      const zones = [...new Set(data.map(o => o.zones?.name).filter(Boolean))]
      const lastObs = data[data.length - 1]

      return {
        plate_number: plateNumber,
        total_observations: total,
        compliant_count: compliant,
        breach_count: breaches,
        compliance_rate: total > 0 ? (compliant / total) * 100 : 0,
        zones_visited: zones,
        first_seen: data[0].recorded_at,
        last_seen: lastObs.recorded_at,
        current_status: lastObs.is_compliant ? 'compliant' : 'non_compliant',
      } as ComplianceSummary
    },
    enabled: !!plateNumber,
  })

  // Recalculate compliance mutation
  const recalculateCompliance = useMutation({
    mutationFn: async (observationId: string) => {
      const { data, error } = await supabase.functions.invoke('recalculate-compliance', {
        body: { observation_ids: [observationId] },
      })

      if (error) {
        toast.error('Failed to recalculate compliance')
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-compliance'] })
      queryClient.invalidateQueries({ queryKey: ['vehicle-compliance-summary'] })
      queryClient.invalidateQueries({ queryKey: ['observations'] })
      toast.success('Compliance recalculated')
    },
  })

  return {
    complianceHistory: complianceQuery.data,
    summary: summaryQuery.data,
    isLoading: complianceQuery.isLoading || summaryQuery.isLoading,
    error: complianceQuery.error || summaryQuery.error,
    recalculateCompliance,
  }
}

// Hook for checking if plate is currently compliant
export function useIsCompliant(plateNumber?: string) {
  const { summary, isLoading } = useVehicleCompliance(plateNumber)

  return {
    isCompliant: summary?.current_status === 'compliant',
    complianceRate: summary?.compliance_rate || 0,
    isLoading,
  }
}
