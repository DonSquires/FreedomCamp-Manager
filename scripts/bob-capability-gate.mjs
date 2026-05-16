#!/usr/bin/env node

import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const SILENT_WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZCq4AAAAASUVORK5CYII=';

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

function getBoolArg(name, fallback = false) {
  const raw = String(getArg(name, String(fallback))).trim().toLowerCase();
  if (process.argv.includes(`--${name}`)) return true;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function normalizeUrl(raw, defaultScheme = 'https') {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${defaultScheme}://${trimmed}`;
}

export function resolveBobTargets() {
  const podBaseUrl = normalizeUrl(
    process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '',
    'http'
  );

  const explicitRunpod = normalizeUrl(
    process.env.RUNPOD_ENDPOINT_URL ||
      process.env.RUNPOD_RUNSYNC_URL ||
      process.env.RUNPOD_SERVERLESS_URL ||
      process.env.RUNPOD_GATEWAY_URL ||
      process.env.RUNPOD_URL ||
      '',
    'https'
  );

  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
  const runpodBaseUrl = explicitRunpod
    ? explicitRunpod.replace(/\/(runsync|run|run-sync)\/?$/i, '')
    : endpointId
      ? `https://api.runpod.ai/v2/${endpointId}`
      : '';

  const apiKey = String(
    process.env.BOB_INFERENCE_API_KEY ||
      process.env.INFERENCE_API_KEY ||
      process.env.RUNPOD_ENDPOINT_API_KEY ||
      process.env.RUNPOD_API_KEY ||
      ''
  ).trim();

  return { podBaseUrl, runpodBaseUrl, apiKey };
}

export function resolveBobMode(targets = resolveBobTargets()) {
  const forced = String(process.env.BOB_EXECUTION_MODE || 'auto').trim().toLowerCase();
  if (forced === 'pod' || forced === 'serverless' || forced === 'hybrid') return forced;

  const podLooksRunpod = /api\.runpod\.ai\/v2\//i.test(targets.podBaseUrl || '');
  if (podLooksRunpod || targets.runpodBaseUrl) return 'serverless';
  if (targets.podBaseUrl) return 'pod';
  return 'serverless';
}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: { error: String(error?.message || error) } };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isTransientCapabilityFailure(detail = '') {
  const text = String(detail || '').toLowerCase();
  return (
    text.includes('aborted') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('network') ||
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('socket hang up')
  );
}

function parseRetries(value, fallback = 3) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function parseRequiredCapabilities(input) {
  const raw = String(input || process.env.BOB_REQUIRED_CAPABILITIES || 'chat').trim();
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function resolveRepoContext() {
  const repoToken = String(
    process.env.BOB_WORKER_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_API ||
    ''
  ).trim();

  let repoUrl = String(process.env.GITHUB_REPO_URL || process.env.REPO_URL || '').trim();
  let repoBranch = String(process.env.GITHUB_REPO_BRANCH || process.env.REPO_BRANCH || '').trim();

  try {
    if (!repoUrl) {
      repoUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim();
    }
  } catch {}

  try {
    if (!repoBranch) {
      repoBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim();
    }
  } catch {}

  return {
    repoUrl,
    repoBranch: repoBranch || 'main',
    repoToken,
  };
}

function collectForwardedTestEnv() {
  const forwarded = {};
  const prefixes = ['PLAYWRIGHT_', 'E2E_', 'API_TEST_'];
  const exact = new Set([
    'DEFAULT_PLAYWRIGHT_BASE_URL',
    'PLAYWRIGHT_BASE_URL',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'INFERENCE_SERVICE_URL',
    'INFERENCE_API_KEY',
  ]);

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (prefixes.some((prefix) => key.startsWith(prefix)) || exact.has(key)) {
      forwarded[key] = value;
    }
  }

  const aliases = [
    ['PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL'],
    ['PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD'],
    ['PLAYWRIGHT_CLIENT_VIEWER_EMAIL', 'PLAYWRIGHT_CLIENT_EMAIL'],
    ['PLAYWRIGHT_CLIENT_VIEWER_PASSWORD', 'PLAYWRIGHT_CLIENT_PASSWORD'],
    ['PLAYWRIGHT_CLIENT_STAFF_EMAIL', 'PLAYWRIGHT_CLIENT_OFFICER_EMAIL'],
    ['PLAYWRIGHT_CLIENT_STAFF_PASSWORD', 'PLAYWRIGHT_CLIENT_OFFICER_PASSWORD'],
  ];

  for (const [target, source] of aliases) {
    if (!forwarded[target] && forwarded[source]) forwarded[target] = forwarded[source];
  }

  if (!forwarded.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK) {
    forwarded.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK = '1';
  }

  return forwarded;
}

