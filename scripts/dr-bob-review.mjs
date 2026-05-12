#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordScoredResponse } from './bob-response-log.mjs';
import { recordDrBobEscalation } from './dr-bob-escalation-log.mjs';
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
const localOllamaBaseUrl = String(process.env.DR_BOB_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434')
  .trim()
  .replace(/\/+$/, '');
const localOllamaModel = String(process.env.DR_BOB_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5:7b').trim();
const runpodPollIntervalMs = Number.parseInt(String(process.env.DR_BOB_RUNPOD_POLL_INTERVAL_MS || '2500'), 10) || 2500;
const runpodPollTimeoutMs = Number.parseInt(String(process.env.DR_BOB_RUNPOD_POLL_TIMEOUT_MS || '120000'), 10) || 120000;

function normalizeRunpodRunsyncUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  if (/\/runsync$/i.test(withScheme)) return withScheme;
  if (/\/run-sync$/i.test(withScheme)) return withScheme.replace(/\/run-sync$/i, '/runsync');
  if (/\/run$/i.test(withScheme)) return withScheme.replace(/\/run$/i, '/runsync');

  if (/api\.runpod\.ai\/v2\//i.test(withScheme)) {
    return `${withScheme}/runsync`;
  }

  return withScheme;
}

function resolveDrBobRunpodUrl() {
  const candidates = [
    process.env.DR_BOB_RUNPOD_URL,
    process.env.RUNPOD_RUNSYNC_URL,
    process.env.RUNPOD_SERVERLESS_URL,
    process.env.RUNPOD_GATEWAY_URL,
    process.env.RUNPOD_ENDPOINT_URL,
    process.env.RUNPOD_API_URL,
    process.env.BOB_SERVICE_URL,
    process.env.INFERENCE_SERVICE_URL,
    defaultRunpodUrl,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeRunpodRunsyncUrl(candidate);
    if (normalized) return normalized;
  }

  return '';
}

function resolveDrBobApiKey() {
  const candidates = [
    process.env.RUNPOD_API_KEY,
    process.env.RUNPOD_ENDPOINT_API_KEY,
    process.env.DR_BOB_API,
    process.env.BOB_INFERENCE_API_KEY,
    process.env.INFERENCE_API_KEY,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }

  return '';
}

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

function normalizeCanonicalReviewShape(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.findings)) return null;

  const verificationChecks = Array.isArray(value.verificationChecks)
    ? value.verificationChecks.map((item) => {
        if (item && typeof item === 'object') {
          return String(item.description || item.title || item.status || '').trim();
        }
        return String(item || '').trim();
      }).filter(Boolean)
    : Array.isArray(value.exitCriteria)
      ? value.exitCriteria.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

  const findings = value.findings.map((finding) => {
    const detail = String(finding?.evidence || finding?.description || '').trim();
    return {
      severity: String(finding?.severity || 'major').trim() || 'major',
      title: String(finding?.title || 'Review finding').trim() || 'Review finding',
      evidence: detail || 'No evidence provided.',
      requiredAction: String(finding?.requiredAction || '').trim() || (verificationChecks[0] || 'Revise the artifact and rerun Dr Bob review.'),
    };
  });

  return {
    decision: typeof value.decision === 'string'
      ? value.decision
      : findings.length === 0
        ? 'approve'
        : 'needs-revision',
    summary: String(value.summary || '').trim() || 'Dr Bob returned a structured review.',
    findings,
    verificationChecks,
  };
}

function normalizeAlternateReviewShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const findingsObject = value.findings;
  if (!findingsObject || typeof findingsObject !== 'object' || Array.isArray(findingsObject)) {
    return null;
  }

  const verificationSource = value.verificationChecks || value.exitCriteria;
  const verificationChecks = Array.isArray(verificationSource)
    ? verificationSource.map((item) => String(item || '').trim()).filter(Boolean)
    : verificationSource && typeof verificationSource === 'object'
      ? Object.values(verificationSource).map((item) => String(item || '').trim()).filter(Boolean)
      : typeof verificationSource === 'string'
        ? [verificationSource.trim()].filter(Boolean)
        : [];

  const findings = Object.entries(findingsObject)
    .filter(([, enabled]) => enabled)
    .map(([key]) => ({
      severity: 'major',
      title: key.replace(/([A-Z])/g, ' $1').replace(/^./, (ch) => ch.toUpperCase()).trim(),
      evidence: verificationChecks[0] || `Alternate review shape flagged ${key}.`,
      requiredAction: `Address the ${key} concern and rerun Dr Bob review.`,
    }));

  if (findings.length === 0) {
    return {
      decision: typeof value.decision === 'string' ? value.decision : 'approve',
      summary: typeof value.summary === 'string' && value.summary.trim()
        ? value.summary.trim()
        : 'Dr Bob returned a non-canonical JSON shape with no concrete findings.',
      findings: [],
      verificationChecks,
    };
  }

  return {
    decision: typeof value.decision === 'string' ? value.decision : 'needs-revision',
    summary: typeof value.summary === 'string' && value.summary.trim()
      ? value.summary.trim()
      : 'Dr Bob returned a non-canonical JSON shape; normalized repo-grounded concerns were extracted.',
    findings,
    verificationChecks,
  };
}

function parseReviewResponse(rawText) {
  const normalized = normalizeRunpodText(rawText);
  const extractEmbeddedJson = (value) => {
    const text = String(value || '');
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1);
    }
    return '';
  };
  const candidates = [
    normalized,
    stripCodeFence(normalized),
    extractEmbeddedJson(normalized),
    extractEmbeddedJson(stripCodeFence(normalized)),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const normalizedCanonical = normalizeCanonicalReviewShape(parsed);
      if (normalizedCanonical) {
        return {
          review: normalizedCanonical,
          structured: true,
          normalized,
        };
      }

      const normalizedAlternate = normalizeAlternateReviewShape(parsed);
      if (normalizedAlternate) {
        return {
          review: normalizedAlternate,
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
    'The first character of your response must be { and the last character must be }.',
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
  const runpodUrl = resolveDrBobRunpodUrl();
  const runpodKey = resolveDrBobApiKey();
  const orgId = String(
    process.env.BOB_ORG_ID || process.env.ORG_ID || process.env.DEFAULT_ORG_ID || ''
  ).trim();

  if (!runpodKey) {
    return {
      sent: false,
      ok: false,
      channel: 'runpod-runsync',
      status: 0,
      text: 'Missing RunPod/Bob API key (RUNPOD_API_KEY, RUNPOD_ENDPOINT_API_KEY, DR_BOB_API, BOB_INFERENCE_API_KEY, INFERENCE_API_KEY)',
    };
  }
  if (!runpodUrl) {
    return {
      sent: false,
      ok: false,
      channel: 'runpod-runsync',
      status: 0,
      text: 'Missing RunPod runsync URL (set DR_BOB_RUNPOD_URL, RUNPOD_RUNSYNC_URL, RUNPOD_SERVERLESS_URL, RUNPOD_GATEWAY_URL, RUNPOD_ENDPOINT_URL, BOB_SERVICE_URL, or INFERENCE_SERVICE_URL)',
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${runpodKey}`,
    'x-inference-api-key': runpodKey,
  };
  if (orgId) headers['x-org-id'] = orgId;

  const withModel = (input) => (drBobModel ? { ...input, model: drBobModel } : input);
  const attempts = [
    { input: withModel({ action: 'review', message }) },
    { input: withModel({ prompt: message }) },
    { input: withModel({ message }) },
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

async function sendViaLocalOllama(message) {
  try {
    const response = await fetch(`${localOllamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: localOllamaModel,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'You are Dr Bob, a strict adversarial architecture reviewer. Return only JSON that follows the requested schema.',
          },
          { role: 'user', content: message },
        ],
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        sent: false,
        ok: false,
        channel: 'ollama-local',
        status: response.status,
        text: text || `Ollama request failed (${response.status})`,
      };
    }

    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    const content = parsed?.message?.content || parsed?.response || text;
    return {
      sent: true,
      ok: true,
      channel: 'ollama-local',
      status: response.status,
      text: String(content || ''),
    };
  } catch (error) {
    return {
      sent: false,
      ok: false,
      channel: 'ollama-local',
      status: 0,
      text: String(error?.message || error || 'Local Ollama request failed'),
    };
  }
}

