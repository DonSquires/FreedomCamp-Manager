import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

type UseProviderOrganizationContextParams = {
  explicitProviderOrgId?: string | null
  preferredClientOrgId?: string | null
  enabled?: boolean
}

export function useProviderOrganizationContext({
  explicitProviderOrgId,
  preferredClientOrgId,
  enabled = true,
}: UseProviderOrganizationContextParams) {
  const todayIso = new Date().toISOString().slice(0, 10)
  const shouldLookup = enabled && !explicitProviderOrgId && !!preferredClientOrgId

  const { data: fallbackProviderOrgId } = useQuery({
    queryKey: ['provider-org-context', preferredClientOrgId, todayIso],
    enabled: shouldLookup,
    queryFn: async () => {
      const client = supabase as any
      const { data, error } = await client
        .from('crm_contracts')
        .select('provider_organization_id, start_date, end_date, updated_at, created_at')
        .eq('client_organization_id', preferredClientOrgId)
        .eq('status', 'active')
        .lte('start_date', todayIso)
        .or(`end_date.is.null,end_date.gte.${todayIso}`)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) throw error

      const row = Array.isArray(data) ? data[0] : null
      return row?.provider_organization_id ?? null
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  })

  return {
    providerOrgId: explicitProviderOrgId ?? fallbackProviderOrgId ?? null,
    usedFallbackProviderOrg: !explicitProviderOrgId && !!fallbackProviderOrgId,
  }
}
