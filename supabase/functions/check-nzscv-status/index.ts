/**
 * CHECK NZSCV STATUS
 * Queries the NZSCV Self-Contained Vehicle Registry via proxy server
 *
 * IMPORTANT: NZSCV only returns:
 *   - VehicleRegistration (plate number, echoed back)
 *   - CertificateStatus   (Current | Issued | Revoked | Expired)
 *   - CertificateExpiryDate (YYYY-MM-DD)
 *   - CertificateIssueDate  (YYYY-MM-DD)
 *
 * NZSCV does NOT return: make, model, year, colour, VIN, owner, or any other
 * vehicle detail. Do NOT attempt to read those fields from this function.
 *
 * This function calls our static IP proxy instead of NZSCV directly
 * because NZSCV requires IP whitelisting.
 *
 * Flow: Edge Function → Proxy Server (Static IP) → NZSCV API
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface NZSCVRequest {
  plate_number: string;
}

// Only the fields NZSCV actually returns
interface NZSCVResponse {
  VehicleRegistration: {
    /** The registration number, echoed back */
    VehicleRegistration: string;
    /** Current | Issued | Revoked | Expired */
    CertificateStatus: 'Current' | 'Issued' | 'Revoked' | 'Expired';
    /** YYYY-MM-DD */
    CertificateIssueDate: string;
    /** YYYY-MM-DD */
    CertificateExpiryDate: string;
  };
  StatusCode: string;
  LogoURL: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { plate_number }: NZSCVRequest = await req.json();

    if (!plate_number || plate_number.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'Plate number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔍 Checking NZSCV status for:', plate_number);

    // Get proxy server URL and secret from environment
    const PROXY_URL = Deno.env.get('NZSCV_PROXY_URL');
    const PROXY_SECRET = Deno.env.get('NZSCV_PROXY_SECRET');

    if (!PROXY_URL) {
      console.error('❌ NZSCV_PROXY_URL not configured');
      return new Response(
        JSON.stringify({ 
          error: 'NZSCV proxy not configured',
          details: 'Contact system administrator to set up NZSCV_PROXY_URL' 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call proxy server
    const proxyResponse = await fetch(`${PROXY_URL}/api/nzscv/vehicle-info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Proxy-Secret': PROXY_SECRET || '',
      },
      body: JSON.stringify({
        RegistrationNumber: plate_number.toUpperCase().trim(),
      }),
    });

    if (!proxyResponse.ok) {
      const errorData = await proxyResponse.json().catch(() => ({ error: 'Unknown error' }));
      console.error('❌ NZSCV API error:', errorData);

      // 404 = plate not on the NZSCV register (vehicle is NOT self-contained certified)
      if (proxyResponse.status === 404) {
        return new Response(
          JSON.stringify({ 
            found: false,
            plate_number: plate_number.toUpperCase(),
            result: {
              is_self_contained: false,
              expiry_date: null,
            },
            message: 'Vehicle not found in NZSCV registry — not self-contained certified',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          error: 'NZSCV API request failed',
          status: proxyResponse.status,
          details: errorData 
        }),
        { status: proxyResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data: NZSCVResponse = await proxyResponse.json();
    const vr = data.VehicleRegistration;

    // ── DEBUG: Log the FULL raw response so we can see exactly what NZSCV
    // returns. This helps verify the API shape in Supabase function logs.
    // TODO: remove or gate behind a DEBUG env var once verified.
    console.log('✅ NZSCV raw response (full):', JSON.stringify(data));
    console.log('✅ NZSCV top-level keys:', Object.keys(data));
    if (vr && typeof vr === 'object') {
      console.log('✅ NZSCV VehicleRegistration keys:', Object.keys(vr));
    }

    // Determine if SC certificate is currently valid
    const status  = vr?.CertificateStatus ?? null;
    const expiry  = vr?.CertificateExpiryDate ?? null;
    const isCurrentByStatus = status === 'Current' || status === 'Issued';
    const isCurrentByExpiry = expiry != null && new Date(expiry) > new Date();
    const isSelfContained   = isCurrentByStatus || (!status && isCurrentByExpiry);

    // Return only the fields NZSCV actually provides
    return new Response(
      JSON.stringify({
        found: true,
        plate_number: vr?.VehicleRegistration ?? plate_number.toUpperCase(),
        // NZSCV only provides certification data — NOT make/model/year/colour/VIN
        result: {
          is_self_contained: isSelfContained,
          expiry_date:       expiry,
          issue_date:        vr?.CertificateIssueDate ?? null,
          status:            status,
        },
        logo_url:   data.LogoURL ?? null,
        checked_at: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Function error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

