#!/usr/bin/env node

/**
 * LEGACY TOOL: Replace broken Bob automation pods on RunPod.
 *
 * Serverless-first operations should not require pod replacement. Keep this
 * script only for emergency fallback or migration scenarios.
 *
 * Defaults align with current operations context:
 * - Pod base name: bob-automation-pod-v3
 * - GPU label: RTX 4090 x1
 *
 * Required env:
 *   RUNPOD_API_KEY
 *
 * Optional args:
 *   --count=1
 *   --templateId=<runpod-template-id>
 *   --gpuTypeId=<runpod-gpu-type-id>
 *   --name=<pod-base-name>
 *   --cloudType=SECURE
 *   --volumeInGb=500
 *   --containerDiskInGb=80
 *   --dryRun=true
 *
 * Example:
 *   RUNPOD_API_KEY=... node scripts/replace-bob-automation-pod.mjs --count=1
 */

import process from 'node:process';

const RUNPOD_GRAPHQL_URL = 'https://api.runpod.io/graphql';

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

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function gqlRequest(apiKey, query, variables) {
  const response = await fetch(RUNPOD_GRAPHQL_URL, {
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
    throw new Error(`RunPod API HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  if (payload.errors?.length) {
    throw new Error(`RunPod GraphQL error: ${JSON.stringify(payload.errors).slice(0, 500)}`);
  }

  return payload.data;
}

function formatUtcStamp(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

async function main() {
  const count = Number(getArg('count', '1'));
  const templateId = getArg('templateId', process.env.RUNPOD_TEMPLATE_ID || 'matkgtica1');
  const gpuTypeId = getArg('gpuTypeId', process.env.RUNPOD_GPU_TYPE_ID || 'NVIDIA_GEFORCE_RTX_4090');
  const cloudType = getArg('cloudType', process.env.RUNPOD_CLOUD_TYPE || 'SECURE');
  const name = getArg('name', process.env.RUNPOD_PRIMARY_POD_NAME || 'bob-automation-pod-v3');
  const volumeInGb = Number(getArg('volumeInGb', process.env.RUNPOD_VOLUME_GB || '500'));
  const containerDiskInGb = Number(getArg('containerDiskInGb', process.env.RUNPOD_CONTAINER_DISK_GB || '80'));
  const dryRun = getBooleanArg('dryRun', false);
  const apiKey = dryRun ? String(process.env.RUNPOD_API_KEY || '').trim() : requiredEnv('RUNPOD_API_KEY');

  if (!Number.isFinite(count) || count < 1 || count > 8) {
    throw new Error('count must be between 1 and 8');
  }

  if (!templateId.trim()) {
    throw new Error('templateId is required');
  }

  if (!gpuTypeId.trim()) {
    throw new Error('gpuTypeId is required');
  }

  if (!dryRun) {
    const me = await gqlRequest(apiKey, 'query Me { myself { id email } }', {});
    if (!me?.myself?.id) {
      throw new Error('Unable to verify RunPod credentials');
    }
    console.log(`Authenticated as: ${me.myself.email || me.myself.id}`);
  } else {
    console.log('Dry run enabled: skipping RunPod authentication call.');
  }
  console.log(`Replacing Bob pod(s): base=${name}, gpuTypeId=${gpuTypeId}, count=${count}, cloudType=${cloudType}`);
  console.log('Profile label: RTX 4090 x1');

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
  const stamp = formatUtcStamp();

  for (let i = 0; i < count; i += 1) {
    const suffix = count === 1 ? `recovery-${stamp}` : `recovery-${stamp}-${i + 1}`;
    const podName = `${name}-${suffix}`;

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

    if (dryRun) {
      console.log(`[dry-run] Would create pod: ${podName}`);
      created.push({ id: `dryrun-${i + 1}`, name: podName, desiredStatus: 'DRY_RUN' });
      continue;
    }

    console.log(`Creating replacement pod ${i + 1}/${count}: ${podName}`);
    const data = await gqlRequest(apiKey, mutation, variables);
    const pod = data?.podFindAndDeployOnDemand;
    if (!pod?.id) {
      throw new Error(`RunPod API did not return a pod id for ${podName}`);
    }
    created.push(pod);
  }

  console.log('\nReplacement pod result:');
  for (const pod of created) {
    console.log(`- ${pod.name} (${pod.id}) status=${pod.desiredStatus || 'unknown'}`);
  }

  console.log('\nNext step:');
  console.log('1) Promote endpoint workers: npm run runpod:endpoint:promote');
  console.log('2) Refresh Bob automation panel to confirm health + balance.');
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
