
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Officer Welfare Monitoring Edge Function
 * Runs periodically (every minute via cron job) to check:
 * 1. Auto-logoff based on vehicle scan inactivity
 * 2. Welfare checks based on GPS inactivity
 * 3. Escalation of unacknowledged alerts
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🔍 Starting officer welfare monitoring...');

    // Get current timestamp
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // STEP 1: Check for officers requiring inactivity warnings (10 minutes)
    const { data: officersForWarning } = await supabaseAdmin
      .from('user_profiles')
      .select(`
        id,
        first_name,
        last_name,
        phone,
        organization_id,
        officer_welfare_settings (
          auto_logoff_enabled,
          inactivity_warning_time
        )
      `)
      .eq('role', 'officer')
      .eq('is_active', true);

    if (officersForWarning) {
      for (const officer of officersForWarning) {
        const settings = (officer as any).officer_welfare_settings;
        if (!settings || !settings.auto_logoff_enabled) continue;

        const warningThreshold = new Date(now.getTime() - settings.inactivity_warning_time * 60 * 1000);

        // Get last vehicle scan activity
        const { data: lastScan } = await supabaseAdmin
          .from('officer_activity_log')
          .select('recorded_at')
          .eq('user_id', officer.id)
          .eq('activity_type', 'vehicle_scan')
          .order('recorded_at', { ascending: false })
          .limit(1)
          .single();

        // Check if officer is in active investigation (exception)
        const { data: activeInvestigation } = await supabaseAdmin
          .from('investigation_jobs')
          .select('id')
          .eq('assigned_to', officer.id)
          .eq('status', 'in_progress')
          .limit(1)
          .single();

        // Skip if in active investigation
        if (activeInvestigation) {
          console.log(`⏭️ Skipping ${officer.first_name} ${officer.last_name} - in active investigation`);
          continue;
        }

        // Check if warning needed
        if (!lastScan || new Date(lastScan.recorded_at) < warningThreshold) {
          // Check if warning already sent
          const { data: existingWarning } = await supabaseAdmin
            .from('officer_welfare_alerts')
            .select('id')
            .eq('officer_id', officer.id)
            .eq('alert_type', 'inactivity_warning')
            .eq('status', 'pending')
            .gte('alert_sent_at', fiveMinutesAgo.toISOString())
            .limit(1)
            .single();

          if (!existingWarning) {
            // Send inactivity warning
            console.log(`⚠️ Sending inactivity warning to ${officer.first_name} ${officer.last_name}`);
            
            await supabaseAdmin
              .from('officer_welfare_alerts')
              .insert({
                officer_id: officer.id,
                organization_id: officer.organization_id,
                alert_type: 'inactivity_warning',
                officer_name: `${officer.first_name} ${officer.last_name}`,
                officer_phone: officer.phone,
                last_activity_at: lastScan?.recorded_at || null,
                status: 'pending',
                escalation_level: 1,
              });
          }
        }
      }
    }

    // STEP 2: Check for officers requiring auto-logoff (20 minutes)
    if (officersForWarning) {
      for (const officer of officersForWarning) {
        const settings = (officer as any).officer_welfare_settings;
        if (!settings || !settings.auto_logoff_enabled) continue;

        const logoffThreshold = new Date(now.getTime() - settings.auto_logoff_time * 60 * 1000);

        // Get last vehicle scan activity
        const { data: lastScan } = await supabaseAdmin
          .from('officer_activity_log')
          .select('recorded_at')
          .eq('user_id', officer.id)
          .eq('activity_type', 'vehicle_scan')
          .order('recorded_at', { ascending: false })
          .limit(1)
          .single();

        // Check if officer is in active investigation (exception)
        const { data: activeInvestigation } = await supabaseAdmin
          .from('investigation_jobs')
          .select('id')
          .eq('assigned_to', officer.id)
          .eq('status', 'in_progress')
          .limit(1)
          .single();

        // Skip if in active investigation
        if (activeInvestigation) {
          continue;
        }

        // Check if logoff needed
        if (!lastScan || new Date(lastScan.recorded_at) < logoffThreshold) {
          console.log(`🚪 Auto-logging off ${officer.first_name} ${officer.last_name} due to inactivity`);
          
          // Log logout activity
          await supabaseAdmin.rpc('log_officer_activity', {
            p_user_id: officer.id,
            p_activity_type: 'auto_logout',
            p_metadata: {
              reason: 'inactivity_timeout',
              last_scan: lastScan?.recorded_at || null,
              threshold_minutes: settings.auto_logoff_time,
            },
          });

          // Mark warning as resolved
          await supabaseAdmin
            .from('officer_welfare_alerts')
            .update({
              status: 'resolved',
              resolved_at: now.toISOString(),
              resolution_notes: 'Officer auto-logged off due to inactivity',
            })
            .eq('officer_id', officer.id)
            .eq('alert_type', 'inactivity_warning')
            .eq('status', 'pending');
        }
      }
    }

    // STEP 3: Check for GPS inactivity (welfare checks)
    const { data: officersForWelfareCheck } = await supabaseAdmin
      .from('user_profiles')
      .select(`
        id,
        first_name,
        last_name,
        phone,
        organization_id,
        officer_welfare_settings (
          welfare_check_enabled,
          gps_inactivity_threshold
        )
      `)
      .eq('role', 'officer')
      .eq('is_active', true);

    if (officersForWelfareCheck) {
      for (const officer of officersForWelfareCheck) {
        const settings = (officer as any).officer_welfare_settings;
        if (!settings || !settings.welfare_check_enabled) continue;

        const gpsThreshold = new Date(now.getTime() - settings.gps_inactivity_threshold * 60 * 1000);

        // Get last GPS update
        const { data: lastGPS } = await supabaseAdmin
          .from('officer_activity_log')
          .select('*')
          .eq('user_id', officer.id)
          .eq('activity_type', 'gps_update')
          .not('gps_latitude', 'is', null)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .single();

        // Check if welfare check needed
        if (lastGPS && new Date(lastGPS.recorded_at) < gpsThreshold) {
          // Check if alert already exists
          const { data: existingAlert } = await supabaseAdmin
            .from('officer_welfare_alerts')
            .select('id, escalation_level, alert_sent_at')
            .eq('officer_id', officer.id)
            .eq('alert_type', 'welfare_check')
            .eq('status', 'pending')
            .order('alert_sent_at', { ascending: false })
            .limit(1)
            .single();

          if (!existingAlert) {
            console.log(`🚨 Creating welfare check for ${officer.first_name} ${officer.last_name} - GPS inactive for ${settings.gps_inactivity_threshold} minutes`);
            
            // STEP 1: Check for other logged-in field officers in the same organisation
            const { data: otherOfficers } = await supabaseAdmin
              .from('officer_activity_log')
              .select('user_id')
              .eq('organization_id', officer.organization_id)
              .eq('activity_type', 'gps_update')
              .gte('recorded_at', new Date(now.getTime() - 15 * 60 * 1000).toISOString())
              .neq('user_id', officer.id)
              .limit(1);

            const hasOtherOfficersLoggedIn = otherOfficers && otherOfficers.length > 0;

            // Create welfare check alert
            await supabaseAdmin
              .from('officer_welfare_alerts')
              .insert({
                officer_id: officer.id,
                organization_id: officer.organization_id,
                alert_type: 'welfare_check',
                officer_name: `${officer.first_name} ${officer.last_name}`,
                officer_phone: officer.phone,
                gps_latitude: lastGPS.gps_latitude,
                gps_longitude: lastGPS.gps_longitude,
                gps_accuracy: lastGPS.gps_accuracy,
                last_activity_at: lastGPS.recorded_at,
                status: 'pending',
                // If other officers are logged in, escalation_level 0 (notify peers first)
                // Otherwise escalation_level 1 (notify admin directly)
                escalation_level: hasOtherOfficersLoggedIn ? 0 : 1,
              });

            console.log(`📢 Welfare alert created - ${hasOtherOfficersLoggedIn ? 'notifying peer officers' : 'notifying admin team'}`);
          }
        }
      }
    }

    // STEP 3.5: Escalate peer-level alerts to admin if no response
    const { data: peerAlerts } = await supabaseAdmin
      .from('officer_welfare_alerts')
      .select('*')
      .eq('alert_type', 'welfare_check')
      .eq('status', 'pending')
      .eq('escalation_level', 0);

    if (peerAlerts) {
      for (const alert of peerAlerts) {
        const alertAge = (now.getTime() - new Date(alert.alert_sent_at).getTime()) / (1000 * 60);

        // Get escalation settings
        const { data: settings } = await supabaseAdmin
          .from('officer_welfare_settings')
          .select('gps_inactivity_threshold')
          .eq('user_id', alert.officer_id)
          .single();

        if (!settings) continue;

        // After 5 minutes with no peer response, escalate to admin
        if (alertAge >= 5) {
          console.log(`⚠️ No peer response for ${alert.officer_name} - escalating to admin`);
          
          await supabaseAdmin
            .from('officer_welfare_alerts')
            .update({
              escalation_level: 1,
              escalated_at: now.toISOString(),
            })
            .eq('id', alert.id);
        }
      }
    }

    // STEP 4: Escalate unacknowledged welfare checks
    const { data: pendingAlerts } = await supabaseAdmin
      .from('officer_welfare_alerts')
      .select('*')
      .eq('alert_type', 'welfare_check')
      .eq('status', 'pending');

    if (pendingAlerts) {
      for (const alert of pendingAlerts) {
        const alertAge = (now.getTime() - new Date(alert.alert_sent_at).getTime()) / (1000 * 60);

        // Get escalation settings
        const { data: settings } = await supabaseAdmin
          .from('officer_welfare_settings')
          .select('admin_escalation_time, critical_escalation_time')
          .eq('user_id', alert.officer_id)
          .single();

        if (!settings) continue;

        // Escalate to admin (high priority) after admin_escalation_time minutes
        if (alert.escalation_level === 1 && alertAge >= settings.admin_escalation_time) {
          console.log(`⚠️ Escalating welfare check to HIGH PRIORITY for ${alert.officer_name}`);
          
          await supabaseAdmin
            .from('officer_welfare_alerts')
            .update({
              escalation_level: 2,
              escalated_at: now.toISOString(),
            })
            .eq('id', alert.id);
        }

        // Escalate to critical after critical_escalation_time minutes (total time admin_escalation_time + critical_escalation_time)
        // This check should only happen if the alert has already been escalated to level 2
        if (alert.escalation_level === 2 && alertAge >= (settings.admin_escalation_time + settings.critical_escalation_time)) {
          console.log(`🚨 CRITICAL ESCALATION for ${alert.officer_name} - ${Math.round(alertAge)} minutes no response`);
          
          await supabaseAdmin
            .from('officer_welfare_alerts')
            .update({
              escalation_level: 3,
              escalated_at: now.toISOString(),
            })
            .eq('id', alert.id);
        }
      }
    }

    // STEP 5: Escalate unacknowledged man-down alerts
    // Man-down alerts are created by the client hook; here we handle server-side escalation.
    const { data: manDownAlerts } = await supabaseAdmin
      .from('officer_welfare_alerts')
      .select('id, officer_id, officer_name, alert_sent_at, escalation_level')
      .eq('alert_type', 'man_down')
      .eq('status', 'pending');

    let manDownEscalations = 0;
    if (manDownAlerts && manDownAlerts.length > 0) {
      // Batch-fetch all officer settings for affected officers to avoid N+1 queries
      const officerIds = [...new Set(manDownAlerts.map((a: any) => a.officer_id))];
      const { data: allMdSettings } = await supabaseAdmin
        .from('officer_welfare_settings')
        .select('user_id, man_down_escalation_minutes')
        .in('user_id', officerIds);

      const settingsByOfficer = new Map(
        (allMdSettings ?? []).map((s: any) => [s.user_id, s])
      );

      for (const alert of manDownAlerts) {
        const alertAgeMin = (now.getTime() - new Date((alert as any).alert_sent_at).getTime()) / 60_000;
        const mdSettings = settingsByOfficer.get((alert as any).officer_id);
        const escalationThresholdMin = mdSettings?.man_down_escalation_minutes ?? 5;

        if ((alert as any).escalation_level < 2 && alertAgeMin >= escalationThresholdMin) {
          console.log(`🚨 MAN-DOWN escalation level 2 for ${(alert as any).officer_name} — ${Math.round(alertAgeMin)} min unacknowledged`);
          await supabaseAdmin
            .from('officer_welfare_alerts')
            .update({ escalation_level: 2, escalated_at: now.toISOString() })
            .eq('id', (alert as any).id);
          manDownEscalations++;
        }

        if ((alert as any).escalation_level < 3 && alertAgeMin >= (escalationThresholdMin * 3)) {
          console.log(`🚨 MAN-DOWN CRITICAL for ${(alert as any).officer_name} — ${Math.round(alertAgeMin)} min, no response`);
          await supabaseAdmin
            .from('officer_welfare_alerts')
            .update({ escalation_level: 3, escalated_at: now.toISOString() })
            .eq('id', (alert as any).id);
          manDownEscalations++;
        }
      }
    }

    console.log('✅ Officer welfare monitoring complete');

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: now.toISOString(),
        warnings_checked: officersForWarning?.length || 0,
        welfare_checks: officersForWelfareCheck?.length || 0,
        escalations: pendingAlerts?.length || 0,
        man_down_escalations: manDownEscalations,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('❌ Welfare monitoring error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
