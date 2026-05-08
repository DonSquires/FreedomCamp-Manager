import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'

type ZoneRow = Pick<Database['public']['Tables']['zones']['Row'], 'id' | 'name'>
type ZoneOption = { zone_id: string; name: string }

// ─── useAccessibleOrgsForShift ────────────────────────────────────────────────

interface AccessibleOrgsParams {
  userId: string | null | undefined
  employerOrganizationId: string | null
  organizationId: string | null | undefined
  authorizedWorkLocations: string[] | null | undefined
  extraOrganizationIds: string[] | null | undefined
  isServiceProviderMember: boolean
}

export function useAccessibleOrgsForShift(params: AccessibleOrgsParams) {
  const {
    userId,
    employerOrganizationId,
    organizationId,
    authorizedWorkLocations,
    extraOrganizationIds,
    isServiceProviderMember,
  } = params

  return useQuery({
    queryKey: ['accessible-orgs-for-shift', userId],
    queryFn: async () => {
      if (!userId) return []

      const orgIds = new Set<string>()
      if (employerOrganizationId) orgIds.add(employerOrganizationId)
      if (organizationId) orgIds.add(organizationId)
      authorizedWorkLocations?.forEach(id => orgIds.add(id))
      extraOrganizationIds?.forEach(id => orgIds.add(id))

      if (orgIds.size === 0) return []

      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, organization_type')
        .in('id', Array.from(orgIds))
        .eq('is_active', true)
        .order('name')

      if (error) return []
      return data as { id: string; name: string; organization_type: string }[]
    },
    enabled: !!userId && isServiceProviderMember,
    staleTime: 5 * 60_000,
  })
}

// ─── useShiftZones ────────────────────────────────────────────────────────────

export function useShiftZones(shiftOrgId: string) {
  return useQuery({
    queryKey: ['shift-zones', shiftOrgId],
    queryFn: async () => {
      if (!shiftOrgId) return []
      const { data, error } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', shiftOrgId)
        .eq('is_active', true)
        .order('name')

      if (error) return []
      return data as { id: string; name: string }[]
    },
    enabled: !!shiftOrgId,
    staleTime: 5 * 60_000,
  })
}

// ─── useOfficerUnreadNotifications ───────────────────────────────────────────

export function useOfficerUnreadNotifications(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['officer-unread-notifications', userId],
    queryFn: async () => {
      if (!userId) return []
      const { data } = await supabase
        .from('notifications')
        .select('id, title, body, priority, created_at')
        .eq('user_id', userId)
        .eq('read', false)
        .in('priority', ['high', 'urgent'])
        .order('created_at', { ascending: false })
        .limit(5)
      return data ?? []
    },
    enabled: !!userId,
    refetchInterval: 60_000,
  })
}

// ─── useOrgWorkflow ───────────────────────────────────────────────────────────

export function useOrgWorkflow(organizationId: string | null | undefined) {
  return useQuery({
    queryKey: ['org-workflow', organizationId],
    queryFn: async () => {
      if (!organizationId) return 'admin_first'
      const { data, error } = await supabase
        .from('organizations')
        .select('enforcement_workflow')
        .eq('id', organizationId)
        .single()
      if (error) return 'admin_first'
      return ((data as any)?.enforcement_workflow as string) || 'admin_first'
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
  })
}

// ─── useManualZones ───────────────────────────────────────────────────────────

export function useManualZones(organizationId: string | null | undefined) {
  return useQuery({
    queryKey: ['manual-zones', organizationId],
    queryFn: async () => {
      if (!organizationId) return []

      const fetchOrgScoped = async () => {
        const { data, error } = await supabase
          .from('zones')
          .select('id, name')
          .eq('organization_id', organizationId)
          .order('name', { ascending: true })
        if (error) return []
        return ((data ?? []) as ZoneRow[]).map((z): ZoneOption => ({ zone_id: z.id, name: z.name }))
      }

      const orgZones = await fetchOrgScoped()
      if (orgZones.length > 0) return orgZones

      // Fallback: under RLS this still returns only zones visible to the user.
      const { data: fallback, error: fallbackError } = await supabase
        .from('zones')
        .select('id, name')
        .order('name', { ascending: true })
        .limit(50)
      if (fallbackError) return []
      return ((fallback ?? []) as ZoneRow[]).map((z): ZoneOption => ({ zone_id: z.id, name: z.name }))
    },
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })
}

// ─── useMyRecentScans ─────────────────────────────────────────────────────────

export function useMyRecentScans(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['my-recent-scans', userId],
    queryFn: async () => {
      if (!userId) return []
      const historyCutoffIso = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString()

      // Live schema: PK is observation_id, photo cols are photo + photo_url, no processing_status
      const selectCandidates = [
        [
          'observation_id, plate_number, recorded_at, is_compliant',
          'photo, photo_url, zone_id, breach_type, consecutive_nights, nights_stayed_this_month',
          'zone:zones!zone_id(name)',
          'vehicle:canonical_vehicles!plate_number(homeless_status, is_exempt)',
        ].join(', '),
        // Minimal fallback
        [
          'observation_id, plate_number, recorded_at, is_compliant',
          'photo, photo_url, zone_id, breach_type',
          'zone:zones!zone_id(name)',
        ].join(', '),
      ]

      for (const selectClause of selectCandidates) {
        const { data, error } = await supabase
          .from('observations')
          .select(selectClause)
          .eq('recorded_by', userId)
          .gte('recorded_at', historyCutoffIso)
          .order('recorded_at', { ascending: false })
          .limit(20)

        if (error) continue

        const rows = (data || []).map((row: any) => ({
          ...row,
          id: row.observation_id ?? row.id,
          photo_url: row.photo ?? row.photo_url ?? null,
        }))

        return rows as any[]
      }

      return []
    },
    enabled: !!userId,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    refetchInterval: 15000,
  })
}

// ─── useOfficerActiveShift ────────────────────────────────────────────────────

export type ActiveShift = {
  id: string
  organization_id: string
  started_at: string
  parent_zone_id: string | null
  gps_start_lat: number | null
  gps_start_lng: number | null
} | null

export function useOfficerActiveShift(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['officer-active-shift', userId],
    queryFn: async () => {
      if (!userId) return null
      const { data, error } = await (supabase
        .from('officer_shifts') as any)
        .select('id, organization_id, started_at, parent_zone_id, gps_start_lat, gps_start_lng')
        .eq('officer_id', userId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) return null
      return data as ActiveShift
    },
    enabled: !!userId,
    refetchInterval: 300000,
  })
}

// ─── fetchWelfareIntervalMinutes ──────────────────────────────────────────────

export async function fetchWelfareIntervalMinutes(userId: string): Promise<number> {
  const { data: welfareSettings } = await supabase
    .from('officer_welfare_settings')
    .select('check_in_interval_minutes')
    .eq('user_id', userId)
    .maybeSingle()
  return (welfareSettings as any)?.check_in_interval_minutes ?? 30
}
