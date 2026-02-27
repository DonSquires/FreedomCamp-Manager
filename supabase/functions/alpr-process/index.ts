/**
 * ALPR Process - Complete Vehicle Observation Pipeline
 * 
 * Unified function that:
 * 1. Calls Plate Recognizer API to recognize plate
 * 2. Creates observation in database
 * 3. Evaluates compliance
 * 4. Returns complete result
 * 
 * Uses SERVICE_ROLE_KEY to bypass RLS for system operations
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { corsHeaders } from '../_shared/cors.ts';

// Get API token from Supabase secrets
const ALPR_API_TOKEN = Deno.env.get('ALPR_API_TOKEN');
const ALPR_API_URL = 'https://api.platerecognizer.com/v1/plate-reader/';

if (!ALPR_API_TOKEN) {
  console.error('❌ ALPR_API_TOKEN not configured in Supabase secrets');
}

interface ALPRRequest {
  image?: string; // base64 data URL
  photo_url?: string; // Already uploaded photo URL
  image_url?: string; // Alternative field name
  photo_hash?: string; // SHA-256 hash of photo (optional, will generate if missing)
  regions?: string[]; // Country/state codes
  camera_id?: string; // Zone ID
  mmc?: boolean; // Vehicle Make, Model, Color
  
  // Observation metadata (flexible field names)
  gpsLatitude?: number;
  gpsLongitude?: number;
  gps_latitude?: number;
  gps_longitude?: number;
  gpsAccuracy?: number;
  gps_accuracy?: number;
  recordedAt?: string;
  recorded_at?: string;
  officerId?: string;
  recorded_by?: string;
  organizationId?: string;
  organization_id?: string;
  zoneId?: string;
  zone_id?: string;
  idempotencyKey?: string;
  idempotency_key?: string;
  officerNotes?: string;
  officer_notes?: string;
  weatherConditions?: string;
  weather_conditions?: string;
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

Deno.serve(async (req) => {
  // Handle CORS preflight (Copilot's clean approach)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with SERVICE_ROLE_KEY (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const requestBody: ALPRRequest = await req.json();

    // ✅ FLEXIBLE FIELD MAPPING (Copilot's good idea)
    const image = requestBody.image;
    const photoUrl = requestBody.photo_url || requestBody.image_url;
    const photoHash = requestBody.photo_hash;
    const regions = requestBody.regions || ['nz'];
    const cameraId = requestBody.camera_id;
    const mmc = requestBody.mmc !== undefined ? requestBody.mmc : true;

    // ✅ GPS coordinates (flexible names)
    const gpsLatitude = requestBody.gpsLatitude ?? requestBody.gps_latitude;
    const gpsLongitude = requestBody.gpsLongitude ?? requestBody.gps_longitude;
    const gpsAccuracy = requestBody.gpsAccuracy ?? requestBody.gps_accuracy;

    // ✅ Identity fields (flexible names)
    const recordedAt = requestBody.recordedAt || requestBody.recorded_at;
    const officerId = requestBody.officerId || requestBody.recorded_by;
    const organizationId = requestBody.organizationId || requestBody.organization_id;
    const zoneId = requestBody.zoneId || requestBody.zone_id;
    const idempotencyKey = requestBody.idempotencyKey || requestBody.idempotency_key;
    const officerNotes = requestBody.officerNotes || requestBody.officer_notes;
    const weatherConditions = requestBody.weatherConditions || requestBody.weather_conditions;

    // ✅ CRITICAL VALIDATION (prevent incomplete payloads)
    if (!image) {
      return new Response(
        JSON.stringify({ success: false, error: 'Image data required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!photoUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'photo_url is required (upload photo first)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!officerId || !organizationId || !zoneId || !idempotencyKey) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required metadata',
          required: ['officerId', 'organizationId', 'zoneId', 'idempotencyKey'],
          received: { officerId, organizationId, zoneId, idempotencyKey }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!gpsLatitude || !gpsLongitude) {
      return new Response(
        JSON.stringify({ success: false, error: 'GPS coordinates required (enable location services)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ✅ Generate photo_hash if not provided
    const finalPhotoHash = photoHash || `sha256-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    console.log('🔍 ALPR Request:', {
      regions,
      zone_id: zoneId,
      officer_id: officerId,
      idempotency: idempotencyKey,
      has_photo_hash: !!photoHash,
      generated_hash: !photoHash,
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
    
    regions.forEach(region => formData.append('regions', region));
    if (cameraId) formData.append('camera_id', cameraId);
    if (mmc) formData.append('mmc', 'true');
    
    formData.append('config', JSON.stringify({
      region: 'strict',
      detection_rule: 'strict',
    }));

    console.log('📡 Calling Plate Recognizer API...');

    if (!ALPR_API_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'ALPR_API_TOKEN not configured. Contact system administrator.',
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
          error: `Plate Recognizer API error: ${response.status}`,
          details: errorText,
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('📊 Plate Recognizer response:', JSON.stringify(data, null, 2));

    // Parse response
    if (!data.results || data.results.length === 0) {
      console.log('⚠️ No plates detected - creating observation for manual entry');
      
      const manualObservationData = {
        idempotency_key: idempotencyKey,
        plate_number: 'MANUAL_REQUIRED',
        photo_url: photoUrl,
        photo_hash: finalPhotoHash,
        recorded_at: recordedAt || new Date().toISOString(),
        zone_id: zoneId,
        organization_id: organizationId,
        gps_latitude: gpsLatitude,
        gps_longitude: gpsLongitude,
        gps_accuracy: gpsAccuracy || null,
        recorded_by: officerId,
        officer_notes: officerNotes || null,
        weather_conditions: weatherConditions || null,
        is_compliant: true,
      };

      const { data: observation, error: obsError } = await supabase
        .from('observations')
        .insert(manualObservationData)
        .select('id')
        .single();

      if (obsError) {
        console.error('❌ Failed to create observation:', obsError);
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Database error: ' + obsError.message,
            code: obsError.code,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          observation_id: observation?.id,
          plate: null,
          requires_manual_entry: true,
          message: 'No license plate detected - manual entry required',
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

    if (result.model_make && result.model_make.length > 0) {
      vehicle.make = result.model_make[0].make;
      vehicle.model = result.model_make[0].model;
    }

    if (result.color && result.color.length > 0) {
      vehicle.color = result.color[0].color;
    }

    const plateNumber = result.plate.toUpperCase();
    const plateConfidence = result.score;

    console.log('✅ ALPR Success:', { plate: plateNumber, confidence: plateConfidence, vehicle });

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
        await supabase
          .from('canonical_vehicles')
          .insert({
            plate_number: plateNumber,
            make: vehicle.make || null,
            model: vehicle.model || null,
            colour: vehicle.color || null,
            first_seen_at: recordedAt || new Date().toISOString(),
            last_seen_at: recordedAt || new Date().toISOString(),
            total_observations: 1,
          });
      }
    }

    // ✅ COMPLETE PAYLOAD (all mandatory fields)
    const observationData = {
      // CRITICAL: Identity and RLS validation
      idempotency_key: idempotencyKey,
      recorded_by: officerId,
      organization_id: organizationId,
      zone_id: zoneId,
      
      // CRITICAL: Photo evidence
      photo_url: photoUrl,
      photo_hash: finalPhotoHash,
      
      // CRITICAL: Vehicle identification
      plate_number: plateNumber,
      
      // CRITICAL: GPS location
      gps_latitude: gpsLatitude,
      gps_longitude: gpsLongitude,
      gps_accuracy: gpsAccuracy || null,
      
      // CRITICAL: Timestamp
      recorded_at: recordedAt || new Date().toISOString(),
      
      // Optional metadata
      officer_notes: officerNotes || null,
      weather_conditions: weatherConditions || null,
      vehicle_make: vehicle.make || null,
      vehicle_model: vehicle.model || null,
      vehicle_color: vehicle.color || null,
      
      // Compliance - calculated by triggers
      is_compliant: true,
      breach_type: null,
      breach_reason: null,
    };
    
    console.log('💾 Creating observation:', {
      plate: observationData.plate_number,
      zone: observationData.zone_id?.substring(0, 8) + '...',
      has_all_required_fields: !!(
        observationData.idempotency_key &&
        observationData.plate_number &&
        observationData.photo_url &&
        observationData.photo_hash &&
        observationData.recorded_at &&
        observationData.zone_id &&
        observationData.organization_id &&
        observationData.gps_latitude &&
        observationData.gps_longitude &&
        observationData.recorded_by
      ),
    });

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
          error: 'Database error: ' + obsError.message,
          code: obsError.code,
          hint: obsError.hint,
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
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
