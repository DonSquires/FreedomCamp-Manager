#!/usr/bin/env node

import fs from 'node:fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const HELP_TEXT = `
Enrich Downer/LINZ site geofences and backfill observation GPS from site titles.

Usage:
  node scripts/enrich-downer-linz-sites.mjs [--apply] [--min-site-count <n>] [--site-limit <n>]

Options:
  --apply               Persist changes. Omit for dry-run.
  --min-site-count <n>  Minimum occurrences in source files to create a site. Default: 3.
  --site-limit <n>      Limit number of sites processed (for staged rollouts).
`

const SOURCE_BUCKET = 'Historical records Downer LINZ'
const DEFAULT_SOURCE_FILES = [
  { bucket: SOURCE_BUCKET, path: 'Vehicle Log 10-3-26.xlsx' },
  { bucket: SOURCE_BUCKET, path: 'Vehicle Log 19-3-26.csv' },
]

function parseArgs(argv) {
  const readOptionValue = (flag) => {
    const exactIndex = argv.indexOf(flag)
    if (exactIndex >= 0) return argv[exactIndex + 1]
    const inline = argv.find((token) => token.startsWith(`${flag}=`))
    return inline ? inline.slice(flag.length + 1) : undefined
  }

  return {
    help: argv.includes('--help') || argv.includes('-h'),
    apply: argv.includes('--apply'),
    minSiteCount: Number.parseInt(String(readOptionValue('--min-site-count') || '3'), 10),
    siteLimit: Number.parseInt(String(readOptionValue('--site-limit') || ''), 10),
  }
}

function loadEnv() {
  for (const file of ['.env.local', '.env', '.env.development.local', '.env.development']) {
    if (fs.existsSync(file)) dotenv.config({ path: file, override: false })
  }
}

function normalizeSiteName(raw) {
  const value = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!value) return ''
  const upper = value.toUpperCase()
  if (upper.length <= 1) return ''
  if (/^[A-Z0-9]{1,2}$/.test(upper)) return ''
  return value
}

function canonicalSiteKey(name) {
  return normalizeSiteName(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function normalizeFreeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

async function listSourceFiles(supabase) {
  const { data, error } = await supabase
    .storage
    .from(SOURCE_BUCKET)
    .list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } })

  if (error || !Array.isArray(data)) return DEFAULT_SOURCE_FILES

  const files = data
    .filter((item) => item && item.metadata)
    .map((item) => String(item.name || '').trim())
    .filter((name) => /\.(csv|xlsx|xls)$/i.test(name))
    .map((path) => ({ bucket: SOURCE_BUCKET, path }))

  return files.length > 0 ? files : DEFAULT_SOURCE_FILES
}

function extractRowsFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!firstSheet) return []
  return XLSX.utils.sheet_to_json(firstSheet, { defval: '' })
}

function buildSquareGeometry(lat, lng, dLat = 0.0035, dLng = 0.0045) {
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ]],
  }
}

async function geocodeSiteName(siteName, apiKey, cache) {
  const cacheKey = siteName.toLowerCase()
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  if (!apiKey) {
    cache.set(cacheKey, null)
    return null
  }

  const queries = [
    `${siteName}, Lake Dunstan, Central Otago, New Zealand`,
    `${siteName}, Central Otago, New Zealand`,
    `${siteName}, Otago, New Zealand`,
    `${siteName}, New Zealand`,
  ]

  for (const query of queries) {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}` +
      `&key=${encodeURIComponent(apiKey)}&region=nz`

    const response = await fetch(url)
    if (!response.ok) continue

    const payload = await response.json()
    if (!Array.isArray(payload?.results) || payload.results.length === 0) continue

    const result = payload.results[0]
    const lat = Number(result?.geometry?.location?.lat)
    const lng = Number(result?.geometry?.location?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const out = {
      lat,
      lng,
      address: String(result.formatted_address || '').trim() || null,
      placeId: String(result.place_id || '').trim() || null,
      confidence: 0.9,
    }
    cache.set(cacheKey, out)
    return out
  }

  cache.set(cacheKey, null)
  return null
}

async function getOrganizationIdByName(supabase, name) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('name', name)
    .maybeSingle()

  if (error) throw new Error(`Failed to load organization ${name}: ${error.message}`)
  return data?.id || null
}

