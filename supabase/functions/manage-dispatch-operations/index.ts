import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

type DispatchAction = 'create_dispatch_job' | 'assign_dispatch_job' | 'cancel_dispatch_job' | 'update_dispatch_job_status'

interface DispatchRequest {
  action: DispatchAction
  jobId?: string
  payload?: Record<string, unknown>
}

const ADMIN_ROLES = new Set(['admin', 'admin_officer', 'master', 'grand_master'])
const STATUS_UPDATE_ROLES = new Set(['admin', 'admin_officer', 'master', 'grand_master', 'officer'])
const GLOBAL_ROLES = new Set(['master', 'grand_master'])

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isDispatchAlarmTypeMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = error?.message || ''
  const isUndefinedColumn = error?.code === '42703' && message.includes('dispatch_jobs.alarm_type')
  const isSchemaCache =
    (error?.code === 'PGRST204' || message.toLowerCase().includes('schema cache')) &&
    message.includes("'alarm_type' column of 'dispatch_jobs'")

  return isUndefinedColumn || isSchemaCache
}

function canManageTargetOrg(callerRole: string, callerOrgId: string | null, targetOrgId: string | null): boolean {
  if (GLOBAL_ROLES.has(callerRole)) return true
  if (!callerOrgId || !targetOrgId) return false
  return callerOrgId === targetOrgId
}

