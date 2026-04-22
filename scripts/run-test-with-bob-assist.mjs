#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

function envFlag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function resolveBaseUrl() {
  const raw =
    process.env.BOB_SERVICE_URL ||
    process.env.INFERENCE_SERVICE_URL ||
    process.env.RUNPOD_GATEWAY_URL ||
    process.env.RUNPOD_SERVERLESS_URL ||
    '';
  return String(raw).trim().replace(/\/+$/, '');
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

function resolveOrgId() {
  return String(
    process.env.BOB_ORG_ID ||
    process.env.ORG_ID ||
    process.env.DEFAULT_ORG_ID ||
    ''
  ).trim();
}

function resolveSystemHealthOutputPath() {
  return path.resolve(process.cwd(), process.env.BOB_TEST_HEALTH_SNAPSHOT_PATH || 'tools/system-health.json');
}

function isTruthyStatus(value) {
  return ['healthy', 'ok', 'online', 'operational', 'ready', 'up'].includes(String(value || '').toLowerCase());
}

function isDegradedStatus(value) {
  return ['degraded', 'warning', 'partial'].includes(String(value || '').toLowerCase());
}

function parseHealthEndpoints() {
  const configured = String(process.env.BOB_TEST_HEALTH_ENDPOINTS || '').trim();
  if (configured) {
    return configured
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name, ...urlParts] = entry.split('=');
        const url = urlParts.join('=').trim();
        return url ? { name: name.trim(), url } : { name: 'service', url: name.trim() };
      })
      .filter((entry) => entry.url);
  }

  const endpoints = [];
  const baseUrl = resolveBaseUrl();
  if (baseUrl) endpoints.push({ name: 'bob', url: `${baseUrl}/health`, headers: { Accept: 'application/json' } });

  const pttBaseUrl = String(process.env.PTT_SERVER_URL || process.env.PTT_SERVICE_URL || '').trim().replace(/\/+$/, '');
  if (pttBaseUrl) endpoints.push({ name: 'ptt', url: `${pttBaseUrl}/health`, headers: { Accept: 'application/json' } });

  const runpodBaseUrl = String(process.env.RUNPOD_GATEWAY_URL || process.env.RUNPOD_SERVERLESS_URL || '').trim().replace(/\/+$/, '');
  if (runpodBaseUrl) endpoints.push({ name: 'runpod', url: `${runpodBaseUrl}/health`, headers: { Accept: 'application/json' } });

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = String(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (supabaseUrl && supabaseAnonKey) {
    endpoints.push({
      name: 'supabase',
      url: `${supabaseUrl}/rest/v1/organizations?select=id&limit=1`,
      headers: { Accept: 'application/json', apikey: supabaseAnonKey },
    });
  }

  return endpoints;
}

