import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface UseDispatchClientSitesLookupOptions {
  orgId?: string | null
  clientOrgIds: string[] | null
  clientOrgIdsLoading: boolean
}

interface UseDispatchZonesLookupOptions {
  orgId?: string | null
}

interface DispatchOfficerNotificationInput {
  officerId: string
  organizationId?: string | null
  jobId: string
  jobNumber?: string
  jobTitle?: string
  jobAddress?: string | null
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

interface AssignAndDispatchJobInput {
  jobId: string
  officerId: string
  dispatchedBy?: string
  dispatchedAt?: string
}

interface CancelDispatchJobInput {
  jobId: string
  cancelledAt?: string
}

export function useDispatchClientSitesLookup({
  orgId,
  clientOrgIds,
  clientOrgIdsLoading,
}: UseDispatchClientSitesLookupOptions) {
  return useQuery({
    queryKey: ['client-sites-lookup', orgId, clientOrgIds],
    queryFn: async () => {
      let q = (supabase as any)
        .from('client_sites')
        .select('id, name, address')
        .eq('is_active', true)

      if (clientOrgIds !== null) q = q.in('organization_id', clientOrgIds)
      const { data } = await q
      return data ?? []
    },
    enabled: !!orgId && !clientOrgIdsLoading,
  })
}

export function useDispatchZonesLookup({ orgId }: UseDispatchZonesLookupOptions) {
  return useQuery({
    queryKey: ['dispatch-zones-lookup', orgId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('zones')
        .select('id, name')
        .eq('organization_id', orgId ?? '')
        .eq('is_active', true)
        .order('name')
      return data ?? []
    },
    enabled: !!orgId,
  })
}

export async function insertDispatchOfficerNotification({
  officerId,
  organizationId,
  jobId,
  jobNumber,
  jobTitle,
  jobAddress,
  priority,
}: DispatchOfficerNotificationInput) {
  const { error } = await supabase.from('notifications').insert({
    user_id: officerId,
    organization_id: organizationId,
    type: 'investigation_assigned',
    title: `Job Dispatched: ${jobNumber}`,
    body: `${jobTitle}${jobAddress ? ' – ' + jobAddress : ''}`,
    priority: priority ?? 'normal',
    data: { dispatch_job_id: jobId, job_number: jobNumber },
  })

  return {
    ok: !error,
    error,
  }
}

export async function assignAndDispatchJob({
  jobId,
  officerId,
  dispatchedBy,
  dispatchedAt,
}: AssignAndDispatchJobInput) {
  const { error } = await (supabase as any)
    .from('dispatch_jobs')
    .update({
      assigned_to: officerId,
      dispatched_by: dispatchedBy,
      status: 'dispatched',
      dispatched_at: dispatchedAt ?? new Date().toISOString(),
    })
    .eq('id', jobId)

  return {
    ok: !error,
    error,
  }
}

export async function cancelDispatchJob({
  jobId,
  cancelledAt,
}: CancelDispatchJobInput) {
  const { error } = await (supabase as any)
    .from('dispatch_jobs')
    .update({
      status: 'cancelled',
      cancelled_at: cancelledAt ?? new Date().toISOString(),
    })
    .eq('id', jobId)

  return {
    ok: !error,
    error,
  }
}
