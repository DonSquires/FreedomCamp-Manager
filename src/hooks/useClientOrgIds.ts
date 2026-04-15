/**
 * useClientOrgIds
 *
 * Returns the set of organization IDs that should be used when querying
 * client_sites (and related tables) for the current user.
 *
 * Logic:
 *  • master / grand_master  → no ID filter (return null = unrestricted)
 *  • admin / admin_officer  → user's own org + all direct client-child orgs
 *  • officer / others       → user's own org only
 *
 * The returned `orgIds` array can be passed directly to a Supabase
 * `.in('organization_id', orgIds)` call.  When `orgIds` is null, the
 * caller should omit the organization_id filter entirely (master sees all).
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface UseClientOrgIdsResult {
  /** null = unrestricted (master role). Otherwise the list of org IDs to filter by. */
  orgIds: string[] | null
  isLoading: boolean
}

export function useClientOrgIds(): UseClientOrgIdsResult {
  const { user } = useAuthStore()
  const role   = user?.role
  const orgId  = user?.organization_id

  // Masters see everything – no ID restriction needed
  const isMaster = role === 'master' || role === 'grand_master'

  // Admins also see their direct client-child organisations
  const isAdmin = role === 'admin' || role === 'admin_officer'

  const { data: childIds = [], isLoading } = useQuery<string[]>({
    queryKey: ['client-child-org-ids', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('organizations')
        .select('id')
        .eq('parent_organization_id', orgId ?? '')
        .eq('organization_type', 'client')
        .eq('is_active', true)
      if (error) throw error
      return (data ?? []).map((r: { id: string }) => r.id) as string[]
    },
    enabled: !!orgId && isAdmin && !isMaster,
    staleTime: 5 * 60 * 1000, // child orgs rarely change
  })

  if (isMaster) return { orgIds: null, isLoading: false }
  if (!orgId)   return { orgIds: [], isLoading: false }

  // For admins: own org + all direct client-child orgs
  if (isAdmin) {
    const all = isLoading ? [orgId] : [orgId, ...childIds]
    return { orgIds: all, isLoading }
  }

  // Officers and other roles: own org only
  return { orgIds: [orgId], isLoading: false }
}
