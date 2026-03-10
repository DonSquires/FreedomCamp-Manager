/**
 * ALPR Retry Edge Function
 * 
 * Manually re-run ALPR processing on an incident's latest evidence image.
 * Admin-only operation with full audit trail.
 * 
 * Flow:
 * 1. Verify admin authorization
 * 2. Fetch latest image from incident-evidence/{incident_id}/
 * 3. Generate signed URL for ALPR provider
 * 4. Call ALPR API (PlateRecognizer, OpenALPR, etc.)
 * 5. Update incident with results (status, plate_number, confidence)
 * 6. Increment retry counter
 * 
 * Usage:
 * POST /alpr-retry
 * {
 *   "incident_id": "uuid"
 * }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts';
import { alprWithBytes } from '../_shared/alpr.ts';

// Verify admin authorization
function verifyAdmin(jwt: string): { userId: string; role: string } | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(atob(parts[1]));
    const role = payload.user_role || payload.role;
    
    if (role !== 'admin' && role !== 'master') {
      return null;
    }
    
    return {
      userId: payload.sub || payload.user_id,
      role,
    };
  } catch (err) {
    console.error('JWT decode error:', err);
    return null;
  }
}

// Get latest evidence file for incident
async function getLatestEvidencePath(
  supabase: any,
  incidentId: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from('incident-evidence')
    .list(incidentId, {
      sortBy: { column: 'created_at', order: 'desc' },
      limit: 1,
    });

  if (error) {
    throw new Error(`Failed to list evidence: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error('No evidence found for incident');
  }

  return `${incidentId}/${data[0].name}`;
}

// Run Plate Recognizer ALPR on an image URL
// Downloads the image first, then sends bytes to the shared alpr helper using
// multipart upload — consistent with alpr-process and compatible across all
// Plate Recognizer plan tiers (including those that do not support upload_url JSON).
async function runAlprDetection(imageUrl: string): Promise<{
  plate?: string;
  confidence?: number;
  provider: string;
  rawResponse: any;
}> {
  console.log(`🔍 Running ALPR on: ${imageUrl.substring(0, 100)}...`);

  // Download image bytes
  const imgResponse = await fetch(imageUrl);
  if (!imgResponse.ok) {
    throw new Error(`Failed to download evidence image: ${imgResponse.status}`);
  }
  const bytes = new Uint8Array(await imgResponse.arrayBuffer());

  const result = await alprWithBytes(bytes, { regions: 'nz', mmc: true });

  if (result.plate) {
    console.log(`✅ ALPR success: ${result.plate} (confidence: ${result.confidence})`);
  } else {
    console.log('⚠️ ALPR: No plate detected');
  }

  return {
    plate:       result.plate       ?? undefined,
    confidence:  result.confidence  ?? undefined,
    provider:    'platerecognizer',
    rawResponse: result.raw,
  };
}

serve(withCors(async (req) => {
  // Validate auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return errorResponse('Missing authorization header', req, 401);
  }

  const jwt = authHeader.replace('Bearer ', '');
  const auth = verifyAdmin(jwt);
  
  if (!auth) {
    return errorResponse('Forbidden: Admin role required', req, 403);
  }

  // Parse request
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return errorResponse('Invalid JSON body', req, 400);
  }

  const { incident_id } = body;

  if (!incident_id) {
    return errorResponse('Missing required field: incident_id', req, 400);
  }

  // Create service role client
  const supabase = createClient(
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
    // ========================================================================
    // Step 1: Verify incident exists
    // ========================================================================
    const { data: incident, error: fetchError } = await supabase
      .from('incidents')
      .select('id, organization_id, status, alpr_retry_count')
      .eq('id', incident_id)
      .single();

    if (fetchError || !incident) {
      return errorResponse('Incident not found', req, 404);
    }

    console.log(`🔄 ALPR retry requested for incident ${incident_id} (attempt ${incident.alpr_retry_count + 1})`);

    // ========================================================================
    // Step 2: Mark as processing
    // ========================================================================
    await supabase
      .from('incidents')
      .update({
        status: 'processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', incident_id);

    // ========================================================================
    // Step 3: Get latest evidence file
    // ========================================================================
    const evidencePath = await getLatestEvidencePath(supabase, incident_id);
    console.log(`📄 Latest evidence: ${evidencePath}`);

    // ========================================================================
    // Step 4: Generate signed URL (60 seconds)
    // ========================================================================
    const { data: signedData, error: signError } = await supabase.storage
      .from('incident-evidence')
      .createSignedUrl(evidencePath, 60);

    if (signError || !signedData) {
      throw new Error(`Failed to generate signed URL: ${signError?.message || 'Unknown error'}`);
    }

    // ========================================================================
    // Step 5: Run ALPR detection
    // ========================================================================
    const alprResult = await runAlprDetection(signedData.signedUrl);

    // ========================================================================
    // Step 6: Update incident with results
    // ========================================================================
    const updateData: any = {
      alpr_retry_count: incident.alpr_retry_count + 1,
      alpr_processed_at: new Date().toISOString(),
      alpr_provider: alprResult.provider,
      alpr_raw_response: alprResult.rawResponse,
      updated_at: new Date().toISOString(),
    };

    if (alprResult.plate) {
      updateData.status = 'complete';
      updateData.plate_number = alprResult.plate;
      updateData.alpr_confidence = alprResult.confidence;
      
      console.log(`✅ ALPR success: ${alprResult.plate} (confidence: ${alprResult.confidence})`);
    } else {
      updateData.status = 'failed';
      console.log(`❌ ALPR failed: No plate detected`);
    }

    const { error: updateError } = await supabase
      .from('incidents')
      .update(updateData)
      .eq('id', incident_id);

    if (updateError) {
      throw new Error(`Failed to update incident: ${updateError.message}`);
    }

    // ========================================================================
    // Step 7: Return success response
    // ========================================================================
    return jsonResponse(
      {
        success: true,
        incident_id,
        status: updateData.status,
        plate_number: alprResult.plate || null,
        confidence: alprResult.confidence || null,
        provider: alprResult.provider,
        retry_count: updateData.alpr_retry_count,
        message: alprResult.plate 
          ? `Plate detected: ${alprResult.plate}` 
          : 'No plate detected',
      },
      req
    );

  } catch (err: any) {
    console.error('ALPR retry error:', err);

    // Mark incident as failed
    try {
      await supabase
        .from('incidents')
        .update({
          status: 'failed',
          alpr_retry_count: (incident?.alpr_retry_count || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', incident_id);
    } catch (updateErr) {
      console.error('Failed to mark incident as failed:', updateErr);
    }

    return errorResponse(
      err instanceof Error ? err.message : 'ALPR retry failed',
      req,
      500,
      { error: err.message }
    );
  }
}));
