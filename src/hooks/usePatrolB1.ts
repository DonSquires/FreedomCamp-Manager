import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database'

type PatrolRouteInstance = Database['public']['Tables']['patrol_route_instances']['Row']
type WelfareEventB1 = Database['public']['Tables']['welfare_events_b1']['Row']
type PatrolSessionEvent = Database['public']['Tables']['patrol_session_events']['Row']

/**
 * Phase B1 Hooks: Patrol and Respond
 * Integrates existing patrol infrastructure with case model
 */

// ============================================================================
// usePatrolRunByCase: Fetch patrol run linked to a case
// ============================================================================

export function usePatrolRunByCase(caseId: string | undefined) {
  return useQuery({
    queryKey: ['patrol_run', caseId],
    queryFn: async () => {
      if (!caseId) return null
      const { data, error } = await supabase
        .from('patrol_route_instances')
        .select('*')
        .eq('case_id', caseId)
        .single()
      if (error) return null
      return data as PatrolRouteInstance | null
    },
    enabled: !!caseId,
  })
}

// ============================================================================
// useWelfareEvents: Query welfare events for a patrol session
// ============================================================================

export function useWelfareEvents(caseId: string | undefined) {
  return useQuery({
    queryKey: ['welfare_events', caseId],
    queryFn: async () => {
      if (!caseId) return []
      const { data, error } = await supabase
        .from('welfare_events_b1')
        .select('*')
        .eq('case_id', caseId)
        .order('reported_at', { ascending: false })
      if (error) return []
      return data as WelfareEventB1[]
    },
    enabled: !!caseId,
  })
}

// ============================================================================
// useCreateWelfareEvent: Record officer wellness check-in
// ============================================================================

export function useCreateWelfareEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      caseId: string
      patrolInstanceId: string | undefined
      officerId: string
      eventType: 'scheduled_checkin' | 'officer_initiated' | 'supervisor_alert' | 'missed_checkin' | 'emergency_alert'
      severity?: 'routine' | 'yellow_flag' | 'red_flag' | 'emergency'
      notes?: string
    }) => {
      const { data, error } = await supabase
        .from('welfare_events_b1')
        .insert({
          case_id: input.caseId,
          patrol_route_instance_id: input.patrolInstanceId || null,
          officer_id: input.officerId,
          event_type: input.eventType,
          severity: input.severity || 'routine',
          notes: input.notes,
          status: 'open',
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['welfare_events', input.caseId] })
    },
  })
}

// ============================================================================
// usePatrolSessionEvents: Timeline of patrol progress
// ============================================================================

export function usePatrolSessionEvents(caseId: string | undefined) {
  return useQuery({
    queryKey: ['patrol_session_events', caseId],
    queryFn: async () => {
      if (!caseId) return []
      const { data, error } = await supabase
        .from('patrol_session_events')
        .select('*')
        .eq('case_id', caseId)
        .order('event_time', { ascending: true })
      if (error) return []
      return data as PatrolSessionEvent[]
    },
    enabled: !!caseId,
  })
}

// ============================================================================
// useRecordPatrolSessionEvent: Log checkpoint scan or progress event
// ============================================================================

export function useRecordPatrolSessionEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      caseId: string
      patrolInstanceId: string | undefined
      officerId: string
      eventType: 'patrol_started' | 'checkpoint_scan' | 'checkpoint_missed' | 'patrol_completed'
      checkpointName?: string
      location?: { lat: number; lng: number }
      notes?: string
    }) => {
      const { data, error } = await supabase
        .from('patrol_session_events')
        .insert({
          case_id: input.caseId,
          patrol_route_instance_id: input.patrolInstanceId || null,
          officer_id: input.officerId,
          event_type: input.eventType,
          checkpoint_name: input.checkpointName,
          location: input.location ? `POINT(${input.location.lng} ${input.location.lat})` : null,
          notes: input.notes,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['patrol_session_events', input.caseId] })
    },
  })
}

// ============================================================================
// useAckWelfareEvent: Acknowledge an alert
// ============================================================================

export function useAckWelfareEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data, error } = await supabase
        .from('welfare_events_b1')
        .update({ status: 'acknowledged' })
        .eq('id', eventId)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (newData) => {
      queryClient.invalidateQueries({ queryKey: ['welfare_events'] })
    },
  })
}

// ============================================================================
// useResolveWelfareEvent: Mark an alert as resolved
// ============================================================================

export function useResolveWelfareEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { eventId: string; resolutionNotes?: string }) => {
      const { data, error } = await supabase
        .from('welfare_events_b1')
        .update({ status: 'resolved', resolved_at: new Date().toISOString(), notes: input.resolutionNotes })
        .eq('id', input.eventId)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['welfare_events'] })
    },
  })
}

// ============================================================================
// useLinkPatrolToCase: Associate a patrol_route_instance with a case
// ============================================================================

export function useLinkPatrolToCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { patrolInstanceId: string; caseId: string }) => {
      const { data, error } = await supabase
        .from('patrol_route_instances')
        .update({ case_id: input.caseId })
        .eq('id', input.patrolInstanceId)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['patrol_run', input.caseId] })
    },
  })
}
