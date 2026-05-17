#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const options = {
    indexPath: 'tmp/docs/storage-review/evidence-full-index/evidence-exif-index.json',
    outDir: 'tmp/docs/storage-review/evidence-full-index',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--index' && argv[i + 1]) {
      options.indexPath = argv[i + 1]
      i += 1
    } else if (arg === '--outDir' && argv[i + 1]) {
      options.outDir = argv[i + 1]
      i += 1
    }
  }

  return options
}

function normalizeBranch(rawBranch) {
  if (!rawBranch) return 'Unassigned'
  const trimmed = String(rawBranch).trim()
  if (!trimmed || trimmed === 'Unknown' || trimmed === 'No branch inferred') return 'Unassigned'
  return trimmed
}

function scoreRow(row) {
  const hasExif = row.exif_found === true
  const hasGps = row.gps_latitude != null && row.gps_longitude != null
  const hasBranch = normalizeBranch(row.inferred_branch) !== 'Unassigned'
  const hasTimestamp = !!row.datetime_original

  let score = 0
  if (hasExif) score += 20
  if (hasGps) score += 40
  if (hasBranch) score += 25
  if (hasTimestamp) score += 10

  if (row.region_confidence === 'approx_bbox') score += 5

  return Math.max(0, Math.min(100, score))
}

function bandFromScore(score) {
  if (score >= 85) return 'P0'
  if (score >= 70) return 'P1'
  if (score >= 50) return 'P2'
  return 'P3'
}

function actionForRow(row, branch) {
  if (branch !== 'Unassigned') return 'ingest_to_branch_pipeline'
  if (row.exif_found === true && (row.gps_latitude == null || row.gps_longitude == null)) return 'run_secondary_geocoder'
  if (row.exif_found === false) return 'run_ocr_and_filename_enrichment'
  return 'manual_triage'
}

function toCsv(rows) {
  const headers = [
    'queue_id',
    'priority_band',
    'priority_score',
    'branch',
    'jurisdiction',
    'region',
    'recommended_action',
    'bucket',
    'path',
    'datetime_original',
    'gps_latitude',
    'gps_longitude',
    'exif_found',
    'region_confidence',
  ]

  const esc = (v) => {
    if (v == null) return ''
    const s = String(v)
    if (!/[",\n]/.test(s)) return s
    return `"${s.replace(/"/g, '""')}"`
  }

  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map((h) => esc(row[h])).join(','))
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await fs.mkdir(options.outDir, { recursive: true })

  const indexRaw = await fs.readFile(options.indexPath, 'utf8')
  const index = JSON.parse(indexRaw)
  const rows = Array.isArray(index.rows) ? index.rows : []

  const queued = rows.map((row, idx) => {
    const branch = normalizeBranch(row.inferred_branch)
    const score = scoreRow(row)
    return {
      queue_id: `eq-${String(idx + 1).padStart(5, '0')}`,
      priority_band: bandFromScore(score),
      priority_score: score,
      branch,
      jurisdiction: row.inferred_jurisdiction || 'Unknown',
      region: row.inferred_region || 'Unknown',
      recommended_action: actionForRow(row, branch),
      bucket: row.bucket,
      path: row.path,
      datetime_original: row.datetime_original,
      gps_latitude: row.gps_latitude,
      gps_longitude: row.gps_longitude,
      exif_found: row.exif_found === true,
      region_confidence: row.region_confidence || null,
      updated_at: row.updated_at || null,
      size_bytes: row.size_bytes ?? null,
    }
  })

  queued.sort((a, b) => {
    if (a.priority_score !== b.priority_score) return b.priority_score - a.priority_score
    const aTime = String(a.datetime_original || a.updated_at || '')
    const bTime = String(b.datetime_original || b.updated_at || '')
    return bTime.localeCompare(aTime)
  })

  const byBranch = {}
  const byPriority = {}
  const actionSummary = {}

  for (const item of queued) {
    byBranch[item.branch] = (byBranch[item.branch] || 0) + 1
    byPriority[item.priority_band] = (byPriority[item.priority_band] || 0) + 1
    actionSummary[item.recommended_action] = (actionSummary[item.recommended_action] || 0) + 1
  }

  const branchQueues = {}
  for (const item of queued) {
    if (!branchQueues[item.branch]) branchQueues[item.branch] = []
    branchQueues[item.branch].push(item)
  }

  const topCandidates = queued.slice(0, 40)
  const output = {
    generated_at: new Date().toISOString(),
    source_index: options.indexPath,
    totals: {
      queued_items: queued.length,
      by_priority: byPriority,
      by_branch: byBranch,
      by_action: actionSummary,
    },
    top_candidates: topCandidates,
    branch_queues: branchQueues,
  }

  const queueJson = path.join(options.outDir, 'evidence-branch-ingest-queue.json')
  const queueCsv = path.join(options.outDir, 'evidence-branch-ingest-queue.csv')
  const queueSummary = path.join(options.outDir, 'evidence-branch-ingest-summary.json')

  await fs.writeFile(queueJson, JSON.stringify(output, null, 2))
  await fs.writeFile(queueCsv, toCsv(queued))
  await fs.writeFile(
    queueSummary,
    JSON.stringify(
      {
        generated_at: output.generated_at,
        source_index: options.indexPath,
        totals: output.totals,
      },
      null,
      2,
    ),
  )

  console.log('Evidence branch ingest queue created')
  console.log(`Queue JSON: ${queueJson}`)
  console.log(`Queue CSV: ${queueCsv}`)
  console.log(`Summary: ${queueSummary}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
