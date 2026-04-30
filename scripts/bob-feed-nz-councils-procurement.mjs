/**
 * bob-feed-nz-councils-procurement.mjs
 *
 * Feeds Bob with NZ council, regulatory, and public-sector procurement guidance
 * for FreedomCamp-Manager growth into council adoption.
 *
 * Usage:
 *   BOB_SERVICE_URL=https://... BOB_INFERENCE_API_KEY=... node scripts/bob-feed-nz-councils-procurement.mjs
 */

import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const BOB_URL = String(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '').trim().replace(/\/$/, '')
const API_KEY = String(process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || '').trim()

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

const FEED_MODE = isRunpodServerlessUrl(BOB_URL) ? 'runpod-runsync-chat-fallback' : 'intel-ingest-bulletin'

async function postBulletinViaIntel(bulletin) {
  const response = await fetch(`${BOB_URL}/intel/ingest-bulletin`, {
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
    'System training bulletin for Bob NZ councils and procurement behavior.',
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

const bulletins = [
  {
    type: 'system',
    title: 'NZ Freedom Camping Act 2011 and council bylaw enforcement framework',
    summary: clip(`
      The Freedom Camping Act 2011 is the primary NZ statute governing freedom camping regulation.
      Councils enforce via local bylaws registered under the Act. Bylaws can prohibit freedom camping
      in specific areas or apply permit/fee requirements. Enforcement includes warnings, infringement notices,
      and vehicle removal. Breach penalties: up to NZ$20,000 fine + removal costs to owner.
      Primary sources: legislation.govt.nz, DIA policy guidance, and individual council bylaw websites.
      FreedomCamp-Manager should position as a defensible, audit-ready enforcement workflow for councils
      that must collect evidence (photo, GPS, timestamp) and issue infringement notices compliant with the Act.
    `),
    source: 'copilot-nz-councils-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'freedom-camping-act-2011',
      region: 'NZ',
      legal_refs: ['Freedom Camping Act 2011', 'Local Government Act 2002'],
    },
  },
  {
    type: 'system',
    title: 'Council operational drivers around freedom camping and public-land patrol',
    summary: clip(`
      Councils need: live patrol visibility + incident reporting, defensible evidence chains for infringement,
      SLA-level stakeholder transparency (iwi, regional, ratepayers), cost recovery through fines or venue recovery,
      reputational-risk mitigation (legal defensibility, consistent enforcement), operational efficiency (patrol-route optimization, analytics for resource allocation).
      FreedomCamp-Manager addresses these by unifying patrol execution, case Management, geofence context, and client-portal visibility.
      Position as the platform that makes enforcement transparent to ratepayers while supporting cost-recovery and audit compliance.
    `),
    source: 'copilot-nz-councils-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'council-operational-drivers',
      focus: ['breach-visibility', 'evidence-chain', 'stakeholder-reporting', 'cost-recovery', 'reputational-risk', 'operational-efficiency'],
    },
  },
  {
    type: 'system',
    title: 'NZ council procurement patterns and buyer behavior',
    summary: clip(`
      Councils operate fixed budgets; operational software subscriptions are easier to approve than capex.
      Multi-million-dollar contracts are tendered under MBIE Procurement Rules; smaller ($200K–$1M) may be negotiated.
      Councils must address broader outcomes (social value, Maori engagement, environmental sustainability).
      Local Government Reform (2024–2026) creates churn; councils favor proven, stable vendors.
      Councils fear lock-in; they prefer open APIs and vendor-neutral data. Tech decisions by operations/infrastructure teams;
      budget approval by CFO/CEO. Procurement sponsor often differs from end-user.
      Position FreedomCamp-Manager as: proven (case studies), stable (vendor viability), cost-effective (subscription), open (data portability).
    `),
    source: 'copilot-nz-councils-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'council-procurement-patterns',
      patterns: ['budget-constraints', 'rfi-rfp-cycles', 'broader-outcomes', 'vendor-stability', 'data-portability', 'decision-chain'],
    },
  },
  {
    type: 'system',
    title: 'NZ council adoption success factors and pilot strategy',
    summary: clip(`
      Councils often pilot on limited scope (one zone, one patrol route) before rollout.
      Multi-council bulk buying through LGAP (Local Government Association Panel) reduces per-council cost and risk.
      Continuous compliance: software must support audit, retention, OIA requests.
      High staff turnover: vendor onboarding and self-service training essential.
      Data sovereignty & security: NZ-hosted infrastructure, regular backups, incident response SLA required.
      Asset-lifecycle & tech-refresh cycles drive budget availability; align new software to multi-year IT roadmaps.
      Recommend Phase 1 pilot: target 1–2 smaller district councils (Tasman, Southland, West Coast, Nelson)
      with existing enforcement, clear freedom camping problem, and executive sponsor.
    `),
    source: 'copilot-nz-councils-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'council-adoption-success-factors',
      phase1_target_regions: ['Tasman', 'Southland', 'West Coast', 'Nelson', 'Central Otago'],
    },
  },
  {
    type: 'system',
    title: 'NZ council tender-response language and compliance emphasis',
    summary: clip(`
      When drafting council RFP responses, emphasize: broader outcomes (Maori employment, trainee pathways, regional development),
      sustainability & cloud (NZ cloud hosting, energy efficiency, data sovereignty), service-model clarity (software vs managed service,
      cost structure per-seat/per-patrol, SLA uptime 99%, incident response < 2 hours for critical), support & transition (onboarding, training, migration, go-live),
      exit & data portability (open-format export, no lock-in fees), auditing & compliance (OIA support, audit trails, retention policies, ISO 27001 if applicable).
      Frame FreedomCamp-Manager as: defensible (audit-ready evidence), compliant (Privacy Act 2020, Public Records Act 2005, official-information-act-1982),
      transparent (client portal for ratepayer visibility), cost-effective (subscription model).
    `),
    source: 'copilot-nz-councils-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'tender-response-language',
      legal_refs: ['Privacy Act 2020', 'Public Records Act 2005', 'Official Information Act 1982', 'MBIE Procurement Rules'],
    },
  },
  {
    type: 'system',
    title: 'NZ council procurement research source stack: official-first order',
    summary: clip(`
      For council adoption research, use this priority:
      1) GETS (https://www.gets.govt.nz/) — active RFP/RFI notices for councils; see what councils buy and which vendors appear regularly.
      2) Individual council tender/procurement pages (aucklandcouncil.govt.nz, Hamilton, Wellington, Christchurch, Tasman, Southland).
      3) MBIE Procurement Rules (https://www.procurement.govt.nz/).
      4) DIA (Department of Internal Affairs) — local government governance and reform.
      5) NZ Local Government Association (https://www.lgnz.co.nz/) — sector guidance, buying panels.
      6) Stats NZ and Data.govt.nz — council financials, regional demographics, workforce context.
      7) Treasury — Wellbeing Budget and investment guidelines.
      Avoid generic enterprise software commentary. Stay NZ Council-first, use official sources, and map findings to FreedomCamp-Manager's actual capability set.
    `),
    source: 'copilot-nz-councils-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'council-source-stack-official-first',
      official_sources: [
        'https://www.gets.govt.nz/',
        'https://www.procurement.govt.nz/',
        'https://www.lgnz.co.nz/',
        'https://www.data.govt.nz/',
        'https://www.stats.govt.nz/',
        'https://www.digital.govt.nz/',
      ],
    },
  },
]

console.log('\nNZ councils & procurement training feed')
console.log(`Endpoint: ${BOB_URL}`)
console.log(`Bulletins: ${bulletins.length}`)

let sent = 0
for (const bulletin of bulletins) {
  process.stdout.write(`- ${bulletin.title} ... `)
  await postBulletin(bulletin)
  sent += 1
  console.log('ok')
}

console.log(`\nDone. Sent ${sent} NZ councils & procurement bulletins.`)
