/**
 * wearable-sos — Apple Watch / BLE wearable SOS handler (B-14)
 *
 * Called by:
 *   • The web app when an officer taps the SOS button in WearableStatus
 *   • The Expo companion app when the officer triggers SOS from Apple Watch
 *
 * POST body:
 *   {
 *     user_id:          string   — officer's auth.uid()
 *     organization_id:  string
 *     location?:        { lat: number; lon: number }
 *     device_type?:     'apple_watch' | 'ble_button' | 'web' (default 'web')
 *   }
 *
 * Actions:
 *   1. Inserts officer_welfare_alerts row (alert_type = 'sos_wearable', escalation_level = 2)
 *   2. Fan-out push notification to all admins / admin_officers in the org
 *   3. Returns { success: true, alert_id }
 *
 * Authorization: accepts a user JWT (officer sending own SOS) or service-role key.
 * Service-role is used when the companion app posts on behalf of the officer.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { getCorsHeaders } from '../_shared/withCors.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')          ?? '';
const SERVICE_ROLE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EXPO_PUSH_API        = 'https://exp.host/--/api/v2/push/send';

// ─── Push helper ──────────────────────────────────────────────────────────────

async function pushToUser(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  // Use existing send-push-notification function for full VAPID / Expo routing
  await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey':        SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({
      user_id:     userId,
      title,
      body,
      priority:    'high',
      category_id: 'wearable_sos',
      data: {
        notification_type: 'sos_wearable',
        url:               '/admin/welfare',
        ...data,
      },
    }),
  }).catch((err) => console.error('[wearable-sos] push delivery failed:', err?.message ?? err));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const {
      user_id,
      organization_id,
      location,
      device_type = 'web',
    } = body as {
      user_id:         string;
      organization_id: string;
      location?:       { lat: number; lon: number };
      device_type?:    'apple_watch' | 'ble_button' | 'web';
    };

    if (!user_id || !organization_id) {
      return new Response(
        JSON.stringify({ error: 'user_id and organization_id are required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ── 1. Insert welfare alert ───────────────────────────────────────────────
    const { data: alert, error: alertError } = await supabaseAdmin
      .from('officer_welfare_alerts')
      .insert({
        officer_id:       user_id,
        organization_id,
        alert_type:       'sos_wearable',
        status:           'active',
        escalation_level: 2,
        notes: device_type === 'apple_watch'
          ? 'SOS triggered from Apple Watch'
          : device_type === 'ble_button'
          ? 'SOS triggered from BLE panic button'
          : 'SOS triggered from wearable interface',
        ...(location ? {
          last_known_lat: location.lat,
          last_known_lon: location.lon,
        } : {}),
      })
      .select('id')
      .single();

    if (alertError) {
      console.error('[wearable-sos] alert insert error:', alertError);
      return new Response(
        JSON.stringify({ error: 'Failed to create SOS alert', detail: alertError.message }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      );
    }

    // ── 2. Fetch officer name for notification body ───────────────────────────
    const { data: officer } = await supabaseAdmin
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('id', user_id)
      .single();

    const officerName = officer
      ? `${officer.first_name ?? ''} ${officer.last_name ?? ''}`.trim() || 'Officer'
      : 'Officer';

    // ── 3. Fan push to all admins / admin_officers in org ─────────────────────
    const { data: supervisors } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('organization_id', organization_id)
      .in('role', ['admin', 'admin_officer', 'master', 'grand_master']);

    if (supervisors?.length) {
      const deviceLabel = device_type === 'apple_watch' ? ' (Apple Watch)' : '';
      await Promise.all(
        supervisors.map((s) =>
    pushToUser(
            supabaseAdmin,
            s.id,
            `🆘 SOS Alert${deviceLabel}`,
            `${officerName} has triggered an SOS. Immediate response required.`,
            { alert_id: alert.id, officer_id: user_id, organization_id, device_type },
          )
        ),
      );
    }

    // ── 4. Broadcast Realtime event ───────────────────────────────────────────
    await supabaseAdmin
      .channel('officer-welfare')
      .send({
        type:    'broadcast',
        event:   'sos_wearable',
        payload: {
          alert_id:        alert.id,
          officer_id:      user_id,
          organization_id,
          officer_name:    officerName,
          device_type,
          location:        location ?? null,
          triggered_at:    new Date().toISOString(),
        },
      })
      .catch((err) => console.error('[wearable-sos] realtime broadcast error:', err));

    return new Response(
      JSON.stringify({ success: true, alert_id: alert.id }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    console.error('[wearable-sos] unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err.message }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    );
  }
});
