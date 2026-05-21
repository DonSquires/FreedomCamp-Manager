#!/usr/bin/env node

import fs from 'node:fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const HELP_TEXT = `
Import First Security Nelson historical Wilsar files into patrols and alarm_events.

Usage:
  node scripts/import-first-security-nelson-historical.mjs [--apply]

Options:
  --apply   Write to database. Omit for dry-run.
`

const SOURCE = {
  bucket: 'Service-Contracts',
  patrolPath: 'Wilsar-Data/Nelson Patrol Historical data.csv',
  alarmPath: 'Wilsar-Data/Nelsn Alarm-Noise control historical data.csv',
}

const DEFAULT_ZONE_CODES = ['582', '584', '585', '586', '587']
const UNMAPPED_ZONE_CODE = 'UNMAPPED'

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

function normalizeEventPlateSeed(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim()
}

function stableHash(input) {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0)
}

function buildEventPlate(seed, fallbackPrefix = 'NCCE') {
  const normalized = normalizeEventPlateSeed(seed)
  if (normalized.length >= 2 && normalized.length <= 10) return normalized
  const suffix = String(stableHash(seed || 'event')).slice(0, 6)
  return `${fallbackPrefix}${suffix}`.slice(0, 10)
}

function normalizeStatus(value) {
  const v = normalizeText(value).toLowerCase()
  if (v.includes('complete')) return 'completed'
  if (v.includes('miss')) return 'cancelled'
  if (v.includes('active') || v.includes('progress')) return 'active'
  return 'completed'
}

function parseNzDateTime(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw < 100000) {
    const millis = Date.UTC(1899, 11, 30) + Math.floor(raw) * 24 * 60 * 60 * 1000
    const d = new Date(millis)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    const day = d.getUTCDate()
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T08:00:00+13:00`
  }

  const text = normalizeText(raw)
  if (!text) return null

  const serial = text.match(/^(\d{4,6})(?:\.\d+)?$/)
  if (serial) {
    const n = Number(serial[1])
    if (Number.isFinite(n) && n > 0 && n < 100000) {
      const millis = Date.UTC(1899, 11, 30) + Math.floor(n) * 24 * 60 * 60 * 1000
      const d = new Date(millis)
      const y = d.getUTCFullYear()
      const m = d.getUTCMonth() + 1
      const day = d.getUTCDate()
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T08:00:00+13:00`
    }
  }

  const nz = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (nz) {
    const dd = Number(nz[1])
    const mm = Number(nz[2])
    let yyyy = Number(nz[3])
    const hh = Number(nz[4] || '8')
    const min = Number(nz[5] || '0')
    if (yyyy < 100) yyyy += 2000
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && hh >= 0 && hh <= 23 && min >= 0 && min <= 59) {
      return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+13:00`
    }
  }

  if (/[-/:T\s]/.test(text)) {
    const d = new Date(text)
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear()
      const m = d.getUTCMonth() + 1
      const day = d.getUTCDate()
      const hh = d.getUTCHours()
      const min = d.getUTCMinutes()
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+13:00`
    }
  }

  return null
}

function parseRowsFromBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

function extractZoneCode(row) {
  const candidates = [
    row['Despatch Zone'],
    row['Dispatch Zone'],
    row['Despatch Zone / Subcontractor'],
    row['Dispatch Zone / Subcontractor'],
  ]
  for (const c of candidates) {
    const m = normalizeText(c).match(/\b(\d{3})\b/)
    if (m) return m[1]
  }
  return null
}

function collectZoneCodes(rows) {
  const codes = new Set(DEFAULT_ZONE_CODES)
  for (const row of rows) {
    const code = extractZoneCode(row)
    if (code) codes.add(code)
  }
  codes.add(UNMAPPED_ZONE_CODE)
  return [...codes]
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function buildSquareGeometry(center, dLat = 0.04, dLng = 0.05) {
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

async function getOrganizationByName(supabase, name) {
  const { data, error } = await supabase.from('organizations').select('id,name,parent_organization_id').eq('name', name).maybeSingle()
  if (error) throw new Error(`Failed loading organization ${name}: ${error.message}`)
  return data || null
}

async function ensureNelsonZones(supabase, nccOrgId, apply, requiredCodes) {
  const { data: existing, error } = await supabase
    .from('zones')
    .select('id,name,description,loi_id')
    .eq('organization_id', nccOrgId)

  if (error) throw new Error(`Failed loading NCC zones: ${error.message}`)

  const byCode = new Map()
  const loiByCode = new Map()
  for (const z of existing || []) {
    const text = `${z.name || ''} ${z.description || ''}`
    if (text.toUpperCase().includes(UNMAPPED_ZONE_CODE)) {
      byCode.set(UNMAPPED_ZONE_CODE, z.id)
      loiByCode.set(UNMAPPED_ZONE_CODE, z.loi_id || null)
      continue
    }
    const m = text.match(/\b(582|584|585|586|587)\b/)
    if (m) {
      byCode.set(m[1], z.id)
      loiByCode.set(m[1], z.loi_id || null)
    }
  }

  let created = 0
  if (apply) {
    for (const code of requiredCodes) {
      if (byCode.has(code)) continue
      const isUnmapped = code === UNMAPPED_ZONE_CODE
      const center = ZONE_CENTER_BY_CODE[code] || ZONE_CENTER_BY_CODE['585']
      
      // Infer service domains from zone code/type
      const inferServiceDomains = () => {
        if (isUnmapped) return ['*'] // UNMAPPED can serve all domains
        // Nelson historical zones are primarily patrol and alarm_response
        return ['patrol', 'alarm_response']
      }
      
      const payload = {
        organization_id: nccOrgId,
        name: `Nelson Historical Zone ${code}`,
        description: isUnmapped
          ? 'Auto-created for First Security Nelson Wilsar historical import (dispatch zone not present in source row).'
          : `Auto-created for First Security Nelson Wilsar historical import (dispatch zone ${code}).`,
        is_active: true,
        needs_admin_review: true,
        boundary_source: 'import-first-security-nelson-historical',
        self_contained_required: true,
        nights_per_month: 28,
        max_consecutive_nights: 3,
        location_lat: center.lat,
        location_lng: center.lng,
        geometry: buildSquareGeometry(center),
        service_domains: inferServiceDomains(),
      }
      const { data: inserted, error: insertError } = await supabase.from('zones').insert(payload).select('id,loi_id').single()
      if (insertError || !inserted?.id) {
        throw new Error(`Failed creating zone for code ${code}: ${insertError?.message || 'Unknown error'}`)
      }
      
      // If LOI was auto-created by trigger, backfill service_domains
      if (inserted.loi_id) {
        const serviceDomains = inferServiceDomains()
        const { error: loiUpdateError } = await supabase
          .from('locations_of_interest')
          .update({ service_domains: serviceDomains })
          .eq('id', inserted.loi_id)
        if (loiUpdateError) {
          throw new Error(`Failed updating LOI service_domains for zone ${code}: ${loiUpdateError.message}`)
        }
      }
      
      byCode.set(code, inserted.id)
      loiByCode.set(code, inserted.loi_id || null)
      created += 1
    }
  }

  return { byCode, loiByCode, created }
}

async function fetchExistingPatrolKeys(supabase, nccOrgId) {
  const out = new Set()
  let from = 0
  const size = 1000

  while (true) {
    const { data, error } = await supabase
      .from('patrols')
      .select('notes')
      .eq('organization_id', nccOrgId)
      .like('notes', '%[WILSAR_PATROL_KEY:%')
      .range(from, from + size - 1)

    if (error) throw new Error(`Failed loading existing patrol keys: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      const note = normalizeText(row.notes)
      const m = note.match(/\[WILSAR_PATROL_KEY:([^\]]+)\]/)
      if (m) out.add(m[1])
    }

    if (data.length < size) break
    from += size
  }

  return out
}

