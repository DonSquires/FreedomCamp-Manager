import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Phase B2 tables may not yet appear in generated Database types.
// Use runtime queries while schema/type generation catches up.
const sb = supabase as any

interface AcknowledgementLog {
  id: string
  case_id: string
  dispatch_job_id: string
  officer_id: string
  lifecycle_stage: string
  callsign?: string | null
  eta_seconds?: number | null
  notes?: string | null
  acknowledged_at?: string | null
}

/**
 * Phase B2 Hooks: Dispatch and Command
 *
 * Provides the dispatch acknowledgement lifecycle flow and case-creation
 * helpers needed by the Phase B dispatch-command delivery slice.
 */

// ============================================================================
// useCreateCaseFromDispatch
// Calls the create_case_from_dispatch_job RPC to create an operational case
// linked to an existing dispatch job and record the initial dispatch event.
// ============================================================================

export function useCreateCaseFromDispatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (dispatchJobId: string) => {
      const { data, error } = await sb.rpc('create_case_from_dispatch_job', {
        dispatch_job_id: dispatchJobId,
      })
      if (error) throw error
      return data as string // returns case UUID
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operationalCases'] })
      queryClient.invalidateQueries({ queryKey: ['dispatchEvents'] })
    },
  })
}

// ============================================================================
// useDispatchJobCase
// Fetches the operational case linked to a specific dispatch job.
// ============================================================================

export function useDispatchJobCase(dispatchJobId: string | undefined) {
  return useQuery({
    queryKey: ['dispatchJobCase', dispatchJobId],
    queryFn: async () => {
      if (!dispatchJobId) return null
      const { data, error } = await sb
        .from('operational_cases')
        .select('*')
        .eq('dispatch_job_id', dispatchJobId)
        .single()
      if (error) return null
      return data
    },
    enabled: !!dispatchJobId,
  })
}

// ============================================================================
// useAcknowledgeDispatch
// Records an acknowledgement lifecycle transition (assigned → acknowledged →
// en_route → on_scene → completed) with the officer's callsign and ETA.
// ============================================================================

export function useAcknowledgeDispatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      caseId: string
      dispatchJobId: string
      officerId: string
      lifecycleStage: 'assigned' | 'acknowledged' | 'en_route' | 'on_scene' | 'completed' | 'cancelled'
      callsign?: string
      etaSeconds?: number
      notes?: string
    }) => {
      const { data, error } = await sb
        .from('dispatch_acknowledgement_log')
        .insert({
          case_id: input.caseId,
          dispatch_job_id: input.dispatchJobId,
          officer_id: input.officerId,
          lifecycle_stage: input.lifecycleStage,
          callsign: input.callsign ?? null,
          eta_seconds: input.etaSeconds ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return data as AcknowledgementLog
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['dispatchAckLog', input.caseId] })
      queryClient.invalidateQueries({ queryKey: ['dispatchEvents', input.caseId] })
    },
  })
}

// ============================================================================
// useDispatchAcknowledgementLog
// Fetches the ordered acknowledgement log for a case (latest first).
// ============================================================================

export function useDispatchAcknowledgementLog(caseId: string | undefined) {
  return useQuery({
    queryKey: ['dispatchAckLog', caseId],
    queryFn: async () => {
      if (!caseId) return []
      const { data, error } = await sb
        .from('dispatch_acknowledgement_log')
        .select('*')
        .eq('case_id', caseId)
        .order('acknowledged_at', { ascending: false })
      if (error) return []
      return data as AcknowledgementLog[]
    },
    enabled: !!caseId,
  })
}

// ============================================================================
// useRecordDispatchLifecycle
// Low-level helper to record any dispatch_events entry for a case.
// Prefer useAcknowledgeDispatch for acknowledgement-specific transitions.
// ============================================================================

export function useRecordDispatchLifecycle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      caseId: string
      dispatchJobId: string
      eventType:
        | 'dispatch_created'
        | 'dispatch_assigned'
        | 'dispatch_awaiting_ack'
        | 'dispatch_acknowledged'
        | 'dispatch_en_route'
        | 'dispatch_on_scene'
        | 'dispatch_completed'
        | 'dispatch_cancelled'
        | 'dispatch_escalated'
      assignedTo?: string
      statusAtEvent?: string
      notes?: string
    }) => {
      const { data, error } = await sb
        .from('dispatch_events')
        .insert({
          case_id: input.caseId,
          dispatch_job_id: input.dispatchJobId,
          event_type: input.eventType,
          assigned_to: input.assignedTo ?? null,
          status_at_event: input.statusAtEvent ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['dispatchEvents', input.caseId] })
    },
  })
}
