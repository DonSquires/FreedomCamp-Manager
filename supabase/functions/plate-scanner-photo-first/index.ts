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

// ============================================================================
// CENTRALIZED ALPR HELPER - Single source of truth for plate recognition
// ============================================================================
interface ALPRResult {
  plate: string | null;
  confidence: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
  year: string | null;
  raw: any;
}

async function detectPlate(photoBytes: Uint8Array): Promise<ALPRResult> {
  const url = Deno.env.get('ALPR_API_URL') || 'https://api.platerecognizer.com/v1/plate-reader/';
  const key = Deno.env.get('PLATE_RECOGNIZER_API_KEY');
  
  if (!key) {
    console.error('❌ ALPR key missing - plate detection disabled');
    return { plate: null, confidence: null, make: null, model: null, color: null, year: null, raw: null };
  }

  console.log('📡 Calling ALPR:', { url, bytes: photoBytes.length });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${key}`,
        'Content-Type': 'application/octet-stream',
      },
      body: photoBytes,
      signal: AbortSignal.timeout(15000), // 15s timeout for cold starts
    });

    const text = await res.text();
    
    if (!res.ok) {
      console.error('❌ ALPR API error:', res.status, text.slice(0, 256));
      return { plate: null, confidence: null, make: null, model: null, color: null, year: null, raw: text };
    }

    const json = JSON.parse(text);
    console.log('📊 ALPR raw response:', JSON.stringify(json).slice(0, 500));

    // Extract best result
    const results = json?.results || [];
    if (results.length === 0) {
      console.warn('⚠️ ALPR returned no plates');
      return { plate: null, confidence: null, make: null, model: null, color: null, year: null, raw: json };
    }

    const best = results[0];
    const plate = best?.plate?.toUpperCase?.().replace(/[^A-Z0-9]/g, '') || null;
    const confidence = best?.score || null;
    
    // Extract vehicle details if available (MMC)
    const makeModel = best?.model_make?.[0];
    const make = makeModel?.make || null;
    const model = makeModel?.model || null;
    const color = best?.color?.[0]?.color || null;
    const year = best?.year?.year_range?.[0] || null;

    console.log(`✅ ALPR detected: ${plate} (confidence: ${confidence})`);
    if (make || model || color) {
      console.log(`📋 Vehicle details: ${make} ${model} ${color} ${year || ''}`);
    }

    return { plate, confidence, make, model, color, year, raw: json };
  } catch (error: any) {
    console.error('❌ ALPR exception:', error.message);
    return { plate: null, confidence: null, make: null, model: null, color: null, year: null, raw: null };
  }
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse multipart form data or JSON body
    let formData: FormData;
    let photoFile: File | null = null;
    let gpsLatitude: number;
    let gpsLongitude: number;
    let recordedAt: string;
    let officerId: string;
    let plateNumber: string | null = null;
    let selfContained: boolean = false;
    let homelessClaimed: boolean = false;
    let idempotencyKey: string | null = null;
    let zoneId: string | null = null;
    let organizationId: string | null = null;

    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      // Multipart form data (original format)
      formData = await req.formData();
      photoFile = formData.get('photo') as File;
      gpsLatitude = parseFloat(formData.get('gps_latitude') as string);
      gpsLongitude = parseFloat(formData.get('gps_longitude') as string);
      recordedAt = formData.get('recorded_at') as string;
      officerId = formData.get('officer_id') as string;
      plateNumber = formData.get('plate_number') as string | null;
      selfContained = formData.get('self_contained') === 'true';
      homelessClaimed = formData.get('homeless_claimed') === 'true';
      idempotencyKey = formData.get('idempotency_key') as string;
      zoneId = formData.get('zone_id') as string | null;
      organizationId = formData.get('organization_id') as string | null;
    } else {
      // JSON body (from UI)
      const body = await req.json();
      
      // Convert base64 image to File object
      const base64Data = body.image?.replace(/^data:image\/\w+;base64,/, '');
      if (!base64Data) throw new Error('Missing image data');
      
      const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      photoFile = new File([buffer], 'capture.jpg', { type: 'image/jpeg' });
      
      gpsLatitude = body.gpsLocation?.lat || body.gps_latitude;
      gpsLongitude = body.gpsLocation?.lng || body.gps_longitude;
      recordedAt = body.recordedAt || new Date().toISOString();
      officerId = body.userId || body.officer_id;
      plateNumber = body.plateNumber || null;
      selfContained = body.selfContained || body.self_contained || false;
      homelessClaimed = body.homelessClaimed || body.homeless_claimed || false;
      idempotencyKey = body.idempotencyKey || `${officerId}:${Date.now()}`;
      zoneId = body.zoneId || body.zone_id || null;
      organizationId = body.organizationId || body.organization_id || null;
    }

    console.log('📥 Received scan:', { 
      userId: officerId, 
      zoneId, 
      hasPhoto: !!photoFile,
      contentType,
    });
    // Validation
    if (!photoFile || !officerId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: photo, officer_id (userId)' }),
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
    // STEP 3: DETERMINE ZONE (from GPS if not provided)
    // -------------------------------------------------------------------------
    let finalZoneId = zoneId;
    let finalOrganizationId = organizationId;

    if (!finalZoneId && gpsLatitude && gpsLongitude) {
      console.log('🗺️ Auto-detecting zone from GPS:', { gpsLatitude, gpsLongitude });
      
      const { data: matchingZones, error: zoneError } = await supabase.rpc('find_all_matching_zones', {
        p_latitude: gpsLatitude,
        p_longitude: gpsLongitude
      });

      if (zoneError) {
        console.error('Zone detection failed:', zoneError);
      } else if (matchingZones && matchingZones.length > 0) {
        finalZoneId = matchingZones[0].zone_id;
        console.log('✅ Zone auto-detected:', finalZoneId);
      }
    }

    if (!finalZoneId) {
      console.warn('❌ No zone found - required for observation');
      return new Response(
        JSON.stringify({ error: 'No zone found for provided GPS coordinates or zone_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get organization_id from zone if not provided
    if (!finalOrganizationId) {
      const { data: zoneData } = await supabase
        .from('zones')
        .select('organization_id')
        .eq('id', finalZoneId)
        .single();

      finalOrganizationId = zoneData?.organization_id;
    }

    console.log('🗺️ Zone resolved:', finalZoneId);

    // -------------------------------------------------------------------------
    // STEP 4: CREATE OBSERVATION RECORD
    // -------------------------------------------------------------------------
    const { data: observation, error: obsError } = await supabase
      .from('vehicle_observations_v2')
      .insert({
        plate_number: plateNumber || 'PENDING_ALPR',
        photo: photoUrl,
        photo_hash: photoHash,
        gps_latitude: gpsLatitude || null,
        gps_longitude: gpsLongitude || null,
        gps_accuracy: null,
        recorded_at: recordedAt,
        organization_id: finalOrganizationId,
        zone_id: finalZoneId,
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
      console.error('❌ Observation creation failed:', obsError);
      return new Response(
        JSON.stringify({ error: 'Observation creation failed', details: obsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🆔 Observation inserted:', observation.observation_id);

    // -------------------------------------------------------------------------
    // STEP 5: RUN ALPR ON PHOTO (NON-BLOCKING UPDATE)
    // -------------------------------------------------------------------------
    const alprResult = await detectPlate(photoBuffer);
    
    if (alprResult.plate) {
      // Update observation with ALPR results
      const { error: updateError } = await supabase
        .from('vehicle_observations_v2')
        .update({
          plate_number: alprResult.plate,
          vehicle_make: alprResult.make,
          vehicle_model: alprResult.model,
          vehicle_color: alprResult.color,
          vehicle_year: alprResult.year ? parseInt(alprResult.year) : null,
        })
        .eq('observation_id', observation.observation_id);

      if (updateError) {
        console.error('⚠️ Failed to update plate from ALPR:', updateError);
      } else {
        console.log(`✅ Plate updated: ${alprResult.plate} (confidence: ${alprResult.confidence})`);
      }
    } else {
      console.warn('⚠️ ALPR did not detect a plate - observation saved as PENDING_ALPR');
    }

    // -------------------------------------------------------------------------
    // STEP 6: STORE IDEMPOTENCY KEY
    // -------------------------------------------------------------------------
    if (idempotencyKey) {
      await supabase.from('scan_idempotency_keys').insert({
        idempotency_key: idempotencyKey,
        observation_id: observation.observation_id,
        device_id: idempotencyKey.split(':')[0] || 'unknown',
        local_capture_id: idempotencyKey.split(':')[1] || idempotencyKey
      });
    }

    // -------------------------------------------------------------------------
    // STEP 7: RETURN observation_id IMMEDIATELY (NO BLOCKING)
    // -------------------------------------------------------------------------
    // Layer 2/3 evaluation happens via database trigger (pipeline_layer_2_and_3)
    // Officer App polls get_observation_result(observation_id) for compliance result
    // ✅ NO 3-SECOND TIMEOUT - Response is instant

    console.log(`✅ Photo-first ingest complete: observation ${observation.observation_id}, zone ${finalZoneId}, plate ${alprResult.plate || 'PENDING'}`);

    return new Response(
      JSON.stringify({
        success: true,
        observation_id: observation.observation_id,
        zone_id: finalZoneId,
        photo_url: photoUrl,
        photo_hash: photoHash,
        plate_number: alprResult.plate || null,
        confidence: alprResult.confidence || null,
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
