#!/usr/bin/env node
/**
 * LEGACY TOOL: RunPod pod lifecycle control — start, stop, or check pod status.
 *
 * Serverless-first operations should use endpoint autoscaling and health checks.
 * Keep this script for manual emergency fallback only.
 *
 * Safety gate:
 *   Set ALLOW_LEGACY_RUNPOD_POD_CONTROL=true to use this script.
 *   Without that flag, execution is blocked to prevent accidental pod-mode use.
 *
 * Usage:
 *   node scripts/runpod-pod-control.mjs start  --pod <podId>
 *   node scripts/runpod-pod-control.mjs stop   --pod <podId>
 *   node scripts/runpod-pod-control.mjs status --pod <podId>
 *
 * Env vars (required):
 *   RUNPOD_API_KEY  or  RUNPOD_ENDPOINT_API_KEY  — RunPod API key
 *   RUNPOD_POD_ID   — pod ID (can also be passed via --pod)
 *
 * Examples:
 *   RUNPOD_API_KEY=rpa_xxx  node scripts/runpod-pod-control.mjs stop  --pod eipnu6bq181q20
 *   RUNPOD_API_KEY=rpa_xxx  RUNPOD_POD_ID=eipnu6bq181q20  node scripts/runpod-pod-control.mjs status
 */

import process from 'node:process';

const GRAPHQL_URL = 'https://api.runpod.io/graphql';

function getArg(name, fallback = '') {
  const key = `--${name}`;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const t = String(args[i] || '');
    if (t === key) return String(args[i + 1] || fallback);
    if (t.startsWith(`${key}=`)) return t.slice(key.length + 1) || fallback;
  }
  return fallback;
}

async function graphql(apiKey, query) {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`RunPod API returned HTTP ${resp.status}`);
  return resp.json();
}

function extractGraphqlError(result) {
  const first = result?.errors?.[0];
  if (!first) return null;
  return {
    message: String(first.message || 'GraphQL error'),
    code: String(first.extensions?.code || ''),
  };
}

async function main() {
  const allowLegacy = String(process.env.ALLOW_LEGACY_RUNPOD_POD_CONTROL || '').trim().toLowerCase() === 'true';
  if (!allowLegacy) {
    console.error('Legacy pod control is disabled by default. Set ALLOW_LEGACY_RUNPOD_POD_CONTROL=true to proceed.');
    process.exit(2);
  }

  const action = String(process.argv[2] || '').toLowerCase().trim();
  if (!['start', 'stop', 'status'].includes(action)) {
    console.error(`Usage: runpod-pod-control.mjs <start|stop|status> [--pod <podId>]`);
    process.exit(1);
  }

  const apiKey = String(process.env.RUNPOD_API_KEY || process.env.RUNPOD_ENDPOINT_API_KEY || '').trim();
  if (!apiKey) {
    console.error('RUNPOD_API_KEY (or RUNPOD_ENDPOINT_API_KEY) is required');
    process.exit(1);
  }

  const podId = String(getArg('pod') || process.env.RUNPOD_POD_ID || '').trim();
  if (!podId) {
    console.error('Pod ID is required — pass --pod <id> or set RUNPOD_POD_ID');
    process.exit(1);
  }

  console.log(`🔧 Action: ${action} | Pod: ${podId}`);

  try {
    let result;
    if (action === 'stop') {
      result = await graphql(apiKey, `mutation { podStop(input: { podId: "${podId}" }) { id desiredStatus } }`);
      const pod = result?.data?.podStop;
      if (pod) {
        console.log(`✅ Stop requested — desiredStatus: ${pod.desiredStatus}`);
      } else {
        const gqlError = extractGraphqlError(result);
        if (gqlError?.code === 'POD_NOT_FOUND') {
          console.log(`ℹ️ Pod ${podId} does not exist or is already gone — treating stop as complete.`);
          process.exit(0);
        }
        console.error('Unexpected response:', JSON.stringify(result, null, 2));
        process.exit(1);
      }
    } else if (action === 'start') {
      result = await graphql(apiKey, `mutation { podResume(input: { podId: "${podId}", gpuCount: 1 }) { id desiredStatus costPerHr } }`);
      const pod = result?.data?.podResume;
      if (pod) {
        console.log(`✅ Start requested — desiredStatus: ${pod.desiredStatus}, cost: $${pod.costPerHr}/hr`);
      } else {
        console.error('Unexpected response:', JSON.stringify(result, null, 2));
        process.exit(1);
      }
    } else {
      result = await graphql(apiKey, `query { pod(input: { podId: "${podId}" }) { id name desiredStatus runtime { uptimeInSeconds gpus { id gpuUtilPercent memoryUtilPercent } } } }`);
      const pod = result?.data?.pod;
      if (pod) {
        console.log(`Pod ID:      ${pod.id}`);
        console.log(`Name:        ${pod.name}`);
        console.log(`Status:      ${pod.desiredStatus}`);
        if (pod.runtime) {
          const uptime = pod.runtime.uptimeInSeconds;
          console.log(`Uptime:      ${Math.floor(uptime / 60)}m ${uptime % 60}s`);
          for (const gpu of (pod.runtime.gpus || [])) {
            console.log(`GPU ${gpu.id}: util=${gpu.gpuUtilPercent}% mem=${gpu.memoryUtilPercent}%`);
          }
        } else {
          console.log(`Runtime:     (pod is stopped or starting)`);
        }
      } else {
        const gqlError = extractGraphqlError(result);
        if (gqlError?.code === 'POD_NOT_FOUND' || result?.data?.pod === null) {
          console.log('Status:      STOPPED');
          console.log('Runtime:     (pod not found / already stopped)');
          process.exit(0);
        }
        console.error('Pod not found or unexpected response:', JSON.stringify(result, null, 2));
        process.exit(1);
      }
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main();
