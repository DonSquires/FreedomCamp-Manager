/**
 * check-services-health
 *
 * Canonical health endpoint for proxy, RunPod inference, and PTT services.
 */

import { getCorsHeaders } from '../_shared/withCors.ts'
import { validateServiceUrl, buildEndpointUrl } from '../_shared/urlUtils.ts'

const HEALTH_CHECK_TIMEOUT_MS = 8_000
const RUNPOD_PING_TIMEOUT_MS = 60_000
const INFERENCE_API_KEY =
  Deno.env.get('INFERENCE_API_KEY') ||
  Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ||
  Deno.env.get('RUNPOD_API_KEY') ||
  Deno.env.get('BOB_INFERENCE_API_KEY') ||
  ''
const PTT_WS_URL = Deno.env.get('PTT_WS_URL') || Deno.env.get('PTT_SIGNALING_WS_URL') || ''

const proxyValidation = validateServiceUrl(
  Deno.env.get('PROXY_SERVER_URL') || Deno.env.get('NZSCV_PROXY_URL'),
  'PROXY_SERVER_URL',
)
const RUNPOD_ENDPOINT_ID = String(Deno.env.get('RUNPOD_ENDPOINT_ID') || '').trim()
const derivedRunpodUrl = RUNPOD_ENDPOINT_ID ? `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}` : ''
const inferenceValidation = validateServiceUrl(
  // Prefer explicit RunPod endpoint config when available so stale
  // INFERENCE_SERVICE_URL values do not keep diagnostics pinned to old hosts.
  Deno.env.get('RUNPOD_ENDPOINT_URL') ||
    Deno.env.get('INFERENCE_SERVICE_URL_RUNPOD') ||
    derivedRunpodUrl ||
    Deno.env.get('INFERENCE_SERVICE_URL') ||
    Deno.env.get('BOB_SERVICE_URL') ||
    '',
  'INFERENCE_SERVICE_URL',
)
const pttValidation = validateServiceUrl(
  Deno.env.get('PTT_SERVER_URL') || Deno.env.get('PTT_SERVICE_URL') || '',
  'PTT_SERVER_URL',
)

function validateWsUrl(value: string): { valid: boolean; warning?: string; error?: string; normalized: string | null } {
  const normalized = String(value || '').trim().replace(/\/+$/, '')
  if (!normalized) {
    return { valid: false, warning: 'PTT_WS_URL not set; derived ws URL from PTT server URL will be used', normalized: null }
  }
  if (!(normalized.startsWith('ws://') || normalized.startsWith('wss://'))) {
    return { valid: false, error: 'PTT_WS_URL must start with ws:// or wss://', normalized }
  }
  if (normalized.startsWith('ws://')) {
    return { valid: true, warning: 'PTT_WS_URL uses insecure ws://; HTTPS clients may reject mixed content', normalized }
  }
  return { valid: true, normalized }
}

const pttWsValidation = validateWsUrl(PTT_WS_URL)

const PROXY_SERVER_URL = proxyValidation.url
const INFERENCE_SERVICE_URL = inferenceValidation.url
const PTT_SERVER_URL = pttValidation.url

function isRunpodServerlessUrl(url: string): boolean {
  return /api\.runpod\.ai\/v2\/[^/]+(?:\/(?:run|runsync|health))?\/?$/i.test(url)
}

function normalizeRunpodBaseUrl(url: string): string {
  // Strip any existing path suffix (/run, /runsync, /health, trailing slash)
  return url.replace(/\/(run|runsync|health)\/?$/i, '').replace(/\/$/, '')
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json()
  } catch {
    return { status: 'ok' }
  }
}

