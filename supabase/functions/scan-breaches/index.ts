import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

interface BreachDetection {
  plateNumber: string;
  zoneId: string;
  zoneName: string;
  organizationId: string;
  breachType: string;
  breachDetails: any;
  vehicleRecordIds: string[];
  dueDate?: string;
  sourceRecordedAt?: string;
}

type OvernightVerificationMode = 'two_photo_verification' | 'one_photo_per_day_inference';
const EMBEDDING_MATCH_THRESHOLD = 0.86;

function nzDateKey(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function dayDiffInNz(aIso: string, bIso: string): number {
  const a = new Date(`${nzDateKey(aIso)}T00:00:00Z`).getTime();
  const b = new Date(`${nzDateKey(bIso)}T00:00:00Z`).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2)
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function hasStableLocationEvidence(current: any, previous: any): boolean {
  const cLat = Number(current.gps_latitude);
  const cLng = Number(current.gps_longitude);
  const pLat = Number(previous.gps_latitude);
  const pLng = Number(previous.gps_longitude);
  if (![cLat, cLng, pLat, pLng].every(Number.isFinite)) return true;
  return calculateDistanceMeters(cLat, cLng, pLat, pLng) <= 50;
}

function readEmbeddingVector(row: any): number[] | null {
  const raw = row?.vehicle_embedding ?? row?.embedding;
  if (!raw) return null;

  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const nums = parsed.map((v: unknown) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization token' }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 401 }
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
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 401 }
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
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    const allowedRoles = ['master', 'admin', 'admin_officer'];
    if (!allowedRoles.includes(profile.role)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions to run breach scan' }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 403 }
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
      .from('observations')
      .select('*')
      
      .order('recorded_at', { ascending: false });
    
    if (effectiveOrgId) {
      observationsQuery = observationsQuery.eq('organization_id', effectiveOrgId);
    }

    const { data: observations, error: observationsError } = await observationsQuery;
    if (observationsError) throw new Error(`Failed to fetch observations: ${observationsError.message}`);

    // Group observations by zone and plate
    const platesByZone = new Map<string, Set<string>>();
    const observationIdsByPlateZone = new Map<string, string[]>();
    const latestRecordedAtByPlateZone = new Map<string, string>();
    
    for (const obs of observations || []) {
      const key = `${obs.zone_id}:${obs.plate_number}`;
      
      if (!platesByZone.has(obs.zone_id)) {
        platesByZone.set(obs.zone_id, new Set());
      }
      platesByZone.get(obs.zone_id)!.add(obs.plate_number);
      
      if (!observationIdsByPlateZone.has(key)) {
        observationIdsByPlateZone.set(key, []);
      }
      observationIdsByPlateZone.get(key)!.push(obs.observation_id);

      if (obs.recorded_at) {
        const currentLatest = latestRecordedAtByPlateZone.get(key);
        if (!currentLatest || new Date(obs.recorded_at).getTime() > new Date(currentLatest).getTime()) {
          latestRecordedAtByPlateZone.set(key, obs.recorded_at);
        }
      }
    }

    console.log(`Scanning ${observations?.length || 0} vehicle observations across ${zones?.length || 0} zones`);

    const breachesDetected: BreachDetection[] = [];

    const orgIds = [...new Set((zones || []).map((z: any) => z.organization_id).filter(Boolean))];
    const { data: orgRows } = await supabaseAdmin
      .from('organizations')
      .select('id, overnight_verification_mode')
      .in('id', orgIds);

    const overnightModeByOrg = new Map<string, OvernightVerificationMode>(
      (orgRows ?? []).map((o: any) => [
        String(o.id),
        (o.overnight_verification_mode === 'one_photo_per_day_inference'
          ? 'one_photo_per_day_inference'
          : 'two_photo_verification') as OvernightVerificationMode,
      ]),
    );

    const evidenceObservationsByPlateZone = new Map<string, any[]>();
    for (const obs of observations || []) {
      const bucketKey = `${obs.organization_id}:${obs.zone_id}:${obs.plate_number}`;
      const bucket = evidenceObservationsByPlateZone.get(bucketKey) ?? [];
      bucket.push(obs);
      evidenceObservationsByPlateZone.set(bucketKey, bucket);
    }
    for (const [, bucket] of evidenceObservationsByPlateZone) {
      bucket.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    }

    // Process each zone
    for (const zone of zones || []) {
      const platesInZone = platesByZone.get(zone.id);
      if (!platesInZone || platesInZone.size === 0) continue;

      // Check each unique plate in this zone using centralized compliance function
      for (const plateNumber of platesInZone) {
        const key = `${zone.id}:${plateNumber}`;
        const evidenceKey = `${zone.organization_id}:${zone.id}:${plateNumber}`;
        const observationIds = observationIdsByPlateZone.get(key) || [];
        const sourceRecordedAt = latestRecordedAtByPlateZone.get(key);
        const checkDate = sourceRecordedAt
          ? sourceRecordedAt.split('T')[0]
          : new Date().toISOString().split('T')[0];
        const overnightMode = overnightModeByOrg.get(String(zone.organization_id)) ?? 'two_photo_verification';

        const hasTwoPhotoEvidence = (() => {
          const bucket = evidenceObservationsByPlateZone.get(evidenceKey) ?? [];
          if (bucket.length < 2) return false;

          for (let i = 1; i < bucket.length; i++) {
            const previous = bucket[i - 1];
            const current = bucket[i];
            if (dayDiffInNz(current.recorded_at, previous.recorded_at) !== 1) continue;
            if (hasStableLocationEvidence(current, previous)) return true;
          }

          return false;
        })();

        const hasInferenceEvidence = (() => {
          const bucket = evidenceObservationsByPlateZone.get(evidenceKey) ?? [];
          if (bucket.length < 2) return false;

          for (let i = 1; i < bucket.length; i++) {
            const previous = bucket[i - 1];
            const current = bucket[i];
            if (dayDiffInNz(current.recorded_at, previous.recorded_at) !== 1) continue;
            if (!hasStableLocationEvidence(current, previous)) continue;

            const currentEmbedding = readEmbeddingVector(current);
            const previousEmbedding = readEmbeddingVector(previous);
            if (!currentEmbedding || !previousEmbedding || currentEmbedding.length !== previousEmbedding.length) continue;

            if (cosineSimilarity(currentEmbedding, previousEmbedding) >= EMBEDDING_MATCH_THRESHOLD) {
              return true;
            }
          }

          return false;
        })();
        
        // Call centralized compliance calculation function
        const { data: complianceData, error: complianceError } = await supabaseAdmin
          .rpc('calculate_vehicle_compliance_v3', {
            p_plate_number: plateNumber,
            p_zone_id: zone.id,
            p_check_date: checkDate
          });

        if (complianceError) {
          console.error(`Compliance check failed for ${plateNumber} in ${zone.name}:`, complianceError);
          continue;
        }

        if (!complianceData || complianceData.length === 0) continue;
        
        const compliance = complianceData[0];

        // Only create breach if violation is critical (not compliant) or at-risk (moderate warning)
        if (!compliance.is_compliant || compliance.at_risk) {

          const overstayType = compliance.breach_type === 'monthly_limit_exceeded'
            || compliance.breach_type === 'consecutive_nights_exceeded'
            || compliance.breach_type === 'monthly_overstay'
            || compliance.breach_type === 'consecutive_overstay';

          const overnightEvidenceOk = overnightMode === 'two_photo_verification'
            ? hasTwoPhotoEvidence
            : hasInferenceEvidence;

          if (overstayType && !overnightEvidenceOk) {
            continue;
          }
          
          breachesDetected.push({
            plateNumber,
            zoneId: zone.id,
            zoneName: zone.name,
            organizationId: zone.organization_id,
            breachType: compliance.breach_type || 'unknown',
            breachDetails: {
              message: compliance.violation_reasons?.join('; ') || null,
              severity: !compliance.is_compliant ? 'critical' : compliance.at_risk ? 'moderate' : 'advisory',
              consecutiveNights: compliance.consecutive_nights,
              consecutiveLimit: compliance.consecutive_allowed,
              monthNights: compliance.nights_stayed,
              monthLimit: compliance.nights_allowed,
              fineAmount: null,
              recommendedAction: null,
              observation_ids: observationIds,
            },
            vehicleRecordIds: [], // No vehicle_records in new schema
            sourceRecordedAt,
          });
        }
      }
    }

    console.log(`Detected ${breachesDetected.length} breaches using centralized compliance function`);

    // Create breach alerts if autoCreate is true
    let alertsCreated = 0;
    if (autoCreate && breachesDetected.length > 0) {
      // Check for existing alerts to avoid duplicates (by plate + zone + type)
      // Use plate_number column directly instead of extracting from breach_details JSON
      const { data: existingAlerts } = await supabaseAdmin
        .from('breach_alerts')
        .select('zone_id, breach_type, plate_number')
        .eq('status', 'pending');

      const existingAlertSet = new Set(
        (existingAlerts || []).map(a => `${a.zone_id}-${a.plate_number}-${a.breach_type}`)
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
          plate_number: breach.plateNumber,
          zone_id: breach.zoneId,
          breach_type: breach.breachType,
          breach_details: {
            ...breach.breachDetails,
            plate_number: breach.plateNumber,
          },
          due_date: breach.dueDate || null,
          created_at: breach.sourceRecordedAt,
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
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
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
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
