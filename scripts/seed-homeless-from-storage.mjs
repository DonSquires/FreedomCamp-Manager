#!/usr/bin/env node
/**
 * seed-homeless-from-storage.mjs
 *
 * Reads homeless vehicle records from Supabase storage and seeds the
 * `canonical_homeless` table so that compliance evaluation and the
 * homeless exemption logic have a canonical data source.
 *
 * Supported file formats:
 *
 *   A) XLSX       — canonical_vehicles_rows.xlsx or a dedicated homeless workbook
 *   B) CSV / TSV  — canonical_vehicles_rows.csv or a dedicated homeless CSV
 *
 * The script auto-discovers the file by scanning the bucket for any of these
 * known filenames before falling back to the explicit --file argument.
 *
 * Usage:
 *   node scripts/seed-homeless-from-storage.mjs [--dry-run] [--bucket <name>] [--file <path>]
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional overrides:
 *   SEED_HOMELESS_BUCKET   — storage bucket name  (default: imports_canonical_vehicles)
 *   SEED_HOMELESS_FILE     — explicit file path within bucket (skips auto-discovery)
 */

import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const BUCKET = (() => {
  const idx = args.indexOf('--bucket')
  return idx !== -1 ? args[idx + 1] : (process.env.SEED_HOMELESS_BUCKET || 'imports_canonical_vehicles')
})()
const EXPLICIT_FILE = (() => {
  const idx = args.indexOf('--file')
  return idx !== -1 ? args[idx + 1] : (process.env.SEED_HOMELESS_FILE || null)
})()
const DEFAULT_FILE_PATH = 'canonical_vehicles_rows.xlsx'
const BATCH_SIZE = 500

// Candidate filenames to auto-discover (checked in order)
const CANDIDATE_FILES = [
  'homeless_records.xlsx',
  'homeless.xlsx',
  'csv/homeless_records.xlsx',
  'csv/homeless.xlsx',
  'homeless_records.csv',
  'homeless.csv',
  'csv/homeless_records.csv',
  'csv/homeless.csv',
  'canonical_vehicles_rows.xlsx',
  'canonical_vehicles_rows.csv',
]

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── CSV parser ──────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const values = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if ((char === ',' || char === '\t') && !inQuotes) {
      values.push(current); current = ''
    } else {
      current += char
    }
  }
  values.push(current)
  return values
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return { headers: [], rows: [] }
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const splitLine = delimiter === '\t' ? (l) => l.split('\t') : parseCsvLine
  const headers = splitLine(lines[0]).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i])
    const row = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? '').trim().replace(/^"|"$/g, '')
    }
    rows.push(row)
  }
  return { headers, rows }
}

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function normalizeRowKeys(row) {
  const out = {}
  for (const [key, value] of Object.entries(row || {})) {
    out[normalizeHeader(key)] = typeof value === 'string' ? value.trim() : value
  }
  return out
}

function parseXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  const firstSheet = workbook.SheetNames[0]
  if (!firstSheet) return { headers: [], rows: [] }
  const sheet = workbook.Sheets[firstSheet]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }).map(normalizeRowKeys)
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  return { headers, rows }
}

async function resolveFilePath(bucket, explicitFile) {
  const candidates = explicitFile
    ? [explicitFile]
    : [DEFAULT_FILE_PATH, ...CANDIDATE_FILES]

  for (const candidate of [...new Set(candidates)]) {
    const { data, error } = await supabase.storage.from(bucket).download(candidate)
    if (!error && data) {
      return { fileBlob: data, filePath: candidate }
    }
  }

  return { fileBlob: null, filePath: explicitFile || DEFAULT_FILE_PATH }
}

// ── Normalisation helpers ───────────────────────────────────────────────────

function toUpperTrim(value) {
  return String(value || '').trim().toUpperCase() || null
}

function normalizeStatus(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text || text === 'none' || text === 'no' || text === 'nan') return null
  if (text === 'yes' || text === 'confirmed') return 'confirmed'
  if (text === 'claimed' || text === 'self_claimed') return 'claimed'
  if (text === 'suspected' || text === 'possibly' || text === 'possible') return 'suspected'
  if (text === 'declined' || text === 'denied' || text === 'no longer') return 'declined'
  // Any truthy non-empty string that indicates homelessness → claimed as fallback
  if (text.length > 0 && text !== 'unknown') return 'suspected'
  return null
}

function parseIsoDate(value) {
  const text = String(value || '').trim()
  if (!text || text === 'nan') return null
  // DD/MM/YYYY → YYYY-MM-DD
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  return null
}

// ── Map a CSV row to a canonical_homeless upsert row ───────────────────────

