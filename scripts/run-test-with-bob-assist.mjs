#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

function envFlag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function resolveBaseUrl() {
  const raw = process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '';
  return String(raw).trim().replace(/\/+$/, '');
}

function resolveApiKey() {
  return String(
    process.env.BOB_INFERENCE_API_KEY ||
    process.env.INFERENCE_API_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
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
  const required = envFlag(process.env.REQUIRE_BOB_TEST_ASSIST, true);
  const timeoutMs = Number(process.env.BOB_TEST_ASSIST_TIMEOUT_MS || 15000);

  if (!baseUrl || !apiKey) {
    const missing = [
      !baseUrl ? 'BOB_SERVICE_URL-or-INFERENCE_SERVICE_URL' : null,
      !apiKey ? 'BOB_INFERENCE_API_KEY-or-INFERENCE_API_KEY-or-SUPABASE_SERVICE_ROLE_KEY' : null,
    ].filter(Boolean).join(', ');

    const message = `[bob-test-assist] Missing Bob config: ${missing}`;
    if (required) throw new Error(message);
    console.warn(`${message} (continuing because REQUIRE_BOB_TEST_ASSIST=false)`);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-inference-api-key': apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
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

  try {
    await pingBob('pre', commandLabel);
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(2);
  }

  const exitCode = await spawnCommand(command, args);

  try {
    await pingBob('post', commandLabel, exitCode);
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(2);
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error('[bob-test-assist] Unexpected error:', error?.message || error);
  process.exit(1);
});
