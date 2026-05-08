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
    return json(req, { error: 'Insufficient role to revoke briefing videos' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(req, { error: 'Invalid JSON body' }, 400)
  }

  const videoPackId = String(body.video_pack_id || '').trim()
  const reason = String(body.reason || 'revoked_by_operator').trim()
  if (!videoPackId) return json(req, { error: 'video_pack_id is required' }, 400)

  const primaryOrgId = String(profile.organization_id || '').trim()
  const extraOrgIds = parseUuidArray(profile.extra_organization_ids)
  const allowedOrgIds = new Set([primaryOrgId, ...extraOrgIds].filter(Boolean))

  const { data: pack, error: packError } = await (supabaseAdmin.from('video_briefing_packs') as any)
    .select('id, org_id, media_log_id, revoked_at')
    .eq('id', videoPackId)
    .maybeSingle()

  if (packError || !pack) return json(req, { error: 'Video briefing pack not found' }, 404)
  if (!allowedOrgIds.has(String(pack.org_id || '').trim())) {
    return json(req, { error: 'Organization access denied for requested pack' }, 403)
  }

  if (pack.revoked_at) {
    return json(req, { success: true, already_revoked: true, video_pack_id: pack.id })
  }

  const revokedAt = new Date().toISOString()

  const { error: packUpdateError } = await (supabaseAdmin.from('video_briefing_packs') as any)
    .update({ revoked_at: revokedAt, description: `Revoked: ${reason}` })
    .eq('id', pack.id)

  if (packUpdateError) {
    return json(req, { error: `Unable to revoke video pack: ${packUpdateError.message}` }, 500)
  }

  const { error: logUpdateError } = await (supabaseAdmin.from('media_generation_log') as any)
    .update({ revoked_at: revokedAt, updated_at: revokedAt })
    .eq('id', pack.media_log_id)

  if (logUpdateError) {
    return json(req, { error: `Unable to update media log revocation: ${logUpdateError.message}` }, 500)
  }

  return json(req, {
    success: true,
    video_pack_id: pack.id,
    media_log_id: pack.media_log_id,
    revoked_at: revokedAt,
    reason,
  })
})
