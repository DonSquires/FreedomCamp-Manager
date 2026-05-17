/**
 * speech-worker.js
 *
 * Consumes speech events emitted by radio-router from Redis and forwards them
 * to the speech pipeline webhook with retry, exponential backoff, and
 * dead-letter handling.
 *
 * Queue producer: ptt-server/radio-router.js (RADIO_SPEECH_QUEUE_KEY)
 */

'use strict';

const { createClient } = require('redis');
require('dotenv').config();

const REDIS_URL = String(process.env.REDIS_URL || '').trim();
const QUEUE_KEY = String(process.env.RADIO_SPEECH_QUEUE_KEY || 'radio:speech:events').trim();
const DLQ_KEY = String(process.env.RADIO_SPEECH_DLQ_KEY || `${QUEUE_KEY}:dlq`).trim();
const WEBHOOK_URL = String(process.env.RADIO_SPEECH_WEBHOOK_URL || '').trim();
const WEBHOOK_SECRET = String(process.env.RADIO_SPEECH_WEBHOOK_SECRET || '').trim();
const WEBHOOK_API_KEY = String(
  process.env.RADIO_SPEECH_INFERENCE_API_KEY
  || process.env.INFERENCE_API_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || ''
).trim();
const WEBHOOK_TIMEOUT_MS = Math.max(1000, parseInt(process.env.RADIO_SPEECH_WEBHOOK_TIMEOUT_MS || '10000', 10));
const MAX_ATTEMPTS = Math.max(1, parseInt(process.env.RADIO_SPEECH_MAX_ATTEMPTS || '4', 10));
const BACKOFF_BASE_MS = Math.max(100, parseInt(process.env.RADIO_SPEECH_BACKOFF_BASE_MS || '1000', 10));
const BACKOFF_MAX_MS = Math.max(BACKOFF_BASE_MS, parseInt(process.env.RADIO_SPEECH_BACKOFF_MAX_MS || '10000', 10));
const POP_TIMEOUT_SECONDS = Math.max(1, parseInt(process.env.RADIO_SPEECH_POP_TIMEOUT_SECONDS || '5', 10));
const DEFAULT_SOURCE = String(process.env.RADIO_SPEECH_SOURCE || 'ptt-server.speech-worker').trim() || 'ptt-server.speech-worker';
const DEFAULT_PROVIDER_NAME = String(process.env.RADIO_SPEECH_PROVIDER || process.env.RADIO_SFU_PROVIDER || 'mediasoup').trim() || 'mediasoup';

if (!REDIS_URL) {
  console.error('[speech-worker] REDIS_URL is required');
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.error('[speech-worker] RADIO_SPEECH_WEBHOOK_URL is required');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boundedBackoffMs(attempt) {
  const exponential = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(BACKOFF_MAX_MS, exponential + jitter);
}

function normalizedString(value, maxLength = 256) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeProvider(provider, fallbackName) {
  if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
    return {
      ...provider,
      name: normalizedString(provider.name || fallbackName, 120) || fallbackName,
      pipeline: normalizedString(provider.pipeline || 'speech-event-queue', 120) || 'speech-event-queue',
    };
  }

  return {
    name: normalizedString(provider || fallbackName, 120) || fallbackName,
    pipeline: 'speech-event-queue',
  };
}

function normalizeSpeechPayload(payload) {
  const incoming = payload && typeof payload === 'object' ? payload : {};

  const transmissionId = normalizedString(incoming.transmissionId, 128);
  const orgId = normalizedString(incoming.orgId, 128);
  const providerName = normalizedString(incoming.providerName, 120) || DEFAULT_PROVIDER_NAME;

  return {
    ...incoming,
    type: normalizedString(incoming.type, 120) || 'unknown',
    transmissionId,
    orgId,
    speakerId: normalizedString(incoming.speakerId, 128),
    channelId: normalizedString(incoming.channelId || incoming.channel_scope || incoming.channelScope, 128),
    channelType: normalizedString(incoming.channelType || incoming.channel_type, 64),
    source: normalizedString(incoming.source, 160) || DEFAULT_SOURCE,
    provider: normalizeProvider(incoming.provider, providerName),
    traceId: normalizedString(incoming.traceId || incoming.requestId, 160)
      || `${transmissionId || 'tx-unknown'}:${Date.now()}`,
    enqueuedAt: normalizedString(incoming.enqueuedAt, 64) || new Date().toISOString(),
    forwardedAt: new Date().toISOString(),
  };
}

