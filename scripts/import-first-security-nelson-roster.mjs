#!/usr/bin/env node

import fs from 'node:fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const HELP_TEXT = `
Import First Security Nelson Deputy roster data into roster_shifts and location anchors.

Usage:
  node scripts/import-first-security-nelson-roster.mjs [--apply]

Options:
  --apply   Write to database. Omit for dry-run.
`

const SOURCE = {
  bucket: 'Service-Contracts',
  path: 'Deputy-Data/Deputy data.csv',
}

const DEFAULT_ZONE_CODES = ['582', '584', '585', '586', '587']

const ZONE_CENTER_BY_CODE = {
  '582': { lat: -41.285, lng: 173.244 },
  '584': { lat: -41.252, lng: 173.301 },
  '585': { lat: -41.2706, lng: 173.284 },
  '586': { lat: -41.333, lng: 173.183 },
  '587': { lat: -41.220, lng: 173.318 },
}

function parseArgs(argv) {
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    apply: argv.includes('--apply'),
  }
}

function loadEnv() {
  for (const file of ['.env.local', '.env', '.env.development.local', '.env.development']) {
    if (fs.existsSync(file)) dotenv.config({ path: file, override: false })
  }
}

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase()
}

function stableHash(input) {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0)
}

function parseRowsFromBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

function parseNzDate(text) {
  const t = normalizeText(text)
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const dd = Number(m[1])
  const mm = Number(m[2])
  let yyyy = Number(m[3])
  if (yyyy < 100) yyyy += 2000
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null
  return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

function parseNzDateTime(dateText, timeText) {
  const day = parseNzDate(dateText)
  if (!day) return null
  const m = normalizeText(timeText).match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return `${day}T08:00:00+13:00`
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return `${day}T08:00:00+13:00`
  return `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+13:00`
}

function extractZoneCodeFromText(...values) {
  const corpus = values.map(normalizeText).join(' ')
  const m = corpus.match(/\b(582|584|585|586|587)\b/)
  return m ? m[1] : null
}

function classifyRosterServiceType(row) {
  const corpus = [
    row['Area Name'],
    row['Position'],
    row['Schedule Notes'],
    row['Location Name'],
    row['Location Name_1'],
    row['Code'],
  ].map(normalizeText).join(' ').toLowerCase()

  if (corpus.includes('noise')) return 'noise'
  if (corpus.includes('parking')) return 'parking'
  if (corpus.includes('ems')) return 'ems'
  if (corpus.includes('patrol')) return 'patrol'
  return 'guarding'
}

function buildRosterKey(row, locationName, shiftDate, startAt, endAt) {
  const officer = normalizeText(row['Display Name']) || normalizeText(row['Email']) || 'unknown'
  const code = normalizeText(row['Code']) || normalizeText(row['Location Code']) || 'na'
  const raw = [officer, code, locationName || 'na', shiftDate || 'na', startAt || 'na', endAt || 'na'].join('|')
  return `dep-${stableHash(raw)}`
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function getOrganizationByName(supabase, name) {
  const { data, error } = await supabase.from('organizations').select('id,name,parent_organization_id').eq('name', name).maybeSingle()
  if (error) throw new Error(`Failed loading organization ${name}: ${error.message}`)
  return data || null
}

async function fetchExistingRosterKeys(supabase, nccOrgId) {
  const out = new Set()
  let from = 0
  const size = 1000

  while (true) {
    const { data, error } = await supabase
      .from('roster_shifts')
      .select('notes')
      .eq('organization_id', nccOrgId)
      .like('notes', '%[DEPUTY_ROSTER_KEY:%')
      .range(from, from + size - 1)

    if (error) throw new Error(`Failed loading existing roster keys: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      const note = normalizeText(row.notes)
      const m = note.match(/\[DEPUTY_ROSTER_KEY:([^\]]+)\]/)
      if (m) out.add(m[1])
    }

    if (data.length < size) break
    from += size
  }

  return out
}

async function fetchUsersByOrg(supabase, _orgIds) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id,email,first_name,last_name,organization_id,employer_organization_id')

  if (error) throw new Error(`Failed loading users for org: ${error.message}`)

  const byEmail = new Map()
  const byName = new Map()

  for (const user of data || []) {
    const email = normalizeKey(user.email)
    if (email) byEmail.set(email, user.id)
    const nameKey = normalizeKey(`${user.first_name || ''} ${user.last_name || ''}`)
    if (nameKey) byName.set(nameKey, user.id)
  }

  return { byEmail, byName }
}

