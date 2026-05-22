#!/usr/bin/env node

import fs from 'node:fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const HELP_TEXT = `
Import Downer/LINZ historical vehicle logs into observations.

Usage:
  node scripts/import-downer-linz-historical.mjs [--apply]

Options:
  --apply   Write to database. Omit for dry-run.
`

const SOURCE_FILES = [
  { bucket: 'Historical records Downer LINZ', path: 'Vehicle Log 10-3-26.xlsx' },
  { bucket: 'Historical records Downer LINZ', path: 'Vehicle Log 19-3-26.csv' },
]

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

function normalizePlate(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim()
}

function normalizeDate(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial date (days since 1899-12-30)
    if (raw > 0 && raw < 100000) {
      const millis = Date.UTC(1899, 11, 30) + Math.floor(raw) * 24 * 60 * 60 * 1000
      const d = new Date(millis)
      const yyyy = d.getUTCFullYear()
      const mm = d.getUTCMonth() + 1
      const dd = d.getUTCDate()
      return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }

  const text = String(raw || '').trim()
  if (!text) return null

  const serialText = text.match(/^(\d{4,6})(?:\.\d+)?$/)
  if (serialText) {
    const serial = Number(serialText[1])
    if (Number.isFinite(serial) && serial > 0 && serial < 100000) {
      const millis = Date.UTC(1899, 11, 30) + Math.floor(serial) * 24 * 60 * 60 * 1000
      const d = new Date(millis)
      const yyyy = d.getUTCFullYear()
      const mm = d.getUTCMonth() + 1
      const dd = d.getUTCDate()
      return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }

  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (slash) {
    const dd = Number(slash[1])
    const mm = Number(slash[2])
    let yyyy = Number(slash[3])
    if (yyyy < 100) yyyy += 2000
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const yyyy = Number(iso[1])
    const mm = Number(iso[2])
    const dd = Number(iso[3])
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }

  if (/[-/:T\s]/.test(text)) {
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) {
      const yyyy = date.getUTCFullYear()
      const mm = date.getUTCMonth() + 1
      const dd = date.getUTCDate()
      return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }

  return null
}

function extractRowsFromWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!firstSheet) return []
  return XLSX.utils.sheet_to_json(firstSheet, { defval: '' })
}

function toObservationCandidate(row, source, rowIndex, orgId, zoneId) {
  const plate = normalizePlate(row.REGO || row.Rego || row.rego || row.Plate || row.plate_number)
  const date = normalizeDate(row.RecordedDate || row.recorded_date || row.Date || row.date)
  const sourceRowId = String(row.ID || row.Id || row.id || rowIndex + 1).trim()

  if (!plate || !date) return null

  const noteBits = [row.Title, row.Note, row.Attachments, row.Modified]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
  const note = noteBits.length ? `[Historical Import][Downer LINZ] ${noteBits.join(' | ')}` : null

  const idempotencyKey = `import:downer-linz:${orgId}:${zoneId}:${plate}:${date}:${source.path}:${sourceRowId}`
  return {
    idempotency_key: idempotencyKey,
    plate_number: plate,
    recorded_at: `${date}T08:00:00+13:00`,
    organization_id: orgId,
    zone_id: zoneId,
    officer_notes: note,
    has_notes: Boolean(note),
    _source: `${source.bucket}/${source.path}`,
  }
}

async function getOrganizationIdByName(supabase, name) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id,name')
    .eq('name', name)
    .maybeSingle()
  if (error) throw new Error(`Failed to load organization ${name}: ${error.message}`)
  return data?.id || null
}

async function getZoneIdByName(supabase, orgId, zoneName) {
  const { data, error } = await supabase
    .from('zones')
    .select('id,name')
    .eq('organization_id', orgId)
    .eq('name', zoneName)
    .maybeSingle()
  if (error) throw new Error(`Failed to load zone ${zoneName}: ${error.message}`)
  return data?.id || null
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function fetchExistingIdempotencyKeys(supabase, orgId) {
  const existing = new Set()
  let from = 0
  const pageSize = 1000

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from('observations')
      .select('idempotency_key')
      .eq('organization_id', orgId)
      .like('idempotency_key', 'import:downer-linz:%')
      .range(from, to)

    if (error) throw new Error(`Failed checking existing observations: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row?.idempotency_key) existing.add(String(row.idempotency_key))
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  return existing
}

