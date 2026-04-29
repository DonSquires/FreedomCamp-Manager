import fs from 'node:fs';
import path from 'node:path';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const repoRoot = process.cwd();
const args = process.argv.slice(2);

function getArg(name, fallback = '') {
  const index = args.findIndex((arg) => arg === `--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function clip(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function readIfExists(relativePath, maxChars = 1200) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) return '';
  return clip(fs.readFileSync(fullPath, 'utf8'), maxChars);
}

function normalizeBaseUrl(url) {
  const trimmed = String(url || '').trim().replace(/\/$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isRunpodServerlessUrl(url) {
  return /api\.runpod\.ai\/v2\//i.test(String(url || ''));
}

function normalizeRunpodBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '').replace(/\/(?:run|run-sync|runsync)\/?$/i, '');
}

const FEED_MODE = isRunpodServerlessUrl(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL)
  ? 'runpod-runsync-chat-fallback'
  : 'intel-ingest-bulletin';

async function postBulletinViaIntel(baseUrl, apiKey, bulletin) {
  const response = await fetch(`${baseUrl}/intel/ingest-bulletin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ bulletin }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Intel ingest failed (${response.status}): ${text}`);
  }

  return text;
}

async function postBulletinViaRunpodRunsync(baseUrl, apiKey, bulletin) {
  const runpodBase = normalizeRunpodBaseUrl(baseUrl);
  const prompt = [
    'System training bulletin for Bob build context behavior.',
    'Store this guidance in active session context for subsequent responses.',
    JSON.stringify(bulletin),
  ].join('\n\n');

  const response = await fetch(`${runpodBase}/runsync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: { message: prompt } }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RunPod runsync ingest failed (${response.status}): ${text}`);
  }

  return text;
}

async function postBulletin(baseUrl, apiKey, bulletin) {
  if (FEED_MODE === 'runpod-runsync-chat-fallback') {
    return postBulletinViaRunpodRunsync(baseUrl, apiKey, bulletin);
  }

  return postBulletinViaIntel(baseUrl, apiKey, bulletin);
}

const focus = getArg('focus', 'general');
const note = getArg('note', '');
const baseUrl = normalizeBaseUrl(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL);
const apiKey = process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || '';

if (!baseUrl || !apiKey) {
  console.error('Missing BOB_SERVICE_URL/INFERENCE_SERVICE_URL or BOB_INFERENCE_API_KEY/INFERENCE_API_KEY');
  process.exit(1);
}

const collaborationBridgeDoc = readIfExists('docs/BOB_COLLABORATION_BRIDGE.md');
const selfHealBridgeDoc = readIfExists('docs/BOB_COPILOT_SELF_HEAL_BRIDGE.md');
const trainingPackDoc = readIfExists('docs/BOB_SELF_CONTAINED_BUILD_REVIEW_TRAINING_PACK.md');

const bulletins = [
  {
    type: 'system',
    title: 'Current build priority and execution constraint',
    summary: clip(
      `Current build focus is tender system end-to-end operationalization. For this phase, prefer editing existing tender flow files: src/pages/TenderWorkspace.tsx, src/pages/TenderWorkspaceDetail.tsx, src/pages/TenderReferenceLibrary.tsx, src/lib/edgeFunctions.ts, supabase/functions/process-tender-document/index.ts, supabase/functions/generate-tender-sections/index.ts, tests/e2e/tender-workspace.spec.ts. Avoid inventing replacement pages, duplicate flows, or unrelated migrations unless a blocker makes that unavoidable. ${note}`,
      1800,
    ),
    source: 'copilot-build-context',
    metadata: {
      focus,
      kind: 'execution-constraint',
    },
  },
  {
    type: 'system',
    title: 'Tender E2E architecture and repo access reminder',
    summary: clip(
      'Bob execution workflow checks out the full repository before generating changes, so repo code and docs are available during code-task execution. Tender runtime path is: TenderWorkspace create/intake -> TenderWorkspaceDetail analysis/generation/approval/export -> edgeFunctions.processTenderDocument and edgeFunctions.generateTenderSections -> Supabase edge functions process-tender-document and generate-tender-sections -> inference-service endpoints /chat, /tender/generate, /tender/train. Reference ingestion path is TenderReferenceLibrary -> ingest-reference-material/process-reference-material. Primary automated coverage path is tests/e2e/tender-workspace.spec.ts.',
      1800,
    ),
    source: 'copilot-build-context',
    metadata: {
      focus,
      kind: 'repo-architecture',
    },
  },
  {
    type: 'system',
    title: 'Bob and Copilot collaboration protocol',
    summary: clip(
      `Collaboration protocol: Bob is the internal AI and Copilot is the external executor/reviewer. Use repo documents as working instructions, especially docs/BOB_COLLABORATION_BRIDGE.md and docs/BOB_COPILOT_SELF_HEAL_BRIDGE.md. Key guidance from those documents: Bob should work from structured internal context, Copilot gathers evidence and applies corrections, and Bob receives ongoing build context through collaboration packets and intel feeds. Bridge doc excerpts: ${collaborationBridgeDoc} ${selfHealBridgeDoc}`,
      1800,
    ),
    source: 'copilot-build-context',
    metadata: {
      focus,
      kind: 'collaboration-protocol',
    },
  },
  {
    type: 'system',
    title: 'Recent Bob drift correction for tender tasks',
    summary: clip(
      'Recent tender code-task runs completed builds but drifted from requested target_files by creating parallel TenderIntake/TenderEmulation flows and unrelated migrations. For current tender work, treat that as negative feedback: stay aligned to target_files, prefer minimal changes inside existing tender pages and edge functions, and express missing coverage by extending existing tests before adding new top-level tender screens. Training/build guidance remains self-contained only. ' + trainingPackDoc,
      1800,
    ),
    source: 'copilot-build-context',
    metadata: {
      focus,
      kind: 'negative-feedback',
    },
  },
];

for (const bulletin of bulletins) {
  await postBulletin(baseUrl, apiKey, bulletin);
  console.log(`Ingested: ${bulletin.title}`);
}

console.log(`Fed ${bulletins.length} build-context bulletins to Bob.`);