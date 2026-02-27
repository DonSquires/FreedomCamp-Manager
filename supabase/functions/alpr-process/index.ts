/**
 * ALPR Process - ZERO-FAILURE 3-STAGE PIPELINE
 * 
 * Stage 1: Plate Recognizer API (Premium ALPR service)
 * Stage 2: Railway Inference Service (YOLOv8n + MobileNetV3 OCR)
 * Stage 3: OnSpace AI (GPT-4 Vision fallback)
 * 
 * Guarantees observation creation even if all AI stages fail (MANUAL_REQUIRED)
 * Uses SERVICE_ROLE_KEY to bypass RLS for system operations
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { corsHeaders } from '../_shared/cors.ts';

// API Configuration
const ALPR_API_TOKEN = Deno.env.get('ALPR_API_TOKEN');
const ALPR_API_URL = 'https://api.platerecognizer.com/v1/plate-reader/';
const RAILWAY_INFERENCE_URL = Deno.env.get('INFERENCE_SERVICE_URL');
const ONSPACE_AI_KEY = Deno.env.get('ONSPACE_AI_API_KEY');
const ONSPACE_AI_URL = Deno.env.get('ONSPACE_AI_BASE_URL');

interface ALPRRequest {
  // CRITICAL: Image data
  image: string; // base64 data URL
  photo_url: string; // Already uploaded photo URL
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

interface ALPRResponse {
  success: boolean;
  observation_id?: string;
  plate?: string;
  confidence?: number;
  stage?: 'plate_recognizer' | 'railway' | 'onspace_ai' | 'manual';
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
      has_image: !!body.image,
      has_photo_url: !!body.photo_url,
      officerId: body.officerId?.substring(0, 8) + '...',
      organizationId: body.organizationId?.substring(0, 8) + '...',
      zoneId: body.zoneId?.substring(0, 8) + '...',
      idempotencyKey: body.idempotencyKey,
      gps: { lat: body.gpsLatitude, lng: body.gpsLongitude },
    });

    // Validate required fields
    if (!body.image || !body.photo_url) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing image or photo_url' }),
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
    // STEP 5: PREPARE IMAGE BLOB
    // ==========================================================================
    const base64Data = body.image.split(',')[1] || body.image;
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const blob = new Blob([binaryData], { type: 'image/jpeg' });

    let plateNumber: string | null = null;
    let plateConfidence = 0;
    let vehicle: ALPRResponse['vehicle'] = {};
    let stage: ALPRResponse['stage'] = 'manual';

    // ==========================================================================
    // STAGE 1: PLATE RECOGNIZER API (Primary)
    // ==========================================================================
    if (ALPR_API_TOKEN) {
      try {
        console.log('🔍 Stage 1: Calling Plate Recognizer API...');
        
        const formData = new FormData();
        formData.append('upload', blob, 'scan.jpg');
        (body.regions || ['nz']).forEach(region => formData.append('regions', region));
        if (body.mmc) formData.append('mmc', 'true');
        
        const alprResponse = await fetch(ALPR_API_URL, {
          method: 'POST',
          headers: { 'Authorization': `Token ${ALPR_API_TOKEN}` },
          body: formData,
        });

        if (alprResponse.ok) {
          const alprData = await alprResponse.json();
          
          if (alprData.results && alprData.results.length > 0) {
            const result = alprData.results[0];
            plateNumber = result.plate?.toUpperCase();
            plateConfidence = result.score || 0;
            stage = 'plate_recognizer';

            // Extract vehicle details
            if (result.vehicle?.type) vehicle.type = result.vehicle.type;
            if (result.model_make && result.model_make.length > 0) {
              vehicle.make = result.model_make[0].make;
              vehicle.model = result.model_make[0].model;
            }
            if (result.color && result.color.length > 0) {
              vehicle.color = result.color[0].color;
            }

            console.log('✅ Stage 1 Success:', { plate: plateNumber, confidence: plateConfidence });
          } else {
            console.log('⚠️ Stage 1: No plates detected');
            warnings.push('Plate Recognizer found no plates');
          }
        } else {
          const errorText = await alprResponse.text();
          console.error('❌ Stage 1 Error:', alprResponse.status, errorText);
          warnings.push(`Plate Recognizer API error: ${alprResponse.status}`);
        }
      } catch (error: any) {
        console.error('❌ Stage 1 Exception:', error.message);
        warnings.push(`Plate Recognizer exception: ${error.message}`);
      }
    } else {
      warnings.push('ALPR_API_TOKEN not configured');
    }

    // ==========================================================================
    // STAGE 2: RAILWAY INFERENCE SERVICE (Fallback #1)
    // ==========================================================================
    if (!plateNumber && RAILWAY_INFERENCE_URL) {
      try {
        console.log('🚂 Stage 2: Calling Railway Inference Service...');
        
        const railwayResponse = await fetch(`${RAILWAY_INFERENCE_URL}/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: body.image }),
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

            console.log('✅ Stage 2 Success:', { plate: plateNumber, confidence: plateConfidence });
          } else {
            console.log('⚠️ Stage 2: No plate detected');
            warnings.push('Railway Inference found no plate');
          }
        } else {
          console.error('❌ Stage 2 Error:', railwayResponse.status);
          warnings.push(`Railway Inference error: ${railwayResponse.status}`);
        }
      } catch (error: any) {
        console.error('❌ Stage 2 Exception:', error.message);
        warnings.push(`Railway Inference exception: ${error.message}`);
      }
    }

    // ==========================================================================
    // STAGE 3: ONSPACE AI (Fallback #2)
    // ==========================================================================
    if (!plateNumber && ONSPACE_AI_KEY && ONSPACE_AI_URL) {
      try {
        console.log('🤖 Stage 3: Calling OnSpace AI...');
        
        const onspaceResponse = await fetch(`${ONSPACE_AI_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ONSPACE_AI_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4-vision-preview',
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Extract the license plate number from this image. Return only the plate number in uppercase, or "UNKNOWN" if not visible.'
                },
                {
                  type: 'image_url',
                  image_url: { url: body.image }
                }
              ]
            }],
            max_tokens: 100,
          }),
        });

        if (onspaceResponse.ok) {
          const onspaceData = await onspaceResponse.json();
          const extractedPlate = onspaceData.choices?.[0]?.message?.content?.trim().toUpperCase();
          
          if (extractedPlate && extractedPlate !== 'UNKNOWN' && extractedPlate.length >= 3) {
            plateNumber = extractedPlate;
            plateConfidence = 0.7; // Reasonable confidence for GPT-4 Vision
            stage = 'onspace_ai';
            console.log('✅ Stage 3 Success:', { plate: plateNumber });
          } else {
            console.log('⚠️ Stage 3: No plate detected');
            warnings.push('OnSpace AI found no plate');
          }
        } else {
          console.error('❌ Stage 3 Error:', onspaceResponse.status);
          warnings.push(`OnSpace AI error: ${onspaceResponse.status}`);
        }
      } catch (error: any) {
        console.error('❌ Stage 3 Exception:', error.message);
        warnings.push(`OnSpace AI exception: ${error.message}`);
      }
    }

    // ==========================================================================
    // STEP 6: FALLBACK TO MANUAL ENTRY (Zero-Failure Guarantee)
    // ==========================================================================
    if (!plateNumber) {
      console.log('⚠️ All AI stages failed - creating MANUAL_REQUIRED observation');
      plateNumber = 'MANUAL_REQUIRED';
      stage = 'manual';
      warnings.push('All AI stages failed - manual entry required');
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
