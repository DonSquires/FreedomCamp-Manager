import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

const sb = supabase as any

export interface ActiveTransitionContextInput {
  providerId?: string
  officerLat: number
  officerLng: number
}

export interface OfflineReplayEventInput {
  organizationId: string
  idempotencyKey: string
  source?: string
}

export interface OfflineReplayEventResult {
  replay_status: 'accepted' | 'duplicate'
  replay_conflict: boolean
  replay_event_id: string
  replay_attempts: number
  first_replayed_at: string
  last_replayed_at: string
}

/**
 * Phase D3 Hooks: Transition Handshake + Offline Replay Contract
 */
export function useActiveTransitionContext(input: ActiveTransitionContextInput | undefined) {
  return useQuery({
    queryKey: ['activeTransitionContextD3', input?.providerId, input?.officerLat, input?.officerLng],
    queryFn: async () => {
      if (!input?.providerId) return []
      const { data, error } = await sb.rpc('get_active_context', {
        officer_lat: input.officerLat,
        officer_lng: input.officerLng,
        provider_id: input.providerId,
      })
      if (error) throw error
      return Array.isArray(data) ? data : []
    },
    enabled: Boolean(input?.providerId),
    refetchInterval: 30_000,
  })
}

export function useRecordOfflineReplayEventD3() {
  return useMutation({
    mutationFn: async (input: OfflineReplayEventInput): Promise<OfflineReplayEventResult> => {
      const { data, error } = await sb.rpc('record_offline_replay_event_d3', {
        p_organization_id: input.organizationId,
        p_idempotency_key: input.idempotencyKey,
        p_source: input.source ?? 'offline_queue',
      })
      if (error) throw error

      const row = Array.isArray(data) ? data[0] : data
      if (!row) throw new Error('Offline replay RPC returned empty result when a replay event row was expected')

      return row as OfflineReplayEventResult
    },
  })
}
