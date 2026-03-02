import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// PostgREST error code for "function not found in schema cache" (HTTP 404)
const PGRST_FUNCTION_NOT_FOUND = 'PGRST202'

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

      if (error) {
        // Function not yet deployed — return null silently instead of throwing
        if (error.code === PGRST_FUNCTION_NOT_FOUND) {
          return null
        }
        throw error
      }

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
    // Don't retry on function-not-found — avoids 3x retry storm on every poll cycle
    retry: (failureCount, error: unknown) => {
      if ((error as { code?: string })?.code === PGRST_FUNCTION_NOT_FOUND) return false
      return failureCount < 3
    },
  })
}
