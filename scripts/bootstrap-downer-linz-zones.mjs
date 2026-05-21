#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Bootstrap Downer LINZ zone coverage under First Security - Queenstown.

Usage:
  node scripts/bootstrap-downer-linz-zones.mjs [--apply]

Options:
  --apply   Perform inserts/updates. Omit for dry-run.
`

const QUEENSTOWN_CENTER = { lat: -45.0312, lng: 168.6626 }

const ZONE_DEFS = [
  {
    name: 'Downer LINZ - Queenstown Coverage Zone',
    description: 'Default operational coverage zone for Downer LINZ patrols managed by First Security - Queenstown.',
    center: QUEENSTOWN_CENTER,
    polygon: { dLat: 0.18, dLng: 0.22 },
  },
]

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

function buildPolygonGeometry(center, dLat, dLng) {
  return {
    type: 'Polygon',
    coordinates: [[
      [center.lng - dLng, center.lat - dLat],
      [center.lng + dLng, center.lat - dLat],
      [center.lng + dLng, center.lat + dLat],
      [center.lng - dLng, center.lat + dLat],
      [center.lng - dLng, center.lat - dLat],
    ]],
  }
}

async function getOrgByName(supabase, name) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, parent_organization_id')
    .eq('name', name)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed loading organization ${name}: ${error.message}`)
  }

  return data || null
}

async function findOrCreateZone(supabase, organizationId, zoneDef, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('zones')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('name', zoneDef.name)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed looking up zone ${zoneDef.name}: ${lookupError.message}`)
  }

  const payload = {
    name: zoneDef.name,
    description: zoneDef.description,
    is_active: true,
    boundary_source: 'bootstrap-downer-linz-zones',
    location_lat: zoneDef.center.lat,
    location_lng: zoneDef.center.lng,
    geometry: buildPolygonGeometry(zoneDef.center, zoneDef.polygon.dLat, zoneDef.polygon.dLng),
  }

  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('zones')
        .update(payload)
        .eq('id', existing.id)

      if (updateError) {
        throw new Error(`Failed updating zone ${zoneDef.name}: ${updateError.message}`)
      }
    }

    return { id: existing.id, action: 'updated' }
  }

  if (dryRun) {
    return { id: '', action: 'would_create' }
  }

  const { data: created, error: insertError } = await supabase
    .from('zones')
    .insert({ organization_id: organizationId, ...payload })
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating zone ${zoneDef.name}: ${insertError?.message || 'Unknown error'}`)
  }

  return { id: created.id, action: 'created' }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const dryRun = !args.apply

  const queenstown = await getOrgByName(supabase, 'First Security - Queenstown')
  if (!queenstown?.id) {
    throw new Error('Organization not found: First Security - Queenstown')
  }

  const downerLinz = await getOrgByName(supabase, 'Downer LINZ')
  if (!downerLinz?.id) {
    throw new Error('Organization not found: Downer LINZ')
  }

  if (downerLinz.parent_organization_id !== queenstown.id) {
    throw new Error('Downer LINZ is not currently parented under First Security - Queenstown')
  }

  const results = []
  for (const zoneDef of ZONE_DEFS) {
    const result = await findOrCreateZone(supabase, downerLinz.id, zoneDef, dryRun)
    results.push({ name: zoneDef.name, ...result })
  }

  const { data: finalZones, error: finalZonesError } = await supabase
    .from('zones')
    .select('id, name, is_active, boundary_source, location_lat, location_lng')
    .eq('organization_id', downerLinz.id)
    .order('name', { ascending: true })

  if (finalZonesError) {
    throw new Error(`Failed loading final zones: ${finalZonesError.message}`)
  }

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'apply',
    organization: { id: downerLinz.id, name: downerLinz.name, parent_organization_id: downerLinz.parent_organization_id },
    actions: results,
    final_zone_count: (finalZones || []).length,
    final_zones: finalZones || [],
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
