import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, errorResponse, jsonResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

type IncomingPayload = {
  target_user_id?: string
  org_id?: string
  session_id?: string
  limit?: number
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^[a-f0-9-]{36}$/i.test(trimmed) ? trimmed : null
}

function isServiceRoleRequest(req: Request): boolean {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim() || ''
  const serviceRole = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
  return Boolean(serviceRole) && Boolean(token) && token === serviceRole
}

async function loadFallbackSummary(
  serviceClient: ReturnType<typeof createClient>,
  organizationId: string,
  targetUserId: string | null,
  sessionId: string,
  limit: number,
) {
  let query = (serviceClient as any)
    .from('bug_reports')
    .select('id, title, description, current_page, console_errors, screenshot_metadata, updated_at, created_at, user_id')
    .eq('organization_id', organizationId)
    .ilike('title', 'Live session diagnostics%')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (targetUserId) {
    query = query.eq('user_id', targetUserId)
  }

  if (sessionId) {
    query = query.eq('title', `Live session diagnostics ${sessionId}`)
  }

  const { data, error } = await query
  if (error) return { data: null, error }

  const events = (data || []).flatMap((row: any) => {
    const rowSessionId = row?.screenshot_metadata?.live_session_diagnostics?.session_id || null
    const rowTs = row.updated_at || row.created_at
    const nestedEvents = Array.isArray(
      row?.screenshot_metadata?.live_session_diagnostics?.recent_events
    ) ? row.screenshot_metadata.live_session_diagnostics.recent_events : []

    // Unpack the real per-event records stored during ingest so event types are preserved
    if (nestedEvents.length > 0) {
      return nestedEvents.map((e: any) => ({
        id: row.id,
        session_id: rowSessionId,
        event_type: String(e?.event_type || 'unknown'),
        route_path: e?.route_path || row.current_page || null,
        title: e?.title || null,
        details: e?.details || {},
        created_at: e?.occurred_at || rowTs,
        user_id: row.user_id,
      }))
    }

    return [{
      id: row.id,
      session_id: rowSessionId,
      event_type: 'fallback_session_snapshot',
      route_path: row.current_page || null,
      title: row.title,
      details: {
        description: row.description,
        console_errors: row.console_errors,
        snapshot: row?.screenshot_metadata?.live_session_diagnostics || row.screenshot_metadata,
      },
      created_at: rowTs,
      user_id: row.user_id,
    }]
  })

  const counts: Record<string, number> = {}
  for (const ev of events) {
    counts[ev.event_type] = (counts[ev.event_type] || 0) + 1
  }

  return {
    data: {
      ok: true,
      target_user_id: targetUserId,
      session_id: sessionId || null,
      counts,
      latest_route: events[0]?.route_path || null,
      events,
      fallback: 'bug_reports',
    },
    error: null,
  }
}

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  const serviceRoleMode = isServiceRoleRequest(req)
  let authUserId: string | null = null

  if (!serviceRoleMode) {
    const authResult = await requireAuth(req)
    if (!authResult.user) {
      return errorResponse(authResult.error ?? 'Unauthorized', req, 401)
    }
    authUserId = authResult.user.id
  }

  let body: IncomingPayload = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  let organizationId: string | null = null
  let targetUserId: string | null = normalizeUuid(body.target_user_id)
  let canReadOthers = false

  if (serviceRoleMode) {
    organizationId = normalizeUuid(body.org_id)
      || normalizeUuid(Deno.env.get('BOB_ORG_ID'))
      || normalizeUuid(Deno.env.get('ORG_ID'))
      || normalizeUuid(Deno.env.get('DEFAULT_ORG_ID'))

    if (!organizationId) {
      return errorResponse('org_id is required for service-role diagnostics summary', req, 400)
    }
    canReadOthers = true
  } else {
    const { data: callerProfile, error: profileError } = await serviceClient
      .from('user_profiles')
      .select('id, organization_id, role')
      .eq('id', authUserId)
      .maybeSingle()

    if (profileError) {
      return errorResponse('Failed to resolve caller profile', req, 500, profileError.message)
    }

    if (!callerProfile?.organization_id) {
      return errorResponse('User organization not found', req, 403)
    }

    organizationId = callerProfile.organization_id
    const fallbackUserId = authUserId || ''
    targetUserId = targetUserId ?? fallbackUserId
    canReadOthers = ['admin', 'admin_officer', 'master', 'grand_master'].includes(String(callerProfile.role || ''))

    if (targetUserId !== fallbackUserId && !canReadOthers) {
      return errorResponse('Not authorized to read another user diagnostics', req, 403)
    }
  }

  let query = (serviceClient as any)
    .from('live_session_diagnostic_events')
    .select('id, session_id, event_type, route_path, title, details, created_at, user_id')
    .eq('org_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(body.limit || 120), 1), 300))

  if (targetUserId) {
    query = query.eq('user_id', targetUserId)
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  if (sessionId) {
    query = query.eq('session_id', sessionId)
  }

  const { data, error } = await query
  if (error) {
    const relationMissing = error.message?.toLowerCase().includes('live_session_diagnostic_events')
      && error.message?.toLowerCase().includes('does not exist')
      || error.message?.toLowerCase().includes('could not find the table')
      || error.message?.toLowerCase().includes('schema cache')
      || error.message?.toLowerCase().includes('pgrst205')

    if (!relationMissing) {
      return errorResponse('Failed to fetch diagnostics summary', req, 500, error.message)
    }

    const fallback = await loadFallbackSummary(
      serviceClient,
      organizationId,
      targetUserId,
      sessionId,
      Math.min(Math.max(Number(body.limit || 120), 1), 300),
    )

    if (fallback.error) {
      return errorResponse('Failed to fetch diagnostics fallback summary', req, 500, fallback.error.message)
    }

    return jsonResponse(fallback.data, req, 200)
  }

  const counts: Record<string, number> = {}
  for (const row of data || []) {
    counts[row.event_type] = (counts[row.event_type] || 0) + 1
  }

  return jsonResponse({
    ok: true,
    target_user_id: targetUserId,
    session_id: sessionId || null,
    counts,
    latest_route: data?.[0]?.route_path || null,
    events: data || [],
  }, req, 200)
}))