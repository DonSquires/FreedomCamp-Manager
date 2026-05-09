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
 *   SMTP_FROM_EMAIL    General default from address, e.g. donotreply@fieldops.co.nz
 *
 * Optional Supabase secret:
 *   SMTP_FROM_NAME     Display name (defaults to "Field Compliance Manager – Do Not Reply")
 *
 * Optional report-specific sender override:
 *   SMTP_REPORTS_FROM_EMAIL   e.g. reports@fieldops.co.nz
 *   SMTP_REPORTS_FROM_NAME    e.g. Field Compliance Manager Reports
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
const MAX_OBSERVATIONS_SCAN = Number(Deno.env.get('REPORT_EMAIL_MAX_OBSERVATIONS') ?? 2500);
const MAX_ENFORCEMENT_SCAN = Number(Deno.env.get('REPORT_EMAIL_MAX_ENFORCEMENT') ?? 1500);
const MAX_VEHICLE_LOOKUP = Number(Deno.env.get('REPORT_EMAIL_MAX_VEHICLE_LOOKUP') ?? 1200);
const REPORT_EMAIL_RELAY_TIMEOUT_MS = Number(Deno.env.get('REPORT_EMAIL_RELAY_TIMEOUT_MS') ?? 10000);
const REPORT_EMAIL_RELAY_ONLY = (Deno.env.get('REPORT_EMAIL_RELAY_ONLY') ?? 'true').toLowerCase() !== 'false';

function normalizeRelayBaseUrl(raw: string): string {
  const base = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return base.replace(/\/$/, '');
}

