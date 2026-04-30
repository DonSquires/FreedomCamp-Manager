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
    // Detect RunPod serverless URL (api.runpod.ai/v2/{endpoint_id}) and use
    // the /runsync action-based protocol instead of direct /infer/* HTTP paths.
    const isRunpod = BOB_SERVICE_URL.includes('api.runpod.ai/v2') ||
      BOB_SERVICE_URL.includes('runpod.io')

    let inferResp: Response
    if (isRunpod) {
      const runpodBase = BOB_SERVICE_URL.replace(/\/(runsync|run|status.*)$/i, '')
      inferResp = await fetchWithRetry(`${runpodBase}/runsync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(BOB_API_KEY ? { Authorization: `Bearer ${BOB_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          input: {
            action: 'speak',
            text,
            style: typeof body.style === 'string' ? body.style : undefined,
            voice_profile: {
              rate: typeof body.rate === 'number' ? body.rate : undefined,
              pitch: typeof body.pitch === 'number' ? body.pitch : undefined,
              voice_name: typeof body.voice === 'string' ? body.voice : undefined,
              lang: 'en-NZ',
            },
          },
        }),
      }, { retries: 1, timeoutMs: 28_000, backoffMs: 500 })
    } else {
      inferResp = await fetchWithRetry(`${BOB_SERVICE_URL}/infer/speak`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(BOB_API_KEY
            ? { Authorization: `Bearer ${BOB_API_KEY}`, 'x-inference-api-key': BOB_API_KEY }
            : {}),
        },
        body: JSON.stringify({
          text,
          voice: typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : undefined,
          rate: typeof body.rate === 'number' ? body.rate : undefined,
          pitch: typeof body.pitch === 'number' ? body.pitch : undefined,
          style: typeof body.style === 'string' ? body.style : undefined,
          format: 'wav',
        }),
      }, { retries: 1, timeoutMs: 22_000, backoffMs: 500 })
    }

    if (!inferResp.ok) {
      const errText = await inferResp.text().catch(() => '')
      console.error('synthesize-speech: inference error', inferResp.status, errText.slice(0, 220))
      return errorResponse(`Speech synthesis failed (${inferResp.status})`, req, 502)
    }

    const rawPayload = await inferResp.json().catch(() => ({})) as Record<string, unknown>

    // RunPod wraps results in { output: { ... } }
    const payload = (rawPayload.output && typeof rawPayload.output === 'object')
      ? rawPayload.output as Record<string, unknown>
      : rawPayload

    const payloadSuccess = payload.success
    if (payloadSuccess === false) {
      // When RunPod worker does not support `speak` yet, fail gracefully with
      // a browser synthesis directive so Bob still has a functional mouth.
      return jsonResponse({
        spoken_text: text,
        voice_params: {
          rate: typeof body.rate === 'number' ? body.rate : 160,
          pitch: typeof body.pitch === 'number' ? body.pitch : 1.0,
          voice_name: typeof body.voice === 'string' ? body.voice : 'default',
          lang: 'en-NZ',
          volume: 1.0,
        },
        style: typeof body.style === 'string' ? body.style : 'default',
        provider: 'browser_fallback',
        client_action: 'web_speech_synthesis',
      }, req)
    }

    return jsonResponse(payload, req)
  } catch (err: any) {
    console.error('synthesize-speech: inference fetch exception', err?.message || String(err))
    return errorResponse(err?.message || 'Speech synthesis unavailable', req, 502)
  }
}))
