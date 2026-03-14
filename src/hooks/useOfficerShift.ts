/**
 * useOfficerShift
 *
 * Manages the officer shift lifecycle:
 *  - Shift starts automatically when the officer enters a parent (jurisdiction) zone
 *  - Shift ends on logout, manual end, or after 15 minutes of app inactivity
 *
 * Uses the officer_shifts table created by the geofence zone checkpoints migration.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { endShift, SHIFT_TIMEOUT_MS } from '@/lib/geofence'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

interface OfficerShift {
  id: string
  officer_id: string
  organization_id: string
  parent_zone_id: string | null
  started_at: string
  ended_at: string | null
  end_reason: string | null
  gps_start_lat: number | null
  gps_start_lng: number | null
  gps_end_lat: number | null
  gps_end_lng: number | null
  created_at: string
  updated_at: string
}

/** Fetch the officer's current active shift (ended_at IS NULL) */
export function useActiveShift() {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['officer-shift-active', user?.id],
    queryFn: async () => {
      if (!user?.id) return null

      const { data, error } = await (supabase.from('officer_shifts') as any)
        .select('*')
        .eq('officer_id', user.id)
        .is('ended_at', null)
        .maybeSingle()

      if (error) throw error
      return (data ?? null) as OfficerShift | null
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
  })
}

/** Fetch recent shifts for the officer (last 20) */
export function useMyShifts(limit = 20) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['officer-shifts-mine', user?.id, limit],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await (supabase.from('officer_shifts') as any)
        .select('*')
        .eq('officer_id', user.id)
        .order('started_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return (data ?? []) as OfficerShift[]
    },
    enabled: !!user?.id,
  })
}

/** End the current active shift manually */
export function useEndShift() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (reason: 'logout' | 'manual' = 'manual') => {
      if (!user?.id) throw new Error('Not authenticated')
      return endShift(user.id, reason)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['officer-shift-active'] })
      queryClient.invalidateQueries({ queryKey: ['officer-shifts-mine'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-site-visits'] })
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to end shift')
    },
  })
}

/**
 * Hook that monitors app visibility and automatically ends the shift
 * if the app stays hidden / closed for 15 minutes.
 */
export function useShiftInactivityTimeout() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const hiddenSinceRef = useRef<number | null>(null)

  useEffect(() => {
    if (!user?.id) return

    const handleVisibility = () => {
      if (document.hidden) {
        // App went to background — record the time
        hiddenSinceRef.current = Date.now()
      } else {
        // App came back — check if 15 minutes elapsed
        if (hiddenSinceRef.current) {
          const elapsed = Date.now() - hiddenSinceRef.current
          if (elapsed >= SHIFT_TIMEOUT_MS) {
            endShift(user.id, 'app_timeout').then(() => {
              queryClient.invalidateQueries({ queryKey: ['officer-shift-active'] })
              queryClient.invalidateQueries({ queryKey: ['patrol-site-visits'] })
            })
          }
          hiddenSinceRef.current = null
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [user?.id, queryClient])
}
