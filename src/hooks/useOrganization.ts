import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import type { OrganizationContextValue, OrganizationPermissions } from '@/contexts/OrganizationContext'

function permissionsForRole(role: string | undefined): OrganizationPermissions {
  const elevated = role === 'master' || role === 'grand_master' || role === 'admin'
  return {
    canInviteUsers: elevated,
    canRemoveUsers: elevated,
    canManageRoles: role === 'master' || role === 'grand_master',
  }
}

export function useOrganization(): OrganizationContextValue {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? null

  const { data } = useQuery({
    queryKey: ['organization', orgId],
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('id', orgId!)
        .single()
      if (error) throw error
      return data as { id: string; name: string }
    },
  })

  return {
    activeOrgId: orgId,
    activeOrgName: data?.name ?? null,
    permissions: permissionsForRole(user?.role),
  }
}
