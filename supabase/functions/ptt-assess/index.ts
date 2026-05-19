/**
 * ptt-assess
 *
 * Forwards a PTT symptom description to Bob's /assess/ptt endpoint and returns
 * a structured diagnosis with root cause, remediation steps, and urgency.
 *
 * POST body (JSON):
 *   {
 *     symptom:   string  — free-text description of the issue (required)
 *     context?:  object  — optional extra context (user_role, channel_scope, error_code, etc.)
 *   }
 *
 * Required Supabase secrets:
 *   BOB_SERVICE_URL         — Bob service base URL (RunPod)
 *   INFERENCE_SERVICE_URL   — optional fallback Bob URL
 *   BOB_INFERENCE_API_KEY   — API key for Bob
 */

import { withCors, getCorsHeaders, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { bobAssess } from '../_shared/bobInfer.ts'
import { buildBobContext } from '../_shared/bobContext.ts'

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return new Response(
      JSON.stringify({ error: authResult.error ?? 'Unauthorized' }),
      { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  let body: { symptom?: string; context?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body', req, 400)
  }

  const { symptom, context } = body

  if (!symptom || typeof symptom !== 'string' || !symptom.trim()) {
    return errorResponse('symptom is required', req, 400)
  }

  // BOB_COST_SAVER: skip inference entirely when flag is set
  const costSaverEnabled = ['1','true','yes','on'].includes(String(Deno.env.get('BOB_COST_SAVER') ?? '').trim().toLowerCase())
  if (costSaverEnabled) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'BOB_COST_SAVER enabled — PTT inference paused to reduce spend' }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }

  try {
    const result = await bobAssess({
      type: 'ptt',
      symptom: symptom.trim(),
      context: buildBobContext({
        operation: 'ptt-assess',
        source: 'ptt-diagnostic-assessment',
        userId: authResult.user.id,
        organizationId:
          (authResult.user as any)?.user_metadata?.organization_id ||
          (authResult.user as any)?.app_metadata?.organization_id ||
          null,
        context: context ?? {},
      }),
      timeoutMs: 90_000,
    })

    return jsonResponse(result.assessment ?? result, req, 200)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ptt-assess] Bob assess error:', msg)
    return errorResponse(`Bob inference service unreachable: ${msg}`, req, 502)
  }
}))
