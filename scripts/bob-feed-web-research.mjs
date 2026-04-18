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
  {
    type: 'system',
    title: 'Composed stack blueprint: Vercel + Railway + Supabase + RunPod + GitHub',
    summary: clip(`
      Reference architecture for tender-ready SaaS delivery:
      - Vercel: frontend hosting and edge performance delivery for React/Next.js UI.
      - Railway: backend API runtime for heavy business logic, cron jobs, and long-running tasks.
      - Supabase: source of truth for relational data, auth, and object storage.
      - RunPod: high-compute inference and GPU-intensive processing workloads.
      - GitHub: source control and deployment trigger layer across all services.
      Bob should explain this as a composed stack pattern: decoupled services with clear ownership,
      scalable independently, and integrated through secure API contracts and environment variables.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'composed-stack-blueprint',
      stack: ['vercel', 'railway', 'supabase', 'runpod', 'github'],
    },
  },
  {
    type: 'system',
    title: 'Composed stack integration guardrails: CORS, env vars, auth boundaries',
    summary: clip(`
      Integration standards Bob must enforce in recommendations:
      1) Cross-domain frontend/backend calls require explicit CORS policy on backend.
      2) Frontend base URL must be environment-driven (for example NEXT_PUBLIC_API_URL), never hardcoded.
      3) Backend must maintain frontend allowlist env (for example FRONTEND_URL) for CORS origin checks.
      4) Supabase RLS must remain enabled; do not advise disabling it.
      5) Use @supabase/supabase-js client in frontend for auth/session flows.
      6) Use Supabase service role key only in trusted server environments (Railway), never in browser code.
      Output discipline: map each recommendation to security risk mitigated and implementation location.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'integration-guardrails',
      controls: ['cors', 'env-vars', 'rls', 'service-role-boundary'],
    },
  },
  {
    type: 'system',
    title: 'RunPod async orchestration pattern for responsive UX',
    summary: clip(`
      Preferred long-running compute workflow:
      1) UI submits job request to Railway.
      2) Railway triggers RunPod endpoint asynchronously.
      3) RunPod posts webhook callback to Railway when complete.
      4) Railway persists outcome to Supabase.
      5) UI reflects progress/result via polling or realtime updates.
      Bob should avoid synchronous UI waits on GPU jobs and always recommend observable task state,
      retry policy, and failure-safe transitions for production-grade reliability.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'runpod-async-pattern',
      pattern: ['enqueue', 'webhook-callback', 'db-update', 'ui-refresh'],
    },
  },
  {
    type: 'system',
    title: 'Mobile-first and desktop UX standards for NZ tender-grade delivery',
    summary: clip(`
      UX guidance for mixed desktop/mobile deployments:
      Desktop:
      - Sidebar-driven dashboard navigation.
      - Hover states and tooltips for advanced controls.
      - Multi-column layouts and larger data tables where appropriate.
      Mobile:
      - Thumb-friendly navigation patterns (for example bottom tab navigation).
      - Minimum touch target 44x44 px for interactive controls.
      - Prefer stacked list presentations over wide tables.
      - Protect input usability when software keyboard appears.
      Bob should frame these as accessibility, usability, and operational productivity controls,
      especially where mobile usage can exceed 50 percent.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'mobile-desktop-ux-standards',
      design_mode: 'mobile-first',
    },
  },
  {
    type: 'system',
    title: 'Implementation checklist and documentation-plus learning map',
    summary: clip(`
      Delivery checklist baseline:
      - Start with separated repos for frontend and backend when operational simplicity is needed.
      - Keep backend health endpoint (/health) and connect monitoring.
      - Use local Supabase CLI workflows to avoid direct production-risk testing.
      Learning source hierarchy:
      - Official docs first: Supabase, Vercel, Railway, RunPod.
      - Architecture/system design depth: Full Stack Open, ByteByteGo, Lee Robinson content.
      - Frontend/mobile quality: web.dev, Smashing Magazine, MDN.
      - NZ-local context signal: Summer of Tech resources.
      Bob should cite authoritative docs before secondary content and distinguish hard requirements
      from recommended practices in every tender-facing technical summary.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'implementation-checklist-learning-map',
      official_docs: [
        'https://supabase.com/docs',
        'https://vercel.com/docs',
        'https://docs.railway.com/',
        'https://docs.runpod.io/',
      ],
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
