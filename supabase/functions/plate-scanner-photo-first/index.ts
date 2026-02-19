// ============================================================================
// PLATE SCANNER PHOTO-FIRST - LAYER 1 INGEST (v2)
// ============================================================================
// Purpose: Photo-first observation ingest with immutable evidence and idempotency
// Flow: Upload → Hash → Verify → Create Observation → Return observation_id
// Officer App polls get_observation_result() for compliance evaluation
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse multipart form data
    const formData = await req.formData();
    
    const photoFile = formData.get('photo') as File;
    const gpsLatitude = parseFloat(formData.get('gps_latitude') as string);
    const gpsLongitude = parseFloat(formData.get('gps_longitude') as string);
    const recordedAt = formData.get('recorded_at') as string;
    const officerId = formData.get('officer_id') as string;
    const plateNumber = formData.get('plate_number') as string | null;
    const selfContained = formData.get('self_contained') === 'true';
    const homelessClaimed = formData.get('homeless_claimed') === 'true';
    const idempotencyKey = formData.get('idempotency_key') as string;

    // Validation
    if (!photoFile || !gpsLatitude || !gpsLongitude || !recordedAt || !officerId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: photo, gps_latitude, gps_longitude, recorded_at, officer_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // IDEMPOTENCY CHECK
    // -------------------------------------------------------------------------
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from('scan_idempotency_keys')
        .select('observation_id')
        .eq('idempotency_key', idempotencyKey)
        .single();

      if (existing) {
        console.log(`Duplicate request detected: ${idempotencyKey}, returning existing observation ${existing.observation_id}`);
        return new Response(
          JSON.stringify({ observation_id: existing.observation_id, duplicate: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // -------------------------------------------------------------------------
    // STEP 1: UPLOAD PHOTO TO STORAGE
    // -------------------------------------------------------------------------
    const photoBytes = await photoFile.arrayBuffer();
    const photoBuffer = new Uint8Array(photoBytes);
    
    // Generate SHA-256 hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', photoBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const photoHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    const timestamp = Date.now();
    const fileName = `${officerId}/${timestamp}_${photoHash.substring(0, 8)}.jpg`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('evidence')
      .upload(fileName, photoBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '31536000', // 1 year
        upsert: false
      });

    if (uploadError) {
      console.error('Photo upload failed:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Photo upload failed', details: uploadError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const photoUrl = `${supabaseUrl}/storage/v1/object/public/evidence/${fileName}`;

    // -------------------------------------------------------------------------
    // STEP 2: CREATE PHOTO_METADATA RECORD
    // -------------------------------------------------------------------------
    const { data: photoMetadata, error: metadataError } = await supabase
      .from('photo_metadata')
      .insert({
        photo_url: photoUrl,
        file_name: fileName,
        bucket_name: 'evidence',
        storage_path: fileName,
        photo_hash: photoHash,
        photo_type: 'full',
        file_size_bytes: photoBuffer.length,
        mime_type: 'image/jpeg',
        user_id: officerId,
        gps_latitude: gpsLatitude,
        gps_longitude: gpsLongitude,
        gps_accuracy: parseFloat(formData.get('gps_accuracy') as string || '0'),
        captured_at: recordedAt,
        retention_policy: 'standard',
        court_ready: false,
        original_sha256: photoHash,
        is_original: true
      })
      .select()
      .single();

    if (metadataError) {
      console.error('Photo metadata creation failed:', metadataError);
      return new Response(
        JSON.stringify({ error: 'Photo metadata creation failed', details: metadataError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // STEP 3: DETERMINE ZONE FROM GPS COORDINATES
    // -------------------------------------------------------------------------
    const { data: matchingZones, error: zoneError } = await supabase.rpc('find_all_matching_zones', {
      p_latitude: gpsLatitude,
      p_longitude: gpsLongitude
    });

    if (zoneError) {
      console.error('Zone detection failed:', zoneError);
      return new Response(
        JSON.stringify({ error: 'Zone detection failed', details: zoneError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const zoneId = matchingZones && matchingZones.length > 0 ? matchingZones[0].zone_id : null;

    if (!zoneId) {
      console.warn('No zone found for GPS coordinates:', { gpsLatitude, gpsLongitude });
      return new Response(
        JSON.stringify({ error: 'No zone found for provided GPS coordinates' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get organization_id from zone
    const { data: zoneData } = await supabase
      .from('zones')
      .select('organization_id')
      .eq('id', zoneId)
      .single();

    const organizationId = zoneData?.organization_id;

    // -------------------------------------------------------------------------
    // STEP 4: CREATE OBSERVATION RECORD
    // -------------------------------------------------------------------------
    const { data: observation, error: obsError } = await supabase
      .from('vehicle_observations_v2')
      .insert({
        plate_number: plateNumber || 'UNKNOWN',
        photo: photoUrl,
        photo_hash: photoHash,
        gps_latitude: gpsLatitude,
        gps_longitude: gpsLongitude,
        gps_accuracy: parseFloat(formData.get('gps_accuracy') as string || '0'),
        recorded_at: recordedAt,
        organization_id: organizationId,
        zone_id: zoneId,
        recorded_by: officerId,
        self_contained: selfContained,
        has_homeless_claim: homelessClaimed,
        homeless_claim_notes: homelessClaimed ? 'Claimed during field observation' : null,
        photo_original_sha256: photoHash,
        device_time: recordedAt,
        server_received_at: new Date().toISOString(),
        evidence_state: 'original_present',
        is_legacy_import: false
      })
      .select()
      .single();

    if (obsError) {
      console.error('Observation creation failed:', obsError);
      return new Response(
        JSON.stringify({ error: 'Observation creation failed', details: obsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // STEP 5: STORE IDEMPOTENCY KEY
    // -------------------------------------------------------------------------
    if (idempotencyKey) {
      await supabase.from('scan_idempotency_keys').insert({
        idempotency_key: idempotencyKey,
        observation_id: observation.observation_id,
        device_id: idempotencyKey.split(':')[0],
        local_capture_id: idempotencyKey.split(':')[1]
      });
    }

    // -------------------------------------------------------------------------
    // STEP 6: RETURN observation_id IMMEDIATELY
    // -------------------------------------------------------------------------
    // Layer 2/3 evaluation happens via database trigger (pipeline_layer_2_and_3)
    // Officer App polls get_observation_result(observation_id) for compliance result

    console.log(`✅ Photo-first ingest complete: observation ${observation.observation_id}, zone ${zoneId}`);

    return new Response(
      JSON.stringify({
        observation_id: observation.observation_id,
        zone_id: zoneId,
        photo_url: photoUrl,
        photo_hash: photoHash
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error in plate-scanner-photo-first:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
