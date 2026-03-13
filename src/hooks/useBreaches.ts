import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { BreachAlert, BreachStatus, Severity } from '@/types'

interface UseBreachesOptions {
  organizationId?: string | null
  zoneId?: string | null
  searchQuery?: string
  statusFilter?: BreachStatus | 'all'
  severityFilter?: Severity | 'all'
}

interface BreachAlertExtended extends BreachAlert {
  zone: {
    name: string
  }
  organization: {
    name: string
  }
}

function deriveSeverityFromBreachType(breachType?: string): 'critical' | 'high' | 'medium' {
  const bt = String(breachType || '').toLowerCase()
  if (bt.includes('tow') || bt.includes('danger')) return 'critical'
  // Match canonical breach type values from the compliance engine
  if (
    bt === 'consecutive_nights' ||
    bt === 'monthly_limit' ||
    bt.includes('consecutive')
  ) return 'high'
  return 'medium'
}

export function useBreaches(options: UseBreachesOptions = {}) {
  const { 
    organizationId, 
    zoneId, 
    searchQuery = '', 
    statusFilter = 'all', 
    severityFilter = 'all' 
  } = options

  return useQuery({
    queryKey: ['breach-alerts', organizationId, zoneId, statusFilter, severityFilter, searchQuery],
    queryFn: async () => {
      let query = (supabase.from('breach_alerts') as any)
        .select(`
          *,
          zone:zones(name),
          organization:organizations(name)
        `)
        .order('created_at', { ascending: false })

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      if (searchQuery) {
        query = query.ilike('plate_number', `%${searchQuery}%`)
      }

      const { data, error } = await query.limit(100)

      if (error) throw error

      const rows = (data || []) as any[]
      const withSeverity = rows.map((row) => ({
        ...row,
        severity: row.severity || deriveSeverityFromBreachType(row.breach_type),
      })) as BreachAlertExtended[]

      if (severityFilter !== 'all') {
        return withSeverity.filter((b: any) => b.severity === severityFilter)
      }

      return withSeverity
    },
  })
}

export function useBreach(breachId: string) {
  return useQuery({
    queryKey: ['breach', breachId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('breach_alerts') as any)
        .select(`
          *,
          zone:zones(name),
          organization:organizations(name)
        `)
        .eq('id', breachId)
        .single()

      if (error) throw error
      return data as unknown as BreachAlertExtended
    },
    enabled: !!breachId,
  })
}

export function useResolveBreach() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ breachId, userId }: { breachId: string; userId: string }) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({ 
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          // Note: breach_alerts has no resolved_by column; userId is kept in the
          // admin_reviewed_by field when the action comes from a formal review.
          admin_reviewed_by: userId,
          admin_reviewed_at: new Date().toISOString(),
        })
        .eq('id', breachId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Breach marked as resolved')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to resolve breach')
    },
  })
}

export function useNotifyBreach() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (breachId: string) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({ status: 'acknowledged' })
        .eq('id', breachId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Notification sent')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to send notification')
    },
  })
}

export function useBreachStats(organizationId?: string | null) {
  return useQuery({
    queryKey: ['breach-stats', organizationId],
    queryFn: async () => {
      let query = (supabase.from('breach_alerts') as any)
        .select('status, breach_type', { count: 'exact' })

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      const { data, error, count } = await query

      if (error) throw error

      const stats = {
        total: count || 0,
        pending: data?.filter(b => b.status === 'pending').length || 0,
        acknowledged: data?.filter(b => b.status === 'acknowledged').length || 0,
        enforcement_started: data?.filter(b => b.status === 'enforcement_started').length || 0,
        resolved: data?.filter(b => b.status === 'resolved').length || 0,
        dismissed: data?.filter(b => b.status === 'dismissed').length || 0,
        critical: data?.filter((b: any) => deriveSeverityFromBreachType(b.breach_type) === 'critical').length || 0,
        high: data?.filter((b: any) => deriveSeverityFromBreachType(b.breach_type) === 'high').length || 0,
      }

      return stats
    },
  })
}
