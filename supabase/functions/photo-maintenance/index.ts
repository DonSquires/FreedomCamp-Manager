// @ts-nocheck
import { getCorsHeaders } from '../_shared/withCors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'

interface PhotoMaintenanceRequest {
  mode: 'reconcile' | 'reingest' | 'recover_missing'
  organizationId?: string
  limit?: number
  dryRun?: boolean
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as PhotoMaintenanceRequest

    if (!body.mode) {
      return new Response(JSON.stringify({ error: 'mode is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single()

    const isAdminLike = profile && ['admin', 'master', 'grand_master'].includes(profile.role)
    if (!isAdminLike) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const targetOrgId = body.organizationId ?? profile.organization_id
    const limit = Math.max(1, Math.min(body.limit ?? 200, 2000))
    const dryRun = body.dryRun ?? true

    let query = adminClient
      .from('observations')
      .select('observation_id, plate_number, recorded_at, photo_url, updated_at')
      .or('photo_url.is.null,photo_url.eq.')
      .order('recorded_at', { ascending: false })
      .limit(limit)

    if (targetOrgId && profile.role !== 'grand_master') {
      query = query.eq('organization_id', targetOrgId)
    } else if (targetOrgId) {
      query = query.eq('organization_id', targetOrgId)
    }

    const { data: missingRows, error: queryError } = await query
    if (queryError) {
      throw new Error(queryError.message)
    }

    const items = (missingRows ?? []).map((row: any) => ({
      observation_id: row.observation_id,
      plate_number: row.plate_number,
      recorded_at: row.recorded_at,
      status: 'missing_photo',
    }))

    let updated = 0
    if (!dryRun && items.length > 0) {
      for (const row of missingRows ?? []) {
        const { error: updateError } = await adminClient
          .from('observations')
          .update({
            updated_at: new Date().toISOString(),
            officer_notes: `Photo maintenance queued at ${new Date().toISOString()}`,
          })
          .eq('observation_id', row.observation_id)

        if (!updateError) updated += 1
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode: body.mode,
        dryRun,
        organizationId: targetOrgId,
        scanned: items.length,
        updated,
        items,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