function mapRow(csvRow, isVehicleCsv) {
  const plate = toUpperTrim(isVehicleCsv ? csvRow.plate_number : (csvRow.plate_number || csvRow.plate))
  if (!plate) return null

  let status, confirmedAt, confirmedBy, notes, source

  if (isVehicleCsv) {
    // Format A: canonical_vehicles CSV columns
    status = normalizeStatus(csvRow.homeless_status)
    confirmedAt = parseIsoDate(csvRow.homeless_confirmed_at)
    confirmedBy = csvRow.homeless_confirmed_by?.trim() || null
    notes = csvRow.homeless_notes?.trim() || null
    source = 'canonical_vehicles_seed'
  } else {
    // Format B: dedicated homeless CSV columns
    status = normalizeStatus(csvRow.status || csvRow.homeless_status)
    confirmedAt = parseIsoDate(csvRow.confirmed_at || csvRow.homeless_confirmed_at || csvRow.date)
    confirmedBy = csvRow.confirmed_by?.trim() || csvRow.homeless_confirmed_by?.trim() || null
    notes = (csvRow.notes || csvRow.homeless_notes || csvRow.vehicle_description || '').trim() || null
    source = csvRow.source?.trim() || 'storage_seed'
  }

  // Skip rows with no meaningful status
  if (!status) return null

  return {
    plate_number: plate,
    status,
    confirmed_at: confirmedAt,
    // confirmed_by is a UUID FK — only keep it if it looks like a UUID
    confirmed_by: confirmedBy && /^[0-9a-f-]{36}$/i.test(confirmedBy) ? confirmedBy : null,
    notes,
    source,
    updated_at: new Date().toISOString(),
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function run() {
  const { fileBlob, filePath: FILE_PATH } = await resolveFilePath(BUCKET, EXPLICIT_FILE)

  if (!fileBlob) {
    console.error(`❌  Could not find a homeless records file in ${BUCKET}.`)
    console.error('    Checked default and known filenames (XLSX and CSV variants).')
    console.error('    Re-run with --file <path> if your file has a custom name/path.')
    process.exit(1)
  }

  console.log(`\n📥  Downloading ${BUCKET}/${FILE_PATH} from storage...`)

  let headers = []
  let rows = []
  if (/\.xlsx$/i.test(FILE_PATH)) {
    const workbookBuffer = Buffer.from(await fileBlob.arrayBuffer())
    const parsed = parseXlsx(workbookBuffer)
    headers = parsed.headers
    rows = parsed.rows
  } else {
    const csvText = await fileBlob.text()
    const parsed = parseCsv(csvText)
    headers = parsed.headers
    rows = parsed.rows.map(normalizeRowKeys)
  }

  console.log(`📊  Parsed ${rows.length} rows — columns: ${headers.slice(0, 8).join(', ')}${headers.length > 8 ? '...' : ''}`)

  // Auto-detect format
  const isVehicleCsv = headers.includes('homeless_status') && headers.includes('plate_number')
  const isDedicatedCsv = headers.includes('status') && headers.includes('plate_number')

  if (!isVehicleCsv && !isDedicatedCsv) {
    console.error('❌  Unrecognised CSV format. Expected columns:')
    console.error('      plate_number + homeless_status  (canonical_vehicles format)')
    console.error('      plate_number + status           (dedicated homeless format)')
    process.exit(1)
  }

  console.log(`🔍  Detected format: ${isVehicleCsv ? 'canonical_vehicles CSV (Format A)' : 'dedicated homeless CSV (Format B)'}`)

  const mapped = rows
    .map((r) => mapRow(r, isVehicleCsv))
    .filter(Boolean)

  console.log(`🏠  ${mapped.length} rows with homeless status to seed`)

  if (mapped.length === 0) {
    console.log('ℹ️   No homeless records found — nothing to seed.')
    const sample = rows.slice(0, 3)
    if (sample.length > 0) {
      console.log('    Sample of homeless_status values in source:', sample.map((r) => r.homeless_status || r.status || '(empty)').join(', '))
    }
    return
  }

  if (DRY_RUN) {
    console.log('\n📋  DRY RUN — sample of rows that would be upserted:')
    mapped.slice(0, 8).forEach((r) => {
      console.log(`  ${r.plate_number}  status=${r.status}  confirmed_at=${r.confirmed_at || 'null'}  source=${r.source}`)
    })
    const statusCounts = mapped.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
    console.log('\n  Status breakdown:', statusCounts)
    console.log(`  Total would-be upserts: ${mapped.length}`)
    return
  }

  // Batch upsert into canonical_homeless
  let inserted = 0
  let failed = 0
  const errorSample = []

  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const batch = mapped.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('canonical_homeless')
      .upsert(batch, { onConflict: 'plate_number', ignoreDuplicates: false })

    if (error) {
      // Row-by-row to isolate failures
      for (const row of batch) {
        const { error: rowErr } = await supabase
          .from('canonical_homeless')
          .upsert(row, { onConflict: 'plate_number', ignoreDuplicates: false })
        if (rowErr) {
          failed++
          if (errorSample.length < 10) errorSample.push(`${row.plate_number}: ${rowErr.message}`)
        } else {
          inserted++
        }
      }
    } else {
      inserted += batch.length
    }

    process.stdout.write(`\r  Seeded ${Math.min(i + BATCH_SIZE, mapped.length)} / ${mapped.length}`)
  }

  console.log('\n')
  const statusCounts = mapped.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
  console.log('✅  canonical_homeless seeded:', inserted, 'rows')
  console.log('   Status breakdown:', statusCounts)
  if (failed > 0) {
    console.warn(`⚠️  Failed: ${failed} rows`)
    errorSample.forEach((e) => console.warn('  ', e))
  }
  console.log('\n🎉  Done. Compliance evaluation will now use these homeless records.')
}

run().catch((err) => {
  console.error('❌  Fatal error:', err.message || err)
  process.exit(1)
})
