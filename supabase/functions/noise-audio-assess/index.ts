/**
 * noise-audio-assess
 *
 * Runs Bob's field-audio noise assessment and returns matrix-prefill values
 * for the Noise Officer portal form.
 */

import { getCorsHeaders, withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const BOB_SERVICE_URL = Deno.env.get('BOB_SERVICE_URL') ?? ''
const BOB_API_KEY = Deno.env.get('BOB_INFERENCE_API_KEY') ?? ''

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return new Response(
      JSON.stringify({ error: authResult.error ?? 'Unauthorized' }),
      { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    )
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  if (!BOB_SERVICE_URL) {
    return errorResponse('BOB_SERVICE_URL is not configured', req, 503)
  }

  const body = await req.json().catch(() => ({}))

  const payload = {
    transcript: body?.transcript ?? '',
    observed_db: body?.observed_db ?? null,
    time_category: body?.time_category ?? 'night',
    location_context: body?.location_context ?? '',
    complaint_address: body?.complaint_address ?? '',
    audio_base64: body?.audio_base64 ?? '',
    audio_mime_type: body?.audio_mime_type ?? 'audio/wav',
    matrix: body?.matrix && typeof body.matrix === 'object' ? body.matrix : {},
  }

  try {
    const inferResp = await fetch(`${BOB_SERVICE_URL}/infer/noise-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOB_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    })

    if (!inferResp.ok) {
      const errText = await inferResp.text().catch(() => '')
      console.error('noise-audio-assess inference error:', inferResp.status, errText.slice(0, 200))
      return errorResponse(`Bob noise assessment failed (${inferResp.status})`, req, 502)
    }

    const result = await inferResp.json().catch(() => ({}))
    return jsonResponse(result, req)
  } catch (err: any) {
    console.error('noise-audio-assess fetch error:', err?.message || String(err))
    return errorResponse(err?.message || 'Noise audio assessment unavailable', req, 502)
  }
}))
