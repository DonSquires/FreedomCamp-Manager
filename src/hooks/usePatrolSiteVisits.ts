/**
 * usePatrolSiteVisits
 *
 * Data access hooks for patrol site visits — automatic zone-based
 * entry/exit tracking tied to the officer's shift.
 *
 * A site visit is created when an officer enters a child zone geofence
 * and closed when they exit. Uses the patrol_site_visits table.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

interface PatrolSiteVisit {
  id: string
  officer_id: string
  organization_id: string
  shift_id: string | null
  zone_id: string
  entered_at: string
  exited_at: string | null
  gps_entry_lat: number | null
  gps_entry_lng: number | null
  gps_exit_lat: number | null
  gps_exit_lng: number | null
  created_at: string
  zone?: { id: string; name: string } | null
}

/** Fetch open (active) site visits for the current officer */
export function useActiveSiteVisits() {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['patrol-site-visits-active', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await (supabase.from('patrol_site_visits') as any)
        .select('*, zones:zone_id (id, name)')
        .eq('officer_id', user.id)
        .is('exited_at', null)
        .order('entered_at', { ascending: false })

      if (error) throw error
      return (data ?? []).map((row: any) => ({
        ...row,
        zone: row.zones ?? null,
      })) as PatrolSiteVisit[]
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
  })
}

/** Fetch recent site visits for the current officer */
export function useMySiteVisits(limit = 30) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['patrol-site-visits', user?.id, limit],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await (supabase.from('patrol_site_visits') as any)
        .select('*, zones:zone_id (id, name)')
        .eq('officer_id', user.id)
        .order('entered_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return (data ?? []).map((row: any) => ({
        ...row,
        zone: row.zones ?? null,
      })) as PatrolSiteVisit[]
    },
    enabled: !!user?.id,
  })
}

/** Fetch site visits for a specific shift */
export function useShiftSiteVisits(shiftId: string | null | undefined) {
  return useQuery({
    queryKey: ['patrol-site-visits-shift', shiftId],
    queryFn: async () => {
      if (!shiftId) return []

      const { data, error } = await (supabase.from('patrol_site_visits') as any)
        .select('*, zones:zone_id (id, name)')
        .eq('shift_id', shiftId)
        .order('entered_at', { ascending: false })

      if (error) throw error
      return (data ?? []).map((row: any) => ({
        ...row,
        zone: row.zones ?? null,
      })) as PatrolSiteVisit[]
    },
    enabled: !!shiftId,
  })
}

/** Fetch all site visits for the organisation (admin view) */
export function useOrgSiteVisits(options?: { limit?: number; zoneId?: string }) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['patrol-site-visits-org', user?.organization_id, options],
    queryFn: async () => {
      if (!user?.organization_id) return []

      let query = (supabase.from('patrol_site_visits') as any)
        .select('*, zones:zone_id (id, name)')
        .eq('organization_id', user.organization_id)
        .order('entered_at', { ascending: false })

      if (options?.zoneId) {
        query = query.eq('zone_id', options.zoneId)
      }
      if (options?.limit) {
        query = query.limit(options.limit)
      }

      const { data, error } = await query

      if (error) throw error
      return (data ?? []).map((row: any) => ({
        ...row,
        zone: row.zones ?? null,
      })) as PatrolSiteVisit[]
    },
    enabled: !!user?.organization_id,
  })
}
