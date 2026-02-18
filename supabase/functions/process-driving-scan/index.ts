import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * DRIVING MODE AUTO-SCAN PROCESSOR - NEW SCHEMA v2
 * 
 * Uses: canonical_vehicles (plate_number PK), vehicle_observations_v2
 * 
 * FAST-PATH WORKFLOW (200-300ms response time):
 * 1. AI plate recognition (plate number only)
 * 2. GPS location capture
 * 3. FAST INSERT: Save to vehicle_observations_v2
 * 4. Compliance checking
 * 5. Breach/H&S detection
 * 6. Flagged vehicle alerts
 * 7. Background verification: Re-check plate, verify against canonical, detect mismatches
 */

/**
 * Background verification - doesn't block response
 * 
 * Re-checks the photo and verifies against canonical_vehicles:
 * - Re-run OCR/AI to confirm plate number
 * - Check make, model, year, color against canonical
 * - Check self-contained status
 * - Alert officer if mismatch detected
 */
async function verifyAndEnrichInBackground(
  supabaseAdmin: any,
  observationId: string,
  plateNumber: string,
  image: string,
  userId: string,
  timestamp: number
) {
  try {
    console.log(`🔄 [BACKGROUND] Starting verification for ${plateNumber}`);

    // 1. Upload photo first
    let photoUrl: string | null = null;
    try {
      const fileName = `${userId}/${timestamp}_${plateNumber}.jpg`;
      const base64Data = image.split(',')[1];
      const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

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
        photoUrl = urlData.publicUrl;
        console.log(`✅ [BACKGROUND] Photo uploaded for ${plateNumber}`);
      }
    } catch (uploadErr) {
      console.error('❌ [BACKGROUND] Photo upload failed:', uploadErr);
    }

    // 2. Get canonical vehicle data to compare against
    const { data: canonicalVehicle } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('*')
      .eq('plate_number', plateNumber)
      .single();

    console.log('📊 [BACKGROUND] Canonical vehicle data:', {
      make: canonicalVehicle?.vehicle_make,
      model: canonicalVehicle?.vehicle_model,
      year: canonicalVehicle?.vehicle_year,
      color: canonicalVehicle?.vehicle_color,
      self_contained: canonicalVehicle?.self_contained,
    });

    // 3. Re-run plate recognition to verify
    console.log('🔍 [BACKGROUND] Re-running plate recognition to verify...');
    const { data: plateVerification, error: plateError } = await supabaseAdmin.functions.invoke('recognize-plate', {
      body: { image },
    });

    let verifiedPlateNumber = plateNumber; // Default to original
    let plateNumberMismatch = false;

    if (!plateError && plateVerification?.plate_number) {
      const reVerifiedPlate = plateVerification.plate_number.toUpperCase();
      if (reVerifiedPlate !== plateNumber) {
        console.warn(`⚠️ [BACKGROUND] PLATE MISMATCH: Original: ${plateNumber}, Re-verified: ${reVerifiedPlate}`);
        plateNumberMismatch = true;
        verifiedPlateNumber = reVerifiedPlate;
      } else {
        console.log(`✅ [BACKGROUND] Plate verified: ${plateNumber}`);
      }
    }

    // 4. Run AI analysis if we have a photo URL
    let aiAnalysis = null;
    if (photoUrl) {
      console.log('🤖 [BACKGROUND] Running AI photo analysis with NZSCV verification...');
      const { data: aiData } = await supabaseAdmin.functions.invoke('analyze-vehicle-photo', {
        body: {
          plateNumber,
          photoUrl,
        }
      });

      if (aiData && aiData.success) {
        aiAnalysis = aiData.analysis;
        console.log('✅ [BACKGROUND] AI analysis complete:', {
          vehicle: `${aiAnalysis.color} ${aiAnalysis.make} ${aiAnalysis.model} ${aiAnalysis.year}`,
          ai_detected_sticker: aiAnalysis.ai_sticker_detection?.detected,
          nzscv_certified: aiAnalysis.nzscv_certification?.is_self_contained,
          validation_match: aiAnalysis.validation?.match,
          conflict: aiAnalysis.validation?.conflict_note,
        });
      }
    }

    // 5. Run NZSCV verification
    console.log('🌐 [BACKGROUND] Checking NZSCV database...');
    const { data: nzscvData } = await supabaseAdmin.functions.invoke('check-nzscv-status', {
      body: {
        plateNumber,
        observedSelfContained: aiAnalysis?.is_self_contained,
      }
    });

    const nzscvResult = nzscvData?.result;
    const nzscvMismatch = nzscvData?.mismatch_detected;

    // 6. Detect mismatches
    const mismatches: string[] = [];

    if (plateNumberMismatch) {
      mismatches.push(`⚠️ Plate number mismatch: Initial scan "${plateNumber}" vs Re-verification "${verifiedPlateNumber}"`);
    }

    if (aiAnalysis && canonicalVehicle) {
      if (aiAnalysis.make && canonicalVehicle.vehicle_make && aiAnalysis.make !== canonicalVehicle.vehicle_make) {
        mismatches.push(`⚠️ Make mismatch: AI detected "${aiAnalysis.make}" vs Canonical "${canonicalVehicle.vehicle_make}"`);
      }
      if (aiAnalysis.model && canonicalVehicle.vehicle_model && aiAnalysis.model !== canonicalVehicle.vehicle_model) {
        mismatches.push(`⚠️ Model mismatch: AI detected "${aiAnalysis.model}" vs Canonical "${canonicalVehicle.vehicle_model}"`);
      }
      if (aiAnalysis.color && canonicalVehicle.vehicle_color && aiAnalysis.color !== canonicalVehicle.vehicle_color) {
        mismatches.push(`⚠️ Color mismatch: AI detected "${aiAnalysis.color}" vs Canonical "${canonicalVehicle.vehicle_color}"`);
      }
      if (aiAnalysis.year && canonicalVehicle.vehicle_year && aiAnalysis.year !== canonicalVehicle.vehicle_year.toString()) {
        mismatches.push(`⚠️ Year mismatch: AI detected "${aiAnalysis.year}" vs Canonical "${canonicalVehicle.vehicle_year}"`);
      }
      
      // Include NZSCV conflict note if present
      if (aiAnalysis.validation?.conflict_note) {
        mismatches.push(aiAnalysis.validation.conflict_note);
      }
    }

    if (nzscvMismatch && nzscvData?.mismatch_message) {
      mismatches.push(nzscvData.mismatch_message);
    }

    // 7. Update observation with photo and any detected data
    const observationUpdate: any = {};
    
    if (photoUrl) {
      observationUpdate.photo = photoUrl;
    }

    if (aiAnalysis) {
      if (aiAnalysis.make) observationUpdate.vehicle_make = aiAnalysis.make;
      if (aiAnalysis.model) observationUpdate.vehicle_model = aiAnalysis.model;
      if (aiAnalysis.color) observationUpdate.vehicle_color = aiAnalysis.color;
      if (aiAnalysis.year) observationUpdate.vehicle_year = parseInt(aiAnalysis.year);
      // Use NZSCV certification as source of truth (NOT AI sticker detection)
      if (aiAnalysis.nzscv_certification?.is_self_contained !== undefined) {
        observationUpdate.self_contained = aiAnalysis.nzscv_certification.is_self_contained;
      }
    }

    if (Object.keys(observationUpdate).length > 0) {
      await supabaseAdmin
        .from('vehicle_observations_v2')
        .update(observationUpdate)
        .eq('observation_id', observationId);
      
      console.log('✅ [BACKGROUND] Observation updated with enriched data');
    }

    // 8. If mismatches detected, create a notification/alert for the officer
    if (mismatches.length > 0) {
      console.warn('🚨 [BACKGROUND] MISMATCHES DETECTED:');
      mismatches.forEach(m => console.warn(`   ${m}`));

      // TODO: Create officer notification or alert
      // For now, log it - in production, could use push notifications
      
      // Log to console for officer to see
      console.log('📢 [BACKGROUND] Officer should be notified to confirm/update canonical vehicle data');
    } else {
      console.log('✅ [BACKGROUND] No mismatches detected - all data verified');
    }

    console.log(`✅ [BACKGROUND] Verification complete for ${plateNumber}`);

    return {
      success: true,
      mismatches,
      aiAnalysis,
      nzscvResult,
    };

  } catch (error) {
    console.error(`❌ [BACKGROUND] Verification failed for ${plateNumber}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { image, zone_id, organization_id, gps_latitude, gps_longitude, ocr_provider } = await req.json();

    console.log('🚗 [DRIVING SCAN] Processing driving mode scan (NEW SCHEMA v2)...');

    // Step 1: AI Plate Recognition (plate number only - fast)
    const recognizeFunction = ocr_provider === 'platerecognizer' ? 'recognize-plate' : 'extract-plate';
    
    const { data: plateData, error: plateError } = await supabaseClient.functions.invoke(recognizeFunction, {
      body: { image },
    });

    if (plateError || !plateData?.plate_number) {
      console.log('❌ Plate recognition failed');
      return new Response(
        JSON.stringify({ success: false, error: 'Plate not detected' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const plateNumber = plateData.plate_number.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
    const confidence = plateData.confidence || plateData.confidence_score || 0;
    
    console.log(`📋 Detected plate: ${plateNumber} (confidence: ${Math.round(confidence * 100)}%)`);
    
    // Reject low-confidence scans
    if (confidence < 0.65) {
      console.log(`⚠️ Low confidence (${Math.round(confidence * 100)}%) - rejecting`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'low_confidence',
          confidence: Math.round(confidence * 100),
          message: 'Plate detection confidence too low' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Step 2: Check for RECENT duplicate (last 5 minutes for driving mode)
    // Extended from 30 seconds to 5 minutes to prevent rapid re-scans
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const { data: recentDuplicate } = await supabaseAdmin
      .from('vehicle_observations_v2')
      .select('observation_id, recorded_at')
      .eq('plate_number', plateNumber)
      .eq('zone_id', zone_id)
      .gte('recorded_at', fiveMinutesAgo)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentDuplicate) {
      const secondsAgo = Math.round((Date.now() - new Date(recentDuplicate.recorded_at).getTime()) / 1000);
      const minutesAgo = Math.round(secondsAgo / 60);
      console.log(`⏭️ DUPLICATE: ${plateNumber} (scanned ${minutesAgo}m ${secondsAgo % 60}s ago)`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'duplicate',
          plate_number: plateNumber,
          seconds_ago: secondsAgo,
          minutes_ago: minutesAgo,
          message: `Already scanned ${minutesAgo > 0 ? minutesAgo + ' minute(s)' : secondsAgo + ' second(s)'} ago` 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Step 3: Get or create canonical vehicle
    console.log('🚗 Upserting canonical vehicle...');
    const { data: plateResult, error: upsertError } = await supabaseAdmin.rpc('upsert_canonical_vehicle', {
      p_plate_number: plateNumber,
      p_vehicle_make: null,
      p_vehicle_model: null,
      p_vehicle_year: null,
      p_vehicle_color: null,
      p_self_contained: null,
      p_self_contained_expiry: null,
    });

    if (upsertError) {
      console.error('❌ Failed to upsert canonical vehicle:', upsertError);
      throw new Error(`Canonical vehicle creation failed: ${upsertError.message}`);
    }

    // Step 4: Get canonical vehicle details
    const { data: canonicalVehicle } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('is_flagged, flagged_priority, flagged_reason, homeless_status')
      .eq('plate_number', plateNumber)
      .single();

    let alertType: 'safe' | 'warning' | 'danger' = 'safe';
    let alertMessage = '';

    if (canonicalVehicle?.is_flagged) {
      alertType = canonicalVehicle.flagged_priority === 'high' ? 'danger' : 'warning';
      alertMessage = `🚨 FLAGGED VEHICLE - ${canonicalVehicle.flagged_priority?.toUpperCase()} PRIORITY`;
      console.log(`🚨 FLAGGED: ${plateNumber} - ${canonicalVehicle.flagged_priority}`);
    }

    // Step 5: FAST INSERT to vehicle_observations_v2 (NEW SCHEMA)
    const timestamp = Date.now();
    
    const recordData = {
      plate_number: plateNumber,
      organization_id: organization_id || null,
      zone_id,
      recorded_by: user.id,
      recorded_at: new Date().toISOString(),
      gps_latitude: gps_latitude || null,
      gps_longitude: gps_longitude || null,
      gps_accuracy: null, // Driving mode doesn't have accuracy
      // Vehicle details will be populated by trigger from canonical
      // Then verified/updated in background
      self_contained: false, // Will be verified in background
      officer_notes: null, // Driving mode has no notes
      has_notes: false,
    };

    console.log('💾 Fast insert to vehicle_observations_v2:', plateNumber);

    const { data: newRecord, error: insertError } = await supabaseAdmin
      .from('vehicle_observations_v2')
      .insert(recordData)
      .select('observation_id')
      .single();

    if (insertError) {
      console.error('❌ Database insert failed:', JSON.stringify(insertError, null, 2));
      throw new Error(`Failed to save record: ${insertError.message} (${insertError.code || 'unknown code'})`);
    }

    console.log(`✅ Record created: ${newRecord.observation_id}`);

    // Step 6: Start background verification (re-check plate, verify against canonical, detect mismatches)
    // This runs async - doesn't block the response
    verifyAndEnrichInBackground(
      supabaseAdmin,
      newRecord.observation_id,
      plateNumber,
      image,
      user.id,
      timestamp
    );

    // Step 7: Run compliance check WITH compliance_results population
    const { data: complianceData, error: complianceError } = await supabaseAdmin
      .rpc('calculate_vehicle_compliance_with_results', {
        p_plate_number: plateNumber,
        p_zone_id: zone_id,
        p_check_date: new Date().toISOString().split('T')[0],
        p_observation_id: newRecord.observation_id // ✅ PASS observation_id to populate compliance_results
      });

    let isCompliant = true;
    let violations: string[] = [];
    let violationSeverity: string | null = null;

    if (!complianceError && complianceData && complianceData.length > 0) {
      const compliance = complianceData[0];
      isCompliant = compliance.is_compliant && compliance.violation_severity !== 'critical' && compliance.violation_severity !== 'moderate';
      violationSeverity = compliance.violation_severity;
      console.log('✅ Compliance result saved to compliance_results table');
      
      if (!isCompliant) {
        violations.push(compliance.violation_type);
        console.log(`⚠️ BREACH: ${plateNumber} - ${compliance.violation_type}`);
        
        if (compliance.violation_severity === 'critical') {
          alertType = alertType === 'danger' ? 'danger' : 'warning';
          alertMessage = alertMessage || `BREACH: ${compliance.violation_type.replace(/_/g, ' ')}`;
        }

        // Create breach alert
        await supabaseAdmin
          .from('breach_alerts')
          .insert({
            organization_id,
            zone_id,
            breach_type: compliance.violation_type,
            breach_details: {
              message: compliance.violation_message,
              severity: compliance.violation_severity,
              consecutiveNights: compliance.consecutive_nights,
              monthNights: compliance.month_nights,
            },
            status: 'pending',
          });
      }

      // Update observation with compliance status
      await supabaseAdmin
        .from('vehicle_observations_v2')
        .update({ 
          is_compliant: isCompliant,
          is_breach: !isCompliant,
          breach_type: isCompliant ? null : compliance.violation_type,
        })
        .eq('observation_id', newRecord.observation_id);
    }

    // Step 8: Check for H&S incidents in this zone
    const { data: recentIncidents } = await supabaseAdmin
      .from('health_safety_reports')
      .select('severity')
      .eq('zone_id', zone_id)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .eq('status', 'pending');

    if (recentIncidents && recentIncidents.length > 0) {
      const hasHighSeverity = recentIncidents.some(i => i.severity === 'high' || i.severity === 'critical');
      if (hasHighSeverity && alertType !== 'danger') {
        alertType = 'warning';
        alertMessage = alertMessage || 'Recent H&S incidents in this zone';
      }
    }

    // Step 9: Get zone info
    const { data: zone } = await supabaseAdmin
      .from('zones')
      .select('name')
      .eq('id', zone_id)
      .single();

    const processingTime = Date.now() - timestamp;
    console.log(`✅ Scan complete (fast-path): ${plateNumber} - ${isCompliant ? 'Compliant' : 'BREACH'} (${processingTime}ms)`);

    return new Response(
      JSON.stringify({
        success: true,
        record: {
          id: newRecord.observation_id,
          plate_number: plateNumber,
          vehicle_make: null, // Will be enriched in background
          vehicle_model: null,
          vehicle_color: null,
          is_compliant: isCompliant,
          is_self_contained: false, // Will be verified in background
          zone_name: zone?.name || 'Unknown',
          recorded_at: new Date().toISOString(),
          photo_url: null, // Will be uploaded in background
          violations,
          violation_severity: violationSeverity,
        },
        alert: {
          type: alertType,
          message: alertMessage,
          flagged: !!canonicalVehicle?.is_flagged,
        },
        verifying: true, // Indicates background verification is happening
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('❌ Driving scan failed:', error);
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
