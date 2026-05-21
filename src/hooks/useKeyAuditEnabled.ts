import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function useKeyAuditEnabled(organizationId: string | null) {
  return useQuery({
    queryKey: ['key-audit-enabled', organizationId],
    queryFn: async () => {
      if (!organizationId) return true
      const { data, error } = await (supabase as any)
        .from('key_audit_settings')
        .select('is_enabled')
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (error) throw error
      return data?.is_enabled !== false
    },
    enabled: !!organizationId,
    staleTime: 60_000,
    retry: false,
  })
}