async function checkServerlessCapability(capability, targets, timeoutMs, retries = 1) {
  const endpoint = `${targets.runpodBaseUrl.replace(/\/+$/, '')}/runsync`;
  const headers = {
    Authorization: `Bearer ${targets.apiKey}`,
    'Content-Type': 'application/json',
  };

  const actionMap = {
    ping: { action: 'ping' },
    chat: { action: 'chat', message: 'capability check ping', history: [] },
    review: {
      action: 'review',
      message: 'Synthetic watchdog check for review action readiness.',
    },
    assess: {
      action: 'assess',
      type: 'general',
      description: 'Synthetic capability gate assessment input',
    },
    self_heal: {
      action: 'self_heal',
      report: {
        summary: 'Capability gate synthetic check',
        description: 'Synthetic check',
        severity: 'low',
        issue_type: 'bug',
      },
    },
    translate: {
      action: 'translate',
      text: 'Kia ora',
      target_language: 'en',
      source_language: 'mi',
    },
    training_note: {
      action: 'training_note',
      message: 'Synthetic capability gate training note',
    },
    ui_vision: {
      action: 'ui_vision',
      focus: 'general',
      image_b64: TINY_PNG_BASE64,
    },
    speak: { action: 'speak', text: 'capability check', style: 'default' },
    transcribe: {
      action: 'transcribe',
      audio_base64: SILENT_WAV_BASE64,
      audio_mime_type: 'audio/wav',
      language: 'en',
    },
    run_playwright: { action: 'run_playwright', scope: 'quick', dry_run: true, timeout_ms: 15000 },
    render_media_pack: {
      action: 'render_media_pack',
      title: 'Capability gate media pack',
      objective: 'Generate a short field briefing media package for testing.',
      language: 'en-NZ',
      quality: 'low',
      format: 'mp4',
    },
  };

  const input = actionMap[capability];
  if (!input) {
    return { capability, ok: false, reason: 'unsupported-capability' };
  }

  const maxAttempts = parseRetries(retries, 1);
  let last = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await fetchJson(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ input }),
      },
      timeoutMs
    );

    const status = String(result.data?.status || '').toUpperCase();
    const output = result.data?.output;
    const detail = String(result.data?.error || output?.error || 'failed');

    const ok = result.ok &&
      status !== 'FAILED' &&
      output?.success !== false &&
      (capability !== 'transcribe' || typeof output?.transcript !== 'undefined' || output?.client_action === 'web_speech_recognition') &&
      (capability !== 'speak' || Boolean(output?.audio_base64 || output?.spoken_text || output?.client_action)) &&
      (capability !== 'ui_vision' || !/image_b64 required/i.test(String(output?.error || result.data?.error || ''))) &&
      (capability !== 'render_media_pack' || Boolean(output?.picture?.image_base64 && output?.video?.video_base64 && output?.audio));

    const attemptResult = {
      capability,
      ok,
      httpStatus: result.status,
      status,
      attempt,
      attempts: maxAttempts,
      detail: ok ? 'ok' : detail,
      transient: !ok && isTransientCapabilityFailure(detail),
    };

    if (ok) {
      return attemptResult;
    }

    last = attemptResult;
    if (!attemptResult.transient || attempt >= maxAttempts) {
      return attemptResult;
    }

    console.warn(`Capability ${capability} transient failure on attempt ${attempt}/${maxAttempts}; retrying...`);
  }

  return last || { capability, ok: false, httpStatus: 0, status: '', detail: 'unknown failure', attempt: maxAttempts, attempts: maxAttempts, transient: false };
}

