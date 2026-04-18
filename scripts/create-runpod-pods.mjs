#!/usr/bin/env node

/**
 * Create one or more RunPod pods via GraphQL API.
 *
 * Required env:
 *   RUNPOD_API_KEY
 *
 * Example:
 *   RUNPOD_API_KEY=... node scripts/create-runpod-pods.mjs \
 *     --templateId matkgtica1 \
 *     --gpuTypeId NVIDIA_GEFORCE_RTX_5090 \
 *     --workloads chat,ptt,tabular \
 *     --namePrefix bob_ollama \
 *     --volumeInGb 500 \
 *     --containerDiskInGb 80 \
 *     --dryRun false
 */

import process from 'node:process';

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
  const raw = String(getArg(name, String(fallback))).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parseWorkloads(raw) {
  const value = String(raw || '').trim();
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function gqlRequest(apiKey, query, variables) {
  const response = await fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`RunPod API returned non-JSON response: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`RunPod API HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 400)}`);
  }

  if (payload.errors?.length) {
    throw new Error(`RunPod GraphQL error: ${JSON.stringify(payload.errors).slice(0, 500)}`);
  }

  return payload.data;
}

async function main() {
  const apiKey = requiredEnv('RUNPOD_API_KEY');

  const templateId = getArg('templateId', 'matkgtica1');
  const gpuTypeId = getArg('gpuTypeId', 'NVIDIA_GEFORCE_RTX_5090');
  const count = Number(getArg('count', '2'));
  const workloads = parseWorkloads(getArg('workloads', ''));
  const namePrefix = getArg('namePrefix', 'bob_ollama');
  const volumeInGb = Number(getArg('volumeInGb', '500'));
  const containerDiskInGb = Number(getArg('containerDiskInGb', '80'));
  const cloudType = getArg('cloudType', 'SECURE');
  const dryRun = getBooleanArg('dryRun', false);

  if (!Number.isFinite(count) || count < 1 || count > 8) {
    throw new Error('count must be between 1 and 8');
  }

  if (!gpuTypeId.trim()) {
    throw new Error('gpuTypeId must not be empty');
  }

  const podNames = workloads.length
    ? workloads.map((workload) => `${namePrefix}_${workload}`)
    : Array.from({ length: count }, (_, i) => `${namePrefix}_${i + 1}`);

  console.log('Verifying RunPod authentication...');
  const meQuery = `query Me { myself { id email } }`;
  const meData = await gqlRequest(apiKey, meQuery, {});
  const me = meData?.myself;
  if (!me?.id) {
    throw new Error('Unable to verify RunPod identity');
  }
  console.log(`Authenticated as: ${me.email || me.id}`);

  const mutation = `
    mutation DeployPod($input: PodFindAndDeployOnDemandInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
        name
        imageName
        desiredStatus
        machineId
      }
    }
  `;

  const created = [];
  for (let i = 0; i < podNames.length; i += 1) {
    const podName = podNames[i];
    const variables = {
      input: {
        cloudType,
        gpuTypeId,
        name: podName,
        templateId,
        containerDiskInGb,
        volumeInGb,
      },
    };

    console.log(`Creating pod ${i + 1}/${podNames.length}: ${podName}`);
    if (dryRun) {
      created.push({
        id: `dryrun-${i + 1}`,
        name: podName,
        desiredStatus: 'DRY_RUN',
      });
      continue;
    }

    const data = await gqlRequest(apiKey, mutation, variables);
    const pod = data?.podFindAndDeployOnDemand;
    if (!pod?.id) {
      throw new Error(`RunPod API did not return pod id for ${podName}`);
    }
    created.push(pod);
  }

  console.log('\nCreated pods:');
  for (const pod of created) {
    console.log(`- ${pod.name} (${pod.id}) status=${pod.desiredStatus || 'unknown'}`);
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
