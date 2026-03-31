import { corsHeaders } from '../_shared/cors.ts'
import { validateServiceUrl, buildEndpointUrl } from '../_shared/urlUtils.ts'

const HEALTH_CHECK_TIMEOUT_MS = 8_000
const INFERENCE_API_KEY = Deno.env.get('INFERENCE_API_KEY') || ''

// Validate and normalize URLs at startup
const proxyValidation = validateServiceUrl(
  Deno.env.get('PROXY_SERVER_URL') || Deno.env.get('NZSCV_PROXY_URL'),
  'PROXY_SERVER_URL'
)
const inferenceValidation = validateServiceUrl(
  Deno.env.get('INFERENCE_SERVICE_URL'),
  'INFERENCE_SERVICE_URL'
)

const PROXY_SERVER_URL = proxyValidation.url
const INFERENCE_SERVICE_URL = inferenceValidation.url

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
    return new Response('ok', { headers: corsHeaders })
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
        inference_api_key_configured: !!INFERENCE_API_KEY,
        checked_at: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  }

  try {
    // Check both services in parallel
    const [proxyCheck, inferenceCheck] = await Promise.allSettled([
      fetch(`${PROXY_SERVER_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS), // cold-start grace period
      }),
      fetch(`${INFERENCE_SERVICE_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      }),
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

    const [proxyJson, inferenceJson] = await Promise.all([
      proxyCheck.status === 'fulfilled' && proxyCheck.value.ok
        ? safeJson(proxyCheck.value)
        : Promise.resolve(null),
      inferenceCheck.status === 'fulfilled' && inferenceCheck.value.ok
        ? safeJson(inferenceCheck.value)
        : Promise.resolve(null),
    ])

    const proxyStatus = resolveStatus(proxyCheck, proxyJson)
    const inferenceStatus = resolveStatus(inferenceCheck, inferenceJson)

    return new Response(
      JSON.stringify({
        proxy: proxyStatus,
        proxy_url: PROXY_SERVER_URL,
        inference: inferenceStatus,
        inference_url: INFERENCE_SERVICE_URL,
        inference_api_key_configured: !!INFERENCE_API_KEY,
        checked_at: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error: any) {
    console.error('Railway health check error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
})
