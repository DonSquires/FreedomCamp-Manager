/**
 * Observations List - Returns paginated, sorted, searchable observations table
 * 
 * Request:
 * {
 *   "date_from": "YYYY-MM-DD",
 *   "date_to": "YYYY-MM-DD",
 *   "organization_id": "uuid|null",
 *   "zone_id": "uuid|null",
 *   "recorded_by": "uuid|null",
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
 *       "photo": "https://...",
 *       "photo_url": "https://...",
 *       "gps_latitude": -43.53,
 *       "gps_longitude": 172.63
 *     }
 *   ],
 *   "total": 15000
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

  const {
    date_from,
    date_to,
    organization_id,
    zone_id,
    recorded_by,
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
  const validatedPageSize = Math.min(1000, Math.max(1, parseInt(String(page_size))));

  // Determine role/org scope from profile to enforce safe defaults.
  const { data: profile, error: profileError } = await supabaseClient
    .from('user_profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return errorResponse('User profile not found', req, 403);
  }

  if (profile.role !== 'master' && !profile.organization_id) {
    return errorResponse('User organization is not configured', req, 403);
  }

  const isMaster = profile?.role === 'master';
  const effectiveOrganizationId = isMaster
    ? (organization_id || null)
    : (profile?.organization_id || null);

  // Build query
  let query = supabaseClient
    .from('observations')
    .select(`
      id:observation_id,
      created_at,
      recorded_at,
      plate_number,
      recorded_by,
      is_compliant,
      breach_type,
      photo,
      photo_url,
      gps_latitude,
      gps_longitude,
      zone:zones(name),
      recorded_by_user:user_profiles(first_name, last_name)
    `, { count: 'exact' })
    .gte('recorded_at', `${date_from}T00:00:00Z`)
    .lte('recorded_at', `${date_to}T23:59:59Z`);

  if (effectiveOrganizationId) {
    query = query.eq('organization_id', effectiveOrganizationId);
  }

  if (zone_id) {
    query = query.eq('zone_id', zone_id);
  }

  if (recorded_by) {
    query = query.eq('recorded_by', recorded_by);
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
  const requestedSortField = sort[0]?.field || 'recorded_at';
  const sortField = requestedSortField === 'id' ? 'observation_id' : requestedSortField;
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
    recorded_by: obs.recorded_by,
    officer_name: obs.recorded_by_user
      ? `${obs.recorded_by_user.first_name} ${obs.recorded_by_user.last_name}`
      : 'Unknown',
    zone_name: obs.zone?.name || 'Unknown Zone',
    is_compliant: obs.is_compliant,
    breach_type: obs.breach_type,
    photo: obs.photo ?? obs.photo_url ?? null,
    photo_url: obs.photo_url ?? obs.photo ?? null,
    gps_latitude: obs.gps_latitude,
    gps_longitude: obs.gps_longitude,
  }));

  return jsonResponse({ rows, total: count || 0 }, req);
}));
