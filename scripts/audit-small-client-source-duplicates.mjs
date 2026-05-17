#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const HELP_TEXT = `
Audit duplicate rates in small-client source CSV datasets using configured dedupe keys.

Usage:
  node scripts/audit-small-client-source-duplicates.mjs [--rules <file>] [--outDir <dir>]
`

function parseArgs(argv) {
  const getArg = (flag, fallback = '') => {
    const idx = argv.indexOf(flag)
    if (idx === -1) return fallback
    return String(argv[idx + 1] || '').trim() || fallback
  }
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    rules: getArg('--rules', 'data/source-mappings/small-client-ingestion-rules.json'),
    outDir: getArg('--outDir', 'tmp/docs/storage-review/deputy-and-small-clients'),
  }
}

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        inQ = !inQ
      }
    } else if (ch === ',' && !inQ) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

async function readCsvRows(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  const lines = raw.split(/\r?\n/).filter(Boolean)
  if (!lines.length) return { headers: [], rows: [] }
  const headers = parseCsvLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    const obj = {}
    for (let i = 0; i < headers.length; i += 1) obj[headers[i]] = cells[i] ?? ''
    return obj
  })
  return { headers, rows }
}

function keyForRow(row, fields) {
  return fields.map((f) => String(row[f] || '').trim().toLowerCase()).join('||')
}

function evaluateDuplicates(rows, keyFields) {
  const counts = new Map()
  for (const row of rows) {
    const k = keyForRow(row, keyFields)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  let duplicateRows = 0
  let duplicateKeys = 0
  for (const [, c] of counts.entries()) {
    if (c > 1) {
      duplicateKeys += 1
      duplicateRows += c - 1
    }
  }
  return {
    total_rows: rows.length,
    unique_keys: counts.size,
    duplicate_keys: duplicateKeys,
    duplicate_rows: duplicateRows,
    duplicate_rate: rows.length ? Number((duplicateRows / rows.length).toFixed(4)) : 0,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  const rulesRaw = await fs.readFile(args.rules, 'utf8')
  const rules = JSON.parse(rulesRaw)
  const datasets = rules?.dedupe_policy?.datasets || []

  const profilePath = 'tmp/docs/storage-review/deputy-and-small-clients/profile.json'
  const profileRaw = await fs.readFile(profilePath, 'utf8')
  const profile = JSON.parse(profileRaw)
  const profileByPath = new Map((profile.files || []).map((f) => [f.path, f]))

  const report = []
  for (const ds of datasets) {
    const pathByKind = {
      alarm_noise_control_historical: 'Wilsar-Data/Nelsn Alarm-Noise control historical data.csv',
      patrol_historical: 'Wilsar-Data/Nelson Patrol Historical data.csv',
      deputy_locations_sites_zones: 'Deputy-Data/Deputy Location-sites-patrol zones.csv',
      deputy_staff_roster: 'Deputy-Data/Deputy data.csv',
    }
    const sourcePath = pathByKind[ds.dataset_kind]
    const fileMeta = profileByPath.get(sourcePath)
    if (!fileMeta?.local_file) {
      report.push({ dataset_kind: ds.dataset_kind, source_path: sourcePath, error: 'local source file not found in profile.json' })
      continue
    }

    const { rows } = await readCsvRows(fileMeta.local_file)
    const natural = evaluateDuplicates(rows, ds.natural_key_fields || [])
    const fallback = evaluateDuplicates(rows, ds.fallback_key_fields || [])

    report.push({
      dataset_kind: ds.dataset_kind,
      source_path: sourcePath,
      local_file: fileMeta.local_file,
      natural_key_fields: ds.natural_key_fields,
      fallback_key_fields: ds.fallback_key_fields,
      natural_key_stats: natural,
      fallback_key_stats: fallback,
    })
  }

  await fs.mkdir(args.outDir, { recursive: true })
  const outPath = path.join(args.outDir, 'small-client-source-duplicate-audit.json')
  await fs.writeFile(outPath, JSON.stringify({ generated_at: new Date().toISOString(), rules_file: args.rules, datasets: report }, null, 2))
  console.log(`Wrote ${outPath}`)
  for (const r of report) {
    if (r.error) {
      console.log(`ERR ${r.dataset_kind}: ${r.error}`)
      continue
    }
    console.log(`${r.dataset_kind}: dup_rate(natural)=${r.natural_key_stats.duplicate_rate} dup_rate(fallback)=${r.fallback_key_stats.duplicate_rate}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
