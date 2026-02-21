/**
 * Observations List - Returns paginated, sorted, searchable observations table
 * 
 * Request:
 * {
 *   "date_from": "YYYY-MM-DD",
 *   "date_to": "YYYY-MM-DD",
 *   "organization_id": "uuid|null",
 *   "zone_id": "uuid|null",
 *   "page": 1,
 *   "page_size": 50,
 *   "sort": [{ "field": "created_at", "dir": "desc" }],
 *   "search": "ABC123",
 *   "bbox": { "north": -43.51, "south": -43.55, "east": 172.67, "west": 172.60 }
 * }
 * 
 * Response:
 * {
 *   "rows": [
 *     {
 *       "id": "uuid",
 *       "created_at": "2026-02-20T10:42:01Z",
 *       "recorded_at": "2026-02-20T10:42:01Z",
 *       "plate_number": "ABC123",
 *       "officer_name": "J. Smith",
 *       "zone_name": "Central",
 *       "is_compliant": false,
 *       "breach_type": "Overstay",
 *       "photo_url": "https://...",
 *       "gps_latitude": -43.53,
 *       "gps_longitude": 172.63
 *     }
 *   ],
 *   "total": 15000
 * }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts';

serve(withCors(async (req) => {
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

  const {
    date_from,
    date_to,
    organization_id,
    zone_id,
    page = 1,
    page_size = 50,
    sort = [{ field: 'recorded_at', dir: 'desc' }],
    search = '',
    bbox,
  } = await req.json();

  // Validate required fields
  if (!date_from || !date_to) {
    return errorResponse('date_from and date_to are required', req, 400);
  }

  // Validate page/page_size
  const validatedPage = Math.max(1, parseInt(String(page)));
  const validatedPageSize = Math.min(100, Math.max(1, parseInt(String(page_size))));

  // Build query
  let query = supabaseClient
    .from('observations')
    .select(`
      id,
      created_at,
      recorded_at,
      plate_number,
      is_compliant,
      breach_type,
      photo_url,
      gps_latitude,
      gps_longitude,
      zone:zones(name),
      recorded_by_user:user_profiles(first_name, last_name)
    `, { count: 'exact' })
    .gte('recorded_at', `${date_from}T00:00:00Z`)
    .lte('recorded_at', `${date_to}T23:59:59Z`);

  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }

  if (zone_id) {
    query = query.eq('zone_id', zone_id);
  }

  // Apply bbox filter if provided
  if (bbox && typeof bbox === 'object') {
    const { north, south, east, west } = bbox;
    if (typeof north === 'number' && typeof south === 'number' && typeof east === 'number' && typeof west === 'number') {
      query = query
        .gte('gps_latitude', south)
        .lte('gps_latitude', north)
        .gte('gps_longitude', west)
        .lte('gps_longitude', east);
    }
  }

  // Apply search filter
  if (search && search.trim()) {
    query = query.or(`plate_number.ilike.%${search.trim()}%`);
  }

  // Apply sorting
  const sortField = sort[0]?.field || 'recorded_at';
  const sortDir = sort[0]?.dir || 'desc';
  query = query.order(sortField, { ascending: sortDir === 'asc' });

  // Apply pagination
  const from = (validatedPage - 1) * validatedPageSize;
  const to = from + validatedPageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error('Database error:', error);
    return errorResponse(error.message, req, 500);
  }

  // Format response
  const rows = (data || []).map((obs: any) => ({
    id: obs.id,
    created_at: obs.created_at,
    recorded_at: obs.recorded_at,
    plate_number: obs.plate_number || 'Unknown',
    officer_name: obs.recorded_by_user
      ? `${obs.recorded_by_user.first_name} ${obs.recorded_by_user.last_name}`
      : 'Unknown',
    zone_name: obs.zone?.name || 'Unknown Zone',
    is_compliant: obs.is_compliant,
    breach_type: obs.breach_type,
    photo_url: obs.photo_url,
    gps_latitude: obs.gps_latitude,
    gps_longitude: obs.gps_longitude,
  }));

  return jsonResponse({ rows, total: count || 0 }, req);
}));
