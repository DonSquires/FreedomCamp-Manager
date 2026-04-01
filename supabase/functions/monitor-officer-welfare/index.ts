import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

/**
 * Officer Welfare Monitoring Edge Function
 * Runs periodically (every minute via cron job) to check:
 * 1. Auto-logoff based on vehicle scan inactivity
 * 2. Welfare checks based on GPS inactivity
 * 3. Escalation of unacknowledged alerts
 *
 * PERFORMANCE: all per-officer look-ups are batched into single IN() queries
 * rather than one query per officer (previous N+1 anti-pattern).
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🔍 Starting officer welfare monitoring...');

    const now = new Date();
    const fiveMinutesAgo  = new Date(now.getTime() -  5 * 60 * 1000);
    const tenMinutesAgo   = new Date(now.getTime() - 10 * 60 * 1000);
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

    // ─────────────────────────────────────────────────────────────────────────
    // FETCH ALL ACTIVE OFFICERS IN ONE QUERY
    // ─────────────────────────────────────────────────────────────────────────
    const { data: officers } = await supabaseAdmin
      .from('user_profiles')
      .select(`
        id,
        first_name,
        last_name,
        phone,
        organization_id,
        officer_welfare_settings (
          auto_logoff_enabled,
          inactivity_warning_time,
          auto_logoff_time,
          welfare_check_enabled,
          gps_inactivity_threshold,
          admin_escalation_time,
          critical_escalation_time
        )
      `)
      .eq('role', 'officer')
      .eq('is_active', true);

    if (!officers || officers.length === 0) {
      console.log('No active officers to monitor.');
      return successResponse(corsHeaders, now, 0, 0, 0, 0);
    }

    const officerIds = officers.map((o: any) => o.id);

    // ─────────────────────────────────────────────────────────────────────────
    // BATCH: last vehicle-scan activity per officer
    // ─────────────────────────────────────────────────────────────────────────
    const { data: lastScansRaw } = await supabaseAdmin
      .from('officer_activity_log')
      .select('user_id, recorded_at')
      .in('user_id', officerIds)
      .eq('activity_type', 'vehicle_scan')
      .gte('recorded_at', tenMinutesAgo.toISOString()) // only fetch scans from the last 10 minutes; officers with no recent scans are treated as inactive
      .order('recorded_at', { ascending: false });

    // Keep only the most recent scan per officer
    const lastScanByOfficer = new Map<string, string>();
    for (const row of (lastScansRaw ?? []) as any[]) {
      if (!lastScanByOfficer.has(row.user_id)) {
        lastScanByOfficer.set(row.user_id, row.recorded_at);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BATCH: active investigations per officer
    // ─────────────────────────────────────────────────────────────────────────
    const { data: activeInvestigationsRaw } = await supabaseAdmin
      .from('investigation_jobs')
      .select('assigned_to')
      .in('assigned_to', officerIds)
      .eq('status', 'in_progress');

    const officersInInvestigation = new Set(
      (activeInvestigationsRaw ?? []).map((r: any) => r.assigned_to)
    );

    // ─────────────────────────────────────────────────────────────────────────
    // BATCH: existing pending inactivity warnings (last 5 min) per officer
    // ─────────────────────────────────────────────────────────────────────────
    const { data: existingWarningsRaw } = await supabaseAdmin
      .from('officer_welfare_alerts')
      .select('officer_id')
      .in('officer_id', officerIds)
      .eq('alert_type', 'inactivity_warning')
      .eq('status', 'pending')
      .gte('alert_sent_at', fiveMinutesAgo.toISOString());

    const officersWithRecentWarning = new Set(
      (existingWarningsRaw ?? []).map((r: any) => r.officer_id)
    );

    // ─────────────────────────────────────────────────────────────────────────
    // BATCH: last GPS update per officer (for welfare check)
    // ─────────────────────────────────────────────────────────────────────────
    const { data: lastGpsRaw } = await supabaseAdmin
      .from('officer_activity_log')
      .select('user_id, recorded_at, gps_latitude, gps_longitude, gps_accuracy, organization_id')
      .in('user_id', officerIds)
      .eq('activity_type', 'gps_update')
      .not('gps_latitude', 'is', null)
      .order('recorded_at', { ascending: false });

    const lastGpsByOfficer = new Map<string, any>();
    for (const row of (lastGpsRaw ?? []) as any[]) {
      if (!lastGpsByOfficer.has(row.user_id)) {
        lastGpsByOfficer.set(row.user_id, row);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BATCH: officers with an existing pending welfare check alert
    // ─────────────────────────────────────────────────────────────────────────
    const { data: existingWelfareAlertsRaw } = await supabaseAdmin
      .from('officer_welfare_alerts')
      .select('officer_id')
      .in('officer_id', officerIds)
      .eq('alert_type', 'welfare_check')
      .eq('status', 'pending');

    const officersWithPendingWelfareAlert = new Set(
      (existingWelfareAlertsRaw ?? []).map((r: any) => r.officer_id)
    );

    // ─────────────────────────────────────────────────────────────────────────
    // BATCH: recently-active peer officers per organisation (for welfare peer
    //        notification decision). Build set of orgs that have another
    //        active officer in the last 15 min.
    // ─────────────────────────────────────────────────────────────────────────
    const { data: recentlyActiveRaw } = await supabaseAdmin
      .from('officer_activity_log')
      .select('user_id, organization_id')
      .in('organization_id', [...new Set(officers.map((o: any) => o.organization_id))])
      .eq('activity_type', 'gps_update')
      .gte('recorded_at', fifteenMinutesAgo.toISOString());

    // Build a map: org_id → Set of recently-active user_ids
    const recentlyActiveByOrg = new Map<string, Set<string>>();
    for (const row of (recentlyActiveRaw ?? []) as any[]) {
      if (!recentlyActiveByOrg.has(row.organization_id)) {
        recentlyActiveByOrg.set(row.organization_id, new Set());
      }
      recentlyActiveByOrg.get(row.organization_id)!.add(row.user_id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROCESS EACH OFFICER (no extra DB calls inside this loop)
    // ─────────────────────────────────────────────────────────────────────────
    const warningInserts: any[]  = [];
    const logoffOfficers: any[]  = [];
    const welfareInserts: any[]  = [];

    for (const officer of officers as any[]) {
      const settings = officer.officer_welfare_settings;
      if (!settings) continue;

      const inInvestigation = officersInInvestigation.has(officer.id);
      const lastScanAt      = lastScanByOfficer.get(officer.id) ?? null;
      const lastGps         = lastGpsByOfficer.get(officer.id) ?? null;

      // ── STEP 1: Inactivity warning ─────────────────────────────────────────
      if (settings.auto_logoff_enabled && !inInvestigation) {
        const warningThreshold = new Date(now.getTime() - settings.inactivity_warning_time * 60 * 1000);
        const isInactive = !lastScanAt || new Date(lastScanAt) < warningThreshold;

        if (isInactive && !officersWithRecentWarning.has(officer.id)) {
          console.log(`⚠️ Inactivity warning queued for ${officer.first_name} ${officer.last_name}`);
          warningInserts.push({
            officer_id:      officer.id,
            organization_id: officer.organization_id,
            alert_type:      'inactivity_warning',
            officer_name:    `${officer.first_name} ${officer.last_name}`,
            officer_phone:   officer.phone,
            last_activity_at: lastScanAt,
            status:           'pending',
            escalation_level: 1,
          });
        }
      }

      // ── STEP 2: Auto-logoff ────────────────────────────────────────────────
      if (settings.auto_logoff_enabled && !inInvestigation) {
        const logoffThreshold = new Date(now.getTime() - settings.auto_logoff_time * 60 * 1000);
        const needsLogoff = !lastScanAt || new Date(lastScanAt) < logoffThreshold;

        if (needsLogoff) {
          console.log(`🚪 Queuing auto-logoff for ${officer.first_name} ${officer.last_name}`);
          logoffOfficers.push({ officer, lastScanAt, settings });
        }
      }

      // ── STEP 3: GPS welfare check ──────────────────────────────────────────
      if (settings.welfare_check_enabled && lastGps) {
        const gpsThreshold = new Date(now.getTime() - settings.gps_inactivity_threshold * 60 * 1000);
        const gpsInactive  = new Date(lastGps.recorded_at) < gpsThreshold;

        if (gpsInactive && !officersWithPendingWelfareAlert.has(officer.id)) {
          const orgPeers  = recentlyActiveByOrg.get(officer.organization_id) ?? new Set();
          const hasPeers  = orgPeers.size > 0 && !orgPeers.has(officer.id)
            ? orgPeers.size > 1
            : orgPeers.size > 0 && [...orgPeers][0] !== officer.id;

          console.log(`🚨 Welfare check queued for ${officer.first_name} ${officer.last_name}`);
          welfareInserts.push({
            officer_id:      officer.id,
            organization_id: officer.organization_id,
            alert_type:      'welfare_check',
            officer_name:    `${officer.first_name} ${officer.last_name}`,
            officer_phone:   officer.phone,
            gps_latitude:    lastGps.gps_latitude,
            gps_longitude:   lastGps.gps_longitude,
            gps_accuracy:    lastGps.gps_accuracy,
            last_activity_at: lastGps.recorded_at,
            status:           'pending',
            escalation_level: hasPeers ? 0 : 1,
          });
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BATCH INSERT: warnings
    // ─────────────────────────────────────────────────────────────────────────
    if (warningInserts.length > 0) {
      await supabaseAdmin.from('officer_welfare_alerts').insert(warningInserts);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BATCH: auto-logoffs (rpc per officer is unavoidable, but limited set)
    // ─────────────────────────────────────────────────────────────────────────
    for (const { officer, lastScanAt, settings } of logoffOfficers) {
      await supabaseAdmin.rpc('log_officer_activity', {
        p_user_id:      officer.id,
        p_activity_type: 'auto_logout',
        p_metadata: {
          reason:            'inactivity_timeout',
          last_scan:         lastScanAt,
          threshold_minutes: settings.auto_logoff_time,
        },
      });
    }

    // Resolve pending inactivity warnings for logged-off officers (batch update)
    if (logoffOfficers.length > 0) {
      const logoffIds = logoffOfficers.map((o: any) => o.officer.id);
      await supabaseAdmin
        .from('officer_welfare_alerts')
        .update({
          status:           'resolved',
          resolved_at:      now.toISOString(),
          resolution_notes: 'Officer auto-logged off due to inactivity',
        })
        .in('officer_id', logoffIds)
        .eq('alert_type', 'inactivity_warning')
        .eq('status', 'pending');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BATCH INSERT: welfare alerts
    // ─────────────────────────────────────────────────────────────────────────
    if (welfareInserts.length > 0) {
      await supabaseAdmin.from('officer_welfare_alerts').insert(welfareInserts);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3.5 + 4 + 5: Escalations — batch fetch all pending alerts + settings
    // ─────────────────────────────────────────────────────────────────────────
    const { data: pendingAlertsRaw } = await supabaseAdmin
      .from('officer_welfare_alerts')
      .select('id, officer_id, officer_name, alert_type, alert_sent_at, escalation_level')
      .eq('status', 'pending')
      .in('alert_type', ['welfare_check', 'man_down']);

    let escalationCount = 0;
    let manDownEscalations = 0;

    if (pendingAlertsRaw && pendingAlertsRaw.length > 0) {
      // Batch-fetch escalation settings for all affected officers
      const alertOfficerIds = [...new Set((pendingAlertsRaw as any[]).map((a: any) => a.officer_id))];
      const { data: escalationSettingsRaw } = await supabaseAdmin
        .from('officer_welfare_settings')
        .select('user_id, gps_inactivity_threshold, admin_escalation_time, critical_escalation_time, man_down_escalation_minutes')
        .in('user_id', alertOfficerIds);

      const settingsMap = new Map(
        (escalationSettingsRaw ?? []).map((s: any) => [s.user_id, s])
      );

      const escalateToLevel: Map<string, number> = new Map(); // alert id → new level

      for (const alert of pendingAlertsRaw as any[]) {
        const alertAgeMin = (now.getTime() - new Date(alert.alert_sent_at).getTime()) / 60_000;
        const s = settingsMap.get(alert.officer_id);
        if (!s) continue;

        if (alert.alert_type === 'man_down') {
          const threshold = s.man_down_escalation_minutes ?? 5;
          if (alert.escalation_level < 2 && alertAgeMin >= threshold) {
            console.log(`🚨 MAN-DOWN level 2 for ${alert.officer_name} — ${Math.round(alertAgeMin)} min`);
            escalateToLevel.set(alert.id, 2);
            manDownEscalations++;
          }
          if (alert.escalation_level < 3 && alertAgeMin >= threshold * 3) {
            console.log(`🚨 MAN-DOWN CRITICAL for ${alert.officer_name} — ${Math.round(alertAgeMin)} min`);
            escalateToLevel.set(alert.id, 3);
            manDownEscalations++;
          }
        }

        if (alert.alert_type === 'welfare_check') {
          // 3.5: peer-level (0) → admin (1) after 5 min
          if (alert.escalation_level === 0 && alertAgeMin >= 5) {
            console.log(`⚠️ No peer response for ${alert.officer_name} — escalating to admin`);
            escalateToLevel.set(alert.id, 1);
            escalationCount++;
          }
          // 4a: admin (1) → high priority (2)
          if (alert.escalation_level === 1 && alertAgeMin >= s.admin_escalation_time) {
            console.log(`⚠️ Welfare check HIGH PRIORITY for ${alert.officer_name}`);
            escalateToLevel.set(alert.id, 2);
            escalationCount++;
          }
          // 4b: high priority (2) → critical (3)
          if (alert.escalation_level === 2 && alertAgeMin >= (s.admin_escalation_time + s.critical_escalation_time)) {
            console.log(`🚨 CRITICAL ESCALATION for ${alert.officer_name} — ${Math.round(alertAgeMin)} min`);
            escalateToLevel.set(alert.id, 3);
            escalationCount++;
          }
        }
      }

      // Batch update escalations grouped by level (typically 1-3 groups)
      const byLevel = new Map<number, string[]>();
      for (const [id, level] of escalateToLevel) {
        if (!byLevel.has(level)) byLevel.set(level, []);
        byLevel.get(level)!.push(id);
      }
      for (const [level, ids] of byLevel) {
        await supabaseAdmin
          .from('officer_welfare_alerts')
          .update({ escalation_level: level, escalated_at: now.toISOString() })
          .in('id', ids);
      }
    }

    console.log('✅ Officer welfare monitoring complete');

    return successResponse(corsHeaders, now,
      officers.length,
      welfareInserts.length,
      escalationCount,
      manDownEscalations,
    );

  } catch (error: any) {
    console.error('❌ Welfare monitoring error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

function successResponse(
  headers: Record<string, string>,
  now: Date,
  officersChecked: number,
  welfareChecks: number,
  escalations: number,
  manDownEscalations: number,
) {
  return new Response(
    JSON.stringify({
      success: true,
      timestamp: now.toISOString(),
      officers_checked: officersChecked,
      welfare_checks: welfareChecks,
      escalations,
      man_down_escalations: manDownEscalations,
    }),
    { headers: { ...headers, 'Content-Type': 'application/json' }, status: 200 }
  );
}
