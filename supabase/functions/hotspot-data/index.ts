/**
 * Hotspot Data - Returns clustered GPS points for heat map
 * 
 * Request:
 * {
 *   "date_from": "YYYY-MM-DD",
 *   "date_to": "YYYY-MM-DD",
 *   "organization_id": "uuid|null",
 *   "zone_id": "uuid|null"
 * }
 * 
 * Response:
 * {
 *   "points": [
 *     { "lat": -43.53, "lng": 172.63, "count": 3, "zone_name": "Central" }
 *   ]
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts';

Deno.serve(withCors(async (req) => {
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

  // Validate auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return errorResponse('Missing authorization header', req, 401);
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

  if (userError || !user) {
    return errorResponse('Unauthorized', req, 401);
  }

  // Parse request body
  const { date_from, date_to, organization_id, zone_id } = await req.json();

  // Validate required fields
  if (!date_from || !date_to) {
    return errorResponse('date_from and date_to are required', req, 400);
  }

  // Build query - get all observations with GPS coordinates
  let query = supabaseClient
    .from('observations')
    .select('gps_latitude, gps_longitude, zone:zones(name)')
    .not('gps_latitude', 'is', null)
    .not('gps_longitude', 'is', null)
    .neq('gps_latitude', 0) // Exclude (0,0) "Null Island"
    .neq('gps_longitude', 0)
    .gte('recorded_at', `${date_from}T00:00:00Z`)
    .lte('recorded_at', `${date_to}T23:59:59Z`);

  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }

  if (zone_id) {
    query = query.eq('zone_id', zone_id);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Database error:', error);
    return errorResponse(error.message, req, 500);
  }

  // Group by GPS coordinates (rounded to ~100m precision for clustering)
  const grouped = new Map<string, { lat: number; lng: number; count: number; zone_name?: string }>();

  for (const obs of data || []) {
    const latKey = Math.round(obs.gps_latitude * 1000) / 1000;
    const lngKey = Math.round(obs.gps_longitude * 1000) / 1000;
    const key = `${latKey},${lngKey}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        lat: latKey,
        lng: lngKey,
        count: 0,
        zone_name: obs.zone?.name,
      });
    }

    const point = grouped.get(key)!;
    point.count += 1;
  }

  const points = Array.from(grouped.values());

  return jsonResponse({ points }, req);
}));
