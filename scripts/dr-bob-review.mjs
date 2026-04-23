#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { recordScoredResponse } from './bob-response-log.mjs';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const envRunpodEndpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
const defaultRunpodUrl = String(
  process.env.RUNPOD_RUNSYNC_URL ||
  process.env.RUNPOD_SERVERLESS_URL ||
  process.env.RUNPOD_GATEWAY_URL ||
  (envRunpodEndpointId ? `https://api.runpod.ai/v2/${envRunpodEndpointId}/runsync` : '')
).trim();

function getArg(name, fallback = '') {
  const flag = `--${name}`;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || '');
    if (token === flag) return String(args[index + 1] || fallback);
    if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1) || fallback;
  }
  return fallback;
}

function getBooleanArg(name, fallback = false) {
  const raw = String(getArg(name, String(fallback))).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function extractPositionalFileArg() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || '');
    if (!token.startsWith('--')) return token;
    if (token === '--file' || token === '--type' || token === '--reviewer') {
      index += 1;
    }
  }
  return '';
}

function inferArtifactType(filePath, explicitType) {
  if (explicitType) return explicitType;
  const base = path.basename(filePath).toLowerCase();
  if (base.includes('spec')) return 'spec';
  if (base.includes('plan')) return 'plan';
  return 'design-artifact';
}

function normalizeRunpodText(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    const candidates = [
      parsed.output?.message,
      parsed.output?.response,
      parsed.message,
      parsed.response,
      parsed.output,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
      if (candidate && typeof candidate === 'object') return JSON.stringify(candidate);
    }
  } catch {
    return rawText;
  }

  return rawText;
}

function stripCodeFence(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function isReviewShape(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.decision === 'string' &&
    Array.isArray(value.findings)
  );
}

function parseReviewResponse(rawText) {
  const normalized = normalizeRunpodText(rawText);
  const candidates = [normalized, stripCodeFence(normalized)];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isReviewShape(parsed)) return parsed;
    } catch {
      // Keep trying fallback variants.
    }
  }

  return {
    decision: 'needs-revision',
    summary: 'Dr Bob returned an unstructured review. Inspect the raw response.',
    findings: [
      {
        severity: 'major',
        title: 'Unstructured review response',
        evidence: normalized.slice(0, 800),
        requiredAction: 'Rerun the review or tighten the prompt until valid JSON is returned.',
      },
    ],
    verificationChecks: [],
    rawResponse: normalized,
  };
}

