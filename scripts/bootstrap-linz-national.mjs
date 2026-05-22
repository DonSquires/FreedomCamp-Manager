#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Bootstrap LINZ national coverage under First Security - Queenstown.

What this script does:
- Ensures LINZ exists as a client org under First Security - Queenstown
- Ensures LINZ workspace, contract, provider grants, and contractor access exist
- Ensures a national LINZ jurisdiction zone for all New Zealand exists
- Optionally imports LINZ-managed land polygons into LOI + linked zones from GeoJSON

Usage:
  node scripts/bootstrap-linz-national.mjs [--apply] [--geojson <path>] [--geojson-url <url>] [--linz-api-url <url>] [--linz-layer-id <id>] [--linz-overlay-layer-id <id>] [--limit <n>] [--enrich-google-address]

Options:
  --apply             Perform inserts/updates. Omit for dry-run.
  --geojson <path>    Local GeoJSON file with LINZ-managed land polygons.
  --geojson-url <url> GeoJSON URL to fetch (used when --geojson not provided).
  --linz-api-url <url> Direct LINZ land API endpoint that returns GeoJSON or JSON features.
  --linz-layer-id <id> LINZ LDS layer ID for primary managed land polygons. Default: 53358.
  --linz-overlay-layer-id <id> LINZ LDS overlay parcel layer ID for legal snapping metadata. Default: 50121.
  --limit <n>         Max feature count to process from source (for staged rollouts).
  --enrich-google-address  Reverse-geocode feature centroids via Google Maps API.