async function findOrCreateLoi(supabase, orgId, site, geocode, apply) {
  const loiName = `Downer LINZ Site ${site.name}`

  const { data: existing, error: existingErr } = await supabase
    .from('locations_of_interest')
    .select('id')
    .eq('organization_id', orgId)
    .eq('loi_kind', 'freedom_camp')
    .eq('name', loiName)
    .maybeSingle()

  if (existingErr) throw new Error(`Failed loading LOI ${loiName}: ${existingErr.message}`)

  const payload = {
    organization_id: orgId,
    name: loiName,
    description: `Auto-enriched Downer LINZ site from historical records (${site.name}).`,
    loi_kind: 'freedom_camp',
    address_full: geocode?.address || `${site.name}, Central Otago, New Zealand`,
    gps_lat: geocode?.lat ?? null,
    gps_lng: geocode?.lng ?? null,
    geocoder_source: geocode ? 'google_maps_downer_linz_site_enrichment' : 'downer_linz_site_title',
    geocoder_confidence: geocode ? geocode.confidence : 0.5,
    geofence_geometry: geocode ? buildSquareGeometry(geocode.lat, geocode.lng) : null,
  }

  if (existing?.id) {
    if (apply) {
      const { error } = await supabase.from('locations_of_interest').update(payload).eq('id', existing.id)
      if (error) throw new Error(`Failed updating LOI ${loiName}: ${error.message}`)
    }
    return existing.id
  }

  if (!apply) return ''

  const { data: created, error: insertErr } = await supabase
    .from('locations_of_interest')
    .insert(payload)
    .select('id')
    .single()

  if (insertErr || !created?.id) {
    throw new Error(`Failed creating LOI ${loiName}: ${insertErr?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateZone(supabase, orgId, site, geocode, loiId, apply) {
  const zoneName = `Downer LINZ Security Zone - ${site.name}`

  const { data: existing, error: existingErr } = await supabase
    .from('zones')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', zoneName)
    .maybeSingle()

  if (existingErr) throw new Error(`Failed loading zone ${zoneName}: ${existingErr.message}`)

  const payload = {
    organization_id: orgId,
    name: zoneName,
    description: `Auto-enriched security zone for Downer LINZ site ${site.name}.`,
    is_active: true,
    boundary_source: 'enrich-downer-linz-sites',
    location_lat: geocode?.lat ?? null,
    location_lng: geocode?.lng ?? null,
    geometry: geocode ? buildSquareGeometry(geocode.lat, geocode.lng) : null,
    zone_type: 'specific',
    loi_id: loiId || null,
  }

  if (existing?.id) {
    if (apply) {
      const { error } = await supabase.from('zones').update(payload).eq('id', existing.id)
      if (error) throw new Error(`Failed updating zone ${zoneName}: ${error.message}`)
    }
    return existing.id
  }

  if (!apply) return ''

  const { data: created, error: insertErr } = await supabase
    .from('zones')
    .insert(payload)
    .select('id')
    .single()

  if (insertErr || !created?.id) {
    throw new Error(`Failed creating zone ${zoneName}: ${insertErr?.message || 'Unknown error'}`)
  }

  return created.id
}

function extractSiteFromOfficerNotes(notes) {
  const text = String(notes || '').trim()
  if (!text) return ''

  const normalized = text.replace(/^\[Historical Import\]\[Downer LINZ\]\s*/i, '')
  const firstPart = normalized.split('|')[0]?.trim() || ''
  return normalizeSiteName(firstPart)
}

function parseOfficerNotesParts(notes) {
  const text = String(notes || '').trim()
  if (!text) return { title: '', note: '', raw: '' }

  const normalized = text.replace(/^\[Historical Import\]\[Downer LINZ\]\s*/i, '')
  const parts = normalized.split('|').map((part) => String(part || '').trim())
  return {
    title: normalizeSiteName(parts[0] || ''),
    note: String(parts[1] || '').trim(),
    raw: normalized,
  }
}

function findSiteKeyInText(text, siteMap) {
  const normalizedText = normalizeFreeText(text)
  if (!normalizedText) return ''

  let best = null
  for (const [key, mapping] of siteMap.entries()) {
    const siteNorm = normalizeFreeText(mapping.siteName)
    if (!siteNorm || siteNorm.length < 3) continue
    if (!normalizedText.includes(siteNorm)) continue

    if (!best || siteNorm.length > best.siteNorm.length) {
      best = { key, siteNorm }
    }
  }

  return best?.key || ''
}

function resolveObservationSiteKey(notes, siteMap) {
  const parts = parseOfficerNotesParts(notes)

  const noteKey = findSiteKeyInText(parts.note, siteMap)
  if (noteKey) return noteKey

  const titleKey = canonicalSiteKey(parts.title)
  if (titleKey && siteMap.has(titleKey)) return titleKey

  const fallbackFromRaw = findSiteKeyInText(parts.raw, siteMap)
  if (fallbackFromRaw) return fallbackFromRaw

  return ''
}

async function backfillObservationGeo(supabase, orgId, siteMap, apply) {
  const selectFields = 'observation_id,id,officer_notes,gps_latitude,gps_longitude,zone_id,idempotency_key'

  let from = 0
  const pageSize = 1000
  const updates = []

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from('observations')
      .select(selectFields)
      .eq('organization_id', orgId)
      .like('idempotency_key', 'import:downer-linz:%')
      .range(from, to)

    if (error) throw new Error(`Failed loading observations for geo backfill: ${error.message}`)
    if (!Array.isArray(data) || data.length === 0) break

    for (const row of data) {
      const key = resolveObservationSiteKey(row.officer_notes, siteMap)
      if (!key || !siteMap.has(key)) continue

      const mapping = siteMap.get(key)
      if (!mapping?.lat || !mapping?.lng) continue

      const hasLat = Number.isFinite(Number(row.gps_latitude))
      const hasLng = Number.isFinite(Number(row.gps_longitude))
      const rowZoneId = String(row.zone_id || '')
      const shouldGeo = !(hasLat && hasLng)
      const shouldZone = Boolean(mapping.zoneId && rowZoneId !== String(mapping.zoneId))
      if (!shouldGeo && !shouldZone) continue

      updates.push({
        observationId: row.observation_id || row.id,
        useObservationId: Boolean(row.observation_id),
        payload: {
          ...(shouldGeo ? { gps_latitude: mapping.lat, gps_longitude: mapping.lng, gps_accuracy: 25 } : {}),
          ...(shouldZone ? { zone_id: mapping.zoneId } : {}),
        },
      })
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  let updated = 0
  let failed = 0
  const errorSample = []

  if (apply) {
    for (const item of updates) {
      const query = supabase.from('observations').update(item.payload)
      const { error } = item.useObservationId
        ? await query.eq('observation_id', item.observationId)
        : await query.eq('id', item.observationId)

      if (error) {
        failed += 1
        if (errorSample.length < 20) errorSample.push(error.message)
      } else {
        updated += 1
      }
    }
  }

  return {
    candidates: updates.length,
    updated,
    failed,
    errorSample,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  loadEnv()

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
  const googleApiKey = String(process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const orgId = await getOrganizationIdByName(supabase, 'Downer LINZ')
  if (!orgId) throw new Error('Organization not found: Downer LINZ')

  const sourceFiles = await listSourceFiles(supabase)
  const siteStats = new Map()

  for (const source of sourceFiles) {
    const { data, error } = await supabase.storage.from(source.bucket).download(source.path)
    if (error || !data) {
      throw new Error(`Failed downloading ${source.bucket}/${source.path}: ${error?.message || 'Unknown error'}`)
    }

    const bytes = Buffer.from(await data.arrayBuffer())
    const rows = extractRowsFromBuffer(bytes)

    for (const row of rows) {
      const title = normalizeSiteName(row.Title || row.title || row.Site || row.site || '')
      if (!title) continue

      const key = canonicalSiteKey(title)
      if (!key) continue

      const current = siteStats.get(key) || { key, name: title, count: 0 }
      current.count += 1
      if (title.length > current.name.length) current.name = title
      siteStats.set(key, current)
    }
  }

  const minCount = Number.isFinite(args.minSiteCount) && args.minSiteCount > 0 ? args.minSiteCount : 3
  let sites = [...siteStats.values()]
    .filter((s) => s.count >= minCount)
    .sort((a, b) => b.count - a.count)

  if (Number.isFinite(args.siteLimit) && args.siteLimit > 0) {
    sites = sites.slice(0, args.siteLimit)
  }

  const geocodeCache = new Map()
  const siteMap = new Map()
  const siteResults = []

  for (const site of sites) {
    const geocode = await geocodeSiteName(site.name, googleApiKey, geocodeCache)
    let loiId = ''
    let zoneId = ''

    if (geocode || !args.apply) {
      loiId = await findOrCreateLoi(supabase, orgId, site, geocode, args.apply)
      zoneId = await findOrCreateZone(supabase, orgId, site, geocode, loiId, args.apply)
    }

    if (geocode) {
      siteMap.set(site.key, {
        siteName: site.name,
        lat: geocode.lat,
        lng: geocode.lng,
        zoneId,
        loiId,
      })
    }

    siteResults.push({
      site_name: site.name,
      observed_count: site.count,
      geocoded: Boolean(geocode),
      lat: geocode?.lat || null,
      lng: geocode?.lng || null,
      zone_id: zoneId || null,
      loi_id: loiId || null,
    })
  }

  const backfill = await backfillObservationGeo(supabase, orgId, siteMap, args.apply)

  const summary = {
    mode: args.apply ? 'apply' : 'dry-run',
    org_id: orgId,
    source_files: sourceFiles,
    min_site_count: minCount,
    sites_detected: siteStats.size,
    sites_processed: sites.length,
    sites_geocoded: siteResults.filter((s) => s.geocoded).length,
    google_api_available: Boolean(googleApiKey),
    site_sample: siteResults.slice(0, 30),
    observation_backfill: backfill,
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