function reasonToString(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  return 'Connection failed'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const [proxyCheck, inferenceCheck, pttCheck] = await Promise.all([
      (async () => {
        if (!PROXY_SERVER_URL) {
          return {
            status: 'not_configured',
            error: proxyValidation.error || 'PROXY_SERVER_URL not configured',
            ...(proxyValidation.warning ? { warning: proxyValidation.warning } : {}),
          }
        }

        try {
          const response = await fetch(buildEndpointUrl(PROXY_SERVER_URL, '/health'), {
            method: 'GET',
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          })

          if (!response.ok) {
            return { status: 'offline', error: `HTTP ${response.status}` }
          }

          const json = await safeJson(response)
          return { ...json, ...(proxyValidation.warning ? { warning: proxyValidation.warning } : {}) }
        } catch (err: unknown) {
          return { status: 'offline', error: reasonToString(err), ...(proxyValidation.warning ? { warning: proxyValidation.warning } : {}) }
        }
      })(),
      (async () => {
        if (!INFERENCE_SERVICE_URL) {
          return {
            status: 'offline',
            error: inferenceValidation.error || 'INFERENCE_SERVICE_URL not configured',
            ...(inferenceValidation.warning ? { warning: inferenceValidation.warning } : {}),
          }
        }

        try {
          if (isRunpodServerlessUrl(INFERENCE_SERVICE_URL)) {
            if (!INFERENCE_API_KEY) {
              return {
                status: 'offline',
                error: 'RunPod endpoint configured but INFERENCE_API_KEY/RUNPOD_API_KEY is missing',
                ...(inferenceValidation.warning ? { warning: inferenceValidation.warning } : {}),
              }
            }

            // Use /health endpoint — returns worker info instantly without running a job.
            const healthUrl = `${normalizeRunpodBaseUrl(INFERENCE_SERVICE_URL)}/health`
            const response = await fetch(healthUrl, {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${INFERENCE_API_KEY}` },
              signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
            })

            if (!response.ok) {
              return { status: 'offline', error: `HTTP ${response.status}`, ...(inferenceValidation.warning ? { warning: inferenceValidation.warning } : {}) }
            }

            const parsed = await safeJson(response)
            // /health returns { workers: { idle, running, ... } }
            // Any 200 response means the endpoint is reachable and accepting requests.
            return {
              status: 'ok',
              provider: 'runpod-serverless',
              workers: parsed?.workers ?? null,
              ...(inferenceValidation.warning ? { warning: inferenceValidation.warning } : {}),
            }
          }

          const response = await fetch(buildEndpointUrl(INFERENCE_SERVICE_URL, '/health'), {
            method: 'GET',
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          })

          if (!response.ok) {
            return { status: 'offline', error: `HTTP ${response.status}` }
          }

          const json = await safeJson(response)
          return { ...json, ...(inferenceValidation.warning ? { warning: inferenceValidation.warning } : {}) }
        } catch (err: unknown) {
          return { status: 'offline', error: reasonToString(err), ...(inferenceValidation.warning ? { warning: inferenceValidation.warning } : {}) }
        }
      })(),
      (async () => {
        if (!PTT_SERVER_URL) {
          return {
            status: 'offline',
            error: pttValidation.error || 'PTT_SERVER_URL not configured',
            ...(pttValidation.warning ? { warning: pttValidation.warning } : {}),
          }
        }

        try {
          const response = await fetch(buildEndpointUrl(PTT_SERVER_URL, '/health'), {
            method: 'GET',
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          })

          if (!response.ok) {
            return { status: 'offline', error: `HTTP ${response.status}` }
          }

          const json = await safeJson(response)
          return { ...json }
        } catch (err: unknown) {
          return { status: 'offline', error: reasonToString(err) }
        }
      })(),
    ])

    const proxyStatus = proxyCheck
    const inferenceStatus = inferenceCheck
    const pttStatus = pttCheck

    if (pttStatus.status === 'ok' && pttWsValidation.error) {
      pttStatus.status = 'degraded'
      pttStatus.error = pttWsValidation.error
    }
    if (pttWsValidation.warning) {
      pttStatus.warning = pttWsValidation.warning
    }

    return new Response(
      JSON.stringify({
        proxy: proxyStatus,
        proxy_url: PROXY_SERVER_URL,
        inference: inferenceStatus,
        inference_url: INFERENCE_SERVICE_URL,
        ptt: pttStatus,
        ptt_url: PTT_SERVER_URL || null,
        ptt_ws_url: pttWsValidation.normalized,
        ptt_ws_url_validation: {
          valid: pttWsValidation.valid,
          ...(pttWsValidation.warning ? { warning: pttWsValidation.warning } : {}),
          ...(pttWsValidation.error ? { error: pttWsValidation.error } : {}),
        },
        inference_api_key_configured: !!INFERENCE_API_KEY,
        checked_at: new Date().toISOString(),
      }),
      {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error: any) {
    console.error('Services health check error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
})
