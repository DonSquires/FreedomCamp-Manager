#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Build app-ready queue model from Bob site enrichment briefings.

Usage:
  node scripts/build-bob-enrichment-queue-model.mjs [options]

Options:
  --apply                  Publish queue items to ai_import_intakes.
  --briefings-in <file>    Input briefing artifact (default: logs/site-roster-briefings-artifact.json).
  --artifact-out <file>    Output queue model artifact (default: logs/site-roster-queue-model-artifact.json).
  --organization-id <id>   Optional filter for one organization.
  --max-items <n>          Max briefing rows to process.
  --help, -h               Show help.
`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseArgs(argv) {
  const args = {
    apply: false,
    briefingsIn: 'logs/site-roster-briefings-artifact.json',
    artifactOut: 'logs/site-roster-queue-model-artifact.json',
    organizationId: '',
    maxItems: 0,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--apply') {
      args.apply = true
      continue
    }
    if (token === '--briefings-in' && argv[i + 1]) {
      args.briefingsIn = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--artifact-out' && argv[i + 1]) {
      args.artifactOut = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--organization-id' && argv[i + 1]) {
      args.organizationId = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--max-items' && argv[i + 1]) {
      args.maxItems = Number(argv[i + 1])
      i += 1
      continue
    }
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  return args
}

function firstNonEmpty(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function readJson(filePath) {
  const resolved = path.resolve(process.cwd(), filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Missing input artifact: ${resolved}`)
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

function writeJson(filePath, payload) {
  const resolved = path.resolve(process.cwd(), filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`Artifact written: ${resolved}`)
}

function mapConfidenceToScore(confidence) {
  if (confidence === 'high') return 90
  if (confidence === 'medium') return 70
  return 40
}

function makeQueueRow(briefing, runAt) {
  const queueStatus = briefing?.dataManagementActions?.requiresHumanReview
    ? 'review_pending'
    : 'staged'
  const priority = briefing.confidence === 'low' ? 'high' : (briefing.confidence === 'high' ? 'low' : 'medium')

  return {
    queueKey: `${briefing.siteId}:${runAt}`,
    organizationId: briefing.organizationId,
    siteId: briefing.siteId,
    siteName: briefing.siteName,
    zoneId: briefing.zoneId,
    zoneName: briefing.zoneName,
    confidence: briefing.confidence,
    previousIssuesSource: briefing.previousIssuesSource,
    uiBadge: briefing.uiBadge || null,
    dataManagementActions: briefing.dataManagementActions || {
      adminQueueAction: 'review_required',
      officerUsageMode: 'advisory_with_confirmation',
      requiresHumanReview: true,
      staleAfterHours: 168,
    },
    queueStatus,
    priority,
    title: `${briefing.siteName} enrichment briefing`,
    summary: briefing.adminBriefing?.previousIssuesSummary || 'Enrichment briefing ready for review.',
  }
}

async function queueItemExists(supabase, organizationId, siteId) {
  const { data, error } = await supabase
    .from('ai_import_intakes')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('source_system', 'bob-enrichment-queue-model')
    .eq('action_target_table', 'client_sites')
    .eq('action_target_id', siteId)
    .in('status', ['staged', 'review_pending', 'historical_started'])
    .limit(1)

  if (error) throw new Error(`Failed checking existing queue item for site ${siteId}: ${error.message}`)
  return Boolean((data || []).length)
}

