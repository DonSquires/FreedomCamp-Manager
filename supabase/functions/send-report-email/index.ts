import { SMTPClient } from 'https://deno.land/x/denomailer@1.0.0/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';
import { recordCommunicationAudit } from '../_shared/communicationsAudit.ts';

/**
 * send-report-email
 *
 * Generates a dashboard report and delivers it to an email address using the
 * SMTP credentials already configured in Supabase (Settings › Auth › SMTP).
 *
 * Required Supabase secrets  (supabase secrets set KEY=value):
 *   SMTP_HOST          e.g. smtp.office365.com
 *   SMTP_PORT          e.g. 587
 *   SMTP_USERNAME      SMTP login username / email address
 *   SMTP_PASSWORD      SMTP login password
 *   SMTP_FROM_EMAIL    From address, e.g. reports@yourdomain.com
 *
 * Optional Supabase secret:
 *   SMTP_FROM_NAME     Display name (defaults to "FieldOps Manager – Do Not Reply")
 *
 * Request body:
 *   report_type       string   'compliance' | 'enforcement' | 'vehicle-activity' | 'zone-stats'
 *   recipient_email?  string   destination address (defaults to authenticated user's email)
 *   organization_id?  string
 *   zone_id?          string
 *   date_from?        string   YYYY-MM-DD
 *   date_to?          string   YYYY-MM-DD
 */

interface SendReportEmailRequest {
  report_type?: string;
  recipient_email?: string;
  organization_id?: string;
  zone_id?: string;
  date_from?: string;
  date_to?: string;
}

