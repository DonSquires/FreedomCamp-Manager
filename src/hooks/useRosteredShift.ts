/**
 * useRosteredShift
 *
 * Returns the current officer's active (published/confirmed) roster shift for
 * today, along with any activity rate overrides.  Used by PortalSelection and
 * FieldOfficerPortal to drive roster-aware routing and pre-select the correct
 * service portal.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { nzNow } from '@/lib/timezone'
import { format } from 'date-fns'

export type RosterServiceType =
  | 'freedom_camping'
  | 'guarding'
  | 'parking'
  | 'noise'
  | 'patrol'
  | 'alarm_response'
  | 'ems'
  | 'biosecurity_inspection'
  | 'smoke_complaint_ooh'

export interface RosteredShift {
  id: string
  shift_date: string
  start_time: string | null
  end_time: string | null
  shift_type: string
  service_type: RosterServiceType | null
  position_title: string | null
  client_site_id: string | null
  client_site_name: string | null
  /** The client organisation this shift is for (may differ from the service provider) */
  client_org_id: string | null
  client_org_name: string | null
  zone_id: string | null
  status: string
  officer_response: string | null
  officer_response_at: string | null
  guard_cost_rate: number | null
  client_charge_rate: number | null
  rate_type: string | null
}

export interface ActivityRate {
  activity_type: string
  rate_per_hour: number
  effective_from: string
  effective_to: string | null
}

export interface UseRosteredShiftResult {
  /** Today's confirmed or published roster shift, null if none */
  rosteredShift: RosteredShift | null
  /** All activity rate overrides for this officer */
  activityRates: ActivityRate[]
  /** Effective rate for a given activity type today */
  getRateForActivity: (activityType: string) => number | null
  isLoading: boolean
}

export function useRosteredShift(): UseRosteredShiftResult {
  const { user } = useAuthStore()
  const today = format(nzNow(), 'yyyy-MM-dd')

  // ── Today's roster shift ──────────────────────────────────────────────────

  const { data: rosteredShift = null, isLoading: shiftLoading } = useQuery<RosteredShift | null>({
    queryKey: ['rostered_shift_today', user?.id, today],
    queryFn: async () => {
      if (!user?.id) return null

      const { data, error } = await supabase
        .from('roster_shifts')
        .select(`
          id, shift_date, start_time, end_time, shift_type,
          service_type, position_title, client_site_id, zone_id, status,
          officer_response, officer_response_at,
          guard_cost_rate, client_charge_rate, rate_type,
          client_site:client_sites!client_site_id(
            name,
            organization:organizations!organization_id(id, name)
          )
        `)
        .eq('officer_id', user.id)
        .eq('shift_date', today)
        .in('status', ['published', 'confirmed'])
        .order('start_time', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (error || !data) return null

      const site = Array.isArray(data.client_site) ? data.client_site[0] : data.client_site
      const org  = site
        ? (Array.isArray(site.organization) ? site.organization[0] : site.organization)
        : null

      return {
        id:               data.id,
        shift_date:       data.shift_date,
        start_time:       data.start_time,
        end_time:         data.end_time,
        shift_type:       data.shift_type,
        service_type:     data.service_type ?? null,
        position_title:   data.position_title ?? null,
        client_site_id:   data.client_site_id ?? null,
        client_site_name: site?.name ?? null,
        client_org_id:    org?.id ?? null,
        client_org_name:  org?.name ?? null,
        zone_id:          data.zone_id ?? null,
        status:           data.status,
        officer_response: data.officer_response ?? null,
        officer_response_at: data.officer_response_at ?? null,
        guard_cost_rate:  data.guard_cost_rate ?? null,
        client_charge_rate: data.client_charge_rate ?? null,
        rate_type:        data.rate_type ?? null,
      } as RosteredShift
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  })

  // ── Activity rate overrides ───────────────────────────────────────────────

  const { data: activityRates = [], isLoading: ratesLoading } = useQuery<ActivityRate[]>({
    queryKey: ['officer_activity_rates', user?.id, today],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('officer_activity_rates')
        .select('activity_type, rate_per_hour, effective_from, effective_to')
        .eq('officer_id', user.id)
        .lte('effective_from', today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order('effective_from', { ascending: false })

      if (error) return []
      return (data ?? []) as ActivityRate[]
    },
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
  })

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getRateForActivity(activityType: string): number | null {
    const match = activityRates.find((r) => r.activity_type === activityType)
    return match ? Number(match.rate_per_hour) : null
  }

  return {
    rosteredShift,
    activityRates,
    getRateForActivity,
    isLoading: shiftLoading || ratesLoading,
  }
}
