import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * GET COMPLIANCE STATISTICS - REAL-TIME REPORTS
 * 
 * This function calculates real-time compliance statistics by calling
 * calculate_vehicle_compliance() for all unique plate/zone combinations
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
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { organizationId, startDate, endDate } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('📊 Calculating real-time compliance statistics...');

    // Get unique plate/zone combinations within date range
    let observationsQuery = supabaseAdmin
      .from('vehicle_observations_v2')
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
        .rpc('calculate_vehicle_compliance', {
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

      // Determine compliance status
      const isCompliant = compliance.is_compliant && 
        compliance.violation_severity !== 'critical' && 
        compliance.violation_severity !== 'moderate';

      if (isCompliant) {
        stats.compliantVehicles++;
        zoneStat.compliantVehicles++;
      } else {
        stats.nonCompliantVehicles++;
        zoneStat.breaches++;

        // Count by severity
        if (compliance.violation_severity === 'critical') {
          stats.criticalBreaches++;
        } else if (compliance.violation_severity === 'warning' || compliance.violation_severity === 'moderate') {
          stats.warnings++;
        }

        // Count by breach type
        if (compliance.violation_type) {
          stats.breachTypes[compliance.violation_type] = 
            (stats.breachTypes[compliance.violation_type] || 0) + 1;
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
