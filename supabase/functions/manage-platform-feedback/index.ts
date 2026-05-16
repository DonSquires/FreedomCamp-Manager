import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

type FeedbackAction = 'update_bug_report' | 'cleanup_old_closed_reports'

interface FeedbackRequest {
  action: FeedbackAction
  reportId?: string
  payload?: Record<string, unknown>
}

const ADMIN_ROLES = new Set(['admin', 'admin_officer', 'master', 'grand_master'])

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

    const { data: caller } = await adminClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single()

    if (!caller || !ADMIN_ROLES.has(caller.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as FeedbackRequest
    if (!body.action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'update_bug_report') {
      const reportId = toText(body.reportId)
      if (!reportId) {
        return new Response(JSON.stringify({ error: 'reportId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing, error: existingError } = await adminClient
        .from('bug_reports')
        .select('*')
        .eq('id', reportId)
        .single()

      if (existingError || !existing) {
        return new Response(JSON.stringify({ error: 'Bug report not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const payload = body.payload ?? {}
      const allowed = ['status', 'ai_analyzed', 'ai_suggested_fix', 'ai_analysis', 'requires_human_review']
      const updatePayload: Record<string, unknown> = {}
      for (const key of allowed) {
        if (payload[key] !== undefined) updatePayload[key] = payload[key]
      }

      if (Object.keys(updatePayload).length === 0) {
        return new Response(JSON.stringify({ error: 'No valid fields to update' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: updated, error: updateError } = await adminClient
        .from('bug_reports')
        .update(updatePayload)
        .eq('id', reportId)
        .select('*')
        .single()

      if (updateError || !updated) throw new Error(updateError?.message ?? 'Failed to update bug report')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: caller.organization_id,
        action: 'bug_report_updated',
        entity_type: 'bug_report',
        entity_id: reportId,
        performed_by: user.id,
        old_values: existing,
        new_values: updated,
      })
      if (auditError) throw new Error(`Bug report updated but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: updated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'cleanup_old_closed_reports') {
      const statusesRaw = Array.isArray(body.payload?.statuses) ? body.payload?.statuses : []
      const statuses = statusesRaw
        .map((value) => toText(value))
        .filter((value) => value.length > 0)
      const olderThanHoursRaw = Number(body.payload?.older_than_hours)
      const olderThanHours = Number.isFinite(olderThanHoursRaw) && olderThanHoursRaw > 0
        ? olderThanHoursRaw
        : 6

      if (statuses.length === 0) {
        return new Response(JSON.stringify({ error: 'payload.statuses is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString()

      const { data: toDelete, error: listError } = await adminClient
        .from('bug_reports')
        .select('*')
        .in('status', statuses)
        .lt('created_at', cutoff)

      if (listError) throw new Error(listError.message ?? 'Failed to list reports for cleanup')

      const ids = (toDelete ?? []).map((row: Record<string, unknown>) => toText(row.id)).filter((id) => id.length > 0)

      if (ids.length === 0) {
        return new Response(JSON.stringify({ ok: true, removed: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { error: deleteError, count } = await adminClient
        .from('bug_reports')
        .delete({ count: 'exact' })
        .in('id', ids)

      if (deleteError) throw new Error(deleteError.message ?? 'Failed to cleanup reports')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: caller.organization_id,
        action: 'bug_reports_cleaned_up',
        entity_type: 'bug_report',
        entity_id: 'bulk_cleanup',
        performed_by: user.id,
        old_values: { ids, count: ids.length, older_than_hours: olderThanHours, statuses },
        new_values: { removed: count ?? ids.length },
      })
      if (auditError) throw new Error(`Cleanup succeeded but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, removed: count ?? ids.length }), {
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
