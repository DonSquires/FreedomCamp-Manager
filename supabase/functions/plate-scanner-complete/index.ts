/**
 * PLATE SCANNER - COMPLETE WORKFLOW
 * 
 * Brand new Edge Function built from scratch for Plate Scanner.
 * Handles entire workflow in one function to avoid dependency issues.
 * 
 * Workflow:
 * 1. Upload photo to storage (RETAIN FIRST)
 * 2. ALPR recognition via Plate Recognizer API
 * 3. Get/create canonical vehicle
 * 4. Create observation in vehicle_observations_v2
 * 5. Evaluate compliance (auto-creates compliance_results via trigger)
 * 6. Check flagged status
 * 7. Return complete result
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScanRequest {
  image: string; // base64
  zoneId: string;
  organizationId: string;
  userId: string;
  gpsLocation?: {
    lat: number;
    lng: number;
    accuracy: number;
  };
  patrolId?: string;
}

interface ScanResponse {
  success: boolean;
  observation_id?: string;
  plate_number?: string;
  is_flagged?: boolean;
  is_compliant?: boolean;
  is_homeless?: boolean;
  at_risk?: boolean;
  alerts?: string[];
  error?: string;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ============================================================
    // STEP 1: Initialize Supabase clients
    // ============================================================
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ============================================================
    // STEP 2: Parse request body
    // ============================================================
    
    const body: ScanRequest = await req.json();
    const { image, zoneId, organizationId, userId, gpsLocation, patrolId } = body;

    console.log('📸 Plate Scanner - New scan request:', {
      zoneId,
      organizationId,
      userId,
      hasGPS: !!gpsLocation,
      patrolId,
    });

    // Validate required fields
    if (!image || !zoneId || !organizationId || !userId) {
      throw new Error('Missing required fields: image, zoneId, organizationId, userId');
    }

    // ============================================================
    // STEP 3: Upload photo to storage (RETAIN FIRST)
    // ============================================================
    
    console.log('📤 Step 1/7: Uploading photo to storage...');
    
    // Convert base64 to blob
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    const fileName = `plate-scanner/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
    
    const { error: uploadError } = await supabase.storage
      .from('evidence')
      .upload(fileName, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      console.error('❌ Upload failed:', uploadError);
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('evidence')
      .getPublicUrl(fileName);

    console.log('✅ Photo uploaded:', publicUrl);

    // ============================================================
    // STEP 4: ALPR Recognition via Plate Recognizer API
    // ============================================================
    
    console.log('🔍 Step 2/7: Running ALPR...');
    
    const plateRecognizerApiKey = Deno.env.get('PLATE_RECOGNIZER_API_KEY');
    if (!plateRecognizerApiKey) {
      throw new Error('PLATE_RECOGNIZER_API_KEY not configured');
    }

    const alprResponse = await fetch('https://api.platerecognizer.com/v1/plate-reader/', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${plateRecognizerApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        upload: image,
        regions: ['nz'],
        config: {
          region: 'strict',
          mode: 'fast',
        },
      }),
    });

    if (!alprResponse.ok) {
      const errorText = await alprResponse.text();
      console.error('❌ ALPR API error:', errorText);
      throw new Error(`ALPR API error: ${alprResponse.status} - ${errorText}`);
    }

    const alprData = await alprResponse.json();
    console.log('🔍 ALPR response:', JSON.stringify(alprData, null, 2));

    if (!alprData.results || alprData.results.length === 0) {
      throw new Error('No license plates detected in image');
    }

    // Get best result (highest confidence)
    const bestResult = alprData.results.reduce((best: any, current: any) => 
      (current.score > best.score ? current : best)
    );

    const plateNumber = bestResult.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const confidence = bestResult.score;
    
    console.log(`✅ Plate detected: ${plateNumber} (confidence: ${confidence})`);

    // Extract vehicle details if available
    const vehicleMake = bestResult.vehicle?.make?.[0]?.name || null;
    const vehicleModel = bestResult.vehicle?.model?.[0]?.name || null;
    const vehicleColor = bestResult.vehicle?.color?.[0]?.name || null;
    const vehicleYear = bestResult.vehicle?.year?.[0]?.name || null;

    // ============================================================
    // STEP 5: Get/Create Canonical Vehicle
    // ============================================================
    
    console.log('🚗 Step 3/7: Getting/creating canonical vehicle...');
    
    const { data: existingVehicle } = await supabase
      .from('canonical_vehicles')
      .select('*')
      .eq('plate_number', plateNumber)
      .single();

    if (!existingVehicle) {
      // Create new canonical vehicle
      const { error: createError } = await supabase
        .from('canonical_vehicles')
        .insert({
          plate_number: plateNumber,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          vehicle_color: vehicleColor,
          vehicle_year: vehicleYear ? parseInt(vehicleYear) : null,
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          total_observations: 1,
        });

      if (createError) {
        console.error('❌ Failed to create canonical vehicle:', createError);
        throw new Error(`Failed to create vehicle: ${createError.message}`);
      }

      console.log('✅ Created new canonical vehicle:', plateNumber);
    } else {
      // Update existing vehicle
      const { error: updateError } = await supabase
        .from('canonical_vehicles')
        .update({
          last_seen_at: new Date().toISOString(),
          total_observations: (existingVehicle.total_observations || 0) + 1,
          // Update vehicle details if new data is more complete
          vehicle_make: vehicleMake || existingVehicle.vehicle_make,
          vehicle_model: vehicleModel || existingVehicle.vehicle_model,
          vehicle_color: vehicleColor || existingVehicle.vehicle_color,
          vehicle_year: vehicleYear ? parseInt(vehicleYear) : existingVehicle.vehicle_year,
        })
        .eq('plate_number', plateNumber);

      if (updateError) {
        console.warn('⚠️ Failed to update canonical vehicle:', updateError);
      } else {
        console.log('✅ Updated canonical vehicle:', plateNumber);
      }
    }

    // Get latest canonical vehicle data (including flags)
    const { data: canonicalVehicle } = await supabase
      .from('canonical_vehicles')
      .select('*')
      .eq('plate_number', plateNumber)
      .single();

    // ============================================================
    // STEP 6: Create Observation in vehicle_observations_v2
    // ============================================================
    
    console.log('📝 Step 4/7: Creating observation...');
    
    const observationData = {
      plate_number: plateNumber,
      vehicle_make: vehicleMake || canonicalVehicle?.vehicle_make,
      vehicle_model: vehicleModel || canonicalVehicle?.vehicle_model,
      vehicle_year: vehicleYear ? parseInt(vehicleYear) : canonicalVehicle?.vehicle_year,
      vehicle_color: vehicleColor || canonicalVehicle?.vehicle_color,
      self_contained: false, // Plate Scanner doesn't detect this yet
      self_contained_expiry: null,
      photo: publicUrl,
      photo_hash: null, // Could implement SHA-256 hash
      gps_latitude: gpsLocation?.lat || null,
      gps_longitude: gpsLocation?.lng || null,
      gps_accuracy: gpsLocation?.accuracy || null,
      recorded_at: new Date().toISOString(),
      organization_id: organizationId,
      zone_id: zoneId,
      recorded_by: userId,
      officer_notes: `Scanned via Plate Scanner (ALPR confidence: ${Math.round(confidence * 100)}%)`,
      has_notes: false,
      notes_reference_previous: false,
      has_hs_incident: false,
      hs_incident_id: null,
      has_incident: false,
      incident_id: null,
      has_homeless_claim: false,
      homeless_claim_notes: null,
      breach_warning: false,
      breach_warning_reason: null,
    };

    const { data: observation, error: obsError } = await supabase
      .from('vehicle_observations_v2')
      .insert(observationData)
      .select()
      .single();

    if (obsError) {
      console.error('❌ Failed to create observation:', obsError);
      throw new Error(`Failed to create observation: ${obsError.message}`);
    }

    console.log('✅ Observation created:', observation.observation_id);

    // ============================================================
    // STEP 7: Wait for compliance_results (created by trigger)
    // ============================================================
    
    console.log('⏳ Step 5/7: Waiting for compliance evaluation...');
    
    // Wait up to 3 seconds for trigger to complete
    let complianceResult = null;
    let attempts = 0;
    const maxAttempts = 6; // 6 attempts × 500ms = 3 seconds
    
    while (attempts < maxAttempts && !complianceResult) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { data: result } = await supabase
        .from('compliance_results')
        .select('*')
        .eq('observation_id', observation.observation_id)
        .maybeSingle();
      
      if (result) {
        complianceResult = result;
        break;
      }
      
      attempts++;
    }

    if (!complianceResult) {
      console.warn('⚠️ Compliance result not found after 3 seconds - may still be processing');
      // Continue without compliance data - better to return partial result than fail
    } else {
      console.log('✅ Compliance evaluated:', {
        is_compliant: complianceResult.is_compliant,
        violations: complianceResult.violation_reasons,
      });
    }

    // ============================================================
    // STEP 8: Check breach alerts (created by trigger if non-compliant)
    // ============================================================
    
    console.log('🚨 Step 6/7: Checking breach alerts...');
    
    const { data: breachAlerts } = await supabase
      .from('breach_alerts')
      .select('*')
      .eq('observation_id', observation.observation_id)
      .eq('status', 'pending');

    const hasBreach = breachAlerts && breachAlerts.length > 0;
    
    if (hasBreach) {
      console.log(`🔴 Breach detected: ${breachAlerts.length} alerts created`);
    }

    // ============================================================
    // STEP 9: Build response
    // ============================================================
    
    console.log('📊 Step 7/7: Building response...');
    
    // Check if vehicle is flagged
    const isFlagged = canonicalVehicle?.is_flagged || false;
    
    // Check if homeless (FC Act exempt)
    const isHomeless = canonicalVehicle?.homeless_status === 'confirmed' || 
                      canonicalVehicle?.homeless_status === 'claimed';
    
    // Determine if at risk (1 night left before breach)
    const atRisk = complianceResult?.violation_reasons?.some((reason: string) => 
      reason.includes('final night') || 
      reason.includes('at risk') ||
      reason.includes('1 night')
    ) || false;

    // Build alerts array
    const alerts: string[] = [];
    
    if (isFlagged) {
      alerts.push(`🚩 FLAGGED VEHICLE: ${canonicalVehicle.flagged_reason || 'Watch list'}`);
    }
    
    if (isHomeless) {
      alerts.push('🏕️ Homeless vehicle - FC Act Exempt (no enforcement)');
    }
    
    if (hasBreach && !isHomeless) {
      const breachReasons = breachAlerts.map((alert: any) => 
        alert.breach_details?.message || `${alert.breach_type} violation`
      );
      alerts.push(...breachReasons.map((r: string) => `🔴 BREACH: ${r}`));
    }
    
    if (atRisk && !hasBreach) {
      alerts.push('🟡 AT RISK: Final night before breach - monitor closely');
    }
    
    if (!isFlagged && !hasBreach && !atRisk && complianceResult?.is_compliant) {
      alerts.push('✅ Compliant with zone requirements');
    }

    const response: ScanResponse = {
      success: true,
      observation_id: observation.observation_id,
      plate_number: plateNumber,
      is_flagged: isFlagged,
      is_compliant: complianceResult?.is_compliant ?? true,
      is_homeless: isHomeless,
      at_risk: atRisk,
      alerts,
    };

    console.log('✅ Scan complete:', response);

    return new Response(
      JSON.stringify(response),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error: any) {
    console.error('❌ Plate Scanner error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
      }),
      { 
        status: 500,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
