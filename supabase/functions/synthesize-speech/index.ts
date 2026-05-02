/**
 * synthesize-speech
 *
 * Proxies Bob speech synthesis requests to inference-service (/infer/speak).
 */

import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { fetchWithRetry } from '../_shared/fetchWithRetry.ts'

function normalizeBaseUrl(raw?: string | null): string {
  return String(raw ?? '').trim().replace(/\/+$/, '')
}

const BOB_SERVICE_URL = normalizeBaseUrl(Deno.env.get('BOB_SERVICE_URL') || Deno.env.get('INFERENCE_SERVICE_URL') || '')
const BOB_FALLBACK_SERVICE_URL = normalizeBaseUrl(Deno.env.get('INFERENCE_SERVICE_FALLBACK_URL') || '')
const BOB_API_KEY =
  Deno.env.get('BOB_INFERENCE_API_KEY') ??
  Deno.env.get('INFERENCE_API_KEY') ??
  Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ??
  Deno.env.get('RUNPOD_API_KEY') ??
  ''

function buildServiceUrlPool(): string[] {
  const urls = [BOB_SERVICE_URL]
  if (BOB_FALLBACK_SERVICE_URL && BOB_FALLBACK_SERVICE_URL !== BOB_SERVICE_URL) {
    urls.push(BOB_FALLBACK_SERVICE_URL)
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
    let lastError: Error | null = null
    for (const serviceUrl of serviceUrls) {
      try {
        // Detect RunPod serverless URL (api.runpod.ai/v2/{endpoint_id}) and use
        // the /runsync action-based protocol instead of direct /infer/* HTTP paths.
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

          const runpodText = await inferResp.text().catch(() => '')
          let runpodJson: any = null
          try {
            runpodJson = runpodText ? JSON.parse(runpodText) : null
          } catch {
            runpodJson = null
          }

          const output = runpodJson?.output ?? runpodJson
          const outputSuccess = output?.success !== false
          if (!inferResp.ok || !outputSuccess) {
            const errMsg = String(output?.error || runpodJson?.error || `HTTP ${inferResp.status}`)
            console.error(`synthesize-speech: runpod speech failed from ${serviceUrl}`, errMsg.slice(0, 220))
            lastError = new Error(errMsg)
            continue
          }

          if (typeof output?.audio_base64 === 'string' && output.audio_base64.trim()) {
            const bytes = Uint8Array.from(atob(output.audio_base64), (c) => c.charCodeAt(0))
            return new Response(bytes, {
              status: 200,
              headers: { ...getCorsHeaders(req), 'Content-Type': 'audio/wav' },
            })
          }

          // Some worker variants return speech directives instead of binary audio.
          return jsonResponse({
            success: true,
            spoken_text: String(output?.spoken_text || output?.response || text),
            client_action: String(output?.client_action || 'web_speech_synthesis'),
            provider: String(output?.provider || 'runpod'),
          }, req, 200)
        } else {
          inferResp = await fetchWithRetry(`${serviceUrl}/infer/speak`, {
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
          console.error(`synthesize-speech: inference error from ${serviceUrl}`, inferResp.status, errText.slice(0, 220))
          lastError = new Error(`HTTP ${inferResp.status}`)
          continue
        }

        const audioData = await inferResp.arrayBuffer()
        return new Response(audioData, {
          status: 200,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'audio/wav' },
        })
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err?.message ?? err))
        console.error(`synthesize-speech: endpoint ${serviceUrl} failed, trying next...`, lastError.message)
        continue
      }
    }

    // All endpoints exhausted
    const errMsg = lastError?.message || 'Speech synthesis unavailable'
    console.error('synthesize-speech: all endpoints failed', errMsg)
    return errorResponse(errMsg, req, 502)
  } catch (err: any) {
    console.error('synthesize-speech: inference fetch exception', err?.message || String(err))
    return errorResponse(err?.message || 'Speech synthesis unavailable', req, 502)
  }
}))
