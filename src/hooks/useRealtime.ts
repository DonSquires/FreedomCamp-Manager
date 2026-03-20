/**
 * Supabase Realtime Subscriptions Hook
 * 
 * Provides live updates for breach alerts, patrols, and observations
 */

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useQueryClient } from '@tanstack/react-query'
import { RealtimeChannel } from '@supabase/supabase-js'

interface UseRealtimeOptions {
  enabled?: boolean
  onInsert?: (payload: any) => void
  onUpdate?: (payload: any) => void
  onDelete?: (payload: any) => void
}

/**
 * Subscribe to breach alert changes in real-time
 */
export function useRealtimeBreachAlerts(options: UseRealtimeOptions = {}) {
  const { enabled = true, onInsert, onUpdate, onDelete } = options
  const queryClient = useQueryClient()
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!enabled) return

    const channel = supabase
      .channel('breach_alerts_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'breach_alerts',
        },
        (payload) => {
          console.log('New breach alert:', payload.new)
          
          // Invalidate queries to refetch data
          queryClient.invalidateQueries({ queryKey: ['breaches'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
          
          // Call custom handler
          onInsert?.(payload.new)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'breach_alerts',
        },
        (payload) => {
          console.log('Breach alert updated:', payload.new)
          
          queryClient.invalidateQueries({ queryKey: ['breaches'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
          
          onUpdate?.(payload.new)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'breach_alerts',
        },
        (payload) => {
          console.log('Breach alert deleted:', payload.old)
          
          queryClient.invalidateQueries({ queryKey: ['breaches'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
          
          onDelete?.(payload.old)
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [enabled, queryClient, onInsert, onUpdate, onDelete])
}

/**
 * Subscribe to patrol status changes in real-time
 */
export function useRealtimePatrols(options: UseRealtimeOptions = {}) {
  const { enabled = true, onInsert, onUpdate, onDelete } = options
  const queryClient = useQueryClient()
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!enabled) return

    const channel = supabase
      .channel('patrols_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'patrols',
        },
        (payload) => {
          console.log('Patrol update:', payload)
          
          queryClient.invalidateQueries({ queryKey: ['patrols'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
          
          if (payload.eventType === 'INSERT') onInsert?.(payload.new)
          if (payload.eventType === 'UPDATE') onUpdate?.(payload.new)
          if (payload.eventType === 'DELETE') onDelete?.(payload.old)
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [enabled, queryClient, onInsert, onUpdate, onDelete])
}

/**
 * Subscribe to new observations in real-time
 */
export function useRealtimeObservations(options: UseRealtimeOptions = {}) {
  const { enabled = true, onInsert, onUpdate, onDelete } = options
  const queryClient = useQueryClient()
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!enabled) return

    const channel = supabase
      .channel('observations_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'observations',
        },
        (payload) => {
          console.log('New observation:', payload.new)
          
          queryClient.invalidateQueries({ queryKey: ['vehicles'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
          queryClient.invalidateQueries({ queryKey: ['recent-activity'] })
          
          onInsert?.(payload.new)
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [enabled, queryClient, onInsert, onUpdate, onDelete])
}

/**
 * Subscribe to officer welfare alerts in real-time
 */
export function useRealtimeWelfareAlerts(options: UseRealtimeOptions = {}) {
  const { enabled = true, onInsert, onUpdate } = options
  const queryClient = useQueryClient()
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!enabled) return

    const channel = supabase
      .channel('welfare_alerts_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'officer_welfare_alerts',
        },
        (payload) => {
          console.log('Welfare alert:', payload)
          
          queryClient.invalidateQueries({ queryKey: ['welfare-alerts'] })
          
          if (payload.eventType === 'INSERT') {
            // Show urgent notification for new welfare alerts
            if (Notification.permission === 'granted') {
              new Notification('Officer Welfare Alert', {
                body: `Welfare check required for officer`,
                icon: '/icon-192.png',
              })
            }
            onInsert?.(payload.new)
          }
          if (payload.eventType === 'UPDATE') onUpdate?.(payload.new)
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [enabled, queryClient, onInsert, onUpdate])
}

/**
 * Combined realtime subscriptions for dashboard
 */
export function useRealtimeDashboard(enabled = true) {
  useRealtimeBreachAlerts({ enabled })
  useRealtimePatrols({ enabled })
  useRealtimeObservations({ enabled })
}
