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
  // MODE 1: Update existing observation (Background Processing)
  observation_id?: string; // If provided, update existing observation
  
  // MODE 2: Create new observation (Legacy mode)
  officerId?: string;
  organizationId?: string;
  zoneId?: string;
  idempotencyKey?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  gpsAccuracy?: number;
  recordedAt?: string;
  
  // SHARED: Photo evidence
  photo_url: string;
  photo_hash?: string;
  
  // OPTIONAL: Configuration
  regions?: string[];
  mmc?: boolean;
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

    const isUpdateMode = !!body.observation_id;

    console.log('📍 ALPR Request:', {
      mode: isUpdateMode ? 'UPDATE' : 'CREATE',
      observation_id: body.observation_id,
      photo_url: body.photo_url,
    });

    // Validate required fields
    if (!body.photo_url) {
      return new Response(
        JSON.stringify({ success: false, error: 'photo_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isUpdateMode) {
      // CREATE mode validation
      if (!body.officerId || !body.organizationId || !body.zoneId || !body.idempotencyKey) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Missing required identity fields (CREATE mode)',
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

      // Check for duplicate
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
    } else {
      // UPDATE mode validation
      const { data: existingObs, error: obsError } = await supabase
        .from('observations')
        .select('id, processing_status')
        .eq('id', body.observation_id)
        .single();

      if (obsError || !existingObs) {
        return new Response(
          JSON.stringify({ success: false, error: 'Observation not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (existingObs.processing_status === 'completed') {
        console.log('⚠️ Observation already processed:', body.observation_id);
        return new Response(
          JSON.stringify({ success: true, already_processed: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Mark as processing
      await supabase
        .from('observations')
        .update({ 
          processing_status: 'processing',
          processing_started_at: new Date().toISOString()
        })
        .eq('id', body.observation_id);
    }

    const photoHash = body.photo_hash || `sha256-${Date.now()}-${Math.random().toString(36).substring(7)}`;

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
    // Endpoint: POST /infer  (multipart/form-data with "photo" field)
    // Returns:  { success, data: { embedding[], embedding_quality, detection: { confidence } } }
    // ==========================================================================
    let vehicleEmbedding: number[] | null = null;
    let embeddingQuality: number | null = null;

    if (RAILWAY_INFERENCE_URL) {
      try {
        console.log('🚂 Stage 1: Railway Inference Service /infer ...');

        // Send photo as multipart form (matches the /infer endpoint contract)
        const inferForm = new FormData();
        inferForm.append('photo', new Blob([await photoBlob.arrayBuffer()], { type: 'image/jpeg' }), 'photo.jpg');

        const railwayResponse = await fetch(`${RAILWAY_INFERENCE_URL}/infer`, {
          method: 'POST',
          body: inferForm,
        });

        if (railwayResponse.ok) {
          const railwayData = await railwayResponse.json();

          if (railwayData.success && railwayData.data) {
            const inferData = railwayData.data;

            // Store vehicle embedding for visual matching
            if (inferData.embedding && Array.isArray(inferData.embedding)) {
              vehicleEmbedding = inferData.embedding;
              embeddingQuality = inferData.embedding_quality ?? null;
              plateConfidence = inferData.detection?.confidence ?? 0.5;
              stage = 'railway';
              console.log('✅ Stage 1 Success: embedding generated, detection confidence:', plateConfidence);
            } else {
              console.log('⚠️ Stage 1: No embedding in response');
              warnings.push('Railway Inference returned no embedding');
            }

            // Extract plate/vehicle if inference service provided them (requires OPENAI_API_KEY on Railway)
            if (inferData.plate_number && inferData.plate_number !== 'UNKNOWN') {
              plateNumber = inferData.plate_number.toUpperCase();
            }
            if (inferData.vehicle_make || inferData.vehicle_model) {
              vehicle = {
                make: inferData.vehicle_make,
                model: inferData.vehicle_model,
                color: inferData.vehicle_colour,
              };
            }
          } else {
            console.log('⚠️ Stage 1: No vehicle detected in photo');
            warnings.push('Railway Inference: no vehicle detected');
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
    // STEP 7: CREATE OR UPDATE OBSERVATION
    // ==========================================================================
    let observation: any;

    if (isUpdateMode) {
      // UPDATE MODE: Update existing observation with AI results
      const updateData: Record<string, any> = {
        plate_number: plateNumber,
        vehicle_make: vehicle.make || null,
        vehicle_model: vehicle.model || null,
        vehicle_color: vehicle.color || null,
        processing_status: 'completed',
        processing_completed_at: new Date().toISOString(),
        processing_error: warnings.length > 0 ? warnings.join('; ') : null,
      };

      // Store vehicle embedding when inference service provided one
      if (vehicleEmbedding) {
        updateData.vehicle_embedding = JSON.stringify(vehicleEmbedding);
        updateData.embedding_quality = embeddingQuality;
        updateData.embedding_model_version = 'yolov8n_mobilenetv3_v1.0';
        updateData.embedding_created_at = new Date().toISOString();
      }

      console.log('💾 Updating observation:', {
        observation_id: body.observation_id,
        plate: updateData.plate_number,
        stage,
      });

      const { data: updatedObs, error: updateError } = await supabase
        .from('observations')
        .update(updateData)
        .eq('id', body.observation_id)
        .select('id, plate_number, is_compliant, breach_type')
        .single();

      if (updateError) {
        console.error('❌ Database UPDATE failed:', updateError);
        
        // Mark as failed
        await supabase
          .from('observations')
          .update({ 
            processing_status: 'failed',
            processing_error: updateError.message,
            processing_completed_at: new Date().toISOString()
          })
          .eq('id', body.observation_id);

        return new Response(
          JSON.stringify({
            success: false,
            error: 'Database error: ' + updateError.message,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      observation = updatedObs;

    } else {
      // CREATE MODE: Insert new observation
      const observationData = {
        idempotency_key: body.idempotencyKey,
        recorded_by: body.officerId,
        organization_id: body.organizationId,
        zone_id: body.zoneId,
        photo_url: body.photo_url,
        photo_hash: photoHash,
        plate_number: plateNumber,
        gps_latitude: body.gpsLatitude,
        gps_longitude: body.gpsLongitude,
        gps_accuracy: body.gpsAccuracy || null,
        recorded_at: body.recordedAt || new Date().toISOString(),
        officer_notes: body.officerNotes || null,
        weather_conditions: body.weatherConditions || null,
        vehicle_make: vehicle.make || null,
        vehicle_model: vehicle.model || null,
        vehicle_color: vehicle.color || null,
        processing_status: 'completed',
        processing_completed_at: new Date().toISOString(),
        is_compliant: true,
      };

      console.log('💾 Creating observation:', {
        plate: observationData.plate_number,
        stage,
      });

      const { data: newObs, error: obsError } = await supabase
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
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      observation = newObs;
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
