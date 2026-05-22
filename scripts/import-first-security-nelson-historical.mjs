#!/usr/bin/env node

import fs from 'node:fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { consultBob } from './agent-bob-bridge.mjs'

const HELP_TEXT = `
Import First Security Nelson historical Wilsar files into patrols and alarm_events.

Usage:
  node scripts/import-first-security-nelson-historical.mjs [--apply] [--ai-review] [--ai-review-limit <n>] [--ai-auto-promote-threshold <0-1>] [--qa-noise-threshold <0-1>] [--qa-complainant-threshold <0-1>] [--qa-person-threshold <0-1>] [--qa-export-path <path>]

Options:
  --apply                       Write to database. Omit for dry-run.
  --ai-review                   Run Bob-assisted review on low-confidence noise note rows.
  --ai-review-limit <n>         Max low-confidence rows to send to Bob. Default: 100.
  --ai-auto-promote-threshold   Promote Bob suggestions into parsed fields at or above this confidence. Default: 0.96.
  --qa-noise-threshold          Minimum confidence before noise address is treated as QA-pass. Default: 0.85.
  --qa-complainant-threshold    Minimum confidence before complainant address is treated as QA-pass. Default: 0.85.
  --qa-person-threshold         Minimum confidence before person name is treated as QA-pass. Default: 0.80.
  --qa-export-path              Output path for narrative QA CSV export. Default: /tmp/wilsar-noise-note-review.csv.
`

const SOURCE = {
  bucket: 'Service-Contracts',
  patrolPath: 'Wilsar-Data/Nelson Patrol Historical data.csv',
  alarmPaths: [
    'Wilsar-Data/Nelsn Alarm-Noise control historical data.csv',
    'Wilsar-Data/Nelson Alarm-Noise control historical data.csv',
    'Wilsar-Data/Nelson Noise Control Historical data.csv',
    'Wilsar-Data/Nelson Noise control historical data.csv',
  ],
}

const DEFAULT_ZONE_CODES = ['582', '584', '585', '586', '587']
const UNMAPPED_ZONE_CODE = 'UNMAPPED'

const ZONE_CENTER_BY_CODE = {
  '581': { lat: -41.513, lng: 173.958 },
  '582': { lat: -41.285, lng: 173.244 },
  '584': { lat: -41.252, lng: 173.301 },
  '585': { lat: -41.2706, lng: 173.284 },
  '586': { lat: -41.333, lng: 173.183 },
  '587': { lat: -41.220, lng: 173.318 },
}

const TARGET_PROVIDER_ORG_DEFAULT = 'First Security - Nelson'
const TARGET_PROVIDER_ORG_BY_ZONE = {
  '581': 'First Security - Blenheim',
  '582': 'First Security - Blenheim',
}
const TARGET_CLIENT_ORG = 'Nelson City Council'
const DEFAULT_NARRATIVE_QA_THRESHOLDS = {
  noiseAddress: 0.85,
  complainantAddress: 0.85,
  personName: 0.8,
}

function getProviderOrgNameForZone(zoneCode) {
  return TARGET_PROVIDER_ORG_BY_ZONE[zoneCode] || TARGET_PROVIDER_ORG_DEFAULT
}

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
    aiReview: argv.includes('--ai-review'),
    aiReviewLimit: Number.parseInt(String(readOptionValue('--ai-review-limit') || ''), 10),
    aiAutoPromoteThreshold: Number.parseFloat(String(readOptionValue('--ai-auto-promote-threshold') || '')),
    qaNoiseThreshold: Number.parseFloat(String(readOptionValue('--qa-noise-threshold') || '')),
    qaComplainantThreshold: Number.parseFloat(String(readOptionValue('--qa-complainant-threshold') || '')),
    qaPersonThreshold: Number.parseFloat(String(readOptionValue('--qa-person-threshold') || '')),
    qaExportPath: normalizeText(readOptionValue('--qa-export-path') || ''),
  }
}

