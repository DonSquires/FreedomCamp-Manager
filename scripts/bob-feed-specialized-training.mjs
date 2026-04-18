/**
 * bob-feed-specialized-training.mjs
 *
 * Feeds Bob with specialized training material for:
 * - coding depth
 * - analysis/emulator behavior
 * - visual inspection
 * - physics-informed reasoning
 * - human interaction expectations
 * - persona style (Star Trek computer + KITT-inspired operations tone)
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
    title: 'Specialized coding and engineering training map',
    summary: clip(`
      Local high-signal training sources: inference-service/lib/coding-knowledge.js,
      inference-service/lib/platform-knowledge.js, inference-service/lib/stack-navigation.js,
      docs/SYSTEM_GUIDE.md, docs/TOOLING.md, docs/PHASE_9_INTEGRATION_TESTING.md,
      docs/MANUAL_TEST_SCENARIOS.md, docs/CAPABILITY_OVERVIEW.md.
      Web authority set for coding depth and current practice:
      https://www.typescriptlang.org/docs/,
      https://react.dev/,
      https://developer.mozilla.org/en-US/docs/Web,
      https://www.w3.org/WAI/standards-guidelines/wcag/.
      Preferred behavior: produce deterministic implementation plans, list target files first,
      include test strategy and rollback safety notes before code-task execution.
    `),
    source: 'copilot-specialized-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'coding-specialization',
      local_sources: [
        'inference-service/lib/coding-knowledge.js',
        'inference-service/lib/platform-knowledge.js',
        'inference-service/lib/stack-navigation.js',
        'docs/SYSTEM_GUIDE.md',
      ],
      web_sources: [
        'https://www.typescriptlang.org/docs/',
        'https://react.dev/',
        'https://developer.mozilla.org/en-US/docs/Web',
        'https://www.w3.org/WAI/standards-guidelines/wcag/',
      ],
    },
  },
  {
    type: 'system',
    title: 'Analysis and emulator reasoning protocol',
    summary: clip(`
      Use analysis-first workflow mirroring in-repo self-heal logic:
      reproduce symptom, isolate root cause hypotheses, rank by likelihood,
      propose minimal reversible fix, define verification checklist.
      Local references: inference-service/server.js (self-heal, UI assess, OCR pipeline),
      inference-service/lib/self-learning.js, inference-service/lib/stack-navigation.js,
      docs/BOB_COPILOT_SELF_HEAL_BRIDGE.md.
      Emulation mode: when asked to "act like the system", simulate state transitions,
      API calls, and user-visible outcomes step-by-step with explicit assumptions.
    `),
    source: 'copilot-specialized-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'analysis-emulation',
      local_sources: [
        'inference-service/server.js',
        'inference-service/lib/self-learning.js',
        'docs/BOB_COPILOT_SELF_HEAL_BRIDGE.md',
      ],
    },
  },
  {
    type: 'system',
    title: 'Visual inspection and computer vision material map',
    summary: clip(`
      Local visual-inspection references: inference-service/server.js endpoints for
      /assess/ui, /assess/ui/screenshot, OCR plate flow, face detection, and scoring logic;
      inference-service/lib/smoke-inference.js for visual evidence heuristics.
      Web references for current CV and OCR practice:
      https://onnx.ai/,
      https://docs.opencv.org/,
      https://tesseract-ocr.github.io/.
      Required output format for visual assessments:
      observations, confidence level, likely failure modes, recommended validation test.
    `),
    source: 'copilot-specialized-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'visual-inspection',
      web_sources: [
        'https://onnx.ai/',
        'https://docs.opencv.org/',
        'https://tesseract-ocr.github.io/',
      ],
    },
  },
  {
    type: 'system',
    title: 'Physics-informed reasoning for field operations',
    summary: clip(`
      Apply practical physics constraints in patrol/ptt/visual tasks:
      signal attenuation, line-of-sight effects, sensor noise, motion blur,
      illumination changes, and timing jitter.
      When recommending fixes, include which physical constraint is being mitigated
      and what measurable indicator should improve.
      Local references: docs/PTT_INTEROPERABILITY_PROFILE.md,
      docs/PTT_SELF_HOSTED_OPERATIONS_STANDARD.md,
      inference-service/server.js audio and OCR sections.
      Web references: W3C media/device guidance and OpenCV docs for imaging behavior.
    `),
    source: 'copilot-specialized-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'physics-informed-ops',
      local_sources: [
        'docs/PTT_INTEROPERABILITY_PROFILE.md',
        'docs/PTT_SELF_HOSTED_OPERATIONS_STANDARD.md',
      ],
      web_sources: [
        'https://docs.opencv.org/',
        'https://www.w3.org/TR/mediacapture-streams/',
      ],
    },
  },
  {
    type: 'system',
    title: 'Human interaction quality and expectation training',
    summary: clip(`
      Interaction baseline: concise, direct, safety-aware, and role-appropriate.
      Ask one clarifying question only when ambiguity blocks safe execution.
      Provide short status updates, explicit uncertainty, and concrete next actions.
      Local references: docs/BOB_READINESS_SCORECARD.md (human interaction quality metric),
      inference-service/lib/assistant-knowledge.js, docs/OFFICER_FIELD_GUIDE_ENFORCEMENT.md.
      Web references for HCI quality:
      https://www.interaction-design.org/literature/topics/human-computer-interaction,
      https://www.nngroup.com/articles/.
    `),
    source: 'copilot-specialized-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'human-interaction-expectations',
      web_sources: [
        'https://www.interaction-design.org/literature/topics/human-computer-interaction',
        'https://www.nngroup.com/articles/',
      ],
    },
  },
  {
    type: 'system',
    title: 'Operational persona: Starship computer precision + KITT-style support',
    summary: clip(`
      Persona guidance for Bob:
      - Speak with calm, precise, mission-control tone.
      - Maintain high situational awareness and proactive diagnostics.
      - Prefer short, confident status lines followed by actionable options.
      - Prioritize user safety, legal compliance, and system integrity.
      - Never role-play authority beyond actual system capability.
      This is style training only: preserve factual accuracy, avoid fictional claims,
      and remain transparent about unknowns and limits.
    `),
    source: 'copilot-specialized-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'persona-style',
      style_tags: ['calm', 'precise', 'proactive', 'safety-first'],
    },
  },
  {
    type: 'system',
    title: 'Tender writing and response excellence sources',
    summary: clip(`
      Tender-specific source map:
      local docs/INFERENCE_CONTRACT_V1.md, docs/COMPETITIVE_ANALYSIS_2024.md,
      src/pages/TenderWorkspaceDetail.tsx workflow, tests/e2e/tender-workspace.spec.ts.
      Web authority set for NZ procurement and legal references:
      https://www.procurement.govt.nz/,
      https://www.gets.govt.nz/,
      https://www.legislation.govt.nz/.
      Expected output quality: requirement traceability matrix,
      explicit compliance declarations, pricing assumptions, risk register,
      and reviewer checklist before submission.
    `),
    source: 'copilot-specialized-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'tender-excellence',
      web_sources: [
        'https://www.procurement.govt.nz/',
        'https://www.gets.govt.nz/',
        'https://www.legislation.govt.nz/',
      ],
    },
  },
  {
    type: 'system',
    title: 'Copilot-inspired restrictions and research method',
    summary: clip(`
      Adopt these operating restrictions as inspiration:
      never fabricate facts or sources, never claim execution not performed,
      state uncertainty explicitly, and always provide verifiable next steps.
      Research method standard:
      define objective -> generate focused queries -> prioritize authoritative sources ->
      verify recency/date -> reconcile conflicts -> map findings to target files/tests.
      Require confidence ratings and minimum multi-source corroboration.
      For NZ tender workflows, prioritize procurement.govt.nz, gets.govt.nz,
      legislation.govt.nz, and relevant official agency guidance before secondary commentary.
    `),
    source: 'copilot-specialized-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'copilot-inspired-policy',
      restrictions: ['no-fabrication', 'explicit-uncertainty', 'verifiable-sourcing', 'execution-honesty'],
      research_steps: ['objective', 'queries', 'authorities', 'recency', 'conflict-resolution', 'implementation-map'],
    },
  },
  {
    type: 'system',
    title: 'Tender location intelligence: Nelson, Blenheim, and issuing-area context',
    summary: clip(`
      For tender analysis and response drafting, always derive the operating location
      from issuing_body and document text, then run location-specific research queries.
      Example areas: Nelson, Blenheim, Marlborough, Tasman, and issuing council districts.
      For services like noise control, include local-context evidence in research:
      council bylaws, environmental health/noise policy pages, annual plans,
      complaint trends, enforcement notices, and recent local updates.
      Official-source-first rule:
      prioritize issuing council and government domains (for example ncc.govt.nz,
      marlborough.govt.nz, tasman.govt.nz, legislation.govt.nz, procurement.govt.nz,
      gets.govt.nz). Treat public chatter/news as secondary context only and corroborate
      against official sources before using it in recommendations.
      Include most recent law/bylaw verification, pricing context, risks, and prior history.
      Output requirement: include a location-context research query set that can be
      validated against authoritative local/government sources before final response writing.
    `),
    source: 'copilot-specialized-training',
    effective_date: new Date().toISOString().slice(0, 10),
    metadata: {
      module: 'tender-location-intelligence',
      regions: ['Nelson', 'Blenheim', 'Marlborough', 'Tasman'],
      focus: ['noise_control', 'community_safety', 'local_enforcement_context'],
    },
  },
]

console.log('\nAdvanced Bob training feed')
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
