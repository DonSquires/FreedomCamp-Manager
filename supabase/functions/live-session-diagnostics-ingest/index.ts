import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, errorResponse, jsonResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

type IncomingEvent = {
  event_type?: string
  route_path?: string | null
  title?: string | null
  details?: unknown
  occurred_at?: string
}

type IncomingPayload = {
  session_id?: string
  current_route?: string | null
  flush_reason?: string | null
  snapshot?: Record<string, unknown> | null
  events?: IncomingEvent[]
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

async function upsertFallbackDiagnosticReport(
  serviceClient: ReturnType<typeof createClient>,
  args: {
    sessionId: string
    userId: string
    organizationId: string
    currentRoute: string | null
    flushReason: string | null
    snapshot: Record<string, unknown>
    rows: Array<Record<string, unknown>>
  },
) {
  const title = `Live session diagnostics ${args.sessionId}`
  const latestRoute = args.currentRoute || String(args.snapshot.current_page || '').trim() || null
  const snapshotBrowserInfo = asObject(args.snapshot.browser_info)
  const snapshotConsoleErrors = Array.isArray(args.snapshot.console_errors) ? args.snapshot.console_errors : []
  const hasErrors = snapshotConsoleErrors.some(
    (e: unknown) => {
      if (!e || typeof e !== 'object') return false
      const level = (e as Record<string, unknown>).level
      return level === 'error' || level === 'unhandled'
    },
  )
  const metadata = {
    live_session_diagnostics: {
      session_id: args.sessionId,
      flush_reason: args.flushReason,
      current_route: latestRoute,
      updated_at: new Date().toISOString(),
      recent_events: args.rows.slice(-25),
      snapshot: args.snapshot,
    },
  }

  const description = `Passive live-session diagnostics snapshot for ${latestRoute || 'unknown route'}.
Event count in latest flush: ${args.rows.length}.`

  const { data: existing } = await (serviceClient as any)
    .from('bug_reports')
    .select('id')
    .eq('user_id', args.userId)
    .eq('title', title)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const payload = {
    organization_id: args.organizationId,
    user_id: args.userId,
    user_role: 'officer',
    issue_type: 'performance',
    severity: 'low',
    priority: 'normal',
    title,
    description,
    current_page: latestRoute,
    browser_info: snapshotBrowserInfo,
    console_errors: snapshotConsoleErrors,
    screenshot_metadata: metadata,
    network_status: typeof snapshotBrowserInfo.onLine === 'boolean'
      ? (snapshotBrowserInfo.onLine ? 'online' : 'offline')
      : null,
    app_version: String(args.snapshot.app_version || 'live-diagnostics'),
    // Only flag for investigation when the session actually captured errors.
    // Clean passive snapshots are stored as 'closed' to keep the inbox clear.
    status: hasErrors ? 'investigating' : 'closed',
    requires_human_review: hasErrors,
    admin_notified: false,
    user_notified: false,
    auto_reported: true,
  }

  if (existing?.id) {
    return await (serviceClient as any)
      .from('bug_reports')
      .update(payload)
      .eq('id', existing.id)
  }

  return await (serviceClient as any)
    .from('bug_reports')
    .insert(payload)
}

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return errorResponse(authResult.error ?? 'Unauthorized', req, 401)
  }

  let body: IncomingPayload
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body', req, 400)
  }

  const sessionId = normalizeString(body.session_id, 120)
  if (!sessionId) {
    return errorResponse('session_id is required', req, 400)
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: profile, error: profileError } = await serviceClient
    .from('user_profiles')
    .select('organization_id')
    .eq('id', authResult.user.id)
    .maybeSingle()

  if (profileError) {
    return errorResponse('Failed to resolve profile for diagnostics ingest', req, 500, profileError.message)
  }

  if (!profile?.organization_id) {
    return errorResponse('User organization not found', req, 403)
  }

  const rows = (Array.isArray(body.events) ? body.events : [])
    .slice(0, 100)
    .map((event) => ({
      org_id: profile.organization_id,
      user_id: authResult.user.id,
      session_id: sessionId,
      event_type: normalizeString(event?.event_type, 80) ?? 'unknown',
      route_path: normalizeString(event?.route_path, 300),
      title: normalizeString(event?.title, 160),
      details: asObject(event?.details),
      created_at: normalizeString(event?.occurred_at, 80) ?? new Date().toISOString(),
    }))

  if (body.snapshot) {
    rows.push({
      org_id: profile.organization_id,
      user_id: authResult.user.id,
      session_id: sessionId,
      event_type: 'session_snapshot',
      route_path: normalizeString(body.current_route, 300),
      title: null,
      details: {
        flush_reason: normalizeString(body.flush_reason, 80),
        snapshot: asObject(body.snapshot),
      },
      created_at: new Date().toISOString(),
    })
  }

  if (rows.length === 0) {
    return jsonResponse({ ok: true, inserted: 0 }, req, 200)
  }

  const { error: insertError } = await (serviceClient as any)
    .from('live_session_diagnostic_events')
    .insert(rows)

  if (insertError) {
    const insertErrorText = String(insertError.message || '').toLowerCase()
    const relationMissing =
      (insertErrorText.includes('live_session_diagnostic_events') && insertErrorText.includes('does not exist'))
      || insertErrorText.includes('could not find the table')
      || insertErrorText.includes('schema cache')
      || insertErrorText.includes('pgrst205')

    if (!relationMissing) {
      return errorResponse('Failed to insert live session diagnostics', req, 500, insertError.message)
    }

    const { error: fallbackError } = await upsertFallbackDiagnosticReport(serviceClient, {
      sessionId,
      userId: authResult.user.id,
      organizationId: profile.organization_id,
      currentRoute: normalizeString(body.current_route, 300),
      flushReason: normalizeString(body.flush_reason, 80),
      snapshot: asObject(body.snapshot),
      rows,
    })

    if (fallbackError) {
      return errorResponse('Failed to store live diagnostics fallback report', req, 500, fallbackError.message)
    }

    return jsonResponse({ ok: true, inserted: rows.length, fallback: 'bug_reports' }, req, 200)
  }

  return jsonResponse({ ok: true, inserted: rows.length }, req, 200)
}))