async function fetchExistingAlarmKeys(supabase, nccOrgId) {
  const out = new Set()
  let from = 0
  const size = 1000
  let tableAvailable = true

  while (true) {
    const { data, error } = await supabase
      .from('alarm_events')
      .select('raw_payload')
      .eq('organization_id', nccOrgId)
      .eq('source_system', 'wilsar_historical')
      .range(from, from + size - 1)

    if (error) {
      if (String(error.message || '').includes("Could not find the table 'public.alarm_events'")) {
        tableAvailable = false
        break
      }
      throw new Error(`Failed loading existing alarm keys: ${error.message}`)
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      const key = row?.raw_payload?.import_key
      if (typeof key === 'string' && key) out.add(key)
    }

    if (data.length < size) break
    from += size
  }

  return { keys: out, tableAvailable }
}

function buildPatrolRows(rows, nccOrgId, zoneByCode) {
  const out = []
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    const dispatchId = normalizeText(r['Internal DespatchId'] || r['Internal DispatchId'])
    const clientId = normalizeText(r['Client ID'])
    const onSite = parseNzDateTime(r['On-site Date/Time'])
    const offSite = parseNzDateTime(r['Off-site Date/Time'])
    const dispatchAt = parseNzDateTime(r['Despatch Date/Time'])
    const zoneCode = extractZoneCode(r) || UNMAPPED_ZONE_CODE
    const status = normalizeStatus(r['Patrol Complete Status'])

    if (!dispatchId && !clientId && !onSite && !offSite) continue

    const key = [dispatchId || `row${i + 1}`, clientId || 'unknown', zoneCode, onSite || dispatchAt || 'na', offSite || 'na'].join('|')
    const zoneId = zoneByCode.get(zoneCode) || null
    const primaryTs = onSite || dispatchAt || offSite
    const patrolDate = primaryTs ? primaryTs.slice(0, 10) : null
    const comments = normalizeText(r['Comments'])
    const clientName = normalizeText(r['Client Name'])

    const noteParts = [`[WILSAR_PATROL_KEY:${key}]`, `[SOURCE:${SOURCE.bucket}/${SOURCE.patrolPath}]`]
    if (comments) noteParts.push(comments)

    out.push({
      key,
      meta: {
        client_id: clientId || null,
        client_name: clientName || null,
        zone_code: zoneCode,
        recorded_at: onSite || dispatchAt || offSite || null,
      },
      row: {
        organization_id: nccOrgId,
        zone_id: zoneId,
        status,
        patrol_date: patrolDate,
        scheduled_start_time: dispatchAt,
        actual_start_time: onSite,
        actual_end_time: offSite,
        started_at: onSite,
        ended_at: offSite,
        description: [clientName, clientId].filter(Boolean).join(' | ') || 'Wilsar historical patrol',
        notes: noteParts.join(' '),
      },
    })
  }
  return out
}

