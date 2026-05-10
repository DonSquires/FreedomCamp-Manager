// @ts-nocheck
import { getCorsHeaders } from '../_shared/withCors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'

interface PhotoMaintenanceRequest {
  mode?: 'reconcile' | 'reingest' | 'recover_missing' | 'link-evidence'
  action?: 'reconcile' | 'reingest' | 'recover_missing' | 'link-evidence'
  organizationId?: string
  organization_id?: string
  date_from?: string
  date_to?: string
  before_recorded_at?: string
  batch_size?: number
  limit?: number
  dryRun?: boolean
  dry_run?: boolean
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

    const resolvedMode = body.mode ?? body.action
    if (!resolvedMode) {
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

    const isAdminLike = profile && ['admin', 'admin_officer', 'master', 'grand_master'].includes(profile.role)
    if (!isAdminLike) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const targetOrgId = body.organizationId ?? body.organization_id ?? profile.organization_id
    const limit = Math.max(1, Math.min(body.batch_size ?? body.limit ?? 200, 2000))
    const dryRun = body.dryRun ?? body.dry_run ?? true

    if (resolvedMode === 'reingest') {
      let reingestQuery = adminClient
        .from('observations')
        .select('observation_id, photo_url, photo_hash, recorded_at, zone_id, organization_id, gps_latitude, gps_longitude, gps_accuracy, plate_number, officer_notes')
        .not('photo_url', 'is', null)
        .neq('photo_url', '')
        .order('recorded_at', { ascending: false })
        .limit(limit)

      if (body.before_recorded_at) {
        reingestQuery = reingestQuery.lt('recorded_at', body.before_recorded_at)
      }
      if (body.date_from) {
        reingestQuery = reingestQuery.gte('recorded_at', body.date_from)
      }
      if (body.date_to) {
        reingestQuery = reingestQuery.lte('recorded_at', body.date_to)
      }

      if (targetOrgId && profile.role !== 'grand_master') {
        reingestQuery = reingestQuery.eq('organization_id', targetOrgId)
      } else if (targetOrgId) {
        reingestQuery = reingestQuery.eq('organization_id', targetOrgId)
      }

      const { data: rows, error: reingestError } = await reingestQuery
      if (reingestError) {
        throw new Error(reingestError.message)
      }

      const observations = rows ?? []
      const zoneIds = [...new Set(observations.map((r: any) => r.zone_id).filter(Boolean))]
      const loiByZoneId = new Map<string, string | null>()

      if (zoneIds.length > 0) {
        const { data: zones, error: zonesError } = await adminClient
          .from('zones')
          .select('id, loi_id, organization_id')
          .in('id', zoneIds)

        if (zonesError) {
          throw new Error(zonesError.message)
        }

        for (const z of zones ?? []) {
          loiByZoneId.set(z.id, z.loi_id ?? null)
        }
      }

      const mapped = observations.map((row: any) => ({
        ...row,
        loi_id: row.zone_id ? (loiByZoneId.get(row.zone_id) ?? null) : null,
      }))

      const nextBeforeRecordedAt = mapped.length > 0 ? mapped[mapped.length - 1].recorded_at : null

      return new Response(
        JSON.stringify({
          ok: true,
          mode: resolvedMode,
          organization_id: targetOrgId,
          scanned_rows: mapped.length,
          processed: mapped.length,
          next_before_recorded_at: nextBeforeRecordedAt,
          observations: mapped,
          note: 'Reingest candidate list now includes loi_id mapped from zones.loi_id',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

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
        mode: resolvedMode,
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
