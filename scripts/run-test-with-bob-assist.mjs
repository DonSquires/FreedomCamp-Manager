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

function deriveRunpodBaseFromUrl(rawUrl) {
  if (!isHttpUrl(rawUrl)) return '';

  try {
    const url = new URL(String(rawUrl).trim());
    const segments = url.pathname.split('/').filter(Boolean);
    const v2Index = segments.findIndex((segment) => segment === 'v2');
    if (v2Index < 0) return '';

    const endpointId = segments[v2Index + 1];
    if (!endpointId) return '';

    return `${url.origin}/v2/${endpointId}`;
  } catch {
    return '';
  }
}

function resolveRunpodBaseUrl(baseUrl) {
  const fromExplicitUrl = [
    process.env.RUNPOD_RUNSYNC_URL,
    process.env.RUNPOD_SERVERLESS_URL,
    process.env.RUNPOD_GATEWAY_URL,
  ]
    .map((value) => deriveRunpodBaseFromUrl(value))
    .find(Boolean);

  if (fromExplicitUrl) return fromExplicitUrl;

  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
  if (endpointId) return `https://api.runpod.ai/v2/${endpointId}`;

  return deriveRunpodBaseFromUrl(baseUrl);
}

function resolveLegacyRunsyncUrl(baseUrl) {
  const direct = [
    process.env.RUNPOD_RUNSYNC_URL,
    process.env.RUNPOD_SERVERLESS_URL,
  ].find((value) => isHttpUrl(value));

  if (direct) return String(direct).trim().replace(/\/+$/, '');

  const runpodBase = resolveRunpodBaseUrl(baseUrl);
  if (!runpodBase) return '';
  return `${runpodBase}/runsync`;
}

async function invokeRunpodAsync(runpodBaseUrl, headers, body, signal, maxWaitMs) {
  const runResponse = await fetch(`${runpodBaseUrl}/run`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(body),
  });

  if (!runResponse.ok) {
    const bodyText = await runResponse.text().catch(() => '');
    throw new Error(`runpod-run (${runResponse.status}): ${bodyText.slice(0, 240)}`);
  }

  const runPayload = await runResponse.json().catch(() => ({}));
  const jobId = String(runPayload?.id || '').trim();
  if (!jobId) {
    throw new Error('runpod-run: missing job id in response');
  }

  const startedAt = Date.now();

  while (true) {
    if (signal?.aborted) throw new Error('This operation was aborted');
    if (Date.now() - startedAt > maxWaitMs) {
      throw new Error(`runpod-status timeout after ${maxWaitMs}ms`);
    }

    const statusResponse = await fetch(`${runpodBaseUrl}/status/${jobId}`, {
      method: 'GET',
      headers,
      signal,
    });

    if (!statusResponse.ok) {
      const bodyText = await statusResponse.text().catch(() => '');
      throw new Error(`runpod-status (${statusResponse.status}): ${bodyText.slice(0, 240)}`);
    }

    const statusPayload = await statusResponse.json().catch(() => ({}));
    const status = String(statusPayload?.status || '').toUpperCase();

    if (status === 'COMPLETED' || status === 'SUCCESS') {
      return statusPayload?.output || statusPayload;
    }

    if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
      throw new Error(`runpod-status ${status}: ${JSON.stringify(statusPayload).slice(0, 240)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
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
  const runpodBaseUrl = resolveRunpodBaseUrl(baseUrl);
  const legacyRunsyncUrl = resolveLegacyRunsyncUrl(baseUrl);
  const apiKey = resolveApiKey();
  const inferenceApiKey = resolveInferenceApiKey();
  const runpodApiKey = resolveRunpodApiKey();
  const orgId = resolveOrgId();
  const preferredLanguage = String(process.env.BOB_ASSIST_LANGUAGE || 'en-NZ').trim();
  const timeoutMs = Number(process.env.BOB_TEST_ASSIST_TIMEOUT_MS || 180000);
  const runpodAsyncMaxWaitMs = Number(process.env.BOB_TEST_ASSIST_RUNPOD_ASYNC_WAIT_MS || 45000);
  const message = buildBobMessage(stage, command, exitCode);
  const isRunpodBase = /api\.runpod\.ai\//i.test(baseUrl);

  if ((!baseUrl && !runpodBaseUrl && !legacyRunsyncUrl) || !apiKey) {
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

    const effectiveRunpodBaseUrl = runpodBaseUrl || (isRunpodBase ? deriveRunpodBaseFromUrl(baseUrl) : '');
    if (effectiveRunpodBaseUrl) {
      attempts.push({
        label: 'runpod-run-sync-message',
        url: `${effectiveRunpodBaseUrl}/run-sync`,
        key: runpodApiKey,
        mode: 'direct',
        body: {
          message,
          language: preferredLanguage,
        },
      });

      attempts.push({
        label: 'runpod-run-sync-prompt',
        url: `${effectiveRunpodBaseUrl}/run-sync`,
        key: runpodApiKey,
        mode: 'direct',
        body: {
          prompt: message,
          language: preferredLanguage,
        },
      });

      attempts.push({
        label: 'runpod-run-sync-prompt',
        url: `${effectiveRunpodBaseUrl}/run-sync`,
        key: runpodApiKey,
        mode: 'direct',
        body: {
          prompt: message,
          language: preferredLanguage,
        },
      });

      attempts.push({
        label: 'runpod-run-async-message',
        url: effectiveRunpodBaseUrl,
        key: runpodApiKey,
        mode: 'async',
        body: {
          message,
          language: preferredLanguage,
        },
      });

      attempts.push({
        label: 'runpod-run-async-prompt',
        url: effectiveRunpodBaseUrl,
        key: runpodApiKey,
        mode: 'async',
        body: {
          prompt: message,
          language: preferredLanguage,
          message,
          language: preferredLanguage,
        },
      });

      attempts.push({
        label: 'runpod-legacy-runsync-prompt',
        url: legacyRunsyncUrl,
        key: runpodApiKey,
        mode: 'direct',
        body: {
          prompt: message,
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

      try {
        let payload = {};
        if (attempt.mode === 'async') {
          payload = await invokeRunpodAsync(attempt.url, headers, attempt.body, controller.signal, runpodAsyncMaxWaitMs);
        } else {
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

          payload = await response.json().catch(() => ({}));
        }

        const provider = payload?.provider || 'unknown';
        const fallback = payload?.fallback === true ? 'yes' : 'no';
        console.log(`[bob-test-assist] ${stage} assist completed (provider=${provider}, fallback=${fallback}, channel=${attempt.label})`);
        return;
      } catch (error) {
        lastError = `${attempt.label}: ${String(error?.message || error).slice(0, 240)}`;
      }
    }

    if (lastError) {
      throw new Error(`[bob-test-assist] All assist endpoints failed: ${lastError || 'no endpoints attempted'}`);
    }
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
