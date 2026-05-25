import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { corsHeaders } from '../_shared/cors.ts'

type PurgeRequest = {
  org_id?: string | null
  default_retention_days?: number
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function isServiceRoleRequest(req: Request): boolean {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim() || ''
  const serviceRole = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
  return Boolean(serviceRole) && Boolean(token) && token === serviceRole
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!isServiceRoleRequest(req)) {
    return jsonResponse({ error: 'Unauthorized (service role required)' }, 401)
  }

  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim()
  const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase service configuration missing' }, 503)
  }

  let body: PurgeRequest = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const orgId = typeof body.org_id === 'string' && body.org_id.trim() ? body.org_id.trim() : null
  const retentionDaysRaw = Number(body.default_retention_days)
  const defaultRetentionDays = Number.isFinite(retentionDaysRaw) && retentionDaysRaw > 0
    ? Math.floor(retentionDaysRaw)
    : 90

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data, error } = await supabase.rpc('purge_old_bob_learning_log', {
    p_org_id: orgId,
    p_default_retention_days: defaultRetentionDays,
  })

  if (error) {
    return jsonResponse({ error: 'Purge failed', details: error.message }, 500)
  }

  return jsonResponse({
    ok: true,
    purged_rows: Number(data || 0),
    org_id: orgId,
    default_retention_days: defaultRetentionDays,
  })
})
