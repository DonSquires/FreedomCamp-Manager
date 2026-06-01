import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { validateNoticeIssuancePayload } from '@/lib/noticeWorkflow'

const sb = supabase as any

/**
 * Phase C3 Hooks: POI / VOI / Trespass Notices / Alert Queue —
 * Case Backbone Integration
 *
 * Domain tables extended with case_id FK by migration 20260710000002:
 *   persons_of_interest  — POI subject linked to a case
 *   vehicles_of_interest — VOI alert linked to a case
 *   trespass_notices     — formal trespass notice linked to a case
 *   alert_queue          — dispatch alert linked to a case
 */

export function useOpenPOIAlertCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      organizationId: string
      officerId: string
      caseType?: 'poi_alert' | 'voi_alert' | 'evidence_capture'
      title?: string | null
    }) => {
      const ct = input.caseType ?? 'poi_alert'
      const cf = ct === 'poi_alert' ? 'poi_match' : ct === 'voi_alert' ? 'voi_match' : 'evidence'
      const { data, error } = await sb
        .from('operational_cases')
        .insert({
          organization_id: input.organizationId,
          case_type:       ct,
          created_from:    cf,
          status:          'active',
          title:           input.title ?? `${ct} — ${new Date().toISOString()}`,
          created_by:      input.officerId,
        })
        .select('id, case_type, status')
        .single()
      if (error || !data) throw error ?? new Error('Failed to open POI/VOI case')
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['poiCases', variables.organizationId] })
    },
  })
}

export function useLinkPOIToCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { poiId: string; caseId: string }) => {
      const { data, error } = await sb
        .from('persons_of_interest')
        .update({ case_id: input.caseId })
        .eq('id', input.poiId)
        .select('id, case_id, full_name, status')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['poiCaseTimeline', variables.caseId] })
    },
  })
}

export function useLinkVOIToCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { voiId: string; caseId: string }) => {
      const { data, error } = await sb
        .from('vehicles_of_interest')
        .update({ case_id: input.caseId })
        .eq('id', input.voiId)
        .select('id, case_id, status')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['poiCaseTimeline', variables.caseId] })
    },
  })
}

export function useIssueTrespassNoticeOnCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      organizationId: string
      caseId: string
      issuedBy: string
      noticeType?: string
      trespassReason?: string
      issuerRole?: string
    }) => {
      const issuanceValidation = validateNoticeIssuancePayload({
        noticeClass: 'trespass',
        legalBasis: 'Trespass Act 1980',
        issuerId: input.issuedBy,
        issuerRole: input.issuerRole || 'officer',
        policyReference: 'trespass.notice.default',
        evidenceRefs: [input.caseId],
        serviceProof: {
          method: 'in_person',
          servedAt: new Date().toISOString(),
          servedBy: input.issuedBy,
        },
      })
      if (!issuanceValidation.ok) throw new Error(issuanceValidation.errors[0] || 'Missing trespass issuance data')
      const { data, error } = await sb
        .from('trespass_notices')
        .insert({
          organization_id: input.organizationId,
          case_id:         input.caseId,
          issued_by:       input.issuedBy,
          notice_type:     input.noticeType ?? 'written',
          trespass_reason: input.trespassReason ?? 'Issued via case workflow',
          status:          'active',
        })
        .select('id, case_id, notice_type, status')
        .single()
      if (error || !data) throw error ?? new Error('Failed to issue trespass notice')
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['poiCaseTimeline', variables.caseId] })
      queryClient.invalidateQueries({ queryKey: ['trespassNotices', variables.organizationId] })
    },
  })
}

export function useLinkAlertToCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { alertId: string; caseId: string }) => {
      const { data, error } = await sb
        .from('alert_queue')
        .update({ case_id: input.caseId })
        .eq('id', input.alertId)
        .select('id, case_id, alert_type, status')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['poiCaseTimeline', variables.caseId] })
    },
  })
}

export function usePOICaseTimeline(caseId: string | undefined) {
  return useQuery({
    queryKey: ['poiCaseTimeline', caseId],
    queryFn: async () => {
      if (!caseId) return { pois: [], vois: [], notices: [], alerts: [] }
      const [pR, vR, nR, aR] = await Promise.all([
        sb.from('persons_of_interest').select('id,case_id,full_name,status,created_at').eq('case_id', caseId).order('created_at', { ascending: true }),
        sb.from('vehicles_of_interest').select('id,case_id,status,created_at').eq('case_id', caseId).order('created_at', { ascending: true }),
        sb.from('trespass_notices').select('id,case_id,notice_type,status,created_at').eq('case_id', caseId).order('created_at', { ascending: true }),
        sb.from('alert_queue').select('id,case_id,alert_type,priority,status,created_at').eq('case_id', caseId).order('created_at', { ascending: true }),
      ])
      return {
        pois:    pR.data ?? [],
        vois:    vR.data ?? [],
        notices: nR.data ?? [],
        alerts:  aR.data ?? [],
      }
    },
    enabled: !!caseId,
  })
}
