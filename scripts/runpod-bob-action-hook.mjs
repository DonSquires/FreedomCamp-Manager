#!/usr/bin/env node

import process from 'node:process';
import { spawn } from 'node:child_process';

function getArg(name, fallback = '') {
  const key = `--${name}`;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '');
    if (token === key) return String(args[i + 1] || fallback);
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1) || fallback;
  }
  return fallback;
}

function normalizeBaseUrl(raw) {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/(?:run|runsync|run-sync)\/?$/i, '');
}

function resolveEndpointBaseUrl() {
  const direct = normalizeBaseUrl(
    process.env.INFERENCE_SERVICE_URL ||
    process.env.RUNPOD_ENDPOINT_URL ||
    process.env.RUNPOD_SERVERLESS_URL ||
    process.env.RUNPOD_RUNSYNC_URL,
  );
  if (direct) return direct;

  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
  if (endpointId) return `https://api.runpod.ai/v2/${endpointId}`;
  return '';
}

function resolveApiKey() {
  return String(
    process.env.INFERENCE_API_KEY ||
    process.env.RUNPOD_ENDPOINT_API_KEY ||
    process.env.RUNPOD_API_KEY ||
    ''
  ).trim();
}

async function runCommand(command, label) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, { shell: true, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('exit', (code) => {
      resolve({
        ok: (code ?? 1) === 0,
        code: code ?? 1,
        label,
        command,
        durationMs: Date.now() - startedAt,
        stdout: stdout.slice(0, 3000),
        stderr: stderr.slice(0, 3000),
      });
    });
  });
}

async function pingRunsync() {
  const endpointBaseUrl = resolveEndpointBaseUrl();
  const apiKey = resolveApiKey();
  if (!endpointBaseUrl || !apiKey) {
    return {
      ok: false,
      status: 0,
      reason: 'missing-endpoint-or-key',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${endpointBaseUrl}/runsync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'x-inference-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: { action: 'chat', message: 'ping' } }),
      signal: controller.signal,
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      bodyPreview: text.slice(0, 300),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      reason: String(error?.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function pingRunsyncWithRetry(attempts = 2) {
  let last = null;
  for (let index = 0; index < attempts; index += 1) {
    const result = await pingRunsync();
    last = result;
    if (result?.ok) return result;
  }
  return last;
}

async function startPodIfConfigured() {
  const podId = String(process.env.RUNPOD_POD_ID || '').trim();
  if (!podId) {
    return { ok: false, skipped: true, reason: 'RUNPOD_POD_ID not set' };
  }
  return runCommand(`node scripts/runpod-pod-control.mjs start --pod ${podId}`, 'pod-start');
}

async function stopPodIfConfigured() {
  const podId = String(process.env.RUNPOD_POD_ID || '').trim();
  if (!podId) {
    return { ok: false, skipped: true, reason: 'RUNPOD_POD_ID not set' };
  }
  return runCommand(`node scripts/runpod-pod-control.mjs stop --pod ${podId}`, 'pod-stop');
}

async function runRecovery() {
  const pod = await startPodIfConfigured();
  const ping = await pingRunsyncWithRetry(2);
  return {
    action: 'recover',
    ok: Boolean(pod?.ok || ping?.ok),
    pod,
    ping,
  };
}

async function runScaleUp() {
  const pod = await startPodIfConfigured();
  const ping = await pingRunsync();
  return {
    action: 'scale-up',
    ok: Boolean(pod?.ok || ping?.ok),
    pod,
    ping,
    note: 'For serverless endpoints without pod control, this action performs a warm ping only.',
  };
}

async function runScaleDown() {
  const pod = await stopPodIfConfigured();
  return {
    action: 'scale-down',
    ok: Boolean(pod?.ok || pod?.skipped),
    pod,
    note: pod?.skipped
      ? 'No pod configured; serverless worker counts must be adjusted in RunPod Console.'
      : 'Pod stop requested.',
  };
}

async function main() {
  const action = String(getArg('action', process.argv[2] || '')).trim().toLowerCase();
  if (!['recover', 'scale-up', 'scale-down'].includes(action)) {
    console.error('Usage: node scripts/runpod-bob-action-hook.mjs --action <recover|scale-up|scale-down>');
    process.exit(1);
  }

  let result;
  if (action === 'recover') result = await runRecovery();
  if (action === 'scale-up') result = await runScaleUp();
  if (action === 'scale-down') result = await runScaleDown();

  console.log(JSON.stringify(result, null, 2));
  process.exit(result?.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});