#!/usr/bin/env node
/**
 * import-ncc-zones-from-storage.mjs
 *
 * Imports freedom camping zones from Supabase Storage (XLSX/CSV) and ensures:
 * 1) A canonical LOI exists in locations_of_interest (loi_kind='freedom_camp')
 * 2) A linked zone row exists in zones with zones.loi_id set
 *
 * Usage:
 *   node scripts/import-ncc-zones-from-storage.mjs [--dry-run] [--bucket <name>] [--file <path>] [--org-id <uuid>] [--scope ncc|all] [--create-missing-clients]
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const BUCKET = (() => {
  const idx = args.indexOf('--bucket')
  return idx !== -1 ? args[idx + 1] : (process.env.NCC_ZONES_BUCKET || 'imports_canonical_vehicles')
})()
const FILE_PATH = (() => {
  const idx = args.indexOf('--file')
  return idx !== -1 ? args[idx + 1] : (process.env.NCC_ZONES_FILE || 'zones_rows.xlsx')
})()
const NCC_ORG_ID = (() => {
  const idx = args.indexOf('--org-id')
  return idx !== -1
    ? args[idx + 1]
    : (process.env.NCC_ORG_ID || 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993')
})()
const IMPORT_SCOPE = (() => {
  const idx = args.indexOf('--scope')
  const value = (idx !== -1 ? args[idx + 1] : 'ncc') || 'ncc'
  return value.toLowerCase() === 'all' ? 'all' : 'ncc'
})()
const CREATE_MISSING_CLIENTS = args.includes('--create-missing-clients')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function normalizeRow(row) {
  const out = {}
  for (const [key, value] of Object.entries(row || {})) {
    out[normalizeHeader(key)] = typeof value === 'string' ? value.trim() : value
  }
  return out
}

function parseCsvLine(line) {
  const values = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }
  values.push(current)
  return values
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const splitLine = delimiter === '\t' ? (line) => line.split('\t') : parseCsvLine
  const headers = splitLine(lines[0]).map((h) => normalizeHeader(h.replace(/^"|"$/g, '')))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i])
    const row = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? '').trim().replace(/^"|"$/g, '')
    }
    rows.push(normalizeRow(row))
  }
  return rows
}

function parseXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
  return rows.map(normalizeRow)
}

async function downloadWithFallback(bucket, filePath) {
  const candidates = [filePath]
  if (/\.xlsx$/i.test(filePath)) {
    candidates.push(filePath.replace(/\.xlsx$/i, '.csv'))
  } else if (/\.csv$/i.test(filePath)) {
    candidates.push(filePath.replace(/\.csv$/i, '.xlsx'))
  } else {
    candidates.push(`${filePath}.xlsx`, `${filePath}.csv`)
  }

  for (const candidate of [...new Set(candidates)]) {
    const { data, error } = await supabase.storage.from(bucket).download(candidate)
    if (!error && data) return { fileBlob: data, resolvedPath: candidate, candidates }
  }

  return { fileBlob: null, resolvedPath: filePath, candidates }
}

function pick(row, keys, fallback = null) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return fallback
}

function parseBool(value, fallback = false) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback
  const v = String(value).trim().toLowerCase()
  return ['true', '1', 'yes', 'y'].includes(v)
}

function parseIntSafe(value, fallback) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback
  const parsed = parseInt(String(value), 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function parseFloatSafe(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const parsed = parseFloat(String(value))
  return Number.isNaN(parsed) ? null : parsed
}

function parseAllowedDays(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean)
  } catch {
    // ignore and fallback below
  }
  if (text.includes(',')) return text.split(',').map((d) => d.trim()).filter(Boolean)
  return [text]
}

function classifyOwnership(row) {
  const text = `${row.name || ''} ${row.description || ''} ${row.land_manager || ''} ${row.enforcement_authority || ''}`.toLowerCase()
  if (/\blinz\b/.test(text)) return 'linz'
  if (/\bdoc\b|department of conservation/.test(text)) return 'doc'
  return 'ncc'
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim())
}

function defaultClientNameForOwner(ownerType, orgId) {
  const shortId = String(orgId).slice(0, 8)
  if (ownerType === 'linz') return `LINZ Imported Client ${shortId}`
  if (ownerType === 'doc') return `DOC Imported Client ${shortId}`
  return `Imported Client ${shortId}`
}

async function ensureOrganizationsExist(orgSummaries) {
  const orgIds = [...new Set(orgSummaries.map((o) => o.organization_id).filter(Boolean))]
  if (orgIds.length === 0) return { created: 0, existing: 0 }

  const { data: existingRows, error: existingErr } = await supabase
    .from('organizations')
    .select('id')
    .in('id', orgIds)

  if (existingErr) throw existingErr

  const existingIds = new Set((existingRows || []).map((r) => r.id))
  const missing = orgSummaries.filter((o) => !existingIds.has(o.organization_id))

  if (missing.length === 0) {
    return { created: 0, existing: existingIds.size }
  }

  const insertRows = missing.map((o) => ({
    id: o.organization_id,
    name: o.organization_name || defaultClientNameForOwner(o.ownership, o.organization_id),
    organization_type: 'client',
    is_active: true,
  }))

  const { error: insertErr } = await supabase
    .from('organizations')
    .upsert(insertRows, { onConflict: 'id', ignoreDuplicates: false })

  if (insertErr) throw insertErr

  return { created: insertRows.length, existing: existingIds.size }
}

async function findOrCreateLoi(zone) {
  const { data: existing, error: existingErr } = await supabase
    .from('locations_of_interest')
    .select('id')
    .eq('organization_id', zone.organization_id)
    .eq('loi_kind', 'freedom_camp')
    .eq('name', zone.name)
    .limit(1)
    .maybeSingle()

  if (existingErr) throw existingErr
  if (existing?.id) return existing.id

  const loiInsert = {
    organization_id: zone.organization_id,
    name: zone.name,
    description: zone.description,
    loi_kind: 'freedom_camp',
    address_full: zone.address_full,
    gps_lat: zone.location_lat,
    gps_lng: zone.location_lng,
    geocoder_source: 'storage_import_ncc',
    geocoder_confidence: 0.9,
  }

  const { data: created, error: createErr } = await supabase
    .from('locations_of_interest')
    .insert(loiInsert)
    .select('id')
    .single()

  if (createErr) throw createErr
  return created.id
}

async function upsertZone(zone) {
  if (zone.id) {
    const { data, error } = await supabase
      .from('zones')
      .upsert(zone, { onConflict: 'id', ignoreDuplicates: false })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  const { data: existing, error: findErr } = await supabase
    .from('zones')
    .select('id')
    .eq('organization_id', zone.organization_id)
    .eq('name', zone.name)
    .limit(1)
    .maybeSingle()

  if (findErr) throw findErr

  if (existing?.id) {
    const { error } = await supabase
      .from('zones')
      .update(zone)
      .eq('id', existing.id)
    if (error) throw error
    return existing.id
  } else {
    const { data, error } = await supabase
      .from('zones')
      .insert(zone)
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }
}

function arraysEqual(a, b) {
  const left = Array.isArray(a) ? a : []
  const right = Array.isArray(b) ? b : []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (String(left[i]) !== String(right[i])) return false
  }
  return true
}

async function ensureZoneComplianceMatrix(zoneId, organizationId, rules) {
  const { data: current, error: currentErr } = await supabase
    .from('zone_compliance_matrix')
    .select('id, version, self_contained_required, requires_csc, nights_per_month, max_consecutive_nights, day_visit_only, allowed_days, homeless_exemption')
    .eq('zone_id', zoneId)
    .is('effective_to', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (currentErr) throw currentErr

  const normalized = {
    self_contained_required: Boolean(rules.self_contained_required),
    requires_csc: Boolean(rules.self_contained_required),
    nights_per_month: Number.isFinite(rules.nights_per_month) ? rules.nights_per_month : 28,
    max_consecutive_nights: Number.isFinite(rules.max_consecutive_nights) ? rules.max_consecutive_nights : 3,
    day_visit_only: Boolean(rules.day_visit_only),
    allowed_days: Array.isArray(rules.allowed_days) ? rules.allowed_days : null,
    homeless_exemption: true,
  }

  if (current) {
    const sameRules =
      Boolean(current.self_contained_required) === normalized.self_contained_required &&
      Boolean(current.requires_csc) === normalized.requires_csc &&
      Number(current.nights_per_month ?? 28) === Number(normalized.nights_per_month) &&
      Number(current.max_consecutive_nights ?? 3) === Number(normalized.max_consecutive_nights) &&
      Boolean(current.day_visit_only) === normalized.day_visit_only &&
      arraysEqual(current.allowed_days, normalized.allowed_days) &&
      Boolean(current.homeless_exemption ?? true) === normalized.homeless_exemption

    if (sameRules) {
      return { version: current.version, changed: false }
    }

    const { error: closeErr } = await supabase
      .from('zone_compliance_matrix')
      .update({ effective_to: new Date().toISOString() })
      .eq('id', current.id)

    if (closeErr) throw closeErr
  }

  const nextVersion = current ? Number(current.version || 1) + 1 : 1
  const { error: insertErr } = await supabase
    .from('zone_compliance_matrix')
    .insert({
      zone_id: zoneId,
      organization_id: organizationId,
      version: nextVersion,
      effective_from: new Date().toISOString(),
      effective_to: null,
      self_contained_required: normalized.self_contained_required,
      requires_csc: normalized.requires_csc,
      nights_per_month: normalized.nights_per_month,
      max_consecutive_nights: normalized.max_consecutive_nights,
      day_visit_only: normalized.day_visit_only,
      allowed_days: normalized.allowed_days,
      homeless_exemption: normalized.homeless_exemption,
      change_reason: current ? 'auto_synced_from_zone_update' : 'auto_created_with_zone',
      change_notes: 'Synced by import-ncc-zones-from-storage.mjs',
    })

  if (insertErr) throw insertErr

  return { version: nextVersion, changed: true }
}

async function run() {
  console.log(`Downloading ${BUCKET}/${FILE_PATH} (scope=${IMPORT_SCOPE})`)
  const { fileBlob, resolvedPath, candidates } = await downloadWithFallback(BUCKET, FILE_PATH)

  if (!fileBlob) {
    console.error('Storage download failed for all candidate paths.')
    console.error(`Tried: ${candidates.join(', ')}`)
    process.exit(1)
  }

  const rows = /\.xlsx$/i.test(resolvedPath)
    ? parseXlsx(Buffer.from(await fileBlob.arrayBuffer()))
    : parseCsv(await fileBlob.text())

  console.log(`Loaded ${rows.length} rows from ${resolvedPath}`)

  const mapped = rows
    .map((row, idx) => {
      const name = String(pick(row, ['name', 'zone_name', 'title', 'location_name', 'site_name'], '')).trim()
      if (!name) return null

      const sourceOrgId = String(pick(row, ['organization_id', 'org_id'], '')).trim()
      const ownership = classifyOwnership(row)
      const organizationId = IMPORT_SCOPE === 'all' && isValidUuid(sourceOrgId)
        ? sourceOrgId
        : NCC_ORG_ID

      const sourceZoneType = String(pick(row, ['zone_type'], 'specific')).trim().toLowerCase()
      const locationLat = parseFloatSafe(pick(row, ['location_lat', 'gps_lat', 'latitude', 'lat'], null))
      const locationLng = parseFloatSafe(pick(row, ['location_lng', 'gps_lng', 'longitude', 'lng', 'lon'], null))
      const isNccOwned = ownership === 'ncc'
      const isSpecific = sourceZoneType === 'specific'

      if (IMPORT_SCOPE === 'ncc') {
        // NCC import should only include NCC-owned specific zones from the
        // source workbook. LINZ/DOC/parent rows are intentionally skipped.
        if (!isNccOwned || !isSpecific) return null
      } else {
        // Full import mode keeps zone rows only (specific records) and lets
        // each row stay with its source organization.
        if (!isSpecific) return null
      }

      // Active zones require geofence coordinates in this schema.
      if (locationLat === null || locationLng === null) return null

      const addressFull = String(pick(row, ['address_full', 'address', 'display_address', 'street_address'], '')).trim() || null

      return {
        rowIndex: idx + 2,
        id: String(pick(row, ['id', 'zone_id'], '')).trim() || null,
        organization_id: organizationId,
        name,
        description: String(pick(row, ['description', 'notes', 'comment'], '')).trim() || null,
        self_contained_required: parseBool(pick(row, ['self_contained_required', 'self_contained', 'requires_self_contained'], false), false),
        nights_per_month: parseIntSafe(pick(row, ['nights_per_month'], 28), 28),
        max_consecutive_nights: parseIntSafe(pick(row, ['max_consecutive_nights'], 3), 3),
        day_visit_only: parseBool(pick(row, ['day_visit_only'], false), false),
        allowed_days: parseAllowedDays(pick(row, ['allowed_days'], null)),
        is_active: true,
        location_lat: locationLat,
        location_lng: locationLng,
        zone_type: 'specific',
        address_full: addressFull,
        ownership,
        source_org_id: sourceOrgId || null,
      }
    })
    .filter(Boolean)

  console.log(`Prepared ${mapped.length} valid zone rows for scope ${IMPORT_SCOPE}`)

  if (CREATE_MISSING_CLIENTS && IMPORT_SCOPE === 'all') {
    const orgSummaries = [...new Map(
      mapped.map((row) => [row.organization_id, {
        organization_id: row.organization_id,
        ownership: row.ownership,
        organization_name: defaultClientNameForOwner(row.ownership, row.organization_id),
      }])
    ).values()]

    if (DRY_RUN) {
      const ids = orgSummaries.map((o) => o.organization_id)
      const { data: existingRows, error: existingErr } = await supabase
        .from('organizations')
        .select('id')
        .in('id', ids)
      if (existingErr) throw existingErr
      const existingIds = new Set((existingRows || []).map((r) => r.id))
      const missingCount = orgSummaries.filter((o) => !existingIds.has(o.organization_id)).length
      console.log(`DRY RUN: missing client orgs to create: ${missingCount}`)
    } else {
      const orgResult = await ensureOrganizationsExist(orgSummaries)
      console.log(`Client org provisioning: created=${orgResult.created}, existing=${orgResult.existing}`)
    }
  }

  if (DRY_RUN) {
    console.log('DRY RUN sample:')
    for (const row of mapped.slice(0, 5)) {
      console.log(`${row.name} | lat=${row.location_lat ?? 'null'} lng=${row.location_lng ?? 'null'} | org=${row.organization_id}`)
    }
    return
  }

  let successCount = 0
  let failCount = 0
  let matrixChangedCount = 0

  for (const row of mapped) {
    try {
      const loiId = await findOrCreateLoi(row)

      const zonePayload = {
        organization_id: row.organization_id,
        name: row.name,
        description: row.description,
        self_contained_required: row.self_contained_required,
        nights_per_month: row.nights_per_month,
        max_consecutive_nights: row.max_consecutive_nights,
        day_visit_only: row.day_visit_only,
        allowed_days: row.allowed_days,
        is_active: row.is_active,
        location_lat: row.location_lat,
        location_lng: row.location_lng,
        zone_type: row.zone_type,
        loi_id: loiId,
      }

      if (row.id) {
        zonePayload.id = row.id
      }

      const zoneId = await upsertZone(zonePayload)
      const matrix = await ensureZoneComplianceMatrix(zoneId, row.organization_id, zonePayload)
      if (matrix.changed) matrixChangedCount++
      successCount++
    } catch (err) {
      failCount++
      const message = err && typeof err === 'object' && 'message' in err ? err.message : String(err)
      console.error(`Row ${row.rowIndex} failed (${row.name}): ${message}`)
    }
  }

  console.log(`Done. Zones imported: ${successCount}. Matrix updates: ${matrixChangedCount}. Failed: ${failCount}.`)
}

run().catch((err) => {
  console.error('Fatal error:', err?.message || err)
  process.exit(1)
})
