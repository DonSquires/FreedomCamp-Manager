import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

const sb = supabase as any

/**
 * Phase C2 Hooks: Access Control / Identity Verification / Site Risk Assessment
 * — Case Backbone Integration
 *
 * Domain tables extended with case_id FK by migration 20260710000001:
 *   access_control_incidents   — access anomalies linked to a case
 *   access_entries             — entry/exit events linked to a case
 *   person_id_documents        — identity verification records linked to a case
 *   site_risk_assessments      — WorkSafe-style risk reviews linked to a case
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface AccessControlCase {
  id: string
  case_type: string
  status: string
}

export function useOpenAccessControlCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      organizationId: string
      officerId: string
      caseType?: 'access_control' | 'identity_check'
      title?: string | null
    }) => {
      const ct = input.caseType ?? 'access_control'
      const { data, error } = await sb
        .from('operational_cases')
        .insert({
          organization_id: input.organizationId,
          case_type:   ct,
          created_from: ct,
          status:      'active',
          title:       input.title ?? `${ct} — ${new Date().toISOString()}`,
          created_by:  input.officerId,
        })
        .select('id, case_type, status')
        .single()
      if (error || !data) throw error ?? new Error('Failed to open access control case')
      return data as AccessControlCase
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['accessControlCases', variables.organizationId] })
    },
  })
}

export function useLogAccessIncidentToCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { incidentId: string; caseId: string }) => {
      const { data, error } = await sb
        .from('access_control_incidents')
        .update({ case_id: input.caseId })
        .eq('id', input.incidentId)
        .select('id, case_id')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['accessControlCaseTimeline', variables.caseId] })
    },
  })
}

export function useLogIdentityVerificationToCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { documentId: string; caseId: string }) => {
      const { data, error } = await sb
        .from('person_id_documents')
        .update({ case_id: input.caseId })
        .eq('id', input.documentId)
        .select('id, case_id')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['accessControlCaseTimeline', variables.caseId] })
    },
  })
}

export function useLogRiskAssessmentToCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { assessmentId: string; caseId: string }) => {
      const { data, error } = await sb
        .from('site_risk_assessments')
        .update({ case_id: input.caseId })
        .eq('id', input.assessmentId)
        .select('id, case_id')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['accessControlCaseTimeline', variables.caseId] })
    },
  })
}

export function useAccessControlCaseTimeline(caseId: string | undefined) {
  return useQuery({
    queryKey: ['accessControlCaseTimeline', caseId],
    queryFn: async () => {
      if (!caseId) return { incidents: [], entries: [], documents: [], assessments: [] }
      const [incR, entR, docR, assR] = await Promise.all([
        sb.from('access_control_incidents').select('id,case_id,incident_type,description,severity,status,created_at').eq('case_id', caseId).order('created_at', { ascending: true }),
        sb.from('access_entries').select('id,case_id,person_id,access_type,granted,created_at').eq('case_id', caseId).order('created_at', { ascending: true }),
        sb.from('person_id_documents').select('id,case_id,person_id,document_type,verified,created_at').eq('case_id', caseId).order('created_at', { ascending: true }),
        sb.from('site_risk_assessments').select('id,case_id,overall_risk_level,status,created_at').eq('case_id', caseId).order('created_at', { ascending: true }),
      ])
      return {
        incidents:   incR.data  ?? [],
        entries:     entR.data  ?? [],
        documents:   docR.data  ?? [],
        assessments: assR.data  ?? [],
      }
    },
    enabled: !!caseId,
  })
}