function classifyAlarmType(row) {
  const corpus = [
    row['Client ID'],
    row['Client Name'],
    row['Despatch Comments'],
    row['Follow-up Info.'],
  ].map(normalizeText).join(' ').toLowerCase()

  if (corpus.includes('noise')) return 'noise_control'
  if (corpus.includes('fire')) return 'fire_alarm'
  if (corpus.includes('alarm')) return 'alarm_activation'
  return 'dispatch_event'
}

function buildAlarmRows(rows, nccOrgId, zoneByCode) {
  const out = []
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    const dispatchNo = normalizeText(r['Despatch No.'] || r['Dispatch No.'] || r['Despatch No'])
    const clientId = normalizeText(r['Client ID'])
    const clientName = normalizeText(r['Client Name'])
    const responseAt = parseNzDateTime(r['Alarm Response Date/Time'])
    const onSite = parseNzDateTime(r['On-site Date/Time'])
    const offSite = parseNzDateTime(r['Off-site Date/Time'])
    const zoneCode = extractZoneCode(r) || UNMAPPED_ZONE_CODE
    const zoneId = zoneByCode.get(zoneCode) || null

    if (!dispatchNo && !clientId && !responseAt && !onSite && !offSite) continue

    const key = [dispatchNo || `row${i + 1}`, clientId || 'unknown', zoneCode, responseAt || onSite || 'na'].join('|')
    const notes = [normalizeText(r['Despatch Comments']), normalizeText(r['Follow-up Info.'])].filter(Boolean).join(' | ')

    out.push({
      key,
      meta: {
        client_id: clientId || null,
        client_name: clientName || null,
        dispatch_no: dispatchNo || null,
        zone_code: zoneCode,
        recorded_at: responseAt || onSite || offSite || null,
      },
      row: {
        organization_id: nccOrgId,
        source_system: 'wilsar_historical',
        alarm_type: classifyAlarmType(r),
        severity: 'medium',
        trigger_time: responseAt || onSite || offSite || null,
        address: normalizeText(r['Client Address']) || null,
        zone_id: zoneId,
        site_reference: clientId || null,
        status: offSite ? 'resolved' : 'open',
        resolved_at: offSite || null,
        notes: notes || null,
        raw_payload: {
          import_key: key,
          source_file: `${SOURCE.bucket}/${SOURCE.alarmPath}`,
          client_name: clientName || null,
          dispatch_no: dispatchNo || null,
          zone_code: zoneCode || null,
        },
      },
    })
  }
  return out
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
      if (!single.error) {
        inserted += 1
      } else {
        failed += 1
        errors.push(single.error.message || 'Unknown insert error')
      }
    }
  }

  return { inserted, failed, errors }
}