`

const LINZ_CLIENT_DEF = {
  name: 'LINZ',
  organizationPayload: {
    organization_type: 'client',
    organization_level: 3,
    is_active: true,
    enforcement_workflow: 'admin_first',
    overnight_verification_mode: 'two_photo_verification',
  },
  workspaceName: 'LINZ National Operational Workspace',
  contractName: 'LINZ National Security Services Agreement',
}

const DOWNER_LINZ_CLIENT_DEF = {
  name: 'Downer LINZ',
  organizationPayload: {
    organization_type: 'client',
    organization_level: 3,
    is_active: true,
    enforcement_workflow: 'admin_first',
    overnight_verification_mode: 'two_photo_verification',
  },
  workspaceName: 'Downer LINZ Operational Workspace',
  contractName: 'Downer LINZ Security Services Agreement',
}

const PROVIDER_SERVICE_TYPES = [
  'site_guarding',
  'parking_enforcement',
  'freedom_camping',
  'noise_control',
]

const NATIONAL_ZONE_DEF = {
  name: 'LINZ National Jurisdiction - New Zealand',
  description: 'National LINZ jurisdiction zone covering New Zealand for LINZ-managed land operations.',
  center: { lat: -41.2865, lng: 174.7762 },
  polygon: {
    type: 'Polygon',
    coordinates: [[
      [166.0, -47.6],
      [179.5, -47.6],
      [179.5, -34.0],
      [166.0, -34.0],
      [166.0, -47.6],
    ]],
  },
}

const DOWNER_LAKE_DUNSTAN_ZONE_DEF = {
  name: 'Downer LINZ - Lake Dunstan Management Zone',
  description: 'Lake Dunstan and Cromwell Gorge operational management zone for Downer LINZ under First Security - Queenstown.',
  center: { lat: -45.084, lng: 169.252 },
  polygon: {
    type: 'Polygon',
    coordinates: [[
      [169.17, -45.19],
      [169.40, -45.19],
      [169.40, -44.98],
      [169.17, -44.98],
      [169.17, -45.19],
    ]],
  },
}

const DOWNER_LAKE_DUNSTAN_BOUNDS = {
  minLat: -45.19,
  maxLat: -44.98,
  minLng: 169.17,
  maxLng: 169.40,
}

const DOWNER_LAKE_DUNSTAN_KEYWORDS = [
  'lake dunstan',
  'dunstan',
  'cromwell gorge',
  'cromwell',
  'clutha',
]

function parseArgs(argv) {
  const readOptionValue = (flag) => {
    const exact = argv.indexOf(flag)
    if (exact >= 0) return argv[exact + 1]
    const inline = argv.find((token) => token.startsWith(`${flag}=`))
    return inline ? inline.slice(flag.length + 1) : undefined
  }

  return {
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
    geojsonPath: readOptionValue('--geojson') || '',
    geojsonUrl: readOptionValue('--geojson-url') || '',
    linzApiUrl: readOptionValue('--linz-api-url') || String(process.env.LINZ_LAND_API_URL || '').trim(),
    linzApiKey: String(
      process.env.LINZ_LAND_API_KEY ||
      process.env.LINZ_API_KEY ||
      process.env.VITE_LINZ_DATA_SERVICE_API_KEY ||
      '',
    ).trim(),
    googleMapsApiKey: String(process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim(),
    linzLayerId: String(readOptionValue('--linz-layer-id') || process.env.LINZ_LAYER_ID || '53358').trim(),
    linzOverlayLayerId: String(readOptionValue('--linz-overlay-layer-id') || process.env.LINZ_OVERLAY_LAYER_ID || '50121').trim(),
    enrichGoogleAddress: argv.includes('--enrich-google-address'),
    limit: Number.parseInt(String(readOptionValue('--limit') || ''), 10),
  }
}

function normalizeText(value) {
  return String(value || '').trim()
}

function slugify(value, fallback = 'linz-land') {
  const normalized = normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function computeBoundsFromGeometry(geometry) {
  const points = []

  const walk = (node) => {
    if (!Array.isArray(node)) return
    if (node.length >= 2 && Number.isFinite(node[0]) && Number.isFinite(node[1])) {
      points.push(node)
      return
    }
    for (const child of node) walk(child)
  }

  walk(geometry?.coordinates)
  if (points.length === 0) return null

  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  for (const point of points) {
    const [lng, lat] = point
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }

  return {
    minLng,
    maxLng,
    minLat,
    maxLat,
    center: {
      lat: (minLat + maxLat) / 2,
      lng: (minLng + maxLng) / 2,
    },
  }
}

function featureName(feature, index) {
  const props = feature?.properties || {}
  const keys = ['name', 'Name', 'site_name', 'SiteName', 'title', 'Title', 'parcel_name', 'land_name']
  for (const key of keys) {
    const value = normalizeText(props[key])
    if (value) return value
  }

  const idValue = normalizeText(props.id || props.ID || feature?.id || '')
  if (idValue) return `LINZ Managed Land ${idValue}`

  return `LINZ Managed Land ${index + 1}`
}

function normalizeJurisdictionPolygonToGeoJson(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 4) return null
  const ring = []
  for (const point of polygon) {
    if (!Array.isArray(point) || point.length < 2) return null
    const lat = Number(point[0])
    const lng = Number(point[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    ring.push([lng, lat])
  }
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]])
  }
  return {
    type: 'Polygon',
    coordinates: [ring],
  }
}

function convertJurisdictionPayloadToFeatureCollection(payload) {
  const jurisdictions = Array.isArray(payload?.jurisdictions) ? payload.jurisdictions : []
  const features = []

  for (let i = 0; i < jurisdictions.length; i += 1) {
    const j = jurisdictions[i]
    const geometry = normalizeJurisdictionPolygonToGeoJson(j?.polygon)
    if (!geometry) continue
    features.push({
      type: 'Feature',
      id: j?.id || `jurisdiction-${i + 1}`,
      properties: {
        id: j?.id || `jurisdiction-${i + 1}`,
        name: j?.council || j?.region || `Jurisdiction ${i + 1}`,
        source: payload?.source || 'repo-jurisdictions',
      },
      geometry,
    })
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

function sourceId(feature, index) {
  const props = feature?.properties || {}
  return normalizeText(feature?.id || props.id || props.ID || props.objectid || props.OBJECTID || `feature-${index + 1}`)
}

function isWithinLakeDunstanBounds(center) {
  if (!center) return false
  return (
    center.lat >= DOWNER_LAKE_DUNSTAN_BOUNDS.minLat &&
    center.lat <= DOWNER_LAKE_DUNSTAN_BOUNDS.maxLat &&
    center.lng >= DOWNER_LAKE_DUNSTAN_BOUNDS.minLng &&
    center.lng <= DOWNER_LAKE_DUNSTAN_BOUNDS.maxLng
  )
}

function shouldRouteToDownerLakeDunstan(feature, center, name) {
  const props = feature?.properties || {}
  const text = [
    name,
    props.name,
    props.Name,
    props.title,
    props.locality,
    props.region,
    props.manager,
    props.land_manager,
    props.enforcement_authority,
    props.description,
  ]
    .map((v) => normalizeText(v).toLowerCase())
    .filter(Boolean)
    .join(' ')

  if (DOWNER_LAKE_DUNSTAN_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return true
  }

  return isWithinLakeDunstanBounds(center)
}

async function loadGeoJsonFromInput(args) {
  if (args.geojsonPath) {
    const absPath = path.resolve(process.cwd(), args.geojsonPath)
    const raw = await fs.promises.readFile(absPath, 'utf8')
    const parsed = JSON.parse(raw)
    const data = Array.isArray(parsed?.features) ? parsed : convertJurisdictionPayloadToFeatureCollection(parsed)
    return {
      source: absPath,
      data,
    }
  }

  if (args.geojsonUrl) {
    const res = await fetch(args.geojsonUrl)
    if (!res.ok) {
      throw new Error(`Failed to fetch GeoJSON URL (${res.status}): ${args.geojsonUrl}`)
    }
    return {
      source: args.geojsonUrl,
      data: await res.json(),
    }
  }

  let linzApiUrl = args.linzApiUrl
  if (!linzApiUrl && args.linzApiKey && args.linzLayerId) {
    linzApiUrl = `https://data.linz.govt.nz/services;key=${encodeURIComponent(args.linzApiKey)}/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=layer-${encodeURIComponent(args.linzLayerId)}&outputFormat=application/json`
  }

  if (linzApiUrl) {
    const headers = {
      Accept: 'application/json',
    }
    if (args.linzApiKey) {
      headers.Authorization = `Bearer ${args.linzApiKey}`
      headers['x-api-key'] = args.linzApiKey
    }

    const res = await fetch(linzApiUrl, { headers })
    if (!res.ok) {
      throw new Error(`Failed to fetch LINZ API (${res.status}): ${linzApiUrl}`)
    }

    const data = await res.json()
    if (Array.isArray(data)) {
      return {
        source: linzApiUrl,
        data: { type: 'FeatureCollection', features: data },
      }
    }

    if (Array.isArray(data?.features)) {
      return {
        source: linzApiUrl,
        data,
      }
    }

    if (Array.isArray(data?.items)) {
      return {
        source: linzApiUrl,
        data: { type: 'FeatureCollection', features: data.items },
      }
    }

    throw new Error('LINZ API response format not recognized (expected features[], items[], or array)')
  }

  return null
}