async function callWebhook(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), WEBHOOK_TIMEOUT_MS);

  try {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (WEBHOOK_SECRET) headers['x-radio-speech-secret'] = WEBHOOK_SECRET;
    if (WEBHOOK_API_KEY) headers.Authorization = `Bearer ${WEBHOOK_API_KEY}`;
    if (payload.orgId) headers['x-org-id'] = String(payload.orgId);

    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`webhook ${res.status}: ${body || res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function processMessage(raw, redisClient) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_err) {
    const dead = {
      raw,
      reason: 'invalid_json',
      failedAt: new Date().toISOString(),
    };
    await redisClient.rPush(DLQ_KEY, JSON.stringify(dead));
    return;
  }

  const normalizedPayload = normalizeSpeechPayload(payload);
  if (!normalizedPayload.transmissionId || !normalizedPayload.type) {
    const dead = {
      payload: normalizedPayload,
      reason: 'invalid_payload',
      missing: [
        !normalizedPayload.transmissionId ? 'transmissionId' : null,
        !normalizedPayload.type ? 'type' : null,
      ].filter(Boolean),
      failedAt: new Date().toISOString(),
    };
    await redisClient.rPush(DLQ_KEY, JSON.stringify(dead));
    console.warn('[speech-worker] dropped invalid payload; moved to DLQ');
    return;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await callWebhook(normalizedPayload);
      if (attempt > 1) {
        console.log(`[speech-worker] recovered after retry ${attempt}/${MAX_ATTEMPTS} for ${normalizedPayload.type || 'unknown'}`);
      }
      return;
    } catch (err) {
      lastError = err;
      const finalAttempt = attempt >= MAX_ATTEMPTS;
      if (!finalAttempt) {
        const backoffMs = boundedBackoffMs(attempt);
        console.warn(`[speech-worker] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}; retrying in ${backoffMs}ms`);
        await sleep(backoffMs);
      }
    }
  }

  const dead = {
    payload: normalizedPayload,
    reason: 'max_attempts_exceeded',
    attempts: MAX_ATTEMPTS,
    error: lastError ? String(lastError.message || lastError) : 'unknown',
    failedAt: new Date().toISOString(),
  };
  await redisClient.rPush(DLQ_KEY, JSON.stringify(dead));
  console.error(`[speech-worker] moved event to DLQ after ${MAX_ATTEMPTS} attempts`);
}

async function run() {
  const redisClient = createClient({ url: REDIS_URL });

  redisClient.on('error', (err) => {
    console.error('[speech-worker] Redis error:', err.message);
  });

  await redisClient.connect();
  console.log('[speech-worker] connected');
  console.log(`[speech-worker] listening on ${QUEUE_KEY}, DLQ=${DLQ_KEY}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[speech-worker] received ${signal}, shutting down`);
    try {
      await redisClient.quit();
    } catch (_err) {
      try {
        await redisClient.disconnect();
      } catch {
        // Ignore disconnect failure on shutdown.
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  while (!shuttingDown) {
    try {
      const item = await redisClient.blPop(QUEUE_KEY, POP_TIMEOUT_SECONDS);
      if (!item || !item.element) continue;
      await processMessage(item.element, redisClient);
    } catch (err) {
      console.error('[speech-worker] loop error:', err.message);
      await sleep(1000);
    }
  }
}

run().catch((err) => {
  console.error('[speech-worker] fatal error:', err.message);
  process.exit(1);
});
