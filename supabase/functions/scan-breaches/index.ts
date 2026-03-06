import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface BreachDetection {
  plateNumber: string;
  zoneId: string;
  zoneName: string;
  organizationId: string;
  breachType: string;
  breachDetails: any;
  vehicleRecordIds: string[];
  dueDate?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Create Supabase admin client with service role for full access
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Validate caller token — only authenticated admin/master/admin_officer users
    // may trigger a breach scan
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Verify caller role — only admins and master users may run breach scans
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ success: false, error: 'User profile not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    const allowedRoles = ['master', 'admin', 'admin_officer'];
    if (!allowedRoles.includes(profile.role)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions to run breach scan' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    const { organizationId, autoCreate = true } = await req.json();

    // Non-master users can only scan their own organization
    const effectiveOrgId = profile.role === 'master' ? organizationId : profile.organization_id;

    console.log('🔍 Starting breach scan using centralized compliance function...');

    // Fetch zones
    let zonesQuery = supabaseAdmin.from('zones').select('id, name, organization_id');
    if (effectiveOrgId) {
      zonesQuery = zonesQuery.eq('organization_id', effectiveOrgId);
    }
    const { data: zones, error: zonesError } = await zonesQuery;

    if (zonesError) throw new Error(`Failed to fetch zones: ${zonesError.message}`);

    // Get unique plate numbers per zone from observations
    let observationsQuery = supabaseAdmin
      .from('vehicle_observations_v2')
      .select('plate_number, zone_id, observation_id, organization_id')
      .order('recorded_at', { ascending: false });
    
    if (effectiveOrgId) {
      observationsQuery = observationsQuery.eq('organization_id', effectiveOrgId);
    }

    const { data: observations, error: observationsError } = await observationsQuery;
    if (observationsError) throw new Error(`Failed to fetch observations: ${observationsError.message}`);

    // Group observations by zone and plate
    const platesByZone = new Map<string, Set<string>>();
    const observationsByPlateZone = new Map<string, string[]>();
    
    for (const obs of observations || []) {
      const key = `${obs.zone_id}:${obs.plate_number}`;
      
      if (!platesByZone.has(obs.zone_id)) {
        platesByZone.set(obs.zone_id, new Set());
      }
      platesByZone.get(obs.zone_id)!.add(obs.plate_number);
      
      if (!observationsByPlateZone.has(key)) {
        observationsByPlateZone.set(key, []);
      }
      observationsByPlateZone.get(key)!.push(obs.observation_id);
    }

    console.log(`Scanning ${observations?.length || 0} vehicle observations across ${zones?.length || 0} zones`);

    const breachesDetected: BreachDetection[] = [];

    // Process each zone
    for (const zone of zones || []) {
      const platesInZone = platesByZone.get(zone.id);
      if (!platesInZone || platesInZone.size === 0) continue;

      // Check each unique plate in this zone using centralized compliance function
      for (const plateNumber of platesInZone) {
        const key = `${zone.id}:${plateNumber}`;
        const observationIds = observationsByPlateZone.get(key) || [];
        
        // Call centralized compliance calculation function
        const { data: complianceData, error: complianceError } = await supabaseAdmin
          .rpc('calculate_vehicle_compliance', {
            p_plate_number: plateNumber,
            p_zone_id: zone.id,
            p_check_date: new Date().toISOString().split('T')[0]
          });

        if (complianceError) {
          console.error(`Compliance check failed for ${plateNumber} in ${zone.name}:`, complianceError);
          continue;
        }

        if (!complianceData || complianceData.length === 0) continue;
        
        const compliance = complianceData[0];

        // Only create breach if violation is critical (not compliant or warning/advisory)
        if (!compliance.is_compliant || 
            compliance.violation_severity === 'critical' || 
            compliance.violation_severity === 'moderate') {
          
          breachesDetected.push({
            plateNumber,
            zoneId: zone.id,
            zoneName: zone.name,
            organizationId: zone.organization_id,
            breachType: compliance.violation_type || 'unknown',
            breachDetails: {
              message: compliance.violation_message,
              severity: compliance.violation_severity,
              consecutiveNights: compliance.consecutive_nights,
              consecutiveLimit: compliance.consecutive_limit,
              monthNights: compliance.month_nights,
              monthLimit: compliance.month_limit,
              fineAmount: compliance.fine_amount,
              recommendedAction: compliance.recommended_action,
              observation_ids: observationIds,
            },
            vehicleRecordIds: [], // No vehicle_records in new schema
          });
        }
      }
    }

    console.log(`Detected ${breachesDetected.length} breaches using centralized compliance function`);

    // Create breach alerts if autoCreate is true
    let alertsCreated = 0;
    if (autoCreate && breachesDetected.length > 0) {
      // Check for existing alerts to avoid duplicates (by plate + zone + type)
      const { data: existingAlerts } = await supabaseAdmin
        .from('breach_alerts')
        .select('zone_id, breach_type, breach_details')
        .eq('status', 'pending');

      const existingAlertSet = new Set(
        (existingAlerts || []).map(a => {
          const plateFromDetails = (a.breach_details as any)?.plate_number;
          return `${a.zone_id}-${plateFromDetails}-${a.breach_type}`;
        })
      );

      const newAlerts = [];
      for (const breach of breachesDetected) {
        const alertKey = `${breach.zoneId}-${breach.plateNumber}-${breach.breachType}`;

        // Skip if alert already exists
        if (existingAlertSet.has(alertKey)) {
          console.log(`Alert already exists for ${breach.plateNumber} - ${breach.breachType}`);
          continue;
        }

        newAlerts.push({
          organization_id: breach.organizationId,
          vehicle_record_id: null, // No vehicle_records in new schema
          zone_id: breach.zoneId,
          breach_type: breach.breachType,
          breach_details: {
            ...breach.breachDetails,
            plate_number: breach.plateNumber,
          },
          due_date: breach.dueDate || null,
          status: 'pending',
          notified_by: user?.id || null,
        });
      }

      if (newAlerts.length > 0) {
        const { data: insertedAlerts, error: insertError } = await supabaseAdmin
          .from('breach_alerts')
          .insert(newAlerts)
          .select();

        if (insertError) {
          console.error('Error creating alerts:', insertError);
          throw new Error(`Failed to create breach alerts: ${insertError.message}`);
        }

        alertsCreated = insertedAlerts?.length || 0;
        console.log(`Created ${alertsCreated} new breach alerts`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        breachesDetected: breachesDetected.length,
        alertsCreated,
        autoCreate,
        breaches: breachesDetected.map(b => ({
          plateNumber: b.plateNumber,
          zoneName: b.zoneName,
          breachType: b.breachType,
          details: b.breachDetails,
        })),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error scanning breaches:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Internal server error' 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
