// This module allows the Copilot agent to collaborate with Bob programmatically
// Usage: import { consultBob } from './agent-bob-bridge.mjs'
// Then: const bobInput = await consultBob('your question or request', { context })

import process from 'node:process';
import { recordScoredResponse } from './bob-response-log.mjs';
import { loadLocalEnv } from './load-local-env.mjs';
import { ensureBobCapabilities, resolveBobMode } from './bob-capability-gate.mjs';

loadLocalEnv();

const capabilityCache = {
  untilMs: 0,
  key: '',
};

function normalizeRunpodInvokeUrl(rawUrl) {
  const value = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (/\/runsync$/i.test(value)) return value;
  if (/\/run-sync$/i.test(value)) return value.replace(/\/run-sync$/i, '/runsync');
  if (/\/run$/i.test(value)) return value.replace(/\/run$/i, '/runsync');
  if (/\/v2\/[^/]+$/i.test(value)) return `${value}/runsync`;
  return value;
}

function resolveBaseUrl() {
  const raw =
    process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '';
  return String(raw).trim().replace(/\/+$/, '');
}

function resolveApiKey() {
  return String(
    process.env.BOB_INFERENCE_API_KEY ||
      process.env.INFERENCE_API_KEY ||
      process.env.RUNPOD_ENDPOINT_API_KEY ||
      process.env.RUNPOD_API_KEY ||
      ''
  ).trim();
}

function resolveRunpodApiKey() {
  return String(
    process.env.RUNPOD_ENDPOINT_API_KEY ||
      process.env.RUNPOD_API_KEY ||
      process.env.DR_BOB_API ||
      ''
  ).trim();
}

function resolveRunpodInvokeUrl() {
  const explicit = String(
    process.env.RUNPOD_ENDPOINT_URL ||
      process.env.RUNPOD_RUNSYNC_URL ||
      process.env.RUNPOD_GATEWAY_URL ||
      process.env.RUNPOD_SERVERLESS_URL ||
      process.env.RUNPOD_URL ||
      ''
  ).trim();

  if (explicit) return normalizeRunpodInvokeUrl(explicit);

  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim();
  if (!endpointId) return '';
  return normalizeRunpodInvokeUrl(`https://api.runpod.ai/v2/${endpointId}`);
}

function resolveOrgId() {
  return String(
    process.env.BOB_ORG_ID ||
      process.env.ORG_ID ||
      process.env.DEFAULT_ORG_ID ||
      ''
  ).trim();
}

function buildScoreMetadata(payload = {}) {
  return {
    provider: payload.provider || null,
    fallback: payload.fallback === true,
    qualityGateFailed:
      payload.quality_gate_failed === true ||
      payload.quality_gate?.status === 'failed',
    fallbackApplied:
      payload.quality_gate?.fallback_applied === true ||
      payload.fallback === true,
  };
}

function extractBobMessage(payload = {}) {
  return (
    payload.message ||
    payload.response ||
    payload.output?.message ||
    payload.output?.response ||
    payload.output?.output ||
    (typeof payload.output === 'string' ? payload.output : '') ||
    JSON.stringify(payload).slice(0, 500)
  );
}

function shouldFallbackToRunpod(statusCode) {
  return statusCode === 404 || statusCode === 405 || statusCode >= 500;
}

