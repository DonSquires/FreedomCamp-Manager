/**
 * bob-feed-web-research.mjs
 *
 * Feeds Bob with a practical web-research playbook focused on tender work,
 * implementation tasks, and current-material validation.
 *
 * Usage:
 *   BOB_SERVICE_URL=https://... BOB_INFERENCE_API_KEY=... node scripts/bob-feed-web-research.mjs
 */

const BOB_URL = (process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || 'https://focused-courage-production-ccee.up.railway.app').replace(/\/$/, '')
const API_KEY = process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || 'c3b8e4af-2a56-4879-beb6-21553dc36ef2'

function clip(text, max = 1900) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}...` : s
}

async function postBulletin(bulletin) {
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

const bulletins = [
  {
    type: 'system',
    title: 'Web research protocol for current technical and tender work',
    summary: clip(`
      Research sequence: (1) define objective and output shape, (2) draft 3-5 queries,
      (3) prioritize authoritative sources, (4) cross-check at least two independent sources,
      (5) extract actionable facts with date and source, (6) convert findings into a task plan.
      Prefer current sources (< 18 months) unless legal frameworks require older primary legislation.
      Always report confidence and unresolved unknowns.
      Evidence priority: official standards/docs > government portals > vendor primary docs > expert blogs.
      Never rely on a single secondary source for compliance claims.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: { module: 'web-research-protocol', domain: 'engineering+tender' },
  },
  {
    type: 'system',
    title: 'Tender research source map for NZ and international procurement',
    summary: clip(`
      Preferred sources for tender intelligence and compliance:
      New Zealand Government Electronic Tenders Service (GETS), MBIE procurement rules,
      NZ legislation (Privacy Act 2020, Freedom Camping Act 2011, Commerce Act 1986),
      Local council procurement portals, DIA and data.govt.nz policy guidance,
      ISO references relevant to security services and information security,
      Buyer-issued addenda, Q&A notices, and procurement clarifications.
      For each tender response section, collect: mandatory criteria, weighted criteria,
      submission format constraints, deadlines/timezone, declaration wording requirements,
      and evidentiary attachments expected.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: { module: 'tender-source-map', region: 'NZ' },
  },
  {
    type: 'system',
    title: 'Currentness and citation requirements for Bob research outputs',
    summary: clip(`
      Every research-backed answer should include:
      - Source list with title, publisher, and publication/update date.
      - Why each source is authoritative for this claim.
      - Any recency risks if source is old or superseded.
      - Exact assumptions made while mapping source facts to implementation tasks.
      If sources conflict, report conflict explicitly and recommend a safe fallback.
      For app implementation: map findings directly to target files, tests, and acceptance criteria.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: { module: 'citation-discipline', quality_gate: 'required' },
  },
  {
    type: 'system',
    title: 'Bob and Copilot division of labor for web research',
    summary: clip(`
      Bob should produce a structured research brief first: objective, queries, source targets,
      acceptance criteria, and implementation impact. When fresh web retrieval is required,
      Bob should ask Copilot to gather and verify current material, then Bob synthesizes into
      implementation actions and validation checks. This preserves quality while maintaining
      deterministic implementation in repo target files.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: { module: 'collaboration-research-loop', role_split: 'bob+copilot' },
  },
  {
    type: 'system',
    title: 'NZ procurement essentials: core public-sector tender sources',
    summary: clip(`
      New Zealand tender research priority stack:
      1) GETS (https://www.gets.govt.nz/) for active/closed opportunities, addenda, and buyer Q&A style.
      2) NZ Government Procurement / MBIE (https://www.procurement.govt.nz/) for Procurement Rules,
         supplier guidance, and Rule 18 measures supporting NZ businesses.
      3) Digital.govt.nz (https://www.digital.govt.nz/) for cloud, digital assurance, and policy framing
         relevant to software/service delivery responses.
      4) Business.govt.nz tendering guidance (https://www.business.govt.nz/) for NZ SME response practice.
      Research expectation: use official sources first, capture publication/update date, and map findings
      to mandatory criteria, weighted criteria, and submission form requirements.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'nz-procurement-essentials',
      official_sources: [
        'https://www.gets.govt.nz/',
        'https://www.procurement.govt.nz/',
        'https://www.digital.govt.nz/',
        'https://www.business.govt.nz/',
      ],
    },
  },
  {
    type: 'system',
    title: 'NZ tender broader outcomes and social value requirements',
    summary: clip(`
      NZ tender value-for-money includes broader outcomes, not price alone.
      Bob must surface and respond to social value requirements such as local economic impact,
      engagement with Maori and Pasifika businesses/workforce pathways, and environmental outcomes.
      Where weighting exists (for example social value percentage criteria), allocate response depth
      proportionally and provide concrete delivery evidence.
      Response standard: separate mandatory compliance statements from value-add outcomes,
      and provide evaluator-friendly proof points (who, what, where, measurable outcome).
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'nz-broader-outcomes',
      focus: ['social-value', 'maori-engagement', 'pasifika-engagement', 'regional-impact', 'environmental-sustainability'],
    },
  },
  {
    type: 'system',
    title: 'NZ privacy and data sovereignty framing for cloud-hosted services',
    summary: clip(`
      For NZ public-sector digital tenders, explicitly address Privacy Act 2020 obligations,
      information handling controls, and offshore hosting/data sovereignty risks.
      When infrastructure is hosted outside NZ regions, Bob should require a clear control narrative:
      data classification, minimisation, encryption in transit/at rest, access controls, logging,
      breach response, contractual protections, and continuity assurances for NZ agencies/users.
      Translate technical claims into policy outcomes (for example service continuity,
      assurance, and accountability for New Zealanders).
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'nz-privacy-cloud-assurance',
      legal_refs: ['Privacy Act 2020'],
      policy_refs: ['cloud-assurance', 'data-sovereignty'],
    },
  },
]

console.log('\n🔎 Bob Web Research Training Feed')
console.log(`Target: ${BOB_URL}`)
console.log(`Bulletins to push: ${bulletins.length}\n`)

let passed = 0
let failed = 0

for (const bulletin of bulletins) {
  try {
    await postBulletin(bulletin)
    passed += 1
    console.log(`  -> ${bulletin.title}... OK`)
  } catch (err) {
    failed += 1
    console.error(`  -> ${bulletin.title}... FAIL`)
    console.error(`     ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log(`\nPassed: ${passed}  Failed: ${failed}`)
if (failed > 0) process.exit(1)
