/**
 * submit-camper-registration — Public camper stay registration (B-17)
 *
 * Unauthenticated (anon) endpoint.
 *
 * POST body:
 *   {
 *     zone_id:           string   — UUID of the zone
 *     plate_number?:     string
 *     vehicle_type?:     'self_contained' | 'campervan' | 'tent' | 'car' | 'motorhome' | 'other'
 *     is_self_contained?: boolean
 *     contact_name?:     string
 *     contact_email?:    string
 *     contact_phone?:    string
 *     party_size?:       number   (1–20, default 1)
 *     arrival_date:      string   — ISO date "YYYY-MM-DD"
 *     departure_date:    string   — ISO date "YYYY-MM-DD"
 *     notes?:            string
 *   }
 *
 * Returns: { success: true, confirmation_code, zone_name, nights }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { getCorsHeaders } from '../_shared/withCors.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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
      zone_id,
      plate_number,
      vehicle_type,
      is_self_contained,
      contact_name,
      contact_email,
      contact_phone,
      party_size,
      arrival_date,
      departure_date,
      notes,
    } = body as {
      zone_id:            string;
      plate_number?:      string;
      vehicle_type?:      string;
      is_self_contained?: boolean;
      contact_name?:      string;
      contact_email?:     string;
      contact_phone?:     string;
      party_size?:        number;
      arrival_date:       string;
      departure_date:     string;
      notes?:             string;
    };

    // ── Input validation ──────────────────────────────────────────────────────
    if (!zone_id?.trim()) {
      return new Response(JSON.stringify({ error: 'zone_id is required' }), {
        status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }
    if (!arrival_date || !departure_date) {
      return new Response(JSON.stringify({ error: 'arrival_date and departure_date are required' }), {
        status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }
    if (new Date(departure_date) < new Date(arrival_date)) {
      return new Response(JSON.stringify({ error: 'departure_date must be on or after arrival_date' }), {
        status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ── 1. Validate zone exists and is active ─────────────────────────────────
    const { data: zone, error: zoneError } = await supabase
      .from('zones')
      .select('id, name, is_active, max_vehicles')
      .eq('id', zone_id.trim())
      .single();

    if (zoneError || !zone) {
      return new Response(
        JSON.stringify({ error: 'Zone not found.' }),
        { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      );
    }
    if (!zone.is_active) {
      return new Response(
        JSON.stringify({ error: 'This zone is currently closed.' }),
        { status: 422, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      );
    }

    // ── 2. Capacity check (if max_vehicles configured) ────────────────────────
    if (zone.max_vehicles != null) {
      const { count } = await supabase
        .from('camper_registrations')
        .select('*', { count: 'exact', head: true })
        .eq('zone_id', zone_id)
        .eq('status', 'active')
        .lte('arrival_date', departure_date)
        .gte('departure_date', arrival_date);

      if ((count ?? 0) >= zone.max_vehicles) {
        return new Response(
          JSON.stringify({ error: 'This zone is at capacity for the requested dates.' }),
          { status: 422, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
        );
      }
    }

    // ── 3. Generate confirmation code ─────────────────────────────────────────
    const { data: codeData, error: codeError } = await supabase
      .rpc('generate_camper_confirmation_code');

    if (codeError || !codeData) {
      console.error('[submit-camper-registration] code gen error:', codeError);
      return new Response(
        JSON.stringify({ error: 'Failed to generate confirmation code.' }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      );
    }

    // ── 4. Insert registration ────────────────────────────────────────────────
    const { error: insertError } = await supabase
      .from('camper_registrations')
      .insert({
        zone_id,
        confirmation_code:  codeData,
        plate_number:       plate_number?.trim().toUpperCase()  || null,
        vehicle_type:       vehicle_type                        || null,
        is_self_contained:  is_self_contained ?? false,
        contact_name:       contact_name?.trim()  || null,
        contact_email:      contact_email?.trim() || null,
        contact_phone:      contact_phone?.trim() || null,
        party_size:         party_size            ?? 1,
        arrival_date,
        departure_date,
        notes:              notes?.trim()         || null,
        status:             'active',
      });

    if (insertError) {
      console.error('[submit-camper-registration] insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to submit registration. Please try again.' }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
      );
    }

    const nights = Math.max(1, Math.round(
      (new Date(departure_date).getTime() - new Date(arrival_date).getTime()) / 86_400_000
    ));

    return new Response(
      JSON.stringify({
        success:           true,
        confirmation_code: codeData,
        zone_name:         zone.name,
        nights,
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    console.error('[submit-camper-registration] unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: err.message }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    );
  }
});
