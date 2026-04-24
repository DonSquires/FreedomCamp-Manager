#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordScoredResponse } from './bob-response-log.mjs';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const envRunpodEndpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
const defaultRunpodUrl = String(
  process.env.RUNPOD_API_URL ||
  process.env.RUNPOD_RUNSYNC_URL ||
  process.env.RUNPOD_SERVERLESS_URL ||
  process.env.RUNPOD_GATEWAY_URL ||
  (envRunpodEndpointId ? `https://api.runpod.ai/v2/${envRunpodEndpointId}/runsync` : '')
).trim();
const drBobModel = String(process.env.DR_BOB_MODEL || process.env.OLLAMA_MODEL || '').trim();
const runpodPollIntervalMs = Number.parseInt(String(process.env.DR_BOB_RUNPOD_POLL_INTERVAL_MS || '2500'), 10) || 2500;
const runpodPollTimeoutMs = Number.parseInt(String(process.env.DR_BOB_RUNPOD_POLL_TIMEOUT_MS || '120000'), 10) || 120000;

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

function getNumberArg(name, fallback = 0) {
  const raw = String(getArg(name, String(fallback))).trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
      if (isReviewShape(parsed)) {
        return {
          review: parsed,
          structured: true,
          normalized,
        };
      }
    } catch {
      // Keep trying fallback variants.
    }
  }

  return {
    review: {
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
    },
    structured: false,
    normalized,
  };
}

function buildRetryPrompt(basePrompt, attempt) {
  return [
    basePrompt,
    '',
    `Retry attempt ${attempt}: your prior output was not valid JSON.`,
    'Return only JSON, no markdown fences, no prose before or after JSON.',
    'If uncertain, still return the JSON object with empty findings and explicit verificationChecks.',
  ].join('\n');
}

function shouldAttemptBasicFix(review) {
  const actionableTerms = [
    'lint',
    'format',
    'unused import',
    'type error',
    'typescript',
    'syntax',
    'build failure',
    'test failure',
  ];

  const hasBlocker = review.findings.some(
    (finding) => String(finding?.severity || '').toLowerCase() === 'blocker',
  );
  if (hasBlocker) return false;

  return review.findings.some((finding) => {
    const text = `${finding?.title || ''} ${finding?.requiredAction || ''}`.toLowerCase();
    return actionableTerms.some((term) => text.includes(term));
  });
}

async function runCommand(command, args = []) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function attemptBasicCodeFixes() {
  const steps = [];

  const lintFix = await runCommand('bun', ['run', 'lint', '--fix']);
  steps.push({
    step: 'lint-fix',
    code: lintFix.code,
    output: (lintFix.stdout + lintFix.stderr).slice(0, 1500),
  });
  if (lintFix.code !== 0) {
    return { success: false, steps };
  }

  const build = await runCommand('bun', ['run', 'build']);
  steps.push({
    step: 'build-verify',
    code: build.code,
    output: (build.stdout + build.stderr).slice(0, 1500),
  });

  return { success: build.code === 0, steps };
}

async function writeEscalationArtifact(payload, requestedPath = '') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fallbackPath = path.join(workspaceRoot, 'data', 'dr-bob-escalations', `escalation.${stamp}.json`);
  const outputPath = requestedPath
    ? path.resolve(process.cwd(), requestedPath)
    : fallbackPath;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return outputPath;
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