async function assignOfficersToExistingDeputyShifts(supabase, nccOrgId, users, apply) {
  let relinked = 0
  let unresolved = 0
  let from = 0
  const size = 500

  while (true) {
    const { data, error } = await supabase
      .from('roster_shifts')
      .select('id,notes,officer_id')
      .eq('organization_id', nccOrgId)
      .like('notes', '%[DEPUTY_ROSTER_KEY:%')
      .is('officer_id', null)
      .range(from, from + size - 1)

    if (error) throw new Error(`Failed loading existing unassigned deputy shifts: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      const notes = normalizeText(row.notes)
      const staffMatch = notes.match(/\[STAFF:([^\]]+)\]/)
      const staffNameRaw = normalizeText(staffMatch?.[1])
      const staffName = staffNameRaw.replace(/^\([^\)]*\)\s*/g, '').replace(/\[[^\]]*\]/g, '').trim()
      const officerId = users.byName.get(normalizeKey(staffName)) || null

      if (!officerId) {
        unresolved += 1
        continue
      }

      if (apply) {
        const { error: updateError } = await supabase.from('roster_shifts').update({ officer_id: officerId }).eq('id', row.id)
        if (updateError) throw new Error(`Failed relinking roster shift ${row.id}: ${updateError.message}`)
      }
      relinked += 1
    }

    if (data.length < size) break
    from += size
  }

  return { relinked, unresolved }
}

async function fetchZonesByCode(supabase, nccOrgId) {
  const map = new Map()
  const { data, error } = await supabase
    .from('zones')
    .select('id,name,description')
    .eq('organization_id', nccOrgId)

  if (error) throw new Error(`Failed loading zones: ${error.message}`)

  for (const z of data || []) {
    const code = extractZoneCodeFromText(z.name, z.description)
    if (code) map.set(code, z.id)
  }

  return map
}

async function fetchExistingLois(supabase, nccOrgId) {
  const map = new Map()
  let from = 0
  const size = 1000

  while (true) {
    const { data, error } = await supabase
      .from('locations_of_interest')
      .select('id,name,display_address,address_full')
      .eq('organization_id', nccOrgId)
      .range(from, from + size - 1)

    if (error) throw new Error(`Failed loading LOI rows: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      const k = normalizeKey(row.name)
      if (k && !map.has(k)) map.set(k, row.id)
    }

    if (data.length < size) break
    from += size
  }

  return map
}

async function fetchExistingClientSites(supabase, nccOrgId) {
  const byName = new Map()
  const { data, error } = await supabase
    .from('client_sites')
    .select('id,name,site_code,zone_id')
    .eq('organization_id', nccOrgId)

  if (error) throw new Error(`Failed loading client_sites: ${error.message}`)

  for (const row of data || []) {
    const k = normalizeKey(row.name)
    if (k && !byName.has(k)) byName.set(k, row)
  }

  return byName
}

async function ensureOfficeLocationsAvailable(supabase) {
  const probe = await supabase.from('office_locations').select('id').limit(1)
  if (!probe.error) return true
  return !String(probe.error.message || '').includes("Could not find the table 'public.office_locations'")
}