async function checkPodCapability(capability, targets, timeoutMs) {
  const base = targets.podBaseUrl.replace(/\/+$/, '');
  const headers = {
    'Content-Type': 'application/json',
    ...(targets.apiKey
      ? {
          Authorization: `Bearer ${targets.apiKey}`,
          'x-inference-api-key': targets.apiKey,
        }
      : {}),
  };

  async function runPodAsyncAction(input) {
    const repo = resolveRepoContext();
    const forwardedEnv = collectForwardedTestEnv();
    const create = await fetchJson(`${base}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: {
          ...input,
          ...(repo.repoUrl ? { repo_url: repo.repoUrl } : {}),
          ...(repo.repoBranch ? { repo_branch: repo.repoBranch } : {}),
          ...(repo.repoToken ? { repo_token: repo.repoToken } : {}),
          repo_auth_mode: 'token',
          ...forwardedEnv,
        },
      }),
    }, timeoutMs);

    if (!create.ok) {
      return {
        ok: false,
        httpStatus: create.status,
        detail: String(create.data?.error || create.data?.message || 'failed-to-queue-pod-job'),
      };
    }

    const jobId = String(create.data?.id || '').trim();
    if (!jobId) {
      return {
        ok: false,
        httpStatus: create.status,
        detail: 'pod-job-id-missing',
      };
    }

    const pollStartedAt = Date.now();
    const intervalMs = 2000;
    while (Date.now() - pollStartedAt <= timeoutMs) {
      const status = await fetchJson(`${base}/status/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers,
      }, timeoutMs);

      if (!status.ok) {
        return {
          ok: false,
          httpStatus: status.status,
          detail: String(status.data?.error || status.data?.message || 'pod-job-status-failed'),
        };
      }

      const state = String(status.data?.status || '').toUpperCase();
      if (state === 'COMPLETED') {
        const output = status.data?.output || {};
        const outputOk = output?.success !== false;
        return {
          ok: outputOk,
          httpStatus: status.status,
          detail: outputOk ? 'ok' : String(output?.error || status.data?.error || 'pod-job-output-failed'),
        };
      }

      if (state === 'FAILED' || state === 'CANCELLED' || state === 'TIMED_OUT') {
        return {
          ok: false,
          httpStatus: status.status,
          detail: String(status.data?.error || status.data?.output?.error || `pod-job-${state.toLowerCase()}`),
        };
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return {
      ok: false,
      httpStatus: 408,
      detail: `pod-job-timeout-${timeoutMs}ms`,
    };
  }

  if (capability === 'chat') {
    const result = await fetchJson(`${base}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'capability check ping' }),
    }, timeoutMs);
    const msg = result.data?.message || result.data?.response || result.data?.output?.message;
    return {
      capability,
      ok: result.ok && Boolean(msg),
      httpStatus: result.status,
      detail: result.ok ? 'ok' : String(result.data?.error || 'failed'),
    };
  }

  if (capability === 'health') {
    const result = await fetchJson(`${base}/health`, { method: 'GET' }, timeoutMs);
    const state = String(result.data?.status || '').toLowerCase();
    return {
      capability,
      ok: result.ok && (state === 'healthy' || state === 'ok' || result.status === 200),
      httpStatus: result.status,
      detail: state || 'unknown',
    };
  }

  if (capability === 'speak') {
    const result = await fetchJson(`${base}/infer/speak`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'capability check', style: 'default' }),
    }, timeoutMs);
    return {
      capability,
      ok: result.ok && Boolean(result.data?.audio_base64 || result.data?.spoken_text || result.data?.client_action),
      httpStatus: result.status,
      detail: result.ok ? 'ok' : String(result.data?.error || 'failed'),
    };
  }

  if (capability === 'transcribe') {
    const result = await fetchJson(`${base}/infer/transcribe`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        audio_base64: SILENT_WAV_BASE64,
        audio_mime_type: 'audio/wav',
        language: 'en',
      }),
    }, timeoutMs);
    return {
      capability,
      ok: result.ok && (typeof result.data?.transcript !== 'undefined' || result.data?.client_action === 'web_speech_recognition'),
      httpStatus: result.status,
      detail: result.ok ? 'ok' : String(result.data?.error || 'failed'),
    };
  }

  if (capability === 'self_heal') {
    const result = await fetchJson(`${base}/self-heal/bug-report`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        report: {
          summary: 'Capability gate synthetic check',
          description: 'Synthetic check',
          severity: 'low',
          issue_type: 'bug',
        },
      }),
    }, timeoutMs);
    return {
      capability,
      ok: result.ok && result.data?.success === true && Boolean(result.data?.plan),
      httpStatus: result.status,
      detail: result.ok ? 'ok' : String(result.data?.error || 'failed'),
    };
  }

  if (capability === 'executor') {
    const result = await fetchJson(`${base}/code/executor/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 1 }),
    }, timeoutMs);
    return {
      capability,
      ok: result.ok && result.data?.success !== false,
      httpStatus: result.status,
      detail: result.ok ? 'ok' : String(result.data?.error || 'failed'),
    };
  }

  if (capability === 'run_playwright') {
    const result = await runPodAsyncAction({
      action: 'run_playwright',
      scope: 'quick',
      reporter: 'json',
      specs: [
        'tests/e2e/bootstrap-routes.test.ts',
        '--project=chromium',
        '--grep=Summary: All Bootstrap Routes Smoke Tests',
      ],
      timeout_ms: Math.min(180000, timeoutMs),
    });

    return {
      capability,
      ok: result.ok,
      httpStatus: result.httpStatus,
      detail: result.detail,
    };
  }

  if (capability === 'playwright_chromium' || capability === 'playwright_firefox' || capability === 'playwright_webkit') {
    const browser = capability.replace('playwright_', '');
    const result = await runPodAsyncAction({
      action: 'run_playwright',
      reporter: 'json',
      specs: ['--list', `--project=${browser}`],
      timeout_ms: Math.min(60000, timeoutMs),
    });

    return {
      capability,
      ok: result.ok,
      httpStatus: result.httpStatus,
      detail: result.detail,
    };
  }

  return { capability, ok: false, reason: 'unsupported-capability' };
}

