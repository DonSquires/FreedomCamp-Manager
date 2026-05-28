/**
 * useClientOrgIds
 *
 * Returns the set of organization IDs that should be used when querying
 * client_sites (and related tables) for the current user.
 *
 * Logic mirrors the server-side `get_user_organization_ids()` SQL function:
 *  • grand_master           → no ID filter (return null = unrestricted)
 *  • master / admin / admin_officer / officer
 *                           → recursive descendant tree rooted at the user's
 *                             own org (via `get_descendant_organizations` RPC)
 *
 * This means a branch-level user automatically sees all client orgs that are
 * children (or deeper descendants) of their branch — no per-user grants needed.
 * A provider-level master sees every branch and every client under them.
 *
 * The returned `orgIds` array can be passed directly to a Supabase
 * `.in('organization_id', orgIds)` call.  When `orgIds` is null, the
 * caller should omit the organization_id filter entirely (grand_master sees all).
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface UseClientOrgIdsOptions {
  /** When false, the underlying RPC will not be fetched. Defaults to true. */
  enabled?: boolean
}

interface UseClientOrgIdsResult {
  /** null = unrestricted (grand_master role). Otherwise the list of org IDs to filter by. */
  orgIds: string[] | null
  isLoading: boolean
}

export function useClientOrgIds(options: UseClientOrgIdsOptions = {}): UseClientOrgIdsResult {
  const { enabled = true } = options
  const { user } = useAuthStore()
  const role  = user?.role
  const orgId = user?.organization_id
  const fallbackOrgId =
    user?.organization_id ||
    user?.employer_organization_id ||
    user?.authorized_work_locations?.[0] ||
    user?.extra_organization_ids?.[0] ||
    null

  // Grand-masters see everything — no ID restriction needed
  const isGrandMaster = role === 'grand_master'

  const { data: descendantIds = [], isLoading } = useQuery<string[]>({
    queryKey: ['org-descendant-ids', fallbackOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_descendant_organizations', { org_id: fallbackOrgId })
      if (error) throw error
      return (data ?? []) as string[]
    },
    enabled: enabled && !!fallbackOrgId && !isGrandMaster,
    staleTime: 5 * 60 * 1000, // org tree rarely changes
  })

  if (isGrandMaster) return { orgIds: null, isLoading: false }
  if (!fallbackOrgId) return { orgIds: [], isLoading: false }

  // get_descendant_organizations() always includes the root org itself (the SQL CTE
  // seeds with WHERE id = org_id), so descendantIds will contain orgId plus all
  // children/grandchildren.  The fallback to [orgId] is only a safety net for the
  // rare edge case where the RPC returns empty (e.g. org not yet in DB).
  const all = isLoading ? [fallbackOrgId] : descendantIds
  return { orgIds: all.length > 0 ? all : [fallbackOrgId], isLoading }
}
