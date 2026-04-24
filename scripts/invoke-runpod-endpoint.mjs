#!/usr/bin/env node

/**
 * Invoke a RunPod Serverless endpoint from local/Codespaces and optionally poll for completion.
 *
 * Required env:
 *   RUNPOD_ENDPOINT_API_KEY
 *
 * Required env, one of:
 *   RUNPOD_ENDPOINT_URL
 *   RUNPOD_ENDPOINT_ID
 *
 * Optional env:
 *   RUNPOD_ENDPOINT_ID
 *
 * Example:
 *   RUNPOD_ENDPOINT_ID="<endpointId>" \
 *   RUNPOD_ENDPOINT_API_KEY="..." \
 *   node scripts/invoke-runpod-endpoint.mjs \
 *     --input '{"prompt":"Hello from Codespaces"}'
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

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function safeJsonParse(raw, fieldName) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${fieldName} must be valid JSON`);
  }
}

function normalizeInput(inputRaw, promptTextRaw) {
  const promptText = String(promptTextRaw || '').trim();
  if (promptText) {
    // Some serverless runtimes expect input.message rather than input.prompt.
    return { message: promptText, prompt: promptText };
  }

  if (!String(inputRaw || '').trim()) {
    return { message: 'Hello from Codespaces', prompt: 'Hello from Codespaces' };
  }
  return safeJsonParse(inputRaw, 'input');
}

function normalizePayload(payloadRaw, inputObject) {
  if (!String(payloadRaw || '').trim()) {
    return { input: inputObject };
  }
  return safeJsonParse(payloadRaw, 'payload');
}

function deriveInvokeUrl(endpointUrl, endpointId) {
  const explicitUrl = String(endpointUrl || '').trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const id = String(endpointId || '').trim();
  if (id) {
    return `https://api.runpod.ai/v2/${id}/run`;
  }

  throw new Error('RUNPOD_ENDPOINT_URL or RUNPOD_ENDPOINT_ID is required');
}

function deriveStatusUrl({ endpointUrl, endpointId, statusJobId, explicitStatusUrl = '' }) {
  const explicit = String(explicitStatusUrl || '').trim();
  if (explicit) {
    return explicit.includes('{id}') ? explicit.replace('{id}', encodeURIComponent(statusJobId)) : explicit;
  }

  if (endpointId) {
    return `https://api.runpod.ai/v2/${endpointId}/status/${encodeURIComponent(statusJobId)}`;
  }

  // Common pattern: /run or /runs -> /status/<id>
  if (endpointUrl.includes('/run')) {
    return endpointUrl.replace(/\/runs?$/i, `/status/${encodeURIComponent(statusJobId)}`);
  }

  throw new Error(
    'Unable to derive status URL. Provide RUNPOD_ENDPOINT_ID or --statusUrl "https://api.runpod.ai/v2/<endpointId>/status/{id}"'
  );
}

async function httpJson(url, apiKey, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Endpoint returned non-JSON response (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`Endpoint HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return json;
}

function isTerminalStatus(status) {
  const value = String(status || '').toUpperCase();
  return value === 'COMPLETED' || value === 'FAILED' || value === 'CANCELLED' || value === 'TIMED_OUT';
}

async function pollStatus({ endpointUrl, endpointId, apiKey, statusJobId, statusUrlTemplate, intervalMs, timeoutMs }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const statusUrl = deriveStatusUrl({
      endpointUrl,
      endpointId,
      statusJobId,
      explicitStatusUrl: statusUrlTemplate,
    });

    const statusData = await httpJson(statusUrl, apiKey, null);
    console.log(JSON.stringify({ phase: 'status', url: statusUrl, data: statusData }, null, 2));

    const status = statusData?.status;
    if (isTerminalStatus(status)) {
      return statusData;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Polling timed out after ${timeoutMs}ms`);
}

async function main() {
  const apiKey = requiredEnv('RUNPOD_ENDPOINT_API_KEY');
  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
  const endpointUrl = deriveInvokeUrl(process.env.RUNPOD_ENDPOINT_URL, endpointId);

  const inputRaw = getArg('input', '');
  const promptRaw = getArg('prompt', '');
  const payloadRaw = getArg('payload', '');
  const statusJobId = getArg('statusJobId', '');
  const statusUrlTemplate = getArg('statusUrl', '');
  const poll = getBooleanArg('poll', true);
  const intervalMs = Number(getArg('intervalMs', '3000'));
  const timeoutMs = Number(getArg('timeoutMs', '120000'));

  if (!Number.isFinite(intervalMs) || intervalMs < 250) {
    throw new Error('intervalMs must be a number >= 250');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    throw new Error('timeoutMs must be a number >= 1000');
  }

  if (statusJobId) {
    const finalStatus = await pollStatus({
      endpointUrl,
      endpointId,
      apiKey,
      statusJobId,
      statusUrlTemplate,
      intervalMs,
      timeoutMs,
    });
    const failed = String(finalStatus?.status || '').toUpperCase() === 'FAILED';
    process.exit(failed ? 1 : 0);
  }

  const inputObject = normalizeInput(inputRaw, promptRaw);
  const payload = normalizePayload(payloadRaw, inputObject);

  const invokeData = await httpJson(endpointUrl, apiKey, payload);
  console.log(JSON.stringify({ phase: 'invoke', url: endpointUrl, data: invokeData }, null, 2));

  const jobId = invokeData?.id || invokeData?.jobId;
  const status = String(invokeData?.status || '').toUpperCase();
  const alreadyTerminal = isTerminalStatus(status);

  if (!poll || !jobId || alreadyTerminal) {
    process.exit(status === 'FAILED' ? 1 : 0);
  }

  const finalStatus = await pollStatus({
    endpointUrl,
    endpointId,
    apiKey,
    statusJobId: jobId,
    statusUrlTemplate,
    intervalMs,
    timeoutMs,
  });

  const failed = String(finalStatus?.status || '').toUpperCase() === 'FAILED';
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
