import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

/**
 * GET COMPLIANCE STATISTICS - REAL-TIME REPORTS
 * 
 * This function calculates real-time compliance statistics by calling
 * calculate_vehicle_compliance_v3() for all unique plate/zone combinations
 * 
 * Returns accurate counts for:
 * - Total vehicles
 * - Compliant vehicles
 * - Non-compliant vehicles (by severity)
 * - Homeless claims
 * - Breach types
 * - Zone-by-zone breakdown
 */

interface ComplianceStats {
  totalVehicles: number;
  compliantVehicles: number;
  nonCompliantVehicles: number;
  criticalBreaches: number;
  warnings: number;
  homelessClaimed: number;
  homelessConfirmed: number;
  averageComplianceRate: number;
  breachTypes: Record<string, number>;
  zoneBreakdown: Array<{
    zoneId: string;
    zoneName: string;
    totalVehicles: number;
    compliantVehicles: number;
    complianceRate: number;
    breaches: number;
  }>;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  // Require authenticated callers — this endpoint returns sensitive compliance data
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  try {
    // Parse request body (if present) — GET requests may not have a body
    let organizationId = 'all';
    let startDate: string | undefined;
    let endDate: string | undefined;

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await req.json();
      organizationId = body.organizationId || 'all';
      startDate = body.startDate;
      endDate = body.endDate;
    } else {
      // For GET requests, try to parse query parameters
      const url = new URL(req.url);
      organizationId = url.searchParams.get('organizationId') || 'all';
      startDate = url.searchParams.get('startDate') || undefined;
      endDate = url.searchParams.get('endDate') || undefined;
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('📊 Calculating real-time compliance statistics...');

    // Get unique plate/zone combinations within date range
    let observationsQuery = supabaseAdmin
      .from('observations')
      .select('plate_number, zone_id, organization_id, has_homeless_claim, zones!inner(name)');

    if (organizationId && organizationId !== 'all') {
      observationsQuery = observationsQuery.eq('organization_id', organizationId);
    }

    if (startDate) {
      observationsQuery = observationsQuery.gte('recorded_at', startDate);
    }

    if (endDate) {
      observationsQuery = observationsQuery.lte('recorded_at', endDate);
    }

    const { data: observations, error: observationsError } = await observationsQuery;

    if (observationsError) {
      console.error('Failed to fetch observations:', observationsError);
      throw observationsError;
    }

    // Group by plate + zone to get unique vehicles
    const uniqueVehicles = new Map<string, {
      plateNumber: string;
      zoneId: string;
      zoneName: string;
      organizationId: string;
      homelessClaimed: boolean;
    }>();

    for (const obs of observations || []) {
      const key = `${obs.plate_number}:${obs.zone_id}`;
      if (!uniqueVehicles.has(key)) {
        uniqueVehicles.set(key, {
          plateNumber: obs.plate_number,
          zoneId: obs.zone_id,
          zoneName: (obs as any).zones?.name || 'Unknown',
          organizationId: obs.organization_id,
          homelessClaimed: obs.has_homeless_claim || false,
        });
      }
    }

    // Get homeless confirmation status from canonical_vehicles
    const uniquePlates = Array.from(new Set(Array.from(uniqueVehicles.values()).map(v => v.plateNumber)));
    const { data: canonicalVehicles } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('plate_number, homeless_confirmed')
      .in('plate_number', uniquePlates);

    const homelessConfirmedMap = new Map<string, boolean>();
    for (const cv of canonicalVehicles || []) {
      if (cv.homeless_confirmed === true) {
        homelessConfirmedMap.set(cv.plate_number, true);
      }
    }

    console.log(`Found ${uniqueVehicles.size} unique vehicles to check`);

    const stats: ComplianceStats = {
      totalVehicles: uniqueVehicles.size,
      compliantVehicles: 0,
      nonCompliantVehicles: 0,
      criticalBreaches: 0,
      warnings: 0,
      homelessClaimed: 0,
      homelessConfirmed: 0,
      averageComplianceRate: 0,
      breachTypes: {},
      zoneBreakdown: [],
    };

    const zoneStats = new Map<string, {
      zoneName: string;
      totalVehicles: number;
      compliantVehicles: number;
      breaches: number;
    }>();

    // Calculate compliance for each unique vehicle
    let processedCount = 0;
    for (const [key, vehicle] of uniqueVehicles) {
      processedCount++;
      
      if (processedCount % 10 === 0) {
        console.log(`Progress: ${processedCount}/${uniqueVehicles.size}`);
      }

      // Call centralized compliance function
      const { data: complianceData, error: complianceError } = await supabaseAdmin
        .rpc('calculate_vehicle_compliance_v3', {
          p_plate_number: vehicle.plateNumber,
          p_zone_id: vehicle.zoneId,
          p_check_date: new Date().toISOString().split('T')[0]
        });

      if (complianceError) {
        console.error(`Compliance check failed for ${vehicle.plateNumber}:`, complianceError);
        continue;
      }

      if (!complianceData || complianceData.length === 0) continue;

      const compliance = complianceData[0];

      // Count homeless
      if (vehicle.homelessClaimed) {
        stats.homelessClaimed++;
      }
      if (homelessConfirmedMap.get(vehicle.plateNumber) === true) {
        stats.homelessConfirmed++;
      }

      // Update zone stats
      if (!zoneStats.has(vehicle.zoneId)) {
        zoneStats.set(vehicle.zoneId, {
          zoneName: vehicle.zoneName,
          totalVehicles: 0,
          compliantVehicles: 0,
          breaches: 0,
        });
      }
      const zoneStat = zoneStats.get(vehicle.zoneId)!;
      zoneStat.totalVehicles++;

      // Determine compliance status using v3 fields (is_compliant, at_risk, breach_type)
      const isCompliant = compliance.is_compliant && !compliance.at_risk;

      if (isCompliant) {
        stats.compliantVehicles++;
        zoneStat.compliantVehicles++;
      } else {
        stats.nonCompliantVehicles++;
        zoneStat.breaches++;

        // Count by severity derived from v3 is_compliant/at_risk flags
        if (!compliance.is_compliant) {
          stats.criticalBreaches++;
        } else if (compliance.at_risk) {
          stats.warnings++;
        }

        // Count by breach type (v3 uses breach_type instead of violation_type)
        if (compliance.breach_type) {
          stats.breachTypes[compliance.breach_type] = 
            (stats.breachTypes[compliance.breach_type] || 0) + 1;
        }
      }
    }

    // Calculate average compliance rate
    stats.averageComplianceRate = stats.totalVehicles > 0
      ? Math.round((stats.compliantVehicles / stats.totalVehicles) * 100)
      : 100;

    // Build zone breakdown
    stats.zoneBreakdown = Array.from(zoneStats.entries()).map(([zoneId, zoneStat]) => ({
      zoneId,
      zoneName: zoneStat.zoneName,
      totalVehicles: zoneStat.totalVehicles,
      compliantVehicles: zoneStat.compliantVehicles,
      complianceRate: zoneStat.totalVehicles > 0
        ? Math.round((zoneStat.compliantVehicles / zoneStat.totalVehicles) * 100)
        : 100,
      breaches: zoneStat.breaches,
    }));

    console.log('📊 Statistics calculated:', {
      total: stats.totalVehicles,
      compliant: stats.compliantVehicles,
      nonCompliant: stats.nonCompliantVehicles,
      avgRate: stats.averageComplianceRate,
    });

    return new Response(
      JSON.stringify({
        success: true,
        stats,
      }),
      {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('❌ Statistics calculation failed:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
