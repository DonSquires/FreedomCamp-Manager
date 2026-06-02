import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { validateNoticeIssuancePayload } from '@/lib/noticeWorkflow'

// ─── Shared types ─────────────────────────────────────────────────────────────

export type NoiseJob = {
  id: string
  job_number: string
  title: string
  address: string
  suburb: string
  city: string
  noise_type: string
  priority: string
  status: string
  assigned_to: string | null
  has_prior_end: boolean
  has_permanent_end: boolean
  has_hs_incident: boolean
  has_prior_abatement: boolean
  prior_notice_count: number
  safety_notes: string | null
  created_at: string
  completed_at: string | null
}

export type NoiseNotice = {
  id: string
  notice_number: string
  notice_type: string
  recipient_name: string
  recipient_address: string
  offence_description: string
  issued_at: string
  comply_by: string | null
  status: string
  penalty_amount_nzd: number | null
  daily_penalty_nzd: number | null
  is_permanent_end: boolean
  previous_notice_count: number
  issuing_officer_name: string | null
}

export type NoiseSeizure = {
  id: string
  seizure_number: string
  address: string
  seized_at: string
  equipment_description: string
  equipment_count: number
  estimated_value_nzd: number | null
  status: string
  storage_location: string | null
  seizing_officer_name: string | null
}

export type NoiseOfficer = {
  id: string
  full_name?: string
  first_name: string | null
  last_name: string | null
  email: string
}

// ─── Read hooks ───────────────────────────────────────────────────────────────

export function useNoiseJobs(orgId: string | undefined, filterStatus: string, filterPriority: string) {
  return useQuery({
    queryKey: ['noise_jobs', orgId, filterStatus, filterPriority],
    queryFn: async () => {
      if (!orgId) return []
      let q = supabase
        .from('noise_jobs')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (filterStatus !== 'all')   q = q.eq('status', filterStatus)
      if (filterPriority !== 'all') q = q.eq('priority', filterPriority)
      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as NoiseJob[]
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  })
}

export function useNoiseNotices(orgId: string | undefined) {
  return useQuery({
    queryKey: ['noise_notices', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await supabase
        .from('noise_notices')
        .select('*')
        .eq('organization_id', orgId)
        .order('issued_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data || []) as unknown as NoiseNotice[]
    },
    enabled: !!orgId,
  })
}

export function useNoiseSeizures(orgId: string | undefined) {
  return useQuery({
    queryKey: ['noise_seizures', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await supabase
        .from('noise_seizures')
        .select('*')
        .eq('organization_id', orgId)
        .order('seized_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data || []) as unknown as NoiseSeizure[]
    },
    enabled: !!orgId,
  })
}

export function useNoiseOfficers(orgId: string | undefined) {
  return useQuery({
    queryKey: ['officers', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, email, first_name, last_name')
        .eq('organization_id', orgId)
        .in('role', ['officer', 'admin_officer'])
        .order('first_name')
      if (error) throw error
      return (data || []) as unknown as NoiseOfficer[]
    },
    enabled: !!orgId,
  })
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

type NewJobForm = {
  title: string
  address: string
  suburb: string
  city: string
  noise_type: string
  priority: string
  complaint_source: string
  complaint_description: string
  assigned_to: string
  has_hs_incident: boolean
  safety_notes: string
  prior_notice_summary: string
}

export function useCreateNoiseJob(orgId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (newJob: NewJobForm) => {
      if (!orgId || !userId) throw new Error('Not authenticated')
      const addr = newJob.address.trim().toLowerCase()
      const { data: priorNotices } = await supabase
        .from('noise_notices')
        .select('notice_type, is_permanent_end, recipient_address')
        .eq('organization_id', orgId)
        .ilike('recipient_address', `%${addr}%`)
      const priorCount = priorNotices?.length || 0
      const hasPriorEnd = (priorNotices || []).some((n: any) => n.notice_type === 'enforcement_notice')
      const hasPermanentEnd = (priorNotices || []).some((n: any) => n.is_permanent_end)
      const hasPriorAN = (priorNotices || []).some((n: any) => n.notice_type === 'abatement_notice')
      const { data: counterRow } = await supabase
        .from('noise_job_counters')
        .select('last_number')
        .eq('organization_id', orgId)
        .maybeSingle()
      const nextNum = ((counterRow as any)?.last_number || 0) + 1
      const jobNumber = `NCJ-${new Date().getFullYear()}-${String(nextNum).padStart(6, '0')}`
      await supabase
        .from('noise_job_counters')
        .upsert({ organization_id: orgId, last_number: nextNum }, { onConflict: 'organization_id' })
      const { error } = await supabase
        .from('noise_jobs')
        .insert({
          organization_id: orgId,
          job_number: jobNumber,
          title: newJob.title,
          address: newJob.address,
          suburb: newJob.suburb || null,
          city: newJob.city || null,
          noise_type: newJob.noise_type,
          priority: newJob.priority,
          complaint_source: newJob.complaint_source,
          complaint_description: newJob.complaint_description || null,
          assigned_to: newJob.assigned_to || null,
          assigned_at: newJob.assigned_to ? new Date().toISOString() : null,
          dispatched_by: userId,
          has_prior_end: hasPriorEnd,
          has_permanent_end: hasPermanentEnd,
          has_hs_incident: newJob.has_hs_incident,
          has_prior_abatement: hasPriorAN,
          prior_notice_count: priorCount,
          prior_notice_summary: newJob.prior_notice_summary || null,
          safety_notes: newJob.safety_notes || null,
          status: newJob.assigned_to ? 'assigned' : 'pending',
        })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['noise_jobs', orgId] })
    },
  })
}

