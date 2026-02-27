import { corsHeaders } from '../_shared/cors.ts'

const PROXY_SERVER_URL = Deno.env.get('PROXY_SERVER_URL') || 'http://localhost:3000'
const INFERENCE_SERVICE_URL = Deno.env.get('INFERENCE_SERVICE_URL') || 'http://localhost:8000'

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Check both services in parallel
    const [proxyCheck, inferenceCheck] = await Promise.allSettled([
      fetch(`${PROXY_SERVER_URL}/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      }),
      fetch(`${INFERENCE_SERVICE_URL}/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      }),
    ])

    const proxyStatus = proxyCheck.status === 'fulfilled' && proxyCheck.value.ok
      ? await proxyCheck.value.json()
      : { status: 'offline', error: proxyCheck.status === 'rejected' ? proxyCheck.reason : 'Not responding' }

    const inferenceStatus = inferenceCheck.status === 'fulfilled' && inferenceCheck.value.ok
      ? await inferenceCheck.value.json()
      : { status: 'offline', error: inferenceCheck.status === 'rejected' ? inferenceCheck.reason : 'Not responding' }

    return new Response(
      JSON.stringify({
        proxy: proxyStatus,
        inference: inferenceStatus,
        checked_at: new Date().toISOString()
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