async function fetchExistingObservationKeys(supabase, nccOrgId) {
  const out = new Set()
  let from = 0
  const size = 1000

  while (true) {
    const { data, error } = await supabase
      .from('observations')
      .select('idempotency_key')
      .eq('organization_id', nccOrgId)
      .like('idempotency_key', 'import:wilsar-nelson:obs:%')
      .range(from, from + size - 1)

    if (error) throw new Error(`Failed loading existing observation keys: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row?.idempotency_key) out.add(String(row.idempotency_key))
    }

    if (data.length < size) break
    from += size
  }

  return out
}

async function ensureCanonicalVehicles(supabase, plates, apply) {
  const unique = [...new Set(plates.filter(Boolean))]
  if (!apply || unique.length === 0) return 0
  const rows = unique.map((plate_number) => ({ plate_number }))
  const { error } = await supabase.from('canonical_vehicles').upsert(rows, { onConflict: 'plate_number' })
  if (error) throw new Error(`Failed upserting canonical vehicles for observations: ${error.message}`)
  return unique.length
}

function inferServiceDomainsFromEventType(eventType) {
  // Map event types to service domains
  const domainMap = {
    'patrol': ['patrol'],
    'alarm': ['alarm_response'],
    'noise': ['noise_control'],
    'parking': ['parking'],
    'freedom_camping': ['freedom_camping'],
    'biosecurity': ['biosecurity'],
    'static_guard': ['static_guard'],
  }
  return domainMap[eventType] || []
}

function buildObservationRowsFromEvents(nccOrgId, eventType, candidates, loiByCode) {
  const out = []
  for (const c of candidates) {
    const recordedAt = c?.meta?.recorded_at
    if (!recordedAt) continue

    const zoneCode = c?.meta?.zone_code || null
    const zoneId = c?.row?.zone_id || null
    const loiId = zoneCode ? loiByCode.get(zoneCode) || null : null
    const plateSeed = c?.meta?.client_id || c?.meta?.dispatch_no || c?.meta?.client_name || c?.key
    const plate = buildEventPlate(plateSeed, eventType === 'alarm' ? 'NCCA' : 'NCCP')
    const obsKey = `import:wilsar-nelson:obs:${eventType}:${c.key}`

    const noteParts = [
      `[WILSAR_OBS_KEY:${obsKey}]`,
      `[EVENT_TYPE:${eventType}]`,
      `[SOURCE:${SOURCE.bucket}/${eventType === 'alarm' ? SOURCE.alarmPath : SOURCE.patrolPath}]`,
      c?.row?.description || c?.row?.notes || '',
    ].filter(Boolean)

    out.push({
      key: obsKey,
      row: {
        organization_id: nccOrgId,
        zone_id: zoneId,
        loi_id: loiId,
        plate_number: plate,
        recorded_at: recordedAt,
        idempotency_key: obsKey,
        officer_notes: noteParts.join(' '),
        has_notes: true,
      },
    })
  }
  return out
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

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const fsNelson = await getOrganizationByName(supabase, 'First Security - Nelson')
  const ncc = await getOrganizationByName(supabase, 'Nelson City Council')
  if (!fsNelson?.id) throw new Error('Organization not found: First Security - Nelson')
  if (!ncc?.id) throw new Error('Organization not found: Nelson City Council')

  const dryRun = !args.apply
  const { data: patrolBlob, error: patrolDownloadError } = await supabase.storage.from(SOURCE.bucket).download(SOURCE.patrolPath)
  if (patrolDownloadError || !patrolBlob) {
    throw new Error(`Failed downloading ${SOURCE.bucket}/${SOURCE.patrolPath}: ${patrolDownloadError?.message || 'Unknown error'}`)
  }

  const { data: alarmBlob, error: alarmDownloadError } = await supabase.storage.from(SOURCE.bucket).download(SOURCE.alarmPath)
  if (alarmDownloadError || !alarmBlob) {
    throw new Error(`Failed downloading ${SOURCE.bucket}/${SOURCE.alarmPath}: ${alarmDownloadError?.message || 'Unknown error'}`)
  }

  const patrolRowsRaw = parseRowsFromBuffer(Buffer.from(await patrolBlob.arrayBuffer()))
  const alarmRowsRaw = parseRowsFromBuffer(Buffer.from(await alarmBlob.arrayBuffer()))

  const requiredZoneCodes = collectZoneCodes([...patrolRowsRaw, ...alarmRowsRaw])
  const zoneState = await ensureNelsonZones(supabase, ncc.id, args.apply, requiredZoneCodes)

  const patrolCandidates = buildPatrolRows(patrolRowsRaw, ncc.id, zoneState.byCode)
  const alarmCandidates = buildAlarmRows(alarmRowsRaw, ncc.id, zoneState.byCode)

  const existingPatrol = await fetchExistingPatrolKeys(supabase, ncc.id)
  const existingAlarmState = await fetchExistingAlarmKeys(supabase, ncc.id)
  const existingObservation = await fetchExistingObservationKeys(supabase, ncc.id)

  const patrolPending = patrolCandidates.filter((x) => !existingPatrol.has(x.key))
  const alarmPending = alarmCandidates.filter((x) => !existingAlarmState.keys.has(x.key))

  const observationFromPatrol = buildObservationRowsFromEvents(ncc.id, 'patrol', patrolCandidates, zoneState.loiByCode)
  const observationFromAlarm = buildObservationRowsFromEvents(ncc.id, 'alarm', alarmCandidates, zoneState.loiByCode)
  const observationCandidates = [...observationFromPatrol, ...observationFromAlarm]
  const observationPending = observationCandidates.filter((x) => !existingObservation.has(x.key))

  let patrolResult = { inserted: 0, failed: 0, errors: [] }
  let alarmResult = { inserted: 0, failed: 0, errors: [] }
  let observationResult = { inserted: 0, failed: 0, errors: [] }
  let canonicalVehiclesUpserted = 0

  if (!dryRun) {
    patrolResult = await insertBatches(supabase, 'patrols', patrolPending.map((x) => x.row), 250)
    if (existingAlarmState.tableAvailable) {
      alarmResult = await insertBatches(supabase, 'alarm_events', alarmPending.map((x) => x.row), 250)
    }
    canonicalVehiclesUpserted = await ensureCanonicalVehicles(supabase, observationPending.map((x) => x.row.plate_number), true)
    observationResult = await insertBatches(supabase, 'observations', observationPending.map((x) => x.row), 250)
  }

  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    provider_org: { id: fsNelson.id, name: fsNelson.name },
    target_client_org: { id: ncc.id, name: ncc.name, parent_organization_id: ncc.parent_organization_id },
    zones: {
      created: zoneState.created,
      mapped_codes: [...zoneState.byCode.keys()].sort(),
    },
    patrols: {
      source_rows: patrolRowsRaw.length,
      candidates: patrolCandidates.length,
      existing_matches: existingPatrol.size,
      pending: patrolPending.length,
      inserted: patrolResult.inserted,
      failed: patrolResult.failed,
      error_sample: patrolResult.errors.slice(0, 10),
    },
    alarm_events: {
      table_available: existingAlarmState.tableAvailable,
      source_rows: alarmRowsRaw.length,
      candidates: alarmCandidates.length,
      existing_matches: existingAlarmState.keys.size,
      pending: existingAlarmState.tableAvailable ? alarmPending.length : 0,
      inserted: existingAlarmState.tableAvailable ? alarmResult.inserted : 0,
      failed: existingAlarmState.tableAvailable ? alarmResult.failed : 0,
      error_sample: existingAlarmState.tableAvailable ? alarmResult.errors.slice(0, 10) : ['alarm_events table is not available in this environment; skipped'],
    },
    observations: {
      source_event_candidates: observationCandidates.length,
      existing_matches: existingObservation.size,
      pending: observationPending.length,
      canonical_vehicles_upserted: canonicalVehiclesUpserted,
      inserted: observationResult.inserted,
      failed: observationResult.failed,
      error_sample: observationResult.errors.slice(0, 10),
    },
    source: {
      bucket: SOURCE.bucket,
      patrol_file: SOURCE.patrolPath,
      alarm_file: SOURCE.alarmPath,
    },
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
