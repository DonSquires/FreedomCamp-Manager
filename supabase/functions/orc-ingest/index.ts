/**
 * ORC/AI Ingest Function
 * 
 * Replaces deleted ALPR functions (recognize-plate, plate-scanner-photo-first)
 * 
 * Flow:
 * 1. Receive vehicle photo from frontend
 * 2. Upload to Supabase Storage
 * 3. Call inference service to generate embedding
 * 4. Store observation with embedding in observations
 * 5. Trigger compliance evaluation
 * 
 * @param {File} photo - Vehicle photo (JPEG/PNG/WEBP)
 * @param {object} metadata - GPS, zone, organization, etc.
 * @returns {object} - Observation data with match results
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { adaptiveObservationInsert } from '../_shared/observationInsert.ts';

const INFERENCE_SERVICE_URL = Deno.env.get('INFERENCE_SERVICE_URL');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Create Supabase admin client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse multipart form data
    const formData = await req.formData();
    const photo = formData.get('photo') as File;
    const metadataStr = formData.get('metadata') as string;

    if (!photo) {
      throw new Error('No photo provided');
    }

    if (!metadataStr) {
      throw new Error('No metadata provided');
    }

    const metadata = JSON.parse(metadataStr);
    console.log('Processing vehicle photo:', {
      fileName: photo.name,
      fileSize: photo.size,
      zone: metadata.zone_id,
      org: metadata.organization_id
    });

    // Step 1: Validate user authentication
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Step 2: Upload photo to Supabase Storage
    const fileName = `${user.id}/${crypto.randomUUID()}_${photo.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('evidence')
      .upload(fileName, photo, {
        contentType: photo.type,
        upsert: false
      });

    if (uploadError) {
      console.error('Storage upload failed:', uploadError);
      throw new Error(`Photo upload failed: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('evidence')
      .getPublicUrl(fileName);

    console.log('✅ Photo uploaded:', publicUrl);

    // Step 3: Call inference service to generate embedding
    if (!INFERENCE_SERVICE_URL) {
      throw new Error('INFERENCE_SERVICE_URL not configured');
    }

    const inferFormData = new FormData();
    inferFormData.append('photo', photo);

    const inferResponse = await fetch(`${INFERENCE_SERVICE_URL}/infer`, {
      method: 'POST',
      body: inferFormData
    });

    if (!inferResponse.ok) {
      const errorText = await inferResponse.text();
      console.error('Inference failed:', errorText);
      throw new Error(`Inference failed: ${errorText}`);
    }

    const inferResult = await inferResponse.json();
    console.log('✅ Inference complete:', {
      quality: inferResult.data.embedding_quality,
      confidence: inferResult.data.detection.confidence,
      dimension: inferResult.data.metadata.dimension
    });

    // Step 4: Store observation with embedding using adaptive insert for COALESCE error handling
    const observationPayload = {
      plate_number: metadata.plate_number || 'UNKNOWN',
      photo_url: publicUrl,
      photo_hash: metadata.photo_hash,
      gps_latitude: metadata.gps_latitude,
      gps_longitude: metadata.gps_longitude,
      gps_accuracy: metadata.gps_accuracy,
      recorded_at: metadata.recorded_at || new Date().toISOString(),
      organization_id: metadata.organization_id,
      zone_id: metadata.zone_id,
      recorded_by: user.id,
      vehicle_embedding: inferResult.data.embedding,
      embedding_quality: inferResult.data.embedding_quality,
      embedding_model_version: inferResult.data.embedding_model_version,
      embedding_created_at: new Date().toISOString(),
      officer_notes: metadata.notes,
      self_contained: metadata.self_contained || false,
      self_contained_expiry: metadata.self_contained_expiry,
      // Compliance defaults - trigger will update these
      is_compliant: true,
      nights_stayed_this_month: 0,
      consecutive_nights: 0,
    };

    const { data: observation, error: insertError, droppedColumns } = await adaptiveObservationInsert(
      supabase,
      observationPayload,
    );

    if (droppedColumns.length > 0) {
      console.log('📝 ORC ingest adaptive insert dropped columns:', droppedColumns);
    }

    if (insertError) {
      console.error('Observation insert failed:', insertError);
      throw new Error(`Failed to store observation: ${(insertError as any)?.message || 'Unknown error'}`);
    }

    const observationId = (observation as any)?.id || (observation as any)?.observation_id;
    const observationPlate = (observation as any)?.plate_number;
    const observationRecordedAt = (observation as any)?.recorded_at;

    console.log('✅ Observation created:', observationId);

    // Step 5: Find matching vehicles
    const { data: matches, error: matchError } = await supabase
      .rpc('match_vehicle', {
        p_obs_id: observationId,
        p_k: 5,
        p_since: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
        p_org: metadata.organization_id,
        p_zone: null,
        p_min_quality: 0.7
      });

    if (matchError) {
      console.error('Match query failed:', matchError);
      // Non-fatal - continue without matches
    }

    console.log(`✅ Found ${matches?.length || 0} similar vehicles`);

    // Step 6: Return results
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          observation_id: observationId,
          plate_number: observationPlate,
          recorded_at: observationRecordedAt,
          photo_url: publicUrl,
          embedding: {
            quality: inferResult.data.embedding_quality,
            model: inferResult.data.embedding_model_version,
            dimension: inferResult.data.metadata.dimension
          },
          detection: {
            confidence: inferResult.data.detection.confidence,
            bbox: inferResult.data.detection.bbox
          },
          matches: matches || [],
          processing_time_ms: inferResult.data.metadata.processing_time_ms
        }
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );

  } catch (error: any) {
    console.error('ORC ingestion error:', error);

    return new Response(
      JSON.stringify({
        error: error.message || 'ORC ingestion failed',
        details: error.toString()
      }),
      {
        status: error.message === 'Unauthorized' ? 401 : 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }
});