async function publishQueueItems(supabase, queueRows, runAt) {
  let inserted = 0
  let skippedExisting = 0

  for (const item of queueRows) {
    const exists = await queueItemExists(supabase, item.organizationId, item.siteId)
    if (exists) {
      skippedExisting += 1
      continue
    }

    const payload = {
      organization_id: item.organizationId,
      created_by: null,
      assistant_name: 'Bob',
      purpose: 'enrichment_site_briefing',
      file_name: `${item.siteName} enrichment briefing.json`,
      file_kind: 'json',
      mime_type: 'application/json',
      storage_bucket: 'generated',
      storage_path: `generated/bob-enrichment-queue-model/${runAt}/${item.siteId}.json`,
      file_public_url: null,
      source_system: 'bob-enrichment-queue-model',
      date_range: null,
      operator_notes: 'Generated from Bob enrichment briefing artifact for autonomous app queue management.',
      context: {
        queue_model_version: '2026-05-16',
        queue_row: item,
      },
      extracted_text: [
        `Site: ${item.siteName}`,
        `Confidence: ${item.confidence}`,
        `Issues source: ${item.previousIssuesSource}`,
        `Admin queue action: ${item.dataManagementActions.adminQueueAction}`,
        `Officer usage mode: ${item.dataManagementActions.officerUsageMode}`,
      ].join('\n'),
      extracted_headers: ['site', 'confidence', 'issues_source', 'admin_queue_action', 'officer_usage_mode'],
      assistant_brief: item.summary,
      recommended_table: 'client_sites',
      recommendation_score: mapConfidenceToScore(item.confidence),
      recommendations: [
        { action: item.dataManagementActions.adminQueueAction, priority: item.priority },
      ],
      status: item.queueStatus,
      action_target_table: 'client_sites',
      action_target_id: item.siteId,
      action_summary: item.summary,
    }

    const { error } = await supabase.from('ai_import_intakes').insert(payload)
    if (error) {
      throw new Error(`Failed publishing queue item for site ${item.siteId}: ${error.message}`)
    }
    inserted += 1
  }

  return { inserted, skippedExisting }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  if (args.organizationId && !UUID_RE.test(args.organizationId)) {
    throw new Error('--organization-id must be a valid UUID.')
  }

  if (args.maxItems && (!Number.isFinite(args.maxItems) || args.maxItems < 1)) {
    throw new Error('--max-items must be a positive number.')
  }

  const input = readJson(args.briefingsIn)
  const runAt = String(input.runAt || new Date().toISOString())
  let briefings = Array.isArray(input.briefings) ? input.briefings : []

  if (args.organizationId) {
    briefings = briefings.filter((entry) => entry.organizationId === args.organizationId)
  }

  if (args.maxItems > 0) {
    briefings = briefings.slice(0, Math.trunc(args.maxItems))
  }

  const queueRows = briefings.map((entry) => makeQueueRow(entry, runAt))

  const summary = {
    totalQueueRows: queueRows.length,
    byStatus: {
      staged: queueRows.filter((entry) => entry.queueStatus === 'staged').length,
      reviewPending: queueRows.filter((entry) => entry.queueStatus === 'review_pending').length,
    },
    byPriority: {
      high: queueRows.filter((entry) => entry.priority === 'high').length,
      medium: queueRows.filter((entry) => entry.priority === 'medium').length,
      low: queueRows.filter((entry) => entry.priority === 'low').length,
    },
    published: {
      attempted: args.apply,
      inserted: 0,
      skippedExisting: 0,
    },
  }

  if (args.apply) {
    const supabaseUrl = firstNonEmpty('SUPABASE_URL', 'VITE_SUPABASE_URL')
    const serviceRoleKey = firstNonEmpty('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for apply mode.')
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const publishResult = await publishQueueItems(supabase, queueRows, runAt)
    summary.published.inserted = publishResult.inserted
    summary.published.skippedExisting = publishResult.skippedExisting
  }

  const artifact = {
    runAt: new Date().toISOString(),
    sourceBriefingsArtifact: args.briefingsIn,
    mode: args.apply ? 'apply' : 'dry-run',
    scope: {
      organizationId: args.organizationId || null,
      maxItems: args.maxItems || null,
    },
    source: {
      inputRunAt: runAt,
      previousIssuesSource: input?.summary?.previousIssuesSource || null,
      previousIssuesWarning: input?.summary?.previousIssuesWarning || null,
    },
    summary,
    queueRows,
  }

  writeJson(args.artifactOut, artifact)

  console.log('[Summary]')
  console.log(`  queue_rows: ${summary.totalQueueRows}`)
  console.log(`  staged: ${summary.byStatus.staged}`)
  console.log(`  review_pending: ${summary.byStatus.reviewPending}`)
  console.log(`  publish_inserted: ${summary.published.inserted}`)
  console.log(`  publish_skipped_existing: ${summary.published.skippedExisting}`)
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
