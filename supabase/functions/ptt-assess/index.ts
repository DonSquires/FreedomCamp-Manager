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
 *   INFERENCE_SERVICE_URL   — Bob inference-service base URL (RunPod)
 *   BOB_SERVICE_URL         — alias for INFERENCE_SERVICE_URL (either works)
 *   BOB_INFERENCE_API_KEY   — API key for Bob
 */

import { withCors, getCorsHeaders, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const BOB_SERVICE_URL = Deno.env.get('BOB_SERVICE_URL') || Deno.env.get('INFERENCE_SERVICE_URL') || ''
const BOB_API_KEY     = Deno.env.get('BOB_INFERENCE_API_KEY') ?? ''

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

  if (!BOB_SERVICE_URL) {
    return errorResponse('Bob inference service is not configured (INFERENCE_SERVICE_URL missing)', req, 503)
  }

  const bobUrl = BOB_SERVICE_URL.replace(/\/+$/, '')

  let bobResp: Response
  try {
    bobResp = await fetch(`${bobUrl}/assess/ptt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BOB_API_KEY ? { 'x-inference-api-key': BOB_API_KEY } : {}),
      },
      body: JSON.stringify({ symptom: symptom.trim(), context: context ?? {} }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ptt-assess] Bob fetch error:', msg)
    return errorResponse(`Bob inference service unreachable: ${msg}`, req, 502)
  }

  if (!bobResp.ok) {
    const errText = await bobResp.text().catch(() => '')
    console.error(`[ptt-assess] Bob returned ${bobResp.status}:`, errText.slice(0, 300))
    return new Response(
      JSON.stringify({ error: 'Bob assessment failed', status: bobResp.status, detail: errText.slice(0, 300) }),
      { status: bobResp.status, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }

  let result: unknown
  try {
    result = await bobResp.json()
  } catch {
    const raw = await bobResp.text().catch(() => '')
    return new Response(
      JSON.stringify({ error: 'Bob returned invalid JSON', raw: raw.slice(0, 300) }),
      { status: 502, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }

  return jsonResponse(result, req, 200)
}))
