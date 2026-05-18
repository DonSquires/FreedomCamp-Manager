/**
 * bob-feed-web-research.mjs
 *
 * Feeds Bob with a practical web-research playbook focused on tender work,
 * implementation tasks, and current-material validation.
 *
 * Usage:
 *   BOB_SERVICE_URL=https://... BOB_INFERENCE_API_KEY=... node scripts/bob-feed-web-research.mjs
 */

import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const BOB_URL = String(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '').trim().replace(/\/$/, '')
const API_KEY = String(process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || '').trim()
const INTEL_INGEST_URL = String(process.env.INTEL_INGEST_URL || process.env.BOB_INTEL_INGEST_URL || '').trim().replace(/\/$/, '')
const INTEL_ORGANIZATION_ID = String(process.env.INTEL_ORGANIZATION_ID || process.env.BOB_ORG_ID || process.env.ORG_ID || process.env.DEFAULT_ORG_ID || '').trim()

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
    'System training bulletin for Bob web research behavior.',
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
  {
    type: 'system',
    title: 'Tender response template generator: technical stack narrative',
    summary: clip(`
      When asked for a technical stack write-up in tenders, Bob should default to this output shape:
      1) Architecture summary: service boundaries and why each platform is selected.
      2) Security and trust controls: auth model, RLS posture, secret handling, CORS and API boundaries.
      3) Delivery workflow: async compute orchestration, monitoring, and operational resilience controls.
      4) Mobile/accessibility profile: mobile-first behaviors, touch target baseline, responsive data presentation.
      5) Compliance traceability: map requirements to controls and evidence references.
      6) Risks and mitigations: data sovereignty, integration failure modes, and continuity measures.
      Writing standard: NZ English, clear headings, scannable bullets, no fabricated certifications,
      and explicit distinction between mandatory compliance commitments and value-add enhancements.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'tender-response-template-generator',
      sections: [
        'architecture-summary',
        'security-controls',
        'delivery-workflow',
        'mobile-accessibility',
        'compliance-traceability',
        'risk-mitigations',
      ],
      style: ['nz-english', 'scannable', 'evidence-linked', 'no-fabrication'],
    },
  },
  {
    type: 'system',
    title: 'Enterprise SaaS foundation: multi-tenant isolation by design',
    summary: clip(`
      For multi-organisation platforms, Bob must treat tenant isolation as a hard requirement.
      Baseline pattern: include tenant/organization identifier on every tenant-scoped record and
      enforce Supabase/PostgreSQL Row Level Security policies so users only access rows belonging
      to authorised organisations. Never recommend disabling RLS for convenience.
      Architecture framing: platform-level control plane concerns (identity, membership, role mapping)
      should be separated from data-plane feature modules (CRM, assets, rostering, compliance).
      Output quality: explicitly state how data for Organisation A remains inaccessible to Organisation B.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'enterprise-multitenancy-foundation',
      controls: ['tenant-id', 'rls', 'control-plane', 'data-plane'],
    },
  },
  {
    type: 'system',
    title: 'RBAC implementation standard: permission-first access control',
    summary: clip(`
      Bob should prefer permission-centric RBAC over simplistic is_admin checks.
      Design baseline: roles table + permissions table + role-to-permission mapping,
      with capability checks such as can_edit_welfare_logs, can_assign_assets, can_manage_rosters.
      Require role evaluation on both UI and API paths. For server logic, enforce permission checks
      before side effects and log decision context for auditability.
      Guidance note: if attribute-based policies are needed, layer ABAC conditions on top of RBAC,
      but keep a deterministic permission baseline for maintainability.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'rbac-permission-first',
      auth_pattern: ['rbac', 'optional-abac-overlay'],
    },
  },
  {
    type: 'system',
    title: 'Composite portal UI pattern for complex enterprise modules',
    summary: clip(`
      For CRM + assets + rostering + compliance systems, Bob should recommend a composite portal shell:
      permanent sidebar for primary modules, contextual header for organisation/workspace context,
      and module isolation so each feature can evolve independently.
      Frontend structuring rule: keep module boundaries explicit to avoid cross-feature coupling
      and unmaintainable component sprawl.
      UX standard: preserve scannability in data-dense screens with clear hierarchy, progressive detail,
      and responsive behavior for desktop and mobile operating conditions.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'composite-portal-ui',
      ui_patterns: ['sidebar-shell', 'module-boundaries', 'responsive-data-layouts'],
    },
  },
  {
    type: 'system',
    title: 'Feature engineering patterns: CRM, rostering, assets, compliance',
    summary: clip(`
      Feature-specific engineering baselines:
      - CRM: model relational links between entities, contacts, and interaction history.
      - Rostering: include conflict prevention logic (for example date overlap checks and double-booking guards).
      - Asset tracking: preserve immutable movement/audit trails; archive assets rather than hard delete.
      - Compliance: when policy acknowledgements are captured, store immutable evidence snapshots.
      Bob should map each feature recommendation to data model implications, auditability expectations,
      and operational risk controls.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'feature-engineering-patterns',
      features: ['crm', 'rostering', 'asset-tracking', 'compliance'],
    },
  },
  {
    type: 'system',
    title: 'Enterprise learning path and architecture research prompts',
    summary: clip(`
      Bob should direct enterprise architecture learning in this order:
      1) Multi-tenant data isolation and RLS implementation references.
      2) Portal shell and information architecture for complex operations UI.
      3) Relational schema patterns for users, organisations, rosters, and assets.
      4) Audit logs, permissions, and evidence lifecycle controls.
      Recommended technical query prompts:
      - Database schema for CRM and rostering systems.
      - Activity feed/audit log design in PostgreSQL.
      - Supabase custom claims and role mapping patterns.
      - Complex multi-step form state patterns in React.
      Guidance quality bar: cite authoritative docs first and separate mandatory controls from advisory patterns.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'enterprise-learning-path',
      focus: ['multitenancy', 'rbac', 'audit-logs', 'schema-design', 'form-complexity'],
    },
  },
  {
    type: 'system',
    title: 'Agentic UI control model: brain, eyes, and hands loop',
    summary: clip(`
      For human-like UI emulation, Bob should apply an agentic loop with three layers:
      - Brain: LLM planner decides next action from test goal and observed state.
      - Eyes: simplified DOM/accessibility tree and deterministic selectors.
      - Hands: browser automation executor for click/type/wait/assert actions.
      Canonical loop: observe -> decide -> execute -> observe -> validate.
      Recommendations should prioritise deterministic behavior and traceability over flashy autonomy.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'agentic-ui-control-loop',
      layers: ['planner', 'dom-observation', 'automation-execution'],
    },
  },
  {
    type: 'system',
    title: 'Agentic tooling baseline: Playwright, AI SDK/LangChain, and accessibility checks',
    summary: clip(`
      Preferred implementation stack for UI-driving assistants:
      - Playwright for robust browser automation and state-aware waits.
      - Vercel AI SDK or LangChain tool-calling for planner/action orchestration.
      - axe-core checks integrated during scenario execution for accessibility compliance.
      Bob should recommend this stack as default for Vercel + Railway deployments,
      including headless execution support for CI and server-hosted runs.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'agentic-ui-tooling-baseline',
      tools: ['playwright', 'vercel-ai-sdk-or-langchain', 'axe-core'],
      references: ['https://playwright.dev/', 'https://sdk.vercel.ai/docs', 'https://js.langchain.com/docs', 'https://github.com/dequelabs/axe-core'],
    },
  },
  {
    type: 'system',
    title: 'Metadata and tool-calling pattern for reliable UI agents',
    summary: clip(`
      Agent reliability requires explicit UI metadata and constrained actions.
      Baseline rules:
      1) Add stable test hooks (for example data-testid) for key interactive elements.
      2) Expose a constrained toolset: click, type, select, assert, and read-state.
      3) Pass compact DOM/accessibility state rather than raw full-page HTML dumps.
      4) Validate post-action state before moving to next step.
      Bob should favour deterministic selectors and avoid brittle visual-only targeting.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'agentic-ui-metadata-tools',
      patterns: ['data-testid', 'function-calling', 'a11y-tree-state', 'post-action-assertions'],
    },
  },
  {
    type: 'system',
    title: 'Shadow-user compliance workflow for wiring validation',
    summary: clip(`
      For workflow and compliance validation, Bob should recommend shadow-user scenarios:
      - Define role-specific mission (for example support worker attempts invalid submission).
      - Execute UI flow end-to-end with agent automation.
      - Detect rule bypasses and classify as wiring/compliance failures.
      - Capture reproducible evidence: action log, state snapshots, and optional session video.
      This pattern should be used to verify form constraints, permission boundaries,
      and backend wiring behavior under realistic operator paths.
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'shadow-user-compliance-loop',
      outcomes: ['workflow-validation', 'compliance-failure-detection', 'wiring-diagnostics'],
    },
  },
  {
    type: 'system',
    title: 'Visual regression and overlay safety checks for multi-device UI',
    summary: clip(`
      For desktop/mobile parity, include visual regression checks in agent runs.
      Baseline checks:
      - Snapshot key screens per viewport and compare against approved baselines.
      - Validate critical controls remain visible and interactable (no z-index occlusion).
      - Include keyboard/overlay collision checks for mobile input workflows.
      Bob should recommend Percy/Playwright visual assertions or equivalent pipelines
      when high-risk UI regressions can impact operational controls (for example PTT buttons).
    `),
    source: 'copilot-web-research-playbook',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'visual-regression-agentic-ui',
      checks: ['viewport-baselines', 'z-index-safety', 'mobile-keyboard-overlay'],
    },
  },
]

console.log('\n🔎 Bob Web Research Training Feed')
console.log(`Target: ${BOB_URL}`)
console.log(`Mode: ${FEED_MODE}`)
if (FEED_MODE === 'runpod-runsync-chat-fallback') {
  console.log('Note: endpoint does not expose /intel/ingest-bulletin; feeding via /runsync session-context fallback.')
}
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