async function ensureLocationAnchors(supabase, nccOrgId, locationRecords, zoneByCode, apply) {
  const existingLoi = await fetchExistingLois(supabase, nccOrgId)
  const existingSites = await fetchExistingClientSites(supabase, nccOrgId)
  const officeLocationsAvailable = await ensureOfficeLocationsAvailable(supabase)

  let loisCreated = 0
  let sitesCreated = 0
  let sitesUpdated = 0
  let officesCreated = 0

  const loiByLocation = new Map()
  const siteByLocation = new Map()

  for (const rec of locationRecords) {
    const name = normalizeText(rec.locationName)
    if (!name) continue
    const key = normalizeKey(name)
    const zoneCode = rec.zoneCode || null
    const zoneId = zoneCode ? zoneByCode.get(zoneCode) || null : null
    const center = zoneCode ? (ZONE_CENTER_BY_CODE[zoneCode] || ZONE_CENTER_BY_CODE['585']) : ZONE_CENTER_BY_CODE['585']

    let loiId = existingLoi.get(key) || null
    if (!loiId && apply) {
      const payload = {
        organization_id: nccOrgId,
        name,
        description: `Deputy roster location import (${SOURCE.bucket}/${SOURCE.path})`,
        loi_kind: 'poi',
        address_full: name,
        display_address: name,
        city: 'Nelson',
        region: 'Tasman',
        country: 'NZ',
        gps_lat: center?.lat || null,
        gps_lng: center?.lng || null,
        geocoder_source: 'manual',
      }
      const { data: inserted, error } = await supabase
        .from('locations_of_interest')
        .insert(payload)
        .select('id')
        .single()
      if (error || !inserted?.id) throw new Error(`Failed creating LOI for ${name}: ${error?.message || 'Unknown error'}`)
      loiId = inserted.id
      existingLoi.set(key, loiId)
      loisCreated += 1
    }

    if (loiId) loiByLocation.set(key, loiId)

    const currentSite = existingSites.get(key) || null
    if (currentSite?.id) {
      siteByLocation.set(key, currentSite.id)

      if (apply && (loiId || zoneId)) {
        const updatePayload = {}
        if (loiId) updatePayload.loi_id = loiId
        if (zoneId && !currentSite.zone_id) updatePayload.zone_id = zoneId
        if (Object.keys(updatePayload).length) {
          const { error } = await supabase.from('client_sites').update(updatePayload).eq('id', currentSite.id)
          if (!error) sitesUpdated += 1
        }
      }
    }

    if (officeLocationsAvailable && apply) {
      const { data: existingOffice, error: officeLookupError } = await supabase
        .from('office_locations')
        .select('id')
        .eq('organization_id', nccOrgId)
        .eq('name', name)
        .maybeSingle()
      if (officeLookupError) throw new Error(`Failed loading office_locations for ${name}: ${officeLookupError.message}`)

      if (!existingOffice?.id) {
        const { error: officeInsertError } = await supabase
          .from('office_locations')
          .insert({
            organization_id: nccOrgId,
            name,
            address: name,
            latitude: center?.lat || null,
            longitude: center?.lng || null,
            is_primary: false,
            is_active: true,
            notes: 'Imported from Deputy roster locations',
          })
        if (officeInsertError) throw new Error(`Failed creating office_location for ${name}: ${officeInsertError.message}`)
        officesCreated += 1
      }
    }
  }

  // Ensure all existing client sites in this org are LOI-linked where possible.
  if (apply) {
    for (const site of existingSites.values()) {
      const siteNameKey = normalizeKey(site.name)
      if (!site?.id || !siteNameKey) continue
      const loiId = existingLoi.get(siteNameKey) || null
      if (!loiId) continue
      const { error } = await supabase.from('client_sites').update({ loi_id: loiId }).eq('id', site.id).is('loi_id', null)
      if (!error) sitesUpdated += 1
    }
  }

  return {
    loisCreated,
    sitesCreated,
    sitesUpdated,
    officesCreated,
    officeLocationsAvailable,
    loiByLocation,
    siteByLocation,
  }
}

function buildRosterRows(rows, nccOrgId, zoneByCode, users, siteByLocation) {
  const out = []
  let userMatched = 0
  let userUnmatched = 0

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    const shiftDate = parseNzDate(r['Schedule Date'] || r['Date Start'])
    const startAt = parseNzDateTime(r['Schedule Date'] || r['Date Start'], r['Schedule Start Time'] || r['Time Start'])
    let endAt = parseNzDateTime(r['Schedule Date'] || r['Date End'] || r['Date Start'], r['Schedule End Time'] || r['Time End'])

    if (!shiftDate || !startAt) continue

    const locationName = normalizeText(r['Location Name_1'] || r['Location Name'])
    const locationCode = normalizeText(r['Code'] || r['Location Code'])
    const areaName = normalizeText(r['Area Name'])
    const zoneCode = extractZoneCodeFromText(locationName, locationCode, areaName)
    const zoneId = zoneCode ? zoneByCode.get(zoneCode) || null : null
    const siteId = siteByLocation.get(normalizeKey(locationName)) || null

    const serviceType = classifyRosterServiceType(r)
    const displayName = normalizeText(r['Display Name'])
    const email = normalizeText(r['Email'])
    const nameMatch = displayName
      .replace(/^\([^\)]*\)\s*/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .trim()

    const officerId = users.byEmail.get(normalizeKey(email)) || users.byName.get(normalizeKey(nameMatch)) || null
    if (officerId) userMatched += 1
    else userUnmatched += 1

    if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) {
      const endDate = new Date(Date.parse(endAt) + 24 * 60 * 60 * 1000)
      endAt = endDate.toISOString()
    }

    const key = buildRosterKey(r, locationName, shiftDate, startAt, endAt)
    const notes = [
      `[DEPUTY_ROSTER_KEY:${key}]`,
      `[SOURCE:${SOURCE.bucket}/${SOURCE.path}]`,
      displayName ? `[STAFF:${displayName}]` : null,
      locationCode ? `[LOC_CODE:${locationCode}]` : null,
      areaName ? `[AREA:${areaName}]` : null,
      normalizeText(r['Schedule Notes']) || null,
    ].filter(Boolean).join(' ')

    out.push({
      key,
      row: {
        organization_id: nccOrgId,
        officer_id: officerId,
        client_site_id: siteId,
        zone_id: zoneId,
        shift_date: shiftDate,
        shift_type: 'custom',
        start_time: startAt,
        end_time: endAt,
        status: 'published',
        service_type: serviceType,
        position_title: normalizeText(r['Position']) || 'Rostered Shift',
        notes,
      },
    })
  }

  return { rows: out, userMatched, userUnmatched }
}

