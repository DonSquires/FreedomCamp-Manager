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

  const query = useQuery({
    queryKey: ['audit-logs', options],
    queryFn: async () => {
      let query = supabase
        .from('audit_log')
        .select(`
          *,
          user_profile:user_profiles!audit_log_performed_by_fkey(first_name, last_name, email)
        `)
        .order('created_at', { ascending: false })
        .limit(options?.limit || 100)

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

      const { data, error } = await query

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
  return useQuery({
    queryKey: ['entity-history', entityType, entityId],
    queryFn: async () => {
      if (!entityId) return []

      const { data, error } = await supabase
        .from('audit_log')
        .select(`
          *,
          user_profile:user_profiles(first_name, last_name, email)
        `)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })

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
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['audit-stats', options],
    queryFn: async () => {
      let query = supabase
        .from('audit_log')
        .select('action, entity_type')

      // Date filters
      if (options?.dateFrom) {
        query = query.gte('created_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('created_at', options.dateTo)
      }

      const { data, error } = await query

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