async function reverseGeocodeGoogle(lat, lng, apiKey, cache) {
  if (!apiKey) return null
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`
  if (cache.has(key)) return cache.get(key)

  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${lat},${lng}`)}&key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url)
  if (!res.ok) {
    cache.set(key, null)
    return null
  }

  const data = await res.json()
  const address = Array.isArray(data?.results) && data.results[0]?.formatted_address
    ? String(data.results[0].formatted_address)
    : null

  cache.set(key, address)
  return address
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

async function findOrCreateOrganization(supabase, name, payload, dryRun) {
  const existing = await getOrgByName(supabase, name)
  if (existing?.id) return { id: existing.id, name }

  if (dryRun) return { id: '', name }

  const { data: created, error: insertError } = await supabase
    .from('organizations')
    .insert({ name, ...payload })
    .select('id, name')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating organization ${name}: ${insertError?.message || 'Unknown error'}`)
  }

  return created
}

async function findOrCreateWorkspace(supabase, ownerOrgId, workspaceName, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_org_id', ownerOrgId)
    .eq('workspace_name', workspaceName)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up workspace ${workspaceName}: ${lookupError.message}`)
  }

  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('workspaces')
        .update({ is_active: true, is_client_owned: true })
        .eq('id', existing.id)
      if (updateError) {
        throw new Error(`Failed updating workspace ${workspaceName}: ${updateError.message}`)
      }
    }
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('workspaces')
    .insert({
      owner_org_id: ownerOrgId,
      workspace_name: workspaceName,
      is_client_owned: true,
      is_active: true,
      bylaw_config: {},
    })
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating workspace ${workspaceName}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateContract(supabase, providerOrgId, clientOrgId, contractName, dryRun) {
  const { data: existingRows, error: lookupError } = await supabase
    .from('crm_contracts')
    .select('id')
    .eq('provider_organization_id', providerOrgId)
    .eq('client_organization_id', clientOrgId)
    .eq('name', contractName)
    .order('created_at', { ascending: false })
    .limit(1)

  if (lookupError) {
    throw new Error(`Failed looking up contract ${contractName}: ${lookupError.message}`)
  }

  const existing = Array.isArray(existingRows) ? existingRows[0] : null
  const payload = {
    provider_organization_id: providerOrgId,
    client_organization_id: clientOrgId,
    name: contractName,
    contract_type: 'service',
    start_date: '2026-01-01',
    end_date: null,
    status: 'active',
    billing_frequency: 'monthly',
    payment_terms_days: 20,
    currency: 'NZD',
    internal_notes: 'Bootstrap: First Security - Queenstown nationwide LINZ operations.',
  }

  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('crm_contracts')
        .update(payload)
        .eq('id', existing.id)
      if (updateError) {
        throw new Error(`Failed updating contract ${contractName}: ${updateError.message}`)
      }
    }
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('crm_contracts')
    .insert(payload)
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating contract ${contractName}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateProviderGrant(supabase, providerOrgId, clientOrgId, serviceType, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('provider_client_access_grants')
    .select('id')
    .eq('provider_org_id', providerOrgId)
    .eq('client_org_id', clientOrgId)
    .eq('service_type', serviceType)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up provider grant for client ${clientOrgId}: ${lookupError.message}`)
  }

  const payload = {
    provider_org_id: providerOrgId,
    client_org_id: clientOrgId,
    service_type: serviceType,
    allow_without_roster: true,
  }

  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('provider_client_access_grants')
        .update(payload)
        .eq('id', existing.id)
      if (updateError) {
        throw new Error(`Failed updating provider grant for client ${clientOrgId}: ${updateError.message}`)
      }
    }
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('provider_client_access_grants')
    .insert(payload)
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating provider grant for client ${clientOrgId}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateContractorAccess(supabase, providerOrgId, workspaceId, contractId, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('contractor_access')
    .select('id')
    .eq('provider_org_id', providerOrgId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up contractor_access for workspace ${workspaceId}: ${lookupError.message}`)
  }

  const payload = {
    provider_org_id: providerOrgId,
    workspace_id: workspaceId,
    contract_id: contractId || null,
    status: 'active',
    can_use_ptt_bridge: true,
    valid_from: new Date().toISOString().slice(0, 10),
    valid_to: null,
    notes: 'First Security - Queenstown covers LINZ national operations.',
  }

  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('contractor_access')
        .update(payload)
        .eq('id', existing.id)
      if (updateError) {
        throw new Error(`Failed updating contractor_access for workspace ${workspaceId}: ${updateError.message}`)
      }
    }
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('contractor_access')
    .insert(payload)
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating contractor_access for workspace ${workspaceId}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function ensureClientSetup(supabase, provider, clientDef, dryRun, notes) {
  const client = await findOrCreateOrganization(
    supabase,
    clientDef.name,
    {
      ...clientDef.organizationPayload,
      parent_organization_id: provider.id,
    },
    dryRun,
  )

  let workspaceId = ''
  let contractId = ''
  if (client.id) {
    workspaceId = await findOrCreateWorkspace(supabase, client.id, clientDef.workspaceName, dryRun)
    contractId = await findOrCreateContract(supabase, provider.id, client.id, clientDef.contractName, dryRun)
    for (const serviceType of PROVIDER_SERVICE_TYPES) {
      await findOrCreateProviderGrant(supabase, provider.id, client.id, serviceType, dryRun)
    }
    if (workspaceId) {
      await findOrCreateContractorAccess(supabase, provider.id, workspaceId, contractId, dryRun)
    }
  }

  return {
    id: client.id,
    name: client.name,
    workspaceId,
    contractId,
    notes,
  }
}

