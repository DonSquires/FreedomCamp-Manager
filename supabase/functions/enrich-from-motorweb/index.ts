/**
 * enrich-from-motorweb Edge Function
 * Scrapes NZ Motorweb database for vehicle details
 * API: https://www.motorweb.co.nz/pub/
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface MotorwebRequest {
  plateNumber: string;
  vehicleId?: string; // canonical_vehicles.plate_number (if enriching existing record)
  updateDatabase?: boolean; // Auto-update canonical_vehicles if true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { plateNumber, vehicleId, updateDatabase = true }: MotorwebRequest = await req.json();

    if (!plateNumber) {
      return new Response(
        JSON.stringify({ error: 'plateNumber is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedPlate = plateNumber.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
    console.log(`🔍 Checking Motorweb for ${normalizedPlate}...`);

    // Motorweb URL pattern
    const motorwebUrl = `https://www.motorweb.co.nz/pub/?plate=${encodeURIComponent(normalizedPlate)}`;
    console.log(`📡 Fetching: ${motorwebUrl}`);

    // Fetch Motorweb page
    const response = await fetch(motorwebUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FreedomCampBot/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Motorweb returned ${response.status}`);
    }

    const html = await response.text();

    // Parse HTML for vehicle details (Motorweb structure)
    const makeMatch = html.match(/<td[^>]*>Make<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
    const modelMatch = html.match(/<td[^>]*>Model<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
    const yearMatch = html.match(/<td[^>]*>Year<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
    const colorMatch = html.match(/<td[^>]*>Colour<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
    const typeMatch = html.match(/<td[^>]*>Type<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);

    const vehicleData = {
      plateNumber: normalizedPlate,
      make: makeMatch?.[1]?.trim() || null,
      model: modelMatch?.[1]?.trim() || null,
      year: yearMatch?.[1] ? parseInt(yearMatch[1].trim()) : null,
      color: colorMatch?.[1]?.trim() || null,
      vehicleType: typeMatch?.[1]?.trim() || null,
      source: 'motorweb',
      scrapedAt: new Date().toISOString(),
    };

    console.log('📊 Motorweb data:', vehicleData);

    // If no data found
    if (!vehicleData.make && !vehicleData.model) {
      console.log('⚠️ No vehicle data found in Motorweb');
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Vehicle not found in Motorweb database',
          plateNumber: normalizedPlate,
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update database if requested
    if (updateDatabase) {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Update canonical_vehicles
      const { error: updateError } = await supabaseAdmin
        .from('canonical_vehicles')
        .update({
          vehicle_make: vehicleData.make,
          vehicle_model: vehicleData.model,
          vehicle_year: vehicleData.year,
          vehicle_color: vehicleData.color,
          nzscv_source: 'motorweb',
          nzscv_last_checked: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('plate_number', normalizedPlate);

      if (updateError) {
        console.error('Failed to update database:', updateError);
        throw updateError;
      }

      console.log(`✅ Updated canonical_vehicles for ${normalizedPlate}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle: vehicleData,
        updated: updateDatabase,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Motorweb enrichment failed:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to enrich from Motorweb',
        message: error.message,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
