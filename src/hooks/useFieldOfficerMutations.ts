import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface WelfareAlertPayload {
  officer_id: string
  organization_id: string
  alert_type: string
  officer_name: string
  gps_latitude: number | null
  gps_longitude: number | null
  last_activity_at: string
  escalation_level: number
}

export function useInsertWelfareAlert() {
  return useMutation({
    mutationFn: async (payload: WelfareAlertPayload) => {
      const { error } = await supabase.from('officer_welfare_alerts').insert(payload)
      if (error) throw error
    },
  })
}

export function useMarkNotificationRead() {
  return useMutation({
    mutationFn: async (notifId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true, read_at: new Date().toISOString() })
        .eq('id', notifId)
      if (error) throw error
    },
  })
}

interface StartShiftPayload {
  officer_id: string
  organization_id: string
  parent_zone_id: string | null
  gps_start_lat: number | null
  gps_start_lng: number | null
}

export function useStartOfficerShift() {
  return useMutation({
    mutationFn: async (payload: StartShiftPayload) => {
      const { data, error } = await (supabase.from('officer_shifts') as any)
        .insert(payload)
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
  })
}

interface EndShiftPayload {
  shiftId: string
  gps_end_lat: number | null
  gps_end_lng: number | null
}

export function useEndOfficerShift() {
  return useMutation({
    mutationFn: async ({ shiftId, gps_end_lat, gps_end_lng }: EndShiftPayload) => {
      const { error } = await (supabase.from('officer_shifts') as any)
        .update({ ended_at: new Date().toISOString(), gps_end_lat, gps_end_lng })
        .eq('id', shiftId)
      if (error) throw error
    },
  })
}
