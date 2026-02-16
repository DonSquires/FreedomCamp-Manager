/**
 * process-field-scan Edge Function - UPDATED FOR NEW SCHEMA
 * Uses: canonical_vehicles (plate_number PK), vehicle_observations_v2, vehicle_monthly_stays
 * 
 * Features:
 * - Auto-populates observation from canonical vehicle
 * - Officer notes support
 * - Calendar-day-based overnight tracking
 * - Sticky breach detection
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface ScanRequest {
  plateNumber: string;
  zoneId: string;
  organizationId: string;
  imageUrl?: string;
  gpsLocation?: { lat: number; lng: number; accuracy: number };
  vehicleDetails?: {
    make?: string;
    model?: string;
    color?: string;
    year?: number;
  };
  detectionMethod: 'alpr' | 'ocr' | 'manual';
  confidence: number;
  isSelfContained?: boolean;
  selfContainedExpiry?: string;
  hasGreenSticker?: boolean;
  hasBlueSticker?: boolean;
  officerNotes?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔥 process-field-scan Edge Function invoked (NEW SCHEMA)');
    
    // Get authenticated user
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      console.error('❌ Auth failed:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: userError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ User authenticated:', user.id);

    const scanData: ScanRequest = await req.json();
    console.log('📸 Processing field scan:', JSON.stringify(scanData, null, 2));

    // Validate required fields
    if (!scanData.plateNumber || !scanData.zoneId || !scanData.organizationId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // HANDLE "OTHER LOCATION" VIRTUAL ZONE
    if (scanData.zoneId === 'other-location') {
      console.log('📍 Virtual zone "Other Location" - skipping enforcement');
      const normalizedPlate = scanData.plateNumber.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
      
      // Still upsert canonical vehicle
      await supabaseAdmin.rpc('upsert_canonical_vehicle', {
        p_plate_number: normalizedPlate,
        p_vehicle_make: scanData.vehicleDetails?.make,
        p_vehicle_model: scanData.vehicleDetails?.model,
        p_vehicle_year: scanData.vehicleDetails?.year,
        p_vehicle_color: scanData.vehicleDetails?.color,
        p_self_contained: scanData.isSelfContained,
        p_self_contained_expiry: scanData.selfContainedExpiry,
      });
      
      return new Response(
        JSON.stringify({
          success: true,
          plate_number: normalizedPlate,
          is_compliant: true,
          alerts: ['📍 Scanned outside geofenced areas - "Other Location"'],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate GPS accuracy (server-side enforcement)
    if (scanData.gpsLocation && scanData.gpsLocation.accuracy > 100) {
      console.warn('⚠️ GPS accuracy poor:', scanData.gpsLocation.accuracy, 'm');
      return new Response(
        JSON.stringify({
          error: 'GPS accuracy too poor for evidentiary use',
          details: `GPS accuracy is ${scanData.gpsLocation.accuracy.toFixed(0)}m. Must be ≤100m.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize plate number
    const normalizedPlate = scanData.plateNumber.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
    console.log('🔤 Normalized plate:', normalizedPlate);

    // AUTOMATIC ZONE DETECTION: Match GPS to geofences
    let finalZoneId = scanData.zoneId;
    if (scanData.gpsLocation && scanData.gpsLocation.lat && scanData.gpsLocation.lng) {
      console.log('📍 GPS location detected - checking geofence match...');
      
      // Query all active zones with geofences for this organization
      const { data: zones, error: zonesError } = await supabaseAdmin
        .from('zones')
        .select('id, name, geometry, location_lat, location_lng')
        .eq('organization_id', scanData.organizationId)
        .eq('is_active', true);
      
      if (!zonesError && zones && zones.length > 0) {
        let matchedZoneId: string | null = null;
        
        // 1. Try polygon geofence matching first
        for (const zone of zones) {
          if (zone.geometry?.type === 'Polygon' && zone.geometry?.coordinates) {
            // Simple point-in-polygon check (for simple polygons)
            const polygon = zone.geometry.coordinates[0]; // First ring
            const point = [scanData.gpsLocation.lng, scanData.gpsLocation.lat];
            
            // Ray casting algorithm
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
              const xi = polygon[i][0], yi = polygon[i][1];
              const xj = polygon[j][0], yj = polygon[j][1];
              
              const intersect = ((yi > point[1]) !== (yj > point[1]))
                  && (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
              if (intersect) inside = !inside;
            }
            
            if (inside) {
              matchedZoneId = zone.id;
              console.log(`✅ GPS matched polygon geofence: ${zone.name}`);
              break;
            }
          }
        }
        
        // 2. If no polygon match, try point+radius (100m)
        if (!matchedZoneId) {
          for (const zone of zones) {
            if (zone.location_lat && zone.location_lng) {
              const distance = calculateDistance(
                scanData.gpsLocation.lat,
                scanData.gpsLocation.lng,
                zone.location_lat,
                zone.location_lng
              );
              
              if (distance <= 100) { // Within 100m
                matchedZoneId = zone.id;
                console.log(`✅ GPS matched point zone (${distance.toFixed(0)}m): ${zone.name}`);
                break;
              }
            }
          }
        }
        
        // 3. If no match, assign to "Other Location"
        if (!matchedZoneId) {
          console.log('📍 No geofence match - assigning to "Other Location"');
          
          // Try to find or create "Other Location" zone
          const { data: otherZone, error: otherZoneError } = await supabaseAdmin
            .from('zones')
            .select('id')
            .eq('organization_id', scanData.organizationId)
            .eq('name', 'Other Location')
            .maybeSingle();
          
          if (!otherZoneError && otherZone) {
            matchedZoneId = otherZone.id;
          } else {
            // Create "Other Location" zone
            const { data: newZone, error: createError } = await supabaseAdmin
              .from('zones')
              .insert({
                organization_id: scanData.organizationId,
                name: 'Other Location',
                description: 'Auto-created zone for observations outside defined geofences',
                is_active: true,
                day_visit_only: false,
              })
              .select('id')
              .single();
            
            if (!createError && newZone) {
              matchedZoneId = newZone.id;
              console.log('✅ Created "Other Location" zone:', matchedZoneId);
            }
          }
        }
        
        // Use matched zone if found
        if (matchedZoneId) {
          finalZoneId = matchedZoneId;
          console.log(`🎯 Final zone assignment: ${finalZoneId}`);
        }
      }
    } else {
      console.log('⚠️ No GPS location - using manually selected zone');
    }

    // Helper function: Calculate distance between two GPS points (meters)
    function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
      const R = 6371e3; // Earth radius in meters
      const φ1 = lat1 * Math.PI / 180;
      const φ2 = lat2 * Math.PI / 180;
      const Δφ = (lat2 - lat1) * Math.PI / 180;
      const Δλ = (lng2 - lng1) * Math.PI / 180;

      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return R * c;
    }

    // STEP 1: Get or create canonical vehicle using RPC function
    console.log('🚗 Step 1: Upsert canonical vehicle...');
    const { data: plateResult, error: upsertError } = await supabaseAdmin.rpc('upsert_canonical_vehicle', {
      p_plate_number: normalizedPlate,
      p_vehicle_make: scanData.vehicleDetails?.make,
      p_vehicle_model: scanData.vehicleDetails?.model,
      p_vehicle_year: scanData.vehicleDetails?.year,
      p_vehicle_color: scanData.vehicleDetails?.color,
      p_self_contained: scanData.isSelfContained,
      p_self_contained_expiry: scanData.selfContainedExpiry,
    });

    if (upsertError) {
      console.error('❌ Failed to upsert canonical vehicle:', upsertError);
      throw upsertError;
    }

    console.log('✅ Canonical vehicle ready:', plateResult);

    // STEP 2: Get canonical vehicle details
    const { data: canonicalVehicle, error: vehicleError } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('*')
      .eq('plate_number', normalizedPlate)
      .single();

    if (vehicleError || !canonicalVehicle) {
      console.error('❌ Failed to fetch canonical vehicle:', vehicleError);
      throw vehicleError || new Error('Vehicle not found');
    }

    const isNewVehicle = canonicalVehicle.total_observations === 0;
    console.log('📊 Vehicle status:', {
      isNew: isNewVehicle,
      totalObs: canonicalVehicle.total_observations,
      isFlagged: canonicalVehicle.is_flagged,
      homelessStatus: canonicalVehicle.homeless_status,
    });

    // STEP 2.5: Check for same-day duplicate BEFORE insertion (CRITICAL)
    console.log('🔍 Checking for same-day duplicates BEFORE insertion...');
    const today = new Date().toISOString().split('T')[0];
    
    const { data: todayDuplicate, error: dupCheckError } = await supabaseAdmin
      .from('vehicle_observations_v2')
      .select('observation_id, recorded_at, zone_id, zones!inner(name)')
      .eq('plate_number', normalizedPlate)
      .eq('zone_id', scanData.zoneId)
      .gte('recorded_at', today + 'T00:00:00')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (todayDuplicate) {
      const lastScanTime = new Date(todayDuplicate.recorded_at);
      const minutesAgo = Math.round((Date.now() - lastScanTime.getTime()) / 60000);
      const zoneName = (todayDuplicate.zones as any)?.name || 'this zone';
      
      console.log(`⚠️ DUPLICATE DETECTED: ${normalizedPlate} already scanned ${minutesAgo} minutes ago in ${zoneName}`);
      
      return new Response(
        JSON.stringify({
          error: 'duplicate_scan',
          message: `Vehicle ${normalizedPlate} already scanned today in ${zoneName}`,
          details: {
            plate_number: normalizedPlate,
            last_scan_time: lastScanTime.toISOString(),
            minutes_ago: minutesAgo,
            zone_name: zoneName,
          },
          duplicate: true,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ No same-day duplicate - proceeding with insertion');

    // STEP 3: Create vehicle observation v2 (auto-populated by trigger)
    console.log('📝 Step 3: Create observation v2...');
    
    const observationSelfContained = scanData.isSelfContained || scanData.hasGreenSticker || scanData.hasBlueSticker || false;
    
    const { data: observation, error: obsError } = await supabaseAdmin
      .from('vehicle_observations_v2')
      .insert({
        plate_number: normalizedPlate,
        organization_id: scanData.organizationId,
        zone_id: finalZoneId,
        recorded_by: user.id,
        recorded_at: new Date().toISOString(),
        // Vehicle details - will be auto-populated from canonical if not provided
        vehicle_make: scanData.vehicleDetails?.make,
        vehicle_model: scanData.vehicleDetails?.model,
        vehicle_year: scanData.vehicleDetails?.year,
        vehicle_color: scanData.vehicleDetails?.color,
        self_contained: observationSelfContained,
        self_contained_expiry: scanData.selfContainedExpiry,
        // Photo
        photo: scanData.imageUrl,
        // GPS
        gps_latitude: scanData.gpsLocation?.lat,
        gps_longitude: scanData.gpsLocation?.lng,
        gps_accuracy: scanData.gpsLocation?.accuracy,
        // Officer notes
        officer_notes: scanData.officerNotes,
        has_notes: !!scanData.officerNotes,
        notes_reference_previous: false, // TODO: Check if officer viewed previous notes
      })
      .select()
      .single();

    if (obsError) {
      console.error('❌ Failed to create observation:', obsError);
      throw obsError;
    }

    console.log('✅ Observation created:', observation.observation_id);

    // STEP 4: Run compliance check WITH compliance_results table population
    console.log('⚖️ Step 4: Run compliance check with results table population...');
    let isCompliant = true;
    let complianceResult = null;

    try {
      const { data: complianceData, error: complianceError } = await supabaseAdmin
        .rpc('calculate_vehicle_compliance_with_results', {
          p_plate_number: normalizedPlate,
          p_zone_id: finalZoneId,
          p_check_date: new Date().toISOString().split('T')[0],
          p_observation_id: observation.observation_id // ✅ PASS observation_id to populate compliance_results
        });

      if (!complianceError && complianceData && complianceData.length > 0) {
        isCompliant = complianceData[0].is_compliant;
        complianceResult = complianceData[0];
        console.log('✅ Compliance result saved to compliance_results table:', isCompliant, complianceResult);
      }
    } catch (complianceErr) {
      console.error('⚠️ Compliance check failed (non-critical):', complianceErr);
    }

    // STEP 5: Build alerts (respecting FC Act exemption for homeless)
    const alerts: string[] = [];
    const isHomeless = canonicalVehicle.homeless_status === 'confirmed' || canonicalVehicle.homeless_status === 'claimed';
    const isFCActExempt = canonicalVehicle.fc_act_exempt || isHomeless;

    if (isNewVehicle) {
      alerts.push('✨ New vehicle detected - first observation recorded');
    }

    if (canonicalVehicle.is_flagged) {
      alerts.push(`🚩 FLAGGED VEHICLE: ${canonicalVehicle.flagged_reason || 'Unknown reason'} (Priority: ${canonicalVehicle.flagged_priority})`);
    }

    // Homeless vehicles: informational only, not critical
    if (isHomeless) {
      alerts.push(`ℹ️ Homeless vehicle (FC Act Exempt) - ${canonicalVehicle.homeless_status}`);
    }

    // Zone compliance (informational for homeless, critical for non-homeless)
    if (!isCompliant) {
      if (isFCActExempt) {
        alerts.push('ℹ️ Zone rule breach detected (FC Act does not apply - homeless exemption)');
      } else {
        alerts.push('⚠️ Non-compliant with zone requirements');
      }
    }

    if (scanData.isSelfContained || scanData.hasGreenSticker || scanData.hasBlueSticker) {
      alerts.push('✅ Self-contained certification detected');
    }

    if (canonicalVehicle.total_notes > 0) {
      alerts.push(`📝 ${canonicalVehicle.total_notes} previous note${canonicalVehicle.total_notes !== 1 ? 's' : ''} on record`);
    }



    // STEP 7: Prepare response (✅ PHASE 2: Include full homeless data from canonical_vehicles)
    const response = {
      success: true,
      plate_number: normalizedPlate,
      observation_id: observation.observation_id,
      is_new_vehicle: isNewVehicle,
      is_flagged: canonicalVehicle.is_flagged,
      is_compliant: isCompliant,
      fc_act_exempt: isFCActExempt,
      homeless_status: canonicalVehicle.homeless_status, // ✅ 'none' | 'claimed' | 'confirmed'
      homeless_notes: canonicalVehicle.homeless_notes, // ✅ Admin notes
      homeless_confirmed_at: canonicalVehicle.homeless_confirmed_at, // ✅ Timestamp
      homeless_confirmed_by: canonicalVehicle.homeless_confirmed_by, // ✅ Admin user ID
      prior_observations_count: canonicalVehicle.total_observations,
      alerts,
      flagged_details: canonicalVehicle.is_flagged ? {
        reason: canonicalVehicle.flagged_reason,
        priority: canonicalVehicle.flagged_priority,
        notes: canonicalVehicle.flagged_notes,
      } : null,
      compliance_result: complianceResult,
      vehicle_details: {
        make: observation.vehicle_make,
        model: observation.vehicle_model,
        year: observation.vehicle_year,
        color: observation.vehicle_color,
      },
      notes_summary: {
        total_notes: canonicalVehicle.total_notes,
        last_note_preview: canonicalVehicle.last_note_preview,
        last_note_at: canonicalVehicle.last_note_at,
      },
    };

    console.log('✅ Scan processing complete:', response);

    // STEP 8: Trigger background AI analysis, NZSCV verification, and breach prediction
    // Run asynchronously - don't wait for results
    console.log('🤖 Triggering background analysis and breach prediction...');
    
    // Fire and forget - these run in background
    Promise.all([
      // AI photo analysis (if photo available)
      scanData.imageUrl ? supabaseAdmin.functions.invoke('analyze-vehicle-photo', {
        body: {
          plateNumber: normalizedPlate,
          photoUrl: scanData.imageUrl,
        }
      }).catch(err => console.error('⚠️ Background AI analysis failed:', err)) : Promise.resolve(null),
      
      // NZSCV verification (if photo available)
      scanData.imageUrl ? supabaseAdmin.functions.invoke('check-nzscv-status', {
        body: {
          plateNumber: normalizedPlate,
          observedSelfContained: observationSelfContained,
        }
      }).catch(err => console.error('⚠️ Background NZSCV check failed:', err)) : Promise.resolve(null),
      
      // CRITICAL: Check if vehicle will breach if stays tonight
      supabaseAdmin.functions.invoke('check-almost-breaches', {
        body: {
          organization_id: scanData.organizationId,
          zone_id: scanData.zoneId,
          threshold_nights: 1, // Check if will breach with 1 more night
        }
      }).catch(err => console.error('⚠️ Background breach prediction failed:', err)),
    ]).then(results => {
      console.log('✅ Background analysis complete');
      
      // Check for mismatches from NZSCV
      const nzscvResult = results[1]?.data;
      if (nzscvResult?.mismatch_detected) {
        console.warn('🚨 NZSCV MISMATCH DETECTED:', nzscvResult.mismatch_message);
      }
      
      // Check for critical breach predictions
      const breachPrediction = results[2]?.data;
      if (breachPrediction?.vehicles) {
        const thisVehicle = breachPrediction.vehicles.find(
          (v: any) => v.plate_number === normalizedPlate
        );
        
        if (thisVehicle?.will_breach_if_stays_tonight) {
          console.warn('🚨 BREACH PREDICTION:', 
            `${normalizedPlate} WILL BREACH if stays tonight`,
            `(${thisVehicle.breach_type}:`,
            `${thisVehicle.consecutive_nights + 1}/${thisVehicle.consecutive_allowed} consecutive,`,
            `${thisVehicle.nights_stayed + 1}/${thisVehicle.nights_allowed} monthly)`
          );
        }
      }
    });

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Process field scan error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to process field scan',
        message: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
