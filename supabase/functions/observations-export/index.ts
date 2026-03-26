/**
 * Observations Export - Server-Generated CSV Export
 * 
 * Returns CSV file matching current table filters with RLS enforcement.
 * Streams up to 200k rows with proper escaping and filename generation.
 * 
 * Request:
 * {
 *   "date_from": "YYYY-MM-DD",
 *   "date_to": "YYYY-MM-DD",
 *   "organization_id": "uuid|null",
 *   "zone_id": "uuid|null",
 *   "search": "ABC123",
 *   "bbox": { "north": -43.51, "south": -43.55, "east": 172.67, "west": 172.60 }
 * }
 * 
 * Response: CSV file download
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, getCorsHeaders, errorResponse } from '../_shared/withCors.ts';

interface ExportRequest {
  date_from: string;
  date_to: string;
  organization_id?: string | null;
  zone_id?: string | null;
  search?: string;
  bbox?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

function csvEscape(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Escape quotes and wrap if contains comma, quote, or newline
  if (/[,"\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCSV(row: any, columns: string[]): string {
  return columns.map(col => csvEscape(row[col])).join(',');
}

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

  let body: ExportRequest;
  try {
    body = await req.json() as ExportRequest;
  } catch {
    return errorResponse('Invalid JSON body', req, 400);
  }

  const {
    date_from,
    date_to,
    organization_id,
    zone_id,
    search,
    bbox,
  } = body;

  // Validate required fields
  if (!date_from || !date_to) {
    return errorResponse('date_from and date_to are required', req, 400);
  }

  // Validate date format
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(date_from) || !datePattern.test(date_to)) {
    return errorResponse('Invalid date format. Use YYYY-MM-DD', req, 400);
  }

  // Build query with key-column fallback for schema variants.
  const buildQuery = (keyColumn: 'id' | 'observation_id') => {
    let q = supabaseClient
      .from('observations')
      .select(`
        ${keyColumn},
        recorded_at,
        plate_number,
        is_compliant,
        breach_type,
        gps_latitude,
        gps_longitude,
        photo_url,
        zone:zones(name),
        recorded_by_user:user_profiles(first_name, last_name),
        organization:organizations(name)
      `)
      .gte('recorded_at', `${date_from}T00:00:00Z`)
      .lte('recorded_at', `${date_to}T23:59:59Z`)
      .order('recorded_at', { ascending: false })
      .limit(200000); // Safety limit

    if (organization_id) {
      q = q.eq('organization_id', organization_id);
    }

    if (zone_id) {
      q = q.eq('zone_id', zone_id);
    }

    if (bbox && typeof bbox === 'object') {
      const { north, south, east, west } = bbox;
      if (typeof north === 'number' && typeof south === 'number' && typeof east === 'number' && typeof west === 'number') {
        q = q
          .gte('gps_latitude', south)
          .lte('gps_latitude', north)
          .gte('gps_longitude', west)
          .lte('gps_longitude', east)
          .neq('gps_latitude', 0)
          .neq('gps_longitude', 0);
      }
    }

    if (search && search.trim()) {
      q = q.or(`plate_number.ilike.%${search.trim()}%`);
    }

    return q;
  };
  let keyColumn: 'id' | 'observation_id' = 'id';
  let { data, error } = await buildQuery(keyColumn);

  if (error && /column\s+observations\.id\s+does\s+not\s+exist/i.test(error.message || '')) {
    keyColumn = 'observation_id';
    const retry = await buildQuery(keyColumn);
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.error('Database error:', error);
    return errorResponse(error.message, req, 500);
  }

  // Build CSV
  const columns = [
    'id',
    'recorded_at_utc',
    'plate_number',
    'zone',
    'organization',
    'officer',
    'is_compliant',
    'breach_type',
    'latitude',
    'longitude',
    'photo_url',
  ];

  const csvHeader = columns.join(',') + '\n';

  const csvRows = (data || []).map((obs: any) => {
    const row = {
      id: keyColumn === 'observation_id' ? obs.observation_id : obs.id,
      recorded_at_utc: obs.recorded_at,
      plate_number: obs.plate_number || 'Unknown',
      zone: obs.zone?.name || 'Unknown',
      organization: obs.organization?.name || 'Unknown',
      officer: obs.recorded_by_user
        ? `${obs.recorded_by_user.first_name} ${obs.recorded_by_user.last_name}`
        : 'Unknown',
      is_compliant: obs.is_compliant ? 'Yes' : 'No',
      breach_type: obs.breach_type || '',
      latitude: obs.gps_latitude,
      longitude: obs.gps_longitude,
      photo_url: obs.photo_url || '',
    };
    return rowToCSV(row, columns);
  }).join('\n');

  const csv = csvHeader + csvRows + '\n';

  // Generate filename
  const filename = `observations_${date_from}_to_${date_to}.csv`;

  // Return CSV with appropriate headers (CORS already handled by withCors wrapper)
  return new Response(csv, {
    headers: {
      ...getCorsHeaders(req),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}));
