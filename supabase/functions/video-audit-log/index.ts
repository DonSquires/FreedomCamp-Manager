// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

const ALLOWED_ROLES = new Set(['admin', 'admin_officer', 'master'])

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function parseUuidArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map((v) => String(v || '').trim()).filter(Boolean)
    } catch {
      return value.split(',').map((v) => v.trim()).filter(Boolean)
    }
  }
  return []
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return json(req, { error: 'Authentication required' }, 401)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !auth?.user) return json(req, { error: 'Invalid or expired session' }, 401)

  const user = auth.user

  const { data: profile, error: profileError } = await (supabaseAdmin.from('user_profiles') as any)
    .select('role, organization_id, extra_organization_ids')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile) return json(req, { error: 'User profile not found' }, 403)
  if (!ALLOWED_ROLES.has(String(profile.role || '').trim())) {
    return json(req, { error: 'Insufficient role to query video audit log' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const requestedOrgId = String(body.org_id || '').trim()
  const primaryOrgId = String(profile.organization_id || '').trim()
  const extraOrgIds = parseUuidArray(profile.extra_organization_ids)
  const allowedOrgIds = new Set([primaryOrgId, ...extraOrgIds].filter(Boolean))
  const orgId = requestedOrgId || primaryOrgId

  if (!orgId || !allowedOrgIds.has(orgId)) {
    return json(req, { error: 'Organization access denied for requested org_id' }, 403)
  }

  const limit = Math.min(500, Math.max(1, Number(body.limit || 100)))

  const { data, error } = await (supabaseAdmin.from('media_generation_log') as any)
    .select('id, org_id, actor_user_id, purpose, source_entity_type, source_entity_id, provider, model_name, model_version, output_url, source_hash, output_hash, retention_days, legal_hold, revoked_at, created_at, updated_at')
    .eq('org_id', orgId)
    .eq('media_type', 'video')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return json(req, { error: `Unable to query video audit log: ${error.message}` }, 500)
  }

  return json(req, {
    success: true,
    org_id: orgId,
    count: (data ?? []).length,
    rows: data ?? [],
  })
})