async function fetchHealthSnapshot() {
  const endpoints = parseHealthEndpoints();
  const timeoutMs = Number(process.env.BOB_TEST_HEALTH_TIMEOUT_MS || 5000);
  const services = [];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint.url, {
        method: 'GET',
        headers: endpoint.headers || { Accept: 'application/json' },
        signal: controller.signal,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      const statusValue = payload?.status || response.status;
      const status = !response.ok
        ? 'offline'
        : isTruthyStatus(statusValue)
          ? 'online'
          : isDegradedStatus(statusValue)
            ? 'degraded'
            : 'online';

      services.push({
        name: endpoint.name,
        url: endpoint.url,
        status,
        httpStatus: response.status,
        reportedStatus: payload?.status || null,
      });
    } catch (error) {
      services.push({
        name: endpoint.name,
        url: endpoint.url,
        status: 'offline',
        httpStatus: null,
        reportedStatus: null,
        error: String(error?.message || error),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const summary = Object.fromEntries(services.map((service) => [service.name, service.status]));
  const overall = services.some((service) => service.status === 'offline')
    ? 'offline'
    : services.some((service) => service.status === 'degraded')
      ? 'degraded'
      : 'online';

  return {
    checkedAt: new Date().toISOString(),
    overall,
    services,
    summary,
  };
}

function writeHealthSnapshot(snapshot) {
  const outputPath = resolveSystemHealthOutputPath();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return outputPath;
}

function applyMockModeAliases() {
  const mockRequested = envFlag(
    process.env.VITE_PTT_MOCK_MODE ?? process.env.PTT_MOCK_MODE ?? process.env.NEXT_PUBLIC_API_MOCK,
    false,
  );

  if (!mockRequested) return false;

  process.env.VITE_PTT_MOCK_MODE = 'true';
  process.env.NEXT_PUBLIC_API_MOCK = 'true';
  if (!process.env.VITE_API_MOCK_MODE) {
    process.env.VITE_API_MOCK_MODE = 'true';
  }
  return true;
}

function createFailureReflection(command, exitCode, healthSnapshot) {
  const enabled = envFlag(process.env.BOB_TEST_WRITE_FAILURE_NOTE, true);
  if (!enabled || exitCode === 0) return null;

  const timestamp = new Date().toISOString();
  const slug = timestamp.replace(/[:.]/g, '-');
  const notesDir = path.resolve(process.cwd(), 'knowledge_base', 'failures');
  const notePath = path.join(notesDir, `${slug}.md`);
  const services = (healthSnapshot?.services || [])
    .map((service) => `- ${service.name}: ${service.status}${service.httpStatus ? ` (HTTP ${service.httpStatus})` : ''}`)
    .join('\n') || '- Not captured';

  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(notePath, [
    `# Failure Reflection`,
    '',
    `- Timestamp: ${timestamp}`,
    `- Command: ${command}`,
    `- Exit Code: ${exitCode}`,
    `- Overall Health: ${healthSnapshot?.overall || 'unknown'}`,
    '',
    `## Service Snapshot`,
    services,
    '',
    `## What Broke`,
    `- TODO`,
    '',
    `## Root Cause`,
    `- TODO`,
    '',
    `## Fix Applied`,
    `- TODO`,
    '',
    `## Follow-up Guard`,
    `- TODO`,
    '',
  ].join('\n'), 'utf8');
  return notePath;
}

function buildBobMessage(stage, command, exitCode = null) {
  if (stage === 'pre') {
    return [
      'Bob, assist this automated test run.',
      `Stage: pre-run`,
      `Command: ${command}`,
      'Provide concise risk focus areas and expected failure hotspots for this stack.',
    ].join('\n');
  }

  return [
    'Bob, assist post-test triage for this automated run.',
    `Stage: post-run`,
    `Command: ${command}`,
    `Exit code: ${exitCode}`,
    exitCode === 0
      ? 'Tests passed. Provide quick verification checks for regressions we should still watch.'
      : 'Tests failed. Provide likely root causes and first 3 concrete remediation steps.',
  ].join('\n');
}

async function pingBob(stage, command, exitCode = null) {
  const baseUrl = resolveBaseUrl();
  const apiKey = resolveApiKey();
  const orgId = resolveOrgId();
  const required = envFlag(process.env.REQUIRE_BOB_TEST_ASSIST, false);
  const timeoutMs = Number(process.env.BOB_TEST_ASSIST_TIMEOUT_MS || 15000);

  if (!baseUrl || !apiKey) {
    const missing = [
      !baseUrl ? 'BOB_SERVICE_URL-or-INFERENCE_SERVICE_URL' : null,
      !apiKey ? 'BOB_INFERENCE_API_KEY-or-INFERENCE_API_KEY-or-SUPABASE_SERVICE_ROLE_KEY' : null,
    ].filter(Boolean).join(', ');

    const message = `[bob-test-assist] Missing Bob config: ${missing}`;
    if (required) throw new Error(message);
    console.warn(`${message} — credentials missing, running underlying test without AI assist`);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-inference-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    };
    if (orgId) headers['x-org-id'] = orgId;

    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        message: buildBobMessage(stage, command, exitCode),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`[bob-test-assist] Bob /chat failed (${response.status}): ${body.slice(0, 240)}`);
    }

    const payload = await response.json().catch(() => ({}));
    const provider = payload?.provider || 'unknown';
    const fallback = payload?.fallback === true ? 'yes' : 'no';
    console.log(`[bob-test-assist] ${stage} assist completed (provider=${provider}, fallback=${fallback})`);
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
  const mockModeEnabled = applyMockModeAliases();
  let healthSnapshot = null;

  if (envFlag(process.env.BOB_TEST_HEALTHCHECK, true)) {
    healthSnapshot = await fetchHealthSnapshot();
    const healthOutputPath = writeHealthSnapshot(healthSnapshot);
    console.log(`[bob-test-assist] Health snapshot written to ${healthOutputPath}`);

    if (healthSnapshot.overall !== 'online' && envFlag(process.env.BOB_TEST_ABORT_ON_UNHEALTHY, true)) {
      console.error(`[bob-test-assist] Aborting test run because system health is ${healthSnapshot.overall}`);
      createFailureReflection(commandLabel, 3, healthSnapshot);
      process.exit(3);
    }
  }

  if (mockModeEnabled) {
    console.log('[bob-test-assist] Mock mode enabled (VITE_PTT_MOCK_MODE=true)');
  }

  try {
    await pingBob('pre', commandLabel);
  } catch (error) {
    console.warn('[bob-test-assist] Pre-assist unavailable:', String(error?.message || error));
  }

  const exitCode = await spawnCommand(command, args);
  const notePath = createFailureReflection(commandLabel, exitCode, healthSnapshot);
  if (notePath) {
    console.log(`[bob-test-assist] Failure reflection template created at ${notePath}`);
  }

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