function sanitizeCreatePayload(raw: Record<string, unknown>, userId: string): Record<string, unknown> {
  const allowed = [
    'organization_id', 'job_type', 'alarm_type', 'priority', 'title', 'description',
    'address', 'gps_lat', 'gps_lng', 'caller_name', 'caller_phone', 'client_site_id',
    'zone_id', 'response_sla_minutes',
  ]

  const payload: Record<string, unknown> = {
    created_by: userId,
    status: 'pending',
  }

  for (const key of allowed) {
    if (raw[key] !== undefined) payload[key] = raw[key]
  }

  return payload
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as DispatchRequest
    if (!body.action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: caller } = await adminClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single()

    if (!caller) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const actionAllowsStatusUpdateRole = body.action === 'update_dispatch_job_status'
    const roleAllowed = actionAllowsStatusUpdateRole
      ? STATUS_UPDATE_ROLES.has(caller.role)
      : ADMIN_ROLES.has(caller.role)

    if (!roleAllowed) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'create_dispatch_job') {
      const payload = sanitizeCreatePayload(body.payload ?? {}, user.id)
      const organizationId = toText(payload.organization_id)
      const title = toText(payload.title)
      if (!organizationId || !title) {
        return new Response(JSON.stringify({ error: 'organization_id and title are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageTargetOrg(caller.role, caller.organization_id, organizationId)) {
        return new Response(JSON.stringify({ error: 'Cannot create dispatch jobs for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const initialInsert = await adminClient
        .from('dispatch_jobs')
        .insert(payload)
        .select('*')
        .single()

      let createdJob = initialInsert.data
      let createError = initialInsert.error

      if (isDispatchAlarmTypeMissing(createError)) {
        const { alarm_type: _alarmType, ...fallbackPayload } = payload
        const fallbackInsert = await adminClient
          .from('dispatch_jobs')
          .insert(fallbackPayload)
          .select('*')
          .single()
        createdJob = fallbackInsert.data
        createError = fallbackInsert.error
      }

      if (createError || !createdJob) {
        throw new Error(createError?.message ?? 'Failed to create dispatch job')
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: createdJob.organization_id,
        action: 'dispatch_job_created',
        entity_type: 'dispatch_job',
        entity_id: createdJob.id,
        performed_by: user.id,
        new_values: createdJob,
      })
      if (auditError) {
        throw new Error(`Dispatch job created but audit artifact failed: ${auditError.message}`)
      }

      return new Response(JSON.stringify({ ok: true, data: createdJob }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jobId = toText(body.jobId)
    if (!jobId) {
      return new Response(JSON.stringify({ error: 'jobId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: existingJob, error: existingJobError } = await adminClient
      .from('dispatch_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (existingJobError || !existingJob) {
      return new Response(JSON.stringify({ error: 'Dispatch job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!canManageTargetOrg(caller.role, caller.organization_id, existingJob.organization_id)) {
      return new Response(JSON.stringify({ error: 'Cannot manage dispatch jobs in another organization' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'assign_dispatch_job') {
      const officerId = toText(body.payload?.officer_id)
      const dispatchedAt = toText(body.payload?.dispatched_at) || new Date().toISOString()

      if (!officerId) {
        return new Response(JSON.stringify({ error: 'officer_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: updatedJob, error: updateError } = await adminClient
        .from('dispatch_jobs')
        .update({
          assigned_to: officerId,
          dispatched_by: user.id,
          status: 'dispatched',
          dispatched_at: dispatchedAt,
        })
        .eq('id', jobId)
        .select('*')
        .single()

      if (updateError || !updatedJob) {
        throw new Error(updateError?.message ?? 'Failed to assign dispatch job')
      }

      const { error: notificationError } = await adminClient.from('notifications').insert({
        user_id: officerId,
        organization_id: updatedJob.organization_id,
        type: 'investigation_assigned',
        title: `Job Dispatched: ${updatedJob.job_number ?? updatedJob.id}`,
        body: `${updatedJob.title ?? 'Dispatch job'}${updatedJob.address ? ` - ${updatedJob.address}` : ''}`,
        priority: updatedJob.priority ?? 'normal',
        data: {
          dispatch_job_id: updatedJob.id,
          job_number: updatedJob.job_number ?? null,
        },
      })

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: updatedJob.organization_id,
        action: 'dispatch_job_assigned',
        entity_type: 'dispatch_job',
        entity_id: updatedJob.id,
        performed_by: user.id,
        old_values: existingJob,
        new_values: updatedJob,
      })

      if (auditError) {
        throw new Error(`Dispatch job assigned but audit artifact failed: ${auditError.message}`)
      }

      return new Response(
        JSON.stringify({
          ok: true,
          data: updatedJob,
          notification: {
            sent: !notificationError,
            error: notificationError?.message ?? null,
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (body.action === 'cancel_dispatch_job') {
      const cancelledAt = toText(body.payload?.cancelled_at) || new Date().toISOString()

      const { data: updatedJob, error: updateError } = await adminClient
        .from('dispatch_jobs')
        .update({
          status: 'cancelled',
          cancelled_at: cancelledAt,
        })
        .eq('id', jobId)
        .select('*')
        .single()

      if (updateError || !updatedJob) {
        throw new Error(updateError?.message ?? 'Failed to cancel dispatch job')
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: updatedJob.organization_id,
        action: 'dispatch_job_cancelled',
        entity_type: 'dispatch_job',
        entity_id: updatedJob.id,
        performed_by: user.id,
        old_values: existingJob,
        new_values: updatedJob,
      })

      if (auditError) {
        throw new Error(`Dispatch job cancelled but audit artifact failed: ${auditError.message}`)
      }

      return new Response(JSON.stringify({ ok: true, data: updatedJob }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'update_dispatch_job_status') {
      const nextStatus = toText(body.payload?.status)
      const allowedStatuses = new Set(['acknowledged', 'en_route', 'on_scene'])
      if (!allowedStatuses.has(nextStatus)) {
        return new Response(JSON.stringify({ error: 'status must be acknowledged, en_route, or on_scene' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (caller.role === 'officer' && existingJob.assigned_to !== user.id) {
        return new Response(JSON.stringify({ error: 'Officers can only update their assigned jobs' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const validTransitions: Record<string, string> = {
        dispatched: 'acknowledged',
        acknowledged: 'en_route',
        en_route: 'on_scene',
      }
      const currentStatus = toText(existingJob.status)
      if (validTransitions[currentStatus] !== nextStatus) {
        return new Response(JSON.stringify({
          error: `Invalid transition from ${currentStatus || 'unknown'} to ${nextStatus}`,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const now = new Date().toISOString()
      const updatePayload: Record<string, unknown> = {
        status: nextStatus,
      }
      if (nextStatus === 'acknowledged') updatePayload.acknowledged_at = now
      if (nextStatus === 'en_route') updatePayload.en_route_at = now
      if (nextStatus === 'on_scene') updatePayload.on_scene_at = now

      const { data: updatedJob, error: updateError } = await adminClient
        .from('dispatch_jobs')
        .update(updatePayload)
        .eq('id', jobId)
        .select('*')
        .single()

      if (updateError || !updatedJob) {
        throw new Error(updateError?.message ?? 'Failed to update dispatch status')
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: updatedJob.organization_id,
        action: 'dispatch_job_status_updated',
        entity_type: 'dispatch_job',
        entity_id: updatedJob.id,
        performed_by: user.id,
        old_values: existingJob,
        new_values: updatedJob,
      })

      if (auditError) {
        throw new Error(`Dispatch status updated but audit artifact failed: ${auditError.message}`)
      }

      return new Response(JSON.stringify({ ok: true, data: updatedJob }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: `Unsupported action: ${body.action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
