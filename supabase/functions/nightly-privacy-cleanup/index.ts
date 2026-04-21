// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

interface CleanupRequest {
  dryRun?: boolean;
  limit?: number;
}

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
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const body = (await req.json().catch(() => ({}))) as CleanupRequest;
    // Accept both camelCase (dryRun) and snake_case (dry_run) for compatibility
    const dryRun = body.dryRun === true || (body as any).dry_run === true;
    const limit = Math.min(Math.max(body.limit ?? 500, 1), 2000);

    // dry_run is read-only (no deletions) — any authenticated user can inspect pending cleanup
    if (!dryRun && (!profile || !['master', 'admin', 'admin_officer'].includes(profile.role))) {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const nowIso = new Date().toISOString();

    const { data: expiredRows, error: fetchError } = await supabaseAdmin
      .from('photo_metadata')
      .select('id, bucket_name, storage_path')
      .not('scheduled_deletion_at', 'is', null)
      .lt('scheduled_deletion_at', nowIso)
      .limit(limit);

    if (fetchError) {
      throw fetchError;
    }

    const rows = expiredRows || [];

    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          candidates: rows.length,
          deleted: 0,
        }),
        { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ success: true, deleted: 0, candidates: 0 }),
        { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const byBucket = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.bucket_name || !row.storage_path) {
        continue;
      }
      const paths = byBucket.get(row.bucket_name) || [];
      paths.push(row.storage_path);
      byBucket.set(row.bucket_name, paths);
    }

    for (const [bucket, paths] of byBucket.entries()) {
      const { error: storageError } = await supabaseAdmin.storage.from(bucket).remove(paths);
      if (storageError) {
        console.error('Storage cleanup warning:', storageError.message, { bucket });
      }
    }

    const ids = rows.map((r) => r.id).filter(Boolean);
    const { error: deleteError } = await supabaseAdmin
      .from('photo_metadata')
      .delete()
      .in('id', ids);

    if (deleteError) {
      throw deleteError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        deleted: ids.length,
        candidates: rows.length,
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: 'Failed to run privacy cleanup', message: error?.message || 'Unknown error' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
