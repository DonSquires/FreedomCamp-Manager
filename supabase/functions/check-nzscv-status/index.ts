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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface NZSCVRequest {
  plate_number: string;
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

    // ── Step 1: Check canonical_scv first (authoritative SCV registry) ────
    // canonical_scv is the single source of truth for SCV certification,
    // populated by sync-scv-list.  The NZSCV API may be pointing to a test
    // endpoint and returning inaccurate data, so canonical_scv is preferred.
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const normalizedPlate = plate_number.toUpperCase().trim();

        const { data: scvRow } = await (supabaseAdmin.from('canonical_scv') as any)
          .select('is_self_contained, certificate_expiry')
          .eq('plate_number', normalizedPlate)
          .maybeSingle();

        if (scvRow && scvRow.is_self_contained === true) {
          const expiry = scvRow.certificate_expiry ?? null;
          const isExpired = expiry != null && new Date(expiry) < new Date();
          if (!isExpired) {
            // Optionally grab vehicle attributes from canonical_vehicles
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
                vehicleMake  = cv.vehicle_make ?? null;
                vehicleModel = cv.vehicle_model ?? null;
                vehicleYear  = cv.vehicle_year != null ? Number(cv.vehicle_year) : null;
                vehicleColor = cv.vehicle_color ?? null;
              }
            } catch { /* vehicle attributes are optional */ }

            console.log('✅ SCV status from canonical_scv (trusted):', {
              plate: normalizedPlate,
              self_contained: true,
              expiry,
            });
            return new Response(
              JSON.stringify({
                found: true,
                source: 'canonical_scv',
                plate_number: normalizedPlate,
                result: {
                  is_self_contained: true,
                  expiry_date: expiry,
                  issue_date: null,
                  status: 'Current',
                  make: vehicleMake,
                  model: vehicleModel,
                  year: vehicleYear,
                  vin: null,
                  colour: vehicleColor,
                  max_occupants: null,
                },
                checked_at: new Date().toISOString(),
              }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      } catch (canonicalErr: any) {
        console.warn('⚠️ canonical_scv lookup failed (will fall back to NZSCV API):', canonicalErr.message);
      }
    }

    // ── Step 2: Fall back to NZSCV API ──────────────────────────────────────
    // Only reached if canonical_scv has no record or says not self-contained.
    // NOTE: The NZSCV API may be pointing to a test endpoint — results may be
    // inaccurate. canonical_scv (updated by sync-scv-list) is preferred.

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

    // Return SC certification fields (guaranteed) + any optional vehicle detail
    // fields that NZSCV may provide. All optional fields are null when absent.
    return new Response(
      JSON.stringify({
        found: true,
        plate_number: vr?.VehicleRegistration ?? plate_number.toUpperCase(),
        result: {
          // SC certification — core purpose of NZSCV lookup
          is_self_contained: isSelfContained,
          expiry_date:       expiry,
          issue_date:        vr?.CertificateIssueDate ?? null,
          status:            status,
          // Optional vehicle detail fields — null when not provided by NZSCV
          make:          vr?.make          ?? null,
          model:         vr?.model         ?? null,
          year:          vr?.year != null ? parseInt(String(vr.year), 10) : null,
          vin:           vr?.vin           ?? null,
          colour:        vr?.colour        ?? null,
          max_occupants: vr?.MaxOccupants  ?? null,
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