/** Number of days to look back when no date_from is provided. */
const DEFAULT_LOOKBACK_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  let supabaseAdmin: ReturnType<typeof createClient> | null = null;
  let reportAuditContext: {
    organizationId?: string;
    recipient?: string;
    reportType?: string;
    subject?: string;
    userId?: string;
  } = {};

  try {
    // ── Authenticate caller ──────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // ── Parse request ────────────────────────────────────────────────────────
    const {
      report_type = 'compliance',
      recipient_email,
      organization_id,
      zone_id,
      date_from,
      date_to,
    } = await req.json() as SendReportEmailRequest;

    const toEmail = recipient_email?.trim() || user.email;
    reportAuditContext = {
      organizationId: organization_id,
      recipient: toEmail,
      reportType: report_type,
      userId: user.id,
    };

    // ── Validate SMTP configuration ──────────────────────────────────────────
    const smtpHost     = Deno.env.get('SMTP_HOST');
    const smtpPort     = parseInt(Deno.env.get('SMTP_PORT') ?? '587', 10);
    const smtpUser     = Deno.env.get('SMTP_USERNAME');
    const smtpPass     = Deno.env.get('SMTP_PASSWORD');
    const smtpFrom     = Deno.env.get('SMTP_FROM_EMAIL');
    const smtpFromName = Deno.env.get('SMTP_FROM_NAME') ?? 'FieldOps Manager – Do Not Reply';

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
      const missing = [
        !smtpHost ? 'SMTP_HOST' : null,
        !smtpUser ? 'SMTP_USERNAME' : null,
        !smtpPass ? 'SMTP_PASSWORD' : null,
        !smtpFrom ? 'SMTP_FROM_EMAIL' : null,
      ].filter(Boolean).join(', ');

      await recordCommunicationAudit(supabaseAdmin, {
        organizationId: organization_id,
        channel: 'email',
        provider: 'smtp',
        status: 'failed',
        subject: `${report_type} report`,
        toEmails: toEmail ? [toEmail] : undefined,
        sentBy: user.id,
        errorMessage: `SMTP_NOT_CONFIGURED: ${missing}`,
        mergeData: { report_type },
      });
      return new Response(
        JSON.stringify({
          error: `Email service not configured. Missing Supabase secrets: ${missing}. ` +
                 'Run: supabase secrets set SMTP_HOST=... SMTP_USERNAME=... SMTP_PASSWORD=... SMTP_FROM_EMAIL=...',
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (!toEmail) {
      await recordCommunicationAudit(supabaseAdmin, {
        organizationId: organization_id,
        channel: 'email',
        provider: 'smtp',
        status: 'failed',
        subject: `${report_type} report`,
        sentBy: user.id,
        errorMessage: 'missing_recipient_email',
        mergeData: { report_type },
      });
      return new Response(
        JSON.stringify({ error: 'No recipient email address. Provide recipient_email in the request body.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      await recordCommunicationAudit(supabaseAdmin, {
        organizationId: organization_id,
        channel: 'email',
        provider: 'smtp',
        status: 'failed',
        subject: `${report_type} report`,
        toEmails: [toEmail],
        sentBy: user.id,
        errorMessage: 'invalid_recipient_email',
        mergeData: { report_type },
      });
      return new Response(
        JSON.stringify({ error: `Invalid email address: ${toEmail}` }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // ── Normalise date range ─────────────────────────────────────────────────
    const reportDateTo   = date_to   || new Date().toISOString().slice(0, 10);
    const reportDateFrom = date_from || new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const startDateTime  = `${reportDateFrom}T00:00:00`;
    const endDateTime    = `${reportDateTo}T23:59:59`;

    // ── Build independent queries to run in parallel ──────────────────────────
    let obsQuery = supabaseAdmin
      .from('observations')
      .select('plate_number, zone_id, organization_id, is_compliant, breach_type, recorded_at, nights_stayed_this_month, consecutive_nights, zones(name), organizations(name)')
      .gte('recorded_at', startDateTime)
      .lte('recorded_at', endDateTime);

    if (organization_id) obsQuery = obsQuery.eq('organization_id', organization_id);
    if (zone_id)         obsQuery = obsQuery.eq('zone_id', zone_id);

    let enfQuery = supabaseAdmin
      .from('enforcement_actions')
      .select('action_type, completion_outcome, created_at')
      .gte('created_at', startDateTime)
      .lte('created_at', endDateTime);

    if (organization_id) enfQuery = enfQuery.eq('organization_id', organization_id);
    if (zone_id)         enfQuery = enfQuery.eq('zone_id', zone_id);

    let matrixQuery = supabaseAdmin
      .from('zone_compliance_matrix')
      .select('zone_id, max_consecutive_nights, nights_per_month')
      .is('effective_to', null);
    if (organization_id) matrixQuery = matrixQuery.eq('organization_id', organization_id);

    // Run the three independent queries in parallel to reduce round-trip time
    const [
      { data: observations, error: obsError },
      { data: enforcementActions },
      { data: matrices },
    ] = await Promise.all([obsQuery, enfQuery, matrixQuery]);

    if (obsError) throw obsError;

    const obs          = observations || [];
    const uniquePlates = [...new Set(obs.map((o: any) => o.plate_number))];
    const enforcementRows = enforcementActions || [];
    const matrixMap = new Map(matrices?.map((m: any) => [m.zone_id, m]) || []);

    // ── Load vehicle details (depends on uniquePlates from obs) ──────────────
    let vehicleData: any[] = [];
    if (uniquePlates.length > 0) {
      const { data: vehicles } = await supabaseAdmin
        .from('canonical_vehicles')
        .select('plate_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, is_flagged, homeless_status, last_seen_at')
        .in('plate_number', uniquePlates);
      vehicleData = vehicles || [];
    }
    const vehicleMap = new Map(vehicleData.map((v: any) => [v.plate_number, v]));

    // ── Derive stay snapshots from the already-loaded observations ───────────
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

    // ── Categorise vehicles ──────────────────────────────────────────────────
    const overstayersMap = new Map<string, any[]>();
    const atRiskMap      = new Map<string, any[]>();

    stays.forEach((stay: any) => {
      const rules = matrixMap.get(stay.zone_id);
      if (!rules) return;

      const info = {
        zone_name:          stay.zones?.name || 'Unknown Zone',
        consecutive_nights: stay.consecutive_nights,
        nights_stayed:      stay.nights_stayed,
        max_consecutive:    rules.max_consecutive_nights,
        monthly_limit:      rules.nights_per_month,
      };

      if (
        stay.consecutive_nights > rules.max_consecutive_nights ||
        stay.nights_stayed       > rules.nights_per_month
      ) {
        if (!overstayersMap.has(stay.plate_number)) overstayersMap.set(stay.plate_number, []);
        overstayersMap.get(stay.plate_number)!.push(info);
      } else if (
        stay.consecutive_nights === rules.max_consecutive_nights ||
        stay.nights_stayed       === rules.nights_per_month
      ) {
        if (!atRiskMap.has(stay.plate_number)) atRiskMap.set(stay.plate_number, []);
        atRiskMap.get(stay.plate_number)!.push(info);
      }
    });

    const breachVehicles: any[] = [];
    overstayersMap.forEach((infos, plate) => {
      const v = vehicleMap.get(plate);
      if (v) breachVehicles.push({ plate_number: plate, ...v, breach_zones: infos });
    });

    const atRiskVehicles: any[] = [];
    atRiskMap.forEach((infos, plate) => {
      const v = vehicleMap.get(plate);
      if (v && !overstayersMap.has(plate)) atRiskVehicles.push({ plate_number: plate, ...v, at_risk_zones: infos });
    });

    // ── Zone stats ───────────────────────────────────────────────────────────
    const zoneStatsMap = new Map<string, any>();
    obs.forEach((o: any) => {
      if (!zoneStatsMap.has(o.zone_id)) {
        zoneStatsMap.set(o.zone_id, {
          zone_name:   o.zones?.name || 'Unknown Zone',
          observations: 0,
          vehicles:    new Set<string>(),
          overstayers: new Set<string>(),
          atRisk:      new Set<string>(),
        });
      }
      const z = zoneStatsMap.get(o.zone_id);
      z.observations++;
      z.vehicles.add(o.plate_number);
    });

    stays.forEach((stay: any) => {
      const rules = matrixMap.get(stay.zone_id);
      if (!rules || !zoneStatsMap.has(stay.zone_id)) return;
      const z = zoneStatsMap.get(stay.zone_id);
      if (stay.consecutive_nights > rules.max_consecutive_nights || stay.nights_stayed > rules.nights_per_month) {
        z.overstayers.add(stay.plate_number);
      } else if (stay.consecutive_nights === rules.max_consecutive_nights || stay.nights_stayed === rules.nights_per_month) {
        z.atRisk.add(stay.plate_number);
      }
    });

    const zoneStats = Array.from(zoneStatsMap.values()).map((z: any) => {
      const vCount    = z.vehicles.size;
      const compliant = vCount - z.overstayers.size;
      return {
        zone_name:       z.zone_name,
        observations:    z.observations,
        vehicles:        vCount,
        overstayers:     z.overstayers.size,
        at_risk:         z.atRisk.size,
        compliant,
        compliance_rate: vCount > 0 ? Math.round((compliant / vCount) * 100) : 100,
      };
    }).sort((a, b) => b.observations - a.observations);

    // ── Organisation / zone names (parallel) ────────────────────────────────
    const [orgResult, zoneResult] = await Promise.all([
      organization_id
        ? supabaseAdmin.from('organizations').select('name').eq('id', organization_id).single()
        : Promise.resolve({ data: null }),
      zone_id
        ? supabaseAdmin.from('zones').select('name').eq('id', zone_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const organizationName = orgResult.data?.name ?? 'All Organizations';
    const zoneName = zoneResult.data?.name ?? 'All Zones';

    // ── Aggregate stats ──────────────────────────────────────────────────────
    const totalObservations = obs.length;
    const totalVehicles     = uniquePlates.length;
    const totalBreaches     = breachVehicles.length;
    const totalAtRisk       = atRiskVehicles.length;
    const totalZones        = new Set(obs.map((o: any) => o.zone_id)).size;
    const complianceRate    = totalVehicles > 0
      ? Math.round(((totalVehicles - totalBreaches) / totalVehicles) * 100)
      : 100;

    // ── Build HTML email ─────────────────────────────────────────────────────
    const reportTitle = getReportTitle(report_type);
    const html = buildEmailHtml({
      reportTitle,
      dateFrom: reportDateFrom,
      dateTo:   reportDateTo,
      organizationName,
      zoneName,
      stats: { totalObservations, totalVehicles, totalZones, totalBreaches, totalAtRisk, complianceRate },
      zoneStats:      zoneStats.slice(0, 10),
      breachVehicles: breachVehicles.slice(0, 20),
      atRiskVehicles: atRiskVehicles.slice(0, 20),
      totalEnforcementActions: enforcementRows.length,
    });

    const subject = `${reportTitle} — ${formatDateNZ(reportDateFrom)} to ${formatDateNZ(reportDateTo)}`;
    reportAuditContext.subject = subject;
    const fromAddr = `${smtpFromName} <${smtpFrom}>`;

    // ── Send via SMTP ────────────────────────────────────────────────────────
    // Use TLS (port 465) or STARTTLS (port 587 / 25).
    const useTls = smtpPort === 465;

    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port:     smtpPort,
        tls:      useTls,
        auth: {
          username: smtpUser,
          password: smtpPass,
        },
      },
    });

    try {
      await client.send({
        from:    fromAddr,
        to:      toEmail,
        subject,
        html,
      });
    } finally {
      await client.close();
    }

    console.log(`✅ Report email sent to ${toEmail} via ${smtpHost}:${smtpPort}`);
    await recordCommunicationAudit(supabaseAdmin, {
      organizationId: organization_id,
      channel: 'email',
      provider: 'smtp',
      status: 'delivered',
      subject,
      bodyText: `${reportTitle} for ${organizationName} / ${zoneName}`,
      toEmails: [toEmail],
      sentBy: user.id,
      mergeData: { report_type, zone_id, date_from: reportDateFrom, date_to: reportDateTo },
    });

    return new Response(
      JSON.stringify({ success: true, recipient: toEmail, subject }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('send-report-email error:', error);
    if (supabaseAdmin) {
      await recordCommunicationAudit(supabaseAdmin, {
        organizationId: reportAuditContext.organizationId,
        channel: 'email',
        provider: 'smtp',
        status: 'failed',
        subject: reportAuditContext.subject ?? `${reportAuditContext.reportType ?? 'dashboard'} report`,
        toEmails: reportAuditContext.recipient ? [reportAuditContext.recipient] : undefined,
        sentBy: reportAuditContext.userId,
        errorMessage: error.message || 'Failed to send report email',
        mergeData: { report_type: reportAuditContext.reportType },
      });
    }
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to send report email' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getReportTitle(reportType: string): string {
  const titles: Record<string, string> = {
    compliance:        'Compliance Summary Report',
    enforcement:       'Enforcement Activity Report',
    'vehicle-activity': 'Vehicle Activity Report',
    'zone-stats':       'Zone Statistics Report',
  };
  return titles[reportType] || 'Dashboard Report';
}

function formatDateNZ(date: string): string {
  return new Date(date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailHtml(data: {
  reportTitle: string;
  dateFrom: string;
  dateTo: string;
  organizationName: string;
  zoneName: string;
  stats: {
    totalObservations: number;
    totalVehicles: number;
    totalZones: number;
    totalBreaches: number;
    totalAtRisk: number;
    complianceRate: number;
  };
  zoneStats: any[];
  breachVehicles: any[];
  atRiskVehicles: any[];
  totalEnforcementActions: number;
}): string {
  const {
    reportTitle, dateFrom, dateTo,
    organizationName, zoneName,
    stats, zoneStats, breachVehicles, atRiskVehicles, totalEnforcementActions,
  } = data;

  const complianceColor =
    stats.complianceRate >= 80 ? '#16a34a' :
    stats.complianceRate >= 60 ? '#d97706' : '#dc2626';

  const metricCells = [
    { label: 'Total Observations', value: stats.totalObservations.toLocaleString(), color: '#3b82f6' },
    { label: 'Unique Vehicles',    value: stats.totalVehicles.toLocaleString(),     color: '#8b5cf6' },
    { label: 'Compliance Rate',    value: `${stats.complianceRate}%`,               color: complianceColor },
    { label: 'Breach Vehicles',    value: stats.totalBreaches.toLocaleString(),     color: '#ef4444' },
    { label: 'At-Risk Vehicles',   value: stats.totalAtRisk.toLocaleString(),       color: '#f59e0b' },
    { label: 'Active Zones',       value: stats.totalZones.toLocaleString(),        color: '#10b981' },
  ].map(m => `
    <td width="33%" style="padding:6px;text-align:center;vertical-align:top;">
      <div style="background:#f8fafc;border-radius:8px;padding:14px 8px;border:1px solid #e2e8f0;">
        <div style="font-size:26px;font-weight:800;color:${m.color};">${escapeHtml(m.value)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(m.label)}</div>
      </div>
    </td>`).join('');

  const zoneRows = zoneStats.map(z => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${escapeHtml(z.zone_name)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;">${z.observations}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;">${z.vehicles}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;color:#dc2626;font-weight:600;">${z.overstayers}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;color:#d97706;font-weight:600;">${z.at_risk}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;font-weight:600;color:${z.compliance_rate >= 80 ? '#16a34a' : '#dc2626'};">${z.compliance_rate}%</td>
    </tr>`).join('');

  const breachRows = breachVehicles.slice(0, 15).map(v => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #fecaca;font-size:13px;font-weight:700;">${escapeHtml(v.plate_number)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #fecaca;font-size:13px;">${escapeHtml((`${v.vehicle_make || ''} ${v.vehicle_model || ''}`).trim() || 'Unknown')}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #fecaca;font-size:13px;">${(v.breach_zones || []).map((z: any) => escapeHtml(z.zone_name)).join(', ')}</td>
    </tr>`).join('');

  const atRiskRows = atRiskVehicles.slice(0, 15).map(v => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #fde68a;font-size:13px;font-weight:700;">${escapeHtml(v.plate_number)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #fde68a;font-size:13px;">${escapeHtml((`${v.vehicle_make || ''} ${v.vehicle_model || ''}`).trim() || 'Unknown')}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #fde68a;font-size:13px;">${(v.at_risk_zones || []).map((z: any) => escapeHtml(z.zone_name)).join(', ')}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(reportTitle)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

        <!-- ── Header ── -->
        <tr>
          <td style="background:#0f172a;padding:28px 40px;text-align:center;">
            <img src="https://www.ironeaglesecurity.co.nz/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" style="height:48px;object-fit:contain;display:block;margin:0 auto 12px;" />
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">
              FieldOps Manager
            </h1>
            <p style="margin:6px 0 0;color:#94a3b8;font-size:14px;">${escapeHtml(reportTitle)}</p>
          </td>
        </tr>

        <!-- ── Scope banner ── -->
        <tr>
          <td style="background:#1e293b;padding:12px 40px;text-align:center;">
            <p style="margin:0;color:#cbd5e1;font-size:12px;">
              ${escapeHtml(organizationName)} &nbsp;&bull;&nbsp; ${escapeHtml(zoneName)}
              &nbsp;&bull;&nbsp; ${formatDateNZ(dateFrom)} &ndash; ${formatDateNZ(dateTo)}
            </p>
          </td>
        </tr>

        <!-- ── Key metrics ── -->
        <tr>
          <td style="padding:28px 28px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>${metricCells}</tr>
            </table>
          </td>
        </tr>

        ${zoneStats.length > 0 ? `
        <!-- ── Zone performance ── -->
        <tr>
          <td style="padding:8px 40px 24px;">
            <h2 style="margin:0 0 10px;font-size:15px;font-weight:700;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
              Zone Performance
            </h2>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Zone</th>
                  <th style="padding:8px 10px;text-align:center;font-size:12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Obs.</th>
                  <th style="padding:8px 10px;text-align:center;font-size:12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Vehicles</th>
                  <th style="padding:8px 10px;text-align:center;font-size:12px;font-weight:600;color:#991b1b;border-bottom:2px solid #e2e8f0;">Breaches</th>
                  <th style="padding:8px 10px;text-align:center;font-size:12px;font-weight:600;color:#92400e;border-bottom:2px solid #e2e8f0;">At-Risk</th>
                  <th style="padding:8px 10px;text-align:center;font-size:12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Compliance</th>
                </tr>
              </thead>
              <tbody>${zoneRows}</tbody>
            </table>
          </td>
        </tr>` : ''}

        ${breachVehicles.length > 0 ? `
        <!-- ── Breach vehicles ── -->
        <tr>
          <td style="padding:8px 40px 24px;">
            <h2 style="margin:0 0 10px;font-size:15px;font-weight:700;color:#dc2626;border-bottom:2px solid #fecaca;padding-bottom:6px;">
              &#9888; Breach Vehicles (${stats.totalBreaches})
            </h2>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;">
              <thead>
                <tr style="background:#fef2f2;">
                  <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:600;color:#991b1b;border-bottom:2px solid #fecaca;">Plate</th>
                  <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:600;color:#991b1b;border-bottom:2px solid #fecaca;">Vehicle</th>
                  <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:600;color:#991b1b;border-bottom:2px solid #fecaca;">Zones</th>
                </tr>
              </thead>
              <tbody>${breachRows}</tbody>
            </table>
            ${breachVehicles.length > 15 ? `<p style="margin:6px 0 0;font-size:11px;color:#64748b;">&#8230; and ${breachVehicles.length - 15} more vehicle(s) not shown.</p>` : ''}
          </td>
        </tr>` : ''}

        ${atRiskVehicles.length > 0 ? `
        <!-- ── At-risk vehicles ── -->
        <tr>
          <td style="padding:8px 40px 24px;">
            <h2 style="margin:0 0 10px;font-size:15px;font-weight:700;color:#d97706;border-bottom:2px solid #fde68a;padding-bottom:6px;">
              &#9889; At-Risk Vehicles (${stats.totalAtRisk})
            </h2>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;">
              <thead>
                <tr style="background:#fffbeb;">
                  <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:600;color:#92400e;border-bottom:2px solid #fde68a;">Plate</th>
                  <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:600;color:#92400e;border-bottom:2px solid #fde68a;">Vehicle</th>
                  <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:600;color:#92400e;border-bottom:2px solid #fde68a;">Zones</th>
                </tr>
              </thead>
              <tbody>${atRiskRows}</tbody>
            </table>
            ${atRiskVehicles.length > 15 ? `<p style="margin:6px 0 0;font-size:11px;color:#64748b;">&#8230; and ${atRiskVehicles.length - 15} more vehicle(s) not shown.</p>` : ''}
          </td>
        </tr>` : ''}

        ${totalEnforcementActions > 0 ? `
        <!-- ── Enforcement summary ── -->
        <tr>
          <td style="padding:8px 40px 24px;">
            <h2 style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
              Enforcement Actions
            </h2>
            <p style="margin:0;font-size:14px;color:#475569;">
              ${totalEnforcementActions} enforcement action(s) recorded during this period.
            </p>
          </td>
        </tr>` : ''}

        <!-- ── Footer ── -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#64748b;">
              Generated by <strong>FieldOps Manager</strong> on ${escapeHtml(formatDateNZ(new Date().toISOString()))}
            </p>
            <p style="margin:6px 0 0;font-size:11px;color:#94a3b8;">
              This report is confidential and intended for authorised personnel only.
            </p>
            <p style="margin:6px 0 0;font-size:11px;color:#94a3b8;font-style:italic;">
              This is an automated message &mdash; please do not reply to this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
