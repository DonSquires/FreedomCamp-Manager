/**
 * Custom Hook: useNotifications
 * Push notification management and delivery tracking
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface Notification {
  id: string
  user_id: string
  type: 'breach_alert' | 'investigation_assigned' | 'flagged_vehicle' | 'welfare_alert' | 'system_alert'
  title: string
  body: string
  data: any
  priority: 'low' | 'normal' | 'high' | 'urgent'
  read: boolean
  read_at: string | null
  delivered: boolean
  delivered_at: string | null
  created_at: string
}

interface SendNotificationInput {
  user_id: string
  type: string
  title: string
  body: string
  data?: any
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

export function useNotifications(options?: {
  userId?: string
  type?: string
  read?: boolean
  limit?: number
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch notifications
  const query = useQuery({
    queryKey: ['notifications', options],
    queryFn: async () => {
      const targetUserId = options?.userId || user?.id
      if (!targetUserId) return []

      let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(options?.limit || 50)

      // Filters
      if (options?.type) {
        query = query.eq('type', options.type)
      }
      if (options?.read !== undefined) {
        query = query.eq('read', options.read)
      }

      const { data, error } = await query

      if (error) {
        console.error('Failed to load notifications:', error)
        return []
      }

      return data as Notification[]
    },
    enabled: !!(options?.userId || user?.id),
  })

  // Mark as read mutation
  const markAsRead = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({
          read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', notificationId)

      if (error) {
        toast.error('Failed to mark as read')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  // Mark all as read mutation
  const markAllAsRead = useMutation({
    mutationFn: async () => {
      const targetUserId = user?.id
      if (!targetUserId) throw new Error('User not authenticated')

      const { error } = await supabase
        .from('notifications')
        .update({
          read: true,
          read_at: new Date().toISOString(),
        })
        .eq('user_id', targetUserId)
        .eq('read', false)

      if (error) {
        toast.error('Failed to mark all as read')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      toast.success('All notifications marked as read')
    },
  })

  // Delete notification mutation
  const deleteNotification = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId)

      if (error) {
        toast.error('Failed to delete notification')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      toast.success('Notification deleted')
    },
  })

  // Send notification mutation (admin only)
  const sendNotification = useMutation({
    mutationFn: async (input: SendNotificationInput) => {
      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          user_id: input.user_id,
          type: input.type,
          title: input.title,
          body: input.body,
          data: input.data,
          priority: input.priority || 'normal',
        },
      })

      if (error) {
        toast.error('Failed to send notification')
        throw error
      }

      return data
    },
    onSuccess: () => {
      toast.success('Notification sent')
    },
  })

  return {
    notifications: query.data,
    isLoading: query.isLoading,
    error: query.error,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    sendNotification,
  }
}

// Hook for unread notifications
export function useUnreadNotifications() {
  return useNotifications({ read: false, limit: 100 })
}

// Hook for notification count
export function useNotificationCount() {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['notification-count'],
    queryFn: async () => {
      if (!user?.id) return 0

      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false)

      if (error) {
        console.error('Failed to get notification count:', error)
        return 0
      }

      return count || 0
    },
    enabled: !!user?.id,
    refetchInterval: 30000, // Refresh every 30 seconds
  })
}

// Hook for push token management
export function usePushToken() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const updatePushToken = useMutation({
    mutationFn: async (token: string) => {
      if (!user?.id) throw new Error('User not authenticated')

      const { error } = await supabase
        .from('user_profiles')
        .update({
          push_token: token,
          push_token_updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)

      if (error) {
        console.error('Failed to update push token:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profile'] })
    },
  })

  return {
    updatePushToken,
  }
}
