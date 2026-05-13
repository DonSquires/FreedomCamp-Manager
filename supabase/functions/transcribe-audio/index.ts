/**
 * transcribe-audio
 *
 * Proxies audio transcription requests to Bob inference service (/infer/transcribe).
 * Accepts either a signed clip URL or inline base64 audio payload.
 */

import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { fetchWithRetry } from '../_shared/fetchWithRetry.ts'

function normalizeBaseUrl(raw?: string | null): string {
  return String(raw ?? '').trim().replace(/\/+$/, '')
}

const RUNPOD_ENDPOINT_ID = String(Deno.env.get('RUNPOD_ENDPOINT_ID') || '').trim()
const RUNPOD_DERIVED_URL = RUNPOD_ENDPOINT_ID ? `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}` : ''

const TRANSCRIPTION_SERVICE_URL = normalizeBaseUrl(
  Deno.env.get('RAILWAY_STT_URL') ||
  Deno.env.get('TRANSCRIPTION_SERVICE_URL') ||
  Deno.env.get('BOB_SERVICE_URL') ||
  Deno.env.get('INFERENCE_SERVICE_URL') ||
  Deno.env.get('RUNPOD_ENDPOINT_URL') ||
  Deno.env.get('INFERENCE_SERVICE_URL_RUNPOD') ||
  RUNPOD_DERIVED_URL ||
  '',
)
const TRANSCRIPTION_FALLBACK_SERVICE_URL = normalizeBaseUrl(
  Deno.env.get('TRANSCRIPTION_FALLBACK_SERVICE_URL') ||
  Deno.env.get('INFERENCE_SERVICE_FALLBACK_URL') ||
  '',
)
const BOB_API_KEY =
  Deno.env.get('BOB_INFERENCE_API_KEY') ??
  Deno.env.get('INFERENCE_API_KEY') ??
  Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ??
  Deno.env.get('RUNPOD_API_KEY') ??
  ''

function buildServiceUrlPool(): string[] {
  const urls = [TRANSCRIPTION_SERVICE_URL]
  if (TRANSCRIPTION_FALLBACK_SERVICE_URL) {
    urls.push(TRANSCRIPTION_FALLBACK_SERVICE_URL)
  }
  return urls.filter(Boolean)
}

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return errorResponse(authResult.error ?? 'Unauthorized', req, 401)
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  const serviceUrls = buildServiceUrlPool()
  if (!serviceUrls.length) {
    return errorResponse('TRANSCRIPTION_SERVICE_URL or INFERENCE_SERVICE_URL is not configured', req, 503)
  }

  const body = await req.json().catch(() => ({})) as {
    clip_url?: string
    audio_base64?: string
    audio_mime_type?: string
    language?: string
  }

  let audioBase64 = typeof body.audio_base64 === 'string' ? body.audio_base64.trim() : ''
  const audioMimeType = typeof body.audio_mime_type === 'string' && body.audio_mime_type.trim()
    ? body.audio_mime_type.trim()
    : 'audio/webm'

  if (!audioBase64 && typeof body.clip_url === 'string' && body.clip_url.trim()) {
    try {
      const clipResp = await fetchWithRetry(body.clip_url.trim(), { method: 'GET' }, {
        retries: 1,
        timeoutMs: 12_000,
        backoffMs: 400,
      })
      if (!clipResp.ok) {
        const errText = await clipResp.text().catch(() => '')
        console.error('transcribe-audio: clip fetch failed', clipResp.status, errText.slice(0, 160))
        return errorResponse(`Clip download failed (${clipResp.status})`, req, 502)
      }
      const clipBuffer = new Uint8Array(await clipResp.arrayBuffer())
      const chunks: string[] = []
      const chunkSize = 0x8000
      for (let i = 0; i < clipBuffer.length; i += chunkSize) {
        const slice = clipBuffer.subarray(i, i + chunkSize)
        chunks.push(String.fromCharCode(...slice))
      }
      audioBase64 = btoa(chunks.join(''))
    } catch (err: any) {
      console.error('transcribe-audio: clip fetch exception', err?.message || String(err))
      return errorResponse('Could not download clip for transcription', req, 502)
    }
  }

  if (!audioBase64) {
    return errorResponse('Provide clip_url or audio_base64', req, 400)
  }

  try {
    const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'en'

    let lastError: Error | null = null
    for (const serviceUrl of serviceUrls) {
      try {
        // Detect RunPod serverless URL and use action-based /runsync protocol
        const isRunpod = serviceUrl.includes('api.runpod.ai/v2') ||
          serviceUrl.includes('runpod.io')

        let inferResp: Response
        if (isRunpod) {
          const runpodBase = serviceUrl.replace(/\/(runsync|run|status.*)$/i, '')
          inferResp = await fetchWithRetry(`${runpodBase}/runsync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(BOB_API_KEY ? { Authorization: `Bearer ${BOB_API_KEY}` } : {}),
            },
            body: JSON.stringify({
              input: {
                action: 'transcribe',
                audio_base64: audioBase64,
                audio_mime_type: audioMimeType,
                language,
              },
            }),
          }, { retries: 1, timeoutMs: 35_000, backoffMs: 600 })
        } else {
          inferResp = await fetchWithRetry(`${serviceUrl}/infer/transcribe`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(BOB_API_KEY
                ? { Authorization: `Bearer ${BOB_API_KEY}`, 'x-inference-api-key': BOB_API_KEY }
                : {}),
            },
            body: JSON.stringify({
              audio_base64: audioBase64,
              audio_mime_type: audioMimeType,
              language,
            }),
          }, { retries: 1, timeoutMs: 30_000, backoffMs: 600 })
        }

        if (!inferResp.ok) {
          const errText = await inferResp.text().catch(() => '')
          console.error(`transcribe-audio: inference error from ${serviceUrl}`, inferResp.status, errText.slice(0, 220))
          lastError = new Error(`HTTP ${inferResp.status}`)
          continue
        }

        const rawPayload = await inferResp.json().catch(() => ({})) as Record<string, unknown>

        // RunPod wraps results in { output: { ... } }
        const payload = (rawPayload.output && typeof rawPayload.output === 'object')
          ? rawPayload.output as Record<string, unknown>
          : rawPayload

        const payloadSuccess = payload.success
        if (payloadSuccess === false) {
          // RunPod worker may not support `transcribe` action yet.
          // Return a browser STT directive to preserve Bob's ears in production.
          return jsonResponse({
            transcript: null,
            language,
            provider: 'browser_fallback',
            client_action: 'web_speech_recognition',
            message: 'Inference transcribe action unavailable; use browser speech recognition fallback.',
          }, req)
        }

        // If inference returns browser_fallback directive, pass it through so the
        // client can activate Web Speech API transcription.
        return jsonResponse(payload, req)
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err?.message ?? err))
        console.error(`transcribe-audio: endpoint ${serviceUrl} failed, trying next...`, lastError.message)
        continue
      }
    }

    // All endpoints exhausted
    const errMsg = lastError?.message || 'Transcription unavailable'
    console.error('transcribe-audio: all endpoints failed', errMsg)
    return errorResponse(errMsg, req, 502)
  } catch (err: any) {
    console.error('transcribe-audio: inference fetch exception', err?.message || String(err))
    return errorResponse(err?.message || 'Transcription unavailable', req, 502)
  }
}))
