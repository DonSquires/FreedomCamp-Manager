#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const DEFAULT_STATE_FILE = '.runtime/runpod-bob-supervisor-state.json';

function getArg(name, fallback = '') {
  const key = `--${name}`;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || '');
    if (token === key) return String(args[index + 1] || fallback);
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1) || fallback;
  }
  return fallback;
}

function getBooleanArg(name, fallback = false) {
  const key = `--${name}`;
  const args = process.argv.slice(2);
  if (args.includes(key)) {
    return true;
  }

  const raw = String(getArg(name, String(fallback))).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function printHelp() {
  console.log(`RunPod Bob supervisor

Usage:
  node scripts/runpod-bob-supervisor.mjs [--once] [--dryRun]

Purpose:
  - smoke-test Bob's RunPod endpoint
  - track consecutive failures in a local state file
  - run recovery / scale-up hooks after repeated failures
  - optionally scale down after a period of inactivity based on an activity file

Environment:
  INFERENCE_SERVICE_URL or RUNPOD_ENDPOINT_ID
  INFERENCE_API_KEY or RUNPOD_ENDPOINT_API_KEY or RUNPOD_API_KEY

Optional automation hooks:
  BOB_RUNPOD_RECOVER_CMD
  BOB_RUNPOD_SCALE_UP_CMD
  BOB_RUNPOD_SCALE_DOWN_CMD
  RUNPOD_POD_ID              # enables built-in pod start/stop fallback

Optional activity-driven scale-down:
  BOB_SUPERVISOR_ACTIVITY_FILE

Mode selection:
  BOB_SUPERVISOR_MODE=auto|serverless|pod   # default: auto
  In pod mode, smoke uses GET /health instead of POST /runsync.

Optional periodic self-test hook:
  BOB_SUPERVISOR_SELF_TEST_CMD
  BOB_SUPERVISOR_SELF_TEST_INTERVAL_MS      # default: 15m

Common flags:
  --once
  --dryRun
  --intervalMs <ms>
  --failureThreshold <count>
  --smokeTimeoutMs <ms>
`);
}

function envNumber(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBaseUrl(raw) {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function deriveEndpointBaseUrl() {
  const direct = normalizeBaseUrl(
    process.env.INFERENCE_SERVICE_URL ||
    process.env.RUNPOD_ENDPOINT_URL ||
    process.env.RUNPOD_SERVERLESS_URL ||
    process.env.RUNPOD_RUNSYNC_URL,
  );

  if (direct) {
    return direct.replace(/\/(?:run|runsync|run-sync)\/?$/i, '');
  }

  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
  if (endpointId) {
    return `https://api.runpod.ai/v2/${endpointId}`;
  }

  return '';
}

function resolveApiKey() {
  return String(
    process.env.INFERENCE_API_KEY ||
      process.env.RUNPOD_ENDPOINT_API_KEY ||
      process.env.RUNPOD_API_KEY ||
      process.env.DR_BOB_API ||
      ''
  ).trim();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {
      consecutiveFailures: 0,
      lastHealthyAt: 0,
      lastFailureAt: 0,
      lastScaleDownAt: 0,
      lastRecoverAt: 0,
      lastScaleUpAt: 0,
      lastSelfTestAt: 0,
      lastLatencyMs: 0,
    };
  }
}

function saveState(filePath, state) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
}

async function httpSmoke({ url, apiKey, timeoutMs, message }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${url}/runsync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'x-inference-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: { action: 'chat', message } }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
      text,
      json,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      text: String(error?.message || error),
      json: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function httpSmokePod({ url, timeoutMs }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    const healthy = response.ok && (json?.status === 'healthy' || json?.status === 'ok' || response.status === 200);
    return {
      ok: healthy,
      status: response.status,
      latencyMs,
      text,
      json,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      text: String(error?.message || error),
      json: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveSupervisorMode(endpointBaseUrl) {
  const configured = String(process.env.BOB_SUPERVISOR_MODE || 'auto').trim().toLowerCase();
  if (configured === 'serverless' || configured === 'pod') return configured;
  if (/api\.runpod\.ai\/v2\//i.test(endpointBaseUrl)) return 'serverless';
  return 'pod';
}

function activityAgeMs(activityFile) {
  if (!activityFile) return null;
  try {
    const stats = fs.statSync(activityFile);
    return Date.now() - stats.mtimeMs;
  } catch {
    return null;
  }
}

async function runCommand(command, { dryRun, label }) {
  if (!command) return { ran: false, code: 0, label, dryRun };
  if (dryRun) {
    console.log(`[dry-run] ${label}: ${command}`);
    return { ran: false, code: 0, label, dryRun: true };
  }

  return new Promise((resolve) => {
    const child = spawn(command, { stdio: 'inherit', shell: true, env: process.env });
    child.on('exit', (code) => resolve({ ran: true, code: code ?? 1, label, dryRun: false }));
  });
}

function podControlCommand(action) {
  const podId = String(process.env.RUNPOD_POD_ID || '').trim();
  if (!podId) return '';
  return `node scripts/runpod-pod-control.mjs ${action} --pod ${podId}`;
}

async function maybeRunAction({ label, explicitCommand, fallbackCommand, cooldownMs, lastRanAt, dryRun }) {
  const now = Date.now();
  if (cooldownMs > 0 && now - lastRanAt < cooldownMs) {
    return { executed: false, reason: 'cooldown' };
  }

  const command = explicitCommand || fallbackCommand;
  if (!command) {
    return { executed: false, reason: 'no-command' };
  }

  const result = await runCommand(command, { dryRun, label });
  return { executed: true, result, ranAt: now };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const endpointBaseUrl = deriveEndpointBaseUrl();
  const apiKey = resolveApiKey();
  const supervisorMode = resolveSupervisorMode(endpointBaseUrl);
  if (!endpointBaseUrl) {
    console.error('Need INFERENCE_SERVICE_URL (or RUNPOD_ENDPOINT_ID)');
    process.exit(1);
  }
  if (supervisorMode === 'serverless' && !apiKey) {
    console.error('Serverless mode requires INFERENCE_API_KEY (or RUNPOD_ENDPOINT_API_KEY / RUNPOD_API_KEY)');
    process.exit(1);
  }

  const once = getBooleanArg('once', false);
  const dryRun = getBooleanArg('dryRun', false);
  const intervalMs = Number(getArg('intervalMs', String(envNumber('BOB_SUPERVISOR_INTERVAL_MS', 60000))));
  const failureThreshold = Number(getArg('failureThreshold', String(envNumber('BOB_SUPERVISOR_FAILURE_THRESHOLD', 3))));
  const smokeTimeoutMs = Number(getArg('smokeTimeoutMs', String(envNumber('BOB_SUPERVISOR_SMOKE_TIMEOUT_MS', 45000))));
  const scaleActionCooldownMs = envNumber('BOB_SUPERVISOR_ACTION_COOLDOWN_MS', 300000);
  const idleScaleDownMs = envNumber('BOB_SUPERVISOR_SCALE_DOWN_IDLE_MS', 1800000);
  const activityFile = String(process.env.BOB_SUPERVISOR_ACTIVITY_FILE || '').trim();
  const stateFile = path.resolve(process.cwd(), String(process.env.BOB_SUPERVISOR_STATE_FILE || DEFAULT_STATE_FILE));
  const pingMessage = String(process.env.BOB_SUPERVISOR_PING_MESSAGE || 'ping').trim() || 'ping';
  const selfTestCommand = String(process.env.BOB_SUPERVISOR_SELF_TEST_CMD || '').trim();
  const selfTestIntervalMs = envNumber('BOB_SUPERVISOR_SELF_TEST_INTERVAL_MS', 900000);

  console.log(`[supervisor] mode=${supervisorMode} endpoint=${endpointBaseUrl}`);

  const loop = async () => {
    const state = loadState(stateFile);
    const smoke = supervisorMode === 'pod'
      ? await httpSmokePod({
          url: endpointBaseUrl,
          timeoutMs: smokeTimeoutMs,
        })
      : await httpSmoke({
          url: endpointBaseUrl,
          apiKey,
          timeoutMs: smokeTimeoutMs,
          message: pingMessage,
        });

    const activityAge = activityAgeMs(activityFile);
    const output = {
      checkedAt: new Date().toISOString(),
      endpointBaseUrl,
      smoke: {
        ok: smoke.ok,
        status: smoke.status,
        latencyMs: smoke.latencyMs,
      },
      activityAgeMs: activityAge,
    };

    if (smoke.ok) {
      state.consecutiveFailures = 0;
      state.lastHealthyAt = Date.now();
      state.lastLatencyMs = smoke.latencyMs;
    } else {
      state.consecutiveFailures += 1;
      state.lastFailureAt = Date.now();
    }

    if (!smoke.ok && state.consecutiveFailures >= failureThreshold) {
      const recover = await maybeRunAction({
        label: 'recover',
        explicitCommand: String(process.env.BOB_RUNPOD_RECOVER_CMD || '').trim(),
        fallbackCommand: podControlCommand('start'),
        cooldownMs: scaleActionCooldownMs,
        lastRanAt: Number(state.lastRecoverAt || 0),
        dryRun,
      });
      if (recover.executed) state.lastRecoverAt = recover.ranAt;

      const scaleUp = await maybeRunAction({
        label: 'scale-up',
        explicitCommand: String(process.env.BOB_RUNPOD_SCALE_UP_CMD || '').trim(),
        fallbackCommand: '',
        cooldownMs: scaleActionCooldownMs,
        lastRanAt: Number(state.lastScaleUpAt || 0),
        dryRun,
      });
      if (scaleUp.executed) state.lastScaleUpAt = scaleUp.ranAt;

      output.recover = recover;
      output.scaleUp = scaleUp;
    }

    if (smoke.ok && activityAge !== null && activityAge >= idleScaleDownMs) {
      const scaleDown = await maybeRunAction({
        label: 'scale-down',
        explicitCommand: String(process.env.BOB_RUNPOD_SCALE_DOWN_CMD || '').trim(),
        fallbackCommand: podControlCommand('stop'),
        cooldownMs: scaleActionCooldownMs,
        lastRanAt: Number(state.lastScaleDownAt || 0),
        dryRun,
      });
      if (scaleDown.executed) state.lastScaleDownAt = scaleDown.ranAt;
      output.scaleDown = scaleDown;
    }

    if (smoke.ok && selfTestCommand) {
      const now = Date.now();
      const lastSelfTestAt = Number(state.lastSelfTestAt || 0);
      if (now - lastSelfTestAt >= selfTestIntervalMs) {
        const selfTest = await maybeRunAction({
          label: 'self-test',
          explicitCommand: selfTestCommand,
          fallbackCommand: '',
          cooldownMs: selfTestIntervalMs,
          lastRanAt: lastSelfTestAt,
          dryRun,
        });
        if (selfTest.executed) state.lastSelfTestAt = selfTest.ranAt;
        output.selfTest = selfTest;
      }
    }

    saveState(stateFile, state);
    console.log(JSON.stringify(output, null, 2));
  };

  await loop();
  if (once) return;

  setInterval(() => {
    loop().catch((error) => {
      console.error(`supervisor error: ${error.message}`);
    });
  }, intervalMs);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});