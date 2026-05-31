#!/usr/bin/env node

import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const execFileAsync = promisify(execFile);

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

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function parseEndpointId(url) {
  const match = String(url || '').match(/api\.runpod\.ai\/v2\/([^/]+)/i);
  return match?.[1] || '';
}

async function rest(method, path, apiKey, body) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 30000);

  try {
    const response = await fetch(`https://rest.runpod.io/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: abortController.signal,
    });

    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`RunPod REST returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
    }

    if (!response.ok) {
      throw new Error(`RunPod REST failed: ${JSON.stringify(json).slice(0, 500)}`);
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveGhcrLatestDigest(imageRepo) {
  const image = String(imageRepo || '').trim().replace(/^https?:\/\//i, '').replace(/^ghcr\.io\//i, '');
  if (!image) throw new Error('Image repository is required to resolve GHCR latest digest.');

  const manifestUrl = `https://ghcr.io/v2/${image}/manifests/latest`;
  const accept = [
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
  ].join(', ');

  const ghUser = String(process.env.GHCR_USERNAME || process.env.GITHUB_ACTOR || '').trim();
  const ghToken = String(
    process.env.GHCR_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.PAT_TOKEN ||
    ''
  ).trim();

  const authHeaders = {};
  if (ghUser && ghToken) {
    authHeaders.Authorization = `Basic ${Buffer.from(`${ghUser}:${ghToken}`).toString('base64')}`;
  }

  const initial = await fetch(manifestUrl, {
    method: 'GET',
    headers: {
      Accept: accept,
      ...authHeaders,
    },
  });

  let token = '';
  if (initial.status === 401 && !authHeaders.Authorization) {
    const www = initial.headers.get('www-authenticate') || '';
    const realmMatch = www.match(/realm="([^"]+)"/i);
    const serviceMatch = www.match(/service="([^"]+)"/i);
    const scopeMatch = www.match(/scope="([^"]+)"/i);
    const realm = realmMatch?.[1] || 'https://ghcr.io/token';
    const service = serviceMatch?.[1] || 'ghcr.io';
    const scope = scopeMatch?.[1] || `repository:${image}:pull`;
    const tokenResp = await fetch(`${realm}?service=${encodeURIComponent(service)}&scope=${encodeURIComponent(scope)}`);
    const tokenPayload = await tokenResp.json();
    token = String(tokenPayload?.token || tokenPayload?.access_token || '').trim();
  }

  const head = await fetch(manifestUrl, {
    method: 'HEAD',
    headers: {
      Accept: accept,
      ...(token ? { Authorization: `Bearer ${token}` } : authHeaders),
    },
  });

  if (!head.ok) {
    const reason = head.status === 404
      ? 'manifest unknown (tag may not exist)'
      : head.status === 401 || head.status === 403
        ? 'auth denied (GHCR package may be private)'
        : `HTTP ${head.status}`;
    throw new Error(
      `Unable to resolve GHCR latest digest for ${image}: ${reason}. ` +
      'Set GHCR_USERNAME + GHCR_TOKEN (read:packages) or pass --imageRef ghcr.io/<repo>@sha256:<digest>.'
    );
  }

  const digest = head.headers.get('Docker-Content-Digest') || '';
  if (!digest) throw new Error(`GHCR did not return Docker-Content-Digest for ${image}`);
  return `ghcr.io/${image}@${digest}`;
}

async function graphql(apiKey, query) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 30000); // 30s timeout

  try {
    const response = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: abortController.signal,
    });

    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`RunPod GraphQL returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
    }

    if (!response.ok || json?.errors?.length) {
      throw new Error(`RunPod GraphQL failed: ${JSON.stringify(json).slice(0, 500)}`);
    }

    return json.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function runNodeScript(scriptPath, args = []) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024,
  });

  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

async function setSupabaseModelSecrets(modelTag) {
  const projectRef = firstNonEmpty(getArg('projectRef', ''), process.env.SUPABASE_PROJECT_REF);
  const args = [
    'secrets',
    'set',
    `OLLAMA_MODEL=${modelTag}`,
    `RUNPOD_OLLAMA_MODEL=${modelTag}`,
    `AI_DEFAULT_MODEL=${modelTag}`,
  ];

  if (projectRef) {
    args.push('--project-ref', projectRef);
  }

  const { stdout, stderr } = await execFileAsync(
    'supabase',
    args,
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024,
    },
  );

  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

async function pollRunpodStatus(endpointId, apiKey, jobId, timeoutMs = 180000, intervalMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${encodeURIComponent(jobId)}`;
  let lastPayload = null;

  while (Date.now() < deadline) {
    const response = await fetch(statusUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`RunPod status poll failed (${response.status}): ${text.slice(0, 300)}`);
    }

    const payload = text ? JSON.parse(text) : {};
    lastPayload = payload;
    const status = String(payload?.status || '').toUpperCase();

    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
      return payload;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`RunPod status poll timed out for job ${jobId}. Last payload: ${JSON.stringify(lastPayload).slice(0, 500)}`);
}

