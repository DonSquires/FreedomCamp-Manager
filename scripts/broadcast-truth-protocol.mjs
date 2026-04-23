#!/usr/bin/env node

import { recordScoredResponse } from './bob-response-log.mjs';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const truthProtocolMessage = String(process.argv.slice(2).join(' ').trim() || [
  'Before you provide any code or architectural advice, you must check system_state.json.',
  'If a module or package is not listed in that file, you are prohibited from assuming it exists.',
  'If asked to use a package manager, resolve from lockfiles: bun.lock => Bun, package-lock.json => npm.',
  'Never guess.',
  '',
  'For major redesigns and new modules, follow the Advanced Architect Workflow 2026:',
  '1. Write spec.md first with requirements, data models, constraints, and edge cases.',
  '2. Self-critique the spec and list at least 3 flaws or risks.',
  '3. Write plan.md with bite-sized tickets.',
  '4. Implement one ticket at a time.',
  '5. Run required validation/tests before saying done.',
  '6. Dr Bob must challenge architecture assumptions and regressions before completion claims.',
  '7. Prefer truthfulness and tenant isolation over speed; hallucinated modules score 0/10 and must be corrected.',
].join(' '));

const bobPrefixed = `Bob: ${truthProtocolMessage}`;
const drBobPrefixed = `Dr Bob: ${truthProtocolMessage}`;

const runpodEndpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
const runpodEndpoint = String(
  process.env.RUNPOD_RUNSYNC_URL ||
  process.env.RUNPOD_SERVERLESS_URL ||
  process.env.RUNPOD_GATEWAY_URL ||
  (runpodEndpointId ? `https://api.runpod.ai/v2/${runpodEndpointId}/runsync` : '')
).trim();
const runpodKey = String(process.env.RUNPOD_API_KEY || process.env.DR_BOB_API || '').trim();

const bobBaseUrl = String(
  process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || process.env.VITE_INFERENCE_SERVICE_URL || ''
).trim().replace(/\/+$/, '');
const bobKey = String(
  process.env.VITE_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || process.env.BOB_INFERENCE_API_KEY || ''
).trim();
const orgId = String(process.env.BOB_ORG_ID || process.env.ORG_ID || process.env.DEFAULT_ORG_ID || '').trim();

async function postJson(url, headers, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: String(error?.message || error || 'fetch failed'),
      networkError: true,
    };
  }
}

async function sendViaRunpod(message) {
  if (!runpodKey) return { sent: false, reason: 'RUNPOD_API_KEY missing' };
  if (!runpodEndpoint) {
    return { sent: false, reason: 'RUNPOD endpoint URL missing (set RUNPOD_RUNSYNC_URL, RUNPOD_SERVERLESS_URL, RUNPOD_GATEWAY_URL, or RUNPOD_ENDPOINT_ID)' };
  }
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${runpodKey}`,
  };
  if (orgId) headers['x-org-id'] = orgId;

  const attempts = [
    { input: { message } },
    { input: { prompt: message } },
    { input: { action: 'training_note', message } },
  ];

  for (const body of attempts) {
    const r = await postJson(runpodEndpoint, headers, body);
    if (r.ok) {
      return { sent: true, channel: 'runpod-runsync', status: r.status, preview: r.text.slice(0, 220) };
    }
  }

  return { sent: false, reason: 'RunPod request failed', channel: 'runpod-runsync' };
}

async function sendViaBobChat(message) {
  if (!bobBaseUrl || !bobKey) return { sent: false, reason: 'Bob /chat base or key missing' };
  const headers = {
    'Content-Type': 'application/json',
    'x-inference-api-key': bobKey,
    Authorization: `Bearer ${bobKey}`,
  };
  if (orgId) headers['x-org-id'] = orgId;

  const r = await postJson(`${bobBaseUrl}/chat`, headers, { message });
  if (!r.ok) {
    return {
      sent: false,
      channel: 'bob-chat',
      status: r.status,
      preview: r.text.slice(0, 220),
      reason: r.networkError ? 'Bob chat network failure' : 'Bob chat request failed',
    };
  }
  return { sent: true, channel: 'bob-chat', status: r.status, preview: r.text.slice(0, 220) };
}

async function main() {
  const results = [];

  // Bob delivery: prefer /chat when available, otherwise use RunPod endpoint.
  const bobChat = await sendViaBobChat(bobPrefixed);
  await recordScoredResponse({
    target: 'Bob',
    channel: bobChat.channel || 'bob-chat',
    prompt: bobPrefixed,
    response: bobChat.preview || bobChat.reason || '',
    delivery: bobChat,
    metadata: { reason: bobChat.reason || null, status: bobChat.status ?? null },
  });
  results.push({ target: 'Bob', ...bobChat });
  if (!bobChat.sent) {
    const bobRunpod = await sendViaRunpod(bobPrefixed);
    await recordScoredResponse({
      target: 'Bob',
      channel: bobRunpod.channel || 'runpod-runsync',
      prompt: bobPrefixed,
      response: bobRunpod.preview || bobRunpod.reason || '',
      delivery: bobRunpod,
      metadata: { reason: bobRunpod.reason || null, status: bobRunpod.status ?? null },
    });
    results.push({ target: 'Bob', ...bobRunpod });
  }

  // Dr Bob delivery: RunPod endpoint is authoritative in this environment.
  const drBobRunpod = await sendViaRunpod(drBobPrefixed);
  await recordScoredResponse({
    target: 'Dr Bob',
    channel: drBobRunpod.channel || 'runpod-runsync',
    prompt: drBobPrefixed,
    response: drBobRunpod.preview || drBobRunpod.reason || '',
    delivery: drBobRunpod,
    metadata: { reason: drBobRunpod.reason || null, status: drBobRunpod.status ?? null },
  });
  results.push({ target: 'Dr Bob', ...drBobRunpod });

  console.log(JSON.stringify({
    success: results.some((r) => r.target === 'Bob' && r.sent) && results.some((r) => r.target === 'Dr Bob' && r.sent),
    results,
  }, null, 2));

  const okBob = results.some((r) => r.target === 'Bob' && r.sent);
  const okDr = results.some((r) => r.target === 'Dr Bob' && r.sent);
  if (!okBob || !okDr) process.exit(1);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
