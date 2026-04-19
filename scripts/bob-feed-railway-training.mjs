/**
 * bob-feed-railway-training.mjs
 *
 * Pushes all Railway-era Bob training data to Bob's intel ingestion endpoint.
 * Sources: inference-service/lib/ knowledge modules, docs/, and tools/.
 *
 * Usage:
 *   BOB_SERVICE_URL=https://... BOB_INFERENCE_API_KEY=... node scripts/bob-feed-railway-training.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BOB_URL = String(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '').trim().replace(/\/$/, '');
const API_KEY = String(process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || '').trim();

if (!BOB_URL || !API_KEY) {
  console.error('[Error] Missing required env vars: BOB_SERVICE_URL (or INFERENCE_SERVICE_URL) and BOB_INFERENCE_API_KEY (or INFERENCE_API_KEY).');
  process.exit(2);
}

async function postBulletin(bulletin) {
  const res = await fetch(`${BOB_URL}/intel/ingest-bulletin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ bulletin }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

function clip(text, max = 2000) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function readDoc(relPath) {
  try {
    return readFileSync(path.join(ROOT, relPath), 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TRAINING BULLETINS
// ---------------------------------------------------------------------------

const bulletins = [];

// 1. CODING KNOWLEDGE — tech stack, project layout, build commands, code patterns
const codingKnowledgeRaw = readDoc('inference-service/lib/coding-knowledge.js');
bulletins.push({
  type: 'system',
  title: 'FieldOps coding knowledge: tech stack, layout, build, conventions',
  summary: clip(`
    Tech stack: React 18, TypeScript, Vite, Tailwind CSS v3, shadcn/ui (Radix UI).
    State: Zustand (src/stores/) + TanStack Query v5. Forms: react-hook-form + zod.
    Charts: recharts. Routing: react-router-dom v6. Package manager: bun (bun.lock at root).
    Backend: Supabase (PostgreSQL 17 + Edge Functions + Row Level Security).
    Services: inference-service/ (Node/Express + ONNX AI, Bob), proxy-server/ (NZSCV, Node/Express),
    ptt-server/ (WebSocket voice), ollama/ (Railway LLM).
    Hosting: Vercel (fcmanager.co.nz frontend), Railway (Bob, Proxy, PTT, Ollama), Expo EAS (mobile).
    Path alias: @/* → ./src/* (defined in tsconfig.json and vite.config.ts).
    Build commands: bun run dev | bun run build | bun run lint.
    TypeScript config: noImplicitAny=false, strictNullChecks=false, skipLibCheck=true — do NOT tighten these.
    Timezone: ALL datetimes NZ (Pacific/Auckland). Supabase client sends X-Client-Timezone header.
    Supabase client import: always from @/lib/supabase. DB types: src/types/database.ts.
    Edge Functions: Deno TypeScript in supabase/functions/<name>/index.ts.
    Always import CORS from ../_shared/withCors.ts or ../_shared/cors.ts.
    Always handle OPTIONS preflight before any other logic.
    User roles: admin, master, officer, admin_officer. Logic in authStore.ts + App.tsx route guards.
    UI primitives: use shadcn/ui from src/components/ui/ — never re-implement them.
    Feature components: src/components/features/. Page components: src/pages/.
  `),
  source: 'inference-service/lib/coding-knowledge.js',
  effective_date: '2026-04-05',
  metadata: { module: 'coding-knowledge', profile: 'nz-enforcement-v1' },
});

// 2. PLATFORM KNOWLEDGE — Supabase, Railway, GitHub, Vercel, Expo
const platformRaw = readDoc('inference-service/lib/platform-knowledge.js');
bulletins.push({
  type: 'system',
  title: 'FieldOps platform knowledge: Supabase, Railway, GitHub, Vercel, Expo',
  summary: clip(`
    Supabase project ref: kxwjcupuxnnbnzcgmkoi. Region: AWS ap-southeast-2 (Sydney).
    URL: https://kxwjcupuxnnbnzcgmkoi.supabase.co. DB: PostgreSQL 17.
    Auth: Supabase Auth (GoTrue), JWT HS256, expiry 3600s, refresh rotation enabled.
    Roles: admin, master, admin_officer, officer. RLS on every table scoped by organization_id.
    Key tables: vehicles, observations, zones, breaches, enforcement_actions, patrols, users,
    organizations, incidents, ptt_messages, ptt_presence, ptt_channels.
    Migrations: 70+ SQL files in supabase/migrations/ prefixed YYYYMMDD_*. Apply: supabase db push.
    Edge Functions: 47 functions. Deploy: supabase functions deploy <name> --project-ref $REF.
    Railway: Bob at https://focused-courage-production-ccee.up.railway.app.
    Ollama at http://ollama.railway.internal:11434 (internal). Model: llama3.1:8b.
    Bob env: CHAT_PROVIDER=ollama, OLLAMA_BASE_URL=http://ollama.railway.internal:11434,
    OLLAMA_MODEL=llama3.1:8b, SELF_CONTAINED_MODE=true.
    GitHub Actions: 25 workflows. Key: sync-bob-repo.yml mirrors inference-service/ to DonSquires/Bob.
    Vercel: frontend at fcmanager.co.nz. vercel.json has SPA rewrite and security headers.
    Expo EAS: mobile app at mobile-app/. Build profiles: development, preview, production.
    Bob self-contained mode: blocks outbound cloud egress. Build-training mode: allows external providers.
    Bob pretrain profile: nz-enforcement-v1 (similarity threshold learning for vehicle recheck workflows).
    Bob intel endpoints: POST /intel/ingest-bulletin (API key only). POST /learn/ingest-feedback.
    POST /tender/train. POST /learn/pretrain. POST /ask-copilot/:id/answer.
  `),
  source: 'inference-service/lib/platform-knowledge.js',
  effective_date: '2026-04-05',
  metadata: { module: 'platform-knowledge', profile: 'nz-enforcement-v1' },
});

// 3. NZ LEGAL FRAMEWORK — Privacy Act, NZBORA, Freedom Camping Act, etc.
bulletins.push({
  type: 'law',
  title: 'NZ legal framework: Privacy Act 2020, NZBORA, Freedom Camping Act 2011',
  summary: clip(`
    Privacy Act 2020: 13 IPPs. Min collection (IPP1), source from subject (IPP2),
    notification on collection (IPP3), lawful collection (IPP4), security (IPP5),
    access rights (IPP6), correction (IPP7), accuracy (IPP8), retention limits (IPP9),
    use limitation (IPP10), disclosure limitation (IPP11), cross-border restriction (IPP12),
    unique identifiers (IPP13). Mandatory breach notification for serious harm — fines up to $10,000.
    NZBORA 1990: freedom of movement (s18), unreasonable search protection (s21), natural justice (s27).
    All enforcement actions must respect these rights. Automated decisions require human review.
    Freedom Camping Act 2011: camping permitted unless restricted by bylaw.
    Officers CAN: issue infringement notices (≤$200), issue notice to vacate (NTV), request name/address.
    Officers CANNOT: arrest, detain, use force, or enter vehicles. Police only for those powers.
    Search and Surveillance Act 2012: observation from public places is lawful. ALPR from public roads lawful.
    Entering vehicles/tents requires warrant or consent. Covert surveillance requires authorisation.
    Evidence Act 2006: computer-generated evidence (ALPR, breach detection) admissible if system reliability
    established (s137). Chain of custody must be documented.
    Bob AI guardrails G1-G12: privacy by design, lawful evidence only, human review required,
    proportionate enforcement, no Police powers, full audit trail, no cross-border leakage,
    data security, breach notification, respect for rights, NOT legal advice, vulnerable persons.
  `),
  source: 'inference-service/lib/nz-legal-framework.js',
  effective_date: '2026-04-05',
  metadata: { module: 'nz-legal-framework', profile: 'nz-enforcement-v1' },
});

// 4. ASSISTANT KNOWLEDGE — Bob's operating modes, knowledge packs, codebase coding context
bulletins.push({
  type: 'system',
  title: 'Bob assistant knowledge packs: build context, compliance context, codebase coding',
  summary: clip(`
    Knowledge pack: fieldops-build-context — React + TypeScript frontend, Supabase backend,
    Railway inference microservice. Operating modes: self-contained blocks outbound; build-training
    enables external providers + JWKS auth for build and training work.
    Knowledge pack: nz-compliance-context — privacy-by-design, access controls, audit logging,
    least privilege. Prefer deterministic local processing for sensitive imagery.
    Knowledge pack: fieldops-codebase-coding-knowledge — same as Copilot coding agent context.
    Tech stack: React 18 + TypeScript + Vite + Tailwind CSS v3 + shadcn/ui.
    Zustand + TanStack Query. react-hook-form + zod. bun as package manager.
    Supabase edge functions in Deno TypeScript. 70+ SQL migrations.
    Pages in src/pages/, hooks in src/hooks/, stores in src/stores/, types in src/types/.
    shadcn UI in src/components/ui/ — never re-implement. Feature components in src/components/features/.
    Knowledge pack: solution-engineering-context — reproduce first, isolate root cause, minimal fix.
    Severity order: security → data integrity → availability → UX.
    Prefer reversible rollout with feature flags for uncertain impact changes.
    Bob operating principle: NEVER drift from target_files. Edit existing files, do not create new ones
    unless explicitly instructed. Always verify file path exists before generating a task.
    Bob collaboration principle: Copilot is outside man (code review, git, CI), Bob is inside man
    (analysis, planning, self-heal). Bob escalates to Copilot via ask-copilot endpoint.
  `),
  source: 'inference-service/lib/assistant-knowledge.js',
  effective_date: '2026-04-05',
  metadata: { module: 'assistant-knowledge', profile: 'nz-enforcement-v1' },
});

// 5. BOB READINESS SCORECARD — readiness levels, metrics, promotion gates
const readinessRaw = readDoc('docs/BOB_READINESS_SCORECARD.md');
if (readinessRaw) {
  bulletins.push({
    type: 'system',
    title: 'Bob readiness scorecard: levels 0-4, metrics, promotion gates',
    summary: clip(`
      Bob readiness levels: Level 0 (passive chat), Level 1 (triage assistant),
      Level 2 (patch planner), Level 3 (guided implementer), Level 4 (active copilot).
      Core metrics: analysis accuracy, escalation precision, patch-task quality,
      change success rate, human interaction quality (1-5), policy compliance.
      Level 1 gate: analysis accuracy >=75%, escalation precision >=70%.
      Level 2 gate: analysis accuracy >=80%, patch-task quality >=70%.
      Level 3 gate: change success rate >=70%, policy compliance 100%.
      Level 4 gate: change success rate >=85% for 14 consecutive days,
      human interaction quality >=4.2 average, rollback drills successful.
      Daily human interaction test pack (5 prompts): PTT outage update, bug summary for non-technical,
      privacy test (PII request), rollback plan, clarifying question before fix.
      Current priority: lock provider routing to Ollama for Bob chat; no outbound cloud fallback.
    `),
    source: 'docs/BOB_READINESS_SCORECARD.md',
    effective_date: '2026-04-05',
    metadata: { module: 'readiness-scorecard' },
  });
}

// 6. BOB SYSTEM REVIEW — system architecture, capabilities, knowledge modules
const sysReviewRaw = readDoc('docs/BOB_SYSTEM_REVIEW.md');
if (sysReviewRaw) {
  bulletins.push({
    type: 'system',
    title: 'Bob system review: architecture, capabilities, knowledge modules',
    summary: clip(sysReviewRaw.replace(/#+\s*/g, '').replace(/\n+/g, ' ')),
    source: 'docs/BOB_SYSTEM_REVIEW.md',
    effective_date: '2026-04-05',
    metadata: { module: 'system-review' },
  });
}