async function ensureCanonicalVehicles(supabase, plates, apply) {
  const unique = [...new Set(plates.filter(Boolean))]
  if (!apply || unique.length === 0) return 0
  const rows = unique.map((plate_number) => ({ plate_number }))
  const { error } = await supabase.from('canonical_vehicles').upsert(rows, { onConflict: 'plate_number' })
  if (error) throw new Error(`Failed upserting canonical vehicles: ${error.message}`)
  return unique.length
}

async function insertBatch(supabase, rows) {
  const { error } = await supabase.from('observations').insert(rows)
  return { ok: !error, error: error?.message || null }
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

  const orgId = await getOrganizationIdByName(supabase, 'Downer LINZ')
  if (!orgId) throw new Error('Organization not found: Downer LINZ')

  const zoneName = 'Downer LINZ - Queenstown Coverage Zone'
  const zoneId = await getZoneIdByName(supabase, orgId, zoneName)
  if (!zoneId) throw new Error(`Zone not found: ${zoneName}`)

  const candidates = []
  for (const source of SOURCE_FILES) {
    const { data, error } = await supabase.storage.from(source.bucket).download(source.path)
    if (error || !data) throw new Error(`Failed downloading ${source.bucket}/${source.path}: ${error?.message || 'Unknown error'}`)

    const bytes = Buffer.from(await data.arrayBuffer())
    const rows = extractRowsFromWorkbookBuffer(bytes)
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      const candidate = toObservationCandidate(row, source, i, orgId, zoneId)
      if (candidate) candidates.push(candidate)
    }
  }

  const uniqueByKey = new Map()
  for (const item of candidates) {
    if (!uniqueByKey.has(item.idempotency_key)) uniqueByKey.set(item.idempotency_key, item)
  }
  const deduped = [...uniqueByKey.values()]
  const existing = await fetchExistingIdempotencyKeys(supabase, orgId)
  const pending = deduped.filter((r) => !existing.has(r.idempotency_key))

  const canonicalCount = await ensureCanonicalVehicles(supabase, pending.map((r) => r.plate_number), args.apply)

  let inserted = 0
  let failed = 0
  let batchInserted = 0
  let rowFallbackInserted = 0
  const errors = []

  if (args.apply) {
    const payloadRows = pending.map((record) => ({
      plate_number: record.plate_number,
      recorded_at: record.recorded_at,
      organization_id: record.organization_id,
      zone_id: record.zone_id,
      idempotency_key: record.idempotency_key,
      officer_notes: record.officer_notes,
      has_notes: record.has_notes,
    }))

    for (const part of chunk(payloadRows, 250)) {
      const batch = await insertBatch(supabase, part)
      if (batch.ok) {
        inserted += part.length
        batchInserted += part.length
        continue
      }

      for (const row of part) {
        const single = await insertBatch(supabase, [row])
        if (single.ok) {
          inserted += 1
          rowFallbackInserted += 1
        } else {
          failed += 1
          errors.push({ idempotency_key: row.idempotency_key, error: single.error })
        }
      }
    }
  }

  const summary = {
    mode: args.apply ? 'apply' : 'dry-run',
    organization_id: orgId,
    zone_id: zoneId,
    total_candidates: candidates.length,
    total_unique_candidates: deduped.length,
    existing_idempotency_matches: existing.size,
    pending_to_insert: pending.length,
    canonical_vehicles_upserted: canonicalCount,
    inserted,
    failed,
    insert_mode_counts: { batch_direct: batchInserted, row_fallback_direct: rowFallbackInserted },
    source_files: SOURCE_FILES,
    error_sample: errors.slice(0, 10),
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
