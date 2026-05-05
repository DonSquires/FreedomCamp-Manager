/**
 * usePatrolCheckpointProgress
 *
 * Returns how many required checkpoints the officer has visited during the
 * current shift compared with the total required for their org/zone.
 *
 * Used to render a compact progress bar in FieldOfficerPortal while a shift
 * is active.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface PatrolCheckpointProgressOptions {
  officerId: string | null
  organizationId: string | null
  shiftId: string | null
  zoneId?: string | null
}

export interface PatrolCheckpointProgressResult {
  total: number
  visited: number
  percent: number
  isLoading: boolean
}

export function usePatrolCheckpointProgress({
  officerId,
  organizationId,
  shiftId,
  zoneId = null,
}: PatrolCheckpointProgressOptions): PatrolCheckpointProgressResult {
  const enabled = !!(officerId && organizationId && shiftId)

  // Total required checkpoints for this org (optionally filtered by zone)
  const { data: totalData, isLoading: totalLoading } = useQuery({
    queryKey: ['patrol-cp-total', organizationId, zoneId],
    queryFn: async () => {
      let query = supabase
        .from('patrol_checkpoints')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId!)
        .eq('is_active', true)
        .eq('required_on_patrol', true)
      if (zoneId) query = query.eq('zone_id', zoneId)
      const { count, error } = await query
      if (error) throw error
      return count ?? 0
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
  })

  // Distinct checkpoints visited during this shift
  const { data: visitedData, isLoading: visitedLoading } = useQuery({
    queryKey: ['patrol-cp-visited', officerId, shiftId],
    queryFn: async () => {
      // Get the shift's started_at so we only count visits in this shift window
      const { data: shiftRow, error: shiftErr } = await (supabase as any)
        .from('officer_shifts')
        .select('started_at')
        .eq('id', shiftId)
        .single()
      if (shiftErr || !shiftRow) return 0

      const { data, error } = await (supabase as any)
        .from('checkpoint_visits')
        .select('checkpoint_id')
        .eq('officer_id', officerId!)
        .eq('organization_id', organizationId!)
        .gte('visited_at', shiftRow.started_at)
      if (error) throw error

      // Deduplicate by checkpoint_id — each checkpoint counts once per shift
      const unique = new Set((data ?? []).map((r: any) => r.checkpoint_id))
      return unique.size
    },
    enabled,
    refetchInterval: 30_000,
  })

  const total = totalData ?? 0
  const visited = visitedData ?? 0
  const percent = total > 0 ? Math.round((visited / total) * 100) : 0

  return {
    total,
    visited,
    percent,
    isLoading: totalLoading || visitedLoading,
  }
}
