import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database, Json } from '@/types/database'

const sb = supabase as any

export type BobActionProposalRow = Database['public']['Tables']['bob_action_proposals']['Row']
export type BobActionProposalEventRow = Database['public']['Tables']['bob_action_proposal_events']['Row']
export type BobProposalImpactLevel = 'low' | 'medium' | 'high' | 'critical'
export type BobProposalRiskLevel = 'low' | 'medium' | 'high'

export interface CreateBobActionProposalInput {
  organizationId: string
  requestedBy: string
  proposalType: string
  title: string
  proposalPayload?: Json
  impactLevel?: BobProposalImpactLevel
  caseId?: string | null
  sourceRecordTable?: string | null
  sourceRecordId?: string | null
  sourceContextRefs?: string[]
  approvalWindowSeconds?: number
}

export function mapRiskLevelToImpactLevel(riskLevel?: BobProposalRiskLevel): BobProposalImpactLevel {
  if (riskLevel === 'high') return 'high'
  if (riskLevel === 'low') return 'low'
  return 'medium'
}

export async function createBobActionProposalRecord(
  input: CreateBobActionProposalInput,
): Promise<BobActionProposalRow> {
  const approvalDueAt = new Date(Date.now() + ((input.approvalWindowSeconds ?? 30) * 1000)).toISOString()
  const { data, error } = await sb
    .from('bob_action_proposals')
    .insert({
      organization_id: input.organizationId,
      requested_by: input.requestedBy,
      proposal_type: input.proposalType,
      title: input.title,
      proposal_payload: input.proposalPayload ?? {},
      impact_level: input.impactLevel ?? 'medium',
      case_id: input.caseId ?? null,
      source_record_table: input.sourceRecordTable ?? null,
      source_record_id: input.sourceRecordId ?? null,
      source_context_refs: input.sourceContextRefs ?? [],
      approval_due_at: approvalDueAt,
    })
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('Failed to create Bob proposal')
  return data as BobActionProposalRow
}

export async function approveBobActionProposalRecord(input: {
  proposalId: string
  note?: string
  actorId?: string
}) {
  const { data, error } = await sb.rpc('approve_bob_action_proposal', {
    p_proposal_id: input.proposalId,
    p_decision: 'approve',
    p_note: input.note ?? null,
    p_actor_id: input.actorId ?? null,
  })
  if (error || !data) throw error ?? new Error('Failed to approve Bob proposal')
  return data as BobActionProposalRow
}

export async function rejectBobActionProposalRecord(input: {
  proposalId: string
  note?: string
  actorId?: string
}) {
  const { data, error } = await sb.rpc('approve_bob_action_proposal', {
    p_proposal_id: input.proposalId,
    p_decision: 'reject',
    p_note: input.note ?? null,
    p_actor_id: input.actorId ?? null,
  })
  if (error || !data) throw error ?? new Error('Failed to reject Bob proposal')
  return data as BobActionProposalRow
}

export async function escalateExpiredBobActionProposals(input?: {
  organizationId?: string | null
}) {
  const { data, error } = await sb.rpc('escalate_expired_bob_action_proposals', {
    p_organization_id: input?.organizationId ?? null,
  })
  if (error) throw error
  return Number(data ?? 0)
}

export async function markBobActionProposalExecutionRecord(input: {
  proposalId: string
  status: 'executed' | 'execution_failed'
  note?: string
  error?: string | null
  actorId?: string
}) {
  const { data, error } = await sb.rpc('mark_bob_action_proposal_execution', {
    p_proposal_id: input.proposalId,
    p_execution_status: input.status,
    p_note: input.note ?? null,
    p_error: input.error ?? null,
    p_actor_id: input.actorId ?? null,
  })
  if (error || !data) throw error ?? new Error('Failed to record Bob proposal execution')
  return data as BobActionProposalRow
}

export async function listPendingBobActionProposals(input: {
  organizationId: string
  includeEscalated?: boolean
  limit?: number
}) {
  const statuses = input.includeEscalated === false
    ? ['proposed']
    : ['proposed', 'pending_escalation']

  const { data, error } = await sb
    .from('bob_action_proposals')
    .select('*')
    .eq('organization_id', input.organizationId)
    .in('status', statuses)
    .order('approval_due_at', { ascending: true })
    .limit(input.limit ?? 25)

  if (error) throw error
  return (data ?? []) as BobActionProposalRow[]
}