function resolveThreshold(candidate, fallbackRaw, defaultValue) {
  const fallback = Number.parseFloat(String(fallbackRaw || ''))
  const value = Number.isFinite(candidate)
    ? candidate
    : Number.isFinite(fallback)
      ? fallback
      : defaultValue
  return Math.max(0, Math.min(1, value))
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

function parseFirstNzDateTime(row, keys) {
  for (const key of keys) {
    const parsed = parseNzDateTime(row?.[key])
    if (parsed) return parsed
  }
  return null
}

function parseRowsFromBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

async function downloadAvailableStorageFiles(supabase, bucket, paths) {
  const out = []
  for (const path of paths) {
    const { data, error } = await supabase.storage.from(bucket).download(path)
    if (error || !data) continue
    out.push({ path, blob: data })
  }
  return out
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

function addDomainToZoneMap(map, zoneCode, domain) {
  const code = zoneCode || UNMAPPED_ZONE_CODE
  if (!map.has(code)) map.set(code, new Set())
  if (domain) map.get(code).add(domain)
}

function inferAlarmDomain(row) {
  const alarmType = classifyAlarmType(row)
  if (alarmType === 'noise_control') return 'noise_control'
  return 'alarm_response'
}

function buildZoneDomainMap(patrolRows, alarmRows) {
  const byZone = new Map()

  for (const row of patrolRows || []) {
    const zoneCode = extractZoneCode(row) || UNMAPPED_ZONE_CODE
    addDomainToZoneMap(byZone, zoneCode, 'patrol')
  }

  for (const row of alarmRows || []) {
    const zoneCode = extractZoneCode(row) || UNMAPPED_ZONE_CODE
    addDomainToZoneMap(byZone, zoneCode, inferAlarmDomain(row))
  }

  return byZone
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

async function ensureOrgZones(supabase, orgId, apply, requiredCodes, zoneDomainsByCode = new Map()) {
  const { data: existing, error } = await supabase
    .from('zones')
    .select('id,name,description,loi_id')
    .eq('organization_id', orgId)

  if (error) throw new Error(`Failed loading existing zones: ${error.message}`)

  const byCode = new Map()
  const loiByCode = new Map()
  for (const z of existing || []) {
    const text = `${z.name || ''} ${z.description || ''}`
    if (text.toUpperCase().includes(UNMAPPED_ZONE_CODE)) {
      byCode.set(UNMAPPED_ZONE_CODE, z.id)
      loiByCode.set(UNMAPPED_ZONE_CODE, z.loi_id || null)
      continue
    }
    const m = text.match(/\b(\d{3})\b/)
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
        const domains = [...(zoneDomainsByCode.get(code) || [])]
        if (domains.length > 1) return domains
        if (domains.length === 1) return domains
        if (isUnmapped) return ['*']
        return ['patrol']
      }
      
      const payload = {
        organization_id: orgId,
        name: `Wilsar Historical Zone ${code}`,
        description: isUnmapped
          ? 'Auto-created for Wilsar historical import (dispatch zone not present in source row).'
          : `Auto-created for Wilsar historical import (dispatch zone ${code}).`,
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
      let zonePayload = payload
      let { data: inserted, error: insertError } = await supabase.from('zones').insert(zonePayload).select('id,loi_id').single()
      if (insertError && String(insertError.message || '').includes('service_domains')) {
        const { service_domains, ...fallbackPayload } = payload
        zonePayload = fallbackPayload
        ;({ data: inserted, error: insertError } = await supabase.from('zones').insert(zonePayload).select('id,loi_id').single())
      }
      if (insertError || !inserted?.id) {
        throw new Error(`Failed creating zone for code ${code}: ${insertError?.message || 'Unknown error'}`)
      }
      
      // If LOI was auto-created by trigger, backfill service_domains
      if (inserted.loi_id) {
        const serviceDomains = inferServiceDomains()
        let { error: loiUpdateError } = await supabase
          .from('locations_of_interest')
          .update({ service_domains: serviceDomains })
          .eq('id', inserted.loi_id)
        if (loiUpdateError && String(loiUpdateError.message || '').includes('service_domains')) {
          loiUpdateError = null
        }
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

function buildClientSiteCode(clientId, clientName) {
  const raw = normalizeText(clientId)
  if (raw) return raw.slice(0, 64)
  const seed = normalizeText(clientName) || 'unknown-site'
  return `WILSAR-${String(stableHash(seed)).slice(0, 8)}`
}

function normalizeSiteName(clientName, siteCode) {
  const name = normalizeText(clientName)
  if (name) return name
  if (siteCode) return `Wilsar Site ${siteCode}`
  return 'Wilsar Imported Site'
}

function buildClientSiteSeed(entry) {
  const clientId = normalizeText(entry?.meta?.client_id)
  const clientName = normalizeText(entry?.meta?.client_name)
  const zoneCode = normalizeText(entry?.meta?.zone_code) || UNMAPPED_ZONE_CODE
  const siteCode = buildClientSiteCode(clientId, clientName)
  const siteName = normalizeSiteName(clientName, siteCode)
  return {
    siteCode,
    siteName,
    zoneCode,
    clientName,
    clientId: clientId || null,
    serviceDomains: new Set(inferServiceDomainsFromEventType(entry?.meta?.event_type || 'patrol')),
  }
}

function collectClientSiteSeeds(patrolCandidates, alarmCandidates) {
  const byCode = new Map()
  for (const entry of [...patrolCandidates, ...alarmCandidates]) {
    const seed = buildClientSiteSeed(entry)
    if (!seed.siteCode) continue
    if (!byCode.has(seed.siteCode)) {
      byCode.set(seed.siteCode, seed)
      continue
    }

    const current = byCode.get(seed.siteCode)
    if (!current.clientName && seed.clientName) current.clientName = seed.clientName
    if (!current.clientId && seed.clientId) current.clientId = seed.clientId
    if (current.zoneCode === UNMAPPED_ZONE_CODE && seed.zoneCode !== UNMAPPED_ZONE_CODE) {
      current.zoneCode = seed.zoneCode
    }
    for (const d of seed.serviceDomains || []) current.serviceDomains.add(d)
  }
  return [...byCode.values()]
}

async function ensureClientSites(supabase, branchOrgId, zoneByCode, loiByCode, siteSeeds, apply) {
  let selectFields = 'id,name,site_code,zone_id,loi_id,notes'
  let { data: existing, error } = await supabase
    .from('client_sites')
    .select(selectFields)
    .eq('organization_id', branchOrgId)

  if (error && String(error.message || '').includes('loi_id')) {
    selectFields = 'id,name,site_code,zone_id,notes'
    ;({ data: existing, error } = await supabase
      .from('client_sites')
      .select(selectFields)
      .eq('organization_id', branchOrgId))
  }

  if (error) throw new Error(`Failed loading existing client sites: ${error.message}`)

  const bySiteCode = new Map()
  for (const row of existing || []) {
    const key = normalizeText(row.site_code)
    if (key) bySiteCode.set(key, row)
  }

  const mapBySiteCode = new Map()
  let created = 0
  let updated = 0

  for (const seed of siteSeeds) {
    const current = bySiteCode.get(seed.siteCode)
    const zoneId = zoneByCode.get(seed.zoneCode) || zoneByCode.get(UNMAPPED_ZONE_CODE) || null
    const loiId = loiByCode.get(seed.zoneCode) || loiByCode.get(UNMAPPED_ZONE_CODE) || null
    const notes = [
      'Imported from Wilsar historical dataset',
      seed.clientName ? `[CLIENT_NAME:${seed.clientName}]` : null,
      seed.clientId ? `[CLIENT_ID:${seed.clientId}]` : null,
      `[SITE_CODE:${seed.siteCode}]`,
      `[ZONE_CODE:${seed.zoneCode}]`,
      `[SERVICE_DOMAINS:${[...(seed.serviceDomains || [])].join(',') || '*'}]`,
      `[SOURCE:${SOURCE.bucket}/${SOURCE.patrolPath}]`,
    ].filter(Boolean).join(' ')

    if (!current && apply) {
      const basePayload = {
        organization_id: branchOrgId,
        name: seed.siteName,
        site_code: seed.siteCode,
        site_type: 'guarding',
        zone_id: zoneId,
        notes,
        is_active: Boolean(zoneId),
      }

      const withLoi = loiId ? { loi_id: loiId } : {}
      const withDomains = { service_domains: [...(seed.serviceDomains || [])] }
      const payloadVariants = [
        { ...basePayload, ...withLoi, ...withDomains },
        { ...basePayload, ...withDomains },
        { ...basePayload, ...withLoi },
        { ...basePayload },
      ]

      let insert = null
      let insertedData = null
      let lastError = null
      for (const variant of payloadVariants) {
        insert = await supabase.from('client_sites').insert(variant).select('id,site_code').single()
        if (!insert.error && insert.data?.id) {
          insertedData = insert.data
          lastError = null
          break
        }
        lastError = insert.error
        const msg = String(insert.error?.message || '')
        const canRetryWithoutColumn = msg.includes('loi_id') || msg.includes('service_domains')
        if (!canRetryWithoutColumn) break
      }

      if (!insertedData?.id) {
        const errorMessage = lastError?.message || insert?.error?.message || 'Unknown error'
        throw new Error(`Failed creating client site ${seed.siteCode}: ${errorMessage}`)
      }
      if (insert.error || !insert.data?.id) {
        throw new Error(`Failed creating client site ${seed.siteCode}: ${insert.error?.message || 'Unknown error'}`)
      }
      bySiteCode.set(seed.siteCode, { id: insertedData.id, site_code: seed.siteCode, zone_id: zoneId, loi_id: loiId })
      mapBySiteCode.set(seed.siteCode, { id: insertedData.id, site_code: seed.siteCode, zone_id: zoneId, loi_id: loiId })
      created += 1
      continue
    }

    if (current) {
      mapBySiteCode.set(seed.siteCode, current)
      if (!apply) continue

      const shouldUpdateZone = Boolean(zoneId && !current.zone_id)
      const shouldUpdateNotes = !String(current.notes || '').includes('[SITE_CODE:')
      if (!shouldUpdateZone && !shouldUpdateNotes) continue

      const updatePayload = {
        zone_id: shouldUpdateZone ? zoneId : current.zone_id,
        notes: shouldUpdateNotes ? notes : current.notes,
      }
      if (loiId && current.loi_id == null) updatePayload.loi_id = loiId

      let update = await supabase.from('client_sites').update(updatePayload).eq('id', current.id)
      if (update.error && String(update.error.message || '').includes('loi_id')) {
        const { loi_id, ...fallbackPayload } = updatePayload
        if (String(update.error.message || '').includes('service_domains')) {
          const { service_domains, ...fallbackNoDomains } = fallbackPayload
          update = await supabase.from('client_sites').update(fallbackNoDomains).eq('id', current.id)
        } else {
          update = await supabase.from('client_sites').update(fallbackPayload).eq('id', current.id)
        }
      }
      if (update.error && String(update.error.message || '').includes('service_domains')) {
        const { service_domains, ...fallbackPayload } = updatePayload
        update = await supabase.from('client_sites').update(fallbackPayload).eq('id', current.id)
      }
      if (update.error) {
        throw new Error(`Failed updating client site ${seed.siteCode}: ${update.error.message}`)
      }
      updated += 1
    }
  }

  return {
    bySiteCode: mapBySiteCode,
    existing_count: (existing || []).length,
    created,
    updated,
    total_seeds: siteSeeds.length,
  }
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

function buildPatrolRows(rows, routeByZoneCode) {
  const out = []
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    const dispatchId = normalizeText(r['Internal DespatchId'] || r['Internal DispatchId'])
    const clientId = normalizeText(r['Client ID'])
    const onSite = parseNzDateTime(r['On-site Date/Time'])
    const offSite = parseNzDateTime(r['Off-site Date/Time'])
    const dispatchAt = parseNzDateTime(r['Despatch Date/Time'])
    const zoneCode = extractZoneCode(r) || UNMAPPED_ZONE_CODE
    const route = routeByZoneCode.get(zoneCode) || routeByZoneCode.get(UNMAPPED_ZONE_CODE) || null
    const status = normalizeStatus(r['Patrol Complete Status'])

    if (!dispatchId && !clientId && !onSite && !offSite) continue

    const key = [dispatchId || `row${i + 1}`, clientId || 'unknown', zoneCode, onSite || dispatchAt || 'na', offSite || 'na'].join('|')
    const zoneId = route?.zone_id || null
    const organizationId = route?.org_id || null
    const primaryTs = onSite || dispatchAt || offSite
    const patrolDate = primaryTs ? primaryTs.slice(0, 10) : null
    const comments = normalizeText(r['Comments'])
    const clientName = normalizeText(r['Client Name'])
    const siteCode = buildClientSiteCode(clientId, clientName)

    const noteParts = [`[WILSAR_PATROL_KEY:${key}]`, `[SOURCE:${SOURCE.bucket}/${SOURCE.patrolPath}]`]
    noteParts.push(`[SITE_CODE:${siteCode}]`)
    if (comments) noteParts.push(comments)

    out.push({
      key,
      meta: {
        event_type: 'patrol',
        site_code: siteCode,
        client_id: clientId || null,
        client_name: clientName || null,
        zone_code: zoneCode,
        recorded_at: onSite || dispatchAt || offSite || null,
      },
      row: {
        organization_id: organizationId,
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
  return out.filter((entry) => Boolean(entry?.row?.organization_id))
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

function buildAlarmRows(rows, routeByZoneCode, sourcePath, narrativeQaThresholds = DEFAULT_NARRATIVE_QA_THRESHOLDS) {
  const out = []
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    const dispatchNo = normalizeText(r['Despatch No.'] || r['Dispatch No.'] || r['Despatch No'])
    const clientId = normalizeText(r['Client ID'])
    const clientName = normalizeText(r['Client Name'])
    const dispatchAt = parseFirstNzDateTime(r, [
      'Dispatch Date/Time',
      'Despatch Date/Time',
      'Date/Time',
    ])
    const responseAt = parseFirstNzDateTime(r, [
      'Alarm Response Date/Time',
      'Response Date/Time',
    ])
    const onSite = parseFirstNzDateTime(r, [
      'On-site Date/Time',
      'On Site Date/Time',
      'Onsite Date/Time',
      'Arrived Date/Time',
      'Arrival Date/Time',
    ])
    const estimatedAttendanceAt = parseFirstNzDateTime(r, [
      'Estimated Attendance Date/Time',
      'Estimated Attendance Time',
      'Attendance ETA',
      'ETA',
    ])
    const onsiteAt = onSite || responseAt || null
    const attendanceEtaAt = estimatedAttendanceAt || null
    const submitAt = parseFirstNzDateTime(r, [
      'Submitted Date/Time',
      'Submit Date/Time',
      'Submission Date/Time',
    ])
    const offSite = parseFirstNzDateTime(r, [
      'Off-site Date/Time',
      'Off Site Date/Time',
      'Offsite Date/Time',
      'Completed Date/Time',
      'Closed Date/Time',
      'Clear Date/Time',
      'Finish Date/Time',
      'Job Complete Date/Time',
    ])
    const submitClosedAt = offSite || submitAt || null
    const zoneCode = extractZoneCode(r) || UNMAPPED_ZONE_CODE
    const route = routeByZoneCode.get(zoneCode) || routeByZoneCode.get(UNMAPPED_ZONE_CODE) || null
    const zoneId = route?.zone_id || null
    const organizationId = route?.org_id || null

    if (!dispatchNo && !clientId && !dispatchAt && !responseAt && !onsiteAt && !attendanceEtaAt && !submitClosedAt) continue

    const key = [dispatchNo || `row${i + 1}`, clientId || 'unknown', zoneCode, dispatchAt || responseAt || onsiteAt || attendanceEtaAt || 'na'].join('|')
    const dispatchComments = normalizeText(r['Despatch Comments'])
    const followUpInfo = normalizeText(r['Follow-up Info.'])
    const notes = [dispatchComments, followUpInfo].filter(Boolean).join(' | ')
    const visitResult = extractVisitResult(dispatchComments, followUpInfo)
    const rawClientAddress = normalizeText(r['Client Address'])
    const narrative = parseNoiseNarrative(notes, rawClientAddress, narrativeQaThresholds)
    const complainantAddressFromNotes = narrative.complainantAddress
    const effectiveNoiseAddress = narrative.noiseAddress
    const personFromNotes = narrative.personName
    const matrixRefs = narrative.matrixRefs
    const noiseEndIssued = narrative.noiseEndIssued
    const dispatchToOnsiteMinutes = computeMinutesBetween(dispatchAt, onsiteAt)
    const siteCode = buildClientSiteCode(clientId, clientName)

    out.push({
      key,
      meta: {
        event_type: classifyAlarmType(r) === 'noise_control' ? 'noise' : 'alarm',
        site_code: siteCode,
        client_id: clientId || null,
        client_name: clientName || null,
        dispatch_no: dispatchNo || null,
        zone_code: zoneCode,
        parsed_dispatch_address: effectiveNoiseAddress || null,
        parsed_noise_address: effectiveNoiseAddress || null,
        parsed_complainant_address: complainantAddressFromNotes || null,
        parsed_person_name: personFromNotes || null,
        parsed_narrative_confidence: narrative.confidence,
        parsed_narrative_qa_reasons: narrative.qaReasons,
        parsed_narrative_slots: narrative.slots,
        matrix_refs: matrixRefs,
        noise_end_issued: noiseEndIssued,
        visit_result: visitResult || null,
        dispatch_at: dispatchAt || null,
        onsite_at: onsiteAt,
        attendance_eta_at: attendanceEtaAt,
        attendance_at: onsiteAt || attendanceEtaAt || null,
        dispatch_to_onsite_minutes: dispatchToOnsiteMinutes,
        submit_closed_at: submitClosedAt,
        recorded_at: dispatchAt || responseAt || onsiteAt || attendanceEtaAt || submitClosedAt || null,
        resolved_at: submitClosedAt,
      },
      row: {
        organization_id: organizationId,
        source_system: 'wilsar_historical',
        alarm_type: classifyAlarmType(r),
        severity: 'medium',
        trigger_time: dispatchAt || responseAt || onsiteAt || attendanceEtaAt || submitClosedAt || null,
        address: effectiveNoiseAddress || null,
        zone_id: zoneId,
        site_reference: siteCode || clientId || null,
        status: submitClosedAt ? 'resolved' : 'open',
        resolved_at: submitClosedAt,
        notes: notes || null,
        raw_payload: {
          import_key: key,
          source_file: `${SOURCE.bucket}/${sourcePath || SOURCE.alarmPaths[0]}`,
          client_name: clientName || null,
          dispatch_no: dispatchNo || null,
          zone_code: zoneCode || null,
          parsed_dispatch_address: effectiveNoiseAddress || null,
          parsed_noise_address: effectiveNoiseAddress || null,
          parsed_complainant_address: complainantAddressFromNotes || null,
          parsed_person_name: personFromNotes || null,
          parsed_narrative_confidence: narrative.confidence,
          parsed_narrative_qa_reasons: narrative.qaReasons,
          parsed_narrative_slots: narrative.slots,
          matrix_refs: matrixRefs,
          noise_end_issued: noiseEndIssued,
          visit_result: visitResult || null,
          dispatch_at: dispatchAt || null,
          onsite_at: onsiteAt,
          attendance_eta_at: attendanceEtaAt,
          attendance_at: onsiteAt || attendanceEtaAt || null,
          dispatch_to_onsite_minutes: dispatchToOnsiteMinutes,
          submit_closed_at: submitClosedAt,
        },
      },
    })
  }
  return out.filter((entry) => Boolean(entry?.row?.organization_id))
}

async function fetchExistingNoiseJobRefs(supabase, orgId) {
  const out = new Set()
  const byRef = new Map()
  let from = 0
  const size = 1000
  let tableAvailable = true

  while (true) {
    const { data, error } = await supabase
      .from('noise_jobs')
      .select('id,complainant_ref,status,completed_at')
      .eq('organization_id', orgId)
      .ilike('complainant_ref', 'wilsar:%')
      .range(from, from + size - 1)

    if (error) {
      if (String(error.message || '').includes("Could not find the table 'public.noise_jobs'")) {
        tableAvailable = false
        break
      }
      throw new Error(`Failed loading existing noise job refs: ${error.message}`)
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row?.complainant_ref) {
        const key = String(row.complainant_ref).toLowerCase()
        out.add(key)
        byRef.set(key, {
          id: row.id,
          status: row.status || null,
          completed_at: row.completed_at || null,
        })
      }
    }

    if (data.length < size) break
    from += size
  }

  return { refs: out, byRef, tableAvailable }
}

async function getNoiseCounterByOrg(supabase, orgId) {
  const { data, error } = await supabase
    .from('noise_job_counters')
    .select('last_number')
    .eq('organization_id', orgId)
    .maybeSingle()
  if (error) {
    if (String(error.message || '').includes("Could not find the table 'public.noise_job_counters'")) {
      return { tableAvailable: false, lastNumber: 0 }
    }
    throw new Error(`Failed loading noise job counter: ${error.message}`)
  }
  return { tableAvailable: true, lastNumber: data?.last_number || 0 }
}

function mapNoiseTypeFromText(value) {
  const text = String(value || '').toLowerCase()
  if (text.includes('party')) return 'party'
  if (text.includes('music') || text.includes('stereo') || text.includes('speaker')) return 'music'
  if (text.includes('construction') || text.includes('tool') || text.includes('building')) return 'construction'
  if (text.includes('machinery') || text.includes('machine') || text.includes('generator')) return 'machinery'
  if (text.includes('vehicle') || text.includes('exhaust') || text.includes('car') || text.includes('engine')) return 'motor_vehicle'
  if (text.includes('animal') || text.includes('dog') || text.includes('bark')) return 'barking_dog'
  if (text.includes('industrial') || text.includes('factory')) return 'industrial'
  return 'other'
}

function mapNoisePriorityFromText(value) {
  const text = String(value || '').toLowerCase()
  if (text.includes('urgent') || text.includes('threat') || text.includes('emergency')) return 'urgent'
  if (text.includes('repeat') || text.includes('persistent')) return 'high'
  return 'normal'
}

const ADDRESS_PLACEHOLDER_VALUES = new Set([
  'refer to details',
  'refer details',
  'details',
  'unknown',
  'n/a',
  'na',
  'nil',
])

function normalizeAddressKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(road|rd)\b/g, 'rd')
    .replace(/\b(street|st)\b/g, 'st')
    .replace(/\b(avenue|ave)\b/g, 'ave')
    .replace(/\b(drive|dr)\b/g, 'dr')
    .replace(/\b(lane|ln)\b/g, 'ln')
    .replace(/\b(terrace|tce)\b/g, 'tce')
    .replace(/\b(crescent|cres)\b/g, 'cres')
    .replace(/\b(court|ct)\b/g, 'ct')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePersonKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toTitleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .trim()
}

function normalizeHistoricalAddressText(value) {
  return normalizeText(value)
    .replace(/\b(STREET|ROAD|AVENUE|DRIVE|LANE|CRESCENT|PLACE|TERRACE|COURT|WAY|HIGHWAY)([A-Z])/g, '$1 $2')
    .replace(/\b(ST|RD|AVE|DR|LN|CRES|PL|TCE|CT|HWY)([A-Z])/g, '$1 $2')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isPlaceholderAddress(value) {
  const normalized = normalizeText(value).toLowerCase()
  return !normalized || ADDRESS_PLACEHOLDER_VALUES.has(normalized)
}

function cleanAddressCandidate(value) {
  const text = normalizeHistoricalAddressText(value)
  if (!text) return null
  let cut = text
    .split(/\|+/)[0]
    .split(/(?:;|\b(?:FIRST|SECOND)\s+CALL\b|\bCALL(?:ED)?\s+BACK\b|\bCALLBACK\b|\bMAGIQ\s+SR\b|\bPASSED\s+TO\b|\bRESOLUTION\b|\bNOISE\s+LEVEL\b|\bSOUND\b|\bTIME\b|\bTONE\b|\bTOTAL\b|\bPHONE\b|\bPH\b)/i)[0]
    .replace(/\s+\/$/, '')
    .trim()
  cut = cut.replace(/\/?\s*[A-Z][a-z]+\s+CALLED\s+BACK.*$/i, '').trim()
  cut = cut.replace(/\s{2,}/g, ' ')
  if (!cut) return null
  return cut.slice(0, 255)
}

function cleanPersonCandidate(value) {
  const candidate = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\s*[-,:;]+$/, '')
    .trim()
    .slice(0, 120)
  if (!candidate) return null
  const lowered = candidate.toLowerCase()
  if (['unknown', 'anonymous', 'n a', 'na', 'none', 'her address', 'his address'].includes(lowered)) return null
  if (/\b(advised|resides|reporting|calling|called|classed|noise|initial job|next door|please|would not provide|caller advised|ongoing)\b/i.test(candidate)) return null
  if (!/^[A-Za-z][A-Za-z .'-]+$/.test(candidate)) return null
  if (candidate.split(' ').filter(Boolean).length < 2) return null
  return toTitleCase(candidate)
}

function isLikelyAddress(value) {
  const text = normalizeText(value)
  if (!text) return false
  if (text.length < 6) return false
  const hasNumber = /\b\d{1,5}\b/.test(text)
  const hasStreetToken = /\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|close|cl|place|pl|way|terrace|tce|crescent|cres|court|ct|highway|hwy)\b/i.test(text)
  const hasRelativeStreetToken = /\b(end of|corner of|opposite|near)\b/i.test(text) && hasStreetToken
  const hasSuburbLike = /\b(auckland|wellington|christchurch|nelson|blenheim|richmond|tahunanui|stoke|motueka|maitai|toi toi|enner glynn|bishopdale|stepneyville|beachville|wakatu|the wood|washington valley)\b/i.test(text)
  const hasPlaceToken = /\b(park|car park|centre|center|museum|bar|hotel|lodge|cafe|quay|port|market|boathouse|society|grounds)\b/i.test(text)
  return hasRelativeStreetToken || hasStreetToken || hasPlaceToken || (hasNumber && hasSuburbLike)
}

function collectAddressCandidates(value) {
  const text = String(value || '').trim()
  if (!text) return []

  const candidates = []
  const patterns = [
    /(?:noise address|address of noise|address of the noise)\s*(?:is|=|:|-)?\s*([^|;\n]+)/gi,
    /(?:caller address|address of caller|address of complainant|complainant address|caller lives at|caller is at|caller is from|caller at|caller from|calling from|caller:)\s*(?:is|=|:|-)?\s*([^|;\n]+)/gi,
    /(?:coming from|noise is from|loud music at|loud bass music at|noise complaint for|commercial noise complaint for|noise control\s*[-:]?\s*.*?coming from)\s*([^|;\n]+)/gi,
    /(\b\d{1,5}[A-Z]?\/?\d{0,5}?\s+[A-Za-z0-9' .\/-]{2,100}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Close|Cl|Place|Pl|Way|Terrace|Tce|Crescent|Cres|Court|Ct|Highway|Hwy)\b[^|;\n]*)/gi,
    /([A-Za-z][A-Za-z' .\/-]{2,80}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Close|Cl|Place|Pl|Way|Terrace|Tce|Crescent|Cres|Court|Ct|Highway|Hwy)\b[^|;\n]*)/gi,
    /((?:end of|corner of|opposite|near)\s+[A-Za-z0-9' .\/-]{2,100}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Close|Cl|Place|Pl|Way|Terrace|Tce|Crescent|Cres|Court|Ct|Highway|Hwy)\b[^|;\n]*)/gi,
    /((?:the\s+)?[A-Za-z][A-Za-z' .\/-]{2,80}\s(?:park|car park|centre|center|museum|bar|hotel|lodge|cafe|quay|port|market|boathouse|society|grounds)\b[^|;\n]*)/gi,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (!match?.[1]) continue
      const candidate = cleanAddressCandidate(match[1])
      if (candidate && isLikelyAddress(candidate) && !candidates.includes(candidate)) {
        candidates.push(candidate)
      }
    }
  }

  return candidates
}

function extractLeadingComplainantAddressFromText(value) {
  const text = String(value || '').trim()
  if (!text) return null

  const patterns = [
    /^(?:[A-Z][A-Z' -]{2,80}\s+(?:0\d[\d\s]{6,})\s*,?\s*)?(\d{1,5}[A-Z]?\/?\d{0,5}?\s+[A-Za-z0-9' .\/-]{2,100}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Close|Cl|Place|Pl|Way|Terrace|Tce|Crescent|Cres|Court|Ct|Highway|Hwy)\b[^|;\n]*?)\s+(?:reporting|called\s+re|in\s+regards\s+to|noise\s+complaint|loud|noisy)/i,
    /^(?:[A-Z][A-Z' -]{2,80}\s*:?\s*)?(\d{1,5}[A-Z]?\/?\d{0,5}?\s+[A-Za-z0-9' .\/-]{2,100}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Close|Cl|Place|Pl|Way|Terrace|Tce|Crescent|Cres|Court|Ct|Highway|Hwy)\b[^|;\n]*?)\s+(?:loud|noise|reporting|called\s+re|in\s+regards\s+to)/i,
    /^[A-Z][A-Z' -]{2,80}\s+FROM\s+(\d{1,5}[A-Z]?\/?\d{0,5}?\s+[A-Za-z0-9' .\/-]{2,100}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Close|Cl|Place|Pl|Way|Terrace|Tce|Crescent|Cres|Court|Ct|Highway|Hwy)\b[^|;\n]*)/i,
    /^[A-Z][A-Z' -]{2,80}\s*:\s*(\d{1,5}[A-Z]?\/?\d{0,5}?\s+[A-Za-z0-9' .\/-]{2,100}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Close|Cl|Place|Pl|Way|Terrace|Tce|Crescent|Cres|Court|Ct|Highway|Hwy)\b[^|;\n]*)/i,
    /^[A-Z][A-Z' -]{2,80}\s+AT\s+(\d{1,5}[A-Z]?\/?\d{0,5}?\s+[A-Za-z0-9' .\/-]{2,100}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Close|Cl|Place|Pl|Way|Terrace|Tce|Crescent|Cres|Court|Ct|Highway|Hwy)\b[^|;\n]*?)\s+(?:called\s+re|in\s+regards\s+to|.*?\bcoming from\b)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const candidate = cleanAddressCandidate(match[1])
    if (candidate && isLikelyAddress(candidate)) return candidate
  }

  return null
}

function extractComplainantAddressFromText(value) {
  const text = String(value || '').trim()
  if (!text) return null

  const patterns = [
    /(?:caller address|address of caller|address of complainant|complainant address|caller lives at|caller is at|caller is from|caller at|caller from|calling from|caller:)\s*(?:is|=|:|-)?\s*([^|;\n]+)/i,
    /(?:caller)\s*[:\-]?\s*([^|;\n]+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const candidate = cleanAddressCandidate(match[1])
    if (candidate && isLikelyAddress(candidate)) return candidate
  }

  const leading = extractLeadingComplainantAddressFromText(text)
  if (leading) return leading

  const candidates = collectAddressCandidates(text)
  if (candidates.length >= 2 && /\b(reporting|called\s+re|in\s+regards\s+to|caller|complainant)\b/i.test(text)) {
    return candidates[0]
  }

  return null
}

function extractNoiseAddressFromText(value, complainantAddress = null) {
  const text = String(value || '').trim()
  if (!text) return null

  const patterns = [
    /(?:noise address|address of noise|address of the noise)\s*(?:is|=|:|-)?\s*([^|;\n]+)/i,
    /(?:noise complaint\s*[-:;]?|noise control\s*[-:;]?)\s*([^|;\n]+)/i,
    /(?:coming from|noise is from)\s*([^|;\n]+)/i,
    /(?:coming\s*[;:,-])\s*([^|;\n]+)/i,
    /(?:loud music at|loud bass music at|noise control\s*[-:]?\s*.*?coming from)\s*([^|;\n]+)/i,
    /(?:noise complaint for|commercial noise complaint for)\s*([^|;\n]+)/i,
    /(?:reporting\s+.*?\s+at|noisy\s+.*?\s+at|loud\s+.*?\s+at)\s*([^|;\n]+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const candidate = cleanAddressCandidate(match[1])
    if (candidate && isLikelyAddress(candidate) && normalizeAddressKey(candidate) !== normalizeAddressKey(complainantAddress)) {
      return candidate
    }
  }

  const candidates = collectAddressCandidates(text)
  if (candidates.length >= 2) {
    const distinct = candidates.filter((candidate) => normalizeAddressKey(candidate) !== normalizeAddressKey(complainantAddress))
    if (distinct.length >= 2) return distinct[1]
    if (distinct.length === 1) return distinct[0]
  }
  for (const candidate of candidates) {
    if (normalizeAddressKey(candidate) !== normalizeAddressKey(complainantAddress)) return candidate
  }

  return null
}

function extractPersonFromText(value) {
  const text = String(value || '').trim()
  if (!text) return null

  const leadingName = text.match(/^([A-Z][A-Z' -]{2,80})\s+(?:0\d[\d\s]{6,})/)
  if (leadingName?.[1]) {
    const candidate = cleanPersonCandidate(leadingName[1])
    if (candidate) return candidate
  }

  const standaloneName = text.match(/(?:^|\n)\s*([A-Z][A-Z' -]{2,80})\s+(?:0\d[\d\s]{6,})(?=\s*(?:\n|$))/m)
  if (standaloneName?.[1]) {
    const candidate = cleanPersonCandidate(standaloneName[1])
    if (candidate) return candidate
  }

  const patterns = [
    /(?:complainant|caller|contact|resident|tenant|person|name)\s*(?:is|=|:|-)?\s*([A-Za-z][A-Za-z .'-]{1,80})/i,
    /(?:spoke with|spoken to|met with|contacted)\s+([A-Za-z][A-Za-z .'-]{1,80})/i,
    /([A-Z][A-Z' -]{2,80})\s*:\s*\d{1,5}[A-Z]?\/?\d{0,5}?\s+[A-Za-z0-9' .\/-]{2,100}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Close|Cl|Place|Pl|Way|Terrace|Tce|Crescent|Cres|Court|Ct|Highway|Hwy)\b/i,
  ]

  for (const pattern of patterns) {
    const keyed = text.match(pattern)
    if (!keyed?.[1]) continue
    const candidate = cleanPersonCandidate(keyed[1])
    if (candidate) return candidate
  }

  const phoneAdjacentPatterns = [
    /(?:^|\.|\s)([A-Z][A-Z' -]{2,80})\s+(?:0\d[\d\s]{6,})/,
    /(?:caller:|complainant:)[^|;\n]*?([A-Z][A-Z' -]{2,80})\s+(?:0\d[\d\s]{6,})/i,
  ]

  for (const pattern of phoneAdjacentPatterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const candidate = cleanPersonCandidate(match[1])
    if (!candidate) continue
    if (/\b(street|road|avenue|drive|lane|crescent|place|terrace|court|way|nelson|stoke|tahunanui|maitai|toi toi)\b/i.test(candidate)) continue
    return candidate
  }

  return null
}

function extractMatrixRefs(value) {
  const text = String(value || '')
  if (!text) return []

  const refs = new Set()
  for (const m of text.matchAll(/matrix\s*(?:no\.?|number|id|#)?\s*[:#-]?\s*([A-Za-z0-9-]{2,40})/gi)) {
    const ref = normalizeText(m[1]).toUpperCase()
    if (ref) refs.add(ref)
  }
  for (const m of text.matchAll(/(?:ref|reference)\s*(?:#|no\.?|number)?\s*[:#-]?\s*(?:matrix\s*)?([A-Za-z0-9-]{3,40})/gi)) {
    const ref = normalizeText(m[1]).toUpperCase()
    if (ref && /\d/.test(ref)) refs.add(ref)
  }
  for (const m of text.matchAll(/\b(?:MX|MTX)[- ]?\d{2,12}\b/gi)) {
    const ref = normalizeText(m[0]).toUpperCase().replace(/\s+/g, '-')
    if (ref) refs.add(ref)
  }

  return [...refs]
}

function inferNoiseEndIssued(value) {
  const text = String(value || '').toLowerCase()
  if (!text) return false
  const signals = [
    'noise end issued',
    'noise-end issued',
    'noise end notice issued',
    'permanent end',
    'permanent-end',
    'end notice issued',
    'abatement notice issued',
    'section 322',
  ]
  return signals.some((s) => text.includes(s))
}

function inferCompletionFromNotes(value) {
  const text = String(value || '').toLowerCase()
  if (!text) return false
  const completionSignals = [
    'completed',
    'complete',
    'resolved',
    'closed',
    'clear',
    'cleared',
    'no further action',
    'job done',
    'finished',
    'abated',
    'noise stopped',
  ]
  return completionSignals.some((signal) => text.includes(signal))
}

function extractVisitResult(comments, followUp) {
  const follow = normalizeText(followUp)
  if (follow) return follow

  const text = normalizeText(comments)
  if (!text) return null

  const outcomeSignals = [
    /no\s+noise\s+on\s+arrival[^|;\n.]*/i,
    /unable\s+to\s+locate\s+noise[^|;\n.]*/i,
    /noise\s+(?:acceptable|deemed\s+acceptable|at\s+reasonable\s+level)[^|;\n.]*/i,
    /verbal\s+war(?:n|ing)[^|;\n.]*/i,
    /(?:issued|iussed)\s+(?:an\s+)?(?:excessive\s+)?noise\s+direction[^|;\n.]*/i,
    /noise\s+end\s+(?:issued|notice\s+issued)[^|;\n.]*/i,
  ]

  for (const pattern of outcomeSignals) {
    const match = text.match(pattern)
    if (match?.[0]) return normalizeText(match[0])
  }

  return null
}

function computeMinutesBetween(startIso, endIso) {
  const start = normalizeText(startIso)
  const end = normalizeText(endIso)
  if (!start || !end) return null
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null
  return Math.round((endMs - startMs) / 60000)
}

function buildFieldConfidence(source, value) {
  if (!value) return { score: 0, source: 'missing' }

  const bySource = {
    complainant_keyed: 0.98,
    complainant_leading: 0.94,
    complainant_dual_candidate: 0.82,
    complainant_second_pass_unlabeled: 0.88,
    noise_keyed: 0.98,
    noise_in_regards: 0.98,
    noise_phrase: 0.92,
    noise_dual_candidate: 0.8,
    noise_second_pass_unlabeled: 0.87,
    noise_second_pass_venue: 0.86,
    client_address_fallback: 0.72,
    named_place: 0.9,
    person_leading_phone: 0.94,
    person_keyed: 0.9,
    person_phone_adjacent: 0.78,
    bob_ai_review: 0.97,
  }

  return {
    score: bySource[source] || 0.6,
    source: source || 'derived',
  }
}

function buildNoiseNarrativeSlots({ notes, noiseAddress, complainantAddress, personName, matrixRefs, noiseEndIssued, completionInNotes }) {
  const text = normalizeText(notes)
  return {
    dual_address_case: Boolean(
      noiseAddress
      && complainantAddress
      && normalizeAddressKey(noiseAddress)
      && normalizeAddressKey(complainantAddress)
      && normalizeAddressKey(noiseAddress) !== normalizeAddressKey(complainantAddress)
    ),
    complainant_anonymous_hint: /\b(anonymous|anon|withheld|refused)\b/i.test(text),
    noise_address_named_place: /\b(park|car park|centre|center|museum|bar|hotel|lodge|cafe|quay|port|market|boathouse|society|grounds)\b/i.test(String(noiseAddress || '')),
    has_person_name: Boolean(personName),
    has_matrix_refs: Array.isArray(matrixRefs) && matrixRefs.length > 0,
    matrix_ref_count: Array.isArray(matrixRefs) ? matrixRefs.length : 0,
    noise_end_issued: noiseEndIssued === true,
    completion_in_notes: completionInNotes === true,
  }
}

function deriveNoiseNarrativeQaReasons({ notes, noiseAddress, complainantAddress, personName, confidence, thresholds = DEFAULT_NARRATIVE_QA_THRESHOLDS }) {
  const qaReasons = []

  if (!noiseAddress) qaReasons.push('missing_noise_address')
  else if ((confidence?.noiseAddress?.score || 0) < Number(thresholds?.noiseAddress || DEFAULT_NARRATIVE_QA_THRESHOLDS.noiseAddress)) qaReasons.push(`low_noise_address_confidence:${confidence?.noiseAddress?.source || 'derived'}`)

  if (complainantAddress && (confidence?.complainantAddress?.score || 0) < Number(thresholds?.complainantAddress || DEFAULT_NARRATIVE_QA_THRESHOLDS.complainantAddress)) qaReasons.push(`low_complainant_address_confidence:${confidence?.complainantAddress?.source || 'derived'}`)

  if (personName && (confidence?.personName?.score || 0) < Number(thresholds?.personName || DEFAULT_NARRATIVE_QA_THRESHOLDS.personName)) qaReasons.push(`low_person_confidence:${confidence?.personName?.source || 'derived'}`)

  return qaReasons
}

function refineNoiseNarrativeSecondPass(text, parsed, addressCandidates) {
  const next = { ...parsed }

  const distinctCandidates = addressCandidates.filter((candidate, index) => {
    const key = normalizeAddressKey(candidate)
    return key && addressCandidates.findIndex((other) => normalizeAddressKey(other) === key) === index
  })
  const hasStrongDualAddressCue = /\b(in\s+regards\s+to|regards\s+to|called\s+re|reporting|caller\s+from|caller\s+at|calling\s+from|coming\s+from|noise\s+.*?\b(?:at|from)\b|loud\s+.*?\b(?:at|from)\b|noisy\s+.*?\b(?:at|from)\b|party\s+noise\s+at)\b/i.test(text)

  if ((!next.complainantAddress || next.complainantAddressSource === 'complainant_dual_candidate') && distinctCandidates.length >= 2) {
    const leadingAddress = distinctCandidates[0]
    if (hasStrongDualAddressCue && (/^(?:[A-Z][A-Z' -]{2,80}[,\s]+)?\d{1,5}[A-Z]?(?:\/\d{1,5}[A-Z]?)?\s+/i.test(text) || /\b(from|caller from|calling from|reporting|called re|in regards to|regards to|caller at)\b/i.test(text))) {
      next.complainantAddress = leadingAddress
      next.complainantAddressSource = 'complainant_second_pass_unlabeled'
    }
  }

  if ((!next.noiseAddress || next.noiseAddressSource === 'noise_dual_candidate') && distinctCandidates.length >= 2) {
    const distinct = distinctCandidates.filter((candidate) => normalizeAddressKey(candidate) !== normalizeAddressKey(next.complainantAddress))
    if (distinct.length >= 1) {
      next.noiseAddress = distinct[0]
      next.noiseAddressSource = /\b(park|car park|centre|center|museum|bar|hotel|lodge|cafe|quay|port|market|boathouse|society|grounds)\b/i.test(distinct[0])
        ? 'named_place'
        : 'noise_second_pass_unlabeled'
    }
  }

  if (!next.noiseAddress) {
    const venueMatch = text.match(/(?:from|at|outside|near|in regards to)\s+((?:the\s+)?[A-Za-z][A-Za-z' .\/-]{2,80}\s(?:park|car park|centre|center|museum|bar|hotel|lodge|cafe|quay|port|market|boathouse|society|grounds))\b/i)
    if (venueMatch?.[1]) {
      const candidate = cleanAddressCandidate(venueMatch[1])
      if (candidate && isLikelyAddress(candidate)) {
        next.noiseAddress = candidate
        next.noiseAddressSource = 'noise_second_pass_venue'
      }
    }
  }

  return next
}

function extractJsonObjectCandidate(text) {
  const value = String(text || '')
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== '{') continue
    for (let end = value.length - 1; end > start; end -= 1) {
      if (value[end] !== '}') continue
      const candidate = value.slice(start, end + 1)
      try {
        return JSON.parse(candidate)
      } catch {
        // continue scanning
      }
    }
  }
  return null
}

function normalizeBobReviewField(value) {
  const text = normalizeText(value)
  if (!text || /^null$/i.test(text) || /^unknown$/i.test(text)) return null
  return text
}

function applyBobNarrativePromotion(candidate, aiReview, autoPromoteThreshold, options = {}) {
  if (!aiReview) return false

  let changed = false
  const meta = candidate.meta || {}
  const row = candidate.row || {}
  const confidence = { ...(meta.parsed_narrative_confidence || {}) }

  const maybePromoteField = (fieldKey, targetKey, currentValue, nextValue, fieldConfidence, minimumConfidence) => {
    if (!nextValue || fieldConfidence < minimumConfidence) return currentValue
    if (currentValue && currentValue === nextValue && (confidence[fieldKey]?.score || 0) >= fieldConfidence) return currentValue
    confidence[fieldKey] = { score: fieldConfidence, source: 'bob_ai_review' }
    changed = true
    return nextValue
  }

  const noiseAddressConfidence = Number(aiReview?.confidence?.noise_address || 0)
  const complainantAddressConfidence = Number(aiReview?.confidence?.complainant_address || 0)
  const personNameConfidence = Number(aiReview?.confidence?.person_name || 0)

  meta.parsed_noise_address = maybePromoteField('noiseAddress', 'parsed_noise_address', meta.parsed_noise_address, normalizeBobReviewField(aiReview.noise_address), noiseAddressConfidence, autoPromoteThreshold)
  meta.parsed_dispatch_address = meta.parsed_noise_address || meta.parsed_dispatch_address || null
  meta.parsed_complainant_address = maybePromoteField('complainantAddress', 'parsed_complainant_address', meta.parsed_complainant_address, normalizeBobReviewField(aiReview.complainant_address), complainantAddressConfidence, autoPromoteThreshold)
  meta.parsed_person_name = maybePromoteField('personName', 'parsed_person_name', meta.parsed_person_name, normalizeBobReviewField(aiReview.person_name), personNameConfidence, autoPromoteThreshold)

  if (Array.isArray(aiReview.matrix_refs) && aiReview.matrix_refs.length > 0 && (!Array.isArray(meta.matrix_refs) || meta.matrix_refs.length === 0)) {
    meta.matrix_refs = aiReview.matrix_refs.map((value) => normalizeText(value)).filter(Boolean)
    changed = true
  }
  if (aiReview.noise_end_issued === true && meta.noise_end_issued !== true) {
    meta.noise_end_issued = true
    changed = true
  }

  if (meta.parsed_noise_address && row.address !== meta.parsed_noise_address) {
    row.address = meta.parsed_noise_address
  }
  row.raw_payload = {
    ...(row.raw_payload || {}),
    parsed_dispatch_address: meta.parsed_dispatch_address || null,
    parsed_noise_address: meta.parsed_noise_address || null,
    parsed_complainant_address: meta.parsed_complainant_address || null,
    parsed_person_name: meta.parsed_person_name || null,
    matrix_refs: meta.matrix_refs || [],
    noise_end_issued: meta.noise_end_issued === true,
  }
  meta.parsed_narrative_confidence = confidence
  meta.ai_review = aiReview
  meta.parsed_narrative_qa_reasons = deriveNoiseNarrativeQaReasons({
    notes: row.notes,
    noiseAddress: meta.parsed_noise_address,
    complainantAddress: meta.parsed_complainant_address,
    personName: meta.parsed_person_name,
    confidence,
    thresholds: options.qaThresholds,
  })
  meta.parsed_narrative_slots = buildNoiseNarrativeSlots({
    notes: row.notes,
    noiseAddress: meta.parsed_noise_address,
    complainantAddress: meta.parsed_complainant_address,
    personName: meta.parsed_person_name,
    matrixRefs: meta.matrix_refs,
    noiseEndIssued: meta.noise_end_issued,
    completionInNotes: meta.completion_in_notes,
  })

  row.raw_payload = {
    ...(row.raw_payload || {}),
    parsed_dispatch_address: meta.parsed_dispatch_address || null,
    parsed_noise_address: meta.parsed_noise_address || null,
    parsed_complainant_address: meta.parsed_complainant_address || null,
    parsed_person_name: meta.parsed_person_name || null,
    parsed_narrative_confidence: confidence,
    parsed_narrative_qa_reasons: meta.parsed_narrative_qa_reasons || [],
    parsed_narrative_slots: meta.parsed_narrative_slots || {},
    matrix_refs: meta.matrix_refs || [],
    noise_end_issued: meta.noise_end_issued === true,
  }

  return changed
}

async function reviewNoiseNarrativesWithBob(alarmCandidates, options = {}) {
  const enabled = Boolean(options.enabled)
  const summary = {
    enabled,
    reviewed: 0,
    promoted_rows: 0,
    promoted_noise_address: 0,
    promoted_complainant_address: 0,
    promoted_person_name: 0,
    skipped: 0,
    failed: 0,
    error_sample: [],
  }

  if (!enabled) return summary

  const limit = Math.max(0, Number(options.limit || 0) || 0)
  const autoPromoteThreshold = Number(options.autoPromoteThreshold || 0.96) || 0.96
  const qaThresholds = options.qaThresholds || DEFAULT_NARRATIVE_QA_THRESHOLDS
  const reviewCandidates = alarmCandidates
    .filter((candidate) => candidate?.meta?.event_type === 'noise')
    .filter((candidate) => Array.isArray(candidate?.meta?.parsed_narrative_qa_reasons) && candidate.meta.parsed_narrative_qa_reasons.length > 0)
    .slice(0, limit || alarmCandidates.length)

  for (const candidate of reviewCandidates) {
    try {
      const prompt = [
        'Extract structured noise complaint fields from this historical note.',
        'Return only valid JSON with this shape:',
        '{',
        '  "noise_address": string|null,',
        '  "complainant_address": string|null,',
        '  "person_name": string|null,',
        '  "matrix_refs": string[],',
        '  "noise_end_issued": boolean,',
        '  "confidence": {',
        '    "noise_address": number,',
        '    "complainant_address": number,',
        '    "person_name": number',
        '  },',
        '  "notes": string',
        '}',
        'Rules:',
        '- Use only explicit evidence from the text.',
        '- If the complainant is anonymous or address is withheld, return null for complainant_address.',
        '- Preserve address text closely; do not invent missing suburb or postcode.',
        '- Confidence must be between 0 and 1.',
        '',
        `Current heuristic parse: ${JSON.stringify({
          noise_address: candidate?.meta?.parsed_noise_address || null,
          complainant_address: candidate?.meta?.parsed_complainant_address || null,
          person_name: candidate?.meta?.parsed_person_name || null,
          qa_reasons: candidate?.meta?.parsed_narrative_qa_reasons || [],
        })}`,
        `Notes: ${candidate?.row?.notes || ''}`,
      ].join('\n')

      const response = await consultBob(prompt, {
        context: {
          task: 'wilsar-noise-note-extraction',
          import_key: candidate.key,
        },
      })
      const parsed = extractJsonObjectCandidate(response)
      if (!parsed || typeof parsed !== 'object') {
        summary.failed += 1
        summary.error_sample.push(`No JSON from Bob for ${candidate.key}`)
        continue
      }

      summary.reviewed += 1
      candidate.meta.ai_review = parsed
      const before = {
        noise: candidate?.meta?.parsed_noise_address || null,
        complainant: candidate?.meta?.parsed_complainant_address || null,
        person: candidate?.meta?.parsed_person_name || null,
      }
      const promoted = applyBobNarrativePromotion(candidate, parsed, autoPromoteThreshold, { qaThresholds })
      if (promoted) {
        summary.promoted_rows += 1
        if ((candidate?.meta?.parsed_noise_address || null) !== before.noise) summary.promoted_noise_address += 1
        if ((candidate?.meta?.parsed_complainant_address || null) !== before.complainant) summary.promoted_complainant_address += 1
        if ((candidate?.meta?.parsed_person_name || null) !== before.person) summary.promoted_person_name += 1
      }
    } catch (error) {
      summary.failed += 1
      if (summary.error_sample.length < 10) summary.error_sample.push(String(error?.message || error || 'Bob review failed'))
    }
  }

  summary.skipped = Math.max(0, reviewCandidates.length - summary.reviewed - summary.failed)
  return summary
}

function parseNoiseNarrative(notes, rawClientAddress, qaThresholds = DEFAULT_NARRATIVE_QA_THRESHOLDS) {
  const text = normalizeText(notes)
  const normalizedClientAddress = !isPlaceholderAddress(rawClientAddress)
    ? normalizeHistoricalAddressText(rawClientAddress)
    : null

  let complainantAddress = null
  let complainantAddressSource = null
  const complainantKeyedPatterns = [
    /(?:caller address|address of caller|address of complainant|complainant address|caller lives at|caller is at|caller is from|caller at|caller from|calling from|caller:)\s*(?:is|=|:|-)?\s*([^|;\n]+)/i,
    /(?:caller)\s*[:\-]?\s*([^|;\n]+)/i,
  ]
  for (const pattern of complainantKeyedPatterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const candidate = cleanAddressCandidate(match[1])
    if (candidate && isLikelyAddress(candidate)) {
      complainantAddress = candidate
      complainantAddressSource = 'complainant_keyed'
      break
    }
  }
  if (!complainantAddress) {
    const leading = extractLeadingComplainantAddressFromText(text)
    if (leading) {
      complainantAddress = leading
      complainantAddressSource = 'complainant_leading'
    }
  }

  const addressCandidates = collectAddressCandidates(text)
  if (!complainantAddress && addressCandidates.length >= 2 && /\b(reporting|called\s+re|in\s+regards\s+to|caller|complainant)\b/i.test(text)) {
    complainantAddress = addressCandidates[0]
    complainantAddressSource = 'complainant_dual_candidate'
  }

  let noiseAddress = null
  let noiseAddressSource = null
  const noisePatterns = [
    { pattern: /(?:noise address|address of noise|address of the noise)\s*(?:is|=|:|-)?\s*([^|;\n]+)/i, source: 'noise_keyed' },
    { pattern: /\b(?:in\s+regards\s+to|regards\s+to|re(?:\.|:)?)\s+([^|;\n]+)/i, source: 'noise_in_regards' },
    { pattern: /\b(?:noise\s+complaint\s+for|noise\s+for)\s+([^|;\n]+)/i, source: 'noise_in_regards' },
    { pattern: /(?:noise complaint\s*[-:;]?|noise control\s*[-:;]?)\s*([^|;\n]+)/i, source: 'noise_phrase' },
    { pattern: /(?:coming from|noise is from)\s*([^|;\n]+)/i, source: 'noise_phrase' },
    { pattern: /(?:coming\s*[;:,-])\s*([^|;\n]+)/i, source: 'noise_phrase' },
    { pattern: /(?:loud music at|loud bass music at|noise control\s*[-:]?\s*.*?coming from)\s*([^|;\n]+)/i, source: 'noise_phrase' },
    { pattern: /(?:noise complaint for|commercial noise complaint for)\s*([^|;\n]+)/i, source: 'noise_phrase' },
    { pattern: /(?:reporting\s+.*?\s+at|noisy\s+.*?\s+at|loud\s+.*?\s+at)\s*([^|;\n]+)/i, source: 'noise_phrase' },
  ]
  for (const { pattern, source } of noisePatterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const candidate = cleanAddressCandidate(match[1])
    if (candidate && isLikelyAddress(candidate) && normalizeAddressKey(candidate) !== normalizeAddressKey(complainantAddress)) {
      noiseAddress = candidate
      noiseAddressSource = /\b(park|car park|centre|center|museum|bar|hotel|lodge|cafe|quay|port|market|boathouse|society|grounds)\b/i.test(candidate)
        ? 'named_place'
        : source
      break
    }
  }

  if (!noiseAddress && addressCandidates.length >= 2) {
    const distinct = addressCandidates.filter((candidate) => normalizeAddressKey(candidate) !== normalizeAddressKey(complainantAddress))
    if (distinct.length >= 2) {
      noiseAddress = distinct[1]
      noiseAddressSource = 'noise_dual_candidate'
    } else if (distinct.length === 1) {
      noiseAddress = distinct[0]
      noiseAddressSource = 'noise_dual_candidate'
    }
  }

  if (!noiseAddress) {
    for (const candidate of addressCandidates) {
      if (normalizeAddressKey(candidate) !== normalizeAddressKey(complainantAddress)) {
        noiseAddress = candidate
        noiseAddressSource = /\b(park|car park|centre|center|museum|bar|hotel|lodge|cafe|quay|port|market|boathouse|society|grounds)\b/i.test(candidate)
          ? 'named_place'
          : 'noise_dual_candidate'
        break
      }
    }
  }

  if (!noiseAddress && normalizedClientAddress) {
    noiseAddress = normalizedClientAddress
    noiseAddressSource = 'client_address_fallback'
  }

  ;({
    complainantAddress,
    complainantAddressSource,
    noiseAddress,
    noiseAddressSource,
  } = refineNoiseNarrativeSecondPass(text, {
    complainantAddress,
    complainantAddressSource,
    noiseAddress,
    noiseAddressSource,
  }, addressCandidates))

  let personName = null
  let personSource = null
  const leadingName = text.match(/^([A-Z][A-Z' -]{2,80})\s+(?:0\d[\d\s]{6,})/)
  if (leadingName?.[1]) {
    const candidate = cleanPersonCandidate(leadingName[1])
    if (candidate) {
      personName = candidate
      personSource = 'person_leading_phone'
    }
  }
  if (!personName) {
    const standaloneName = text.match(/(?:^|\n)\s*([A-Z][A-Z' -]{2,80})\s+(?:0\d[\d\s]{6,})(?=\s*(?:\n|$))/m)
    if (standaloneName?.[1]) {
      const candidate = cleanPersonCandidate(standaloneName[1])
      if (candidate) {
        personName = candidate
        personSource = 'person_leading_phone'
      }
    }
  }
  if (!personName) {
    const personPatterns = [
      /(?:complainant|caller|contact|resident|tenant|person|name)\s*(?:is|=|:|-)?\s*([A-Za-z][A-Za-z .'-]{1,80})/i,
      /(?:spoke with|spoken to|met with|contacted)\s+([A-Za-z][A-Za-z .'-]{1,80})/i,
      /([A-Z][A-Z' -]{2,80})\s*:\s*\d{1,5}[A-Z]?\/?\d{0,5}?\s+[A-Za-z0-9' .\/-]{2,100}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Close|Cl|Place|Pl|Way|Terrace|Tce|Crescent|Cres|Court|Ct|Highway|Hwy)\b/i,
    ]
    for (const pattern of personPatterns) {
      const match = text.match(pattern)
      if (!match?.[1]) continue
      const candidate = cleanPersonCandidate(match[1])
      if (!candidate) continue
      personName = candidate
      personSource = 'person_keyed'
      break
    }
  }
  if (!personName) {
    const phoneAdjacentPatterns = [
      /(?:^|\.|\s)([A-Z][A-Z' -]{2,80})\s+(?:0\d[\d\s]{6,})/,
      /(?:caller:|complainant:)[^|;\n]*?([A-Z][A-Z' -]{2,80})\s+(?:0\d[\d\s]{6,})/i,
    ]
    for (const pattern of phoneAdjacentPatterns) {
      const match = text.match(pattern)
      if (!match?.[1]) continue
      const candidate = cleanPersonCandidate(match[1])
      if (!candidate) continue
      if (/\b(street|road|avenue|drive|lane|crescent|place|terrace|court|way|nelson|stoke|tahunanui|maitai|toi toi)\b/i.test(candidate)) continue
      personName = candidate
      personSource = 'person_phone_adjacent'
      break
    }
  }

  const matrixRefs = extractMatrixRefs(text)
  const noiseEndIssued = inferNoiseEndIssued(text)
  const completionInNotes = inferCompletionFromNotes(text)
  const complainantAddressConfidence = buildFieldConfidence(complainantAddressSource, complainantAddress)
  const noiseAddressConfidence = buildFieldConfidence(noiseAddressSource, noiseAddress)
  const personNameConfidence = buildFieldConfidence(personSource, personName)
  const confidence = {
    noiseAddress: noiseAddressConfidence,
    complainantAddress: complainantAddressConfidence,
    personName: personNameConfidence,
  }
  const qaReasons = deriveNoiseNarrativeQaReasons({
    notes: text,
    noiseAddress,
    complainantAddress,
    personName,
    confidence,
    thresholds: qaThresholds,
  })
  const slots = buildNoiseNarrativeSlots({
    notes: text,
    noiseAddress,
    complainantAddress,
    personName,
    matrixRefs,
    noiseEndIssued,
    completionInNotes,
  })

  return {
    noiseAddress: noiseAddress || null,
    complainantAddress: complainantAddress || null,
    personName: personName || null,
    matrixRefs,
    noiseEndIssued,
    completionInNotes,
    confidence,
    qaReasons,
    slots,
  }
}

function buildNoiseJobRowsFromAlarmCandidates(alarmCandidates) {
  const out = []
  for (const c of alarmCandidates) {
    if (c?.meta?.event_type !== 'noise') continue
    const orgId = c?.row?.organization_id || null
    if (!orgId) continue

    const title = normalizeText(c?.row?.raw_payload?.client_name)
      || normalizeText(c?.meta?.client_name)
      || 'Wilsar historical noise complaint'

    const description = normalizeText(c?.row?.notes) || normalizeText(c?.row?.raw_payload?.dispatch_no)
    const complainantRef = `wilsar:${String(c.key || '').toLowerCase()}`
    const priority = mapNoisePriorityFromText(`${title} ${description}`)
    const noiseType = mapNoiseTypeFromText(`${title} ${description}`)
    const addressFromNotes = normalizeText(c?.meta?.parsed_noise_address || c?.meta?.parsed_dispatch_address)
    const complainantAddress = normalizeText(c?.meta?.parsed_complainant_address)
    const address = addressFromNotes || normalizeText(c?.row?.address)
    const personFromNotes = normalizeText(c?.meta?.parsed_person_name)
    const visitResult = normalizeText(c?.meta?.visit_result)
    const dispatchAt = normalizeText(c?.meta?.dispatch_at || c?.meta?.recorded_at || c?.row?.trigger_time)
    const onsiteAt = normalizeText(c?.meta?.onsite_at || c?.meta?.attendance_at)
    const attendanceEtaAt = normalizeText(c?.meta?.attendance_eta_at)
    const submitClosedAt = normalizeText(c?.meta?.submit_closed_at || c?.meta?.resolved_at || c?.row?.resolved_at)
    const dispatchToOnsiteMinutes = Number.isFinite(Number(c?.meta?.dispatch_to_onsite_minutes))
      ? Number(c?.meta?.dispatch_to_onsite_minutes)
      : computeMinutesBetween(dispatchAt, onsiteAt)
    const matrixRefs = (c?.meta?.matrix_refs || []).filter(Boolean)
    const matrixSummary = matrixRefs.length > 0 ? `Matrix refs: ${matrixRefs.join(', ')}` : null
    const timelineSummary = [
      dispatchAt ? `Dispatch: ${dispatchAt}` : null,
      onsiteAt ? `Onsite: ${onsiteAt}` : null,
      attendanceEtaAt ? `Attendance ETA: ${attendanceEtaAt}` : null,
      Number.isFinite(dispatchToOnsiteMinutes) ? `Dispatch->Onsite mins: ${dispatchToOnsiteMinutes}` : null,
      submitClosedAt ? `Submit/Closed: ${submitClosedAt}` : null,
    ].filter(Boolean).join(' | ')
    const outcomeNoteParts = [
      visitResult ? `Visit result: ${visitResult}` : null,
      timelineSummary || null,
      complainantAddress ? `Complainant address: ${complainantAddress}` : null,
      personFromNotes ? `Person: ${personFromNotes}` : null,
      matrixSummary,
    ].filter(Boolean)
    const noiseEndIssued = Boolean(c?.meta?.noise_end_issued)
    const resolvedAtByTimestamp = c?.meta?.resolved_at || c?.row?.resolved_at || null
    const resolvedAtByNotes = inferCompletionFromNotes(description)
      ? (c?.meta?.recorded_at || c?.row?.trigger_time || null)
      : null
    const resolvedAt = resolvedAtByTimestamp || resolvedAtByNotes

    out.push({
      key: complainantRef,
      row: {
        organization_id: orgId,
        title,
        address: address || 'Unknown',
        suburb: null,
        city: null,
        noise_type: noiseType,
        priority,
        complaint_source: 'council_referral',
        complaint_description: description || null,
        complainant_ref: complainantRef,
        address_history_notes: outcomeNoteParts.length > 0 ? outcomeNoteParts.join(' | ') : null,
        has_permanent_end: noiseEndIssued,
        prior_notice_summary: matrixSummary,
        outcome: noiseEndIssued ? 'noise_end_issued' : (visitResult ? 'visit_recorded' : null),
        outcome_notes: outcomeNoteParts.length > 0 ? outcomeNoteParts.join(' | ') : null,
        status: resolvedAt ? 'completed' : 'pending',
        completed_at: resolvedAt,
      },
    })
  }
  return out
}

async function insertNoiseJobsFromHistoricalAlarms(supabase, providerOrgs, alarmCandidates, apply) {
  const candidates = buildNoiseJobRowsFromAlarmCandidates(alarmCandidates)
  const byOrg = new Map()
  for (const c of candidates) {
    const orgId = c.row.organization_id
    if (!byOrg.has(orgId)) byOrg.set(orgId, [])
    byOrg.get(orgId).push(c)
  }

  const summary = {
    table_available: true,
    candidates: candidates.length,
    existing_matches: 0,
    backfilled_completed: 0,
    backfilled_enrichment: 0,
    pending: 0,
    inserted: 0,
    failed: 0,
    error_sample: [],
  }

  for (const org of providerOrgs.values()) {
    const orgCandidates = byOrg.get(org.id) || []
    if (orgCandidates.length === 0) continue

    const existingState = await fetchExistingNoiseJobRefs(supabase, org.id)
    if (!existingState.tableAvailable) {
      summary.table_available = false
      summary.error_sample = ['noise_jobs table is not available in this environment; skipped']
      break
    }

    const existingMatches = orgCandidates.filter((c) => existingState.refs.has(c.key))
    summary.existing_matches += existingMatches.length

    if (apply && existingMatches.length > 0) {
      for (const candidate of existingMatches) {
        const existing = existingState.byRef.get(candidate.key)
        const shouldBackfillCompleted = Boolean(
          candidate?.row?.completed_at
            && existing?.id
            && existing?.status !== 'completed',
        )
        const shouldBackfillEnrichment = Boolean(
          existing?.id && (
            (candidate?.row?.address && candidate.row.address !== 'Unknown')
              || candidate?.row?.address_history_notes
              || candidate?.row?.prior_notice_summary
              || candidate?.row?.outcome_notes
              || candidate?.row?.has_permanent_end
          ),
        )
        if (!shouldBackfillCompleted && !shouldBackfillEnrichment) continue

        const updatePayload = {
          updated_at: new Date().toISOString(),
        }
        if (shouldBackfillCompleted) {
          updatePayload.status = 'completed'
          updatePayload.completed_at = candidate.row.completed_at
        }
        if (candidate?.row?.address && candidate.row.address !== 'Unknown') updatePayload.address = candidate.row.address
        if (candidate?.row?.address_history_notes) updatePayload.address_history_notes = candidate.row.address_history_notes
        if (candidate?.row?.prior_notice_summary) updatePayload.prior_notice_summary = candidate.row.prior_notice_summary
        if (candidate?.row?.outcome_notes) updatePayload.outcome_notes = candidate.row.outcome_notes
        if (candidate?.row?.outcome) updatePayload.outcome = candidate.row.outcome
        if (candidate?.row?.has_permanent_end) updatePayload.has_permanent_end = true

        const { error: backfillError } = await supabase
          .from('noise_jobs')
          .update(updatePayload)
          .eq('id', existing.id)

        if (backfillError) {
          summary.error_sample.push(`noise_jobs completion backfill failed (${existing.id}): ${backfillError.message}`)
        } else {
          if (shouldBackfillCompleted) summary.backfilled_completed += 1
          if (shouldBackfillEnrichment) summary.backfilled_enrichment += 1
        }
      }
    }

    const pending = orgCandidates.filter((c) => !existingState.refs.has(c.key))
    summary.pending += pending.length
    if (!apply || pending.length === 0) continue

    const counter = await getNoiseCounterByOrg(supabase, org.id)
    let nextNumber = counter.lastNumber
    const currentYear = new Date().getFullYear()

    const pendingRows = pending.map((c) => {
      nextNumber += 1
      return {
        ...c.row,
        job_number: `NCJ-${currentYear}-${String(nextNumber).padStart(6, '0')}`,
      }
    })

    let insert = await supabase.from('noise_jobs').insert(pendingRows)
    if (insert.error && String(insert.error.message || '').includes('complainant_ref')) {
      const withoutRef = pendingRows.map((row) => {
        const { complainant_ref, ...rest } = row
        return rest
      })
      insert = await supabase.from('noise_jobs').insert(withoutRef)
    }
    if (insert.error) {
      summary.failed += pendingRows.length
      summary.error_sample.push(insert.error.message || 'Unknown noise_jobs insert error')
      continue
    }

    summary.inserted += pendingRows.length
    if (counter.tableAvailable) {
      const { error: counterError } = await supabase
        .from('noise_job_counters')
        .upsert({ organization_id: org.id, last_number: nextNumber }, { onConflict: 'organization_id' })
      if (counterError) {
        summary.error_sample.push(`noise_job_counters update failed for ${org.name}: ${counterError.message}`)
      }
    }
  }

  return summary
}

async function syncNoiseLoiPoiFromNotes(supabase, alarmCandidates, apply) {
  const summary = {
    loi_table_available: true,
    poi_table_available: true,
    noise_with_address: 0,
    noise_with_noise_address: 0,
    noise_with_complainant_address: 0,
    noise_with_person: 0,
    noise_with_matrix_refs: 0,
    noise_end_issued: 0,
    loi_matched: 0,
    loi_updated: 0,
    loi_created: 0,
    poi_matched: 0,
    poi_updated: 0,
    poi_created: 0,
    error_sample: [],
  }

  const LOI_CREATE_CONFIDENCE_THRESHOLD = 0.85
  const POI_CREATE_CONFIDENCE_THRESHOLD = 0.85

  const addressEntriesByOrg = new Map()
  const personEntriesByOrg = new Map()

  for (const c of alarmCandidates) {
    if (c?.meta?.event_type !== 'noise') continue
    const orgId = c?.row?.organization_id || null
    if (!orgId) continue

    const noiseAddress = normalizeText(c?.meta?.parsed_noise_address || c?.meta?.parsed_dispatch_address || c?.row?.address)
    const complainantAddress = normalizeText(c?.meta?.parsed_complainant_address)
    const personName = normalizeText(c?.meta?.parsed_person_name)
    const matrixRefs = (c?.meta?.matrix_refs || []).filter(Boolean)
    const noiseEndIssued = Boolean(c?.meta?.noise_end_issued)

    if (noiseAddress) {
      summary.noise_with_address += 1
      summary.noise_with_noise_address += 1
      const key = normalizeAddressKey(noiseAddress)
      if (key) {
        if (!addressEntriesByOrg.has(orgId)) addressEntriesByOrg.set(orgId, new Map())
        if (!addressEntriesByOrg.get(orgId).has(key)) {
          addressEntriesByOrg.get(orgId).set(key, {
            key,
            orgId,
            address: noiseAddress,
            role: 'noise',
            confidence: c?.meta?.parsed_narrative_confidence?.noiseAddress?.score || 0,
            matrixRefs: [...matrixRefs],
            personName: personName || null,
          })
        } else {
          const existing = addressEntriesByOrg.get(orgId).get(key)
          existing.matrixRefs = [...new Set([...(existing.matrixRefs || []), ...matrixRefs])]
          if (!existing.personName && personName) existing.personName = personName
          existing.confidence = Math.max(existing.confidence || 0, c?.meta?.parsed_narrative_confidence?.noiseAddress?.score || 0)
        }
      }
    }
    if (complainantAddress) {
      summary.noise_with_complainant_address += 1
      const key = normalizeAddressKey(complainantAddress)
      if (key) {
        if (!addressEntriesByOrg.has(orgId)) addressEntriesByOrg.set(orgId, new Map())
        if (!addressEntriesByOrg.get(orgId).has(key)) {
          addressEntriesByOrg.get(orgId).set(key, {
            key,
            orgId,
            address: complainantAddress,
            role: 'complainant',
            confidence: c?.meta?.parsed_narrative_confidence?.complainantAddress?.score || 0,
            matrixRefs: [...matrixRefs],
            personName: personName || null,
          })
        } else {
          const existing = addressEntriesByOrg.get(orgId).get(key)
          existing.matrixRefs = [...new Set([...(existing.matrixRefs || []), ...matrixRefs])]
          if (!existing.personName && personName) existing.personName = personName
          if (existing.role !== 'noise') existing.role = 'complainant'
          existing.confidence = Math.max(existing.confidence || 0, c?.meta?.parsed_narrative_confidence?.complainantAddress?.score || 0)
        }
      }
    }
    if (personName) {
      summary.noise_with_person += 1
      const key = normalizePersonKey(personName)
      if (key) {
        if (!personEntriesByOrg.has(orgId)) personEntriesByOrg.set(orgId, new Map())
        if (!personEntriesByOrg.get(orgId).has(key)) {
          personEntriesByOrg.get(orgId).set(key, {
            key,
          orgId,
            personName,
            address: complainantAddress || noiseAddress || null,
            confidence: c?.meta?.parsed_narrative_confidence?.personName?.score || 0,
            matrixRefs: [...matrixRefs],
        })
        } else {
          const existing = personEntriesByOrg.get(orgId).get(key)
          existing.matrixRefs = [...new Set([...(existing.matrixRefs || []), ...matrixRefs])]
          if (!existing.address && (complainantAddress || noiseAddress)) existing.address = complainantAddress || noiseAddress
          existing.confidence = Math.max(existing.confidence || 0, c?.meta?.parsed_narrative_confidence?.personName?.score || 0)
        }
      }
    }
    if (matrixRefs.length > 0) summary.noise_with_matrix_refs += 1
    if (noiseEndIssued) summary.noise_end_issued += 1
  }

  if (!apply) return summary

  for (const [orgId, entryMap] of addressEntriesByOrg.entries()) {
    let existingLoiRows = []
    try {
      const lookup = await supabase
        .from('locations_of_interest')
        .select('id,address_full,display_address,address_line1,description')
        .eq('organization_id', orgId)

      if (lookup.error && String(lookup.error.message || '').includes("Could not find the table 'public.locations_of_interest'")) {
        summary.loi_table_available = false
        break
      }
      if (lookup.error) {
        summary.error_sample.push(`LOI preload failed (${orgId}): ${lookup.error.message}`)
        continue
      }
      existingLoiRows = lookup.data || []
    } catch (error) {
      summary.error_sample.push(`LOI preload exception (${orgId}): ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    const loiByAddressKey = new Map()
    for (const row of existingLoiRows) {
      const variants = [row.address_full, row.display_address, row.address_line1]
      for (const variant of variants) {
        const key = normalizeAddressKey(variant)
        if (key && !loiByAddressKey.has(key)) loiByAddressKey.set(key, row)
      }
    }

    for (const entry of entryMap.values()) {
      try {
        const existing = loiByAddressKey.get(entry.key) || null
        const matrixSummary = entry.matrixRefs.length > 0 ? `Matrix refs: ${entry.matrixRefs.join(', ')}` : null
        const descriptionParts = [
          'Imported from Wilsar noise notes',
          entry.role === 'complainant' ? 'Complainant address' : 'Noise address',
          entry.personName ? `Person: ${entry.personName}` : null,
          matrixSummary,
        ].filter(Boolean)

        if (existing?.id) {
          summary.loi_matched += 1
          const existingDescription = normalizeText(existing.description)
          const desiredDescription = descriptionParts.join(' | ')
          if (desiredDescription && !existingDescription.includes(desiredDescription)) {
            const update = await supabase
              .from('locations_of_interest')
              .update({ description: [existingDescription, desiredDescription].filter(Boolean).join(' | ').slice(0, 2000) })
              .eq('id', existing.id)
            if (update.error) {
              summary.error_sample.push(`LOI update failed (${existing.id}): ${update.error.message}`)
            } else {
              summary.loi_updated += 1
            }
          }
          continue
        }

        if ((entry.confidence || 0) < LOI_CREATE_CONFIDENCE_THRESHOLD) {
          continue
        }

        const payloadVariants = [
          {
            organization_id: orgId,
            loi_kind: 'address',
            name: `Wilsar Noise ${entry.address}`.slice(0, 120),
            description: descriptionParts.join(' | '),
            address_line1: entry.address,
            address_full: entry.address,
            display_address: entry.address,
            is_active: true,
          },
          {
            organization_id: orgId,
            name: `Wilsar Noise ${entry.address}`.slice(0, 120),
            description: descriptionParts.join(' | '),
            address_full: entry.address,
            display_address: entry.address,
            is_active: true,
          },
          {
            organization_id: orgId,
            name: `Wilsar Noise ${entry.address}`.slice(0, 120),
            description: descriptionParts.join(' | '),
          },
        ]

        let insertedRow = null
        for (const payload of payloadVariants) {
          const result = await supabase.from('locations_of_interest').insert(payload).select('id,address_full,display_address,address_line1,description').single()
          if (!result.error && result.data?.id) {
            insertedRow = result.data
            break
          }
        }

        if (insertedRow?.id) {
          summary.loi_created += 1
          const insertedKey = normalizeAddressKey(insertedRow.address_full || insertedRow.display_address || insertedRow.address_line1 || entry.address)
          if (insertedKey && !loiByAddressKey.has(insertedKey)) loiByAddressKey.set(insertedKey, insertedRow)
        } else {
          summary.error_sample.push(`LOI insert failed (${entry.address})`)
        }
      } catch (error) {
        summary.error_sample.push(`LOI sync exception: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  for (const [orgId, entryMap] of personEntriesByOrg.entries()) {
    let existingPoiRows = []
    try {
      const lookup = await supabase
        .from('canonical_persons')
        .select('id,full_name,notes,is_poi')
        .eq('organization_id', orgId)

      if (lookup.error && String(lookup.error.message || '').includes("Could not find the table 'public.canonical_persons'")) {
        summary.poi_table_available = false
        break
      }
      if (lookup.error) {
        summary.error_sample.push(`POI preload failed (${orgId}): ${lookup.error.message}`)
        continue
      }
      existingPoiRows = lookup.data || []
    } catch (error) {
      summary.error_sample.push(`POI preload exception (${orgId}): ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    const poiByNameKey = new Map()
    for (const row of existingPoiRows) {
      const key = normalizePersonKey(row.full_name)
      if (key && !poiByNameKey.has(key)) poiByNameKey.set(key, row)
    }

    for (const entry of entryMap.values()) {
      try {
        const existing = poiByNameKey.get(entry.key) || null
        const noteParts = [
          'Imported from Wilsar noise notes',
          entry.address ? `Address: ${entry.address}` : null,
          entry.matrixRefs.length > 0 ? `Matrix refs: ${entry.matrixRefs.join(', ')}` : null,
        ].filter(Boolean)

        if (existing?.id) {
          summary.poi_matched += 1
          const currentNotes = normalizeText(existing.notes)
          const desiredNotes = noteParts.join(' | ')
          const updatePayload = {}
          if (desiredNotes && !currentNotes.includes(desiredNotes)) {
            updatePayload.notes = [currentNotes, desiredNotes].filter(Boolean).join(' | ').slice(0, 2000)
          }
          if (existing.is_poi !== true) updatePayload.is_poi = true
          if (Object.keys(updatePayload).length > 0) {
            const update = await supabase.from('canonical_persons').update(updatePayload).eq('id', existing.id)
            if (update.error) {
              summary.error_sample.push(`POI update failed (${existing.id}): ${update.error.message}`)
            } else {
              summary.poi_updated += 1
            }
          }
          continue
        }

        if ((entry.confidence || 0) < POI_CREATE_CONFIDENCE_THRESHOLD) {
          continue
        }

        const payloadVariants = [
          {
            organization_id: orgId,
            full_name: entry.personName,
            identity_status: 'partial',
            is_poi: true,
            notes: noteParts.join(' | '),
            flagged_reason: 'Wilsar historical noise contact',
          },
          {
            organization_id: orgId,
            full_name: entry.personName,
            is_poi: true,
            notes: noteParts.join(' | '),
          },
          {
            organization_id: orgId,
            full_name: entry.personName,
            notes: noteParts.join(' | '),
          },
        ]

        let insertedRow = null
        for (const payload of payloadVariants) {
          const result = await supabase.from('canonical_persons').insert(payload).select('id,full_name,notes,is_poi').single()
          if (!result.error && result.data?.id) {
            insertedRow = result.data
            break
          }
        }

        if (insertedRow?.id) {
          summary.poi_created += 1
          const insertedKey = normalizePersonKey(insertedRow.full_name || entry.personName)
          if (insertedKey && !poiByNameKey.has(insertedKey)) poiByNameKey.set(insertedKey, insertedRow)
        } else {
          summary.error_sample.push(`POI insert failed (${entry.personName})`)
        }
      } catch (error) {
        summary.error_sample.push(`POI sync exception: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  return summary
}

function escapeCsvValue(value) {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function writeNoiseNarrativeQaExport(alarmCandidates, options = {}) {
  const outPath = normalizeText(options.outPath) || '/tmp/wilsar-noise-note-review.csv'
  const includeAll = Boolean(options.includeAll)
  const thresholds = options.qaThresholds || DEFAULT_NARRATIVE_QA_THRESHOLDS
  const rows = []
  for (const candidate of alarmCandidates) {
    if (candidate?.meta?.event_type !== 'noise') continue
    const confidence = candidate?.meta?.parsed_narrative_confidence || {}
    const qaReasons = candidate?.meta?.parsed_narrative_qa_reasons || []
    if (!includeAll && !qaReasons.length) continue
    const aiReview = candidate?.meta?.ai_review || {}
    const slots = candidate?.meta?.parsed_narrative_slots || {}

    rows.push({
      import_key: candidate.key,
      dispatch_no: candidate?.meta?.dispatch_no || '',
      organization_id: candidate?.row?.organization_id || '',
      qa_status: qaReasons.length ? 'needs_review' : 'pass',
      qa_reason_count: qaReasons.length,
      qa_noise_threshold: thresholds.noiseAddress,
      qa_complainant_threshold: thresholds.complainantAddress,
      qa_person_threshold: thresholds.personName,
      noise_address: candidate?.meta?.parsed_noise_address || '',
      noise_address_confidence: confidence?.noiseAddress?.score || 0,
      noise_address_source: confidence?.noiseAddress?.source || '',
      complainant_address: candidate?.meta?.parsed_complainant_address || '',
      complainant_address_confidence: confidence?.complainantAddress?.score || 0,
      complainant_address_source: confidence?.complainantAddress?.source || '',
      person_name: candidate?.meta?.parsed_person_name || '',
      person_confidence: confidence?.personName?.score || 0,
      person_source: confidence?.personName?.source || '',
      ai_noise_address: aiReview?.noise_address || '',
      ai_noise_address_confidence: aiReview?.confidence?.noise_address || 0,
      ai_complainant_address: aiReview?.complainant_address || '',
      ai_complainant_address_confidence: aiReview?.confidence?.complainant_address || 0,
      ai_person_name: aiReview?.person_name || '',
      ai_person_confidence: aiReview?.confidence?.person_name || 0,
      slot_dual_address_case: slots?.dual_address_case === true ? 'true' : 'false',
      slot_complainant_anonymous_hint: slots?.complainant_anonymous_hint === true ? 'true' : 'false',
      slot_noise_address_named_place: slots?.noise_address_named_place === true ? 'true' : 'false',
      slot_has_person_name: slots?.has_person_name === true ? 'true' : 'false',
      slot_has_matrix_refs: slots?.has_matrix_refs === true ? 'true' : 'false',
      slot_matrix_ref_count: Number(slots?.matrix_ref_count || 0),
      slot_noise_end_issued: slots?.noise_end_issued === true ? 'true' : 'false',
      slot_completion_in_notes: slots?.completion_in_notes === true ? 'true' : 'false',
      qa_reasons: qaReasons.join('|'),
      notes: candidate?.row?.notes || '',
    })
  }
  const headers = [
    'import_key',
    'dispatch_no',
    'organization_id',
    'qa_status',
    'qa_reason_count',
    'qa_noise_threshold',
    'qa_complainant_threshold',
    'qa_person_threshold',
    'noise_address',
    'noise_address_confidence',
    'noise_address_source',
    'complainant_address',
    'complainant_address_confidence',
    'complainant_address_source',
    'person_name',
    'person_confidence',
    'person_source',
    'ai_noise_address',
    'ai_noise_address_confidence',
    'ai_complainant_address',
    'ai_complainant_address_confidence',
    'ai_person_name',
    'ai_person_confidence',
    'slot_dual_address_case',
    'slot_complainant_anonymous_hint',
    'slot_noise_address_named_place',
    'slot_has_person_name',
    'slot_has_matrix_refs',
    'slot_matrix_ref_count',
    'slot_noise_end_issued',
    'slot_completion_in_notes',
    'qa_reasons',
    'notes',
  ]
  const content = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ].join('\n')
  fs.writeFileSync(outPath, content)
  return { path: outPath, rows: rows.length }
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

function buildObservationRowsFromEvents(eventType, candidates, routeByZoneCode) {
  const out = []
  for (const c of candidates) {
    const recordedAt = c?.meta?.recorded_at
    if (!recordedAt) continue

    const zoneCode = c?.meta?.zone_code || null
    const route = zoneCode ? routeByZoneCode.get(zoneCode) || null : null
    const zoneId = c?.row?.zone_id || route?.zone_id || null
    const loiId = route?.loi_id || null
    const organizationId = c?.row?.organization_id || route?.org_id || null
    const siteCode = normalizeText(c?.meta?.site_code) || null
    const plateSeed = c?.meta?.client_id || c?.meta?.dispatch_no || c?.meta?.client_name || c?.key
    const plate = buildEventPlate(plateSeed, eventType === 'alarm' ? 'NCCA' : 'NCCP')
    const obsKey = `import:wilsar-nelson:obs:${eventType}:${c.key}`

    const noteParts = [
      `[WILSAR_OBS_KEY:${obsKey}]`,
      `[EVENT_TYPE:${eventType}]`,
      siteCode ? `[SITE_CODE:${siteCode}]` : null,
      `[SOURCE:${SOURCE.bucket}/${eventType === 'alarm' ? SOURCE.alarmPath : SOURCE.patrolPath}]`,
      c?.row?.description || c?.row?.notes || '',
    ].filter(Boolean)

    out.push({
      key: obsKey,
      row: {
        organization_id: organizationId,
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
  return out.filter((entry) => Boolean(entry?.row?.organization_id))
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

  const providerOrgNames = [...new Set([
    TARGET_PROVIDER_ORG_DEFAULT,
    ...Object.values(TARGET_PROVIDER_ORG_BY_ZONE),
  ])]
  const providerOrgs = new Map()
  for (const orgName of providerOrgNames) {
    const org = await getOrganizationByName(supabase, orgName)
    if (!org?.id) throw new Error(`Organization not found: ${orgName}`)
    providerOrgs.set(orgName, org)
  }

  const ncc = await getOrganizationByName(supabase, TARGET_CLIENT_ORG)
  if (!ncc?.id) throw new Error(`Organization not found: ${TARGET_CLIENT_ORG}`)

  const dryRun = !args.apply
  const { data: patrolBlob, error: patrolDownloadError } = await supabase.storage.from(SOURCE.bucket).download(SOURCE.patrolPath)
  if (patrolDownloadError || !patrolBlob) {
    throw new Error(`Failed downloading ${SOURCE.bucket}/${SOURCE.patrolPath}: ${patrolDownloadError?.message || 'Unknown error'}`)
  }

  const alarmFiles = await downloadAvailableStorageFiles(supabase, SOURCE.bucket, SOURCE.alarmPaths)
  if (alarmFiles.length === 0) {
    throw new Error(`Failed downloading alarm/noise files from ${SOURCE.bucket}. Tried: ${SOURCE.alarmPaths.join(', ')}`)
  }

  const patrolRowsRaw = parseRowsFromBuffer(Buffer.from(await patrolBlob.arrayBuffer()))
  const alarmRowsByFile = []
  for (const file of alarmFiles) {
    const rows = parseRowsFromBuffer(Buffer.from(await file.blob.arrayBuffer()))
    alarmRowsByFile.push({ path: file.path, rows })
  }
  const alarmRowsRaw = alarmRowsByFile.flatMap((x) => x.rows)

  const requiredZoneCodes = collectZoneCodes([...patrolRowsRaw, ...alarmRowsRaw])
  const zoneDomainsByCode = buildZoneDomainMap(patrolRowsRaw, alarmRowsRaw)
  const requiredByOrgName = new Map()
  for (const code of requiredZoneCodes) {
    const orgName = getProviderOrgNameForZone(code)
    if (!requiredByOrgName.has(orgName)) requiredByOrgName.set(orgName, new Set())
    requiredByOrgName.get(orgName).add(code)
  }
  for (const code of Object.keys(TARGET_PROVIDER_ORG_BY_ZONE)) {
    const orgName = getProviderOrgNameForZone(code)
    if (!requiredByOrgName.has(orgName)) requiredByOrgName.set(orgName, new Set())
    requiredByOrgName.get(orgName).add(code)
  }

  const zoneStateByOrgName = new Map()
  for (const [orgName, codeSet] of requiredByOrgName.entries()) {
    const org = providerOrgs.get(orgName)
    const state = await ensureOrgZones(supabase, org.id, args.apply, [...codeSet], zoneDomainsByCode)
    zoneStateByOrgName.set(orgName, state)
  }

  const routeByZoneCode = new Map()
  for (const code of requiredZoneCodes) {
    const orgName = getProviderOrgNameForZone(code)
    const org = providerOrgs.get(orgName)
    const zoneState = zoneStateByOrgName.get(orgName)
    routeByZoneCode.set(code, {
      org_id: org.id,
      zone_id: zoneState?.byCode?.get(code) || null,
      loi_id: zoneState?.loiByCode?.get(code) || null,
      org_name: org.name,
    })
  }
  const defaultOrg = providerOrgs.get(TARGET_PROVIDER_ORG_DEFAULT)
  const defaultZoneState = zoneStateByOrgName.get(TARGET_PROVIDER_ORG_DEFAULT)
  routeByZoneCode.set(UNMAPPED_ZONE_CODE, {
    org_id: defaultOrg.id,
    zone_id: defaultZoneState?.byCode?.get(UNMAPPED_ZONE_CODE) || null,
    loi_id: defaultZoneState?.loiByCode?.get(UNMAPPED_ZONE_CODE) || null,
    org_name: defaultOrg.name,
  })

  const patrolCandidates = buildPatrolRows(patrolRowsRaw, routeByZoneCode)
  const narrativeQaThresholds = {
    noiseAddress: resolveThreshold(
      args.qaNoiseThreshold,
      process.env.WILSAR_NOISE_QA_NOISE_THRESHOLD,
      DEFAULT_NARRATIVE_QA_THRESHOLDS.noiseAddress,
    ),
    complainantAddress: resolveThreshold(
      args.qaComplainantThreshold,
      process.env.WILSAR_NOISE_QA_COMPLAINANT_THRESHOLD,
      DEFAULT_NARRATIVE_QA_THRESHOLDS.complainantAddress,
    ),
    personName: resolveThreshold(
      args.qaPersonThreshold,
      process.env.WILSAR_NOISE_QA_PERSON_THRESHOLD,
      DEFAULT_NARRATIVE_QA_THRESHOLDS.personName,
    ),
  }
  const alarmCandidates = alarmRowsByFile.flatMap((entry) =>
    buildAlarmRows(entry.rows, routeByZoneCode, entry.path, narrativeQaThresholds),
  )

  const siteSeeds = collectClientSiteSeeds(patrolCandidates, alarmCandidates)
  const siteSeedsByOrgName = new Map()
  for (const seed of siteSeeds) {
    const orgName = getProviderOrgNameForZone(seed.zoneCode)
    if (!siteSeedsByOrgName.has(orgName)) siteSeedsByOrgName.set(orgName, [])
    siteSeedsByOrgName.get(orgName).push(seed)
  }

  const clientSiteStateByOrgName = new Map()
  for (const [orgName, seeds] of siteSeedsByOrgName.entries()) {
    const org = providerOrgs.get(orgName)
    const zoneState = zoneStateByOrgName.get(orgName)
    const siteState = await ensureClientSites(
      supabase,
      org.id,
      zoneState.byCode,
      zoneState.loiByCode,
      seeds,
      args.apply,
    )
    clientSiteStateByOrgName.set(orgName, siteState)
  }

  const existingPatrol = new Set()
  const existingAlarmKeys = new Set()
  let alarmTableAvailable = true
  const existingObservation = new Set()
  for (const org of providerOrgs.values()) {
    const patrolKeys = await fetchExistingPatrolKeys(supabase, org.id)
    for (const key of patrolKeys) existingPatrol.add(key)

    const alarmState = await fetchExistingAlarmKeys(supabase, org.id)
    alarmTableAvailable = alarmTableAvailable && alarmState.tableAvailable
    for (const key of alarmState.keys) existingAlarmKeys.add(key)

    const observationKeys = await fetchExistingObservationKeys(supabase, org.id)
    for (const key of observationKeys) existingObservation.add(key)
  }

  const patrolPending = patrolCandidates.filter((x) => !existingPatrol.has(x.key))
  const alarmPending = alarmCandidates.filter((x) => !existingAlarmKeys.has(x.key))

  const observationFromPatrol = buildObservationRowsFromEvents('patrol', patrolCandidates, routeByZoneCode)
  const observationFromAlarm = buildObservationRowsFromEvents('alarm', alarmCandidates, routeByZoneCode)
  const observationCandidates = [...observationFromPatrol, ...observationFromAlarm]
  const observationPending = observationCandidates.filter((x) => !existingObservation.has(x.key))

  let patrolResult = { inserted: 0, failed: 0, errors: [] }
  let alarmResult = { inserted: 0, failed: 0, errors: [] }
  let observationResult = { inserted: 0, failed: 0, errors: [] }
  let noiseJobsResult = { table_available: true, candidates: 0, existing_matches: 0, pending: 0, inserted: 0, failed: 0, error_sample: [] }
  let noiseLoiPoiResult = {
    loi_table_available: true,
    poi_table_available: true,
    noise_with_address: 0,
    noise_with_person: 0,
    noise_with_matrix_refs: 0,
    noise_end_issued: 0,
    loi_matched: 0,
    loi_updated: 0,
    loi_created: 0,
    poi_matched: 0,
    poi_updated: 0,
    poi_created: 0,
    error_sample: [],
  }
  let noiseAiReviewResult = {
    enabled: false,
    reviewed: 0,
    promoted_rows: 0,
    promoted_noise_address: 0,
    promoted_complainant_address: 0,
    promoted_person_name: 0,
    skipped: 0,
    failed: 0,
    error_sample: [],
  }
  let noiseQaExportResult = { path: null, rows: 0 }
  let canonicalVehiclesUpserted = 0

  if (!dryRun) {
    patrolResult = await insertBatches(supabase, 'patrols', patrolPending.map((x) => x.row), 250)
    if (alarmTableAvailable) {
      alarmResult = await insertBatches(supabase, 'alarm_events', alarmPending.map((x) => x.row), 250)
    }
    canonicalVehiclesUpserted = await ensureCanonicalVehicles(supabase, observationPending.map((x) => x.row.plate_number), true)
    observationResult = await insertBatches(supabase, 'observations', observationPending.map((x) => x.row), 250)
  }
  const aiReviewEnabled = args.aiReview || String(process.env.WILSAR_NOISE_AI_REVIEW || '').trim().toLowerCase() === 'true'
  const aiReviewLimit = Number.isFinite(args.aiReviewLimit) ? args.aiReviewLimit : (Number.parseInt(String(process.env.WILSAR_NOISE_AI_REVIEW_LIMIT || '100'), 10) || 100)
  const aiAutoPromoteThreshold = Number.isFinite(args.aiAutoPromoteThreshold)
    ? args.aiAutoPromoteThreshold
    : (Number.parseFloat(String(process.env.WILSAR_NOISE_AI_AUTO_PROMOTE_THRESHOLD || '0.96')) || 0.96)

  noiseAiReviewResult = await reviewNoiseNarrativesWithBob(alarmCandidates, {
    enabled: aiReviewEnabled,
    limit: aiReviewLimit,
    autoPromoteThreshold: aiAutoPromoteThreshold,
    qaThresholds: narrativeQaThresholds,
  })
  noiseJobsResult = await insertNoiseJobsFromHistoricalAlarms(supabase, providerOrgs, alarmCandidates, args.apply)
  noiseLoiPoiResult = await syncNoiseLoiPoiFromNotes(supabase, alarmCandidates, args.apply)
  noiseQaExportResult = writeNoiseNarrativeQaExport(alarmCandidates, {
    outPath: args.qaExportPath || process.env.WILSAR_NOISE_QA_EXPORT_PATH,
    includeAll: true,
    qaThresholds: narrativeQaThresholds,
  })

  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    provider_orgs: [...providerOrgs.values()].map((org) => ({ id: org.id, name: org.name })),
    hard_zone_routing: {
      rules: TARGET_PROVIDER_ORG_BY_ZONE,
      note: 'Wilsar zones represent patrol routes; zone 581/582 are pinned to First Security - Blenheim.',
    },
    target_client_org: {
      id: ncc.id,
      name: ncc.name,
      parent_organization_id: ncc.parent_organization_id,
      role: 'client metadata source (branch-owned import target)',
    },
    zones: {
      created_by_org: Object.fromEntries(
        [...zoneStateByOrgName.entries()].map(([orgName, state]) => [orgName, state.created]),
      ),
      mapped_codes_by_org: Object.fromEntries(
        [...zoneStateByOrgName.entries()].map(([orgName, state]) => [orgName, [...state.byCode.keys()].sort()]),
      ),
    },
    client_sites_by_org: Object.fromEntries(
      [...clientSiteStateByOrgName.entries()].map(([orgName, state]) => [orgName, {
        existing_before: state.existing_count,
        discovered_from_source: state.total_seeds,
        created: state.created,
        updated: state.updated,
      }]),
    ),
    routed_candidates: {
      patrols_by_org: patrolCandidates.reduce((acc, item) => {
        const orgName = [...providerOrgs.values()].find((org) => org.id === item.row.organization_id)?.name || 'unknown'
        acc[orgName] = (acc[orgName] || 0) + 1
        return acc
      }, {}),
      alarms_by_org: alarmCandidates.reduce((acc, item) => {
        const orgName = [...providerOrgs.values()].find((org) => org.id === item.row.organization_id)?.name || 'unknown'
        acc[orgName] = (acc[orgName] || 0) + 1
        return acc
      }, {}),
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
      table_available: alarmTableAvailable,
      source_rows: alarmRowsRaw.length,
      source_files: alarmRowsByFile.map((f) => ({ path: f.path, rows: f.rows.length })),
      candidates: alarmCandidates.length,
      existing_matches: existingAlarmKeys.size,
      pending: alarmTableAvailable ? alarmPending.length : 0,
      inserted: alarmTableAvailable ? alarmResult.inserted : 0,
      failed: alarmTableAvailable ? alarmResult.failed : 0,
      error_sample: alarmTableAvailable ? alarmResult.errors.slice(0, 10) : ['alarm_events table is not available in this environment; skipped'],
    },
    noise_jobs: noiseJobsResult,
    noise_notes_enrichment: noiseLoiPoiResult,
    noise_ai_review: noiseAiReviewResult,
    noise_narrative_thresholds: narrativeQaThresholds,
    noise_notes_review: noiseQaExportResult,
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
      alarm_files: alarmRowsByFile.map((f) => f.path),
    },
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
