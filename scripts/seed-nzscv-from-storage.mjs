#!/usr/bin/env node
/**
 * seed-nzscv-from-storage.mjs
 *
 * Reads canonical_vehicles data (XLSX or CSV) from Supabase storage and seeds the
 * `canonical_scv` table so that `check-nzscv-status` has a local fallback
 * while the real NZSCV API key is pending.
 *
 * Source: storage bucket "imports_canonical_vehicles" → canonical_vehicles_rows.xlsx
 * Target: public.canonical_scv (plate_number PK)
 *
 * Usage:
 *   node scripts/seed-nzscv-from-storage.mjs [--dry-run] [--bucket <name>] [--file <path>]
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional overrides:
 *   SEED_NZSCV_BUCKET   — storage bucket name (default: imports_canonical_vehicles)
 *   SEED_NZSCV_FILE     — file path within bucket  (default: canonical_vehicles_rows.xlsx)
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
  return idx !== -1 ? args[idx + 1] : (process.env.SEED_NZSCV_BUCKET || 'imports_canonical_vehicles')
})()
const FILE_PATH = (() => {
  const idx = args.indexOf('--file')
  return idx !== -1 ? args[idx + 1] : (process.env.SEED_NZSCV_FILE || 'canonical_vehicles_rows.xlsx')
})()
const BATCH_SIZE = 500

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── CSV parser (no external deps) ──────────────────────────────────────────

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
  const splitLine = delimiter === '\t'
    ? (line) => line.split('\t')
    : parseCsvLine
  const headers = splitLine(lines[0]).map((h) => h.trim().replace(/^"|"$/g, ''))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i])
    const row = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? '').trim().replace(/^"|"$/g, '')
    }
    rows.push(row)
  }
  return rows
}

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function normalizeRow(row) {
  const normalized = {}
  for (const [key, value] of Object.entries(row || {})) {
    normalized[normalizeHeader(key)] = typeof value === 'string' ? value.trim() : value
  }
  return normalized
}

function parseXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return []
  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' })
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

// ── Normalisation helpers ───────────────────────────────────────────────────

function parseDateDMY(value) {
  const text = String(value || '').trim()
  if (!text) return null
  // DD/MM/YYYY → YYYY-MM-DD
  const parts = text.split('/')
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  return null
}

function parseBool(value) {
  return String(value || '').trim().toUpperCase() === 'TRUE'
}

function toUpperTrim(value) {
  return String(value || '').trim().toUpperCase() || null
}

function mapCertificateStatus(selfContained, expiry) {
  if (!selfContained) return 'Expired'
  if (!expiry) return 'Issued'
  const expiryDate = new Date(expiry)
  if (Number.isNaN(expiryDate.getTime())) return 'Issued'
  return expiryDate > new Date() ? 'Current' : 'Expired'
}

// ── Main ────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n📥  Downloading ${BUCKET}/${FILE_PATH} from storage...`)
  const { fileBlob, resolvedPath, candidates } = await downloadWithFallback(BUCKET, FILE_PATH)

  if (!fileBlob) {
    console.error('❌  Storage download failed for all candidate paths.')
    console.error(`   Tried: ${candidates.join(', ')}`)
    process.exit(1)
  }

  let rows = []
  if (/\.xlsx$/i.test(resolvedPath)) {
    const workbookBuffer = Buffer.from(await fileBlob.arrayBuffer())
    rows = parseXlsx(workbookBuffer)
  } else {
    const csvText = await fileBlob.text()
    rows = parseCsv(csvText).map(normalizeRow)
  }
  console.log(`✅  Downloaded and parsed ${rows.length} rows from ${resolvedPath}`)

  // Only rows with SC-relevant data
  const scRows = rows.filter((r) => {
    const plate = toUpperTrim(r.plate_number)
    const sc = parseBool(r.self_contained)
    const expiry = parseDateDMY(r.self_contained_expiry)
    return Boolean(plate) && (sc || expiry)
  })

  console.log(`🔍  ${scRows.length} rows have self-containment data`)

  if (scRows.length === 0) {
    console.log('ℹ️   No SC data found — nothing to seed. Exiting.')
    return
  }

  if (DRY_RUN) {
    console.log('\n📋  DRY RUN — sample of rows that would be upserted:')
    scRows.slice(0, 5).forEach((r) => {
      const plate = toUpperTrim(r.plate_number)
      const sc = parseBool(r.self_contained)
      const expiry = parseDateDMY(r.self_contained_expiry)
      console.log(`  ${plate}  self_contained=${sc}  expiry=${expiry}`)
    })
    console.log(`\n  Total would-be upserts: ${scRows.length}`)
    return
  }

  // Build canonical_scv upsert payload
  const now = new Date().toISOString()
  const scvPayload = scRows.map((r) => {
    const plate = toUpperTrim(r.plate_number)
    const isSc = parseBool(r.self_contained)
    const expiry = parseDateDMY(r.self_contained_expiry)
    const status = mapCertificateStatus(isSc, expiry)
    const issueDate = parseDateDMY(r.nzscv_last_checked) || null
    return {
      plate_number: plate,
      is_self_contained: isSc,
      certificate_expiry: expiry,
      certificate_status: status,
      certificate_issue_date: issueDate,
      vin: toUpperTrim(r.vin) || null,
      max_occupants: r.max_occupants ? (parseInt(r.max_occupants, 10) || null) : null,
      logo_url: r.nzscv_logo_url || r.logo_url || null,
      source: r.nzscv_source || 'storage_seed',
      raw_payload: {
        seeded_from: `${BUCKET}/${resolvedPath}`,
        seeded_at: now,
        self_contained: isSc,
        self_contained_expiry: expiry,
        nzscv_source: r.nzscv_source || null,
        nzscv_last_checked: r.nzscv_last_checked || null,
      },
      verified_at: r.nzscv_last_checked ? new Date(r.nzscv_last_checked.split('/').reverse().join('-')).toISOString().slice(0, 10) + 'T00:00:00Z' : null,
      updated_at: now,
    }
  })

  // Batch upsert into canonical_scv
  let inserted = 0
  let failed = 0
  const errorSample = []

  for (let i = 0; i < scvPayload.length; i += BATCH_SIZE) {
    const batch = scvPayload.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('canonical_scv')
      .upsert(batch, { onConflict: 'plate_number', ignoreDuplicates: false })

    if (error) {
      // Try row-by-row to isolate bad records
      for (const row of batch) {
        const { error: rowErr } = await supabase
          .from('canonical_scv')
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

    process.stdout.write(`\r  Seeded ${Math.min(i + BATCH_SIZE, scvPayload.length)} / ${scvPayload.length}`)
  }

  console.log('\n')
  console.log(`✅  canonical_scv seeded: ${inserted} rows`)
  if (failed > 0) {
    console.warn(`⚠️   Failed: ${failed} rows`)
    errorSample.forEach((e) => console.warn('  ', e))
  }
  console.log('\n🎉  Done. check-nzscv-status will now use these records as fallback.')
}

run().catch((err) => {
  console.error('❌  Fatal error:', err.message || err)
  process.exit(1)
})
