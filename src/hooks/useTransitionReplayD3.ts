import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

type TransitionContextParams = {
  providerOrgId?: string | null
  latitude?: number | null
  longitude?: number | null
  enabled?: boolean
}

type ReplayPayload = {
  organizationId: string
  idempotencyKey: string
  source?: string
}

export function useTransitionReplayD3({
  providerOrgId,
  latitude,
  longitude,
  enabled = true,
}: TransitionContextParams) {
  const canResolveContext =
    enabled &&
    !!providerOrgId &&
    typeof latitude === 'number' &&
    typeof longitude === 'number'

  const activeContextQuery = useQuery({
    queryKey: ['phase-d3-active-context', providerOrgId, latitude, longitude],
    enabled: canResolveContext,
    queryFn: async () => {
      const client = supabase as any
      const { data, error } = await client.rpc('get_active_context', {
        officer_lat: latitude,
        officer_lng: longitude,
        provider_id: providerOrgId,
      })

      if (error) throw error
      return Array.isArray(data) ? data[0] ?? null : null
    },
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: 1,
  })

  const recordReplayOutcome = useMutation({
    mutationFn: async ({ organizationId, idempotencyKey, source = 'offline_queue' }: ReplayPayload) => {
      const client = supabase as any
      const { data, error } = await client.rpc('record_offline_replay_event_d3', {
        p_organization_id: organizationId,
        p_idempotency_key: idempotencyKey,
        p_source: source,
      })

      if (error) throw error
      return data as {
        replay_event_id: string
        replay_status: 'accepted' | 'duplicate' | 'rejected'
        replay_conflict: boolean
        observation_id: string | null
      }
    },
  })

  return {
    activeContextQuery,
    recordReplayOutcome,
  }
}
