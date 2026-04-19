// This module allows the Copilot agent to collaborate with Bob programmatically
// Usage: import { consultBob } from './agent-bob-bridge.mjs'
// Then: const bobInput = await consultBob('your question or request', { context })

import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

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

function resolveOrgId() {
  return String(
    process.env.BOB_ORG_ID ||
      process.env.ORG_ID ||
      process.env.DEFAULT_ORG_ID ||
      ''
  ).trim();
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
      const body = await response.text().catch(() => '');
      throw new Error(
        `Bob /chat failed (${response.status}): ${body.slice(0, 300)}`
      );
    }

    const payload = await response.json().catch(() => ({}));
    return (
      payload.message ||
      payload.response ||
      JSON.stringify(payload).slice(0, 500)
    );
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
        const body = await response.text().catch(() => '');
        throw new Error(
          `Bob /chat failed (${response.status}): ${body.slice(0, 300)}`
        );
      }

      const payload = await response.json().catch(() => ({}));
      const bobMessage =
        payload.message ||
        payload.response ||
        JSON.stringify(payload).slice(0, 500);

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
