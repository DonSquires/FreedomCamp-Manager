/**
 * CHECK NZSCV STATUS
 * Queries the NZSCV Self-Contained Vehicle Registry via proxy server
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

interface NZSCVResponse {
  VehicleRegistration: {
    VehicleRegistration: string;
    make: string;
    model: string;
    year: string;
    vin: string;
    MaxOccupants: number;
    CertificateStatus: 'Current' | 'Issued' | 'Revoked' | 'Expired';
    CertificateIssueDate: string; // YYYY-MM-DD
    CertificateExpiryDate: string; // YYYY-MM-DD
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

      // Handle specific NZSCV error codes
      if (proxyResponse.status === 404) {
        return new Response(
          JSON.stringify({ 
            found: false,
            message: 'Vehicle not found in NZSCV registry',
            plate_number: plate_number.toUpperCase(),
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

    console.log('✅ NZSCV response:', {
      plate: data.VehicleRegistration?.VehicleRegistration,
      status: data.VehicleRegistration?.CertificateStatus,
    });

    // Return structured response
    return new Response(
      JSON.stringify({
        found: true,
        plate_number: data.VehicleRegistration.VehicleRegistration,
        vehicle: {
          make: data.VehicleRegistration.make,
          model: data.VehicleRegistration.model,
          year: parseInt(data.VehicleRegistration.year),
          color: null, // NZSCV doesn't provide color
          vin: data.VehicleRegistration.vin,
        },
        certification: {
          status: data.VehicleRegistration.CertificateStatus,
          max_occupants: data.VehicleRegistration.MaxOccupants,
          issue_date: data.VehicleRegistration.CertificateIssueDate,
          expiry_date: data.VehicleRegistration.CertificateExpiryDate,
          is_current: data.VehicleRegistration.CertificateStatus === 'Current',
        },
        logo_url: data.LogoURL,
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
