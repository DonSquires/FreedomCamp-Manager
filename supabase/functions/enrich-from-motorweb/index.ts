// ============================================================================
// enrich-from-motorweb — PLACEHOLDER (API credentials not yet configured)
// ============================================================================
// MotorWeb provides vehicle details (make, model, year, colour) and registered
// owner information for NZ plates.
//
// Status: PLACEHOLDER — MotorWeb API credentials (MOTORWEB_API_KEY,
// MOTORWEB_ID_KEY) have not been provisioned yet.  This function returns a
// clear 503 so callers fail gracefully instead of making outbound calls to an
// unconfigured service.
//
// When credentials are ready, replace this file with the full implementation
// and configure the following Supabase Edge Function secrets:
//   MOTORWEB_API_KEY  — PGDB-Authorization header value
//   MOTORWEB_ID_KEY   — PGDB-Identifier header value
//   RAILWAY_PROXY_URL — URL of the proxy server with a static IP
// ============================================================================

import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error: 'MotorWeb enrichment not yet available',
      details: 'MotorWeb API credentials have not been configured. This feature is a placeholder pending credential provisioning.',
      placeholder: true,
    }),
    {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});

