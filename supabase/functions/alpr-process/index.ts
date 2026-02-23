import { createClient } from 'npm:@supabase/supabase-js@2.45.3';
import { corsHeaders } from '../_shared/cors.ts';

// CONFIGURATION
const ALPR_API_URL = 'https://api.platerecognizer.com/v1/plate-reader/';

// 1. Interface Definition (Strict Contract)
interface ALPRRequest {
  image: string;            // Base64 string (required)
  photo_url: string;        // Storage URL (required)
  photo_hash: string;       // Unique Hash (required)
  
  // GPS Data (Must be numbers)
  gpsLatitude: number;
  gpsLongitude: number;
  gpsAccuracy?: number;
  
  // Metadata for RLS & Logic
  officerId: string;
  organizationId: string;
  zoneId: string;
  idempotencyKey: string;
  recordedAt: string;
  
  // Options
  regions?: string[];
  camera_id?: string;
  mmc?: boolean;
  officerNotes?: string;
  weatherConditions?: string;
}

Deno.serve(async (req) => {
  // 2. Handle CORS (Browser Pre-flight)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 3. Environment Check
    const ALPR_API_TOKEN = Deno.env.get('ALPR_API_TOKEN');
    if (!ALPR_API_TOKEN) {
      throw new Error('Server Misconfiguration: ALPR_API_TOKEN is missing in Secrets.');
    }

    // 4. Parse & Validate Payload
    let body: ALPRRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Detailed Validation to fix your 400 Error
    const missingFields: string[] = [];
    if (!body.image) missingFields.push('image');
    if (!body.photo_url) missingFields.push('photo_url');
    if (!body.officerId) missingFields.push('officerId');
    if (!body.zoneId) missingFields.push('zoneId');
    if (body.gpsLatitude === undefined || body.gpsLatitude === null) missingFields.push('gpsLatitude');
    if (body.gpsLongitude === undefined || body.gpsLongitude === null) missingFields.push('gpsLongitude');

    if (missingFields.length > 0) {
      console.error('Validation Error. Missing:', missingFields);
      return new Response(
        JSON.stringify({ success: false, error: `Missing required fields: ${missingFields.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Setup Supabase Client (Bypass RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 6. Idempotency Check (Prevent Double Billing)
    const { data: existingObs } = await supabase
      .from('observations')
      .select('id, plate_number, is_compliant')
      .eq('idempotency_key', body.idempotencyKey)
      .maybeSingle();

    if (existingObs) {
      return new Response(
        JSON.stringify({
          success: true,
          duplicate: true,
          observation_id: existingObs.id,
          plate: existingObs.plate_number,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Prepare Plate Recognizer Request
    const formData = new FormData();
    
    // Convert Base64 to Blob
    const cleanBase64 = body.image.replace(/^data:image\/\w+;base64,/, '');
    const binaryStr = atob(cleanBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    
    formData.append('upload', blob, 'capture.jpg');
    
    // API Parameters from Docs
    const regions = body.regions || ['nz'];
    regions.forEach(r => formData.append('regions', r));
    
    if (body.mmc) formData.append('mmc', 'true');
    if (body.camera_id) formData.append('camera_id', body.camera_id);
    
    formData.append('config', JSON.stringify({
      region: 'strict',
      detection_rule: 'strict' // Only returns if vehicle/plate found
    }));

    // 8. Call External API
    const alprResponse = await fetch(ALPR_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Token ${ALPR_API_TOKEN}` },
      body: formData,
    });

    if (!alprResponse.ok) {
      const errText = await alprResponse.text();
      console.error('ALPR API Error:', alprResponse.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: `Provider Error: ${errText}` }),
        { status: alprResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await alprResponse.json();
    
    // 9. Process Results
    // Case A: No Plate Detected
    if (!data.results || data.results.length === 0) {
      const { data: manualObs, error: dbError } = await supabase
        .from('observations')
        .insert({
          idempotency_key: body.idempotencyKey,
          plate_number: 'MANUAL_REQUIRED',
          photo_url: body.photo_url,
          photo_hash: body.photo_hash,
          recorded_at: body.recordedAt,
          zone_id: body.zoneId,
          organization_id: body.organizationId,
          gps_latitude: body.gpsLatitude,
          gps_longitude: body.gpsLongitude,
          gps_accuracy: body.gpsAccuracy,
          recorded_by: body.officerId,
          officer_notes: body.officerNotes,
          is_compliant: true,
          requires_manual_entry: true
        })
        .select('id')
        .single();

      if (dbError) throw dbError;

      return new Response(
        JSON.stringify({
          success: true,
          observation_id: manualObs.id,
          requires_manual_entry: true,
          message: 'Image accepted, but no plate found.'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Case B: Plate Detected
    const result = data.results[0];
    const plateNumber = (result.plate || '').toUpperCase();
    
    const { data: observation, error: dbError } = await supabase
      .from('observations')
      .insert({
        idempotency_key: body.idempotencyKey,
        plate_number: plateNumber,
        confidence: result.score,
        vehicle_make: result.vehicle?.make?.[0]?.name || null,
        vehicle_model: result.vehicle?.model?.[0]?.name || null,
        vehicle_color: result.vehicle?.color?.[0]?.name || null,
        photo_url: body.photo_url,
        photo_hash: body.photo_hash,
        recorded_at: body.recordedAt,
        zone_id: body.zoneId,
        organization_id: body.organizationId,
        gps_latitude: body.gpsLatitude,
        gps_longitude: body.gpsLongitude,
        gps_accuracy: body.gpsAccuracy,
        recorded_by: body.officerId,
        officer_notes: body.officerNotes,
        is_compliant: true,
        requires_manual_entry: false
      })
      .select('id')
      .single();

    if (dbError) throw dbError;

    return new Response(
      JSON.stringify({
        success: true,
        observation_id: observation.id,
        plate: plateNumber,
        vehicle: result.vehicle,
        confidence: result.score
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('System Error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
