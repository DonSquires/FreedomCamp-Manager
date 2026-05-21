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

interface ReverseGeocodeResult {
  formatted_address: string
  street_number?: string
  street_name?: string
  suburb?: string
  city?: string
  region?: string
  postal_code?: string
  country?: string
  confidence?: number
  source?: 'google' | 'nominatim'
}

async function reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodeResult | null> {
  const googleMapsApiKey = (Deno.env.get('GOOGLE_MAPS_API_KEY') ?? Deno.env.get('VITE_GOOGLE_MAPS_API_KEY') ?? '').trim()

  if (googleMapsApiKey) {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}` +
        `&key=${encodeURIComponent(googleMapsApiKey)}&result_type=street_address|premise|route`

      const response = await fetch(url)
      if (response.ok) {
        const json = await response.json()
        if (json.status === 'OK' && Array.isArray(json.results) && json.results.length > 0) {
          const result = json.results[0]
          const components: Record<string, string> = {}
          for (const c of result.address_components ?? []) {
            for (const type of c.types ?? []) {
              components[type] = c.long_name
            }
          }
          return {
            formatted_address: result.formatted_address ?? '',
            street_number: components['street_number'],
            street_name: components['route'],
            suburb: components['sublocality_level_1'] ?? components['sublocality'] ?? components['neighborhood'],
            city: components['locality'] ?? components['postal_town'],
            region: components['administrative_area_level_1'],
            postal_code: components['postal_code'],
            country: components['country'],
            confidence: 1,
            source: 'google',
          }
        }
      }
    } catch (_error) {
      // Fall back to Nominatim.
    }
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'FieldOps-Manager/1.0' },
    })
    if (!response.ok) return null

    const data = await response.json()
    if (!data || data.error) return null

    const addr = data.address || {}
    return {
      formatted_address: data.display_name || 'Unknown location',
      street_number: addr.house_number,
      street_name: addr.road || addr.street,
      suburb: addr.suburb || addr.neighbourhood,
      city: addr.city || addr.town || addr.village,
      region: addr.state || addr.region,
      postal_code: addr.postcode,
      country: addr.country,
      confidence: typeof data.importance === 'number' ? data.importance : 0,
      source: 'nominatim',
    }
  } catch (_error) {
    return null
  }
}

async function ensureAddressLoi(adminClient: any, row: any): Promise<string | null> {
  const latitude = Number(row.gps_latitude)
  const longitude = Number(row.gps_longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !row.organization_id) {
    return null
  }

  const geocoded = await reverseGeocode(latitude, longitude)
  const addressFull = String(geocoded?.formatted_address || '').trim()

  if (addressFull) {
    const { data: existing } = await adminClient
      .from('locations_of_interest')
      .select('id')
      .eq('organization_id', row.organization_id)
      .eq('address_full', addressFull)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (existing?.id) return existing.id
  }

  const payload: Record<string, unknown> = {
    organization_id: row.organization_id,
    name: addressFull || `Observation ${row.observation_id}`,
    description: 'Auto-created from photo reingest for observation outside mapped zone',
    loi_kind: addressFull ? 'address' : 'ad_hoc',
    address_line1: [geocoded?.street_number, geocoded?.street_name].filter(Boolean).join(' ').trim() || null,
    suburb: geocoded?.suburb || null,
    city: geocoded?.city || null,
    region: geocoded?.region || null,
    postcode: geocoded?.postal_code || null,
    country: geocoded?.country || 'NZ',
    address_full: addressFull || null,
    gps_lat: latitude,
    gps_lng: longitude,
    geocoder_source: geocoded?.source || 'gps',
    geocoder_confidence: typeof geocoded?.confidence === 'number' ? geocoded.confidence : 0.5,
  }

  const { data: created, error: createError } = await adminClient
    .from('locations_of_interest')
    .insert(payload)
    .select('id')
    .single()

  if (createError) {
    console.warn('⚠️ Address LOI create failed:', createError.message)
    return null
  }

  return created?.id ?? null
}

function isGenericFallbackZone(zone: any): boolean {
  if (!zone) return false
  const name = String(zone.name ?? '').trim().toLowerCase()
  const zoneType = String(zone.zone_type ?? '').trim().toLowerCase()
  return zoneType === 'general' || name === 'other location' || name.includes('jurisdiction zone')
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
        .select('observation_id, photo_url, photo_hash, recorded_at, zone_id, loi_id, organization_id, gps_latitude, gps_longitude, gps_accuracy, plate_number, officer_notes')
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
      const zoneMetaById = new Map<string, any>()

      if (zoneIds.length > 0) {
        const { data: zones, error: zonesError } = await adminClient
          .from('zones')
          .select('id, loi_id, organization_id, name, zone_type')
          .in('id', zoneIds)

        if (zonesError) {
          throw new Error(zonesError.message)
        }

        for (const z of zones ?? []) {
          zoneMetaById.set(z.id, z)
        }
      }

      const originalMissingLoiIds = new Set(
        observations
          .filter((row: any) => !row.loi_id)
          .map((row: any) => row.observation_id),
      )

      const mapped = []
      for (const row of observations) {
        const zoneMeta = row.zone_id ? zoneMetaById.get(row.zone_id) ?? null : null
        const shouldUseZoneLoi = zoneMeta && !isGenericFallbackZone(zoneMeta)
        let resolvedLoiId = row.loi_id ?? (shouldUseZoneLoi ? (zoneMeta?.loi_id ?? null) : null)

        if (!resolvedLoiId && !dryRun) {
          resolvedLoiId = await ensureAddressLoi(adminClient, row)
        }

        mapped.push({
          ...row,
          loi_id: resolvedLoiId,
        })
      }

      // Backfill loi_id on observations that are missing it. When zone linkage
      // is unavailable, assign a street-address LOI from reverse geocoding.
      if (!dryRun) {
        const needsLoiBackfill = mapped.filter((r: any) => r.loi_id && originalMissingLoiIds.has(r.observation_id))
        if (needsLoiBackfill.length > 0) {
          for (const r of needsLoiBackfill) {
            const resolvedLoiId = r.loi_id
            if (resolvedLoiId) {
              await adminClient
                .from('observations')
                .update({ loi_id: resolvedLoiId })
                .eq('observation_id', r.observation_id)
            }
          }
        }
      }

      // Backfill canonical_vehicles for any plates not yet in the table
      if (!dryRun) {
        const platesForUpsert = [...new Set(
          mapped
            .map((r: any) => r.plate_number)
            .filter((p: any) => p && !String(p).startsWith('PROCESSING') && p !== 'MANUAL_REQUIRED')
        )]
        if (platesForUpsert.length > 0) {
          const now = new Date().toISOString()
          const cvRows = platesForUpsert.map((plate_number: string) => ({
            plate_number,
            first_seen_at: now,
            last_seen_at: now,
          }))
          await adminClient
            .from('canonical_vehicles')
            .upsert(cvRows, { onConflict: 'plate_number', ignoreDuplicates: true })
        }
      }

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
          note: 'Reingest candidate list now includes loi_id mapped from specific-zone linkage or reverse-geocoded street-address LOIs for out-of-zone/jurisdiction observations',
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
