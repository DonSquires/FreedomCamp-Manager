#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function resolveBaseUrl() {
  const candidates = [
    process.env.BOB_SERVICE_URL,
    process.env.INFERENCE_SERVICE_URL,
    process.env.RUNPOD_GATEWAY_URL,
    process.env.RUNPOD_SERVERLESS_URL,
    process.env.DR_BOB_URL,
  ];

  const raw = candidates.find((value) => isHttpUrl(value)) || '';
  return String(raw).trim().replace(/\/+$/, '');
}

function resolveRunsyncUrl() {
  const direct = [
    process.env.RUNPOD_RUNSYNC_URL,
    process.env.RUNPOD_SERVERLESS_URL,
  ].find((value) => isHttpUrl(value));

  if (direct) return String(direct).trim().replace(/\/+$/, '');

  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
  if (!endpointId) return '';
  return `https://api.runpod.ai/v2/${endpointId}/runsync`;
}

function resolveApiKey() {
  return String(
    process.env.BOB_INFERENCE_API_KEY ||
    process.env.INFERENCE_API_KEY ||
    process.env.RUNPOD_API_KEY ||
    process.env.DR_BOB_API ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
}

function resolveInferenceApiKey() {
  return String(
    process.env.BOB_INFERENCE_API_KEY ||
    process.env.INFERENCE_API_KEY ||
    process.env.DR_BOB_API ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
}

function resolveRunpodApiKey() {
  return String(
    process.env.RUNPOD_API_KEY ||
    process.env.DR_BOB_API ||
    process.env.BOB_INFERENCE_API_KEY ||
    process.env.INFERENCE_API_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
}

function resolveOrgId() {
  return String(
    process.env.BOB_ORG_ID ||
    process.env.ORG_ID ||
    process.env.DEFAULT_ORG_ID ||
    ''
  ).trim();
}

function buildBobMessage(stage, command, exitCode = null) {
  const preferredLanguage = String(process.env.BOB_ASSIST_LANGUAGE || 'en-NZ').trim();

  if (stage === 'pre') {
    return [
      'Bob, assist this automated test run.',
      `Stage: pre-run`,
      `Command: ${command}`,
      `Respond in ${preferredLanguage}.`,
      'Provide concise risk focus areas and expected failure hotspots for this stack.',
    ].join('\n');
  }

  return [
    'Bob, assist post-test triage for this automated run.',
    `Stage: post-run`,
    `Command: ${command}`,
    `Exit code: ${exitCode}`,
    `Respond in ${preferredLanguage}.`,
    exitCode === 0
      ? 'Tests passed. Provide quick verification checks for regressions we should still watch.'
      : 'Tests failed. Provide likely root causes and first 3 concrete remediation steps.',
  ].join('\n');
}

async function pingBob(stage, command, exitCode = null) {
  const baseUrl = resolveBaseUrl();
  const runsyncUrl = resolveRunsyncUrl();
  const apiKey = resolveApiKey();
  const inferenceApiKey = resolveInferenceApiKey();
  const runpodApiKey = resolveRunpodApiKey();
  const orgId = resolveOrgId();
  const preferredLanguage = String(process.env.BOB_ASSIST_LANGUAGE || 'en-NZ').trim();
  const timeoutMs = Number(process.env.BOB_TEST_ASSIST_TIMEOUT_MS || 180000);
  const message = buildBobMessage(stage, command, exitCode);
  const isRunpodBase = /api\.runpod\.ai\//i.test(baseUrl);

  if ((!baseUrl && !runsyncUrl) || !apiKey) {
    console.warn('[bob-test-assist] Credentials missing, running underlying test without AI assist');
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const attempts = [];

    if (baseUrl && !isRunpodBase) {
      attempts.push({
        label: 'bob-chat-message',
        url: `${baseUrl}/chat`,
        key: inferenceApiKey,
        body: {
          message,
          language: preferredLanguage,
        },
      });

      attempts.push({
        label: 'bob-chat-prompt',
        url: `${baseUrl}/chat`,
        key: inferenceApiKey,
        body: {
          prompt: message,
          language: preferredLanguage,
        },
      });
    }

    const effectiveRunsyncUrl = runsyncUrl || (isRunpodBase ? `${baseUrl}/runsync` : '');
    if (effectiveRunsyncUrl) {
      attempts.push({
        label: 'runpod-runsync-message',
        url: effectiveRunsyncUrl,
        key: runpodApiKey,
        body: {
          message,
          language: preferredLanguage,
        },
      });

      attempts.push({
        label: 'runpod-runsync-prompt',
        url: effectiveRunsyncUrl,
        key: runpodApiKey,
        body: {
          prompt: message,
          language: preferredLanguage,
        },
      });

      attempts.push({
        label: 'runpod-runsync-training-note',
        url: effectiveRunsyncUrl,
        key: runpodApiKey,
        body: {
          action: 'training_note',
          message,
          language: preferredLanguage,
        },
      });
    }

    let lastError = '';
    for (const attempt of attempts) {
      if (!attempt.key) {
        lastError = `${attempt.label}: missing API key`;
        continue;
      }

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${attempt.key}`,
        'Accept-Language': preferredLanguage,
      };
      if (attempt.label.startsWith('bob-chat')) {
        headers['x-inference-api-key'] = attempt.key;
      }
      if (orgId) headers['x-org-id'] = orgId;

      const response = await fetch(attempt.url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify(attempt.body),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        lastError = `${attempt.label} (${response.status}): ${body.slice(0, 240)}`;
        continue;
      }

      const payload = await response.json().catch(() => ({}));
      const provider = payload?.provider || 'unknown';
      const fallback = payload?.fallback === true ? 'yes' : 'no';
      console.log(`[bob-test-assist] ${stage} assist completed (provider=${provider}, fallback=${fallback}, channel=${attempt.label})`);
      return;
    }

    throw new Error(`[bob-test-assist] All assist endpoints failed: ${lastError || 'no endpoints attempted'}`);
  } finally {
    clearTimeout(timer);
  }
}

function spawnCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });

    child.on('close', (code, signal) => {
      if (signal) return resolve(1);
      resolve(code ?? 1);
    });

    child.on('error', () => resolve(1));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const divider = argv.indexOf('--');
  const commandParts = divider >= 0 ? argv.slice(divider + 1) : argv;

  if (!commandParts.length) {
    console.error('Usage: node scripts/run-test-with-bob-assist.mjs -- <test-command> [args...]');
    process.exit(2);
  }

  const [command, ...args] = commandParts;
  const commandLabel = [command, ...args].join(' ');

  try {
    await pingBob('pre', commandLabel);
  } catch (error) {
    console.warn('[bob-test-assist] Pre-assist unavailable:', String(error?.message || error));
  }

  const exitCode = await spawnCommand(command, args);

  try {
    await pingBob('post', commandLabel, exitCode);
  } catch (error) {
    console.warn('[bob-test-assist] Post-assist unavailable:', String(error?.message || error));
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error('[bob-test-assist] Unexpected error:', error?.message || error);
  process.exit(1);
});
