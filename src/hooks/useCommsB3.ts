import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Phase B3 tables may not yet appear in generated Database types.
// Use runtime queries while schema/type generation catches up.
const sb = supabase as any

interface RadioCommsEvent {
  id: string
  case_id: string
  officer_id?: string | null
  callsign?: string | null
  channel_scope?: string | null
  event_type: string
  degraded_mode: boolean
  ptt_session_id?: string | null
  notes?: string | null
  event_timestamp?: string | null
}

/**
 * Phase B3 Hooks: Communications — Callsign Binding & Dispatch-to-Radio Escalation
 *
 * Wires PTT/radio activity into the shared operational case timeline so the
 * command console can surface radio state alongside patrol and dispatch events.
 *
 * Lifecycle events recorded on `radio_comms_events`:
 *   radio_callsign_bound        — officer callsign resolved and bound to the case
 *   dispatch_escalated_to_radio — dispatch console escalated the job to PTT radio
 *   radio_degraded_mode         — PTT unavailable; case stays open with gap marked
 *   radio_channel_left          — officer left the active channel for this case
 */

// ============================================================================
// useOfficerCallsign
// Fetches the auto-assigned callsign for an officer from user_profiles.
// Used to capture the active callsign before inserting a radio_comms_events row.
// ============================================================================

export function useOfficerCallsign(officerId: string | undefined) {
  return useQuery({
    queryKey: ['officerCallsign', officerId],
    queryFn: async () => {
      if (!officerId) return null
      const { data, error } = await sb
        .from('user_profiles')
        .select('id, callsign')
        .eq('id', officerId)
        .single()
      if (error) return null
      return (data as { id: string; callsign?: string | null })?.callsign ?? null
    },
    enabled: !!officerId,
    staleTime: 60_000, // callsigns rarely change; cache for 1 min
  })
}

// ============================================================================
// useRadioCommsEvents
// Fetches all radio comms events for a case in chronological order.
// Consumed by the unified case timeline component.
// ============================================================================

export function useRadioCommsEvents(caseId: string | undefined) {
  return useQuery({
    queryKey: ['radioCommsEvents', caseId],
    queryFn: async () => {
      if (!caseId) return []
      const { data, error } = await sb
        .from('radio_comms_events')
        .select('*')
        .eq('case_id', caseId)
        .order('event_timestamp', { ascending: true })
      if (error) return []
      return data as RadioCommsEvent[]
    },
    enabled: !!caseId,
  })
}

// ============================================================================
// useBindCallsignToCase
// Records a radio_callsign_bound event when an officer's callsign is resolved
// and associated with an active case (e.g. on PTT session start).
// ============================================================================

export function useBindCallsignToCase() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      caseId: string
      organizationId: string
      officerId: string
      callsign: string
      channelScope?: string
      pttSessionId?: string
      notes?: string
    }) => {
      const { data, error } = await sb
        .from('radio_comms_events')
        .insert({
          organization_id: input.organizationId,
          case_id: input.caseId,
          officer_id: input.officerId,
          callsign: input.callsign,
          channel_scope: input.channelScope ?? null,
          event_type: 'radio_callsign_bound',
          degraded_mode: false,
          ptt_session_id: input.pttSessionId ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return data as RadioCommsEvent
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['radioCommsEvents', input.caseId] })
    },
  })
}

// ============================================================================
// useRecordDispatchEscalationToRadio
// Called when the dispatch console escalates a job to PTT radio.
// Records BOTH a radio_comms_events entry (dispatch_escalated_to_radio) AND
// a dispatch_events entry (dispatch_escalated) so the unified timeline shows
// the escalation from both the dispatch and radio domains.
// ============================================================================

export function useRecordDispatchEscalationToRadio() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      caseId: string
      organizationId: string
      dispatchJobId: string
      officerId: string
      callsign?: string
      channelScope?: string
      pttSessionId?: string
      notes?: string
    }) => {
      // 1. Radio comms event — marks the point the job was handed off to radio
      const { data: radioEvent, error: radioErr } = await sb
        .from('radio_comms_events')
        .insert({
          organization_id: input.organizationId,
          case_id: input.caseId,
          officer_id: input.officerId,
          callsign: input.callsign ?? null,
          channel_scope: input.channelScope ?? null,
          event_type: 'dispatch_escalated_to_radio',
          degraded_mode: false,
          ptt_session_id: input.pttSessionId ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single()
      if (radioErr) throw radioErr

      // 2. Dispatch event — advances the dispatch lifecycle to 'escalated'
      const { error: dispatchErr } = await sb.from('dispatch_events').insert({
        organization_id: input.organizationId,
        case_id: input.caseId,
        dispatch_job_id: input.dispatchJobId,
        event_type: 'dispatch_escalated',
        notes: `Escalated to radio${input.callsign ? ` — callsign: ${input.callsign}` : ''}`,
      })
      if (dispatchErr) throw dispatchErr

      return radioEvent as RadioCommsEvent
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['radioCommsEvents', input.caseId] })
      queryClient.invalidateQueries({ queryKey: ['dispatchEvents', input.caseId] })
    },
  })
}

// ============================================================================
// useRecordRadioDegradedMode
// Records a radio_degraded_mode event when PTT is unavailable.
// The case remains open; the timeline shows the gap in radio coverage.
// Dispatch falls back to push + in-app alerts per plan §10.1.
// ============================================================================

export function useRecordRadioDegradedMode() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      caseId: string
      organizationId: string
      officerId: string
      callsign?: string
      notes?: string
      pttSessionId?: string
    }) => {
      const { data, error } = await sb
        .from('radio_comms_events')
        .insert({
          organization_id: input.organizationId,
          case_id: input.caseId,
          officer_id: input.officerId,
          callsign: input.callsign ?? null,
          event_type: 'radio_degraded_mode',
          degraded_mode: true,
          ptt_session_id: input.pttSessionId ?? null,
          notes: input.notes ?? 'PTT unavailable — radio in degraded mode',
        })
        .select()
        .single()
      if (error) throw error
      return data as RadioCommsEvent
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['radioCommsEvents', input.caseId] })
    },
  })
}

// ============================================================================
// useRecordRadioChannelLeft
// Records when an officer leaves the active PTT channel for a case.
// ============================================================================

export function useRecordRadioChannelLeft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      caseId: string
      organizationId: string
      officerId: string
      callsign?: string
      channelScope?: string
      pttSessionId?: string
      notes?: string
    }) => {
      const { data, error } = await sb
        .from('radio_comms_events')
        .insert({
          organization_id: input.organizationId,
          case_id: input.caseId,
          officer_id: input.officerId,
          callsign: input.callsign ?? null,
          channel_scope: input.channelScope ?? null,
          event_type: 'radio_channel_left',
          degraded_mode: false,
          ptt_session_id: input.pttSessionId ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return data as RadioCommsEvent
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['radioCommsEvents', input.caseId] })
    },
  })
}
