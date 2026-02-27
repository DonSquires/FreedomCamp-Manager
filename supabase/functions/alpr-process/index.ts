/**
 * ALPR Process - RAILWAY INFERENCE ONLY
 * 
 * Flow:
 * 1. Frontend uploads photo to /scans/{user_id}/ and gets public URL
 * 2. Frontend sends photo_url + metadata to this function
 * 3. Function downloads photo from URL
 * 4. Function sends to Railway Inference Service (YOLOv8n + MobileNetV3 OCR)
 * 5. Function creates observation in database
 * 
 * Stage 1: Railway Inference Service (Free, self-hosted, decent accuracy)
 * Stage 2: MANUAL_REQUIRED (Zero-failure guarantee)
 * 
 * Uses SERVICE_ROLE_KEY to bypass RLS for system operations
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { corsHeaders } from '../_shared/cors.ts';

// API Configuration
const RAILWAY_INFERENCE_URL = Deno.env.get('INFERENCE_SERVICE_URL');

interface ALPRRequest {
  // CRITICAL: Photo evidence (already uploaded)
  photo_url: string; // Public URL from Supabase Storage
  photo_hash?: string; // SHA-256 hash (will generate if missing)
  
  // CRITICAL: Identity fields
  officerId: string;
  organizationId: string;
  zoneId: string;
  idempotencyKey: string;
  
  // CRITICAL: GPS location
  gpsLatitude: number;
  gpsLongitude: number;
  gpsAccuracy?: number;
  
  // CRITICAL: Timestamp
  recordedAt: string;
  
  // OPTIONAL: Configuration
  regions?: string[];
  mmc?: boolean; // Make, Model, Color
  officerNotes?: string;
  weatherConditions?: string;
}

interface VehicleDetails {
  make?: string;
  model?: string;
  color?: string;
  type?: string;
}

interface ALPRResponse {
  success: boolean;
  observation_id?: string;
  plate?: string;
  confidence?: number;
  stage?: 'railway' | 'manual';
  vehicle?: {
    make?: string;
    model?: string;
    color?: string;
    type?: string;
  };
  is_compliant?: boolean;
  error?: string;
  warnings?: string[];
}

Deno.serve(async (req) => {
  // ============================================================================
  // STEP 1: CORS PREFLIGHT
  // ============================================================================
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestStartTime = Date.now();
  const warnings: string[] = [];

  try {
    // ==========================================================================
    // STEP 2: INITIALIZE SUPABASE CLIENT (SERVICE_ROLE for RLS bypass)
    // ==========================================================================
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ==========================================================================
    // STEP 3: VALIDATE REQUEST PAYLOAD
    // ==========================================================================
    const body: ALPRRequest = await req.json();

    console.log('📍 ALPR Request:', {
      photo_url: body.photo_url,
      officerId: body.officerId?.substring(0, 8) + '...',
      organizationId: body.organizationId?.substring(0, 8) + '...',
      zoneId: body.zoneId?.substring(0, 8) + '...',
      idempotencyKey: body.idempotencyKey,
      gps: { lat: body.gpsLatitude, lng: body.gpsLongitude },
    });

    // Validate required fields
    if (!body.photo_url) {
      return new Response(
        JSON.stringify({ success: false, error: 'photo_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!body.officerId || !body.organizationId || !body.zoneId || !body.idempotencyKey) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required identity fields',
          required: ['officerId', 'organizationId', 'zoneId', 'idempotencyKey']
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.gpsLatitude === undefined || body.gpsLongitude === undefined) {
      return new Response(
        JSON.stringify({ success: false, error: 'GPS coordinates required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate photo hash if not provided
    const photoHash = body.photo_hash || `sha256-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // ==========================================================================
    // STEP 4: CHECK FOR DUPLICATE (Idempotency)
    // ==========================================================================
    const { data: existingObs } = await supabase
      .from('observations')
      .select('id, plate_number, is_compliant')
      .eq('idempotency_key', body.idempotencyKey)
      .maybeSingle();

    if (existingObs) {
      console.log('⚠️ Duplicate observation detected:', body.idempotencyKey);
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

    // ==========================================================================
    // STEP 5: DOWNLOAD PHOTO FROM STORAGE
    // ==========================================================================
    console.log('📥 Downloading photo from:', body.photo_url);
    
    const photoResponse = await fetch(body.photo_url);
    if (!photoResponse.ok) {
      throw new Error(`Failed to download photo: ${photoResponse.status}`);
    }
    
    const photoBlob = await photoResponse.blob();
    console.log('✅ Photo downloaded:', {
      size_bytes: photoBlob.size,
      type: photoBlob.type
    });

    let plateNumber: string | null = null;
    let plateConfidence = 0;
    let vehicle: ALPRResponse['vehicle'] = {};
    let stage: ALPRResponse['stage'] = 'manual';

    // ==========================================================================
    // STAGE 1: RAILWAY INFERENCE SERVICE (Primary - Self-Hosted)
    // ==========================================================================
    if (RAILWAY_INFERENCE_URL) {
      try {
        console.log('🚂 Stage 1: Railway Inference Service...');
        
        // Convert blob to base64 for Railway
        const arrayBuffer = await photoBlob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        const imageDataUrl = `data:image/jpeg;base64,${base64}`;
        
        const railwayResponse = await fetch(`${RAILWAY_INFERENCE_URL}/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageDataUrl }),
        });

        if (railwayResponse.ok) {
          const railwayData = await railwayResponse.json();
          
          if (railwayData.plate && railwayData.plate !== 'UNKNOWN') {
            plateNumber = railwayData.plate.toUpperCase();
            plateConfidence = railwayData.confidence || 0.5;
            stage = 'railway';

            if (railwayData.vehicle) {
              vehicle = {
                make: railwayData.vehicle.make,
                model: railwayData.vehicle.model,
                color: railwayData.vehicle.color,
                type: railwayData.vehicle.type,
              };
            }

            console.log('✅ Stage 1 Success:', { plate: plateNumber, confidence: plateConfidence });
          } else {
            console.log('⚠️ Stage 1: No plate detected');
            warnings.push('Railway Inference found no plate');
          }
        } else {
          console.error('❌ Stage 1 Error:', railwayResponse.status);
          warnings.push(`Railway Inference error: ${railwayResponse.status}`);
        }
      } catch (error: any) {
        console.error('❌ Stage 1 Exception:', error.message);
        warnings.push(`Railway Inference exception: ${error.message}`);
      }
    } else {
      warnings.push('INFERENCE_SERVICE_URL not configured');
    }

    // ==========================================================================
    // STAGE 2: FALLBACK TO MANUAL ENTRY (Zero-Failure Guarantee)
    // ==========================================================================
    if (!plateNumber) {
      console.log('⚠️ Railway Inference failed - creating MANUAL_REQUIRED observation');
      plateNumber = 'MANUAL_REQUIRED';
      stage = 'manual';
      warnings.push('AI detection failed - manual plate entry required');
    }

    // ==========================================================================
    // STEP 7: CREATE OBSERVATION (WITH ALL REQUIRED FIELDS)
    // ==========================================================================
    const observationData = {
      // CRITICAL: Identity & RLS validation
      idempotency_key: body.idempotencyKey,
      recorded_by: body.officerId,
      organization_id: body.organizationId,
      zone_id: body.zoneId,
      
      // CRITICAL: Photo evidence
      photo_url: body.photo_url,
      photo_hash: photoHash,
      
      // CRITICAL: Vehicle identification
      plate_number: plateNumber,
      
      // CRITICAL: GPS location
      gps_latitude: body.gpsLatitude,
      gps_longitude: body.gpsLongitude,
      gps_accuracy: body.gpsAccuracy || null,
      
      // CRITICAL: Timestamp
      recorded_at: body.recordedAt || new Date().toISOString(),
      
      // OPTIONAL: Metadata
      officer_notes: body.officerNotes || null,
      weather_conditions: body.weatherConditions || null,
      vehicle_make: vehicle.make || null,
      vehicle_model: vehicle.model || null,
      vehicle_color: vehicle.color || null, // CORRECT: vehicle_color (not colour)
      
      // COMPLIANCE: Calculated by triggers
      is_compliant: true,
      breach_type: null,
      breach_reason: null,
    };

    console.log('💾 Creating observation:', {
      plate: observationData.plate_number,
      stage,
      has_all_required_fields: !!(
        observationData.idempotency_key &&
        observationData.plate_number &&
        observationData.photo_url &&
        observationData.photo_hash &&
        observationData.recorded_at &&
        observationData.zone_id &&
        observationData.organization_id &&
        observationData.gps_latitude !== undefined &&
        observationData.gps_longitude !== undefined &&
        observationData.recorded_by
      ),
    });

    const { data: observation, error: obsError } = await supabase
      .from('observations')
      .insert(observationData)
      .select('id, plate_number, is_compliant, breach_type')
      .single();

    if (obsError) {
      console.error('❌ Database INSERT failed:', obsError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Database error: ' + obsError.message,
          code: obsError.code,
          hint: obsError.hint,
          details: obsError.details,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================================================
    // STEP 8: SUCCESS RESPONSE
    // ==========================================================================
    const responseTime = Date.now() - requestStartTime;
    
    console.log('✅ Observation created:', {
      id: observation.id,
      plate: observation.plate_number,
      stage,
      response_time_ms: responseTime
    });

    const response: ALPRResponse = {
      success: true,
      observation_id: observation.id,
      plate: plateNumber,
      confidence: plateConfidence,
      stage,
      vehicle,
      is_compliant: observation.is_compliant,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ ALPR Pipeline Failed:', error);
    
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
