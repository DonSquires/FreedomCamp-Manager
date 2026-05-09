import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';
import { requireAuth } from '../_shared/requireAuth.ts';

/**
 * Generate Leadership Pack PDF
 * Executive summary report with drift trends, zone performance, and matrix history
 */

interface LeadershipPackRequest {
  organization_id?: string;
  date_range_start?: string;
  date_range_end?: string;
  include_drift_trends?: boolean;
  include_zone_performance?: boolean;
  include_matrix_history?: boolean;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    // Authenticate — only logged-in users may generate leadership packs.
    const authResult = await requireAuth(req);
    if (!authResult.user) {
      return new Response(
        JSON.stringify({ error: authResult.error ?? 'Unauthorized' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const {
      organization_id,
      date_range_start,
      date_range_end,
      include_drift_trends = true,
      include_zone_performance = true,
      include_matrix_history = true,
    } = await req.json() as LeadershipPackRequest;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Build date filters
    const startDate = date_range_start || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = date_range_end || new Date().toISOString();

    // Build the three independent queries to run in parallel
    let driftQueryBuilder = supabase
      .from('drift_events')
      .select(`
        *,
        zone:zones(name),
        organization:organizations(name)
      `)
      .gte('detected_at', startDate)
      .lte('detected_at', endDate)
      .order('detected_at', { ascending: false });

    if (organization_id) {
      driftQueryBuilder = driftQueryBuilder.eq('organization_id', organization_id);
    }

    let zoneQueryBuilder = supabase
      .from('observations')
      .select(`
        zone_id,
        zone:zones(name, organization:organizations(name)),
        recorded_at
      `)
      .gte('recorded_at', startDate)
      .lte('recorded_at', endDate);

    if (organization_id) {
      zoneQueryBuilder = zoneQueryBuilder.eq('zone.organization_id', organization_id);
    }

    let matrixQueryBuilder = supabase
      .from('zone_compliance_matrix')
      .select(`
        *,
        zone:zones(name),
        organization:organizations(name)
      `)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false });

    if (organization_id) {
      matrixQueryBuilder = matrixQueryBuilder.eq('organization_id', organization_id);
    }

    // Run all independent queries in parallel
    const [
      driftResult,
      zoneResult,
      matrixResult,
    ] = await Promise.all([
      include_drift_trends     ? driftQueryBuilder  : Promise.resolve({ data: [], error: null }),
      include_zone_performance ? zoneQueryBuilder   : Promise.resolve({ data: [], error: null }),
      include_matrix_history   ? matrixQueryBuilder : Promise.resolve({ data: [], error: null }),
    ]);

    if (driftResult.error)  throw driftResult.error;
    if (matrixResult.error) throw matrixResult.error;

    const driftTrends = driftResult.data || [];
    const matrixHistory = matrixResult.data || [];

    // Aggregate zone observations
    const observations = zoneResult.data || [];
    const zoneMap = new Map();
    observations?.forEach((obs: any) => {
      const zoneId = obs.zone_id;
      if (!zoneMap.has(zoneId)) {
        zoneMap.set(zoneId, {
          zone_id: zoneId,
          zone_name: obs.zone?.name || 'Unknown',
          organization_name: obs.zone?.organization?.name || 'Unknown',
          total_observations: 0,
        });
      }
      const zone = zoneMap.get(zoneId);
      zone.total_observations += 1;
    });

    const zonePerformance = Array.from(zoneMap.values());

    // Generate HTML for PDF
    const html = generateLeadershipPackHTML({
      driftTrends,
      zonePerformance,
      matrixHistory,
      startDate,
      endDate,
      organizationId: organization_id,
    });

    const pdfMetadata = {
      title: 'Leadership Pack - Compliance Analytics',
      subject: 'Executive Summary Report',
      creator: 'Field Compliance Manager',
      producer: 'Field Compliance Manager PDF Generator',
      creationDate: new Date().toISOString(),
      keywords: ['leadership', 'analytics', 'compliance', 'drift', 'executive'].join(', '),
    };

    return new Response(
      JSON.stringify({
        html,
        metadata: pdfMetadata,
        generated_at: new Date().toISOString(),
        date_range: { start: startDate, end: endDate },
      }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Leadership pack generation error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to generate leadership pack' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});

function generateLeadershipPackHTML(data: any): string {
  const { driftTrends, zonePerformance, matrixHistory, startDate, endDate, organizationId } = data;

  const formatDate = (date: string) => new Date(date).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // Calculate drift statistics
  const criticalDrift = driftTrends.filter((d: any) => 
    d.criteria_changed?.some((c: any) => c.severity === 'CRITICAL')
  ).length;
  const warningDrift = driftTrends.filter((d: any) => 
    d.criteria_changed?.some((c: any) => c.severity === 'WARNING') &&
    !d.criteria_changed?.some((c: any) => c.severity === 'CRITICAL')
  ).length;
  const totalObservationsAffected = driftTrends.reduce((sum: number, d: any) => sum + (d.observations_affected || 0), 0);

  // Sort zones by observations
  const topZones = [...zonePerformance].sort((a, b) => b.total_observations - a.total_observations).slice(0, 10);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <base href="https://www.ironeaglesecurity.co.nz">
  <title>Leadership Pack - Compliance Analytics</title>
  <style>
    @page {
      size: A4;
      margin: 2cm;
    }
    
    body {
      font-family: 'Helvetica', 'Arial', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 21cm;
      margin: 0 auto;
      padding: 20px;
    }
    
    .header {
      text-align: center;
      border-bottom: 3px solid #0F172A;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    
    .header h1 {
      margin: 0;
      color: #0F172A;
      font-size: 32px;
    }
    
    .header .subtitle {
      color: #64748b;
      margin-top: 10px;
      font-size: 16px;
    }
    
    .executive-badge {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 8px 20px;
      border-radius: 20px;
      font-weight: bold;
      margin-top: 10px;
    }
    
    .section {
      margin: 30px 0;
      page-break-inside: avoid;
    }
    
    .section-title {
      font-size: 20px;
      font-weight: bold;
      color: #0F172A;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 8px;
      margin-bottom: 15px;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin: 20px 0;
    }
    
    .stat-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    
    .stat-card.critical {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    }
    
    .stat-card.warning {
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    }
    
    .stat-value {
      font-size: 48px;
      font-weight: bold;
      margin: 10px 0;
    }
    
    .stat-label {
      font-size: 14px;
      opacity: 0.9;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .chart-container {
      margin: 20px 0;
      page-break-inside: avoid;
    }
    
    .bar-chart {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    
    .bar-item {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .bar-label {
      width: 200px;
      font-size: 12px;
      font-weight: 600;
    }
    
    .bar-fill {
      flex: 1;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      height: 24px;
      border-radius: 4px;
      position: relative;
    }
    
    .bar-value {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      color: white;
      font-size: 11px;
      font-weight: bold;
    }
    
    .timeline {
      position: relative;
      padding-left: 30px;
      border-left: 3px solid #e2e8f0;
    }
    
    .timeline-item {
      position: relative;
      padding: 15px 0;
      margin-bottom: 20px;
    }
    
    .timeline-item::before {
      content: '';
      position: absolute;
      left: -36px;
      top: 20px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #667eea;
      border: 3px solid white;
      box-shadow: 0 0 0 3px #667eea;
    }
    
    .timeline-date {
      font-size: 12px;
      color: #64748b;
      font-weight: 600;
    }
    
    .timeline-content {
      background: #f8fafc;
      padding: 12px;
      border-radius: 6px;
      margin-top: 5px;
    }
    
    .drift-severity-critical {
      color: #dc2626;
      font-weight: bold;
    }
    
    .drift-severity-warning {
      color: #d97706;
      font-weight: bold;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    
    th, td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    
    th {
      background: #f8fafc;
      font-weight: 600;
      color: #0F172A;
    }
    
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      font-size: 12px;
      color: #64748b;
    }
    
    @media print {
      body {
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <img src="/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" style="height:40px;object-fit:contain;">
    </div>
    <h1>LEADERSHIP PACK</h1>
    <div class="subtitle">Compliance Analytics &amp; Executive Summary &mdash; Field Compliance Manager</div>
    <div class="executive-badge">CONFIDENTIAL - EXECUTIVE USE ONLY</div>
  </div>

  <div class="section">
    <div class="section-title">Reporting Period</div>
    <p style="font-size: 16px;">
      <strong>${formatDate(startDate)}</strong> to <strong>${formatDate(endDate)}</strong>
      ${organizationId ? ' • Organization-specific report' : ' • System-wide report'}
    </p>
  </div>

  <div class="section">
    <div class="section-title">Executive Summary</div>
    <div class="stats-grid">
      <div class="stat-card critical">
        <div class="stat-label">Critical Drift Events</div>
        <div class="stat-value">${criticalDrift}</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-label">Warning Drift Events</div>
        <div class="stat-value">${warningDrift}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Observations Affected</div>
        <div class="stat-value">${totalObservationsAffected.toLocaleString()}</div>
      </div>
    </div>
  </div>

  ${driftTrends.length > 0 ? `
  <div class="section">
    <div class="section-title">Drift Trend Analysis</div>
    <p style="font-size: 14px; color: #64748b; margin-bottom: 20px;">
      Compliance drift events indicate when matrix criteria changes impact historical compliance status. 
      Critical events require immediate review.
    </p>
    
    <div class="timeline">
      ${driftTrends.slice(0, 10).map((drift: any) => {
        const severity = drift.criteria_changed?.some((c: any) => c.severity === 'CRITICAL') ? 'CRITICAL' 
                       : drift.criteria_changed?.some((c: any) => c.severity === 'WARNING') ? 'WARNING' : 'INFO';
        
        return `
        <div class="timeline-item">
          <div class="timeline-date">${formatDate(drift.detected_at)}</div>
          <div class="timeline-content">
            <div style="display: flex; justify-content: space-between; align-items: start;">
              <div>
                <p style="margin: 0 0 5px 0; font-weight: 600;">${drift.zone?.name || 'Unknown Zone'}</p>
                <p style="margin: 0; font-size: 12px; color: #64748b;">
                  Matrix v${drift.matrix_version_from} → v${drift.matrix_version_to}
                </p>
              </div>
              <span class="drift-severity-${severity.toLowerCase()}">${severity}</span>
            </div>
            <p style="margin: 10px 0 0 0; font-size: 12px;">
              <strong>${drift.observations_affected}</strong> observations affected, 
              <strong>${drift.compliance_changed}</strong> compliance changes
            </p>
          </div>
        </div>
        `;
      }).join('')}
    </div>
  </div>
  ` : ''}

  ${zonePerformance.length > 0 ? `
  <div class="section">
    <div class="section-title">Zone Performance Rankings</div>
    <p style="font-size: 14px; color: #64748b; margin-bottom: 20px;">
      Top 10 zones by patrol activity during the reporting period.
    </p>
    
    <div class="chart-container">
      <div class="bar-chart">
        ${topZones.map((zone: any, index: number) => {
          const maxValue = topZones[0]?.total_observations || 1;
          const percentage = (zone.total_observations / maxValue) * 100;
          
          return `
          <div class="bar-item">
            <div class="bar-label">${index + 1}. ${zone.zone_name}</div>
            <div class="bar-fill" style="width: ${percentage}%">
              <span class="bar-value">${zone.total_observations}</span>
            </div>
          </div>
          `;
        }).join('')}
      </div>
    </div>
  </div>
  ` : ''}

  ${matrixHistory.length > 0 ? `
  <div class="section">
    <div class="section-title">Compliance Matrix Change History</div>
    <p style="font-size: 14px; color: #64748b; margin-bottom: 20px;">
      Recent changes to zone compliance criteria.
    </p>
    
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Zone</th>
          <th>Version</th>
          <th>Change Reason</th>
          <th>By</th>
        </tr>
      </thead>
      <tbody>
        ${matrixHistory.slice(0, 20).map((matrix: any) => `
          <tr>
            <td>${formatDate(matrix.created_at)}</td>
            <td>${matrix.zone?.name || 'Unknown'}</td>
            <td style="font-weight: 600;">v${matrix.version}</td>
            <td>${matrix.change_reason}</td>
            <td style="font-size: 12px;">
              ${matrix.created_by_profile?.first_name || 'Unknown'} 
              ${matrix.created_by_profile?.last_name || ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <div class="footer">
    <p><strong>Field Compliance Manager</strong> - Leadership Pack</p>
    <p>Generated: ${formatDate(new Date().toISOString())}</p>
    <p style="color: #ef4444; font-weight: bold; margin-top: 10px;">
      CONFIDENTIAL - This report contains sensitive operational data
    </p>
  </div>
  <div style="margin-top:24px;padding-top:8px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:8pt;color:#94a3b8;">Generated by <strong style="color:#1e3a8a;">Field Compliance Manager</strong> &mdash; Iron Eagle Security</span>
    <img src="/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" style="height:22px;opacity:0.55;object-fit:contain;">
  </div>
</body>
</html>
  `.trim();
}
