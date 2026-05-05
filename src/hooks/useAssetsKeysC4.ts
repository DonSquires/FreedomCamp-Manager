import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

const sb = supabase as any

/**
 * Phase C4 Hooks: Assets / Keys / Client / Service Agreements —
 * Case Backbone Integration
 *
 * New tables created by migration 20260710000003:
 *   case_assets_used    — officer_assets deployed during a case
 *   case_keys_used      — key_custody events linked to a case
 *   service_agreements  — client SLA contracts
 */

export function useRecordAssetUsedOnCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      organizationId: string
      caseId: string
      officerAssetId: string
      officerId: string
      notes?: string | null
    }) => {
      const { data, error } = await sb
        .from('case_assets_used')
        .insert({
          organization_id:  input.organizationId,
          case_id:          input.caseId,
          officer_asset_id: input.officerAssetId,
          officer_id:       input.officerId,
          assigned_at:      new Date().toISOString(),
          notes:            input.notes ?? null,
        })
        .select('*')
        .single()
      if (error || !data) throw error ?? new Error('Failed to record asset on case')
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['caseAssets', variables.caseId] })
    },
  })
}

export function useRecordKeyUsedOnCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      organizationId: string
      caseId: string
      keyCustodyId: string
      officerId: string
      notes?: string | null
    }) => {
      const { data, error } = await sb
        .from('case_keys_used')
        .insert({
          organization_id: input.organizationId,
          case_id:         input.caseId,
          key_custody_id:  input.keyCustodyId,
          officer_id:      input.officerId,
          linked_at:       new Date().toISOString(),
          notes:           input.notes ?? null,
        })
        .select('*')
        .single()
      if (error || !data) throw error ?? new Error('Failed to record key on case')
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['caseKeys', variables.caseId] })
    },
  })
}

export function useC4CaseTimeline(caseId: string | undefined) {
  return useQuery({
    queryKey: ['c4CaseTimeline', caseId],
    queryFn: async () => {
      if (!caseId) return { assets: [], keys: [] }
      const [aR, kR] = await Promise.all([
        sb.from('case_assets_used').select('*').eq('case_id', caseId).order('assigned_at', { ascending: true }),
        sb.from('case_keys_used').select('*').eq('case_id', caseId).order('linked_at', { ascending: true }),
      ])
      return { assets: aR.data ?? [], keys: kR.data ?? [] }
    },
    enabled: !!caseId,
  })
}

export function useServiceAgreements(organizationId: string | undefined, options?: {
  clientOrgId?: string
  status?: string
}) {
  return useQuery({
    queryKey: ['serviceAgreements', organizationId, options],
    queryFn: async () => {
      if (!organizationId) return []
      let query = sb.from('service_agreements').select('*').eq('organization_id', organizationId).order('start_date', { ascending: false })
      if (options?.clientOrgId) query = query.eq('client_org_id', options.clientOrgId)
      if (options?.status)      query = query.eq('status', options.status)
      const { data, error } = await query
      if (error) return []
      return data
    },
    enabled: !!organizationId,
  })
}

export function useCreateServiceAgreement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      organizationId: string
      clientOrgId: string
      clientSiteId?: string | null
      agreementNumber: string
      serviceType: string
      startDate: string
      endDate?: string | null
      autoRenew?: boolean
      responseTimeMinutes?: number | null
      patrolFrequencyHours?: number | null
      minOfficers?: number
      createdBy?: string | null
    }) => {
      const { data, error } = await sb
        .from('service_agreements')
        .insert({
          organization_id:        input.organizationId,
          client_org_id:          input.clientOrgId,
          client_site_id:         input.clientSiteId ?? null,
          agreement_number:       input.agreementNumber,
          service_type:           input.serviceType,
          start_date:             input.startDate,
          end_date:               input.endDate ?? null,
          auto_renew:             input.autoRenew ?? false,
          response_time_minutes:  input.responseTimeMinutes ?? null,
          patrol_frequency_hours: input.patrolFrequencyHours ?? null,
          min_officers:           input.minOfficers ?? 1,
          status:                 'active',
          created_by:             input.createdBy ?? null,
        })
        .select('*')
        .single()
      if (error || !data) throw error ?? new Error('Failed to create service agreement')
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['serviceAgreements', variables.organizationId] })
    },
  })
}
