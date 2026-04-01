/**
 * CHECK NZSCV STATUS
 * Queries the NZSCV Self-Contained Vehicle Registry via proxy server
 *
 * Guaranteed fields from NZSCV:
 *   - VehicleRegistration (plate number, echoed back)
 *   - CertificateExpiryDate (YYYY-MM-DD)
 *
 * Optional fields that may be returned depending on API version/tier:
 *   - CertificateStatus   (Current | Issued | Revoked | Expired)
 *   - CertificateIssueDate (YYYY-MM-DD)
 *   - make, model, year, vin, colour, MaxOccupants
 *
 * All optional fields are treated as nullable — present if provided, null otherwise.
 *
 * This function calls our static IP proxy instead of NZSCV directly
 * because NZSCV requires IP whitelisting.
 *
 * Flow: Edge Function → Proxy Server (Static IP) → NZSCV API
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

interface NZSCVRequest {
  plate_number: string;
  plateNumber?: string;
}

// Represents the raw NZSCV API response shape.
// Only plate (VehicleRegistration) and CertificateExpiryDate are guaranteed.
// All other fields are optional — present if the API provides them, absent otherwise.
interface NZSCVResponse {
  VehicleRegistration: {
    /** The registration number echoed back — always present */
    VehicleRegistration: string;
    /** YYYY-MM-DD — always present */
    CertificateExpiryDate: string;
    /** Current | Issued | Revoked | Expired — may be absent */
    CertificateStatus?: 'Current' | 'Issued' | 'Revoked' | 'Expired';
    /** YYYY-MM-DD — may be absent */
    CertificateIssueDate?: string;
    /** Vehicle make — may be absent */
    make?: string;
    /** Vehicle model — may be absent */
    model?: string;
    /** Year of manufacture — may be absent */
    year?: string | number;
    /** VIN — may be absent */
    vin?: string;
    /** Primary colour — may be absent */
    colour?: string;
    /** Maximum occupants certified — may be absent */
    MaxOccupants?: number;
  };
  StatusCode?: string;
  LogoURL?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const requestBody: NZSCVRequest = await req.json();
    const plate_number = (requestBody.plate_number || requestBody.plateNumber || '').trim();

    if (!plate_number || plate_number.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'Plate number is required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔍 Checking NZSCV status for:', plate_number);

    // API-first flow: query NZSCV via proxy as primary source.
    // Fall back to canonical_scv only if the API is unavailable.
    const normalizedPlate = plate_number.toUpperCase().trim();
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;

    const getCanonicalFallbackResponse = async (reason: string): Promise<Response | null> => {
      if (!supabaseAdmin) return null;
      try {
        const { data: scvRow } = await (supabaseAdmin.from('canonical_scv') as any)
          .select('is_self_contained, certificate_expiry, certificate_issue_date, certificate_status, vin, max_occupants, logo_url, verified_at')
          .eq('plate_number', normalizedPlate)
          .maybeSingle();

        if (!scvRow) return null;

        let vehicleMake: string | null = null;
        let vehicleModel: string | null = null;
        let vehicleYear: number | null = null;
        let vehicleColor: string | null = null;

        try {
          const { data: cv } = await supabaseAdmin
            .from('canonical_vehicles')
            .select('vehicle_make, vehicle_model, vehicle_year, vehicle_color')
            .eq('plate_number', normalizedPlate)
            .maybeSingle();
          if (cv) {
            vehicleMake = cv.vehicle_make ?? null;
            vehicleModel = cv.vehicle_model ?? null;
            vehicleYear = cv.vehicle_year != null ? Number(cv.vehicle_year) : null;
            vehicleColor = cv.vehicle_color ?? null;
          }
        } catch {
          // optional vehicle attributes
        }

        return new Response(
          JSON.stringify({
            found: true,
            source: 'canonical_scv',
            fallback_reason: reason,
            plate_number: normalizedPlate,
            result: {
              is_self_contained: scvRow.is_self_contained === true,
              expiry_date: scvRow.certificate_expiry ?? null,
              issue_date: scvRow.certificate_issue_date ?? null,
              certificate_status: scvRow.certificate_status ?? null,
              make: vehicleMake,
              model: vehicleModel,
              year: vehicleYear,
              vin: scvRow.vin ?? null,
              colour: vehicleColor,
              max_occupants: scvRow.max_occupants ?? null,
            },
            logo_url: scvRow.logo_url ?? null,
            checked_at: new Date().toISOString(),
          }),
          { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      } catch (fallbackErr: any) {
        console.warn('⚠️ canonical_scv fallback failed:', fallbackErr?.message || fallbackErr);
        return null;
      }
    };

    // ── Step 1: Query NZSCV API via proxy (PRIMARY) ─────────────────────────

    // Get proxy server URL and secret from environment
    const PROXY_URL = Deno.env.get('NZSCV_PROXY_URL') || Deno.env.get('PROXY_SERVER_URL');
    const PROXY_SECRET = Deno.env.get('NZSCV_PROXY_SECRET') || Deno.env.get('PROXY_SERVER_SECRET');

    if (!PROXY_URL) {
      console.error('❌ NZSCV_PROXY_URL not configured, attempting canonical fallback');
      const fallback = await getCanonicalFallbackResponse('nzscv_proxy_not_configured');
      if (fallback) return fallback;
      return new Response(
        JSON.stringify({
          error: 'NZSCV proxy not configured',
          details: 'Contact system administrator to set up NZSCV_PROXY_URL',
        }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // Call proxy server
    let proxyResponse: Response;
    try {
      proxyResponse = await fetch(`${PROXY_URL}/api/nzscv/vehicle-info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Proxy-Secret': PROXY_SECRET || '',
        },
        body: JSON.stringify({
          RegistrationNumber: normalizedPlate,
        }),
      });
    } catch (proxyErr: any) {
      console.error('❌ NZSCV API unavailable (network/proxy error):', proxyErr?.message || proxyErr);
      const fallback = await getCanonicalFallbackResponse('nzscv_api_unavailable');
      if (fallback) return fallback;
      return new Response(
        JSON.stringify({
          error: 'NZSCV API unavailable',
          details: proxyErr?.message || String(proxyErr),
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (!proxyResponse.ok) {
      const errorData = await proxyResponse.json().catch(() => ({ error: 'Unknown error' }));
      console.error('❌ NZSCV API error:', errorData);

      // 404 = plate not on the NZSCV register (vehicle is NOT self-contained certified)
      if (proxyResponse.status === 404) {
        // If API says not found but we have canonical data, treat API response as
        // unavailable/incomplete for this plate and fall back to canonical.
        const fallback = await getCanonicalFallbackResponse('nzscv_api_http_404_with_canonical');
        if (fallback) return fallback;

        return new Response(
          JSON.stringify({ 
            found: false,
            plate_number: normalizedPlate,
            result: {
              is_self_contained: false,
              expiry_date: null,
            },
            message: 'Vehicle not found in NZSCV registry — not self-contained certified',
          }),
          { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      // API returned an error (but not 404). Treat as unavailable and fallback.
      const fallback = await getCanonicalFallbackResponse(`nzscv_api_http_${proxyResponse.status}`);
      if (fallback) return fallback;

      return new Response(
        JSON.stringify({
          error: 'NZSCV API request failed',
          status: proxyResponse.status,
          details: errorData,
        }),
        { status: proxyResponse.status, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
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
    const issueDate = vr?.CertificateIssueDate ?? null;
    const vin = vr?.vin ?? null;
    const maxOccupants = vr?.MaxOccupants ?? null;
    const logoUrl = data.LogoURL ?? null;
    const isCurrentByStatus = status === 'Current' || status === 'Issued';
    const isCurrentByExpiry = expiry != null && new Date(expiry) > new Date();
    const isSelfContained   = isCurrentByStatus || (!status && isCurrentByExpiry);

    // Persist full NZSCV payload so observations can be backfilled later.
    // Best effort only — lookup response must succeed even if persistence fails.
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const normalizedPlate = (vr?.VehicleRegistration ?? plate_number).toUpperCase().trim();
        await (supabaseAdmin.from('canonical_scv') as any).upsert({
          plate_number: normalizedPlate,
          is_self_contained: isSelfContained,
          certificate_expiry: expiry,
          certificate_issue_date: issueDate,
          certificate_status: status,
          vin,
          max_occupants: maxOccupants,
          logo_url: logoUrl,
          raw_payload: data,
          source: 'nzscv_api',
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'plate_number' });
      } catch (persistErr: any) {
        console.warn('⚠️ Failed to persist NZSCV payload to canonical_scv:', persistErr?.message || persistErr);
      }
    }

    // Return SC certification fields (guaranteed) + any optional vehicle detail
    // fields that NZSCV may provide. All optional fields are null when absent.
    // For inference service mismatch detection: include all NZSCV fields
    return new Response(
      JSON.stringify({
        found: true,
        plate_number: vr?.VehicleRegistration ?? plate_number.toUpperCase(),
        result: {
          // SC certification — core purpose of NZSCV lookup
          is_self_contained: isSelfContained,
          expiry_date:       expiry,
          issue_date:        issueDate,
          certificate_status: status, // For inference service to detect revoked/expired
          // Optional vehicle detail fields — null when not provided by NZSCV
          make:          vr?.make          ?? null,
          model:         vr?.model         ?? null,
          year:          vr?.year != null ? parseInt(String(vr.year), 10) : null,
          vin:           vin,
          colour:        vr?.colour        ?? null,
          max_occupants: maxOccupants,
        },
        logo_url:   logoUrl,
        source:     'nzscv_register', // Track which authority provided this data
        checked_at: new Date().toISOString(),
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Function error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});

