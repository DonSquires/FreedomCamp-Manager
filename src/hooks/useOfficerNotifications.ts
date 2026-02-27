/**
 * Custom Hook: useOfficerNotifications
 * Officer-specific alert and notification preferences
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface NotificationPreferences {
  breach_alerts: boolean
  investigation_assignments: boolean
  flagged_vehicle_alerts: boolean
  welfare_alerts: boolean
  system_alerts: boolean
}

interface OfficerAlert {
  id: string
  type: 'breach' | 'flagged_vehicle' | 'investigation' | 'welfare'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  title: string
  message: string
  zone_name?: string
  plate_number?: string
  latitude?: number
  longitude?: number
  acknowledged: boolean
  created_at: string
}

export function useOfficerNotifications() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch notification preferences
  const preferencesQuery = useQuery({
    queryKey: ['notification-preferences', user?.id],
    queryFn: async () => {
      if (!user?.id) return null

      const { data, error } = await supabase
        .from('user_profiles')
        .select('notification_preferences')
        .eq('id', user.id)
        .single()

      if (error) {
        console.error('Failed to load notification preferences:', error)
        return null
      }

      return data.notification_preferences as NotificationPreferences
    },
    enabled: !!user?.id,
  })

  // Update preferences mutation
  const updatePreferences = useMutation({
    mutationFn: async (preferences: Partial<NotificationPreferences>) => {
      if (!user?.id) throw new Error('User not authenticated')

      const { error } = await supabase
        .from('user_profiles')
        .update({
          notification_preferences: {
            ...preferencesQuery.data,
            ...preferences,
          },
        })
        .eq('id', user.id)

      if (error) {
        toast.error('Failed to update preferences')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] })
      toast.success('Notification preferences updated')
    },
  })

  // Fetch active alerts for officer
  const alertsQuery = useQuery({
    queryKey: ['officer-alerts', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // Combine breach alerts, flagged vehicles, and welfare alerts
      const alerts: OfficerAlert[] = []

      // Breach alerts in officer's zones
      const { data: breachAlerts } = await supabase
        .from('breach_alerts')
        .select(`
          id,
          breach_type,
          plate_number,
          created_at,
          zone:zones(name)
        `)
        .eq('status', 'pending')
        .limit(10)

      if (breachAlerts) {
        alerts.push(...breachAlerts.map(b => ({
          id: b.id,
          type: 'breach' as const,
          priority: 'high' as const,
          title: 'Breach Alert',
          message: `${b.breach_type} detected for ${b.plate_number}`,
          zone_name: b.zone?.name,
          plate_number: b.plate_number,
          acknowledged: false,
          created_at: b.created_at,
        })))
      }

      // Flagged vehicle sightings
      const { data: flaggedVehicles } = await supabase
        .from('flagged_vehicles')
        .select(`
          id,
          plate_number,
          priority,
          notes,
          last_known_site,
          created_at
        `)
        .eq('is_active', true)
        .limit(10)

      if (flaggedVehicles) {
        alerts.push(...flaggedVehicles.map(v => ({
          id: v.id,
          type: 'flagged_vehicle' as const,
          priority: v.priority as 'low' | 'normal' | 'high' | 'urgent',
          title: 'Flagged Vehicle',
          message: `Watch for ${v.plate_number} - ${v.notes}`,
          plate_number: v.plate_number,
          acknowledged: false,
          created_at: v.created_at,
        })))
      }

      // Investigation assignments
      const { data: investigations } = await supabase
        .from('investigation_jobs')
        .select(`
          id,
          reference_number,
          job_type,
          location_address,
          priority,
          created_at
        `)
        .eq('assigned_to', user.id)
        .eq('status', 'assigned')
        .limit(10)

      if (investigations) {
        alerts.push(...investigations.map(i => ({
          id: i.id,
          type: 'investigation' as const,
          priority: i.priority as 'low' | 'normal' | 'high' | 'urgent',
          title: 'Investigation Assigned',
          message: `${i.job_type} at ${i.location_address}`,
          acknowledged: false,
          created_at: i.created_at,
        })))
      }

      // Sort by priority and date
      return alerts.sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
        if (priorityDiff !== 0) return priorityDiff
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    },
    enabled: !!user?.id,
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  return {
    preferences: preferencesQuery.data,
    alerts: alertsQuery.data,
    isLoading: preferencesQuery.isLoading || alertsQuery.isLoading,
    updatePreferences,
  }
}

// Hook for alert count
export function useOfficerAlertCount() {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['officer-alert-count', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0

      let count = 0

      // Count pending breach alerts
      const { count: breachCount } = await supabase
        .from('breach_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')

      count += breachCount || 0

      // Count active flagged vehicles
      const { count: flaggedCount } = await supabase
        .from('flagged_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)

      count += flaggedCount || 0

      // Count assigned investigations
      const { count: investigationCount } = await supabase
        .from('investigation_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_to', user.id)
        .eq('status', 'assigned')

      count += investigationCount || 0

      return count
    },
    enabled: !!user?.id,
    refetchInterval: 30000, // Refresh every 30 seconds
  })
}
