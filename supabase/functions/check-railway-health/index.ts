import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts'
import { validateServiceUrl, buildEndpointUrl } from '../_shared/urlUtils.ts'

const HEALTH_CHECK_TIMEOUT_MS = 8_000
const INFERENCE_API_KEY = Deno.env.get('INFERENCE_API_KEY') || ''
const DEFAULT_PTT_SERVER_URL = 'http://72.61.123.97:8080'

// Validate and normalize URLs at startup
const proxyValidation = validateServiceUrl(
  Deno.env.get('PROXY_SERVER_URL') || Deno.env.get('NZSCV_PROXY_URL'),
  'PROXY_SERVER_URL'
)
const inferenceValidation = validateServiceUrl(
  Deno.env.get('INFERENCE_SERVICE_URL') || Deno.env.get('BOB_SERVICE_URL'),
  'INFERENCE_SERVICE_URL'
)
const pttValidation = validateServiceUrl(
  Deno.env.get('PTT_SERVER_URL') || Deno.env.get('PTT_SERVICE_URL') || DEFAULT_PTT_SERVER_URL,
  'PTT_SERVER_URL'
)

const PROXY_SERVER_URL = proxyValidation.url
const INFERENCE_SERVICE_URL = inferenceValidation.url
const PTT_SERVER_URL = pttValidation.url

/** Safely parse a fetch Response as JSON, falling back to a status object. */
async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json()
  } catch {
    return { status: 'ok' }
  }
}

/** Convert an unknown rejection reason to a plain string. */
function reasonToString(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  return 'Connection failed'
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  // If environment variables are not configured or malformed, return a clear error status
  // immediately rather than hitting localhost which would be meaningless inside
  // the edge-function sandbox.
  if (!PROXY_SERVER_URL || !INFERENCE_SERVICE_URL) {
    return new Response(
      JSON.stringify({
        proxy: { 
          status: 'offline', 
          error: proxyValidation.error || 'PROXY_SERVER_URL not configured',
          warning: proxyValidation.warning,
        },
        proxy_url: PROXY_SERVER_URL || null,
        inference: { 
          status: 'offline', 
          error: inferenceValidation.error || 'INFERENCE_SERVICE_URL not configured',
          warning: inferenceValidation.warning,
        },
        inference_url: INFERENCE_SERVICE_URL || null,
        ptt: PTT_SERVER_URL
          ? { status: 'unknown', warning: 'PTT health check skipped while core services are not configured' }
          : {
              status: 'offline',
              error: pttValidation.error || 'PTT_SERVER_URL not configured',
              warning: pttValidation.warning,
            },
        ptt_url: PTT_SERVER_URL || null,
        inference_api_key_configured: !!INFERENCE_API_KEY,
        checked_at: new Date().toISOString(),
      }),
      {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  }

  try {
    // Check both services in parallel
    const [proxyCheck, inferenceCheck, pttCheck] = await Promise.allSettled([
      fetch(`${PROXY_SERVER_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS), // cold-start grace period
      }),
      fetch(`${INFERENCE_SERVICE_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      }),
      PTT_SERVER_URL
        ? fetch(`${PTT_SERVER_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          })
        : Promise.reject(new Error('PTT_SERVER_URL not configured')),
    ])

    // Resolve health status for each service independently to avoid unsafe
    // type assertions.
    function resolveStatus(
      result: PromiseSettledResult<Response>,
      json: Record<string, unknown> | null,
    ): Record<string, unknown> {
      if (result.status === 'rejected') {
        return { status: 'offline', error: reasonToString(result.reason) }
      }
      if (!result.value.ok) {
        return { status: 'offline', error: `HTTP ${result.value.status}` }
      }
      return json ?? { status: 'ok' }
    }

    const [proxyJson, inferenceJson, pttJson] = await Promise.all([
      proxyCheck.status === 'fulfilled' && proxyCheck.value.ok
        ? safeJson(proxyCheck.value)
        : Promise.resolve(null),
      inferenceCheck.status === 'fulfilled' && inferenceCheck.value.ok
        ? safeJson(inferenceCheck.value)
        : Promise.resolve(null),
      pttCheck.status === 'fulfilled' && pttCheck.value.ok
        ? safeJson(pttCheck.value)
        : Promise.resolve(null),
    ])

    const proxyStatus = resolveStatus(proxyCheck, proxyJson)
    const inferenceStatus = resolveStatus(inferenceCheck, inferenceJson)
    const pttStatus = PTT_SERVER_URL
      ? resolveStatus(pttCheck, pttJson)
      : {
          status: 'offline',
          error: pttValidation.error || 'PTT_SERVER_URL not configured',
          warning: pttValidation.warning,
        }

    return new Response(
      JSON.stringify({
        proxy: proxyStatus,
        proxy_url: PROXY_SERVER_URL,
        inference: inferenceStatus,
        inference_url: INFERENCE_SERVICE_URL,
        ptt: pttStatus,
        ptt_url: PTT_SERVER_URL || null,
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