async function getJson(url, headers) {
  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

function isTerminalRunpodStatus(status) {
  const value = String(status || '').trim().toUpperCase();
  return value === 'COMPLETED' || value === 'FAILED' || value === 'CANCELLED' || value === 'TIMED_OUT';
}

function deriveRunpodStatusUrl(runpodUrl, endpointId, jobId) {
  if (!jobId) return '';
  if (endpointId) {
    return `https://api.runpod.ai/v2/${endpointId}/status/${encodeURIComponent(jobId)}`;
  }
  if (/\/runs?$/i.test(runpodUrl)) {
    return runpodUrl.replace(/\/runs?$/i, `/status/${encodeURIComponent(jobId)}`);
  }
  return '';
}

function extractRunpodText(payload) {
  const candidates = [
    payload?.output?.message,
    payload?.output?.response,
    payload?.output?.text,
    payload?.message,
    payload?.response,
    payload?.output,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (candidate && typeof candidate === 'object') return JSON.stringify(candidate);
  }
  return JSON.stringify(payload);
}

async function awaitRunpodCompletion({ runpodUrl, headers, initialText }) {
  let parsed;
  try {
    parsed = JSON.parse(initialText);
  } catch {
    return initialText;
  }

  const initialStatus = String(parsed?.status || '').trim().toUpperCase();
  const jobId = parsed?.id || parsed?.jobId;
  const statusUrl = deriveRunpodStatusUrl(runpodUrl, envRunpodEndpointId, jobId);
  if (!jobId || !statusUrl || (initialStatus && isTerminalRunpodStatus(initialStatus))) {
    return initialText;
  }

  const startedAt = Date.now();
  let lastPayload = parsed;
  while (Date.now() - startedAt < runpodPollTimeoutMs) {
    const statusResult = await getJson(statusUrl, headers);
    if (!statusResult.ok) {
      return statusResult.text || initialText;
    }

    try {
      lastPayload = JSON.parse(statusResult.text);
    } catch {
      return statusResult.text || initialText;
    }

    const status = String(lastPayload?.status || '').trim().toUpperCase();
    if (status && isTerminalRunpodStatus(status)) {
      return extractRunpodText(lastPayload);
    }

    await new Promise((resolve) => setTimeout(resolve, runpodPollIntervalMs));
  }

  return extractRunpodText(lastPayload);
}

async function sendViaRunpod(message) {
  const runpodUrl = String(
    process.env.DR_BOB_RUNPOD_URL ||
      process.env.RUNPOD_API_URL ||
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

  const withModel = (input) => (drBobModel ? { ...input, model: drBobModel } : input);
  const attempts = [
    { input: withModel({ message }) },
    { input: withModel({ prompt: message }) },
    { input: withModel({ action: 'review', message }) },
  ];

  let lastFailure = null;
  for (const payload of attempts) {
    const result = await postJson(runpodUrl, headers, payload);
    if (result.ok) {
      const settledText = await awaitRunpodCompletion({
        runpodUrl,
        headers,
        initialText: result.text,
      });
      return { ...result, text: settledText, channel: 'runpod-runsync', sent: true };
    }
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
  const strictJson = options.strictJson !== false;
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  const selfHealBasic = options.selfHealBasic === true;
  const escalateFile = String(options.escalateFile || '').trim();

  let systemState = '{}';
  try {
    systemState = await fs.readFile(path.join(workspaceRoot, 'system_state.json'), 'utf8');
  } catch {
    systemState = JSON.stringify({ warning: 'system_state.json unavailable' });
  }

  const basePrompt = buildReviewPrompt({
    artifactType,
    artifactPath,
    artifactText,
    systemState,
    failOnRevision,
  });

  let delivery = null;
  let review = null;
  let structured = false;
  let finalPrompt = basePrompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    finalPrompt = strictJson && attempt > 1 ? buildRetryPrompt(basePrompt, attempt) : basePrompt;
    delivery = await sendViaRunpod(finalPrompt);
    if (!delivery.sent) {
      await recordScoredResponse({
        target: 'Dr Bob',
        channel: delivery.channel,
        prompt: finalPrompt,
        response: delivery.text,
        delivery,
        metadata: { sourceFile: artifactPath },
      });
      throw new Error(`Dr Bob review failed (${delivery.status}): ${delivery.text.slice(0, 300)}`);
    }

    const parsed = parseReviewResponse(delivery.text);
    review = parsed.review;
    structured = parsed.structured;

    if (structured || !strictJson) break;
  }

  if (!review) {
    throw new Error('Dr Bob review returned no review payload');
  }
  const outputPath = await writeArtifact(review, artifactPath);

  let basicFixResult = null;
  if (selfHealBasic && shouldAttemptBasicFix(review)) {
    basicFixResult = await attemptBasicCodeFixes();
  }

  const escalationRequired = !structured || hasBlockingFinding(review) || (selfHealBasic && basicFixResult && !basicFixResult.success);
  let escalationPath = null;
  if (escalationRequired) {
    escalationPath = await writeEscalationArtifact({
      createdAt: new Date().toISOString(),
      sourceFile: artifactPath,
      outputPath,
      decision: review.decision,
      structured,
      escalationReason: !structured
        ? 'unstructured-review'
        : hasBlockingFinding(review)
          ? 'blocker-findings'
          : 'basic-fix-failed',
      review,
      basicFixResult,
      requiredAction: 'Escalate to Copilot for manual intervention beyond Dr Bob auto-fix scope.',
    }, escalateFile);
  }

  await recordScoredResponse({
    target: 'Dr Bob',
    channel: delivery.channel,
    prompt: finalPrompt,
    response: JSON.stringify(review),
    delivery,
    metadata: {
      sourceFile: artifactPath,
      reviewDecision: review.decision,
      qualityGateFailed: !structured,
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
  if (basicFixResult) {
    console.log(`Basic self-heal: ${basicFixResult.success ? 'success' : 'failed'}`);
  }
  if (escalationPath) {
    console.log(`Escalation artifact: ${escalationPath}`);
  }

  const shouldFail = hasBlockingFinding(review) ||
    (failOnRevision && String(review.decision || '').toLowerCase() === 'needs-revision');
  return {
    artifactPath,
    outputPath,
    review,
    structured,
    basicFixResult,
    escalationPath,
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
    strictJson: getBooleanArg('strict-json', true),
    maxAttempts: getNumberArg('max-attempts', 3),
    selfHealBasic: getBooleanArg('self-heal-basic', false),
    escalateFile: getArg('escalate-file', '').trim(),
  });
  if (result.shouldFail) process.exit(1);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});