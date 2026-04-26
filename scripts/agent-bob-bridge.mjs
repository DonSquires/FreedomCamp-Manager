// This module allows the Copilot agent to collaborate with Bob programmatically
// Usage: import { consultBob } from './agent-bob-bridge.mjs'
// Then: const bobInput = await consultBob('your question or request', { context })

import process from 'node:process';
import { recordScoredResponse } from './bob-response-log.mjs';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

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
        message,
        context: context || {},
        input: {
          message,
          prompt: message,
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

/**
 * Consult Bob with a single message.
 * @param {string} message - The question or prompt for Bob
 * @param {object} options - Configuration options
 * @returns {Promise<string>} Bob's response
 */
export async function consultBob(message, options = {}) {
  const baseUrl = resolveBaseUrl();
  const apiKey = resolveApiKey();
  const orgId = resolveOrgId();
  const timeoutMs = Number(process.env.BOB_CHAT_TIMEOUT_MS || 30000);

  if (!baseUrl || !apiKey) {
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
        context: options.context || {},
      }),
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

      const body = await response.text().catch(() => '');
      throw new Error(
        `Bob /chat failed (${response.status}): ${body.slice(0, 300)}`
      );
    }

    const payload = await response.json().catch(() => ({}));
    const bobMessage = extractBobMessage(payload);

    await recordScoredResponse({
      target: 'Bob',
      channel: 'bob-chat',
      prompt: message,
      response: bobMessage,
      delivery: { sent: true, status: response.status, channel: 'bob-chat' },
      metadata: buildScoreMetadata(payload),
    });

    return bobMessage;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Have a multi-turn conversation with Bob.
 * Maintains conversation state and context across turns.
 */
export class BobSession {
  constructor(options = {}) {
    this.baseUrl = resolveBaseUrl();
    this.apiKey = resolveApiKey();
    this.orgId = resolveOrgId();
    this.timeoutMs = Number(process.env.BOB_CHAT_TIMEOUT_MS || 30000);
    this.history = [];
    this.context = options.context || {};

    if (!this.baseUrl || !this.apiKey) {
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = {
        'Content-Type': 'application/json',
        'x-inference-api-key': this.apiKey,
        Authorization: `Bearer ${this.apiKey}`,
      };
      if (this.orgId) headers['x-org-id'] = this.orgId;

      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          message,
          context: this.context,
          history: this.history,
        }),
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

        const body = await response.text().catch(() => '');
        throw new Error(
          `Bob /chat failed (${response.status}): ${body.slice(0, 300)}`
        );
      }

      const payload = await response.json().catch(() => ({}));
      const bobMessage = extractBobMessage(payload);

      await recordScoredResponse({
        target: 'Bob',
        channel: 'bob-chat',
        prompt: message,
        response: bobMessage,
        delivery: { sent: true, status: response.status, channel: 'bob-chat' },
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
    } finally {
      clearTimeout(timer);
    }
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
