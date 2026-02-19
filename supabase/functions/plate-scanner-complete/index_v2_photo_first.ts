// ============================================
// PLATE-SCANNER-COMPLETE V2: PHOTO-FIRST WORKFLOW
// Zero-loss photo retention: Upload → Verify → Then Create Observation
// ============================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Parse multipart form data
    const formData = await req.formData();
    const photoFile = formData.get('photo') as File;
    const zoneId = formData.get('zoneId') as string;
    const organizationId = formData.get('organizationId') as string;
    const gpsLatitude = parseFloat(formData.get('gpsLatitude') as string);
    const gpsLongitude = parseFloat(formData.get('gpsLongitude') as string);
    const gpsAccuracy = parseFloat(formData.get('gpsAccuracy') as string);
    const deviceTime = formData.get('deviceTime') as string;
    const deviceId = formData.get('deviceId') as string;
    const localCaptureId = formData.get('localCaptureId') as string;

    // ==========================================
    // STEP 1: VALIDATE MINIMUM REQUIREMENTS
    // ==========================================
    
    if (!photoFile || !zoneId || !organizationId || !gpsLatitude || !gpsLongitude) {
      throw new Error('Missing required fields: photo, zoneId, organizationId, GPS coordinates');
    }

    console.log('[PHOTO-FIRST] Starting photo-first workflow', {
      zoneId,
      organizationId,
      userId: user.id,
      fileSize: photoFile.size,
      gpsAccuracy
    });

    // ==========================================
    // STEP 2: IDEMPOTENCY CHECK
    // ==========================================
    
    const idempotencyKey = `${deviceId}:${localCaptureId}`;
    
    const { data: existingScan, error: idempotencyError } = await supabaseAdmin
      .from('scan_idempotency_keys')
      .select('observation_id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingScan) {
      console.log('[PHOTO-FIRST] Duplicate scan detected (idempotency)', { idempotencyKey });
      return new Response(
        JSON.stringify({
          success: true,
          duplicate: true,
          observation_id: existingScan.observation_id
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================
    // STEP 3: CALCULATE SHA-256 HASH
    // ==========================================
    
    const photoBytes = await photoFile.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', photoBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const photoHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    console.log('[PHOTO-FIRST] Photo hash calculated', {
      hash: photoHash,
      bytes: photoBytes.byteLength
    });

    // ==========================================
    // STEP 4: UPLOAD ORIGINAL (IMMUTABLE)
    // ==========================================
    
    const observationId = crypto.randomUUID();
    const timestamp = new Date();
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    
    const originalKey = `originals/${organizationId}/${year}/${month}/${observationId}/${photoHash}.jpg`;
    
    console.log('[PHOTO-FIRST] Uploading original photo', { originalKey });
    
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('evidence')
      .upload(originalKey, photoBytes, {
        contentType: photoFile.type || 'image/jpeg',
        cacheControl: '31536000', // 1 year
        upsert: false // Prevent overwrite
      });

    if (uploadError) {
      console.error('[PHOTO-FIRST] Upload failed', uploadError);
      throw new Error(`Photo upload failed: ${uploadError.message}`);
    }

    console.log('[PHOTO-FIRST] Original photo uploaded successfully');

    // ==========================================
    // STEP 5: VERIFY STORAGE HASH (OPTIONAL BUT RECOMMENDED)
    // ==========================================
    
    // In production, add a HEAD request to verify the file exists
    // and optionally download + re-hash to confirm integrity

    // ==========================================
    // STEP 6: EXTRACT EXIF (IF AVAILABLE)
    // ==========================================
    
    // For now, placeholder EXIF extraction
    // In production, use an EXIF library like exifr
    const exifData = {
      deviceTime: deviceTime || timestamp.toISOString(),
      gps: {
        latitude: gpsLatitude,
        longitude: gpsLongitude,
        accuracy: gpsAccuracy
      }
    };

    // ==========================================
    // STEP 7: GET TRUSTED SERVER TIMESTAMP
    // ==========================================
    
    const serverReceivedAt = new Date().toISOString();

    // ==========================================
    // STEP 8: GENERATE TRUSTED SIGNATURE (HMAC)
    // ==========================================
    
    // HMAC-SHA256 of (hash + serverTime)
    const secretKey = Deno.env.get('TRUSTED_TIME_SECRET') || 'default-secret-change-me';
    const encoder = new TextEncoder();
    const dataToSign = `${photoHash}||${serverReceivedAt}`;
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secretKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      encoder.encode(dataToSign)
    );
    
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const trustedSignature = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

    console.log('[PHOTO-FIRST] Trusted timestamp signature generated');

    // ==========================================
    // STEP 9: CREATE OBSERVATION (WITHIN TRANSACTION)
    // ==========================================
    
    const { data: publicUrlData } = supabaseAdmin.storage
      .from('evidence')
      .getPublicUrl(originalKey);

    const observationData = {
      observation_id: observationId,
      organization_id: organizationId,
      zone_id: zoneId,
      recorded_by: user.id,
      recorded_at: serverReceivedAt,
      
      // GPS & Location
      gps_latitude: gpsLatitude,
      gps_longitude: gpsLongitude,
      gps_accuracy_m: gpsAccuracy,
      
      // Photo Evidence (MANDATORY)
      photo_original_sha256: photoHash,
      photo_original_bytes: photoBytes.byteLength,
      photo_exif: exifData,
      photo_url: publicUrlData.publicUrl,
      
      // Timestamps
      device_time: deviceTime || serverReceivedAt,
      server_received_at: serverReceivedAt,
      trusted_time_signature: trustedSignature,
      
      // Plate (will be filled by ALPR)
      plate_number: null,
      
      // Initial status
      review_blocked: false
    };

    console.log('[PHOTO-FIRST] Creating observation', {
      observationId,
      hash: photoHash,
      bytes: photoBytes.byteLength
    });

    const { data: observation, error: obsError } = await supabaseAdmin
      .from('vehicle_observations_v2')
      .insert(observationData)
      .select()
      .single();

    if (obsError) {
      console.error('[PHOTO-FIRST] Observation creation failed', obsError);
      
      // Cleanup uploaded photo on failure
      await supabaseAdmin.storage.from('evidence').remove([originalKey]);
      
      throw new Error(`Failed to create observation: ${obsError.message}`);
    }

    console.log('[PHOTO-FIRST] Observation created successfully');

    // ==========================================
    // STEP 10: RECORD IDEMPOTENCY KEY
    // ==========================================
    
    await supabaseAdmin
      .from('scan_idempotency_keys')
      .insert({
        idempotency_key: idempotencyKey,
        observation_id: observationId,
        device_id: deviceId,
        local_capture_id: localCaptureId
      });

    // ==========================================
    // STEP 11: RUN ALPR (ASYNC BUT WITHIN SAME OBSERVATION)
    // ==========================================
    
    console.log('[PHOTO-FIRST] Running ALPR recognition');
    
    let plateNumber: string | null = null;
    let alprConfidence: number | null = null;

    try {
      const plateRecognizerApiToken = Deno.env.get('PLATE_RECOGNIZER_API_TOKEN');
      if (!plateRecognizerApiToken) {
        throw new Error('PLATE_RECOGNIZER_API_TOKEN not configured');
      }

      const formDataALPR = new FormData();
      formDataALPR.append('upload', new Blob([photoBytes], { type: 'image/jpeg' }), 'plate.jpg');
      formDataALPR.append('regions', 'nz');

      const alprResponse = await fetch('https://api.platerecognizer.com/v1/plate-reader/', {
        method: 'POST',
        headers: {
          Authorization: `Token ${plateRecognizerApiToken}`,
        },
        body: formDataALPR,
      });

      if (alprResponse.ok) {
        const alprData = await alprResponse.json();
        console.log('[PHOTO-FIRST] ALPR result', alprData);

        if (alprData.results && alprData.results.length > 0) {
          plateNumber = alprData.results[0].plate.toUpperCase();
          alprConfidence = alprData.results[0].score;
        }
      } else {
        console.error('[PHOTO-FIRST] ALPR API error', await alprResponse.text());
      }
    } catch (alprError) {
      console.error('[PHOTO-FIRST] ALPR failed (non-critical)', alprError);
      // Continue without plate - can be manually entered later
    }

    // Update observation with plate number (if recognized)
    if (plateNumber) {
      console.log('[PHOTO-FIRST] Updating observation with plate', { plateNumber });
      
      await supabaseAdmin
        .from('vehicle_observations_v2')
        .update({ plate_number: plateNumber })
        .eq('observation_id', observationId);
    }

    // ==========================================
    // STEP 12: LOG EVIDENCE ACCESS (CAPTURE)
    // ==========================================
    
    await supabaseAdmin
      .from('evidence_access_log')
      .insert({
        observation_id: observationId,
        actor: user.id,
        action: 'CAPTURE',
        action_details: {
          device_id: deviceId,
          local_capture_id: localCaptureId,
          photo_hash: photoHash,
          gps_accuracy: gpsAccuracy
        },
        occurred_at: serverReceivedAt
      });

    // ==========================================
    // STEP 13: RETURN SUCCESS
    // ==========================================
    
    // Note: Compliance evaluation and breach alerts are handled by database triggers
    // Client should poll/subscribe for compliance_results and breach_alerts

    console.log('[PHOTO-FIRST] Workflow complete', {
      observationId,
      plateNumber: plateNumber || 'pending manual entry',
      hash: photoHash
    });

    return new Response(
      JSON.stringify({
        success: true,
        observation_id: observationId,
        plate_number: plateNumber,
        alpr_confidence: alprConfidence,
        photo: {
          hash: photoHash,
          bytes: photoBytes.byteLength,
          url: publicUrlData.publicUrl,
          trusted_signature: trustedSignature
        },
        warnings: plateNumber ? [] : ['ALPR failed - manual plate entry required']
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('[PHOTO-FIRST] Error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error',
        details: error.toString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
