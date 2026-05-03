import { supabase } from '@/lib/supabase'

const DISPATCH_JOB_ALARM_TYPE_ERROR = 'dispatch_jobs.alarm_type'

export function isDispatchJobAlarmTypeMissing(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === '42703' && error.message?.includes(DISPATCH_JOB_ALARM_TYPE_ERROR)
}

export async function runDispatchJobsQueryWithAlarmTypeFallback<T>(
  buildQuery: (includeAlarmType: boolean) => Promise<{ data: T | null; error: { code?: string; message?: string } | null }>,
) {
  const initialResult = await buildQuery(true)
  if (!isDispatchJobAlarmTypeMissing(initialResult.error)) {
    return initialResult
  }

  return buildQuery(false)
}

export async function insertDispatchJobWithAlarmTypeFallback<T>(
  payload: Record<string, unknown>,
  selectClause: string,
) {
  const initialResult = await (supabase as any)
    .from('dispatch_jobs')
    .insert({
      ...payload,
      organization_id: (payload as any).organization_id ?? null,
    })
    .select(selectClause)
    .single()

  if (!isDispatchJobAlarmTypeMissing(initialResult.error)) {
    return initialResult as { data: T | null; error: { code?: string; message?: string } | null }
  }

  const { alarm_type: _alarmType, ...fallbackPayload } = payload
  return await (supabase as any)
    .from('dispatch_jobs')
    .insert({
      ...fallbackPayload,
      organization_id: (fallbackPayload as any).organization_id ?? null,
    })
    .select(selectClause)
    .single() as { data: T | null; error: { code?: string; message?: string } | null }
}