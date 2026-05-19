#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v || '').trim();
    if (s) return s;
  }
  return '';
}

function parseEndpointId(url) {
  const m = String(url || '').match(/api\.runpod\.ai\/v2\/([^/]+)/i);
  return m?.[1] || '';
}

const runpodBase = firstNonEmpty(
  process.env.VITE_INFERENCE_SERVICE_URL,
  process.env.RUNPOD_API_URL,
  process.env.RUNPOD_SERVERLESS_URL,
  process.env.RUNPOD_GATEWAY_URL,
);

if (!runpodBase || !/api\.runpod\.ai\/v2\//i.test(runpodBase)) {
  console.error('No RunPod serverless base URL found in env (expected api.runpod.ai/v2/<endpoint-id>).');
  process.exit(1);
}

const endpointId = firstNonEmpty(process.env.RUNPOD_ENDPOINT_ID, parseEndpointId(runpodBase));
const apiKey = firstNonEmpty(
  process.env.INFERENCE_API_KEY,
  process.env.BOB_INFERENCE_API_KEY,
  process.env.RUNPOD_API_KEY,
);

if (!apiKey) {
  console.error('No inference/RunPod API key found in env.');
  process.exit(1);
}

const normalizedBase = runpodBase
  .replace(/\/+$/, '')
  .replace(/\/(?:run|runsync|run-sync)\/?$/i, '');
const runSyncUrl = `${normalizedBase}/runsync`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(root, '.runtime');
const runtimePath = path.join(runtimeDir, 'bob.env');

await fs.mkdir(runtimeDir, { recursive: true });

const existing = new Map();
try {
  const currentText = await fs.readFile(runtimePath, 'utf8');
  for (const raw of currentText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    existing.set(line.slice(0, idx), line.slice(idx + 1));
  }
} catch {
  // No existing runtime file; we'll create one.
}

const set = (k, v) => {
  if (String(v || '').trim()) existing.set(k, String(v));
};

set('BOB_SERVICE_URL', runpodBase);
set('INFERENCE_SERVICE_URL', runpodBase);
set('RUNPOD_API_URL', runpodBase);
set('RUNPOD_ENDPOINT_ID', endpointId);
set('DR_BOB_RUNPOD_URL', runSyncUrl);
set('RUNPOD_RUNSYNC_URL', runSyncUrl);
set('BOB_CHAT_PROVIDER', 'inference');
set('BOB_CHAT_ALLOW_FALLBACK', 'true');
set('INFERENCE_API_KEY', apiKey);
set('BOB_INFERENCE_API_KEY', apiKey);

// Preserve or backfill org context where possible.
set('BOB_ORG_ID', firstNonEmpty(existing.get('BOB_ORG_ID'), process.env.BOB_ORG_ID, process.env.ORG_ID, process.env.DEFAULT_ORG_ID));
set('ORG_ID', firstNonEmpty(existing.get('ORG_ID'), process.env.ORG_ID, process.env.BOB_ORG_ID, process.env.DEFAULT_ORG_ID));
set('DEFAULT_ORG_ID', firstNonEmpty(existing.get('DEFAULT_ORG_ID'), process.env.DEFAULT_ORG_ID, process.env.ORG_ID, process.env.BOB_ORG_ID));

const orderedKeys = [
  'BOB_SERVICE_URL',
  'INFERENCE_SERVICE_URL',
  'RUNPOD_API_URL',
  'RUNPOD_ENDPOINT_ID',
  'DR_BOB_RUNPOD_URL',
  'RUNPOD_RUNSYNC_URL',
  'BOB_CHAT_PROVIDER',
  'BOB_CHAT_ALLOW_FALLBACK',
  'INFERENCE_API_KEY',
  'BOB_INFERENCE_API_KEY',
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BOB_ORG_ID',
  'ORG_ID',
  'DEFAULT_ORG_ID',
];

for (const k of orderedKeys) {
  if (!existing.has(k) && process.env[k]) {
    existing.set(k, String(process.env[k]));
  }
}

const emitted = new Set();
const lines = [];
for (const key of orderedKeys) {
  if (!existing.has(key)) continue;
  lines.push(`${key}=${existing.get(key)}`);
  emitted.add(key);
}
for (const [key, value] of existing.entries()) {
  if (emitted.has(key)) continue;
  lines.push(`${key}=${value}`);
}

await fs.writeFile(runtimePath, `${lines.join('\n')}\n`, 'utf8');

console.log('Updated .runtime/bob.env for RunPod serverless operation.');
console.log(`Endpoint ID detected: ${endpointId || 'unknown'}`);
console.log('Serverless provider preference set to inference with fallback enabled.');