async function tryRunpodFallback(message, context, timeoutMs) {
  const runpodUrl = resolveRunpodInvokeUrl();
  const runpodApiKey = resolveRunpodApiKey();

  if (!runpodUrl || !runpodApiKey) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(runpodUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runpodApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        input: {
          action: 'chat',
          message,
          history: [],
          context: context || {},
        },
      }),
    });

    const bodyText = await response.text().catch(() => '');
    let payload = {};
    try {
      payload = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      payload = { response: bodyText };
    }

    if (!response.ok) {
      throw new Error(
        `RunPod fallback failed (${response.status}): ${bodyText.slice(0, 300)}`
      );
    }

    const runStatus = String(payload?.status || '').toUpperCase();
    if (runStatus === 'FAILED') {
      throw new Error(
        `RunPod fallback job failed: ${JSON.stringify(payload).slice(0, 300)}`
      );
    }

    return {
      payload,
      message: extractBobMessage(payload),
      status: response.status,
      provider: 'runpod-fallback',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureBridgeCapabilities() {
  const requiredRaw = String(process.env.BOB_REQUIRED_CAPABILITIES || 'chat').trim();
  const modeRaw = String(process.env.BOB_EXECUTION_MODE || 'auto').trim().toLowerCase();
  const cacheMs = Number(process.env.BOB_CAPABILITY_CACHE_MS || 60000);
  const key = `${requiredRaw}|${modeRaw}`;

  if (Date.now() < capabilityCache.untilMs && capabilityCache.key === key) {
    return;
  }

  await ensureBobCapabilities({
    requiredRaw,
    mode: modeRaw === 'auto' ? undefined : modeRaw,
    strict: String(process.env.BOB_CAPABILITY_STRICT || 'true').trim().toLowerCase() !== 'false',
  });

  capabilityCache.key = key;
  capabilityCache.untilMs = Date.now() + Math.max(5000, cacheMs);
}

async function sendPodChat({ baseUrl, apiKey, orgId, timeoutMs, message, context, history }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-inference-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    };
    if (orgId) headers['x-org-id'] = orgId;

    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        message,
        context: context || {},
        ...(Array.isArray(history) ? { history } : {}),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function sendServerlessChat({ timeoutMs, message, context }) {
  return tryRunpodFallback(message, context, timeoutMs);
}

/**
 * Consult Bob with a single message.
 * @param {string} message - The question or prompt for Bob
 * @param {object} options - Configuration options
 * @returns {Promise<string>} Bob's response
 */
export async function consultBob(message, options = {}) {
  await ensureBridgeCapabilities();

  const baseUrl = resolveBaseUrl();
  const apiKey = resolveApiKey();
  const mode = resolveBobMode({ podBaseUrl: baseUrl, runpodBaseUrl: resolveRunpodInvokeUrl().replace(/\/runsync$/i, ''), apiKey });
  const orgId = resolveOrgId();
  const timeoutMs = Number(process.env.BOB_CHAT_TIMEOUT_MS || 30000);

  if (mode !== 'serverless' && (!baseUrl || !apiKey)) {
    const missing = [
      !baseUrl
        ? 'BOB_SERVICE_URL-or-INFERENCE_SERVICE_URL'
        : null,
      !apiKey
        ? 'BOB_INFERENCE_API_KEY-or-INFERENCE_API_KEY'
        : null,
    ]
      .filter(Boolean)
      .join(', ');

    throw new Error(`[Bob Bridge] Missing config: ${missing}`);
  }

  let payload = {};
  let status = 200;

    if (mode === 'serverless') {
      const result = await sendServerlessChat({
        timeoutMs,
        message,
        context: options.context || {},
      });
      if (!result) {
        throw new Error('Serverless mode selected but RunPod endpoint/key are unavailable');
      }
      payload = result.payload || {};
      status = result.status || 200;
    } else {
      const { response, payload: podPayload } = await sendPodChat({
        baseUrl,
        apiKey,
        orgId,
        timeoutMs,
        message,
        context: options.context || {},
      });

      if (!response.ok) {
        if (shouldFallbackToRunpod(response.status)) {
          const fallback = await tryRunpodFallback(message, options.context, timeoutMs);
          if (fallback) {
            await recordScoredResponse({
              target: 'Bob',
              channel: 'bob-chat',
              prompt: message,
              response: fallback.message,
              delivery: { sent: true, status: fallback.status, channel: 'bob-chat' },
              metadata: {
                provider: fallback.provider,
                fallback: true,
                qualityGateFailed: false,
                fallbackApplied: true,
              },
            });
            return fallback.message;
          }
        }

        throw new Error(`Bob /chat failed (${response.status}): ${JSON.stringify(podPayload).slice(0, 300)}`);
      }

      payload = podPayload || {};
      status = response.status;
    }

    const bobMessage = extractBobMessage(payload);

    await recordScoredResponse({
      target: 'Bob',
      channel: 'bob-chat',
      prompt: message,
      response: bobMessage,
      delivery: { sent: true, status, channel: 'bob-chat' },
      metadata: buildScoreMetadata(payload),
    });

  return bobMessage;
}

/**
 * Have a multi-turn conversation with Bob.
 * Maintains conversation state and context across turns.
 */
export class BobSession {
  constructor(options = {}) {
    this.baseUrl = resolveBaseUrl();
    this.apiKey = resolveApiKey();
    this.mode = resolveBobMode({
      podBaseUrl: this.baseUrl,
      runpodBaseUrl: resolveRunpodInvokeUrl().replace(/\/runsync$/i, ''),
      apiKey: this.apiKey,
    });
    this.orgId = resolveOrgId();
    this.timeoutMs = Number(process.env.BOB_CHAT_TIMEOUT_MS || 30000);
    this.history = [];
    this.context = options.context || {};

    if (this.mode !== 'serverless' && (!this.baseUrl || !this.apiKey)) {
      const missing = [
        !this.baseUrl
          ? 'BOB_SERVICE_URL-or-INFERENCE_SERVICE_URL'
          : null,
        !this.apiKey
          ? 'BOB_INFERENCE_API_KEY-or-INFERENCE_API_KEY'
          : null,
      ]
        .filter(Boolean)
        .join(', ');

      throw new Error(`[Bob Session] Missing config: ${missing}`);
    }
  }

  async send(message, role = 'agent') {
    await ensureBridgeCapabilities();

    let payload = {};
    let status = 200;

      if (this.mode === 'serverless') {
        const result = await sendServerlessChat({
          timeoutMs: this.timeoutMs,
          message,
          context: this.context,
        });
        if (!result) {
          throw new Error('Serverless mode selected but RunPod endpoint/key are unavailable');
        }
        payload = result.payload || {};
        status = result.status || 200;
      } else {
        const { response, payload: podPayload } = await sendPodChat({
          baseUrl: this.baseUrl,
          apiKey: this.apiKey,
          orgId: this.orgId,
          timeoutMs: this.timeoutMs,
          message,
          context: this.context,
          history: this.history,
        });

        if (!response.ok) {
          if (shouldFallbackToRunpod(response.status)) {
            const fallback = await tryRunpodFallback(message, this.context, this.timeoutMs);
            if (fallback) {
              await recordScoredResponse({
                target: 'Bob',
                channel: 'bob-chat',
                prompt: message,
                response: fallback.message,
                delivery: { sent: true, status: fallback.status, channel: 'bob-chat' },
                metadata: {
                  provider: fallback.provider,
                  fallback: true,
                  qualityGateFailed: false,
                  fallbackApplied: true,
                },
              });

              this.history.push(
                { role, message },
                {
                  role: 'bob',
                  message: fallback.message,
                  metadata: { provider: fallback.provider, fallback: true },
                }
              );

              return fallback.message;
            }
          }

          throw new Error(`Bob /chat failed (${response.status}): ${JSON.stringify(podPayload).slice(0, 300)}`);
        }

        payload = podPayload || {};
        status = response.status;
      }

      const bobMessage = extractBobMessage(payload);

      await recordScoredResponse({
        target: 'Bob',
        channel: 'bob-chat',
        prompt: message,
        response: bobMessage,
        delivery: { sent: true, status, channel: 'bob-chat' },
        metadata: buildScoreMetadata(payload),
      });

      // Store in history for context
      this.history.push(
        { role, message },
        {
          role: 'bob',
          message: bobMessage,
          metadata: { provider: payload.provider, fallback: payload.fallback },
        }
      );

    return bobMessage;
  }

  async exchange(message) {
    // Higher-level method: send message, get response, maintain context
    return this.send(message, 'agent');
  }

  getHistory() {
    return this.history;
  }
}

export default { consultBob, BobSession };
