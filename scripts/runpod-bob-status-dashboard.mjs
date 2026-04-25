#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      value = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // optional file
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function statAgeMs(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return Date.now() - stats.mtimeMs;
  } catch {
    return null;
  }
}

async function checkHookHealth() {
  const token = String(process.env.BOB_AUTOMATION_WEBHOOK_TOKEN || '').trim();
  const port = String(process.env.BOB_AUTOMATION_WEBHOOK_PORT || '8787').trim();
  if (!token) {
    return { available: false, reason: 'missing-token' };
  }

  const url = `http://127.0.0.1:${port}/health`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return {
      available: true,
      ok: response.ok,
      status: response.status,
      url,
      body,
    };
  } catch (error) {
    return {
      available: true,
      ok: false,
      status: 0,
      url,
      error: String(error?.message || error),
    };
  }
}

async function runpodGraphql(apiKey, query) {
  const response = await fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function numericFromObject(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

async function getRunpodDollarRemaining() {
  const apiKey = String(process.env.RUNPOD_API_KEY || process.env.RUNPOD_ENDPOINT_API_KEY || '').trim();
  if (!apiKey) {
    return { available: false, reason: 'missing-runpod-api-key' };
  }

  const attempts = [
    {
      label: 'myself-clientBalance',
      query: 'query { myself { clientBalance } }',
      extract: (body) => numericFromObject(body?.data?.myself, ['clientBalance']),
    },
    {
      label: 'myself-creditBalance',
      query: 'query { myself { creditBalance } }',
      extract: (body) => numericFromObject(body?.data?.myself, ['creditBalance']),
    },
    {
      label: 'myself-balance',
      query: 'query { myself { balance } }',
      extract: (body) => numericFromObject(body?.data?.myself, ['balance']),
    },
    {
      label: 'myself-accountBalance',
      query: 'query { myself { accountBalance } }',
      extract: (body) => numericFromObject(body?.data?.myself, ['accountBalance']),
    },
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      const result = await runpodGraphql(apiKey, attempt.query);
      const value = attempt.extract(result.body);
      if (value !== null) {
        return {
          available: true,
          source: attempt.label,
          usdRemaining: value,
          formatted: `$${value.toFixed(2)}`,
        };
      }
      const errText = JSON.stringify(result.body?.errors || result.body || {}).slice(0, 240);
      errors.push(`${attempt.label}: HTTP ${result.status} ${errText}`);
    } catch (error) {
      errors.push(`${attempt.label}: ${String(error?.message || error)}`);
    }
  }

  return {
    available: false,
    reason: 'balance-field-not-accessible',
    attempts: errors,
  };
}

async function main() {
  const repoRoot = process.cwd();
  loadEnvFile(path.join(repoRoot, '.env'));
  loadEnvFile(path.join(repoRoot, '.runtime', 'bob-automation.env'));

  const stateFile = path.resolve(repoRoot, String(process.env.BOB_SUPERVISOR_STATE_FILE || '.runtime/runpod-bob-supervisor-state.json'));
  const activityFile = path.resolve(repoRoot, String(process.env.BOB_SUPERVISOR_ACTIVITY_FILE || '.runtime/runpod-bob-activity.touch'));

  const supervisorState = readJson(stateFile);
  const activityAgeMs = statAgeMs(activityFile);
  const hookHealth = await checkHookHealth();
  const dollars = await getRunpodDollarRemaining();

  const dashboard = {
    checkedAt: new Date().toISOString(),
    files: {
      stateFile,
      activityFile,
      stateFileExists: fs.existsSync(stateFile),
      activityFileExists: fs.existsSync(activityFile),
    },
    supervisor: {
      consecutiveFailures: Number(supervisorState?.consecutiveFailures || 0),
      lastHealthyAt: supervisorState?.lastHealthyAt || 0,
      lastFailureAt: supervisorState?.lastFailureAt || 0,
      lastLatencyMs: supervisorState?.lastLatencyMs || 0,
      lastRecoverAt: supervisorState?.lastRecoverAt || 0,
      lastScaleUpAt: supervisorState?.lastScaleUpAt || 0,
      lastScaleDownAt: supervisorState?.lastScaleDownAt || 0,
    },
    activity: {
      ageMs: activityAgeMs,
      ageMinutes: activityAgeMs === null ? null : Number((activityAgeMs / 60000).toFixed(2)),
    },
    hookServer: hookHealth,
    runpodDollars: dollars,
  };

  console.log(JSON.stringify(dashboard, null, 2));
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});