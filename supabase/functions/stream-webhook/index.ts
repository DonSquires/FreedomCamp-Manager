import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * PLATE RECOGNIZER STREAM WEBHOOK ENDPOINT
 * 
 * Receives real-time plate recognition events from Plate Recognizer Stream
 * middleware and processes them for driving mode auto-scan.
 * 
 * Workflow:
 * 1. Stream processes video feed continuously
 * 2. Middleware filters/crops/processes events
 * 3. Webhook receives plate data
 * 4. System performs compliance checks
 * 5. Creates vehicle records
 * 6. Sends real-time updates to clients
 */

interface StreamWebhookPayload {
  // Plate Recognizer Stream webhook format
  data: {
    results: Array<{
      plate: string;
      region?: { code: string };
      vehicle?: {
        type?: string;
        make?: string[];
        color?: string[];
        year?: number[];
      };
      score: number;
      coordinates: Array<{ x: number; y: number }>;
      candidates?: Array<{ plate: string; score: number }>;
    }>;
    processing_time: number;
    timestamp: string;
    camera_id?: string;
    frame_number?: number;
    epoch_time?: number;
  };
  // Image data (if middleware forwards it)
  hook: {
    image?: string; // Base64 or URL
    vehicle_image?: string;
    plate_image?: string;
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse webhook payload
    const payload: StreamWebhookPayload = await req.json();
    
    console.log('📡 Stream webhook received:', {
      timestamp: payload.data.timestamp,
      camera: payload.data.camera_id,
      results: payload.data.results.length,
    });

    // Extract camera_id which should map to zone_id
    // Format expected: "zone_id:organization_id" or just "zone_id"
    const cameraId = payload.data.camera_id || req.headers.get('camera-id');
    if (!cameraId) {
      throw new Error('Missing camera_id - required for zone mapping');
    }

    const [zoneId, organizationId] = cameraId.split(':');
    
    if (!zoneId) {
      throw new Error('Invalid camera_id format - expected "zone_id" or "zone_id:org_id"');
    }

    // Process each plate detection
    const processedPlates: string[] = [];
    const errors: string[] = [];

    for (const result of payload.data.results) {
      try {
        const plateNumber = result.plate.toUpperCase();
        const confidence = result.score;

        console.log(`🚗 Processing: ${plateNumber} (confidence: ${Math.round(confidence * 100)}%)`);

        // Reject low confidence detections
        if (confidence < 0.65) {
          console.log(`⏭️ Low confidence (${Math.round(confidence * 100)}%) - skipping`);
          continue;
        }

        // Check for recent duplicate (last 30 seconds)
        const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();
        
        const { data: recentDuplicate } = await supabaseAdmin
          .from('observations')
          .select('observation_id, recorded_at')
          .eq('plate_number', plateNumber)
          .eq('zone_id', zoneId)
          .gte('recorded_at', thirtySecondsAgo)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .single();

        if (recentDuplicate) {
          const secondsAgo = Math.round((Date.now() - new Date(recentDuplicate.recorded_at).getTime()) / 1000);
          console.log(`⏭️ DUPLICATE: ${plateNumber} (scanned ${secondsAgo}s ago)`);
          continue;
        }

        // Extract vehicle details from Stream AI
        const vehicleMake = result.vehicle?.make?.[0]?.value || null;
        const vehicleColor = result.vehicle?.color?.[0]?.value || null;
        const vehicleYear = result.vehicle?.year?.[0] || null;

        // Check canonical vehicle for existing details
        const { data: canonicalVehicle } = await supabaseAdmin
          .from('canonical_vehicles')
          .select('vehicle_make, vehicle_model, vehicle_color, vehicle_year')
          .eq('plate_number', plateNumber)
          .single();

        const previousRecords = canonicalVehicle ? [canonicalVehicle] : null;

        const finalMake = vehicleMake || previousRecords?.[0]?.vehicle_make || null;
        const finalModel = previousRecords?.[0]?.vehicle_model || null;
        const finalColor = vehicleColor || previousRecords?.[0]?.vehicle_color || null;
        const finalYear = vehicleYear || previousRecords?.[0]?.vehicle_year || null;

        // Check for flagged vehicle (OFFICER SAFETY)
        const { data: flaggedVehicle } = await supabaseAdmin
          .from('flagged_vehicles')
          .select('*')
          .ilike('plate_number', plateNumber)
          .eq('is_active', true)
          .single();

        if (flaggedVehicle) {
          console.log(`🚨 FLAGGED VEHICLE DETECTED: ${plateNumber} - ${flaggedVehicle.priority} priority`);
          
          // Create high-priority alert
          await supabaseAdmin
            .from('breach_alerts')
            .insert({
              organization_id: organizationId || null,
              zone_id: zoneId,
              breach_type: 'flagged_vehicle_detected',
              breach_details: {
                plate_number: plateNumber,
                priority: flaggedVehicle.priority,
                notes: flaggedVehicle.notes,
                last_known_site: flaggedVehicle.last_known_site,
                timestamp: new Date().toISOString(),
              },
              status: 'escalated',
            });
        }

        // Upload vehicle image if provided
        let vehiclePhotoUrl: string | null = null;
        if (payload.hook.vehicle_image || payload.hook.image) {
          try {
            const imageData = payload.hook.vehicle_image || payload.hook.image;
            const timestamp = Date.now();
            const fileName = `stream/${zoneId}/${timestamp}_${plateNumber}.jpg`;
            
            let buffer: Uint8Array;
            if (imageData!.startsWith('data:')) {
              const base64Data = imageData!.split(',')[1];
              buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
            } else {
              // Assume it's already base64
              buffer = Uint8Array.from(atob(imageData!), c => c.charCodeAt(0));
            }

            const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
              .from('evidence')
              .upload(fileName, buffer, {
                contentType: 'image/jpeg',
                upsert: false,
              });

            if (!uploadError && uploadData) {
              const { data: urlData } = supabaseAdmin.storage
                .from('evidence')
                .getPublicUrl(uploadData.path);
              vehiclePhotoUrl = urlData.publicUrl;
            }
          } catch (uploadErr) {
            console.error('Photo upload failed:', uploadErr);
          }
        }

        // Create vehicle observation (new schema)
        const { data: newRecord, error: insertError } = await supabaseAdmin
          .from('observations')
          .insert({
            organization_id: organizationId || null,
            zone_id: zoneId,
            plate_number: plateNumber,
            vehicle_make: finalMake,
            vehicle_model: finalModel,
            vehicle_color: finalColor,
            vehicle_year: finalYear || null,
            self_contained: false, // Stream doesn't detect stickers
            photo: vehiclePhotoUrl || null,
            photo_hash: null,
            gps_latitude: null, // Stream doesn't provide GPS
            gps_longitude: null,
            gps_accuracy: null,
            recorded_at: new Date().toISOString(),
            recorded_by: null, // Automated stream scan
            officer_notes: 'Auto-scanned via ALPR Stream',
            has_notes: false,
            is_compliant: true, // Will be updated by compliance check
          })
          .select('observation_id')
          .single();

        if (insertError) {
          console.error('Failed to create record:', insertError);
          errors.push(`${plateNumber}: ${insertError.message}`);
          continue;
        }

        // Run compliance check
        const { data: complianceData } = await supabaseAdmin
          .rpc('calculate_vehicle_compliance', {
            p_plate_number: plateNumber,
            p_zone_id: zoneId,
            p_check_date: new Date().toISOString().split('T')[0]
          });

        if (complianceData && complianceData.length > 0) {
          const compliance = complianceData[0];
          const isCompliant = compliance.is_compliant && 
            compliance.violation_severity !== 'critical' && 
            compliance.violation_severity !== 'moderate';

          // Update observation compliance
          await supabaseAdmin
            .from('observations')
            .update({ is_compliant: isCompliant })
            .eq('observation_id', newRecord.observation_id);

          // Create breach alert if non-compliant
          if (!isCompliant) {
            console.log(`⚠️ BREACH: ${plateNumber} - ${compliance.violation_type}`);
            
            await supabaseAdmin
              .from('breach_alerts')
              .insert({
                organization_id: organizationId || null,
                vehicle_record_id: null, // No vehicle_record in new schema
                zone_id: zoneId,
                breach_type: compliance.violation_type,
                breach_details: {
                  message: compliance.violation_message,
                  severity: compliance.violation_severity,
                  consecutiveNights: compliance.consecutive_nights,
                  monthNights: compliance.month_nights,
                  observation_id: newRecord.observation_id,
                  plate_number: plateNumber,
                },
                status: 'pending',
              });
          }
        }

        processedPlates.push(plateNumber);
        console.log(`✅ Processed: ${plateNumber}`);

      } catch (plateError: any) {
        console.error(`Failed to process plate:`, plateError);
        errors.push(`${result.plate}: ${plateError.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedPlates.length,
        plates: processedPlates,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('❌ Stream webhook failed:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
