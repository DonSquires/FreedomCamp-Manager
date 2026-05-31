/**
 * Custom Hook: useAuditLogs
 * System audit trail queries
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface AuditLog {
  id: string
  organization_id?: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  old_values: any
  new_values: any
  performed_by: string | null
  created_at: string
  user_profile: {
    first_name: string
    last_name: string
    email: string
    organization_id?: string | null
    role?: string | null
  } | null
}

export function useAuditLogs(options?: {
  organizationId?: string
  userId?: string
  action?: string
  entityType?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
}) {
  const { user } = useAuthStore()
  const effectiveOrgId = (user?.role === 'master' || user?.role === 'grand_master') ? options?.organizationId || null
    : user?.organization_id || null

  const query = useQuery({
    queryKey: ['audit-logs', options],
    queryFn: async () => {
      let query = (supabase
        .from('audit_log')
        .select(`
          id,
          organization_id,
          action,
          entity_type,
          entity_id,
          old_values,
          new_values,
          performed_by,
          created_at,
          user_profile:user_profiles!audit_log_performed_by_fkey(first_name, last_name, email, organization_id, role)
        `)
        .order('created_at', { ascending: false })
        .limit(options?.limit || 100)) as any

      if (effectiveOrgId) {
        query = query.eq('organization_id', effectiveOrgId)
      }

      // Filters
      if (options?.userId) {
        query = query.eq('performed_by', options.userId)
      }
      if (options?.action) {
        query = query.eq('action', options.action)
      }
      if (options?.entityType) {
        query = query.eq('entity_type', options.entityType)
      }
      if (options?.dateFrom) {
        query = query.gte('created_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('created_at', options.dateTo)
      }

      let { data, error } = await query

      // Backward compatibility for environments where organization_id is not yet present.
      if (error && (error.message || '').toLowerCase().includes('organization_id')) {
        let fallbackQuery = (supabase
          .from('audit_log')
          .select(`
            id,
            action,
            entity_type,
            entity_id,
            old_values,
            new_values,
            performed_by,
            created_at,
            user_profile:user_profiles!audit_log_performed_by_fkey(first_name, last_name, email, organization_id, role)
          `)
          .order('created_at', { ascending: false })
          .limit(options?.limit || 100)) as any

        if (options?.userId) fallbackQuery = fallbackQuery.eq('performed_by', options.userId)
        if (options?.action) fallbackQuery = fallbackQuery.eq('action', options.action)
        if (options?.entityType) fallbackQuery = fallbackQuery.eq('entity_type', options.entityType)
        if (options?.dateFrom) fallbackQuery = fallbackQuery.gte('created_at', options.dateFrom)
        if (options?.dateTo) fallbackQuery = fallbackQuery.lte('created_at', options.dateTo)

        const fallback = await fallbackQuery
        data = fallback.data
        error = fallback.error

        if (!error && effectiveOrgId) {
          data = (data || []).filter((entry: any) => entry.user_profile?.organization_id === effectiveOrgId)
        }
      }

      if (error) {
        toast.error('Failed to load audit logs')
        throw error
      }

      return data as AuditLog[]
    },
  })

  return {
    logs: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

// Hook for recent activity (last 24 hours)
export function useRecentActivity() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  return useAuditLogs({
    dateFrom: twentyFourHoursAgo,
    limit: 50,
  })
}

// Hook for user activity
export function useUserActivity(userId: string | null) {
  return useAuditLogs({
    userId: userId || undefined,
    limit: 100,
  })
}

// Hook for entity history
export function useEntityHistory(entityType: string, entityId: string | null) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['entity-history', entityType, entityId, user?.role, user?.organization_id],
    queryFn: async () => {
      if (!entityId) return []

      let query = supabase
        .from('audit_log')
        .select(`
          *,
          user_profile:user_profiles(first_name, last_name, email)
        `)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)

      if (user?.role !== 'master' && user?.role !== 'grand_master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      }

      const { data, error } = await query.order('created_at', { ascending: false })

      if (error) {
        toast.error('Failed to load entity history')
        throw error
      }

      return data as AuditLog[]
    },
    enabled: !!entityId,
  })
}

// Hook for action summary stats
export function useAuditStats(options?: {
  organizationId?: string
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['audit-stats', options],
    queryFn: async () => {
      const effectiveStatsOrgId = (user?.role === 'master' || user?.role === 'grand_master') ? options?.organizationId || null
        : user?.organization_id || null

      let query = (supabase
        .from('audit_log')
        .select('action, entity_type, organization_id, user_profile:user_profiles!audit_log_performed_by_fkey(organization_id)')) as any

      if (effectiveStatsOrgId) {
        query = query.eq('organization_id', effectiveStatsOrgId)
      }

      // Date filters
      if (options?.dateFrom) {
        query = query.gte('created_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('created_at', options.dateTo)
      }

      let { data, error } = await query

      if (error && (error.message || '').toLowerCase().includes('organization_id')) {
        let fallbackQuery = (supabase
          .from('audit_log')
          .select('action, entity_type, user_profile:user_profiles!audit_log_performed_by_fkey(organization_id)') as any)

        if (options?.dateFrom) {
          fallbackQuery = fallbackQuery.gte('created_at', options.dateFrom)
        }
        if (options?.dateTo) {
          fallbackQuery = fallbackQuery.lte('created_at', options.dateTo)
        }

        const fallback = await fallbackQuery
        data = fallback.data
        error = fallback.error

        if (!error && effectiveStatsOrgId) {
          data = (data || []).filter((entry: any) => entry.user_profile?.organization_id === effectiveStatsOrgId)
        }
      }

      if (error) throw error

      // Calculate stats
      const actionCounts = (data || []).reduce((acc: Record<string, number>, log: any) => {
        acc[log.action] = (acc[log.action] || 0) + 1
        return acc
      }, {})

      const entityCounts = (data || []).reduce((acc: Record<string, number>, log: any) => {
        acc[log.entity_type] = (acc[log.entity_type] || 0) + 1
        return acc
      }, {})

      return {
        total: data?.length || 0,
        actionCounts,
        entityCounts,
      }
    },
  })
}
