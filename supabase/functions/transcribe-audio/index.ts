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
    const inferResp = await fetchWithRetry(`${BOB_SERVICE_URL}/infer/transcribe`, {
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
        audio_base64: audioBase64,
        audio_mime_type: audioMimeType,
        language: typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'en',
      }),
    }, {
      retries: 1,
      timeoutMs: 30_000,
      backoffMs: 600,
    })

    if (!inferResp.ok) {
      const errText = await inferResp.text().catch(() => '')
      console.error('transcribe-audio: inference error', inferResp.status, errText.slice(0, 220))
      return errorResponse(`Transcription failed (${inferResp.status})`, req, 502)
    }

    const payload = await inferResp.json().catch(() => ({}))
    return jsonResponse(payload, req)
  } catch (err: any) {
    console.error('transcribe-audio: inference fetch exception', err?.message || String(err))
    return errorResponse(err?.message || 'Transcription unavailable', req, 502)
  }
}))
