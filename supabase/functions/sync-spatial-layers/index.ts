// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization token' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // Read-only metadata endpoint — any authenticated user may access

    const { count: jurisdictionCount } = await supabaseAdmin
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .not('geom', 'is', null);

    const { count: restrictionCount } = await supabaseAdmin
      .from('restrictions')
      .select('id', { count: 'exact', head: true });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Spatial layer metadata refreshed successfully',
        jurisdictions: jurisdictionCount || 0,
        restrictions: restrictionCount || 0,
        synced_at: new Date().toISOString(),
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: 'Failed to sync spatial layers', message: error?.message || 'Unknown error' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
