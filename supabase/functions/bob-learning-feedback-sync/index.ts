// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

type LearningEvent = {
  pipeline: string
  confidence?: number | null
  was_correct?: boolean | null
  similarity?: number
  actual_same_vehicle?: boolean
  note?: string
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeConfidenceFromScore(score: unknown): number | null {
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  if (n <= 1) return clamp(n, 0, 1)
  return clamp(n / 100, 0, 1)
}

function severityToConfidence(value: unknown): number | null {
  const v = String(value || '').toLowerCase().trim()
  if (!v) return null
  if (v === 'critical') return 0.95
  if (v === 'high') return 0.82
  if (v === 'medium') return 0.65
  if (v === 'low') return 0.45
  return null
}

async function fetchImportIntakeEvents(
  supabaseAdmin: ReturnType<typeof createClient>,
  sinceIso: string,
  limit: number,
): Promise<{ events: LearningEvent[]; errors: string[] }> {
  const events: LearningEvent[] = []
  const errors: string[] = []

  try {
    const { data, error } = await supabaseAdmin
      .from('ai_import_intakes')
      .select('id, organization_id, purpose, status, recommendation_score, action_summary, updated_at')
      .gte('updated_at', sinceIso)
      .in('status', ['imported', 'actioned', 'failed'])
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (error) {
      errors.push(`ai_import_intakes query failed: ${error.message}`)
      return { events, errors }
    }

    for (const row of data ?? []) {
      const status = String(row.status || '').toLowerCase()
      const wasCorrect = status === 'imported' || status === 'actioned'
      if (status === 'failed') {
        events.push({
          pipeline: 'import_intake',
          confidence: normalizeConfidenceFromScore(row.recommendation_score),
          was_correct: false,
          note: `intake ${row.id} failed (${String(row.action_summary || '').slice(0, 180)})`,
        })
        continue
      }

      events.push({
        pipeline: 'import_intake',
        confidence: normalizeConfidenceFromScore(row.recommendation_score),
        was_correct: wasCorrect,
        note: `intake ${row.id} ${status} for purpose ${String(row.purpose || 'unknown')}`,
      })
    }
  } catch (err: any) {
    errors.push(`ai_import_intakes exception: ${err?.message ?? String(err)}`)
  }

  return { events, errors }
}

async function fetchBreachOutcomeEvents(
  supabaseAdmin: ReturnType<typeof createClient>,
  sinceIso: string,
  limit: number,
): Promise<{ events: LearningEvent[]; errors: string[] }> {
  const events: LearningEvent[] = []
  const errors: string[] = []

  try {
    const { data, error } = await supabaseAdmin
      .from('breach_alerts')
      .select('id, status, breach_type, breach_details, resolved_at, updated_at')
      .gte('updated_at', sinceIso)
      .in('status', ['resolved', 'dismissed'])
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (error) {
      errors.push(`breach_alerts query failed: ${error.message}`)
      return { events, errors }
    }

    for (const row of data ?? []) {
      const status = String(row.status || '').toLowerCase()
      const wasCorrect = status === 'resolved'
      const confidence =
        severityToConfidence((row.breach_details as any)?.severity) ??
        severityToConfidence((row.breach_details as any)?.risk) ??
        null

      events.push({
        pipeline: 'breach_triage',
        confidence,
        was_correct: wasCorrect,
        note: `breach ${row.id} ${status} (${String(row.breach_type || 'unknown')})`,
      })
    }
  } catch (err: any) {
    errors.push(`breach_alerts exception: ${err?.message ?? String(err)}`)
  }

  return { events, errors }
}

async function fetchEnforcementOutcomeEvents(
  supabaseAdmin: ReturnType<typeof createClient>,
  sinceIso: string,
  limit: number,
): Promise<{ events: LearningEvent[]; errors: string[] }> {
  const events: LearningEvent[] = []
  const errors: string[] = []

  try {
    // Primary signal: explicitly completed actions.
    const { data: completedRows, error: completedErr } = await supabaseAdmin
      .from('enforcement_actions')
      .select('id, action_type, status, breach_status, completed_at, completion_outcome, completion_notes, updated_at')
      .gte('completed_at', sinceIso)
      .order('completed_at', { ascending: false })
      .limit(limit)

    if (completedErr) {
      errors.push(`enforcement_actions completed query failed: ${completedErr.message}`)
    } else {
      for (const row of completedRows ?? []) {
        const outcome = String(row.completion_outcome || '').toLowerCase()
        const status = String(row.status || '').toLowerCase()
        const breachStatus = String(row.breach_status || '').toLowerCase()

        const positiveOutcome =
          outcome.includes('complied') ||
          outcome.includes('resolved') ||
          outcome.includes('paid') ||
          outcome.includes('warning') ||
          breachStatus === 'completed' ||
          status === 'completed'

        const negativeOutcome =
          outcome.includes('cancel') ||
          outcome.includes('dismiss') ||
          outcome.includes('invalid') ||
          outcome.includes('error') ||
          outcome.includes('failed')

        const wasCorrect = negativeOutcome ? false : positiveOutcome ? true : null

        const confidence =
          positiveOutcome ? 0.78 :
          negativeOutcome ? 0.62 :
          0.55

        events.push({
          pipeline: 'enforcement_action',
          confidence,
          was_correct: wasCorrect,
          note: `enforcement ${row.id} ${status || 'unknown'} ${outcome || 'no_outcome'} (${String(row.action_type || 'unknown_action')})`,
        })
      }
    }

    // Secondary signal: actions moved to terminal statuses but with no completed_at set.
    const { data: terminalRows, error: terminalErr } = await supabaseAdmin
      .from('enforcement_actions')
      .select('id, action_type, status, breach_status, completion_outcome, completion_notes, updated_at, completed_at')
      .gte('updated_at', sinceIso)
      .is('completed_at', null)
      .in('status', ['resolved', 'closed', 'cancelled', 'dismissed'])
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (terminalErr) {
      errors.push(`enforcement_actions terminal query failed: ${terminalErr.message}`)
    } else {
      for (const row of terminalRows ?? []) {
        const status = String(row.status || '').toLowerCase()
        const wasCorrect = status === 'resolved' || status === 'closed'

        events.push({
          pipeline: 'enforcement_action',
          confidence: wasCorrect ? 0.7 : 0.58,
          was_correct: wasCorrect,
          note: `enforcement ${row.id} terminal status ${status} (${String(row.action_type || 'unknown_action')})`,
        })
      }
    }
  } catch (err: any) {
    errors.push(`enforcement_actions exception: ${err?.message ?? String(err)}`)
  }

  return { events, errors }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const syncKey = Deno.env.get('BOB_FEEDBACK_SYNC_KEY') ?? ''
    const inferenceUrl = (Deno.env.get('INFERENCE_SERVICE_URL') ?? '').replace(/\/+$/, '')
    const inferenceApiKey = Deno.env.get('INFERENCE_API_KEY') ?? ''

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Supabase service config missing' }), {
        status: 500,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

    if (!inferenceUrl) {
      return new Response(JSON.stringify({ error: 'INFERENCE_SERVICE_URL not configured' }), {
        status: 503,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // Auth path A: trusted sync key header (for scheduled automations).
    const requestSyncKey = req.headers.get('x-bob-sync-key') || ''
    let authMode = 'none'
    if (syncKey && requestSyncKey && requestSyncKey === syncKey) {
      authMode = 'sync_key'
    } else {
      // Auth path B: normal bearer user auth (manual admin trigger).
      const token = extractBearerToken(req)
      if (!token) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        })
      }

      const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token)
      if (userErr || !user) {
        return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
          status: 401,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        })
      }
      authMode = 'jwt_user'
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const sinceHoursRaw = Number((body as any)?.since_hours ?? 24)
    const sinceHours = Number.isFinite(sinceHoursRaw) ? clamp(Math.floor(sinceHoursRaw), 1, 168) : 24
    const perSourceLimitRaw = Number((body as any)?.per_source_limit ?? 200)
    const perSourceLimit = Number.isFinite(perSourceLimitRaw) ? clamp(Math.floor(perSourceLimitRaw), 1, 500) : 200
    const dryRun = Boolean((body as any)?.dry_run)
    const source = String((body as any)?.source || 'edge-feedback-sync').slice(0, 80)

    const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString()

    const [intakes, breaches, enforcement] = await Promise.all([
      fetchImportIntakeEvents(supabaseAdmin, sinceIso, perSourceLimit),
      fetchBreachOutcomeEvents(supabaseAdmin, sinceIso, perSourceLimit),
      fetchEnforcementOutcomeEvents(supabaseAdmin, sinceIso, perSourceLimit),
    ])

    const events = [...intakes.events, ...breaches.events, ...enforcement.events]
    const gatherErrors = [...intakes.errors, ...breaches.errors, ...enforcement.errors]

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        auth_mode: authMode,
        source,
        since_hours: sinceHours,
        events_collected: events.length,
        source_counts: {
          import_intakes: intakes.events.length,
          breach_alerts: breaches.events.length,
          enforcement_actions: enforcement.events.length,
        },
        event_samples: events.slice(0, 20),
        gather_errors: gatherErrors,
      }), {
        status: 200,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

    if (events.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        auth_mode: authMode,
        source,
        since_hours: sinceHours,
        events_collected: 0,
        source_counts: {
          import_intakes: intakes.events.length,
          breach_alerts: breaches.events.length,
          enforcement_actions: enforcement.events.length,
        },
        message: 'No fresh resolved outcomes in selected window',
        gather_errors: gatherErrors,
      }), {
        status: 200,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (inferenceApiKey) headers['x-inference-api-key'] = inferenceApiKey

    const ingestResp = await fetch(`${inferenceUrl}/learn/ingest-feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source,
        events,
      }),
      signal: AbortSignal.timeout(55_000),
    })

    const ingestText = await ingestResp.text()
    if (!ingestResp.ok) {
      return new Response(JSON.stringify({
        error: `Inference feedback ingest returned ${ingestResp.status}`,
        details: ingestText.slice(0, 500),
        events_collected: events.length,
        gather_errors: gatherErrors,
      }), {
        status: ingestResp.status,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

    let ingestJson: any = null
    try { ingestJson = JSON.parse(ingestText) } catch { ingestJson = { raw: ingestText.slice(0, 500) } }

    return new Response(JSON.stringify({
      success: true,
      auth_mode: authMode,
      source,
      since_hours: sinceHours,
      events_collected: events.length,
      source_counts: {
        import_intakes: intakes.events.length,
        breach_alerts: breaches.events.length,
        enforcement_actions: enforcement.events.length,
      },
      gather_errors: gatherErrors,
      inference_result: ingestJson,
    }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }
})
