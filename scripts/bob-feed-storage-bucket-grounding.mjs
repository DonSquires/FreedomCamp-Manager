#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const repoRoot = process.cwd()
const BOB_URL = String(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '').trim().replace(/\/$/, '')
const API_KEY = String(process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || '').trim()
const INTEL_INGEST_URL = String(process.env.INTEL_INGEST_URL || process.env.BOB_INTEL_INGEST_URL || '').trim().replace(/\/$/, '')
const INTEL_ORGANIZATION_ID = String(process.env.INTEL_ORGANIZATION_ID || process.env.BOB_ORG_ID || process.env.ORG_ID || process.env.DEFAULT_ORG_ID || '').trim()

if (!BOB_URL || !API_KEY) {
  console.error('[Error] Missing BOB_SERVICE_URL/INFERENCE_SERVICE_URL or BOB_INFERENCE_API_KEY/INFERENCE_API_KEY')
  process.exit(2)
}

function clip(text, max = 1900) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function isRunpodServerlessUrl(url) {
  return /api\.runpod\.ai\/v2\//i.test(String(url || ''))
}

function normalizeRunpodBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '').replace(/\/(?:run|run-sync|runsync)\/?$/i, '')
}

function readIfExists(relativePath, maxChars = 2200) {
  const fullPath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(fullPath)) return ''
  return clip(fs.readFileSync(fullPath, 'utf8'), maxChars)
}

const FEED_MODE = INTEL_INGEST_URL
  ? 'intel-ingest-bulletin'
  : isRunpodServerlessUrl(BOB_URL)
    ? 'runpod-runsync-chat-fallback'
    : 'intel-ingest-bulletin'

async function postBulletinViaIntel(bulletin) {
  const ingestUrl = INTEL_INGEST_URL || `${BOB_URL}/intel/ingest-bulletin`
  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      ...(INTEL_ORGANIZATION_ID ? { 'x-org-id': INTEL_ORGANIZATION_ID } : {}),
    },
    body: JSON.stringify({
      bulletin,
      ...(INTEL_ORGANIZATION_ID ? { organization_id: INTEL_ORGANIZATION_ID } : {}),
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text}`)
  }
}

async function postBulletinViaRunpodRunsync(bulletin) {
  const runpodBase = normalizeRunpodBaseUrl(BOB_URL)
  const prompt = [
    'System training bulletin for Bob storage-grounding behavior.',
    'Store this guidance in active session context for subsequent responses.',
    JSON.stringify(bulletin),
  ].join('\n\n')

  const response = await fetch(`${runpodBase}/runsync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ input: { message: prompt } }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text}`)
  }
}

async function postBulletin(bulletin) {
  if (FEED_MODE === 'runpod-runsync-chat-fallback') {
    return postBulletinViaRunpodRunsync(bulletin)
  }

  return postBulletinViaIntel(bulletin)
}

const liveSchemaStorageSection = readIfExists('docs/LIVE_SCHEMA.md', 2600)
const storageAuditSection = readIfExists('docs/SUPABASE_CONFIG_AUDIT.md', 1800)

const confirmedBuckets = [
  'evidence',
  'scans',
  'notice-artifacts',
  'incident-evidence',
  'briefing-videos',
  'reports',
  'dispute-evidence',
]

const bulletins = [
  {
    type: 'system',
    title: 'Storage bucket grounding and anti-invention policy',
    summary: clip(`
      When asked about storage buckets, Bob must use only grounded sources from this repository
      and runtime APIs. Do not invent bucket names, paths, or table links.
      Primary grounded list for this project: ${confirmedBuckets.join(', ')}.
      If a bucket cannot be verified from source files or runtime query, respond with "unsure"
      and request confirmation instead of guessing.
    `),
    source: 'copilot-storage-grounding',
    metadata: {
      module: 'storage-grounding',
      rule: 'no-invention',
      confirmed_buckets: confirmedBuckets,
    },
  },
  {
    type: 'system',
    title: 'How to discover storage buckets in this repo',
    summary: clip(`
      Bucket discovery order for this repository:
      1) docs/LIVE_SCHEMA.md storage section,
      2) docs/SUPABASE_CONFIG_AUDIT.md and docs/STAGING.md references,
      3) source calls like supabase.storage.from('<bucket>') in src/ and supabase/functions/,
      4) runtime verification through Supabase storage.buckets query when authorized.
      Return findings in plain language and include confidence level.
      LIVE_SCHEMA excerpt: ${liveSchemaStorageSection}
      Storage audit excerpt: ${storageAuditSection}
    `),
    source: 'copilot-storage-grounding',
    metadata: {
      module: 'storage-discovery-workflow',
      sources: ['docs/LIVE_SCHEMA.md', 'docs/SUPABASE_CONFIG_AUDIT.md', 'code search for storage.from'],
    },
  },
  {
    type: 'system',
    title: 'Safe bucket reading and enrichment behavior',
    summary: clip(`
      For enrichment requests, Bob should propose a linear, safe flow:
      - list candidate files from a scoped prefix,
      - read small batches,
      - parse into typed records,
      - write durable outputs to Supabase tables,
      - log enrichment result in memory tables.
      For durable memory, use existing Supabase tables and do not claim external persistence.
      If endpoint is runsync-only, prefer Supabase fallback persistence where implemented.
      Explain steps in plain language first, then provide concrete commands/scripts.
    `),
    source: 'copilot-storage-grounding',
    metadata: {
      module: 'storage-enrichment-safety',
      durable_memory_tables: ['bob_conversation_memory', 'bob_user_memory', 'external_intel_bulletins'],
      output_style: 'plain-language-first',
    },
  },
]

for (const bulletin of bulletins) {
  await postBulletin(bulletin)
  console.log(`Ingested: ${bulletin.title}`)
}

console.log(`Mode: ${FEED_MODE}${INTEL_INGEST_URL ? ' (INTEL_INGEST_URL override active)' : ''}`)
console.log(`Fed ${bulletins.length} storage-grounding bulletins to Bob.`)
