/**
 * synthesize-speech
 *
 * Proxies Bob speech synthesis requests to inference-service (/infer/speak).
 */

import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { fetchWithRetry } from '../_shared/fetchWithRetry.ts'

function normalizeBaseUrl(raw?: string | null): string {
  return String(raw ?? '').trim().replace(/\/+$/, '')
}

const BOB_SERVICE_URL = normalizeBaseUrl(Deno.env.get('BOB_SERVICE_URL') || Deno.env.get('INFERENCE_SERVICE_URL') || '')
const BOB_API_KEY =
  Deno.env.get('BOB_INFERENCE_API_KEY') ??
  Deno.env.get('INFERENCE_API_KEY') ??
  Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ??
  Deno.env.get('RUNPOD_API_KEY') ??
  ''

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return errorResponse(authResult.error ?? 'Unauthorized', req, 401)
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  if (!BOB_SERVICE_URL) {
    return errorResponse('BOB_SERVICE_URL or INFERENCE_SERVICE_URL is not configured', req, 503)
  }

  const body = await req.json().catch(() => ({})) as {
    text?: string
    voice?: string
    rate?: number
    pitch?: number
    style?: 'default' | 'bridge_lead' | 'wise_mentor'
    format?: 'wav'
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return errorResponse('text is required', req, 400)
  }

  try {
    const inferResp = await fetchWithRetry(`${BOB_SERVICE_URL}/infer/speak`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BOB_API_KEY
          ? {
              Authorization: `Bearer ${BOB_API_KEY}`,
              'x-inference-api-key': BOB_API_KEY,
            }
          : {}),
      },
      body: JSON.stringify({
        text,
        voice: typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : undefined,
        rate: typeof body.rate === 'number' ? body.rate : undefined,
        pitch: typeof body.pitch === 'number' ? body.pitch : undefined,
        style: typeof body.style === 'string' ? body.style : undefined,
        format: body.format === 'wav' ? 'wav' : 'wav',
      }),
    }, {
      retries: 1,
      timeoutMs: 22_000,
      backoffMs: 500,
    })

    if (!inferResp.ok) {
      const errText = await inferResp.text().catch(() => '')
      console.error('synthesize-speech: inference error', inferResp.status, errText.slice(0, 220))
      return errorResponse(`Speech synthesis failed (${inferResp.status})`, req, 502)
    }

    const payload = await inferResp.json().catch(() => ({}))
    return jsonResponse(payload, req)
  } catch (err: any) {
    console.error('synthesize-speech: inference fetch exception', err?.message || String(err))
    return errorResponse(err?.message || 'Speech synthesis unavailable', req, 502)
  }
}))