async function insertBatches(supabase, table, rows, batchSize) {
  let inserted = 0
  let failed = 0
  const errors = []

  for (const part of chunk(rows, batchSize)) {
    const { error } = await supabase.from(table).insert(part)
    if (!error) {
      inserted += part.length
      continue
    }

    for (const row of part) {
      const single = await supabase.from(table).insert(row)
      if (!single.error) inserted += 1
      else {
        failed += 1
        errors.push(single.error.message || 'Unknown insert error')
      }
    }
  }

  return { inserted, failed, errors }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  loadEnv()

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL (or equivalent) and SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const dryRun = !args.apply

  const fsNelson = await getOrganizationByName(supabase, 'First Security - Nelson')
  const ncc = await getOrganizationByName(supabase, 'Nelson City Council')
  if (!fsNelson?.id) throw new Error('Organization not found: First Security - Nelson')
  if (!ncc?.id) throw new Error('Organization not found: Nelson City Council')

  const { data: rosterBlob, error: rosterDownloadError } = await supabase.storage.from(SOURCE.bucket).download(SOURCE.path)
  if (rosterDownloadError || !rosterBlob) {
    throw new Error(`Failed downloading ${SOURCE.bucket}/${SOURCE.path}: ${rosterDownloadError?.message || 'Unknown error'}`)
  }

  const rosterRowsRaw = parseRowsFromBuffer(Buffer.from(await rosterBlob.arrayBuffer()))
  const users = await fetchUsersByOrg(supabase, [ncc.id, fsNelson.id])
  const zoneByCode = await fetchZonesByCode(supabase, ncc.id)

  const locationRecords = []
  const seenLocations = new Set()
  for (const r of rosterRowsRaw) {
    const locationName = normalizeText(r['Location Name_1'] || r['Location Name'])
    if (!locationName) continue
    const k = normalizeKey(locationName)
    if (seenLocations.has(k)) continue
    seenLocations.add(k)
    locationRecords.push({
      locationName,
      locationCode: normalizeText(r['Code'] || r['Location Code']),
      areaName: normalizeText(r['Area Name']),
      zoneCode: extractZoneCodeFromText(r['Location Name_1'], r['Location Name'], r['Code'], r['Location Code'], r['Area Name']),
    })
  }

  const existingRosterKeys = await fetchExistingRosterKeys(supabase, ncc.id)
  const anchors = await ensureLocationAnchors(supabase, ncc.id, locationRecords, zoneByCode, args.apply)
  const rosterBuilt = buildRosterRows(rosterRowsRaw, ncc.id, zoneByCode, users, anchors.siteByLocation)

  const rosterPending = rosterBuilt.rows.filter((x) => !existingRosterKeys.has(x.key))

  let rosterResult = { inserted: 0, failed: 0, errors: [] }
  let relinkResult = { relinked: 0, unresolved: 0 }
  if (!dryRun) {
    rosterResult = await insertBatches(supabase, 'roster_shifts', rosterPending.map((x) => x.row), 250)
    relinkResult = await assignOfficersToExistingDeputyShifts(supabase, ncc.id, users, true)
  }

  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    organization: { id: ncc.id, name: ncc.name },
    source: { bucket: SOURCE.bucket, file: SOURCE.path },
    staff_mapping: {
      matched_existing_users: rosterBuilt.userMatched,
      unmatched_staff_rows: rosterBuilt.userUnmatched,
      existing_unassigned_relinked: relinkResult.relinked,
      existing_unassigned_unresolved: relinkResult.unresolved,
      policy: 'Staff are mapped to user_profiles only; no POI writes are performed.',
    },
    locations: {
      unique_from_roster: locationRecords.length,
      lois_created: anchors.loisCreated,
      client_sites_created: anchors.sitesCreated,
      client_sites_updated: anchors.sitesUpdated,
      office_locations_available: anchors.officeLocationsAvailable,
      office_locations_created: anchors.officesCreated,
    },
    roster_shifts: {
      source_rows: rosterRowsRaw.length,
      candidates: rosterBuilt.rows.length,
      existing_matches: existingRosterKeys.size,
      pending: rosterPending.length,
      inserted: rosterResult.inserted,
      failed: rosterResult.failed,
      error_sample: rosterResult.errors.slice(0, 10),
    },
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
