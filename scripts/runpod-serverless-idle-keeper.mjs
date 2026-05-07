#!/usr/bin/env node

import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const API_BASE = 'https://rest.runpod.io/v1';

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

function getBooleanArg(name, fallback = false) {
  const args = process.argv.slice(2);
  if (args.includes(`--${name}`)) return true;
  const raw = String(getArg(name, String(fallback))).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function log(message) {
  const stamp = new Date().toISOString();
  console.log(`[idle-keeper ${stamp}] ${message}`);
}

function parseEndpoints() {
  const fromArg = String(getArg('endpoints', '')).trim();
  const fromEnv = String(process.env.RUNPOD_IDLE_KEEPER_ENDPOINTS || '').trim();
  const fallback = 'n0bp1ifmq01cx2,qufsywq39klcma';
  const raw = fromArg || fromEnv || fallback;
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

async function rest(method, path, apiKey, body) {
  const response = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`REST ${method} ${path} failed (${response.status}): ${JSON.stringify(json).slice(0, 500)}`);
  }

  return json;
}

async function enforceIdle(endpointId, apiKey, dryRun) {
  const current = await rest('GET', `endpoints/${endpointId}`, apiKey);
  const currentMin = Number(current?.workersMin ?? 0);
  const currentMax = Number(current?.workersMax ?? 0);
  const currentScalerValue = Number(current?.scalerValue ?? 1);
  const patch = {
    workersMin: 0,
    workersMax: 0,
    scalerValue: Number.isFinite(currentScalerValue) ? currentScalerValue : 1,
  };

  if (currentMin === 0 && currentMax === 0) {
    log(`endpoint=${endpointId} already idle (workersMin=0 workersMax=0 workersStandby=${current?.workersStandby ?? 'n/a'})`);
    return;
  }

  if (dryRun) {
    log(`endpoint=${endpointId} would patch to ${JSON.stringify(patch)}`);
    return;
  }

  const updated = await rest('PATCH', `endpoints/${endpointId}`, apiKey, patch);
  log(
    `endpoint=${endpointId} patched workersMin=${updated?.workersMin} workersMax=${updated?.workersMax} ` +
    `workersStandby=${updated?.workersStandby ?? 'n/a'}`
  );
}

async function main() {
  const apiKey = String(
    process.env.RUNPOD_API_KEY || process.env.INFERENCE_API_KEY || process.env.RUNPOD_ENDPOINT_API_KEY || ''
  ).trim();
  if (!apiKey) {
    throw new Error('Missing RUNPOD_API_KEY / INFERENCE_API_KEY / RUNPOD_ENDPOINT_API_KEY');
  }

  const endpoints = parseEndpoints();
  if (endpoints.length === 0) {
    throw new Error('No endpoint IDs provided. Use --endpoints or RUNPOD_IDLE_KEEPER_ENDPOINTS');
  }

  const once = getBooleanArg('once', false);
  const dryRun = getBooleanArg('dryRun', false);
  const intervalMs = Number(getArg('intervalMs', process.env.RUNPOD_IDLE_KEEPER_INTERVAL_MS || '60000')) || 60000;

  log(`starting idle keeper endpoints=${endpoints.join(',')} once=${once} dryRun=${dryRun} intervalMs=${intervalMs}`);

  const runCycle = async () => {
    for (const endpointId of endpoints) {
      try {
        await enforceIdle(endpointId, apiKey, dryRun);
      } catch (error) {
        log(`endpoint=${endpointId} error=${error?.message || String(error)}`);
      }
    }
  };

  await runCycle();
  if (once) return;

  setInterval(() => {
    runCycle().catch((error) => {
      log(`cycle-error=${error?.message || String(error)}`);
    });
  }, intervalMs);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
