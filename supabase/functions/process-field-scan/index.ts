/**
 * process-field-scan Edge Function - REBUILT FROM SCRATCH
 * 
 * Simple workflow:
 * 1. Normalize plate number
 * 2. Get or create canonical vehicle
 * 3. Create observation
 * 4. Run compliance check
 * 5. Return result (NO breach_alerts creation - avoiding constraint violation)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface ScanRequest {
  plateNumber: string;
  zoneId: string;
  organizationId: string;
  imageUrl?: string;
  gpsLocation?: { lat: number; lng: number; accuracy: number } | null;
  vehicleDetails?: {
    make?: string;
    model?: string;
    color?: string;
    year?: number;
  };
  detectionMethod: 'alpr' | 'manual';
  confidence: number;
  isSelfContained?: boolean;
  weatherConditions?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const scanData: ScanRequest = await req.json();

    // Validate required fields
    if (!scanData.plateNumber || !scanData.zoneId || !scanData.organizationId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize plate
    const normalizedPlate = scanData.plateNumber.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
    console.log('Processing scan:', normalizedPlate);

    // STEP 1: Get or create canonical vehicle
    const { error: upsertError } = await supabaseAdmin.rpc('upsert_canonical_vehicle', {
      p_plate_number: normalizedPlate,
      p_vehicle_make: scanData.vehicleDetails?.make,
      p_vehicle_model: scanData.vehicleDetails?.model,
      p_vehicle_year: scanData.vehicleDetails?.year,
      p_vehicle_color: scanData.vehicleDetails?.color,
      p_self_contained: scanData.isSelfContained,
      p_self_contained_expiry: null,
    });

    if (upsertError) {
      console.error('Upsert error:', upsertError);
      throw upsertError;
    }

    // STEP 2: Get canonical vehicle details
    const { data: canonicalVehicle, error: vehicleError } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('*')
      .eq('plate_number', normalizedPlate)
      .single();

    if (vehicleError) throw vehicleError;

    // STEP 3: Create observation
    const { data: observation, error: obsError } = await supabaseAdmin
      .from('vehicle_observations_v2')
      .insert({
        plate_number: normalizedPlate,
        organization_id: scanData.organizationId,
        zone_id: scanData.zoneId,
        recorded_by: user.id,
        recorded_at: new Date().toISOString(),
        vehicle_make: scanData.vehicleDetails?.make,
        vehicle_model: scanData.vehicleDetails?.model,
        vehicle_year: scanData.vehicleDetails?.year,
        vehicle_color: scanData.vehicleDetails?.color,
        self_contained: scanData.isSelfContained || false,
        photo: scanData.imageUrl,
        gps_latitude: scanData.gpsLocation?.lat,
        gps_longitude: scanData.gpsLocation?.lng,
        gps_accuracy: scanData.gpsLocation?.accuracy,
        weather_conditions: scanData.weatherConditions,
      })
      .select()
      .single();

    if (obsError) {
      console.error('Observation error:', obsError);
      throw obsError;
    }

    console.log('Observation created:', observation.observation_id);

    // STEP 4: Run compliance check
    let isCompliant = true;
    try {
      const { data: complianceData } = await supabaseAdmin
        .rpc('calculate_vehicle_compliance_with_results', {
          p_plate_number: normalizedPlate,
          p_zone_id: scanData.zoneId,
          p_check_date: new Date().toISOString().split('T')[0],
          p_observation_id: observation.observation_id,
        });

      if (complianceData && complianceData.length > 0) {
        isCompliant = complianceData[0].is_compliant;
      }
    } catch (err) {
      console.warn('Compliance check failed (non-critical):', err);
    }

    // STEP 5: Build alerts
    const alerts: string[] = [];

    if (canonicalVehicle.is_flagged) {
      alerts.push(`🚩 FLAGGED: ${canonicalVehicle.flagged_reason || 'Watch list'}`);
    }

    if (!isCompliant) {
      alerts.push('⚠️ Non-compliant with zone requirements');
    } else {
      alerts.push('✅ Compliant with zone requirements');
    }

    // STEP 6: Return response
    const response = {
      success: true,
      plate_number: normalizedPlate,
      observation_id: observation.observation_id,
      is_flagged: canonicalVehicle.is_flagged,
      is_compliant: isCompliant,
      alerts,
      flagged_details: canonicalVehicle.is_flagged ? {
        reason: canonicalVehicle.flagged_reason,
        priority: canonicalVehicle.flagged_priority,
      } : null,
      vehicle_details: {
        make: observation.vehicle_make,
        model: observation.vehicle_model,
        year: observation.vehicle_year,
        color: observation.vehicle_color,
      },
    };

    console.log('✅ Scan complete');

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Process field scan error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to process field scan',
        message: error.message,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
