import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Phase B4 tables may not yet appear in generated Database types.
// Use runtime queries while schema/type generation catches up.
const sb = supabase as any

interface EnforcementEvent {
  id: string
  case_id: string
  event_type: string
  officer_id: string
  subject_type?: string | null
  subject_identifier?: string | null
  violation_type?: string | null
  action_taken?: string | null
  outcome?: string | null
  photo_urls?: string[] | null
  evidence_notes?: string | null
  event_timestamp?: string | null
  status?: string | null
}

interface BreachAlertWithCase {
  id: string
  case_id?: string | null
  plate_number?: string | null
  status?: string | null
  organization_id?: string | null
  [key: string]: unknown
}

/**
 * Phase B4 Hooks: Freedom Camping Enforcement
 *
 * Provides the enforcement-to-case linking and timeline recording hooks
 * needed by the Phase B enforcement delivery slice (B4).
 */

// ============================================================================
// useCreateCaseFromBreach
// Calls the create_case_from_breach_alert RPC to create an operational case
// linked to an existing breach alert and record the initial enforcement event.
// ============================================================================

export function useCreateCaseFromBreach() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (breachAlertId: string) => {
      const { data, error } = await sb.rpc('create_case_from_breach_alert', {
        p_breach_alert_id: breachAlertId,
      })
      if (error) throw error
      return data as string // returns case UUID
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operationalCases'] })
      queryClient.invalidateQueries({ queryKey: ['enforcementTimeline'] })
      queryClient.invalidateQueries({ queryKey: ['enforcementEvents'] })
      queryClient.invalidateQueries({ queryKey: ['breachAlertCase'] })
    },
  })
}

// ============================================================================
// useBreachAlertCase
// Fetches the operational case linked to a specific breach alert.
// ============================================================================

export function useBreachAlertCase(breachAlertId: string | undefined) {
  return useQuery({
    queryKey: ['breachAlertCase', breachAlertId],
    queryFn: async () => {
      if (!breachAlertId) return null
      const { data, error } = await sb
        .from('breach_alerts')
        .select('id, case_id, plate_number, status, organization_id')
        .eq('id', breachAlertId)
        .single()
      if (error) return null
      return data as BreachAlertWithCase | null
    },
    enabled: !!breachAlertId,
  })
}

// ============================================================================
// useLinkBreachToCase
// Manually links an existing breach alert to an existing operational case.
// Use useCreateCaseFromBreach when no case yet exists.
// ============================================================================

export function useLinkBreachToCase() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { breachAlertId: string; caseId: string }) => {
      const { data, error } = await sb
        .from('breach_alerts')
        .update({ case_id: input.caseId })
        .eq('id', input.breachAlertId)
        .select('id, case_id')
        .single()
      if (error) throw error
      return data as BreachAlertWithCase
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['breachAlertCase', input.breachAlertId] })
      queryClient.invalidateQueries({ queryKey: ['enforcementTimeline', input.caseId] })
      queryClient.invalidateQueries({ queryKey: ['enforcementEvents', input.caseId] })
    },
  })
}

// ============================================================================
// useEnforcementTimeline
// Fetches the full enforcement event timeline for a case in chronological
// order. Used by the enforcement case detail view to render officer actions.
// ============================================================================

export function useEnforcementTimeline(caseId: string | undefined) {
  return useQuery({
    queryKey: ['enforcementTimeline', caseId],
    queryFn: async () => {
      if (!caseId) return []
      const { data, error } = await sb
        .from('enforcement_events')
        .select('*')
        .eq('case_id', caseId)
        .order('event_timestamp', { ascending: true })
      if (error) return []
      return data as EnforcementEvent[]
    },
    enabled: !!caseId,
  })
}

// ============================================================================
// useRecordEnforcementEvent
// Records an enforcement action event on the shared case timeline.
// Covers the full enforcement lifecycle from initiation to outcome.
// ============================================================================

export function useRecordEnforcementEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      caseId: string
      officerId: string
      organizationId: string
      eventType:
        | 'enforcement_initiated'
        | 'enforcement_warning_issued'
        | 'enforcement_ticket_issued'
        | 'enforcement_apprehension'
        | 'enforcement_completed'
        | 'enforcement_cancelled'
      subjectType?: 'person' | 'vehicle' | 'site' | 'activity'
      subjectIdentifier?: string
      violationType?: string
      actionTaken?: string
      outcome?: string
      photoUrls?: string[]
      evidenceNotes?: string
    }) => {
      const { data, error } = await sb
        .from('enforcement_events')
        .insert({
          organization_id: input.organizationId,
          case_id: input.caseId,
          officer_id: input.officerId,
          event_type: input.eventType,
          subject_type: input.subjectType ?? null,
          subject_identifier: input.subjectIdentifier ?? null,
          violation_type: input.violationType ?? null,
          action_taken: input.actionTaken ?? null,
          outcome: input.outcome ?? null,
          photo_urls: input.photoUrls ?? null,
          evidence_notes: input.evidenceNotes ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return data as EnforcementEvent
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['enforcementTimeline', input.caseId] })
      queryClient.invalidateQueries({ queryKey: ['enforcementEvents', input.caseId] })
    },
  })
}

// ============================================================================
// useCloseEnforcementCase
// Marks a case as closed and records the completed enforcement event.
// ============================================================================

export function useCloseEnforcementCase() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      caseId: string
      officerId: string
      organizationId: string
      outcome: string
      notes?: string
    }) => {
      // Record enforcement_completed event
      const { error: evtError } = await sb.from('enforcement_events').insert({
        organization_id: input.organizationId,
        case_id: input.caseId,
        officer_id: input.officerId,
        event_type: 'enforcement_completed',
        outcome: input.outcome,
        evidence_notes: input.notes ?? null,
      })
      if (evtError) throw evtError

      // Close the case
      const { data, error: caseError } = await sb
        .from('operational_cases')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', input.caseId)
        .select('id, status, closed_at')
        .single()
      if (caseError) throw caseError
      return data
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['enforcementTimeline', input.caseId] })
      queryClient.invalidateQueries({ queryKey: ['operationalCases'] })
    },
  })
}