export async function checkBobCapabilities(options = {}) {
  const targets = options.targets || resolveBobTargets();
  const mode = options.mode || resolveBobMode(targets);
  const required = options.required || parseRequiredCapabilities(options.requiredRaw);
  const timeoutMs = Number(options.timeoutMs || process.env.BOB_CAPABILITY_TIMEOUT_MS || 30000);
  const retries = parseRetries(options.retries || process.env.BOB_CAPABILITY_RETRIES || 3, 3);

  if (!required.length) {
    return { ok: true, mode, required: [], checks: [] };
  }

  if (!targets.apiKey) {
    return {
      ok: false,
      mode,
      required,
      checks: required.map((capability) => ({ capability, ok: false, reason: 'missing-api-key' })),
    };
  }

  if (mode === 'serverless' && !targets.runpodBaseUrl) {
    return {
      ok: false,
      mode,
      required,
      checks: required.map((capability) => ({ capability, ok: false, reason: 'missing-runpod-endpoint' })),
    };
  }

  if ((mode === 'pod' || mode === 'hybrid') && !targets.podBaseUrl) {
    return {
      ok: false,
      mode,
      required,
      checks: required.map((capability) => ({ capability, ok: false, reason: 'missing-pod-endpoint' })),
    };
  }

  const checks = [];
  for (const capability of required) {
    if (mode === 'serverless') {
      checks.push(await checkServerlessCapability(capability, targets, timeoutMs, retries));
    } else {
      checks.push(await checkPodCapability(capability, targets, timeoutMs));
    }
  }

  return {
    ok: checks.every((entry) => entry.ok),
    mode,
    required,
    retries,
    checks,
    checkedAt: new Date().toISOString(),
  };
}

export async function ensureBobCapabilities(options = {}) {
  const strict = typeof options.strict === 'boolean'
    ? options.strict
    : String(process.env.BOB_CAPABILITY_STRICT || 'true').trim().toLowerCase() !== 'false';

  const report = await checkBobCapabilities(options);
  if (strict && !report.ok) {
    const failed = report.checks.filter((entry) => !entry.ok).map((entry) => entry.capability).join(', ');
    const reason = report.checks.filter((entry) => !entry.ok).map((entry) => `${entry.capability}:${entry.detail || entry.reason || 'failed'}`).join('; ');
    throw new Error(`[Bob Capability Gate] Missing required capabilities (${failed}) in mode=${report.mode}. ${reason}`);
  }
  return report;
}

async function main() {
  const requiredRaw = getArg('required', process.env.BOB_REQUIRED_CAPABILITIES || 'chat');
  const mode = getArg('mode', process.env.BOB_EXECUTION_MODE || 'auto');
  const strict = getBoolArg('strict', String(process.env.BOB_CAPABILITY_STRICT || 'true').toLowerCase() !== 'false');
  const timeoutMs = Number(getArg('timeoutMs', process.env.BOB_CAPABILITY_TIMEOUT_MS || '30000'));
  const retries = parseRetries(getArg('retries', process.env.BOB_CAPABILITY_RETRIES || '3'), 3);

  const report = await checkBobCapabilities({
    requiredRaw,
    mode: mode === 'auto' ? undefined : mode,
    timeoutMs,
    retries,
  });

  console.log(JSON.stringify(report, null, 2));
  if (strict && !report.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
