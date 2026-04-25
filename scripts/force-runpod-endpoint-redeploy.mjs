#!/usr/bin/env node

import process from 'node:process';

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

function getNumberArg(name, fallback) {
  const raw = String(getArg(name, String(fallback))).trim();
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

async function rest(method, path, apiKey, body) {
  const response = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
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

async function callRunsync(endpointId, apiKey) {
  const response = await fetch(`https://api.runpod.ai/v2/${endpointId}/runsync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: { action: 'ping' } }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`runsync ping failed (${response.status}): ${text.slice(0, 300)}`);
  }
  const payload = JSON.parse(text);
  return payload;
}

async function main() {
  const endpointId = String(getArg('endpoint', process.env.RUNPOD_ENDPOINT_ID || '')).trim();
  const apiKey = String(process.env.RUNPOD_API_KEY || process.env.INFERENCE_API_KEY || process.env.RUNPOD_ENDPOINT_API_KEY || '').trim();
  const waitSeconds = getNumberArg('waitSeconds', 45);

  if (!endpointId) {
    throw new Error('RUNPOD_ENDPOINT_ID (or --endpoint) is required.');
  }
  if (!apiKey) {
    throw new Error('RUNPOD_API_KEY / INFERENCE_API_KEY / RUNPOD_ENDPOINT_API_KEY is required.');
  }

  console.log(`Endpoint: ${endpointId}`);
  console.log('Fetching endpoint details...');
  const before = await rest('GET', `endpoints/${endpointId}`, apiKey);
  const templateId = before?.templateId;
  const workersMinBefore = Number(before?.workersMin ?? 0);
  const workersMaxBefore = Number(before?.workersMax ?? 1);

  if (!templateId) {
    throw new Error('Endpoint response missing templateId; cannot force refresh safely.');
  }

  const bumpedWorkersMin = Math.max(1, workersMinBefore + 1);
  const bumpedWorkersMax = Math.max(workersMaxBefore, bumpedWorkersMin);

  console.log(`Before: templateId=${templateId} workersMin=${workersMinBefore} workersMax=${workersMaxBefore} imageName=${before?.imageName || '?'}`);
  console.log(`Patching endpoint with workersMin=${bumpedWorkersMin} workersMax=${bumpedWorkersMax} to force refresh...`);
  await rest('PATCH', `endpoints/${endpointId}`, apiKey, {
    templateId,
    workersMin: bumpedWorkersMin,
    workersMax: bumpedWorkersMax,
  });

  console.log(`Waiting ${waitSeconds}s for new worker spin-up...`);
  await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));

  const ping = await callRunsync(endpointId, apiKey);
  const output = ping?.output || {};
  console.log(`Ping after refresh: workerId=${ping?.workerId || '?'} training_memory_version=${output?.training_memory_version || 'n/a'} runtime_training_notes=${output?.runtime_training_notes ?? 'n/a'}`);

  console.log(`Restoring workersMin=${workersMinBefore}...`);
  await rest('PATCH', `endpoints/${endpointId}`, apiKey, {
    workersMin: workersMinBefore,
    workersMax: workersMaxBefore,
  });

  const after = await rest('GET', `endpoints/${endpointId}`, apiKey);
  console.log(`After: workersMin=${after?.workersMin} workersMax=${after?.workersMax} imageName=${after?.imageName || '?'}`);
  console.log('Endpoint force-redeploy sequence completed.');
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
