/**
 * usePOIVOIFlag
 *
 * Hook for flagging persons (POI) or vehicles (VOI) of interest directly from
 * the field portal. Automatically links the flag to the active patrol or
 * dispatch job for chain-of-custody auditing.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FlagPOIParams {
  full_name: string
  description?: string | null
  reason?: string | null
  notes?: string | null
  client_site_id?: string | null
  /** Patrol id to associate this flag with */
  patrol_id?: string | null
  /** Dispatch job id to associate this flag with */
  dispatch_job_id?: string | null
  photos?: string[] | null
  privacy_lawful_purpose?: string | null
  privacy_notice_given?: boolean
}

export interface FlagVOIParams {
  plate_number: string
  vehicle_description?: string | null
  reason?: string | null
  notes?: string | null
  last_known_site?: string | null
  /** Patrol id to associate this flag with */
  patrol_id?: string | null
  /** Dispatch job id to associate this flag with */
  dispatch_job_id?: string | null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePOIVOIFlag() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const flagPOI = useMutation({
    mutationFn: async (params: FlagPOIParams) => {
      if (!user?.organization_id) throw new Error('No organization context')

      const { data, error } = await (supabase as any)
        .from('persons_of_interest')
        .insert({
          organization_id: user.organization_id,
          created_by: user.id,
          full_name: params.full_name,
          description: params.description ?? null,
          reason: params.reason ?? null,
          notes: buildPatrolNotes(params.notes, params.patrol_id, params.dispatch_job_id),
          client_site_id: params.client_site_id ?? null,
          photos: params.photos ?? null,
          privacy_lawful_purpose: params.privacy_lawful_purpose ?? null,
          privacy_notice_given: params.privacy_notice_given ?? false,
          status: 'active',
          active: true,
          site_specific: !!params.client_site_id,
        })
        .select('id')
        .single()

      if (error) throw error
      return data as { id: string }
    },
    onSuccess: (_data, params) => {
      toast.success(buildPOISuccessMessage(params))
      queryClient.invalidateQueries({ queryKey: ['persons-of-interest'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to flag POI'),
  })

  const flagVOI = useMutation({
    mutationFn: async (params: FlagVOIParams) => {
      if (!user?.organization_id) throw new Error('No organization context')

      const { data, error } = await (supabase as any)
        .from('flagged_vehicles')
        .insert({
          organization_id: user.organization_id,
          created_by: user.id,
          flagged_by: user.id,
          plate_number: params.plate_number,
          vehicle_description: params.vehicle_description ?? null,
          reason: params.reason ?? null,
          notes: buildPatrolNotes(params.notes, params.patrol_id, params.dispatch_job_id),
          last_known_site: params.last_known_site ?? null,
          is_active: true,
          date_recorded: new Date().toISOString().split('T')[0],
        })
        .select('id')
        .single()

      if (error) throw error
      return data as { id: string }
    },
    onSuccess: (_data, params) => {
      toast.success(buildVOISuccessMessage(params))
      queryClient.invalidateQueries({ queryKey: ['flagged-vehicles'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to flag VOI'),
  })

  return { flagPOI, flagVOI }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPatrolNotes(
  baseNotes: string | null | undefined,
  patrolId: string | null | undefined,
  dispatchJobId: string | null | undefined,
): string | null {
  const links: string[] = []
  if (patrolId) links.push(`patrol:${patrolId}`)
  if (dispatchJobId) links.push(`dispatch:${dispatchJobId}`)
  if (!links.length) return baseNotes ?? null

  const linkNote = `[Flagged from field — ${links.join(', ')}]`
  return baseNotes ? `${baseNotes}\n${linkNote}` : linkNote
}

function buildPOISuccessMessage(params: FlagPOIParams): string {
  if (params.patrol_id) return 'Person of Interest flagged and linked to patrol'
  if (params.dispatch_job_id) return 'Person of Interest flagged and linked to dispatch'
  return 'Person of Interest flagged successfully'
}

function buildVOISuccessMessage(params: FlagVOIParams): string {
  if (params.patrol_id) return 'Vehicle of Interest flagged and linked to patrol'
  if (params.dispatch_job_id) return 'Vehicle of Interest flagged and linked to dispatch'
  return 'Vehicle of Interest flagged successfully'
}
