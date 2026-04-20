/**
 * Custom Hook: useVehicleCompliance
 * Real-time compliance checks and compliance history
 *
 * NOTE: The compliance_results table EXISTS in the live DB (Schema Extract #20:
 * 1,959 rows). Compliance state is ALSO stored directly on the observations
 * table (is_compliant, breach_type, breach_reason, nights_stayed_this_month,
 * consecutive_nights). The observations-row fields are authoritative.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
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

interface ObservationComplianceRow {
  id: string
  plate_number: string
  zone_id: string
  is_compliant: boolean
  breach_type: string | null
  breach_reason: string | null
  nights_stayed_this_month: number
  recorded_at: string
  created_at: string
  zone: { name: string } | null
}

export function useVehicleCompliance(plateNumber?: string, options?: {
  zoneId?: string
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch compliance history for vehicle — query observations directly
  // (compliance_results was dropped in 20260221_rebuild_observations_clean.sql)
  const complianceQuery = useQuery({
    queryKey: ['vehicle-compliance', plateNumber, options],
    queryFn: async () => {
      if (!plateNumber) return []

      let query = supabase
        .from('observations')
        .select(`
          id:observation_id,
          plate_number,
          zone_id,
          is_compliant,
          breach_type,
          breach_reason,
          nights_stayed_this_month,
          recorded_at,
          created_at,
          zone:zones(name)
        `)
        .eq('plate_number', plateNumber)
        .order('recorded_at', { ascending: false })

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      }

      if (options?.zoneId) {
        query = query.eq('zone_id', options.zoneId)
      }
      if (options?.dateFrom) {
        query = query.gte('recorded_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('recorded_at', options.dateTo)
      }

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load compliance history')
        throw error
      }

      // Map observations to the ComplianceResult shape expected by consumers
      return (data as unknown as ObservationComplianceRow[]).map((obs): ComplianceResult => ({
        id: obs.id,
        observation_id: obs.id,
        vehicle_id: null,
        zone_id: obs.zone_id,
        status: obs.is_compliant ? 'compliant' : 'non_compliant',
        rule_applied: obs.breach_type || 'nightly_limit',
        current_stay_count: obs.nights_stayed_this_month || 0,
        rule_snapshot: null,
        created_at: obs.recorded_at,
        observation: {
          plate_number: obs.plate_number,
          recorded_at: obs.recorded_at,
          zone: { name: obs.zone?.name || '' },
        },
      }))
    },
    enabled: !!plateNumber,
  })

  // Fetch compliance summary
  const summaryQuery = useQuery({
    queryKey: ['vehicle-compliance-summary', plateNumber],
    queryFn: async () => {
      if (!plateNumber) return null

      let query = supabase.from('observations')
        .select(`
          id:observation_id,
          is_compliant,
          recorded_at,
          zone_id,
          zones(name)
        `)
        .eq('plate_number', plateNumber)
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

  // Recalculate compliance mutation — re-processes the observation through
  // process-officer-scan (compliance evaluation phase) instead of the removed
  // test-compliance-matrix dev tool.
  const recalculateCompliance = useMutation({
    mutationFn: async (observationId: string) => {
      const { data, error } = await edgeFunctions.processOfficerScan({
        observation_id: observationId,
      })

      if (error) {
        toast.error(error)
        throw new Error(error)
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
