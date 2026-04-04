import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

type Severity = 'low' | 'medium' | 'high' | 'critical'
type Complexity = 'simple' | 'moderate' | 'complex'

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const token = extractBearerToken(req)
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const body = await req.json()
    const summary = String(body?.summary ?? '').trim()
    const details = String(body?.details ?? '').trim()
    const stackTrace = String(body?.stack_trace ?? '').trim()
    const severity = (body?.severity ?? 'medium') as Severity
    const complexity = (body?.complexity ?? 'moderate') as Complexity
    const targetPaths = Array.isArray(body?.target_paths)
      ? body.target_paths.map((p: unknown) => String(p)).filter(Boolean)
      : []

    if (!summary) {
      return new Response(
        JSON.stringify({ error: 'summary is required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const inferenceUrl = (Deno.env.get('INFERENCE_SERVICE_URL') ?? '').replace(/\/$/, '')
    const inferenceApiKey = Deno.env.get('INFERENCE_API_KEY') ?? ''

    if (!inferenceUrl) {
      return new Response(
        JSON.stringify({ error: 'INFERENCE_SERVICE_URL is not configured' }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    const preferGithubAssist = complexity === 'complex'

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (inferenceApiKey) headers['x-inference-api-key'] = inferenceApiKey

    const reportPayload = {
      summary,
      severity,
      details: details || undefined,
      stack_trace: stackTrace || undefined,
      target_paths: targetPaths.length ? targetPaths : undefined,
      source: 'bob-assistant-studio',
      requested_by: user.email ?? user.id,
      requested_at: new Date().toISOString(),
      execution_mode_hint: preferGithubAssist ? 'github_assist' : 'self_heal_worker',
    }

    const response = await fetch(`${inferenceUrl}/self-heal/patch-task`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ report: reportPayload }),
    })

    const text = await response.text()
    const payload = (() => {
      try { return JSON.parse(text) } catch { return null }
    })()

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: `Patch-task endpoint returned ${response.status}`,
          details: text.slice(0, 500),
        }),
        { status: response.status, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        execution_mode: preferGithubAssist ? 'github_assist' : 'self_heal_worker',
        github_assist_required: preferGithubAssist,
        patch_task: payload,
        note: preferGithubAssist
          ? 'Complex issue detected: route this task to GitHub-assisted flow.'
          : 'Task is suitable for self-healing worker flow.',
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    )
  }
})
