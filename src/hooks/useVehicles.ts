import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Vehicle } from '@/types'

interface UseVehiclesOptions {
  organizationId?: string | null
  zoneId?: string | null
  searchQuery?: string
  statusFilter?: 'all' | 'compliant' | 'breaches'
}

export function useVehicles(options: UseVehiclesOptions = {}) {
  const { organizationId, searchQuery = '', statusFilter = 'all' } = options

  return useQuery({
    queryKey: ['vehicles', organizationId, statusFilter, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('canonical_vehicles')
        .select('*')
        .order('plate_number', { ascending: true })

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (searchQuery) {
        query = query.or(`plate_number.ilike.%${searchQuery}%,make.ilike.%${searchQuery}%,model.ilike.%${searchQuery}%`)
      }

      if (statusFilter === 'compliant') {
        query = query.eq('total_breaches', 0)
      } else if (statusFilter === 'breaches') {
        query = query.gt('total_breaches', 0)
      }

      const { data, error } = await query.limit(100)
      
      if (error) throw error
      return data as Vehicle[]
    },
  })
}

export function useVehicle(vehicleId: string) {
  return useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single()

      if (error) throw error
      return data as Vehicle
    },
    enabled: !!vehicleId,
  })
}

export function useUpdateVehicle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ vehicleId, updates }: { vehicleId: string; updates: Partial<Vehicle> }) => {
      const { error } = await (supabase.from('canonical_vehicles') as any)
        .update(updates)
        .eq('id', vehicleId)

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['vehicle', variables.vehicleId] })
      toast.success('Vehicle updated successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update vehicle')
    },
  })
}

export function useVehicleStats(organizationId?: string | null) {
  return useQuery({
    queryKey: ['vehicle-stats', organizationId],
    queryFn: async () => {
      let query = (supabase.from('canonical_vehicles') as any)
        .select('self_contained, total_breaches, homeless_status, is_exempt', { count: 'exact' })

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      const { data, error, count } = await query

      if (error) throw error

      const stats = {
        total: count || 0,
        compliant: data?.filter(v => v.total_breaches === 0).length || 0,
        breaches: data?.filter(v => v.total_breaches > 0).length || 0,
        selfContained: data?.filter(v => v.self_contained).length || 0,
        homeless: data?.filter(v => v.homeless_status !== 'none').length || 0,
        exempt: data?.filter(v => v.is_exempt).length || 0,
      }

      return stats
    },
  })
}
