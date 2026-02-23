/**
 * ALPR Process - Complete Vehicle Observation Pipeline
 * 
 * Unified function that:
 * 1. Calls ParkPow ALPR API to recognize plate
 * 2. Creates observation in database
 * 3. Evaluates compliance
 * 4. Returns complete result
 * 
 * Uses SERVICE_ROLE_KEY to bypass RLS for system operations
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { corsHeaders } from '../_shared/cors.ts';

// Get API token from Supabase secrets
// ALPR_API_TOKEN = Snapshot Cloud API Token for Plate Recognizer
const ALPR_API_TOKEN = Deno.env.get('ALPR_API_TOKEN');
const ALPR_API_URL = 'https://api.platerecognizer.com/v1/plate-reader/';

if (!ALPR_API_TOKEN) {
  console.error('❌ ALPR_API_TOKEN not configured in Supabase secrets');
}

interface ALPRRequest {
  image: string; // base64 data URL
  photo_url: string; // Already uploaded photo URL
  photo_hash: string; // SHA-256 hash of photo
  regions?: string[]; // Country/state codes
  camera_id?: string; // Zone ID
  mmc?: boolean; // Vehicle Make, Model, Color
  
  // Observation metadata
  gpsLatitude: number;
  gpsLongitude: number;
  gpsAccuracy?: number;
  recordedAt: string;
  officerId: string;
  organizationId: string;
  zoneId: string;
  idempotencyKey: string;
  officerNotes?: string;
  weatherConditions?: string;
}

interface ALPRResponse {
  success: boolean;
  observation_id?: string;
  plate?: string;
  confidence?: number;
  region?: string;
  vehicle?: {
    type?: string;
    make?: string;
    model?: string;
    color?: string;
  };
  is_compliant?: boolean;
  is_flagged?: boolean;
  requires_manual_entry?: boolean;
  error?: string;
  raw_response?: any;
}

async function sha256Hash(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const requestBody: ALPRRequest = await req.json();
    const {
      image,
      photo_url,
      photo_hash,
      regions = ['nz'],
      camera_id,
      mmc = true,
      gpsLatitude,
      gpsLongitude,
      gpsAccuracy,
      recordedAt,
      officerId,
      organizationId,
      zoneId,
      idempotencyKey,
      officerNotes,
      weatherConditions,
    } = requestBody;

    // Validate required fields
    if (!image) {
      return new Response(
        JSON.stringify({ success: false, error: 'Image data required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!photo_url || !photo_hash) {
      return new Response(
        JSON.stringify({ success: false, error: 'Photo must be uploaded before ALPR processing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!officerId || !organizationId || !zoneId || !idempotencyKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required observation metadata' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!gpsLatitude || !gpsLongitude) {
      return new Response(
        JSON.stringify({ success: false, error: 'GPS coordinates required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with SERVICE_ROLE_KEY to bypass RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('🔍 ALPR Request:', {
      regions,
      zone_id: zoneId,
      officer_id: officerId,
      idempotency: idempotencyKey,
      mmc,
    });

    // Check for duplicate observation (idempotency)
    const { data: existingObs } = await supabase
      .from('observations')
      .select('id, plate_number, is_compliant')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingObs) {
      console.log('⚠️ Duplicate observation detected:', idempotencyKey);
      return new Response(
        JSON.stringify({
          success: true,
          duplicate: true,
          observation_id: existingObs.id,
          plate: existingObs.plate_number,
          is_compliant: existingObs.is_compliant,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert base64 data URL to blob
    const base64Data = image.split(',')[1] || image;
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const blob = new Blob([binaryData], { type: 'image/jpeg' });

    // Prepare multipart form data
    const formData = new FormData();
    formData.append('upload', blob, 'scan.jpg');
    
    // Add regions
    regions.forEach(region => {
      formData.append('regions', region);
    });

    // Add camera ID if provided
    if (camera_id) {
      formData.append('camera_id', camera_id);
    }

    // Enable Make/Model/Color recognition
    if (mmc) {
      formData.append('mmc', 'true');
    }

    // Configure for New Zealand and strict detection
    formData.append('config', JSON.stringify({
      region: 'strict', // Only accept valid NZ plate formats
      detection_rule: 'strict', // Must include a vehicle
    }));

    console.log('📡 Calling Plate Recognizer API...');

    if (!ALPR_API_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'ALPR_API_TOKEN not configured. Please add it to Supabase Edge Function secrets.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Plate Recognizer API
    const response = await fetch(ALPR_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${ALPR_API_TOKEN}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Plate Recognizer API error:', response.status, errorText);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: `Plate Recognizer API error: ${response.status} - ${errorText}`,
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('📊 Plate Recognizer response:', JSON.stringify(data, null, 2));

    // Parse response
    if (!data.results || data.results.length === 0) {
      console.log('⚠️ No plates detected - creating observation for manual entry');
      
      // Create observation without plate for manual entry
      const { data: observation, error: obsError } = await supabase
        .from('observations')
        .insert({
          idempotency_key: idempotencyKey,
          plate_number: 'MANUAL_REQUIRED',
          photo_url,
          photo_hash,
          recorded_at: recordedAt,
          zone_id: zoneId,
          organization_id: organizationId,
          gps_latitude: gpsLatitude,
          gps_longitude: gpsLongitude,
          gps_accuracy: gpsAccuracy || null,
          recorded_by: officerId,
          officer_notes: officerNotes || null,
          weather_conditions: weatherConditions || null,
          is_compliant: true,
        })
        .select('id')
        .single();

      if (obsError) {
        console.error('❌ Failed to create observation:', obsError);
      }

      return new Response(
        JSON.stringify({
          success: true,
          observation_id: observation?.id,
          plate: null,
          requires_manual_entry: true,
          error: 'No license plate detected in image',
          raw_response: data,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get first (best) result
    const result = data.results[0];

    // Extract vehicle details
    const vehicle: ALPRResponse['vehicle'] = {
      type: result.vehicle?.type || 'Unknown',
    };

    // Extract make/model/color if available (requires mmc=true)
    if (result.model_make && result.model_make.length > 0) {
      vehicle.make = result.model_make[0].make;
      vehicle.model = result.model_make[0].model;
    }

    if (result.color && result.color.length > 0) {
      vehicle.color = result.color[0].color;
    }

    const plateNumber = result.plate.toUpperCase();
    const plateConfidence = result.score;

    console.log('✅ ALPR Success:', {
      plate: plateNumber,
      confidence: plateConfidence,
      vehicle,
    });

    // ====================================================================
    // CREATE OBSERVATION IN DATABASE
    // ====================================================================

    // Get or create canonical vehicle
    let isFlagged = false;
    if (plateNumber) {
      const { data: existingVehicle } = await supabase
        .from('canonical_vehicles')
        .select('is_flagged')
        .eq('plate_number', plateNumber)
        .maybeSingle();

      if (existingVehicle) {
        isFlagged = existingVehicle.is_flagged;
      } else {
        // Create canonical vehicle
        const { error: vehicleError } = await supabase
          .from('canonical_vehicles')
          .insert({
            plate_number: plateNumber,
            make: vehicle.make || null,
            model: vehicle.model || null,
            colour: vehicle.color || null,
            first_seen_at: recordedAt,
            last_seen_at: recordedAt,
            total_observations: 1,
          });

        if (vehicleError) {
          console.error('⚠️ Failed to create canonical vehicle:', vehicleError);
        } else {
          console.log('✅ Created canonical vehicle:', plateNumber);
        }
      }
    }

    // Insert observation
    const observationData = {
      idempotency_key: idempotencyKey,
      plate_number: plateNumber,
      photo_url,
      photo_hash,
      recorded_at: recordedAt,
      zone_id: zoneId,
      organization_id: organizationId,
      gps_latitude: gpsLatitude,
      gps_longitude: gpsLongitude,
      gps_accuracy: gpsAccuracy || null,
      recorded_by: officerId,
      officer_notes: officerNotes || null,
      weather_conditions: weatherConditions || null,
      vehicle_make: vehicle.make || null,
      vehicle_model: vehicle.model || null,
      vehicle_color: vehicle.color || null,
      // Compliance will be calculated by database triggers
      is_compliant: true,
      breach_type: null,
      breach_reason: null,
    };

    const { data: observation, error: obsError } = await supabase
      .from('observations')
      .insert(observationData)
      .select('id, plate_number, is_compliant, breach_type')
      .single();

    if (obsError) {
      console.error('❌ Failed to create observation:', obsError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to create observation: ' + obsError.message,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Observation created:', observation.id);

    // Return complete response
    const alprResponse: ALPRResponse = {
      success: true,
      observation_id: observation.id,
      plate: plateNumber,
      confidence: plateConfidence,
      region: result.region?.code || 'nz',
      vehicle,
      is_compliant: observation.is_compliant,
      is_flagged: isFlagged,
      requires_manual_entry: false,
      raw_response: data,
    };

    return new Response(
      JSON.stringify(alprResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ ALPR processing failed:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