async function findOrCreateZone(supabase, organizationId, zoneDef, dryRun, boundarySource = 'bootstrap-linz-national') {
  const { data: existing, error: lookupError } = await supabase
    .from('zones')
    .select('id')
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
    boundary_source: boundarySource,
    location_lat: zoneDef.center.lat,
    location_lng: zoneDef.center.lng,
    geometry: zoneDef.polygon,
    zone_type: 'specific',
    loi_id: zoneDef.loiId || null,
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

async function findOrCreateLoi(supabase, organizationId, loiDef, dryRun) {
  const { data: existing, error: existingErr } = await supabase
    .from('locations_of_interest')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('loi_kind', loiDef.loi_kind)
    .eq('name', loiDef.name)
    .limit(1)
    .maybeSingle()

  if (existingErr) throw new Error(`Failed looking up LOI ${loiDef.name}: ${existingErr.message}`)
  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('locations_of_interest')
        .update(loiDef)
        .eq('id', existing.id)
      if (updateError) {
        throw new Error(`Failed updating LOI ${loiDef.name}: ${updateError.message}`)
      }
    }
    return { id: existing.id, action: 'updated' }
  }

  if (dryRun) return { id: '', action: 'would_create' }

  const { data: created, error: createErr } = await supabase
    .from('locations_of_interest')
    .insert({ organization_id: organizationId, ...loiDef })
    .select('id')
    .single()

  if (createErr || !created?.id) {
    throw new Error(`Failed creating LOI ${loiDef.name}: ${createErr?.message || 'Unknown error'}`)
  }

  return { id: created.id, action: 'created' }
}

