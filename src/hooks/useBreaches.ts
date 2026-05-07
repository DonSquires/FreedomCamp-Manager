import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
import { useAuthStore } from '@/stores/authStore'
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

// PostgREST OR-filter strings that mirror the severity classification above.
// Keep these in sync with deriveSeverityFromBreachType if rules change.
const CRITICAL_BREACH_FILTER = 'breach_type.ilike.%tow%,breach_type.ilike.%danger%'
const HIGH_BREACH_FILTER = 'breach_type.eq.consecutive_nights,breach_type.eq.monthly_limit,breach_type.ilike.%consecutive%'

export function useBreaches(options: UseBreachesOptions = {}) {
  const { 
    organizationId, 
    zoneId, 
    searchQuery = '', 
    statusFilter = 'all', 
    severityFilter = 'all' 
  } = options
  const { operationalOrganizationId } = useOperationalOrganization()
  const effectiveOrganizationId = organizationId ?? operationalOrganizationId

  return useQuery({
    queryKey: ['breach-alerts', effectiveOrganizationId, zoneId, statusFilter, severityFilter, searchQuery],
    queryFn: async () => {
      let query = supabase.from('breach_alerts')
        .select(`
          *,
          zone:zones(name),
          organization:organizations(name)
        `)
        .order('created_at', { ascending: false })

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
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
  const { operationalOrganizationId } = useOperationalOrganization()
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['breach', breachId, operationalOrganizationId, user?.role],
    queryFn: async () => {
      let query = supabase
        .from('breach_alerts')
        .select(`
          *,
          zone:zones(name),
          organization:organizations(name)
        `)
        .eq('id', breachId)

      if (user?.role !== 'master' && operationalOrganizationId) {
        query = query.eq('organization_id', operationalOrganizationId)
      }

      const { data, error } = await query.single()

      if (error) throw error
      return data as unknown as BreachAlertExtended
    },
    enabled: !!breachId,
  })
}

export function useResolveBreach() {
  const queryClient = useQueryClient()
  const { operationalOrganizationId } = useOperationalOrganization()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ breachId, userId }: { breachId: string; userId: string }) => {
      let query = supabase
        .from('breach_alerts')
        .update({ 
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          // Note: breach_alerts has no resolved_by column; userId is kept in the
          // admin_reviewed_by field when the action comes from a formal review.
          admin_reviewed_by: userId,
          admin_reviewed_at: new Date().toISOString(),
        })
        .eq('id', breachId)

      if (user?.role !== 'master' && operationalOrganizationId) {
        query = query.eq('organization_id', operationalOrganizationId)
      }

      const { error } = await query

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
  const { operationalOrganizationId } = useOperationalOrganization()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (breachId: string) => {
      let query = supabase
        .from('breach_alerts')
        .update({ status: 'acknowledged' })
        .eq('id', breachId)

      if (user?.role !== 'master' && operationalOrganizationId) {
        query = query.eq('organization_id', operationalOrganizationId)
      }

      const { error } = await query

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
  const { operationalOrganizationId } = useOperationalOrganization()
  const effectiveOrganizationId = organizationId ?? operationalOrganizationId

  return useQuery({
    queryKey: ['breach-stats', effectiveOrganizationId],
    queryFn: async () => {
      const buildCount = (extraFilter?: (q: any) => any) => {
        let q = supabase.from('breach_alerts')
          .select('*', { count: 'exact', head: true })
        if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
        if (extraFilter) q = extraFilter(q)
        return q
      }

      const [totalRes, pendingRes, acknowledgedRes, enforcementRes, resolvedRes, dismissedRes, criticalRes, highRes] =
        await Promise.all([
          buildCount(),
          buildCount(q => q.eq('status', 'pending')),
          buildCount(q => q.eq('status', 'acknowledged')),
          buildCount(q => q.eq('status', 'enforcement_started')),
          buildCount(q => q.eq('status', 'resolved')),
          buildCount(q => q.eq('status', 'dismissed')),
          buildCount(q => q.or(CRITICAL_BREACH_FILTER)),
          buildCount(q => q.or(HIGH_BREACH_FILTER)),
        ])

      if (totalRes.error) throw totalRes.error

      return {
        total: totalRes.count || 0,
        pending: pendingRes.count || 0,
        acknowledged: acknowledgedRes.count || 0,
        enforcement_started: enforcementRes.count || 0,
        resolved: resolvedRes.count || 0,
        dismissed: dismissedRes.count || 0,
        critical: criticalRes.count || 0,
        high: highRes.count || 0,
      }
    },
  })
}

export function useAcknowledgeBreachAlert() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (breachId: string) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({
          status: 'acknowledged',
          notified_at: new Date().toISOString(),
          notified_by: user?.id,
        })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['intelligence-alerts'] })
      toast.success('Breach acknowledged')
    },
    onError: () => toast.error('Failed to acknowledge breach'),
  })
}

export function useStartBreachEnforcement() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (breachId: string) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({ status: 'enforcement_started', assigned_by: user?.id, assigned_at: new Date().toISOString() })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Enforcement started')
    },
    onError: () => toast.error('Failed to start enforcement'),
  })
}

export function useResolveBreachAlert(options: { onSuccess?: () => void } = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ breachId, notes }: { breachId: string; notes: string }) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolution_notes: notes || null,
        })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['intelligence-alerts'] })
      options.onSuccess?.()
      toast.success('Breach marked as resolved')
    },
    onError: () => toast.error('Failed to resolve breach'),
  })
}

export function useDismissBreachAlert() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ breachId, reason }: { breachId: string; reason?: string }) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({
          status: 'dismissed',
          resolution_notes: reason || null,
        })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Breach dismissed')
    },
    onError: () => toast.error('Failed to dismiss breach'),
  })
}

export function useAcknowledgeWelfareAlert() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await (supabase.from('officer_welfare_alerts') as any)
        .update({ status: 'acknowledged', acknowledged_by: user?.id, acknowledged_at: new Date().toISOString() })
        .eq('id', alertId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safety-alerts'] })
      toast.success('Welfare alert acknowledged')
    },
    onError: () => toast.error('Failed to acknowledge welfare alert'),
  })
}
