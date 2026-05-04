#!/usr/bin/env node
/**
 * Update the GPU type list on a RunPod serverless endpoint.
 *
 * Use this when supply on the current GPU preference list is low and workers
 * cannot spin up.  The script PATCHes the endpoint via the RunPod REST API and
 * then fetches the updated config to confirm the change.
 *
 * Usage:
 *   node scripts/update-runpod-endpoint-gpus.mjs [options]
 *
 * Options:
 *   --endpoint   <id>          RunPod endpoint ID (default: RUNPOD_ENDPOINT_ID env)
 *   --gpuIds     <list>        Comma-separated GPU display names to set.
 *                              Defaults to the HIGH_AVAILABILITY_GPU_LIST below.
 *   --dryRun                   Print the patch payload without calling the API.
 *
 * Required env:
 *   RUNPOD_API_KEY  |  INFERENCE_API_KEY  |  RUNPOD_ENDPOINT_API_KEY
 *   RUNPOD_ENDPOINT_ID   (or pass --endpoint)
 *
 * Examples:
 *   # Apply the built-in high-availability list to the default endpoint
 *   RUNPOD_API_KEY=rpa_... node scripts/update-runpod-endpoint-gpus.mjs
 *
 *   # Override with specific GPU types
 *   RUNPOD_API_KEY=rpa_... node scripts/update-runpod-endpoint-gpus.mjs \
 *     --gpuIds "NVIDIA GeForce RTX 4090,NVIDIA L4"
 *
 *   # Dry-run: see what would be sent without making changes
 *   RUNPOD_API_KEY=rpa_... node scripts/update-runpod-endpoint-gpus.mjs --dryRun
 */

import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const API_BASE = 'https://rest.runpod.io/v1';

/**
 * Ordered list of GPU types to configure when supply on the previous choice
 * (RTX 6000 Ada / L40 / L40S / Blackwell Pro) is low.
 *
 * Priority rationale:
 *  1–3  24 GB consumer/prosumer cards — highest availability, cheapest, fit
 *       Qwen2.5-7B (FP16) and quantized Llama3.2-Vision-11B comfortably.
 *  4–5  Professional 24 GB options — broad availability, enterprise SLA.
 *  6–7  48 GB enterprise — more VRAM for larger context, moderate supply.
 *  8–9  80 GB HPC — maximum capacity, lower availability, keep as fallback.
 * 10–12 Original preference list — retain as last-resort fallback in case
 *       supply recovers.
 */
const HIGH_AVAILABILITY_GPU_LIST = [
  // Tier 1 — 24 GB, high supply
  'NVIDIA GeForce RTX 4090',
  'NVIDIA L4',
  'NVIDIA RTX A5000',
  // Tier 2 — 24 GB professional
  'NVIDIA RTX A4500',
  'NVIDIA RTX 4000 Ada Generation',
  // Tier 3 — 48 GB, moderate supply
  'NVIDIA RTX A6000',
  'NVIDIA A40',
  // Tier 4 — 80 GB HPC, lower supply
  'NVIDIA A100 80GB PCIe',
  'NVIDIA A100-SXM4-80GB',
  // Tier 5 — original enterprise preference list (kept as fallback)
  'NVIDIA RTX 6000 Ada Generation',
  'NVIDIA L40',
  'NVIDIA L40S',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function getBooleanArg(name) {
  return process.argv.slice(2).includes(`--${name}`);
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
    throw new Error(
      `REST ${method} ${path} failed (${response.status}): ${JSON.stringify(json).slice(0, 500)}`
    );
  }

  return json;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const endpointId = String(
    getArg('endpoint', process.env.RUNPOD_ENDPOINT_ID || '')
  ).trim();

  const apiKey = String(
    process.env.RUNPOD_API_KEY ||
    process.env.INFERENCE_API_KEY ||
    process.env.RUNPOD_ENDPOINT_API_KEY ||
    ''
  ).trim();

  const dryRun = getBooleanArg('dryRun');

  const gpuIdsArg = getArg('gpuIds', '').trim();
  const gpuIds = gpuIdsArg
    ? gpuIdsArg.split(',').map((s) => s.trim()).filter(Boolean)
    : HIGH_AVAILABILITY_GPU_LIST;

  if (!endpointId) {
    console.error('ERROR: endpoint ID is required — pass --endpoint or set RUNPOD_ENDPOINT_ID');
    process.exit(1);
  }
  if (!apiKey) {
    console.error('ERROR: API key is required — set RUNPOD_API_KEY, INFERENCE_API_KEY, or RUNPOD_ENDPOINT_API_KEY');
    process.exit(1);
  }

  console.log(`Endpoint : ${endpointId}`);
  console.log(`Dry run  : ${dryRun}`);
  console.log(`GPU list (${gpuIds.length}):`);
  for (const [i, gpu] of gpuIds.entries()) {
    console.log(`  ${String(i + 1).padStart(2)}. ${gpu}`);
  }

  // Fetch current config so we can preserve other fields.
  console.log('\nFetching current endpoint config...');
  const current = await rest('GET', `endpoints/${endpointId}`, apiKey);
  console.log(
    `Current  : workersMin=${current?.workersMin} workersMax=${current?.workersMax} ` +
    `templateId=${current?.templateId} gpuIds=${JSON.stringify(current?.gpuIds ?? [])}`
  );

  const patch = { gpuIds };
  console.log('\nPatch payload:', JSON.stringify(patch, null, 2));

  if (dryRun) {
    console.log('\n[dry-run] No changes applied.');
    return;
  }

  await rest('PATCH', `endpoints/${endpointId}`, apiKey, patch);
  console.log('PATCH applied successfully.');

  // Confirm the change.
  const updated = await rest('GET', `endpoints/${endpointId}`, apiKey);
  console.log(
    `\nUpdated  : workersMin=${updated?.workersMin} workersMax=${updated?.workersMax} ` +
    `gpuIds=${JSON.stringify(updated?.gpuIds ?? [])}`
  );

  console.log('\n✅ GPU type list updated. Workers will use the new preference order on next scale-up.');
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
