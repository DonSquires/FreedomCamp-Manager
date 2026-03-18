import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Generate Dashboard PDF Report
 * Comprehensive summary report with breach and at-risk vehicles for selected date range
 */

interface DashboardReportRequest {
  organization_id?: string;
  report_type?: string;
  date_from?: string;
  date_to?: string;
  start_date?: string;
  end_date?: string;
  zone_id?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      organization_id,
      report_type,
      date_from,
      date_to,
      start_date,
      end_date,
      zone_id,
    } = await req.json() as DashboardReportRequest;

    const normalizedDateFrom = date_from ?? start_date;
    const normalizedDateTo = date_to ?? end_date;

    if (!normalizedDateFrom || !normalizedDateTo) {
      return new Response(
        JSON.stringify({ error: 'date_from/date_to (or start_date/end_date) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const reportType = report_type || 'compliance';

    console.log('📊 Generating dashboard report:', {
      organization_id,
      report_type: reportType,
      date_from: normalizedDateFrom,
      date_to: normalizedDateTo,
      zone_id,
    });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Build date range strings
    const startDateTime = `${normalizedDateFrom}T00:00:00`;
    const endDateTime = `${normalizedDateTo}T23:59:59`;

    // Build queries that don't depend on each other and can run in parallel
    let obsQuery = supabase
      .from('observations')
      .select(`
        plate_number,
        zone_id,
        organization_id,
        is_compliant,
        breach_type,
        recorded_at,
        nights_stayed_this_month,
        consecutive_nights,
        zones(name),
        organizations(name)
      `)
      .gte('recorded_at', startDateTime)
      .lte('recorded_at', endDateTime);

    if (organization_id) obsQuery = obsQuery.eq('organization_id', organization_id);
    if (zone_id) obsQuery = obsQuery.eq('zone_id', zone_id);

    let enforcementQuery = supabase
      .from('enforcement_actions')
      .select('action_type, completion_outcome, created_at')
      .gte('created_at', startDateTime)
      .lte('created_at', endDateTime);

    if (organization_id) enforcementQuery = enforcementQuery.eq('organization_id', organization_id);
    if (zone_id) enforcementQuery = enforcementQuery.eq('zone_id', zone_id);

    let matrixQuery = supabase
      .from('zone_compliance_matrix')
      .select('zone_id, max_consecutive_nights, nights_per_month')
      .is('effective_to', null);

    if (organization_id) matrixQuery = matrixQuery.eq('organization_id', organization_id);

    // Run independent queries in parallel to reduce total round-trip time
    const [
      { data: observations, error: obsError },
      { data: enforcementActions },
      { data: matrices },
    ] = await Promise.all([obsQuery, enforcementQuery, matrixQuery]);

    if (obsError) throw obsError;

    const obs = observations || [];
    const uniquePlates = [...new Set(obs.map((o: any) => o.plate_number))];

    console.log(`✅ Loaded ${obs.length} observations for ${uniquePlates.length} unique vehicles`);

    const enforcementRows = enforcementActions || [];
    const matrixMap = new Map(matrices?.map((m: any) => [m.zone_id, m]) || []);

    // Load vehicle details (depends on uniquePlates derived from obs)
    let vehicleData: any[] = [];
    if (uniquePlates.length > 0) {
      const { data: vehicles } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .in('plate_number', uniquePlates);
      
      vehicleData = vehicles || [];
    }

    const vehicleMap = new Map(vehicleData.map((v: any) => [v.plate_number, v]));

    // Derive compliance snapshots per plate+zone from the already-loaded observations.
    const getMonthlyNights = (o: any): number =>
      Number(o?.nights_stayed_this_month ?? 0) || 0;
    const getConsecutiveNights = (o: any): number =>
      Number(o?.consecutive_nights ?? 0) || 0;

    const staysByPlateZone = new Map<string, any>();
    for (const o of obs) {
      const key = `${o.plate_number}:${o.zone_id}`;
      const existing = staysByPlateZone.get(key);
      const monthlyNights = getMonthlyNights(o);
      const consecutiveNights = getConsecutiveNights(o);

      if (!existing || monthlyNights > (existing.nights_stayed ?? 0)) {
        staysByPlateZone.set(key, {
          plate_number:      o.plate_number,
          zone_id:           o.zone_id,
          nights_stayed:     monthlyNights,
          consecutive_nights: consecutiveNights,
          zones:             o.zones,
        });
      }
    }
    const stays = [...staysByPlateZone.values()];

    // Calculate overstayers and at-risk vehicles
    const overstayersMap = new Map<string, any[]>();
    const atRiskMap = new Map<string, any[]>();

    (stays || []).forEach((stay: any) => {
      const rules = matrixMap.get(stay.zone_id);
      if (!rules) return;

      const stayInfo = {
        zone_name: stay.zones?.name || 'Unknown Zone',
        consecutive_nights: stay.consecutive_nights,
        nights_stayed: stay.nights_stayed,
        max_consecutive: rules.max_consecutive_nights,
        monthly_limit: rules.nights_per_month,
      };

      if (stay.consecutive_nights > rules.max_consecutive_nights || stay.nights_stayed > rules.nights_per_month) {
        if (!overstayersMap.has(stay.plate_number)) {
          overstayersMap.set(stay.plate_number, []);
        }
        overstayersMap.get(stay.plate_number)!.push(stayInfo);
      } else if (stay.consecutive_nights === rules.max_consecutive_nights || stay.nights_stayed === rules.nights_per_month) {
        if (!atRiskMap.has(stay.plate_number)) {
          atRiskMap.set(stay.plate_number, []);
        }
        atRiskMap.get(stay.plate_number)!.push(stayInfo);
      }
    });

    // Build breach and at-risk vehicle lists
    const breachVehicles: any[] = [];
    const atRiskVehicles: any[] = [];

    overstayersMap.forEach((stayInfos, plate) => {
      const vehicle = vehicleMap.get(plate);
      if (vehicle) {
        breachVehicles.push({
          plate_number: plate,
          vehicle_make: vehicle.vehicle_make,
          vehicle_model: vehicle.vehicle_model,
          vehicle_year: vehicle.vehicle_year,
          vehicle_color: vehicle.vehicle_color,
          profile_photo: vehicle.profile_photo,
          is_flagged: vehicle.is_flagged,
          flagged_reason: vehicle.flagged_reason,
          homeless_status: vehicle.homeless_status,
          breach_zones: stayInfos,
          total_observations: vehicle.total_observations,
          first_seen: vehicle.first_seen_at,
          last_seen: vehicle.last_seen_at,
        });
      }
    });

    atRiskMap.forEach((stayInfos, plate) => {
      const vehicle = vehicleMap.get(plate);
      if (vehicle && !overstayersMap.has(plate)) {  // Don't duplicate if already in breach
        atRiskVehicles.push({
          plate_number: plate,
          vehicle_make: vehicle.vehicle_make,
          vehicle_model: vehicle.vehicle_model,
          vehicle_year: vehicle.vehicle_year,
          vehicle_color: vehicle.vehicle_color,
          profile_photo: vehicle.profile_photo,
          is_flagged: vehicle.is_flagged,
          flagged_reason: vehicle.flagged_reason,
          homeless_status: vehicle.homeless_status,
          at_risk_zones: stayInfos,
          total_observations: vehicle.total_observations,
          first_seen: vehicle.first_seen_at,
          last_seen: vehicle.last_seen_at,
        });
      }
    });

    // Sort by last seen (most recent first)
    breachVehicles.sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());
    atRiskVehicles.sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());

    // Build top vehicle activity list
    const vehicleActivityMap = new Map<string, any>();
    for (const o of obs) {
      if (!vehicleActivityMap.has(o.plate_number)) {
        const vehicle = vehicleMap.get(o.plate_number);
        vehicleActivityMap.set(o.plate_number, {
          plate_number: o.plate_number,
          vehicle_make: vehicle?.vehicle_make || 'Unknown',
          vehicle_model: vehicle?.vehicle_model || '',
          observations: 0,
          non_compliant_observations: 0,
          zones: new Set<string>(),
          first_seen: o.recorded_at,
          last_seen: o.recorded_at,
        });
      }

      const row = vehicleActivityMap.get(o.plate_number);
      row.observations += 1;
      if (!o.is_compliant) row.non_compliant_observations += 1;
      row.zones.add(o.zones?.name || 'Unknown Zone');
      if (new Date(o.recorded_at).getTime() < new Date(row.first_seen).getTime()) row.first_seen = o.recorded_at;
      if (new Date(o.recorded_at).getTime() > new Date(row.last_seen).getTime()) row.last_seen = o.recorded_at;
    }

    const topVehicles = Array.from(vehicleActivityMap.values())
      .map((v: any) => ({
        ...v,
        zone_count: v.zones.size,
        zones: Array.from(v.zones),
      }))
      .sort((a, b) => b.observations - a.observations)
      .slice(0, 10);

    // Calculate zone statistics
    const zoneStatsMap = new Map<string, any>();
    const uniqueZoneIds = new Set(obs.map((o: any) => o.zone_id));
    const plateZoneMap = new Map<string, Set<string>>();

    // Build plate-zone observation map
    obs.forEach((o: any) => {
      if (!plateZoneMap.has(o.plate_number)) {
        plateZoneMap.set(o.plate_number, new Set());
      }
      plateZoneMap.get(o.plate_number)!.add(o.zone_id);
    });

    // Initialize zone stats
    obs.forEach((o: any) => {
      if (!zoneStatsMap.has(o.zone_id)) {
        zoneStatsMap.set(o.zone_id, {
          zone_id: o.zone_id,
          zone_name: o.zones?.name || 'Unknown Zone',
          observations: 0,
          vehicles: new Set(),
          overstayers: new Set(),
          atRisk: new Set(),
        });
      }
      const zoneData = zoneStatsMap.get(o.zone_id);
      zoneData.observations++;
      zoneData.vehicles.add(o.plate_number);
    });

    // Add breach/at-risk counts to zones
    (stays || []).forEach((stay: any) => {
      const rules = matrixMap.get(stay.zone_id);
      if (!rules || !zoneStatsMap.has(stay.zone_id)) return;

      const zoneData = zoneStatsMap.get(stay.zone_id);
      const plateZones = plateZoneMap.get(stay.plate_number);
      if (!plateZones || !plateZones.has(stay.zone_id)) return;

      if (stay.consecutive_nights > rules.max_consecutive_nights || stay.nights_stayed > rules.nights_per_month) {
        zoneData.overstayers.add(stay.plate_number);
      } else if (stay.consecutive_nights === rules.max_consecutive_nights || stay.nights_stayed === rules.nights_per_month) {
        zoneData.atRisk.add(stay.plate_number);
      }
    });

    // Convert to array and calculate compliance
    const zoneStats = Array.from(zoneStatsMap.values()).map((z: any) => {
      const vehicleCount = z.vehicles.size;
      const compliant = vehicleCount - z.overstayers.size;
      return {
        zone_name: z.zone_name,
        observations: z.observations,
        vehicles: vehicleCount,
        overstayers: z.overstayers.size,
        at_risk: z.atRisk.size,
        compliant,
        compliance_rate: vehicleCount > 0 ? Math.round((compliant / vehicleCount) * 100) : 100,
      };
    }).sort((a, b) => b.observations - a.observations);

    const zoneHotspots = zoneStats.slice(0, 5).map((z: any) => ({
      zone_name: z.zone_name,
      observations: z.observations,
      compliance_rate: z.compliance_rate,
    }));

    const enforcementByType = new Map<string, number>();
    const enforcementByOutcome = new Map<string, number>();
    for (const action of enforcementRows) {
      const type = action.action_type || 'unknown';
      const outcome = action.completion_outcome || 'unknown';
      enforcementByType.set(type, (enforcementByType.get(type) || 0) + 1);
      enforcementByOutcome.set(outcome, (enforcementByOutcome.get(outcome) || 0) + 1);
    }

    const enforcementSummary = {
      total_actions: enforcementRows.length,
      by_type: Array.from(enforcementByType.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      by_outcome: Array.from(enforcementByOutcome.entries())
        .map(([outcome, count]) => ({ outcome, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };

    // Calculate overall statistics
    const totalObservations = obs.length;
    const totalVehicles = uniquePlates.length;
    const totalBreaches = breachVehicles.length;
    const totalAtRisk = atRiskVehicles.length;
    const totalZones = uniqueZoneIds.size;
    const complianceRate = totalVehicles > 0 
      ? Math.round(((totalVehicles - totalBreaches) / totalVehicles) * 100)
      : 100;

    // Load organization name and zone name in parallel
    const [orgResult, zoneResult] = await Promise.all([
      organization_id
        ? supabase.from('organizations').select('name').eq('id', organization_id).single()
        : Promise.resolve({ data: null }),
      zone_id
        ? supabase.from('zones').select('name').eq('id', zone_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const organizationName = orgResult.data?.name ?? 'All Organizations';
    const zoneName = zoneResult.data?.name ?? 'All Zones';

    // Generate HTML
    const html = generateReportHTML({
      reportType,
      dateFrom: normalizedDateFrom,
      dateTo: normalizedDateTo,
      organizationName,
      zoneName,
      stats: {
        totalObservations,
        totalVehicles,
        totalZones,
        totalBreaches,
        totalAtRisk,
        complianceRate,
      },
      zoneStats,
      breachVehicles,
      atRiskVehicles,
      topVehicles,
      zoneHotspots,
      enforcementSummary,
    });

    const reportTitle = getReportTitle(reportType);
    const pdfMetadata = {
      title: reportTitle,
      subject: `${reportTitle} ${normalizedDateFrom} to ${normalizedDateTo}`,
      creator: 'FreedomCamp Manager',
      producer: 'FreedomCamp Manager PDF Generator',
      creationDate: new Date().toISOString(),
      keywords: ['dashboard', reportType, 'compliance', 'breach', 'at-risk', 'summary'].join(', '),
    };

    console.log(`✅ Report generated: ${totalBreaches} breaches, ${totalAtRisk} at risk`);

    return new Response(
      JSON.stringify({
        html,
        metadata: pdfMetadata,
        report_type: reportType,
        generated_at: new Date().toISOString(),
        stats: {
          totalObservations,
          totalVehicles,
          totalZones,
          totalBreaches,
          totalAtRisk,
          complianceRate,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Dashboard report generation error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to generate dashboard report' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function generateReportHTML(data: any): string {
  const {
    reportType,
    dateFrom,
    dateTo,
    organizationName,
    zoneName,
    stats,
    zoneStats,
    breachVehicles,
    atRiskVehicles,
    topVehicles,
    zoneHotspots,
    enforcementSummary,
  } = data;
  const reportTitle = getReportTitle(reportType);
  const escapedReportTitle = escapeHtml(reportTitle);
  const escapedOrganizationName = escapeHtml(organizationName);
  const escapedZoneName = escapeHtml(zoneName);

  const formatDate = (date: string) => new Date(date).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const formatDateTime = (date: string) => new Date(date).toLocaleString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const reportSubtitle = getReportSubtitle(reportType);

  let reportSpecificSections = '';
  if (reportType === 'enforcement') {
    reportSpecificSections = `${renderEnforcementSection(enforcementSummary)}${renderZoneStatsSection(zoneStats)}`;
  } else if (reportType === 'vehicle-activity') {
    reportSpecificSections = `${renderVehicleActivitySection(topVehicles)}${renderBreachVehiclesSection(breachVehicles)}${renderAtRiskVehiclesSection(atRiskVehicles)}`;
  } else if (reportType === 'zone-stats') {
    reportSpecificSections = `${renderZoneStatsSection(zoneStats)}${renderZoneHotspotsSection(zoneHotspots)}`;
  } else {
    reportSpecificSections = `${renderZoneStatsSection(zoneStats)}${renderBreachVehiclesSection(breachVehicles)}${renderAtRiskVehiclesSection(atRiskVehicles)}`;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <base href="https://www.ironeaglesecurity.co.nz">
  <title>${escapedReportTitle}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <style>
    @page {
      size: A4;
      margin: 1.5cm;
    }
    
    body {
      font-family: 'Helvetica', 'Arial', sans-serif;
      line-height: 1.5;
      color: #1e293b;
      max-width: 21cm;
      margin: 0 auto;
      padding: 15px;
      font-size: 10pt;
    }
    
    .header {
      text-align: center;
      border-bottom: 4px solid #0F172A;
      padding-bottom: 15px;
      margin-bottom: 25px;
    }
    
    .header h1 {
      margin: 0 0 8px 0;
      color: #0F172A;
      font-size: 28px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .header .subtitle {
      color: #64748b;
      margin: 5px 0;
      font-size: 13px;
    }
    
    .header .date-range {
      font-size: 14px;
      font-weight: 600;
      color: #334155;
      margin-top: 10px;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin: 20px 0;
      page-break-inside: avoid;
    }
    
    .stat-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    
    .stat-card.breach {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    }
    
    .stat-card.at-risk {
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    }
    
    .stat-card.compliance {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
    }
    
    .stat-value {
      font-size: 36px;
      font-weight: bold;
      margin: 8px 0;
      line-height: 1;
    }
    
    .stat-label {
      font-size: 11px;
      opacity: 0.95;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .section {
      margin: 25px 0;
      page-break-inside: avoid;
    }
    
    .section-title {
      font-size: 18px;
      font-weight: bold;
      color: #0F172A;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 6px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .section-title .badge {
      background: #ef4444;
      color: white;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
    }
    
    .section-title .badge.at-risk {
      background: #f59e0b;
    }
    
    .vehicle-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin: 12px 0;
    }
    
    .vehicle-card {
      border: 2px solid #dc2626;
      border-radius: 8px;
      padding: 12px;
      background: #fef2f2;
      page-break-inside: avoid;
    }
    
    .vehicle-card.at-risk {
      border-color: #d97706;
      background: #fffbeb;
    }
    
    .vehicle-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 10px;
      gap: 10px;
    }
    
    .vehicle-photo {
      width: 80px;
      height: 60px;
      border-radius: 6px;
      object-fit: cover;
      border: 2px solid #dc2626;
      flex-shrink: 0;
    }
    
    .vehicle-photo.at-risk {
      border-color: #d97706;
    }
    
    .vehicle-info {
      flex: 1;
      min-width: 0;
    }
    
    .plate-number {
      font-family: 'Courier New', monospace;
      font-size: 16px;
      font-weight: 900;
      color: #0F172A;
      margin-bottom: 4px;
    }
    
    .vehicle-details {
      font-size: 11px;
      color: #475569;
      margin-bottom: 2px;
    }
    
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      margin-right: 4px;
      margin-top: 4px;
    }
    
    .badge.flagged {
      background: #7c3aed;
      color: white;
    }
    
    .badge.homeless {
      background: #06b6d4;
      color: white;
    }
    
    .breach-details {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #fca5a5;
    }
    
    .breach-details.at-risk {
      border-top-color: #fcd34d;
    }
    
    .breach-zone {
      background: white;
      padding: 8px;
      border-radius: 4px;
      margin-bottom: 6px;
      font-size: 10px;
    }
    
    .breach-zone-name {
      font-weight: 700;
      color: #dc2626;
      margin-bottom: 3px;
    }
    
    .breach-zone-name.at-risk {
      color: #d97706;
    }
    
    .breach-metric {
      display: flex;
      justify-content: space-between;
      margin: 2px 0;
      font-size: 9px;
    }
    
    .breach-metric-label {
      color: #64748b;
    }
    
    .breach-metric-value {
      font-weight: 700;
      color: #dc2626;
    }
    
    .breach-metric-value.at-risk {
      color: #d97706;
    }
    
    .footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      font-size: 10px;
      color: #64748b;
      page-break-inside: avoid;
    }
    
    .no-data {
      padding: 30px;
      text-align: center;
      background: #f8fafc;
      border-radius: 8px;
      color: #64748b;
      font-size: 12px;
    }
    
    @media print {
      body {
        padding: 0;
      }
      .export-buttons {
        display: none !important;
      }
    }
    
    .export-buttons {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 1000;
      display: flex;
      gap: 10px;
      padding: 12px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    
    .export-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }
    
    .export-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    }
    
    .btn-download {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    
    .btn-print {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: white;
    }
    
    .btn-close {
      background: #e2e8f0;
      color: #334155;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .spinner {
      animation: spin 1s linear infinite;
    }
  </style>
</head>
<body>
  <div class="export-buttons">
    <button class="export-btn btn-download" onclick="downloadPDF()">
      <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
        <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
      </svg>
      Download PDF
    </button>
    <button class="export-btn btn-print" onclick="window.print()">
      <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"/>
        <path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2H5zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4V3zm1 5a2 2 0 0 0-2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2H5zm7 2v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1z"/>
      </svg>
      Print
    </button>
    <button class="export-btn btn-close" onclick="window.close()">
      <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
      </svg>
      Close
    </button>
  </div>
  
  <div id="report-content">
  <div class="header">
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <img src="/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" style="height:36px;object-fit:contain;">
    </div>
    <h1>📊 ${escapedReportTitle}</h1>
    <div class="subtitle">${escapeHtml(reportSubtitle)}</div>
    <div class="subtitle">${escapedOrganizationName} • ${escapedZoneName}</div>
    <div class="date-range">
      ${formatDate(dateFrom)} - ${formatDate(dateTo)}
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Total Observations</div>
      <div class="stat-value">${stats.totalObservations.toLocaleString()}</div>
      <div class="stat-label">${stats.totalVehicles} Vehicles • ${stats.totalZones} Zones</div>
    </div>
    <div class="stat-card breach">
      <div class="stat-label">⚠️ Breaches</div>
      <div class="stat-value">${stats.totalBreaches}</div>
      <div class="stat-label">Vehicles Overstaying</div>
    </div>
    <div class="stat-card at-risk">
      <div class="stat-label">⏰ At Risk</div>
      <div class="stat-value">${stats.totalAtRisk}</div>
      <div class="stat-label">1 Night From Breach</div>
    </div>
  </div>

  <div class="stats-grid" style="grid-template-columns: 1fr;">
    <div class="stat-card compliance">
      <div class="stat-label">Compliance Rate</div>
      <div class="stat-value">${stats.complianceRate}%</div>
      <div class="stat-label">${stats.totalVehicles - stats.totalBreaches} of ${stats.totalVehicles} Vehicles Compliant</div>
    </div>
  </div>

  ${reportSpecificSections}

  <div class="footer">
    <p><strong>FreedomCamp Manager</strong> - ${escapedReportTitle}</p>
    <p>Generated: ${formatDateTime(new Date().toISOString())}</p>
    <p style="margin-top: 8px; font-size: 9px;">
      ${escapeHtml(getReportFooter(reportType))}
    </p>
  </div>
  </div>
  
  <script>
    function downloadPDF(triggerEl) {
      const button = triggerEl || document.querySelector('.btn-download');
      const originalContent = button ? button.innerHTML : '';

      // Show loading state when a trigger button is available.
      if (button) {
        button.innerHTML = '<svg class="spinner" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg> Generating...';
        button.disabled = true;
      }

      const element = document.getElementById('report-content');
      const opt = {
        margin: 10,
        filename: 'dashboard-report-${formatDate(dateFrom)}-to-${formatDate(dateTo)}.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      html2pdf().set(opt).from(element).save().then(() => {
        if (button) {
          button.innerHTML = originalContent;
          button.disabled = false;
        }
      }).catch(err => {
        console.error('PDF generation error:', err);
        alert('Failed to generate PDF. Please try printing instead.');
        if (button) {
          button.innerHTML = originalContent;
          button.disabled = false;
        }
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'p') {
          e.preventDefault();
          window.print();
        } else if (e.key === 's') {
          e.preventDefault();
          downloadPDF(document.querySelector('.btn-download'));
        }
      }
      if (e.key === 'Escape') {
        window.close();
      }
    });

    // Allow parent UI to trigger download via postMessage when report is opened
    // in a helper window/tab.
    window.addEventListener('message', (event) => {
      if (event?.data?.type === 'trigger-report-download-pdf') {
        downloadPDF(document.querySelector('.btn-download'));
      }
    });
  </script>
  <div style="margin-top:24px;padding-top:8px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:8pt;color:#94a3b8;">Generated by <strong style="color:#1e3a8a;">FreedomCamp Manager</strong> &mdash; Iron Eagle Security / OnSpace AI</span>
    <img src="/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" style="height:22px;opacity:0.55;object-fit:contain;">
  </div>
</body>
</html>
  `.trim();
}

function getReportSubtitle(reportType?: string): string {
  switch (reportType) {
    case 'enforcement':
      return 'Enforcement action volume, outcomes, and distribution';
    case 'vehicle-activity':
      return 'Vehicle observation frequency and compliance indicators';
    case 'zone-stats':
      return 'Zone-level performance and hotspot concentration';
    case 'compliance':
    default:
      return 'Comprehensive compliance analysis';
  }
}

function getReportFooter(reportType?: string): string {
  switch (reportType) {
    case 'enforcement':
      return 'This report focuses on enforcement actions by type and outcome for the selected period.';
    case 'vehicle-activity':
      return 'This report highlights the most observed vehicles and related non-compliant activity.';
    case 'zone-stats':
      return 'This report summarizes zone-level activity, compliance, and hotspot concentration.';
    case 'compliance':
    default:
      return 'This report shows compliance, breach, and at-risk indicators for the selected date range.';
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function renderZoneStatsSection(zoneStats: any[]): string {
  if (!zoneStats?.length) return '';

  return `
  <div class="section">
    <div class="section-title">
      <span>📍 ZONE PERFORMANCE</span>
      <span class="badge" style="background: #3b82f6;">${zoneStats.length}</span>
    </div>
    <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 12px;">
      <thead>
        <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
          <th style="text-align: left; padding: 10px; font-weight: 700; color: #0F172A;">Zone</th>
          <th style="text-align: center; padding: 10px; font-weight: 700; color: #0F172A;">Observations</th>
          <th style="text-align: center; padding: 10px; font-weight: 700; color: #0F172A;">Vehicles</th>
          <th style="text-align: center; padding: 10px; font-weight: 700; color: #0F172A;">Overstayers</th>
          <th style="text-align: center; padding: 10px; font-weight: 700; color: #0F172A;">At Risk</th>
          <th style="text-align: center; padding: 10px; font-weight: 700; color: #0F172A;">Compliance</th>
        </tr>
      </thead>
      <tbody>
        ${zoneStats.map((zone: any, idx: number) => `
          <tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 0 ? 'background: #f8fafc;' : ''}">
            <td style="padding: 10px; font-weight: 600; color: #334155;">${escapeHtml(zone.zone_name)}</td>
            <td style="text-align: center; padding: 10px; color: #475569;">${zone.observations}</td>
            <td style="text-align: center; padding: 10px; color: #475569;">${zone.vehicles}</td>
            <td style="text-align: center; padding: 10px;"><span style="color: ${zone.overstayers > 0 ? '#dc2626' : '#10b981'}; font-weight: 700;">${zone.overstayers}</span></td>
            <td style="text-align: center; padding: 10px;"><span style="color: ${zone.at_risk > 0 ? '#d97706' : '#10b981'}; font-weight: 700;">${zone.at_risk}</span></td>
            <td style="text-align: center; padding: 10px;">
              <span style="padding: 4px 10px; border-radius: 12px; font-weight: 700; font-size: 9px; ${zone.compliance_rate >= 80 ? 'background: #dcfce7; color: #166534;' : 'background: #fee2e2; color: #991b1b;'}">${zone.compliance_rate}%</span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderBreachVehiclesSection(breachVehicles: any[]): string {
  if (!breachVehicles?.length) return '<div class="section"><div class="no-data">✅ No vehicles currently in breach</div></div>';

  return `
  <div class="section">
    <div class="section-title"><span>🚨 VEHICLES IN BREACH</span><span class="badge">${breachVehicles.length}</span></div>
    <div class="vehicle-grid">
      ${breachVehicles.map((vehicle: any) => `
        <div class="vehicle-card">
          <div class="vehicle-header">
            <div class="vehicle-info">
              <div class="plate-number">${escapeHtml(vehicle.plate_number)}</div>
              <div class="vehicle-details">${escapeHtml(vehicle.vehicle_make || 'Unknown')} ${escapeHtml(vehicle.vehicle_model || '')} ${vehicle.vehicle_year ? `(${escapeHtml(vehicle.vehicle_year)})` : ''}</div>
              <div class="vehicle-details">${escapeHtml(vehicle.vehicle_color || 'Color Unknown')} • ${vehicle.total_observations} observations</div>
              ${vehicle.is_flagged ? '<span class="badge flagged">🚩 Flagged</span>' : ''}
              ${vehicle.homeless_status === 'confirmed' ? '<span class="badge homeless">🏠 Homeless</span>' : ''}
            </div>
            ${vehicle.profile_photo ? `<img src="${escapeAttr(vehicle.profile_photo)}" class="vehicle-photo" alt="${escapeAttr(vehicle.plate_number)}" />` : ''}
          </div>
          <div class="breach-details">
            ${vehicle.breach_zones.map((zone: any) => `
              <div class="breach-zone">
                <div class="breach-zone-name">${escapeHtml(zone.zone_name)}</div>
                ${zone.consecutive_nights > zone.max_consecutive ? `<div class="breach-metric"><span class="breach-metric-label">Consecutive Nights:</span><span class="breach-metric-value">${zone.consecutive_nights} / ${zone.max_consecutive} max</span></div>` : ''}
                ${zone.nights_stayed > zone.monthly_limit ? `<div class="breach-metric"><span class="breach-metric-label">Monthly Nights:</span><span class="breach-metric-value">${zone.nights_stayed} / ${zone.monthly_limit} max</span></div>` : ''}
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

function renderAtRiskVehiclesSection(atRiskVehicles: any[]): string {
  if (!atRiskVehicles?.length) return '<div class="section"><div class="no-data">✅ No vehicles currently at risk</div></div>';

  return `
  <div class="section">
    <div class="section-title"><span>⏰ VEHICLES AT RISK</span><span class="badge at-risk">${atRiskVehicles.length}</span></div>
    <div class="vehicle-grid">
      ${atRiskVehicles.map((vehicle: any) => `
        <div class="vehicle-card at-risk">
          <div class="vehicle-header">
            <div class="vehicle-info">
              <div class="plate-number">${escapeHtml(vehicle.plate_number)}</div>
              <div class="vehicle-details">${escapeHtml(vehicle.vehicle_make || 'Unknown')} ${escapeHtml(vehicle.vehicle_model || '')} ${vehicle.vehicle_year ? `(${escapeHtml(vehicle.vehicle_year)})` : ''}</div>
              <div class="vehicle-details">${escapeHtml(vehicle.vehicle_color || 'Color Unknown')} • ${vehicle.total_observations} observations</div>
              ${vehicle.is_flagged ? '<span class="badge flagged">🚩 Flagged</span>' : ''}
              ${vehicle.homeless_status === 'confirmed' ? '<span class="badge homeless">🏠 Homeless</span>' : ''}
            </div>
            ${vehicle.profile_photo ? `<img src="${escapeAttr(vehicle.profile_photo)}" class="vehicle-photo at-risk" alt="${escapeAttr(vehicle.plate_number)}" />` : ''}
          </div>
          <div class="breach-details at-risk">
            ${vehicle.at_risk_zones.map((zone: any) => `
              <div class="breach-zone">
                <div class="breach-zone-name at-risk">${escapeHtml(zone.zone_name)}</div>
                ${zone.consecutive_nights === zone.max_consecutive ? `<div class="breach-metric"><span class="breach-metric-label">Consecutive Nights:</span><span class="breach-metric-value at-risk">${zone.consecutive_nights} / ${zone.max_consecutive} max (AT LIMIT)</span></div>` : ''}
                ${zone.nights_stayed === zone.monthly_limit ? `<div class="breach-metric"><span class="breach-metric-label">Monthly Nights:</span><span class="breach-metric-value at-risk">${zone.nights_stayed} / ${zone.monthly_limit} max (AT LIMIT)</span></div>` : ''}
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

function renderEnforcementSection(enforcementSummary: any): string {
  const byType = enforcementSummary?.by_type || [];
  const byOutcome = enforcementSummary?.by_outcome || [];
  return `
  <div class="section">
    <div class="section-title"><span>🛡️ ENFORCEMENT SUMMARY</span><span class="badge" style="background: #3b82f6;">${enforcementSummary?.total_actions || 0}</span></div>
    <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 12px;">
      <thead>
        <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;"><th style="text-align: left; padding: 10px;">Action Type</th><th style="text-align: center; padding: 10px;">Count</th></tr>
      </thead>
      <tbody>
        ${byType.length ? byType.map((item: any, idx: number) => `<tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 0 ? 'background: #f8fafc;' : ''}"><td style="padding: 10px;">${escapeHtml(item.type)}</td><td style="text-align: center; padding: 10px;">${item.count}</td></tr>`).join('') : '<tr><td colspan="2" style="padding: 10px; text-align: center; color: #64748b;">No enforcement actions recorded.</td></tr>'}
      </tbody>
    </table>
    <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 12px;">
      <thead>
        <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;"><th style="text-align: left; padding: 10px;">Outcome</th><th style="text-align: center; padding: 10px;">Count</th></tr>
      </thead>
      <tbody>
        ${byOutcome.length ? byOutcome.map((item: any, idx: number) => `<tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 0 ? 'background: #f8fafc;' : ''}"><td style="padding: 10px;">${escapeHtml(item.outcome)}</td><td style="text-align: center; padding: 10px;">${item.count}</td></tr>`).join('') : '<tr><td colspan="2" style="padding: 10px; text-align: center; color: #64748b;">No outcomes available.</td></tr>'}
      </tbody>
    </table>
  </div>`;
}

function renderVehicleActivitySection(topVehicles: any[]): string {
  return `
  <div class="section">
    <div class="section-title"><span>🚗 TOP VEHICLE ACTIVITY</span><span class="badge" style="background: #16a34a;">${topVehicles?.length || 0}</span></div>
    <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 12px;">
      <thead>
        <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
          <th style="text-align: left; padding: 10px;">Plate</th>
          <th style="text-align: left; padding: 10px;">Vehicle</th>
          <th style="text-align: center; padding: 10px;">Observations</th>
          <th style="text-align: center; padding: 10px;">Non-Compliant</th>
          <th style="text-align: center; padding: 10px;">Zones</th>
        </tr>
      </thead>
      <tbody>
        ${topVehicles?.length ? topVehicles.map((v: any, idx: number) => `<tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 0 ? 'background: #f8fafc;' : ''}"><td style="padding: 10px; font-family: monospace; font-weight: 700;">${escapeHtml(v.plate_number)}</td><td style="padding: 10px;">${escapeHtml(v.vehicle_make)} ${escapeHtml(v.vehicle_model)}</td><td style="text-align: center; padding: 10px;">${v.observations}</td><td style="text-align: center; padding: 10px;">${v.non_compliant_observations}</td><td style="text-align: center; padding: 10px;">${v.zone_count}</td></tr>`).join('') : '<tr><td colspan="5" style="padding: 10px; text-align: center; color: #64748b;">No vehicle activity for selected period.</td></tr>'}
      </tbody>
    </table>
  </div>`;
}

function renderZoneHotspotsSection(zoneHotspots: any[]): string {
  return `
  <div class="section">
    <div class="section-title"><span>🔥 ZONE HOTSPOTS</span><span class="badge" style="background: #d97706;">${zoneHotspots?.length || 0}</span></div>
    <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 12px;">
      <thead>
        <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;"><th style="text-align: left; padding: 10px;">Zone</th><th style="text-align: center; padding: 10px;">Observations</th><th style="text-align: center; padding: 10px;">Compliance</th></tr>
      </thead>
      <tbody>
        ${zoneHotspots?.length ? zoneHotspots.map((zone: any, idx: number) => `<tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 0 ? 'background: #f8fafc;' : ''}"><td style="padding: 10px;">${escapeHtml(zone.zone_name)}</td><td style="text-align: center; padding: 10px;">${zone.observations}</td><td style="text-align: center; padding: 10px;">${zone.compliance_rate}%</td></tr>`).join('') : '<tr><td colspan="3" style="padding: 10px; text-align: center; color: #64748b;">No zone hotspots available.</td></tr>'}
      </tbody>
    </table>
  </div>`;
}

function getReportTitle(reportType?: string): string {
  switch (reportType) {
    case 'enforcement':
      return 'Enforcement Activity Report';
    case 'vehicle-activity':
      return 'Vehicle Activity Report';
    case 'zone-stats':
      return 'Zone Statistics Report';
    case 'compliance':
    default:
      return 'Compliance Report';
  }
}
