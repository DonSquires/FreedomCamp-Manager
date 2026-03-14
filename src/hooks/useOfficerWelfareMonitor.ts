/**
 * Custom Hook: useOfficerWelfareMonitor
 * Officer welfare monitoring and alerts
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface WelfareAlert {
  id: string
  officer_id: string
  organization_id: string
  alert_type: 'inactivity' | 'gps_lost' | 'manual' | 'investigation_overdue'
  status: 'pending' | 'acknowledged' | 'resolved'
  officer_name: string
  officer_phone: string | null
  gps_latitude: number | null
  gps_longitude: number | null
  gps_accuracy: number | null
  last_activity_at: string
  alert_sent_at: string
  acknowledged_at: string | null
  acknowledged_by: string | null
  resolved_at: string | null
  resolved_by: string | null
  escalation_level: number
  escalated_at: string | null
  acknowledgement_notes: string | null
  resolution_notes: string | null
  created_at: string
  updated_at: string
}

interface WelfareSettings {
  id: string
  user_id: string
  organization_id: string
  auto_logoff_enabled: boolean
  welfare_check_enabled: boolean
  inactivity_warning_time: number
  auto_logoff_time: number
  gps_inactivity_threshold: number
  admin_escalation_time: number
  critical_escalation_time: number
  investigation_exception_enabled: boolean
  created_at: string
  updated_at: string
}

export function useOfficerWelfareMonitor(options?: {
  organizationId?: string
  officerId?: string
  status?: string
  alertType?: string
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch welfare alerts
  const alertsQuery = useQuery({
    queryKey: ['welfare-alerts', options],
    queryFn: async () => {
      let query = supabase
        .from('officer_welfare_alerts')
        .select('*')
        .order('created_at', { ascending: false })

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (options?.organizationId) {
        query = query.eq('organization_id', options.organizationId)
      }

      // Filters
      if (options?.officerId) {
        query = query.eq('officer_id', options.officerId)
      }
      if (options?.status) {
        query = query.eq('status', options.status)
      }
      if (options?.alertType) {
        query = query.eq('alert_type', options.alertType)
      }

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load welfare alerts')
        throw error
      }

      return data as WelfareAlert[]
    },
  })

  // Acknowledge alert mutation
  const acknowledgeAlert = useMutation({
    mutationFn: async ({ alertId, notes }: { alertId: string; notes?: string }) => {
      const { error } = await (supabase.from('officer_welfare_alerts') as any)
        .update({
          status: 'acknowledged',
          acknowledged_by: user?.id,
          acknowledged_at: new Date().toISOString(),
          acknowledgement_notes: notes,
        })
        .eq('id', alertId)

      if (error) {
        toast.error('Failed to acknowledge alert')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['welfare-alerts'] })
      toast.success('Alert acknowledged')
    },
  })

  // Resolve alert mutation
  const resolveAlert = useMutation({
    mutationFn: async ({ alertId, notes }: { alertId: string; notes?: string }) => {
      const { error } = await (supabase.from('officer_welfare_alerts') as any)
        .update({
          status: 'resolved',
          resolved_by: user?.id,
          resolved_at: new Date().toISOString(),
          resolution_notes: notes,
        })
        .eq('id', alertId)

      if (error) {
        toast.error('Failed to resolve alert')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['welfare-alerts'] })
      toast.success('Alert resolved')
    },
  })

  return {
    alerts: alertsQuery.data,
    isLoading: alertsQuery.isLoading,
    error: alertsQuery.error,
    acknowledgeAlert,
    resolveAlert,
  }
}

// Hook for active (pending) welfare alerts
export function useActiveWelfareAlerts() {
  return useOfficerWelfareMonitor({ status: 'pending' })
}

// Hook for officer welfare settings
export function useOfficerWelfareSettings(userId?: string) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({
    queryKey: ['welfare-settings', userId],
    queryFn: async () => {
      const targetUserId = userId || user?.id
      if (!targetUserId) return null

      const { data, error } = await (supabase.from('officer_welfare_settings') as any)
        .select('*')
        .eq('user_id', targetUserId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') { // Not found
          return null
        }
        toast.error('Failed to load welfare settings')
        throw error
      }

      return data as WelfareSettings
    },
    enabled: !!(userId || user?.id),
  })

  // Update settings mutation
  const updateSettings = useMutation({
    mutationFn: async (updates: Partial<WelfareSettings>) => {
      const targetUserId = userId || user?.id
      if (!targetUserId) throw new Error('No user ID')

      // Check if settings exist
      const { data: existing } = await (supabase.from('officer_welfare_settings') as any)
        .select('id')
        .eq('user_id', targetUserId)
        .single()

      if (existing) {
        // Update existing
        const { error } = await (supabase.from('officer_welfare_settings') as any)
          .update(updates)
          .eq('user_id', targetUserId)

        if (error) throw error
      } else {
        // Insert new
        const { error } = await (supabase
          .from('officer_welfare_settings') as any)
          .insert({
            user_id: targetUserId,
            organization_id: user?.organization_id,
            ...updates,
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['welfare-settings'] })
      toast.success('Welfare settings updated')
    },
    onError: () => {
      toast.error('Failed to update settings')
    },
  })

  return {
    settings: settingsQuery.data,
    isLoading: settingsQuery.isLoading,
    error: settingsQuery.error,
    updateSettings,
  }
}

// Hook for welfare alert statistics
export function useWelfareStats(options?: {
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['welfare-stats', options],
    queryFn: async () => {
      let query = (supabase.from('officer_welfare_alerts') as any)
        .select('alert_type, status, escalation_level')

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      }

      if (options?.dateFrom) {
        query = query.gte('created_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('created_at', options.dateTo)
      }

      const { data, error } = await query

      if (error) throw error

      return {
        total: data?.length || 0,
        pending: data?.filter(a => a.status === 'pending').length || 0,
        acknowledged: data?.filter(a => a.status === 'acknowledged').length || 0,
        resolved: data?.filter(a => a.status === 'resolved').length || 0,
        escalated: data?.filter(a => a.escalation_level && a.escalation_level > 1).length || 0,
        byType: data?.reduce((acc: Record<string, number>, alert: any) => {
          acc[alert.alert_type] = (acc[alert.alert_type] || 0) + 1
          return acc
        }, {}),
      }
    },
  })
}