async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function sendViaRunpod(message) {
  const runpodUrl = String(
    process.env.DR_BOB_RUNPOD_URL ||
      process.env.RUNPOD_RUNSYNC_URL ||
      defaultRunpodUrl
  ).trim();
  const runpodKey = String(
    process.env.RUNPOD_API_KEY || process.env.DR_BOB_API || ''
  ).trim();
  const orgId = String(
    process.env.BOB_ORG_ID || process.env.ORG_ID || process.env.DEFAULT_ORG_ID || ''
  ).trim();

  if (!runpodKey) {
    throw new Error('RUNPOD_API_KEY or DR_BOB_API is required for Dr Bob review');
  }
  if (!runpodUrl) {
    throw new Error('RunPod runsync URL is required (set DR_BOB_RUNPOD_URL, RUNPOD_RUNSYNC_URL, RUNPOD_SERVERLESS_URL, RUNPOD_GATEWAY_URL, or RUNPOD_ENDPOINT_ID)');
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${runpodKey}`,
  };
  if (orgId) headers['x-org-id'] = orgId;

  const attempts = [
    { input: { message } },
    { input: { prompt: message } },
    { input: { action: 'review', message } },
  ];

  let lastFailure = null;
  for (const payload of attempts) {
    const result = await postJson(runpodUrl, headers, payload);
    if (result.ok) return { ...result, channel: 'runpod-runsync', sent: true };
    lastFailure = result;
  }

  return {
    sent: false,
    ok: false,
    channel: 'runpod-runsync',
    status: lastFailure?.status || 0,
    text: lastFailure?.text || 'Dr Bob RunPod request failed',
  };
}

function buildReviewPrompt({ artifactType, artifactPath, artifactText, systemState, failOnRevision }) {
  return [
    'Dr Bob adversarial architecture review.',
    'You are the blocking reviewer before implementation begins.',
    'Use the repo truth protocol: do not invent modules, data models, routes, migrations, or services.',
    'If the artifact mentions src/modules/* that are not in system_state.json, mark that as blocker severity.',
    `Artifact type: ${artifactType}`,
    `Artifact path: ${artifactPath}`,
    `Fail on revision mode: ${failOnRevision ? 'true' : 'false'}`,
    'Current grounded system state JSON:',
    systemState,
    '',
    'Respond ONLY as JSON with this exact shape:',
    '{',
    '  "decision": "approve|needs-revision|block",',
    '  "summary": "one paragraph",',
    '  "findings": [',
    '    {',
    '      "severity": "blocker|major|minor",',
    '      "title": "short title",',
    '      "evidence": "what in the artifact caused this",',
    '      "requiredAction": "what must change before implementation"',
    '    }',
    '  ],',
    '  "verificationChecks": ["specific checks to run after fixes"]',
    '}',
    '',
    `Review this ${artifactType}:`,
    artifactText,
  ].join('\n');
}

async function writeArtifact(review, sourceFile) {
  const artifactDir = path.join(workspaceRoot, 'data', 'dr-bob-reviews');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${path.basename(sourceFile)}.${stamp}.json`;
  const outputPath = path.join(artifactDir, fileName);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  return outputPath;
}

function hasBlockingFinding(review) {
  return (
    String(review?.decision || '').toLowerCase() === 'block' ||
    review.findings.some(
      (finding) => String(finding?.severity || '').toLowerCase() === 'blocker'
    )
  );
}

export async function runDrBobReview(options = {}) {
  const requestedFile = String(options.file || '').trim();
  if (!requestedFile) {
    throw new Error('Usage: node scripts/dr-bob-review.mjs --file spec.md [--type spec|plan] [--fail-on-revision true]');
  }

  const artifactPath = path.resolve(process.cwd(), requestedFile);
  const artifactText = await fs.readFile(artifactPath, 'utf8');
  const artifactType = inferArtifactType(artifactPath, String(options.type || '').trim());
  const failOnRevision = options.failOnRevision === true;

  let systemState = '{}';
  try {
    systemState = await fs.readFile(path.join(workspaceRoot, 'system_state.json'), 'utf8');
  } catch {
    systemState = JSON.stringify({ warning: 'system_state.json unavailable' });
  }

  const prompt = buildReviewPrompt({
    artifactType,
    artifactPath,
    artifactText,
    systemState,
    failOnRevision,
  });

  const delivery = await sendViaRunpod(prompt);
  if (!delivery.sent) {
    await recordScoredResponse({
      target: 'Dr Bob',
      channel: delivery.channel,
      prompt,
      response: delivery.text,
      delivery,
      metadata: { sourceFile: artifactPath },
    });
    throw new Error(`Dr Bob review failed (${delivery.status}): ${delivery.text.slice(0, 300)}`);
  }

  const review = parseReviewResponse(delivery.text);
  const outputPath = await writeArtifact(review, artifactPath);

  await recordScoredResponse({
    target: 'Dr Bob',
    channel: delivery.channel,
    prompt,
    response: JSON.stringify(review),
    delivery,
    metadata: {
      sourceFile: artifactPath,
      reviewDecision: review.decision,
    },
  });

  console.log(`Decision: ${review.decision}`);
  console.log(`Summary: ${review.summary}`);
  console.log('Findings:');
  if (review.findings.length === 0) {
    console.log('- none');
  } else {
    for (const finding of review.findings) {
      console.log(`- [${finding.severity}] ${finding.title}`);
      console.log(`  Evidence: ${finding.evidence}`);
      console.log(`  Required action: ${finding.requiredAction}`);
    }
  }

  if (Array.isArray(review.verificationChecks) && review.verificationChecks.length > 0) {
    console.log('Verification checks:');
    for (const check of review.verificationChecks) {
      console.log(`- ${check}`);
    }
  }

  console.log(`Review artifact: ${outputPath}`);

  const shouldFail = hasBlockingFinding(review) ||
    (failOnRevision && String(review.decision || '').toLowerCase() === 'needs-revision');
  return {
    artifactPath,
    outputPath,
    review,
    shouldFail,
  };
}

async function main() {
  const requestedFile = getArg('file', '') || extractPositionalFileArg();
  if (!requestedFile) {
    console.error('Usage: node scripts/dr-bob-review.mjs --file spec.md [--type spec|plan] [--fail-on-revision true]');
    process.exit(2);
  }

  const result = await runDrBobReview({
    file: requestedFile,
    type: getArg('type', '').trim(),
    failOnRevision: getBooleanArg('fail-on-revision', false),
  });
  if (result.shouldFail) process.exit(1);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});