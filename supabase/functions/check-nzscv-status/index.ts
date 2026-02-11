/**
 * Edge Function: check-nzscv-status
 * 
 * Verifies vehicle self-contained status against the official
 * NZ Self-Contained Vehicle database (https://www.nzscv.co.nz)
 * 
 * Returns:
 * - Self-contained status (certified vs uncertified)
 * - Expiry date if certified
 * - Mismatch detection if officer's observation differs from NZSCV
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

interface NZSCVResult {
  is_certified: boolean;
  expiry_date: string | null;
  certification_type: string | null; // 'NZS 5465' standard
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  last_checked: string;
  source: 'nzscv';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { plateNumber, observedSelfContained } = await req.json();

    if (!plateNumber) {
      return new Response(
        JSON.stringify({ error: 'Missing plateNumber' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔍 Checking NZSCV status for ${plateNumber}`);

    // Check canonical_vehicles to see if we've recently checked this plate
    const { data: vehicle } = await supabaseClient
      .from('canonical_vehicles')
      .select('nzscv_last_checked, self_contained, self_contained_expiry')
      .eq('plate_number', plateNumber)
      .single();

    // Skip if checked in last 7 days
    if (vehicle?.nzscv_last_checked) {
      const hoursSinceCheck = 
        (Date.now() - new Date(vehicle.nzscv_last_checked).getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceCheck < 168) { // 7 days = 168 hours
        console.log(`⏭️ Skipping NZSCV check for ${plateNumber} - recently checked ${(hoursSinceCheck / 24).toFixed(1)} days ago`);
        return new Response(
          JSON.stringify({
            skipped: true,
            reason: 'Recently checked',
            last_checked: vehicle.nzscv_last_checked,
            days_ago: (hoursSinceCheck / 24).toFixed(1),
            is_certified: vehicle.self_contained,
            expiry_date: vehicle.self_contained_expiry,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Query NZSCV database
    console.log('🌐 Fetching from NZSCV...');
    
    const nzscvUrl = `https://www.nzscv.co.nz/Search?card=card-2`;
    const formData = new FormData();
    formData.append('numberPlate', plateNumber);

    const response = await fetch(nzscvUrl, {
      method: 'POST',
      body: formData,
      headers: {
        'User-Agent': 'FreedomCamp Manager/1.0',
      },
    });

    if (!response.ok) {
      console.error(`❌ NZSCV request failed: ${response.status}`);
      throw new Error(`NZSCV request failed: ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    
    if (!doc) {
      throw new Error('Failed to parse NZSCV response');
    }

    // Parse the results
    let isCertified = false;
    let expiryDate: string | null = null;
    let certificationType: string | null = null;
    let vehicleMake: string | null = null;
    let vehicleModel: string | null = null;
    let vehicleYear: number | null = null;

    // Check for "No results found" message
    const noResults = doc.querySelector('.alert-info');
    if (noResults && noResults.textContent.includes('No results found')) {
      console.log(`❌ No NZSCV certification found for ${plateNumber}`);
      isCertified = false;
    } else {
      // Look for certification badge or table
      const certificationBadge = doc.querySelector('.badge.bg-success');
      if (certificationBadge && certificationBadge.textContent.includes('Certified')) {
        isCertified = true;
        console.log(`✅ ${plateNumber} is NZSCV certified`);

        // Extract details from result table
        const rows = doc.querySelectorAll('table tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const label = cells[0].textContent.trim();
            const value = cells[1].textContent.trim();

            if (label.includes('Expiry')) {
              expiryDate = value;
            } else if (label.includes('Standard')) {
              certificationType = value;
            } else if (label.includes('Make')) {
              vehicleMake = value;
            } else if (label.includes('Model')) {
              vehicleModel = value;
            } else if (label.includes('Year')) {
              vehicleYear = parseInt(value) || null;
            }
          }
        }
      }
    }

    const result: NZSCVResult = {
      is_certified: isCertified,
      expiry_date: expiryDate,
      certification_type: certificationType,
      plate_number: plateNumber,
      vehicle_make: vehicleMake,
      vehicle_model: vehicleModel,
      vehicle_year: vehicleYear,
      last_checked: new Date().toISOString(),
      source: 'nzscv',
    };

    console.log('✅ NZSCV result:', result);

    // Update canonical_vehicles with NZSCV data
    const updateData: any = {
      nzscv_last_checked: new Date().toISOString(),
      nzscv_source: 'official',
    };

    // Update self-contained status if certified
    if (isCertified) {
      updateData.self_contained = true;
      updateData.self_contained_expiry = expiryDate;
    }

    // Update vehicle details if available and not already set
    if (!vehicle?.vehicle_make && vehicleMake) {
      updateData.vehicle_make = vehicleMake;
    }
    if (!vehicle?.vehicle_model && vehicleModel) {
      updateData.vehicle_model = vehicleModel;
    }
    if (!vehicle?.vehicle_year && vehicleYear) {
      updateData.vehicle_year = vehicleYear;
    }

    const { error: updateError } = await supabaseClient
      .from('canonical_vehicles')
      .update(updateData)
      .eq('plate_number', plateNumber);

    if (updateError) {
      console.error('❌ Failed to update canonical_vehicles:', updateError);
    }

    // Check for mismatch between officer observation and NZSCV
    let mismatchDetected = false;
    let mismatchMessage = null;

    if (observedSelfContained !== undefined && observedSelfContained !== isCertified) {
      mismatchDetected = true;
      if (observedSelfContained && !isCertified) {
        mismatchMessage = `⚠️ Officer observed self-contained sticker, but vehicle is NOT certified in NZSCV database`;
      } else {
        mismatchMessage = `⚠️ Vehicle IS certified in NZSCV database, but officer did not observe self-contained sticker`;
      }
      console.warn(mismatchMessage);
    }

    return new Response(
      JSON.stringify({
        success: true,
        result,
        mismatch_detected: mismatchDetected,
        mismatch_message: mismatchMessage,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error in check-nzscv-status:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error',
        success: false,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
