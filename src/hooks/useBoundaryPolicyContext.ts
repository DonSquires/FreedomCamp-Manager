import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

type BoundaryPolicyContextParams = {
  organizationId?: string | null
  latitude?: number | null
  longitude?: number | null
  serviceType?: string | null
  zoneId?: string | null
  enabled?: boolean
}

export function useBoundaryPolicyContext({
  organizationId,
  latitude,
  longitude,
  serviceType,
  zoneId,
  enabled = true,
}: BoundaryPolicyContextParams) {
  const isReady =
    enabled &&
    !!organizationId &&
    typeof latitude === 'number' &&
    typeof longitude === 'number'

  return useQuery({
    queryKey: [
      'boundary-policy-context',
      organizationId,
      latitude,
      longitude,
      serviceType,
      zoneId,
    ],
    enabled: isReady,
    queryFn: async () => {
      const client = supabase as any
      const { data, error } = await client.rpc('resolve_boundary_context', {
        p_organization_id: organizationId,
        p_service_type: serviceType ?? null,
        p_lat: latitude,
        p_lng: longitude,
        p_zone_id: zoneId ?? null,
      })

      if (error) {
        throw error
      }

      return data
    },
    staleTime: 10 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  })
}

type ZoneOperationalPolicyParams = {
  zoneId?: string | null
  serviceType?: string | null
  enabled?: boolean
}

export function useZoneOperationalPolicy({
  zoneId,
  serviceType,
  enabled = true,
}: ZoneOperationalPolicyParams) {
  const isReady = enabled && !!zoneId

  return useQuery({
    queryKey: ['zone-operational-policy', zoneId, serviceType],
    enabled: isReady,
    queryFn: async () => {
      const client = supabase as any
      const { data, error } = await client.rpc('get_zone_operational_policy', {
        p_zone_id: zoneId,
        p_service_type: serviceType ?? null,
      })

      if (error) {
        throw error
      }

      return data
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  })
}