export function useCreateBobActionProposal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createBobActionProposalRecord,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['bobActionProposalQueue', data.organization_id] })
      if (data.case_id) {
        queryClient.invalidateQueries({ queryKey: ['bobActionProposalCaseTimeline', data.case_id] })
      }
    },
  })
}

export function useBobActionProposalQueue(
  organizationId: string | undefined,
  options?: { includeEscalated?: boolean; limit?: number; enabled?: boolean; refetchInterval?: number },
) {
  return useQuery({
    queryKey: ['bobActionProposalQueue', organizationId, options?.includeEscalated, options?.limit],
    queryFn: async () => {
      if (!organizationId) return []
      return listPendingBobActionProposals({
        organizationId,
        includeEscalated: options?.includeEscalated,
        limit: options?.limit,
      })
    },
    enabled: !!organizationId && options?.enabled !== false,
    refetchInterval: options?.refetchInterval ?? 30_000,
  })
}

export function useApproveBobActionProposal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: approveBobActionProposalRecord,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['bobActionProposalQueue', data.organization_id] })
      queryClient.invalidateQueries({ queryKey: ['bobActionProposalAuditTrail', data.id] })
      if (data.case_id) {
        queryClient.invalidateQueries({ queryKey: ['bobActionProposalCaseTimeline', data.case_id] })
      }
    },
  })
}

export function useRejectBobActionProposal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: rejectBobActionProposalRecord,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['bobActionProposalQueue', data.organization_id] })
      queryClient.invalidateQueries({ queryKey: ['bobActionProposalAuditTrail', data.id] })
      if (data.case_id) {
        queryClient.invalidateQueries({ queryKey: ['bobActionProposalCaseTimeline', data.case_id] })
      }
    },
  })
}

export function useEscalateExpiredBobActionProposals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: escalateExpiredBobActionProposals,
    onSuccess: (_count, variables) => {
      if (variables?.organizationId) {
        queryClient.invalidateQueries({ queryKey: ['bobActionProposalQueue', variables.organizationId] })
      } else {
        queryClient.invalidateQueries({ queryKey: ['bobActionProposalQueue'] })
      }
    },
  })
}

export function useMarkBobActionProposalExecution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markBobActionProposalExecutionRecord,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['bobActionProposalQueue', data.organization_id] })
      queryClient.invalidateQueries({ queryKey: ['bobActionProposalAuditTrail', data.id] })
      if (data.case_id) {
        queryClient.invalidateQueries({ queryKey: ['bobActionProposalCaseTimeline', data.case_id] })
      }
    },
  })
}

export function useBobActionProposalAuditTrail(proposalId: string | undefined) {
  return useQuery({
    queryKey: ['bobActionProposalAuditTrail', proposalId],
    queryFn: async () => {
      if (!proposalId) return []
      const { data, error } = await sb
        .from('bob_action_proposal_events')
        .select('*')
        .eq('proposal_id', proposalId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return (data ?? []) as BobActionProposalEventRow[]
    },
    enabled: !!proposalId,
  })
}

export function useBobActionProposalCaseTimeline(caseId: string | undefined) {
  return useQuery({
    queryKey: ['bobActionProposalCaseTimeline', caseId],
    queryFn: async () => {
      if (!caseId) return { proposals: [], events: [] }

      const [proposalsResult, eventsResult] = await Promise.all([
        sb
          .from('bob_action_proposals')
          .select('*')
          .eq('case_id', caseId)
          .order('proposed_at', { ascending: true }),
        sb
          .from('bob_action_proposal_events')
          .select('*')
          .eq('case_id', caseId)
          .order('created_at', { ascending: true }),
      ])

      if (proposalsResult.error) throw proposalsResult.error
      if (eventsResult.error) throw eventsResult.error

      return {
        proposals: (proposalsResult.data ?? []) as BobActionProposalRow[],
        events: (eventsResult.data ?? []) as BobActionProposalEventRow[],
      }
    },
    enabled: !!caseId,
  })
}