function buildReportRelayUrl(rawBase: string): string {
  const base = normalizeRelayBaseUrl(rawBase);
  if (base.endsWith('/api/proxy')) return `${base}/email/send-report`;
  if (base.endsWith('/api/proxy/')) return `${base}email/send-report`;
  return `${base}/api/email/send-report`;
}

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
    const smtpFromDefault = Deno.env.get('SMTP_FROM_EMAIL');
    const smtpFromNameDefault = Deno.env.get('SMTP_FROM_NAME') ?? 'Field Compliance Manager – Do Not Reply';
    const smtpReportsFrom = Deno.env.get('SMTP_REPORTS_FROM_EMAIL') || smtpFromDefault;
    const smtpReportsFromName = Deno.env.get('SMTP_REPORTS_FROM_NAME') || smtpFromNameDefault;

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFromDefault) {
      const missing = [
        !smtpHost ? 'SMTP_HOST' : null,
        !smtpUser ? 'SMTP_USERNAME' : null,
        !smtpPass ? 'SMTP_PASSWORD' : null,
        !smtpFromDefault ? 'SMTP_FROM_EMAIL' : null,
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

    // ── Lightweight aggregates to stay under edge runtime limits ────────────
    let obsCountQuery = supabaseAdmin
      .from('observations')
      .select('*', { count: 'exact', head: true })
      .gte('recorded_at', startDateTime)
      .lte('recorded_at', endDateTime);
    if (organization_id) obsCountQuery = obsCountQuery.eq('organization_id', organization_id);
    if (zone_id) obsCountQuery = obsCountQuery.eq('zone_id', zone_id);

    let breachCountQuery = supabaseAdmin
      .from('observations')
      .select('*', { count: 'exact', head: true })
      .eq('is_compliant', false)
      .gte('recorded_at', startDateTime)
      .lte('recorded_at', endDateTime);
    if (organization_id) breachCountQuery = breachCountQuery.eq('organization_id', organization_id);
    if (zone_id) breachCountQuery = breachCountQuery.eq('zone_id', zone_id);

    let enfCountQuery = supabaseAdmin
      .from('enforcement_actions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startDateTime)
      .lte('created_at', endDateTime);
    if (organization_id) enfCountQuery = enfCountQuery.eq('organization_id', organization_id);
    if (zone_id) enfCountQuery = enfCountQuery.eq('zone_id', zone_id);

    let sampleObsQuery = supabaseAdmin
      .from('observations')
      .select('plate_number, zone_id, recorded_at')
      .gte('recorded_at', startDateTime)
      .lte('recorded_at', endDateTime)
      .order('recorded_at', { ascending: false })
      .limit(MAX_OBSERVATIONS_SCAN);
    if (organization_id) sampleObsQuery = sampleObsQuery.eq('organization_id', organization_id);
    if (zone_id) sampleObsQuery = sampleObsQuery.eq('zone_id', zone_id);

    const [
      { count: totalObservationsRaw, error: obsCountError },
      { count: totalBreachesRaw, error: breachCountError },
      { count: totalEnforcementRaw, error: enfCountError },
      { data: sampleObs, error: sampleObsError },
    ] = await Promise.all([obsCountQuery, breachCountQuery, enfCountQuery, sampleObsQuery]);

    if (obsCountError) throw obsCountError;
    if (breachCountError) throw breachCountError;
    if (enfCountError) throw enfCountError;
    if (sampleObsError) throw sampleObsError;

    const obsRows = sampleObs || [];
    const uniquePlates = [...new Set(obsRows.map((o: any) => o.plate_number).filter(Boolean))];
    const uniqueZoneIds = [...new Set(obsRows.map((o: any) => o.zone_id).filter(Boolean))];
    const observationsTruncated = obsRows.length >= MAX_OBSERVATIONS_SCAN;

    let zoneNameById = new Map<string, string>();
    if (uniqueZoneIds.length > 0) {
      const { data: zoneRows } = await supabaseAdmin
        .from('zones')
        .select('id, name')
        .in('id', uniqueZoneIds);
      zoneNameById = new Map((zoneRows || []).map((z: any) => [z.id, z.name || 'Unknown Zone']));
    }

    const zoneStatsMap = new Map<string, { zone_name: string; observations: number; vehicles: Set<string> }>();
    for (const row of obsRows) {
      if (!zoneStatsMap.has(row.zone_id)) {
        zoneStatsMap.set(row.zone_id, {
          zone_name: zoneNameById.get(row.zone_id) || 'Unknown Zone',
          observations: 0,
          vehicles: new Set<string>(),
        });
      }
      const z = zoneStatsMap.get(row.zone_id)!;
      z.observations += 1;
      if (row.plate_number) z.vehicles.add(row.plate_number);
    }

    const totalObservations = totalObservationsRaw ?? 0;
    const totalBreaches = totalBreachesRaw ?? 0;
    const totalEnforcementActions = totalEnforcementRaw ?? 0;
    const totalVehicles = uniquePlates.length;
    const totalZones = uniqueZoneIds.length;
    const totalAtRisk = 0;
    const complianceRate = totalObservations > 0
      ? Math.max(0, Math.min(100, Math.round(((totalObservations - totalBreaches) / totalObservations) * 100)))
      : 100;

    const zoneStats = Array.from(zoneStatsMap.values())
      .map((z) => ({
        zone_name: z.zone_name,
        observations: z.observations,
        vehicles: z.vehicles.size,
        overstayers: 0,
        at_risk: 0,
        compliance_rate: complianceRate,
      }))
      .sort((a, b) => b.observations - a.observations)
      .slice(0, 10);

    const breachVehicles: any[] = [];
    const atRiskVehicles: any[] = [];
    const enforcementTruncated = totalEnforcementActions >= MAX_ENFORCEMENT_SCAN;

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
      totalEnforcementActions,
      observationsTruncated,
      enforcementTruncated,
      vehiclesTruncated: uniquePlates.length > MAX_VEHICLE_LOOKUP,
    });

    const subject = `${reportTitle} — ${formatDateNZ(reportDateFrom)} to ${formatDateNZ(reportDateTo)}`;
    reportAuditContext.subject = subject;
    const fromAddr = `${smtpReportsFromName} <${smtpReportsFrom}>`;

    // ── Send via proxy relay first (hPanel / self-hosted) ───────────────────
    const proxyBaseUrl =
      Deno.env.get('PROXY_SERVER_URL') ||
      Deno.env.get('PROXY_BASE_URL') ||
      Deno.env.get('RAILWAY_PROXY_URL') ||
      Deno.env.get('NZSCV_PROXY_URL');
    const proxySecret =
      Deno.env.get('PROXY_SECRET') ||
      Deno.env.get('NZSCV_PROXY_SECRET') ||
      Deno.env.get('PROXY_SERVER_SECRET');

    let relayAttempted = false;
    if (proxyBaseUrl && proxySecret) {
      relayAttempted = true;
      const relayUrl = buildReportRelayUrl(proxyBaseUrl);
      const relayController = new AbortController();
      const relayTimer = setTimeout(() => relayController.abort(), REPORT_EMAIL_RELAY_TIMEOUT_MS);
      try {
        const relayResponse = await fetch(relayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-proxy-secret': proxySecret,
          },
          body: JSON.stringify({
            recipient_email: toEmail,
            subject,
            html,
            report_type,
            date_from: reportDateFrom,
            date_to: reportDateTo,
            organization_id,
            zone_id,
            from_email: smtpReportsFrom,
            from_name: smtpReportsFromName,
          }),
          signal: relayController.signal,
        });

        if (relayResponse.ok) {
          await recordCommunicationAudit(supabaseAdmin, {
            organizationId: organization_id,
            channel: 'email',
            provider: 'proxy_relay',
            status: 'delivered',
            subject,
            bodyText: `${reportTitle} for ${organizationName} / ${zoneName}`,
            toEmails: [toEmail],
            sentBy: user.id,
            mergeData: { report_type, zone_id, date_from: reportDateFrom, date_to: reportDateTo },
          });

          return new Response(
            JSON.stringify({ success: true, recipient: toEmail, subject, delivery: 'proxy_relay' }),
            { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const relayErrText = await relayResponse.text();
        if (REPORT_EMAIL_RELAY_ONLY) {
          await recordCommunicationAudit(supabaseAdmin, {
            organizationId: organization_id,
            channel: 'email',
            provider: 'proxy_relay',
            status: 'failed',
            subject,
            toEmails: [toEmail],
            sentBy: user.id,
            errorMessage: `Proxy relay failed: HTTP ${relayResponse.status} ${relayErrText.slice(0, 240)}`,
            mergeData: { report_type, zone_id, date_from: reportDateFrom, date_to: reportDateTo },
          });
          return new Response(
            JSON.stringify({ error: `Report relay failed (HTTP ${relayResponse.status}). Check proxy-server SMTP config.` }),
            { status: 502, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }
      } catch (relayError: any) {
        if (REPORT_EMAIL_RELAY_ONLY) {
          await recordCommunicationAudit(supabaseAdmin, {
            organizationId: organization_id,
            channel: 'email',
            provider: 'proxy_relay',
            status: 'failed',
            subject,
            toEmails: [toEmail],
            sentBy: user.id,
            errorMessage: `Proxy relay unreachable: ${relayError?.message || 'unknown'}`,
            mergeData: { report_type, zone_id, date_from: reportDateFrom, date_to: reportDateTo },
          });
          return new Response(
            JSON.stringify({ error: 'Report relay unreachable. Verify PROXY_SERVER_URL and PROXY_SECRET.' }),
            { status: 502, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }
      } finally {
        clearTimeout(relayTimer);
      }
    }

    if (REPORT_EMAIL_RELAY_ONLY && !relayAttempted) {
      return new Response(
        JSON.stringify({ error: 'Relay-only mode enabled but proxy relay is not configured (PROXY_SERVER_URL + PROXY_SECRET).' }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // ── SMTP fallback (disabled when REPORT_EMAIL_RELAY_ONLY=true) ──────────
    const useTls = smtpPort === 465;
    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: smtpPort,
        tls: useTls,
        auth: {
          username: smtpUser,
          password: smtpPass,
        },
      },
    });

    try {
      await client.send({ from: fromAddr, to: toEmail, subject, html });
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
  observationsTruncated: boolean;
  enforcementTruncated: boolean;
  vehiclesTruncated: boolean;
}): string {
  const {
    reportTitle, dateFrom, dateTo,
    organizationName, zoneName,
    stats, zoneStats, breachVehicles, atRiskVehicles, totalEnforcementActions,
    observationsTruncated, enforcementTruncated, vehiclesTruncated,
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
              Field Compliance Manager
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
            ${observationsTruncated || enforcementTruncated || vehiclesTruncated ? `
            <p style="margin:12px 4px 0;font-size:11px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;">
              This report used a safety-limited dataset for reliable delivery.
              ${observationsTruncated ? ` Observations were capped at ${MAX_OBSERVATIONS_SCAN}.` : ''}
              ${enforcementTruncated ? ` Enforcement actions were capped at ${MAX_ENFORCEMENT_SCAN}.` : ''}
              ${vehiclesTruncated ? ` Vehicle lookups were capped at ${MAX_VEHICLE_LOOKUP}.` : ''}
            </p>` : ''}
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
              Generated by <strong>Field Compliance Manager</strong> on ${escapeHtml(formatDateNZ(new Date().toISOString()))}
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