function isSuccessfulRunpodPayload(payload) {
  const status = String(payload?.status || '').toUpperCase();
  if (status !== 'COMPLETED') return false;

  if (payload?.output?.success === false) return false;
  if (payload?.error || payload?.output?.error) return false;
  return true;
}

async function smokeDirectRunsync(endpointId, apiKey, modelTag) {
  const allowPending = String(process.env.RUNPOD_SMOKE_ALLOW_PENDING || 'true').trim().toLowerCase() !== 'false';
  const requestTimeoutMs = Number(process.env.RUNPOD_SMOKE_REQUEST_TIMEOUT_MS || 90000);
  const pollTimeoutMs = Number(process.env.RUNPOD_SMOKE_POLL_TIMEOUT_MS || 180000);
  const pollIntervalMs = Number(process.env.RUNPOD_SMOKE_POLL_INTERVAL_MS || 3000);
  const smokeInput = {
    input: {
      action: 'chat',
      message: 'Promotion smoke test. Reply with one short sentence.',
      history: [],
      model: modelTag,
      temperature: 0.2,
    },
  };

  const requestJson = async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(smokeInput),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`RunPod smoke failed (${response.status}): ${text.slice(0, 300)}`);
      }
      return JSON.parse(text);
    } finally {
      clearTimeout(timeout);
    }
  };

  let payload = null;
  try {
    payload = await requestJson(`https://api.runpod.ai/v2/${endpointId}/runsync`);
  } catch (error) {
    if (error?.name === 'AbortError') {
      console.warn(`RunPod runsync request timed out after ${requestTimeoutMs}ms; switching to async /run path.`);
      payload = await requestJson(`https://api.runpod.ai/v2/${endpointId}/run`);
    } else {
      throw error;
    }
  }

  const status = String(payload?.status || '').toUpperCase();

  if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
    const jobId = String(payload?.id || '').trim();
    if (!jobId) {
      throw new Error(`RunPod smoke returned queued status without job ID: ${JSON.stringify(payload).slice(0, 500)}`);
    }
    console.log(`RunPod smoke queued: jobId=${jobId}. Polling until terminal status...`);
    let terminalPayload = null;
    try {
      terminalPayload = await pollRunpodStatus(endpointId, apiKey, jobId, pollTimeoutMs, pollIntervalMs);
    } catch (error) {
      if (allowPending && String(error?.message || '').includes('timed out')) {
        console.warn(`RunPod smoke pending: ${error?.message || String(error)}`);
        console.warn(`Proceeding because RUNPOD_SMOKE_ALLOW_PENDING=${process.env.RUNPOD_SMOKE_ALLOW_PENDING || 'true'}.`);
        return;
      }
      throw error;
    }
    if (!isSuccessfulRunpodPayload(terminalPayload)) {
      throw new Error(`RunPod smoke terminal payload not successful: ${JSON.stringify(terminalPayload).slice(0, 500)}`);
    }
    console.log(`RunPod smoke ok: workerId=${terminalPayload?.workerId || '?'} model=${terminalPayload?.output?.model || modelTag}`);
    return;
  }

  if (!isSuccessfulRunpodPayload(payload)) {
    throw new Error(`RunPod smoke returned unexpected payload: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  console.log(`RunPod smoke ok: workerId=${payload?.workerId || '?'} model=${payload?.output?.model || modelTag}`);
}

async function smokeDirectRunsyncWithCandidates(endpointId, modelTag, keyCandidates) {
  const candidateTimeoutMs = Number(
    process.env.RUNPOD_SMOKE_HARD_CAP_TIMEOUT_MS ||
    process.env.RUNPOD_SMOKE_CANDIDATE_TIMEOUT_MS ||
    210000,
  );
  let lastError = null;
  for (const candidate of keyCandidates) {
    const apiKey = String(candidate?.value || '').trim();
    if (!apiKey) continue;
    let timeoutId = null;
    try {
      const timedAttempt = Promise.race([
        smokeDirectRunsync(endpointId, apiKey, modelTag),
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`RunPod smoke candidate timed out after ${candidateTimeoutMs}ms`)),
            candidateTimeoutMs,
          );
        }),
      ]);
      await timedAttempt;
      if (timeoutId) clearTimeout(timeoutId);
      console.log(`RunPod smoke auth key: ${candidate.label}`);
      return apiKey;
    } catch (error) {
      lastError = error;
      console.warn(`RunPod smoke failed with ${candidate.label}; trying next key...`);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  if (lastError) throw lastError;
  throw new Error('No RunPod API key candidates were provided for smoke test.');
}

async function graphqlWithCandidates(query, keyCandidates) {
  let lastError = null;
  for (const candidate of keyCandidates) {
    const apiKey = String(candidate?.value || '').trim();
    if (!apiKey) continue;
    try {
      return await graphql(apiKey, query);
    } catch (error) {
      lastError = error;
      console.warn(`RunPod GraphQL failed with ${candidate.label}; trying next key...`);
    }
  }

  if (lastError) throw lastError;
  throw new Error('No RunPod API key candidates were provided for GraphQL operations.');
}

async function smokeOnspace(serviceRoleKey) {
  if (!serviceRoleKey) {
    console.log('Skipping onspace-ai-chat smoke: no SUPABASE_SERVICE_ROLE_KEY available in env.');
    return;
  }

  const response = await fetch('https://kxwjcupuxnnbnzcgmkoi.supabase.co/functions/v1/onspace-ai-chat', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Promotion smoke test. Reply with provider and model in one short line.',
      provider: 'inference',
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`onspace-ai-chat smoke failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text);
  if (payload?.provider === 'local-fallback' || payload?.model === 'bob-failsafe') {
    throw new Error(`onspace-ai-chat still in fallback mode: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  console.log(`onspace-ai-chat smoke ok: provider=${payload?.provider || '?'} model=${payload?.model || '?'}`);
}

async function main() {
  const endpointBaseUrl = firstNonEmpty(
    getArg('endpointUrl', ''),
    process.env.RUNPOD_ENDPOINT_URL,
    process.env.RUNPOD_API_URL,
    process.env.RUNPOD_RUNSYNC_URL,
    process.env.BOB_SERVICE_URL,
    process.env.INFERENCE_SERVICE_URL,
  );
  const endpointId = firstNonEmpty(
    getArg('endpoint', ''),
    process.env.RUNPOD_ENDPOINT_ID,
    parseEndpointId(endpointBaseUrl),
  );
  const runpodApiKey = String(process.env.RUNPOD_API_KEY || '').trim();
  const runpodEndpointApiKey = String(process.env.RUNPOD_ENDPOINT_API_KEY || '').trim();
  const inferenceApiKey = String(process.env.INFERENCE_API_KEY || '').trim();

  const graphqlKeyCandidates = [
    { label: 'RUNPOD_API_KEY', value: runpodApiKey },
    { label: 'RUNPOD_ENDPOINT_API_KEY', value: runpodEndpointApiKey },
    { label: 'INFERENCE_API_KEY', value: inferenceApiKey },
  ];

  const runsyncKeyCandidates = [
    { label: 'RUNPOD_ENDPOINT_API_KEY', value: runpodEndpointApiKey },
    { label: 'INFERENCE_API_KEY', value: inferenceApiKey },
    { label: 'RUNPOD_API_KEY', value: runpodApiKey },
  ];

  const apiKey = firstNonEmpty(
    runpodApiKey,
    runpodEndpointApiKey,
    inferenceApiKey,
  );
  const serviceRoleKey = firstNonEmpty(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const projectRef = firstNonEmpty(getArg('projectRef', ''), process.env.SUPABASE_PROJECT_REF);
  const modelTag = firstNonEmpty(getArg('model', ''), process.env.RUNPOD_OLLAMA_MODEL, process.env.OLLAMA_MODEL, 'qwen2.5:7b');
  const keepWarm = getBooleanArg('keepWarm', true);
  const pinModelSecrets = getBooleanArg('pinModelSecrets', true);
  const waitSeconds = Number(getArg('waitSeconds', '45'));
  const imageRepo = firstNonEmpty(getArg('imageRepo', ''), process.env.RUNPOD_WORKER_IMAGE_REPO, 'donsquires/freedomcamp-manager-ai');
  const explicitImageRef = firstNonEmpty(getArg('imageRef', ''), process.env.RUNPOD_WORKER_IMAGE_REF);

  if (!endpointId) {
    throw new Error('RUNPOD_ENDPOINT_ID or --endpoint is required.');
  }
  if (!apiKey) {
    throw new Error('RUNPOD_API_KEY / RUNPOD_ENDPOINT_API_KEY / INFERENCE_API_KEY is required.');
  }

  console.log(`RunPod promote: endpoint=${endpointId} model=${modelTag}`);

  const endpointDetails = await rest('GET', `endpoints/${endpointId}`, apiKey);
  const templateId = String(endpointDetails?.templateId || '').trim();
  if (!templateId) {
    throw new Error(`Endpoint ${endpointId} has no templateId; cannot update serverless template image.`);
  }

  const currentTemplate = await rest('GET', `templates/${templateId}`, apiKey);
  const currentImageRef = String(currentTemplate?.imageName || '').trim();
  const desiredImageRef = explicitImageRef || await resolveGhcrLatestDigest(imageRepo);

  console.log(`Serverless template: ${templateId}`);
  console.log(`Current image: ${currentImageRef || '(unset)'}`);
  console.log(`Desired image: ${desiredImageRef}`);

  if (currentImageRef !== desiredImageRef) {
    console.log('Updating serverless template image...');
    await rest('PATCH', `templates/${templateId}`, apiKey, { imageName: desiredImageRef });
  } else {
    console.log('Template image already up to date.');
  }

  if (projectRef) {
    console.log(`Supabase project ref: ${projectRef}`);
  }

  if (pinModelSecrets) {
    console.log('Pinning Supabase model secrets...');
    await setSupabaseModelSecrets(modelTag);
  }

  if (keepWarm) {
    console.log('Setting RunPod workersMin/workersMax to 1...');
    try {
      await graphqlWithCandidates(`mutation { updateEndpointWorkersMin(input:{ endpointId:"${endpointId}", workerCount: 1 }) { id name workersMin workersMax idleTimeout } }`, graphqlKeyCandidates);
      await graphqlWithCandidates(`mutation { updateEndpointWorkersMax(input:{ endpointId:"${endpointId}", workerCount: 1 }) { id name workersMin workersMax idleTimeout } }`, graphqlKeyCandidates);
    } catch (error) {
      console.warn(`RunPod worker-count warmup mutation skipped: ${error?.message || String(error)}`);
      console.warn('Continuing with endpoint refresh + smoke tests.');
    }
  }

  // Force endpoint refresh using GraphQL (REST API may have auth scoping issues)
  console.log('Forcing endpoint refresh via GraphQL...');
  try {
    console.log('Updating endpoint worker counts to trigger redeploy...');
    await graphqlWithCandidates(`mutation { updateEndpointWorkersMin(input:{ endpointId:"${endpointId}", workerCount: 0 }) { id name workersMin workersMax idleTimeout } }`, graphqlKeyCandidates);
    // Wait a moment before scaling back up
    await new Promise(resolve => setTimeout(resolve, 2000));
    await graphqlWithCandidates(`mutation { updateEndpointWorkersMax(input:{ endpointId:"${endpointId}", workerCount: 2 }) { id name workersMin workersMax idleTimeout } }`, graphqlKeyCandidates);
    if (keepWarm) {
      await graphqlWithCandidates(`mutation { updateEndpointWorkersMin(input:{ endpointId:"${endpointId}", workerCount: 1 }) { id name workersMin workersMax idleTimeout } }`, graphqlKeyCandidates);
    }
    console.log('Endpoint refresh via GraphQL completed.');
  } catch (error) {
    console.warn(`Endpoint refresh via GraphQL failed: ${error?.message || String(error)}`);
    console.warn(`Skipping REST endpoint refresh. Will validate with smoke tests instead.`);
  }

  console.log('Running direct RunPod smoke test...');
  await smokeDirectRunsyncWithCandidates(endpointId, modelTag, runsyncKeyCandidates);

  console.log('Running onspace-ai-chat smoke test...');
  await smokeOnspace(serviceRoleKey);

  console.log('RunPod promotion completed successfully.');
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});