// ============================================================================
// plate-scanner-photo-first — Feature-flagged delegate to vehicle-ingest
// ============================================================================
// Purpose: Phase 1 feature-flag wrapper. When FEATURE_INGEST_V2 is enabled,
//          the Field Officer Portal and mobile app call this function instead
//          of the legacy endpoint. This function simply delegates to the
//          vehicle-ingest production pipeline without any behavioural change,
//          allowing a clean rollback by pointing back to the old endpoint.
//
// Usage:
//   const ingestUrl = FEATURE_INGEST_V2
//     ? 'plate-scanner-photo-first'
//     : 'vehicle-ingest'
// ============================================================================

import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Forward the request body and auth headers directly to vehicle-ingest
    const body = await req.text()
    const headers: Record<string, string> = {
      'Content-Type': req.headers.get('Content-Type') || 'application/json',
      Authorization: req.headers.get('Authorization') || '',
      apikey: req.headers.get('apikey') || '',
      'x-client-info': req.headers.get('x-client-info') || '',
      'x-client-timezone': req.headers.get('x-client-timezone') || 'Pacific/Auckland',
    }

    const upstream = await fetch(
      `${SUPABASE_URL}/functions/v1/vehicle-ingest`,
      {
        method: req.method,
        headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' && body ? body : undefined,
      }
    )

    const responseBody = await upstream.text()
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      },
    })
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
