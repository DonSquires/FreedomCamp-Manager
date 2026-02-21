/**
 * Observations in Bounds - Returns observations within map cluster bounds
 * 
 * Request:
 * {
 *   "date_from": "YYYY-MM-DD",
 *   "date_to": "YYYY-MM-DD",
 *   "organization_id": "uuid|null",
 *   "zone_id": "uuid|null",
 *   "bounds": { "north": -43.51, "south": -43.55, "east": 172.67, "west": 172.60 },
 *   "limit": 50
 * }
 * 
 * Response:
 * {
 *   "rows": [
 *     {
 *       "id": "uuid",
 *       "plate_number": "ABC123",
 *       "recorded_at": "2026-02-20T10:42:01Z",
 *       "zone_name": "Central",
 *       "recorded_by_name": "J. Smith",
 *       "is_compliant": false,
 *       "photo_url": "https://...",
 *       "gps_latitude": -43.53,
 *       "gps_longitude": 172.63
 *     }
 *   ],
 *   "total": 123
 * }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    );

    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { date_from, date_to, organization_id, zone_id, bounds, limit = 50 } = await req.json();

    // Validate required fields
    if (!date_from || !date_to || !bounds) {
      return new Response(
        JSON.stringify({ error: 'date_from, date_to, and bounds are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { north, south, east, west } = bounds;
    if (typeof north !== 'number' || typeof south !== 'number' || typeof east !== 'number' || typeof west !== 'number') {
      return new Response(
        JSON.stringify({ error: 'bounds must contain north, south, east, west as numbers' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build query
    let query = supabaseClient
      .from('observations')
      .select(`
        id,
        plate_number,
        recorded_at,
        is_compliant,
        photo_url,
        gps_latitude,
        gps_longitude,
        zone:zones(name),
        recorded_by_user:user_profiles(first_name, last_name)
      `, { count: 'exact' })
      .gte('gps_latitude', south)
      .lte('gps_latitude', north)
      .gte('gps_longitude', west)
      .lte('gps_longitude', east)
      .gte('recorded_at', `${date_from}T00:00:00Z`)
      .lte('recorded_at', `${date_to}T23:59:59Z`)
      .order('recorded_at', { ascending: false })
      .limit(limit);

    if (organization_id) {
      query = query.eq('organization_id', organization_id);
    }

    if (zone_id) {
      query = query.eq('zone_id', zone_id);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('Database error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format response
    const rows = (data || []).map((obs: any) => ({
      id: obs.id,
      plate_number: obs.plate_number || 'Unknown',
      recorded_at: obs.recorded_at,
      zone_name: obs.zone?.name || 'Unknown Zone',
      recorded_by_name: obs.recorded_by_user
        ? `${obs.recorded_by_user.first_name} ${obs.recorded_by_user.last_name}`
        : 'Unknown',
      is_compliant: obs.is_compliant,
      photo_url: obs.photo_url,
      gps_latitude: obs.gps_latitude,
      gps_longitude: obs.gps_longitude,
    }));

    return new Response(
      JSON.stringify({ rows, total: count || 0 }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
