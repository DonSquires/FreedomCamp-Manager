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

    // Use a stable dependency by joining the keys — only changes when the array content changes
    const keysSnapshot = queryKeys.slice()

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
          keysSnapshot.forEach(key => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organization_id, queryClient, queryKeys.length])
}
