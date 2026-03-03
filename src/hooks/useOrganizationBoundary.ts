import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface OrganizationBoundary {
  id: string
  name: string
  type: string
  geom: any
  bbox: [number, number, number, number] | null
  area_km2: number | null
  updated_at: string
}

export function useOrganizationBoundary(organizationId?: string) {
  return useQuery({
    queryKey: ['organization-boundary', organizationId],
    queryFn: async () => {
      if (!organizationId) return null

      const { data, error } = await supabase
        .from('organizations')
        .select(`
          id,
          name,
          type,
          geom,
          updated_at
        `)
        .eq('id', organizationId)
        .single()

      if (error) throw error

      // Calculate bbox and area client-side if needed
      // Or fetch from a computed column/RPC
      const boundary: OrganizationBoundary = {
        ...(data as any),
        bbox: null, // TODO: Parse from geom or fetch via RPC
        area_km2: null, // TODO: Calculate or fetch via RPC
      }

      return boundary
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}