function buildReviewPrompt({ artifactType, artifactPath, artifactText, systemState, failOnRevision }) {
  return [
    'Dr Bob adversarial architecture review.',
    'You are the blocking reviewer before implementation begins.',
    'Use the repo truth protocol: do not invent modules, data models, routes, migrations, or services.',
    'If the artifact falsely claims something already exists in the repo when it does not, mark that as blocker severity.',
    'Do not treat clearly labeled target-state proposals, future modules, future services, or future data models as blockers solely because they are not yet in system_state.json.',
    'Only block on ungrounded repo references when the artifact presents them as existing current-state implementation rather than proposed future-state design.',
    'For clean-sheet specs and rollout plans, future ADRs, backlog tickets, target-state services, and target-state tables are expected. They are not blockers when presented as proposed work.',
    'Do not require proposed future-state modules, ADRs, or data models to already exist in system_state.json.',
    'Output contract is strict: return one JSON object only. No headings, no bullets, no markdown, no code fences.',
    'If you add any text outside the JSON object, the response is invalid.',
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
    'Valid example:',
    '{"decision":"needs-revision","summary":"Grounded summary.","findings":[{"severity":"major","title":"Example issue","evidence":"Artifact says X but repo shows Y","requiredAction":"Change X to Y before implementation"}],"verificationChecks":["Run targeted build","Run org-isolation validation"]}',
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
      const ollamaDelivery = await sendViaLocalOllama(finalPrompt);
      if (ollamaDelivery.sent) {
        delivery = ollamaDelivery;
      } else {
        await recordScoredResponse({
          target: 'Dr Bob',
          channel: delivery.channel,
          prompt: finalPrompt,
          response: `${delivery.text}\nFallback (${ollamaDelivery.channel}): ${ollamaDelivery.text}`,
          delivery,
          metadata: { sourceFile: artifactPath },
        });
        throw new Error(`Dr Bob review failed (runpod=${delivery.status}, ollama=${ollamaDelivery.status}): ${delivery.text.slice(0, 200)} | ${ollamaDelivery.text.slice(0, 200)}`);
      }
    }

    let parsed = parseReviewResponse(delivery.text);
    review = parsed.review;
    structured = parsed.structured;

    if (!structured && delivery.channel === 'runpod-runsync') {
      const ollamaDelivery = await sendViaLocalOllama(finalPrompt);
      if (ollamaDelivery.sent) {
        const ollamaParsed = parseReviewResponse(ollamaDelivery.text);
        if (ollamaParsed.structured) {
          delivery = ollamaDelivery;
          parsed = ollamaParsed;
          review = parsed.review;
          structured = true;
        }
      }
    }

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

    await recordDrBobEscalation({
      sourceFile: artifactPath,
      reviewArtifact: outputPath,
      escalationArtifact: escalationPath,
      structured,
      decision: review.decision,
      reason: !structured
        ? 'unstructured-review'
        : hasBlockingFinding(review)
          ? 'blocker-findings'
          : 'basic-fix-failed',
      summary: review.summary,
      findingsCount: Array.isArray(review.findings) ? review.findings.length : 0,
      topFinding: Array.isArray(review.findings) && review.findings.length > 0
        ? review.findings[0].title || null
        : null,
      selfHealAttempted: !!basicFixResult,
      selfHealSuccess: basicFixResult?.success === true,
      handoffRequired: true,
      copilotActionHint: 'Investigate escalation artifact and implement targeted fix',
      responsePreview: delivery?.text || '',
    });
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

const isDirectExecution = (() => {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return entry === __filename;
})();

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}