// 7. BOB COLLABORATION BRIDGE — Copilot↔Bob loop, escalation, task protocol
const collabRaw = readDoc('docs/BOB_COLLABORATION_BRIDGE.md');
if (collabRaw) {
  bulletins.push({
    type: 'system',
    title: 'Bob↔Copilot collaboration bridge: loop protocol, escalation, task handoff',
    summary: clip(collabRaw.replace(/#+\s*/g, '').replace(/\n+/g, ' ')),
    source: 'docs/BOB_COLLABORATION_BRIDGE.md',
    effective_date: '2026-04-05',
    metadata: { module: 'collab-bridge' },
  });
}

// 8. BOB SELF-HEAL BRIDGE — self-heal workflow, Copilot escalation, ask-copilot
const selfHealRaw = readDoc('docs/BOB_COPILOT_SELF_HEAL_BRIDGE.md');
if (selfHealRaw) {
  bulletins.push({
    type: 'system',
    title: 'Bob self-heal bridge: self-heal workflow, Copilot escalation, ask-copilot protocol',
    summary: clip(selfHealRaw.replace(/#+\s*/g, '').replace(/\n+/g, ' ')),
    source: 'docs/BOB_COPILOT_SELF_HEAL_BRIDGE.md',
    effective_date: '2026-04-05',
    metadata: { module: 'self-heal-bridge' },
  });
}

// 9. AI SERVICE CONFIGURATION — Bob config, Ollama setup, inference endpoints
const aiConfigRaw = readDoc('docs/AI_SERVICE_CONFIGURATION.md');
if (aiConfigRaw) {
  bulletins.push({
    type: 'system',
    title: 'AI service configuration: Bob config, Ollama, inference endpoints, env vars',
    summary: clip(aiConfigRaw.replace(/#+\s*/g, '').replace(/\n+/g, ' ')),
    source: 'docs/AI_SERVICE_CONFIGURATION.md',
    effective_date: '2026-04-05',
    metadata: { module: 'ai-service-config' },
  });
}

// 10. BUILD REVIEW EVIDENCE — latest build state (bundle sizes, lint, succeeded)
const buildEvidenceRaw = readDoc('tools/bob-build-review-evidence.json');
if (buildEvidenceRaw) {
  let evidence = {};
  try { evidence = JSON.parse(buildEvidenceRaw); } catch { /* noop */ }
  bulletins.push({
    type: 'system',
    title: 'Build review evidence: latest build state, bundle sizes, lint results',
    summary: clip(`
      Latest build evidence from ${evidence.generatedAt || 'unknown date'}.
      Build succeeded: ${evidence.build?.succeeded ?? 'unknown'}.
      Large chunks: ${(evidence.build?.largeChunks || []).slice(0, 6).map(c => `${c.file} ${c.sizeKb}kB`).join(', ')}.
      Chunk warning: ${evidence.build?.hasChunkWarning ?? false}.
      Lint errors: ${evidence.lint?.errorCount ?? 0}. Lint warnings: ${evidence.lint?.warningCount ?? 0}.
      Commands: build=${evidence.commands?.build || 'bun run build'}, lint=${evidence.commands?.lint || 'bun run lint'}.
      Privacy mode: ${evidence.privacyMode || 'self-contained'}.
      Bob should use this as baseline when assessing build health and proposing fixes.
    `),
    source: 'tools/bob-build-review-evidence.json',
    effective_date: '2026-04-17',
    metadata: { module: 'build-evidence' },
  });
}

// 11. PRETRAIN PROFILE — nz-enforcement-v1 similarity threshold learning
bulletins.push({
  type: 'system',
  title: 'Pretrain profile nz-enforcement-v1: similarity threshold learning for vehicle recheck',
  summary: clip(`
    Profile: nz-enforcement-v1. Used for vehicle recheck workflow similarity scoring.
    Sample pairs (similarity → actual_same_vehicle):
    0.97→true, 0.95→true, 0.93→true, 0.91→true, 0.89→true, 0.87→true, 0.86→true,
    0.84→true, 0.83→true, 0.82→true, 0.80→false, 0.79→false, 0.77→false, 0.75→false,
    0.73→false, 0.71→false, 0.69→false, 0.67→false, 0.65→false, 0.63→false.
    Decision boundary is between 0.82 (same) and 0.80 (different).
    SAMPLE_MULTIPLIER=12 (12 passes through the profile on pretraining).
    Learning rate: 0.025. Threshold range: 0.65–0.95. Initial threshold: 0.85.
    State path: data/self-learning-state.json. Enabled when SELF_LEARNING_ENABLED=true.
    Self-learning script: inference-service/scripts/pretrain-self-learning.js.
  `),
  source: 'inference-service/lib/pretrain-profiles.js',
  effective_date: '2026-04-05',
  metadata: { module: 'pretrain-profiles', profile: 'nz-enforcement-v1' },
});

// 12. BOB PRODUCTION RAILWAY SETUP — service URLs, env vars, Ollama, sync workflow
bulletins.push({
  type: 'system',
  title: 'Bob production Railway setup: service URLs, env vars, sync workflow, Ollama',
  summary: clip(`
    Bob Inference URL: https://focused-courage-production-ccee.up.railway.app.
    Ollama URL (internal): http://ollama.railway.internal:11434 (external: ollama-production-a142.up.railway.app).
    Ollama: v0.20.2, CPU-only, 22.4 GiB RAM, us-west2, keep-alive=24h, port 11434.
    Bob required env: INFERENCE_API_KEY, CHAT_PROVIDER=ollama, TABULAR_NLP_PROVIDER=ollama,
    OLLAMA_BASE_URL=http://ollama.railway.internal:11434, OLLAMA_MODEL=llama3.1:8b,
    SELF_CONTAINED_MODE=true, SELF_LEARNING_ENABLED=true, SELF_LEARNING_PRETRAIN_PROFILE=nz-enforcement-v1.
    Sync: FreedomCamp-Manager push to main that touches inference-service/ auto-syncs to DonSquires/Bob
    via .github/workflows/sync-bob-repo.yml. BOB_SYNC_PAT secret required.
    Bob second model for writing tasks: qwen2.5:7b.
    Railway project token secret: RAILWAY_BOB_TOKEN. Service ID: RAILWAY_BOB_SERVICE_ID.
  `),
  source: 'docs/BOB_PRODUCTION_RAILWAY_SETUP.md',
  effective_date: '2026-04-05',
  metadata: { module: 'railway-setup' },
});

// 13. TENDER SYSTEM E2E — top priority context
bulletins.push({
  type: 'system',
  title: 'Current top priority: tender system E2E operationalization',
  summary: clip(`
    TOP PRIORITY: Get the tender system fully operational end-to-end.
    Tender system exists in src/pages/ — do NOT create new files, edit existing ones ONLY.
    Key existing tender files: look for Tender* pages and tender-related hooks in src/hooks/.
    Tender flow: document intake → analysis → response generation → approval → dispatch.
    Bob role: emulate the document-through-response flow end-to-end.
    CRITICAL DRIFT PREVENTION: Bob MUST only modify files listed in target_files.
    If a file does not exist, report back to Copilot via ask-copilot — do not create new files.
    Build must pass: bun run build. Lint must pass: bun run lint.
    After each change batch: run build + lint, report results to ask-copilot endpoint.
    Copilot (outside man) handles git commits, pushes, and PR review.
    Bob (inside man) handles analysis, planning, code modifications within target_files.
  `),
  source: 'copilot-collaboration-session-2026-04-18',
  effective_date: '2026-04-18',
  metadata: { module: 'tender-priority', priority: 'TOP' },
});

// ---------------------------------------------------------------------------
// INGEST LOOP
// ---------------------------------------------------------------------------

console.log(`\n🚀 Bob Railway Training Feed`);
console.log(`Target: ${BOB_URL}`);
console.log(`Bulletins to push: ${bulletins.length}\n`);

let passed = 0;
let failed = 0;

for (const bulletin of bulletins) {
  process.stdout.write(`  → ${bulletin.title.slice(0, 70)}… `);
  try {
    await postBulletin(bulletin);
    console.log('✅');
    passed++;
  } catch (err) {
    console.log(`❌ ${err.message}`);
    failed++;
  }
}

console.log(`\n✅ Passed: ${passed}  ❌ Failed: ${failed}`);
if (failed > 0) process.exit(1);
