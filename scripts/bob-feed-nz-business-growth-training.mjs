/**
 * bob-feed-nz-business-growth-training.mjs
 *
 * Feeds Bob with NZ business-growth and commercial-packaging guidance for
 * FreedomCamp-Manager using the intel/ingest-bulletin path.
 *
 * Usage:
 *   BOB_SERVICE_URL=https://... BOB_INFERENCE_API_KEY=... node scripts/bob-feed-nz-business-growth-training.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const BOB_URL = String(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '').trim().replace(/\/$/, '')
const API_KEY = String(process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || '').trim()
const INTEL_INGEST_URL = String(process.env.INTEL_INGEST_URL || process.env.BOB_INTEL_INGEST_URL || '').trim().replace(/\/$/, '')

if (!BOB_URL || !API_KEY) {
  console.error('[Error] Missing required env vars: BOB_SERVICE_URL (or INFERENCE_SERVICE_URL) and BOB_INFERENCE_API_KEY (or INFERENCE_API_KEY).')
  process.exit(2)
}

function clip(text, max = 1900) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}...` : s
}

function isRunpodServerlessUrl(url) {
  return /api\.runpod\.ai\/v2\//i.test(String(url || ''))
}

function normalizeRunpodBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '').replace(/\/(?:run|run-sync|runsync)\/?$/i, '')
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
    },
    body: JSON.stringify({ bulletin }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text}`)
  }
}

async function postBulletinViaRunpodRunsync(bulletin) {
  const runpodBase = normalizeRunpodBaseUrl(BOB_URL)
  const prompt = [
    'System training bulletin for Bob NZ business growth behavior.',
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

const trainingPackPath = path.join(process.cwd(), 'docs', 'BOB_NZ_BUSINESS_GROWTH_TRAINING.md')
const trainingPackPresent = fs.existsSync(trainingPackPath)

const bulletins = [
  {
    type: 'system',
    title: 'FreedomCamp-Manager market framing: category-first commercial positioning',
    summary: clip(`
      FreedomCamp-Manager should be framed as a NZ-first multi-tenant platform for
      freedom camping enforcement, private patrol operations, council compliance workflows,
      and client-facing managed-service delivery. Prefer category-level competitor analysis
      unless exact vendor certainty is high. Primary adjacent categories are patrol software,
      regulatory case management, field enforcement workflows, infringement/inspection tools,
      and client portal reporting systems. Strategic gap: most products are strong in only one slice,
      while FreedomCamp-Manager can unify patrol execution, case handling, portal visibility,
      geofence context, and evidence-backed compliance workflows.
    `),
    source: 'copilot-nz-business-growth-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'market-framing',
      region: ['NZ', 'AU'],
      training_pack: trainingPackPresent ? 'docs/BOB_NZ_BUSINESS_GROWTH_TRAINING.md' : null,
    },
  },
  {
    type: 'system',
    title: 'Base modules versus add-ons for FreedomCamp-Manager packaging',
    summary: clip(`
      Treat these as base subscription modules: patrol scheduling and dispatch,
      breach/incident/case management, geofence and site management, core evidence capture,
      standard operational reporting, role-based access control, and standard client portal visibility.
      Treat these as add-ons or higher-tier capabilities: advanced analytics, AI-assisted triage,
      white-label portals, enterprise integrations, SSO, multi-entity governance,
      dispute/payment workflows, premium SLA support, and advanced retention/legal-hold controls.
      Do not over-focus on storage as the main pricing driver; stronger drivers are workflow depth,
      managed client count, patrol/case volume, governance complexity, and integration scope.
    `),
    source: 'copilot-nz-business-growth-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'package-architecture',
      pricing_drivers: ['managed-clients', 'case-volume', 'patrol-volume', 'analytics-depth', 'governance-scope'],
    },
  },
  {
    type: 'system',
    title: 'Owner-provider-client revenue chain for managed enforcement software',
    summary: clip(`
      Recommended commercial model: the platform owner sells software access to service providers/operators.
      Providers use the platform to deliver services to councils, landowners, holiday parks, and commercial clients.
      End clients access outcomes through a client portal. Owner monetization should be platform subscription plus
      selected usage-based or premium-module charges. Provider monetization should come from managed-service contracts,
      SLA bundles, patrol frequencies, case volumes, and outcome-based delivery packages. The client portal is a
      retention and upsell mechanism, not a minor reporting extra. Explain owner, provider, and client incentives separately.
    `),
    source: 'copilot-nz-business-growth-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'commercial-chain',
      actors: ['owner', 'provider', 'client'],
    },
  },
  {
    type: 'system',
    title: 'Official NZ business-growth and procurement source stack',
    summary: clip(`
      For NZ business-growth and go-to-market research, prioritize official sources first:
      business.govt.nz for business guidance and growth planning; nzte.govt.nz for export and scaling;
      procurement.govt.nz and gets.govt.nz for procurement patterns and supplier guidance;
      legislation.govt.nz for statutes; digital.govt.nz for public-sector digital policy;
      data.govt.nz and stats.govt.nz for public datasets and economic context; nzbn.govt.nz and the Companies Register
      for business identity and entity verification. Council websites are primary sources for bylaws, annual plans,
      procurement notices, and enforcement context. Industry associations can support, but should not outrank official sources.
    `),
    source: 'copilot-nz-business-growth-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'nz-source-stack',
      official_sources: [
        'https://www.business.govt.nz/',
        'https://www.nzte.govt.nz/',
        'https://www.procurement.govt.nz/',
        'https://www.gets.govt.nz/',
        'https://www.legislation.govt.nz/',
        'https://www.digital.govt.nz/',
        'https://www.data.govt.nz/',
        'https://www.stats.govt.nz/',
        'https://www.nzbn.govt.nz/',
      ],
    },
  },
  {
    type: 'system',
    title: 'Research discipline for NZ market and growth advice',
    summary: clip(`
      Bob must not invent competitor names, products, laws, or pricing structures.
      If vendor certainty is low, use category labels instead. Separate verified fact from strategic inference.
      Keep NZ and AU market framing ahead of generic US/UK analogies unless the user requests otherwise.
      For commercial outputs, prefer concise package tables, buyer/actor separation, and value-driver pricing logic.
      Avoid generic SaaS filler such as arbitrary storage-based packaging unless storage is materially relevant.
    `),
    source: 'copilot-nz-business-growth-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'research-discipline',
      restrictions: ['no-fabrication', 'category-if-uncertain', 'nz-first', 'value-driver-pricing'],
    },
  },
]

console.log('\nNZ business-growth training feed')
console.log(`Endpoint: ${BOB_URL}`)
console.log(`Bulletins: ${bulletins.length}`)
if (trainingPackPresent) {
  console.log(`Training pack: ${trainingPackPath}`)
}

let sent = 0
for (const bulletin of bulletins) {
  process.stdout.write(`- ${bulletin.title} ... `)
  await postBulletin(bulletin)
  sent += 1
  console.log('ok')
}

console.log(`\nDone. Sent ${sent} NZ business-growth training bulletins.`)