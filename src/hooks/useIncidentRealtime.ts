import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

/**
 * useIncidentRealtime — subscribes to real-time changes on the `incidents` table
 * for the current user's organisation and invalidates TanStack Query caches.
 *
 * Attach this hook to any page that displays incidents so the list refreshes
 * automatically when another user creates, updates, or deletes an incident.
 */
export function useIncidentRealtime(queryKeys: string[] = ['incidents']) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    if (!user?.organization_id) return

    const channel = supabase
      .channel(`incidents-realtime-${user.organization_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'incidents',
          filter: `organization_id=eq.${user.organization_id}`,
        },
        () => {
          queryKeys.forEach(key => {
            queryClient.invalidateQueries({ queryKey: [key] })
          })
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
  }, [user?.organization_id, queryClient, queryKeys.join(',')])
}
