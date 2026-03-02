import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface LocationCheckResult {
  inside: boolean
  distance_m: number | null
  nearest_point: {
    latitude: number
    longitude: number
  } | null
}

export function useLocationCheck(
  organizationId?: string,
  latitude?: number,
  longitude?: number,
  options?: {
    enabled?: boolean
    refetchInterval?: number
  }
) {
  return useQuery({
    queryKey: ['location-check', organizationId, latitude, longitude],
    queryFn: async () => {
      if (!organizationId || latitude === undefined || longitude === undefined) {
        return null
      }

      const { data, error } = await supabase.rpc('check_location_in_org', {
        org_id: organizationId,
        lon: longitude,
        lat: latitude,
      })

      if (error) throw error

      const result: LocationCheckResult = {
        inside: data?.inside || false,
        distance_m: data?.distance_m || null,
        nearest_point: data?.nearest_point ? {
          latitude: data.nearest_point.coordinates[1],
          longitude: data.nearest_point.coordinates[0],
        } : null,
      }

      return result
    },
    enabled: options?.enabled !== false && !!organizationId && latitude !== undefined && longitude !== undefined,
    refetchInterval: options?.refetchInterval || 10000, // Default 10 seconds
    staleTime: 5000, // 5 seconds
  })
}
