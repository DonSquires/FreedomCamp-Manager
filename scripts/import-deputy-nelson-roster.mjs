#!/usr/bin/env node
/**
 * Import Deputy Nelson Roster Data
 * 
 * Purpose:
 *   Import staff roster/shift data from Deputy CSV (Service-Contracts/Deputy-Data/Deputy data.csv)
 *   into FieldOps Manager roster_shifts, user_profiles, office_locations, and client_sites.
 * 
 * Usage:
 *   node scripts/import-deputy-nelson-roster.mjs [--apply]
 * 
 * Flags:
 *   --apply    Persist data to Supabase (dry-run if omitted)
 * 
 * Dependencies:
 *   - SUPABASE_URL and SUPABASE_ANON_KEY environment variables
 *   - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION for S3 access
 *   - NodeJS 18+, xlsx, @supabase/supabase-js, aws-sdk
 * 
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { sdkStreamMixin } from '@aws-sdk/util-stream-node'
import * as XLSX from 'xlsx'
import crypto from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply')
const VERBOSE = process.argv.includes('--verbose')

// Parse --file argument for local CSV path
let LOCAL_CSV_PATH = null
const fileIndex = process.argv.indexOf('--file')
if (fileIndex !== -1 && process.argv[fileIndex + 1]) {
  LOCAL_CSV_PATH = process.argv[fileIndex + 1]
}

// Supabase Storage fallback: download Deputy CSV if not present locally
async function downloadDeputyFromSupabaseStorage(localPath) {
  try {
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!url || !key) throw new Error('Missing Supabase URL or key')
    const supa = createSupabaseClient(url, key)
    const { data, error } = await supa.storage.from('Service-Contracts').download('Deputy-Data/Deputy data.csv')
    if (error) throw new Error(error.message)
    const fs = await import('fs').then(m => m.promises)
    await fs.writeFile(localPath, Buffer.from(await data.arrayBuffer()))
    console.log(`✅ Downloaded Deputy CSV from Supabase Storage to ${localPath}`)
    return true
  } catch (err) {
    console.error(`❌ Failed to download Deputy CSV from Supabase Storage: ${err.message}`)
    return false
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const supabaseAdmin = SUPABASE_SERVICE_ROLE
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
  : null
const supabaseDb = supabaseAdmin || supabase

const AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2'
const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY
const S3_BUCKET = process.env.AWS_S3_BUCKET || 'Service-Contracts'

const SOURCE = {
  bucket: S3_BUCKET,
  deputyPath: 'Deputy-Data/Deputy data.csv',
}

// Organization target
const TARGET_ORG_NAME = 'Nelson City Council'

// Zone codes → canonical zone names
const ZONE_BY_CODE = {
  '582': 'Nelson Zone 582 (East)',
  '584': 'Nelson Zone 584 (Central)',
  '585': 'Nelson Zone 585 (West)',
  '586': 'Nelson Zone 586 (North)',
  '587': 'Nelson Zone 587 (South)',
}

const SERVICE_DOMAIN_BY_TYPE = {
  patrol: ['patrol'],
  noise: ['noise_control'],
  parking: ['parking'],
  alarm_response: ['alarm_response'],
  static_guard: ['static_guard'],
  freedom_camping: ['freedom_camping'],
  biosecurity: ['biosecurity'],
  guarding: ['*'],
}

const SITE_TYPE_BY_SERVICE = {
  patrol: 'guarding',
  noise: 'noise_control',
  parking: 'parking',
  alarm_response: 'guarding',
  static_guard: 'guarding',
  freedom_camping: 'freedom_camping',
  biosecurity: 'general',
  guarding: 'general',
}

// Service type inference
const inferServiceType = (row) => {
  const position = toTrimmedString(row['Position']).toLowerCase()
  const locationName = toTrimmedString(row['Location Name']).toLowerCase()
  const locationCode = toTrimmedString(row['Location Code']).toLowerCase()

  if (position.includes('noise') || locationName.includes('noise control')) return 'noise'
  if (locationCode.startsWith('nsn:') && /[582-587]/.test(locationCode)) return 'patrol'
  if (locationName.includes('parking')) return 'parking'
  if (locationName.includes('alarm')) return 'alarm_response'
  if (position.includes('static') || position.includes('guard')) return 'static_guard'
  if (position.includes('freedom')) return 'freedom_camping'
  if (position.includes('biosecurity')) return 'biosecurity'
  return 'guarding' // default
}

// Service domain inference
const inferServiceDomains = (serviceType) => {
  const domainMap = {
    'patrol': ['patrol'],
    'noise': ['noise_control'],
    'parking': ['parking'],
    'alarm_response': ['alarm_response'],
    'static_guard': ['static_guard'],
    'freedom_camping': ['freedom_camping'],
    'biosecurity': ['biosecurity'],
    'guarding': ['*'], // generic guarding can apply to any domain
  }
  return domainMap[serviceType] || ['*']
}

// Idempotency key for roster imports
const makeRosterKey = (row, index) => {
  const displayName = row['Display Name'] || ''
  const scheduleDate = row['Schedule Date'] || ''
  const startTime = row['Schedule Start Time'] || ''
  const locationCode = row['Location Code'] || ''
  const content = `${displayName}|${scheduleDate}|${startTime}|${locationCode}|${index}`
  const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 12)
  return `import:deputy:roster:${hash}`
}

const normalizeKey = (value) => toTrimmedString(value).toLowerCase()

const mergeUnique = (current, additions) => {
  const out = new Set((Array.isArray(current) ? current : []).filter(Boolean))
  for (const value of additions || []) {
    if (value) out.add(value)
  }
  return [...out]
}

async function resolveOrganizationByName(name) {
  const { data, error } = await supabaseDb
    .from('organizations')
    .select('id, name')
    .ilike('name', name)
    .limit(10)

  if (error) throw new Error(`Failed loading organization ${name}: ${error.message}`)
  const found = (data || []).find((row) => normalizeKey(row.name) === normalizeKey(name)) || data?.[0]
  if (!found?.id) throw new Error(`Organization not found: ${name}`)
  return found
}

function pickServiceType(row) {
  return inferServiceType(row)
}

function pickServiceDomains(serviceType) {
  return SERVICE_DOMAIN_BY_TYPE[serviceType] || ['*']
}

function pickSiteType(serviceType) {
  return SITE_TYPE_BY_SERVICE[serviceType] || 'general'
}

function buildLocationLabel(location) {
  return location.code ? `${location.name} [${location.code}]` : location.name
}

function buildLoiPayload(nccOrgId, location) {
  const label = buildLocationLabel(location)
  return {
    organization_id: nccOrgId,
    name: location.name,
    description: location.code ? `Deputy location ${location.code}` : 'Deputy location import',
    loi_kind: 'poi',
    address_full: label,
    display_address: label,
    gps_lat: location.gpsLat ?? null,
    gps_lng: location.gpsLng ?? null,
    is_canonical: true,
    is_active: true,
  }
}

function buildZoneLoiPayload(nccOrgId, zoneName) {
  return {
    organization_id: nccOrgId,
    name: zoneName,
    description: `Deputy zone ${zoneName}`,
    loi_kind: 'poi',
    address_full: zoneName,
    display_address: zoneName,
    is_canonical: true,
    is_active: true,
  }
}

function buildClientSitePayload(nccOrgId, location, loiId, zoneId) {
  return {
    organization_id: nccOrgId,
    name: location.name,
    site_code: location.code || null,
    site_type: pickSiteType(location.serviceType),
    address: location.name,
    zone_id: zoneId || null,
    loi_id: loiId || null,
    gps_lat: location.gpsLat ?? null,
    gps_lng: location.gpsLng ?? null,
    is_active: true,
  }
}

async function loadExistingLoiMaps(nccOrgId) {
  let { data, error } = await supabaseDb
    .from('locations_of_interest')
    .select('id, name, display_address, address_full, loi_kind, gps_lat, gps_lng')
    .eq('organization_id', nccOrgId)

  if (error && String(error.message || '').includes('service_domains')) {
    ;({ data, error } = await supabaseDb
      .from('locations_of_interest')
      .select('id, name, display_address, address_full, loi_kind, gps_lat, gps_lng')
      .eq('organization_id', nccOrgId))
    if (!error) {
      data = (data || []).map((row) => ({ ...row, service_domains: [] }))
    }
  }

  if (error) throw new Error(`Failed loading LOIs: ${error.message}`)

  const byName = new Map()
  const byAddress = new Map()

  for (const row of data || []) {
    if (row?.name) byName.set(normalizeKey(row.name), row)
    if (row?.display_address) byAddress.set(normalizeKey(row.display_address), row)
    if (row?.address_full) byAddress.set(normalizeKey(row.address_full), row)
  }

  return { rows: data || [], byName, byAddress }
}

async function ensureLocationLoi(nccOrgId, location, loiMaps, apply) {
  const candidates = [location.name, buildLocationLabel(location), location.address]
    .map(normalizeKey)
    .filter(Boolean)
  for (const candidate of candidates) {
    const existing = loiMaps.byName.get(candidate) || loiMaps.byAddress.get(candidate)
    if (existing?.id) {
      return existing.id
    }
  }

  if (!apply) return null

  const payload = buildLoiPayload(nccOrgId, location)
  const { data, error } = await supabaseDb
    .from('locations_of_interest')
    .insert(payload)
    .select('id')
    .single()

  if (error || !data?.id) {
    throw new Error(`Failed creating LOI for ${location.name}: ${error?.message || 'missing id'}`)
  }

  loiMaps.byName.set(normalizeKey(location.name), { id: data.id })
  loiMaps.byAddress.set(normalizeKey(payload.address_full), { id: data.id })
  return data.id
}

async function ensureZoneLois(nccOrgId, apply) {
  const zoneMap = new Map()
  const { data: zones, error } = await supabaseDb
    .from('zones')
    .select('id, name, loi_id')
    .eq('organization_id', nccOrgId)

  if (error) throw new Error(`Failed loading zones: ${error.message}`)

  const loiMaps = await loadExistingLoiMaps(nccOrgId)
  for (const zone of zones || []) {
    if (!zone?.name) continue
    const key = normalizeKey(zone.name)
    const existingLoi = loiMaps.byName.get(key) || loiMaps.byAddress.get(key)
    let loiId = existingLoi?.id || null
    if (!loiId && apply) {
      const payload = buildZoneLoiPayload(nccOrgId, zone.name)
      const { data: created, error: loiError } = await supabaseDb.from('locations_of_interest').insert(payload).select('id').single()
      if (loiError) throw new Error(`Failed creating zone LOI ${zone.name}: ${loiError.message}`)
      loiId = created?.id || null
    }
    if (loiId && apply && zone.loi_id !== loiId) {
      const { error: updateError } = await supabaseDb.from('zones').update({ loi_id: loiId }).eq('id', zone.id)
      if (updateError) throw new Error(`Failed updating zone LOI link for ${zone.name}: ${updateError.message}`)
    }
    zoneMap.set(key, { id: zone.id, loi_id: loiId })
  }

  return zoneMap
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 Data Fetching
// ─────────────────────────────────────────────────────────────────────────────

async function fetchS3Object(bucket, key) {
  if (!AWS_ACCESS_KEY || !AWS_SECRET_KEY) {
    console.warn(`⚠️  AWS credentials not configured. Returning empty dataset for ${key}`)
    return null
  }

  try {
    const s3Client = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY,
        secretAccessKey: AWS_SECRET_KEY,
      },
    })

    const command = new GetObjectCommand({ Bucket: bucket, Key: key })
    const response = await s3Client.send(command)
    const sdkStream = sdkStreamMixin(response.Body)
    const chunks = []

    for await (const chunk of sdkStream) {
      chunks.push(chunk)
    }

    return Buffer.concat(chunks)
  } catch (err) {
    console.error(`❌ Failed to fetch S3 object ${bucket}/${key}: ${err.message}`)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Parsing
// ─────────────────────────────────────────────────────────────────────────────

async function parseDeputyCSV() {
  // Prioritize local file if provided
  if (LOCAL_CSV_PATH) {
    try {
      const fs = await import('fs').then(m => m.promises)
      await fs.access(LOCAL_CSV_PATH)
      console.log(`📥 Reading Deputy roster CSV from local file: ${LOCAL_CSV_PATH}`)
      const buffer = await fs.readFile(LOCAL_CSV_PATH)
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet)
      console.log(`✅ Parsed ${rows.length} Deputy roster rows from local file`)
      return rows
    } catch (err) {
      console.warn(`⚠️  Local file not found or unreadable: ${LOCAL_CSV_PATH}`)
      // Try to download from Supabase Storage
      const ok = await downloadDeputyFromSupabaseStorage(LOCAL_CSV_PATH)
      if (ok) {
        // Try reading again
        try {
          const fs = await import('fs').then(m => m.promises)
          const buffer = await fs.readFile(LOCAL_CSV_PATH)
          const workbook = XLSX.read(buffer, { type: 'buffer' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const rows = XLSX.utils.sheet_to_json(sheet)
          console.log(`✅ Parsed ${rows.length} Deputy roster rows from Supabase Storage`)
          return rows
        } catch (err2) {
          console.error(`❌ Failed to read Deputy CSV after download: ${err2.message}`)
          return []
        }
      } else {
        return []
      }
    }
  }

  // If no --file, try to download to default path
  const fallbackPath = './deputy-data.csv'
  const ok = await downloadDeputyFromSupabaseStorage(fallbackPath)
  if (ok) {
    try {
      const fs = await import('fs').then(m => m.promises)
      const buffer = await fs.readFile(fallbackPath)
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet)
      console.log(`✅ Parsed ${rows.length} Deputy roster rows from Supabase Storage`)
      return rows
    } catch (err) {
      console.error(`❌ Failed to read Deputy CSV after download: ${err.message}`)
      return []
    }
  }

  // Fall back to S3 if AWS credentials available
  console.log(`📥 Fetching Deputy roster CSV from S3: ${SOURCE.bucket}/${SOURCE.deputyPath}`)
  const buffer = await fetchS3Object(SOURCE.bucket, SOURCE.deputyPath)
  if (!buffer) {
    console.warn('⚠️  Could not fetch Deputy CSV from S3; using empty dataset')
    console.warn('💡 Tip: Use --file /path/to/deputy.csv to import from a local file')
    return []
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`✅ Parsed ${rows.length} Deputy roster rows from S3`)
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Organization
// ─────────────────────────────────────────────────────────────────────────────

function collectStaffUnique(rows) {
  const staffByEmail = new Map()
  const staffByCode = new Map()

  for (const row of rows) {
    const email = toTrimmedString(row['Email']).toLowerCase()
    const code = toTrimmedString(row['Code'])
    const displayName = row['Display Name'] || ''

    if (email && !staffByEmail.has(email)) {
      staffByEmail.set(email, {
        displayName,
        email,
        code,
        phone: row['Phone'] || '',
        position: row['Position'] || '',
        payCenter: row['Pay Center'] || '',
        raw: row,
      })
    }

    if (code && !staffByCode.has(code)) {
      staffByCode.set(code, staffByEmail.get(email))
    }
  }

  return { staffByEmail, staffByCode }
}

function collectLocationsUnique(rows) {
  const locationsByCode = new Map()
  const locationsByName = new Map()

  for (const row of rows) {
    const locCode = toTrimmedString(row['Location Code'] || row['Code'])
    const locName = toTrimmedString(row['Location Name'] || row['Area Name'] || row['Location'])
    const locAddress = toTrimmedString(row['Location Address'] || row['Address'])
    const serviceType = pickServiceType(row)

    if (locCode && !locationsByCode.has(locCode)) {
      locationsByCode.set(locCode, {
        code: locCode,
        name: locName,
        address: locAddress,
        gpsLat: row['Latitude'] ? Number(row['Latitude']) : null,
        gpsLng: row['Longitude'] ? Number(row['Longitude']) : null,
        serviceType,
        serviceDomains: pickServiceDomains(serviceType),
      })
    }

    if (locName && !locationsByName.has(locName)) {
      locationsByName.set(locName, locationsByCode.get(locCode))
    }
  }

  return { locationsByCode, locationsByName }
}

function buildRosterShifts(nccOrgId, rows, staffByEmail, locationsByCode) {
  const shifts = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const email = normalizeKey(row['Email'])
    const locCode = toTrimmedString(row['Location Code'] || row['Code'])
    const schedDate = row['Schedule Date'] || row['Timesheet Date'] || row['Date Start'] || ''
    const startTime = row['Schedule Start Time'] || row['Timesheet Start Time'] || row['Time Start'] || ''
    const endTime = row['Schedule End Time'] || row['Timesheet End Time'] || row['Time End'] || ''

    if (!email || !locCode || !schedDate) continue

    const staff = staffByEmail.get(email)
    const location = locationsByCode.get(locCode)

    if (!staff || !location) {
      if (VERBOSE) console.log(`⚠️  Skipping row ${i}: staff or location not found`)
      continue
    }

    const rosterKey = makeRosterKey(row, i)
    const serviceType = location.serviceType
    const shiftDate = parseShiftDate(schedDate)
    const startDateTime = parseShiftDateTime(schedDate, startTime)
    const endDateTime = parseShiftDateTime(schedDate, endTime)

    shifts.push({
      key: rosterKey,
      row: {
        organization_id: nccOrgId,
        shift_date: shiftDate,
        start_time: startDateTime,
        end_time: endDateTime,
        break_minutes: 0,
        position_title: row['Position'] || 'Unknown',
        required_skills: [],
        status: 'published',
        shift_type: 'custom',
        service_type: serviceType,
        officer_response: null,
        deputy_schedule_id: rosterKey,
        deputy_area_name: toTrimmedString(row['Area'] || row['Area Name'] || ''),
        deputy_location_name: location.name,
        location_code: locCode,
        area_export_code: toTrimmedString(row['Area Export Code'] || row['Area Export'] || ''),
        schedule_warning: toTrimmedString(row['Schedule Warning'] || ''),
        schedule_cost: row['Schedule Cost'] ? Number(row['Schedule Cost']) : null,
        pay_period_name: toTrimmedString(row['Pay Period'] || ''),
        deputy_approved: String(row['Approved'] || '').toLowerCase() === 'true',
        deputy_imported_at: new Date().toISOString(),
        notes: `[DEPUTY_IMPORT:${rosterKey}] ${location.name}`,
      },
      staff,
      location,
    })
  }

  return shifts
}

function parseShiftDate(dateStr) {
  // Handle Excel serial dates and ISO strings
  if (typeof dateStr === 'number') {
    const excelEpoch = new Date(1899, 11, 30)
    const msPerDay = 24 * 60 * 60 * 1000
    return new Date(excelEpoch.getTime() + dateStr * msPerDay).toISOString().split('T')[0]
  }

  if (typeof dateStr === 'string') {
    // Try parsing YYYY-MM-DD or common date formats
    const match = dateStr.match(/(\d{4})-?(\d{2})-?(\d{2})/)
    if (match) return `${match[1]}-${match[2]}-${match[3]}`
  }

  return new Date().toISOString().split('T')[0]
}

function parseShiftDateTime(dateStr, timeStr) {
  const dateValue = parseShiftDate(dateStr)
  if (!dateValue) return null
  const match = toTrimmedString(timeStr).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return null
  const hours = String(Number(match[1])).padStart(2, '0')
  const minutes = String(Number(match[2])).padStart(2, '0')
  return `${dateValue}T${hours}:${minutes}:00.000Z`
}

function toTrimmedString(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Lookups & Inserts
// ─────────────────────────────────────────────────────────────────────────────

async function ensureUserProfiles(nccOrgId, staffList) {
  const result = {
    created: 0,
    existing: 0,
    byEmail: new Map(),
    byCode: new Map(),
  }

  for (const staff of staffList.values()) {
    const { displayName, email, code, phone, position } = staff

    // Lookup by email
    const { data: existing } = await supabaseDb
      .from('user_profiles')
      .select('id')
      .eq('organization_id', nccOrgId)
      .eq('email', email)
      .single()

    if (existing?.id) {
      result.existing += 1
      result.byEmail.set(email, existing.id)
      result.byCode.set(code, existing.id)
      continue
    }

    if (!APPLY) {
      result.byEmail.set(email, `PLACEHOLDER_${crypto.randomUUID()}`)
      result.byCode.set(code, `PLACEHOLDER_${crypto.randomUUID()}`)
      continue
    }

    // Create user profile
    const { data: created, error: insertError } = await supabaseDb
      .from('user_profiles')
      .insert({
        organization_id: nccOrgId,
        display_name: displayName,
        email,
        phone: phone || null,
        role: 'officer', // Default role
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError || !created?.id) {
      console.error(`❌ Failed creating user profile for ${email}: ${insertError?.message}`)
      continue
    }

    result.created += 1
    result.byEmail.set(email, created.id)
    result.byCode.set(code, created.id)
  }

  return result
}

async function ensureClientSites(nccOrgId, locationsByCode) {
  const result = {
    created: 0,
    existing: 0,
    byCode: new Map(),
  }

  for (const [locCode, location] of locationsByCode) {
    const { data: existing } = await supabaseDb
      .from('client_sites')
      .select('id')
      .eq('organization_id', nccOrgId)
      .eq('name', location.name)
      .single()

    if (existing?.id) {
      result.existing += 1
      result.byCode.set(locCode, existing.id)
      continue
    }

    if (!APPLY) {
      result.byCode.set(locCode, `PLACEHOLDER_${crypto.randomUUID()}`)
      continue
    }

    // Create client site
    const { data: created, error: insertError } = await supabaseDb
      .from('client_sites')
      .insert({
        organization_id: nccOrgId,
        name: location.name,
        address: location.address || location.name || locCode,
        gps_lat: -41.2865,
        gps_lng: 172.0833,
        zone_id: null,
        site_type: 'general',
        default_pay_rate: 25.0,
        default_charge_rate: 45.0,
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError || !created?.id) {
      console.error(`❌ Failed creating client site for ${location.name}: ${insertError?.message}`)
      continue
    }

    result.created += 1
    result.byCode.set(locCode, created.id)
  }

  return result
}

async function ensureZones(nccOrgId) {
  const result = {
    byCode: new Map(),
  }

  for (const [code, name] of Object.entries(ZONE_BY_CODE)) {
    const { data: existing } = await supabaseDb
      .from('zones')
      .select('id')
      .eq('organization_id', nccOrgId)
      .eq('name', name)
      .single()

    if (existing?.id) {
      result.byCode.set(code, existing.id)
    }
  }

  return result
}

async function insertRosterShifts(shifts, userProfileIds, clientSiteIds, zoneIds, apply) {
  const result = {
    pending: 0,
    inserted: 0,
    failed: 0,
  }

  for (const shift of shifts) {
    const officerId = userProfileIds.byEmail.get(shift.staff.email)
    const clientSiteId = clientSiteIds.get(shift.location.code) || clientSiteIds.get(normalizeKey(shift.location.name))
    const zoneId = zoneIds.get(shift.location.code) || zoneIds.get(normalizeKey(shift.location.name)) || null

    if (!officerId || !clientSiteId) {
      result.pending += 1
      continue
    }

    const payload = {
      ...shift.row,
      officer_id: officerId,
      client_site_id: clientSiteId,
      zone_id: zoneId,
    }

    if (!apply) {
      result.pending += 1
      continue
    }

    const { error: insertError } = await supabaseDb
      .from('roster_shifts')
      .upsert(payload, { onConflict: 'organization_id,deputy_schedule_id' })

    if (insertError) {
      if (insertError.code === '23505') {
        result.pending += 1 // Already exists (unique constraint)
      } else {
        console.error(`❌ Failed inserting roster shift: ${insertError.message}`)
        result.failed += 1
      }
    } else {
      result.inserted += 1
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════════════════════════')
  console.log('📋 Deputy Nelson Roster Import')
  console.log('════════════════════════════════════════════════════════════════\n')
  console.log(`Mode: ${APPLY ? '💾 APPLY' : '📊 DRY-RUN'}\n`)

  const targetOrg = await resolveOrganizationByName(TARGET_ORG_NAME)
  const nccOrgId = targetOrg.id

  // Parse CSV
  const deputyRows = await parseDeputyCSV()
  if (deputyRows.length === 0) {
    console.log('⚠️  No Deputy roster data found. Exiting.')
    process.exit(0)
  }

  // Organize data
  const { staffByEmail, staffByCode } = collectStaffUnique(deputyRows)
  const { locationsByCode, locationsByName } = collectLocationsUnique(deputyRows)
  const shifts = buildRosterShifts(nccOrgId, deputyRows, staffByEmail, locationsByCode)

  console.log(`📊 Data Organization:`)
  console.log(`   • Unique staff: ${staffByEmail.size}`)
  console.log(`   • Unique locations: ${locationsByCode.size}`)
  console.log(`   • Roster shifts: ${shifts.length}\n`)

  const loiMaps = await loadExistingLoiMaps(nccOrgId)
  const zoneMaps = await ensureZoneLois(nccOrgId, APPLY)
  const clientSiteIds = new Map()

  for (const [locCode, location] of locationsByCode) {
    const loiId = await ensureLocationLoi(nccOrgId, location, loiMaps, APPLY)
    const zoneId = zoneMaps.get(normalizeKey(location.name))?.id || null
    const existingSite = await supabaseDb
      .from('client_sites')
      .select('id, loi_id, zone_id')
      .eq('organization_id', nccOrgId)
      .or(`site_code.eq.${locCode},name.eq.${location.name}`)
      .limit(1)

    if (existingSite.error) {
      throw new Error(`Failed loading client site for ${location.name}: ${existingSite.error.message}`)
    }

    const siteRow = existingSite.data?.[0] || null
    const sitePayload = buildClientSitePayload(nccOrgId, location, loiId, zoneId || siteRow?.zone_id || null)

    if (siteRow?.id) {
      clientSiteIds.set(locCode, siteRow.id)
      clientSiteIds.set(normalizeKey(location.name), siteRow.id)
      if (APPLY) {
        const { error: updateError } = await supabaseDb.from('client_sites').update(sitePayload).eq('id', siteRow.id)
        if (updateError) throw new Error(`Failed updating client site ${location.name}: ${updateError.message}`)
      }
      continue
    }

    if (APPLY) {
      const { data: created, error: createError } = await supabaseDb
        .from('client_sites')
        .insert(sitePayload)
        .select('id')
        .single()
      if (createError || !created?.id) {
        throw new Error(`Failed creating client site ${location.name}: ${createError?.message || 'missing id'}`)
      }
      clientSiteIds.set(locCode, created.id)
      clientSiteIds.set(normalizeKey(location.name), created.id)
    } else {
      clientSiteIds.set(locCode, `PLACEHOLDER_${locCode}`)
      clientSiteIds.set(normalizeKey(location.name), `PLACEHOLDER_${locCode}`)
    }
  }

  console.log(`   • LOIs resolved: ${loiMaps.rows.length}`)
  console.log(`   • Client sites mapped: ${clientSiteIds.size}`)
  console.log(`   • Zones mapped: ${zoneMaps.size}\n`)

  // Ensure user profiles
  console.log(`👤 Ensuring user profiles...`)
  const userProfileIds = await ensureUserProfiles(nccOrgId, staffByEmail)
  console.log(`   • Created: ${userProfileIds.created}`)
  console.log(`   • Existing: ${userProfileIds.existing}\n`)

  // Insert roster shifts
  console.log(`📅 Inserting roster shifts...`)
  const rosterResult = await insertRosterShifts(shifts, userProfileIds, clientSiteIds, zoneMaps, APPLY)
  console.log(`   • Pending: ${rosterResult.pending}`)
  console.log(`   • Inserted: ${rosterResult.inserted}`)
  console.log(`   • Failed: ${rosterResult.failed}\n`)

  // Summary
  console.log('════════════════════════════════════════════════════════════════')
  console.log(`${APPLY ? '✅ IMPORT COMPLETE' : '✅ DRY-RUN COMPLETE'} - Deputy roster data processed`)
  console.log('════════════════════════════════════════════════════════════════\n')

  process.exit(0)
}

main().catch((err) => {
  console.error(`❌ Fatal error: ${err.message}`)
  process.exit(1)
})