function featureToImportRecord(feature, index) {
  const geometry = feature?.geometry || null
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(String(geometry.type || ''))) {
    return null
  }

  const bounds = computeBoundsFromGeometry(geometry)
  if (!bounds?.center) return null

  const name = featureName(feature, index)
  const srcId = sourceId(feature, index)
  const slug = slugify(`${srcId}-${name}`)

  return {
    sourceId: srcId,
    name,
    loiName: `LINZ Land ${name}`,
    zoneName: `LINZ Land Zone ${name}`,
    description: `Imported LINZ-managed land polygon (${slug}).`,
    center: bounds.center,
    geometry,
    feature,
  }
}

async function importLinzLandFeatures(supabase, organizationIds, features, dryRun, limit, opts = {}) {
  const prepared = []
  for (let i = 0; i < features.length; i += 1) {
    const record = featureToImportRecord(features[i], i)
    if (record) prepared.push(record)
  }

  const capped = Number.isFinite(limit) && limit > 0 ? prepared.slice(0, limit) : prepared

  const summary = {
    source_features_total: features.length,
    polygon_features_prepared: prepared.length,
    polygon_features_processed: capped.length,
    lois_created_or_updated: 0,
    zones_created_or_updated: 0,
    failed: 0,
    errors: [],
    google_address_enriched: 0,
    routed_to_downer_linz: 0,
  }

  const geocodeCache = new Map()

  for (const record of capped) {
    try {
      const downerRoute = Boolean(
        organizationIds?.downerLinzId &&
        shouldRouteToDownerLakeDunstan(record.feature, record.center, record.name),
      )
      const targetOrganizationId = downerRoute ? organizationIds.downerLinzId : organizationIds.linzId

      let addressFull = 'LINZ-managed land, New Zealand'
      if (!dryRun && opts.enrichGoogleAddress && opts.googleMapsApiKey) {
        const geocoded = await reverseGeocodeGoogle(record.center.lat, record.center.lng, opts.googleMapsApiKey, geocodeCache)
        if (geocoded) {
          addressFull = geocoded
          summary.google_address_enriched += 1
        }
      }

      const loiDef = {
        name: record.loiName,
        description: record.description,
        loi_kind: 'freedom_camp',
        address_full: addressFull,
        gps_lat: record.center.lat,
        gps_lng: record.center.lng,
        geocoder_source: 'linz_geojson_import',
        geocoder_confidence: 1.0,
        geofence_geometry: record.geometry,
      }
      const loi = await findOrCreateLoi(supabase, targetOrganizationId, loiDef, dryRun)
      summary.lois_created_or_updated += 1

      const zoneDef = {
        name: record.zoneName,
        description: record.description,
        center: record.center,
        polygon: record.geometry,
        loiId: loi.id || null,
      }
      await findOrCreateZone(supabase, targetOrganizationId, zoneDef, dryRun, 'bootstrap-linz-national:linz-geojson')
      summary.zones_created_or_updated += 1
      if (downerRoute) summary.routed_to_downer_linz += 1
    } catch (error) {
      summary.failed += 1
      summary.errors.push(String(error?.message || error))
    }
  }

  summary.errors = summary.errors.slice(0, 20)
  return summary
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

  const linz = await ensureClientSetup(supabase, queenstown, LINZ_CLIENT_DEF, dryRun, 'LINZ national client')
  const downerLinz = await ensureClientSetup(supabase, queenstown, DOWNER_LINZ_CLIENT_DEF, dryRun, 'Downer LINZ client')

  const nationalZone = linz.id
    ? await findOrCreateZone(supabase, linz.id, NATIONAL_ZONE_DEF, dryRun)
    : { id: '', action: 'would_create_after_org_creation' }
  const lakeDunstanZone = downerLinz.id
    ? await findOrCreateZone(supabase, downerLinz.id, DOWNER_LAKE_DUNSTAN_ZONE_DEF, dryRun, 'bootstrap-linz-national:downer-lake-dunstan')
    : { id: '', action: 'would_create_after_org_creation' }

  const geojsonInput = await loadGeoJsonFromInput(args)
  let geojsonSummary = null

  if (geojsonInput?.data) {
    if (!Array.isArray(geojsonInput.data.features)) {
      throw new Error('GeoJSON is missing features[] array')
    }

    if (linz.id) {
      geojsonSummary = await importLinzLandFeatures(
        supabase,
        {
          linzId: linz.id,
          downerLinzId: downerLinz.id || null,
        },
        geojsonInput.data.features,
        dryRun,
        args.limit,
        {
          enrichGoogleAddress: args.enrichGoogleAddress,
          googleMapsApiKey: args.googleMapsApiKey,
        },
      )
    } else {
      geojsonSummary = {
        source_features_total: Array.isArray(geojsonInput.data.features) ? geojsonInput.data.features.length : 0,
        skipped_reason: 'would_import_after_org_creation',
      }
    }
  }

  let finalZones = []
  if (linz.id) {
    const { data, error: finalZonesError } = await supabase
      .from('zones')
      .select('id, name, is_active, boundary_source')
      .eq('organization_id', linz.id)
      .order('name', { ascending: true })

    if (finalZonesError) {
      throw new Error(`Failed loading final zones: ${finalZonesError.message}`)
    }
    finalZones = data || []
  }

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'apply',
    provider: { id: queenstown.id, name: queenstown.name },
    client: { id: linz.id, name: linz.name, workspace_id: linz.workspaceId, contract_id: linz.contractId },
    downer_linz_client: {
      id: downerLinz.id,
      name: downerLinz.name,
      workspace_id: downerLinz.workspaceId,
      contract_id: downerLinz.contractId,
    },
    provider_service_types: PROVIDER_SERVICE_TYPES,
    national_jurisdiction_zone: nationalZone,
    downer_lake_dunstan_zone: lakeDunstanZone,
    geojson_source: geojsonInput?.source || null,
    linz_api_source: args.linzApiUrl || null,
    linz_layer_id: args.linzLayerId,
    linz_overlay_layer_id: args.linzOverlayLayerId,
    google_address_enrichment_enabled: Boolean(args.enrichGoogleAddress && args.googleMapsApiKey),
    geojson_import_summary: geojsonSummary,
    final_zone_count: finalZones.length,
    final_zones_sample: finalZones.slice(0, 25),
  }, null, 2))
}

const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

export { featureToImportRecord, computeBoundsFromGeometry }