type NewNoticeForm = {
  noise_job_id: string
  notice_type: string
  recipient_name: string
  recipient_address: string
  offence_description: string
  rma_section: string
  penalty_amount_nzd: string
  daily_penalty_nzd: string
  notes: string
}

export function useCreateNoiseNotice(
  orgId: string | undefined,
  userId: string | undefined,
  userFullName: string | null | undefined,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (newNotice: NewNoticeForm) => {
      if (!orgId || !userId) throw new Error('Not authenticated')
      const issuanceValidation = validateNoticeIssuancePayload({
        noticeClass: 'noise',
        legalBasis: newNotice.rma_section || 'Resource Management Act 1991',
        issuerId: userId,
        issuerRole: 'officer',
        policyReference: 'noise.notice.default',
        evidenceRefs: [newNotice.noise_job_id].filter((value): value is string => Boolean(value)),
        serviceProof: {
          method: 'hand',
          servedAt: new Date().toISOString(),
          servedBy: userId,
          recipientName: newNotice.recipient_name,
          recipientAddress: newNotice.recipient_address,
        },
      })
      if (!issuanceValidation.ok) throw new Error(issuanceValidation.errors[0] || 'Missing notice issuance data')
      const { data: counterRow } = await supabase
        .from('noise_notice_counters')
        .select('last_number')
        .eq('organization_id', orgId)
        .maybeSingle()
      const nextNum = ((counterRow as any)?.last_number || 0) + 1
      const noticeNumber = `NCN-${new Date().getFullYear()}-${String(nextNum).padStart(6, '0')}`
      await supabase
        .from('noise_notice_counters')
        .upsert({ organization_id: orgId, last_number: nextNum }, { onConflict: 'organization_id' })
      const isEnd = newNotice.notice_type === 'enforcement_notice'
      const { error } = await supabase
        .from('noise_notices')
        .insert({
          organization_id: orgId,
          notice_number: noticeNumber,
          noise_job_id: newNotice.noise_job_id || null,
          notice_type: newNotice.notice_type,
          recipient_name: newNotice.recipient_name,
          recipient_address: newNotice.recipient_address,
          offence_description: newNotice.offence_description,
          rma_section: newNotice.rma_section || null,
          penalty_amount_nzd: isEnd && newNotice.penalty_amount_nzd ? parseFloat(newNotice.penalty_amount_nzd) : null,
          daily_penalty_nzd: isEnd && newNotice.daily_penalty_nzd ? parseFloat(newNotice.daily_penalty_nzd) : null,
          issuing_officer_id: userId,
          issuing_officer_name: userFullName || null,
          notes: newNotice.notes || null,
          status: 'issued',
        })
      if (error) throw error
      if (newNotice.noise_job_id && isEnd) {
        await supabase
          .from('noise_jobs')
          .update({ has_prior_end: true })
          .eq('id', newNotice.noise_job_id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['noise_notices', orgId] })
    },
  })
}

export function useUpdateNoiseJobStatus(orgId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('noise_jobs')
        .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['noise_jobs', orgId] })
    },
  })
}
