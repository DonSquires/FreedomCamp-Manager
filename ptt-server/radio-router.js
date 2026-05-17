/**
 * radio-router.js
 *
 * Phase 1 Group B — Radio Control Plane Extension
 *
 * Adds mediasoup SFU routes alongside existing ptt-server signaling.
 * Per ADR 003: this module extends the control plane; it does not replace it.
 * Per ADR 004: mediasoup v3 is the selected SFU.
 *
 * Routes exposed:
 *   POST /radio/token          Sign + return a scoped radio token (called by Supabase radio-token Edge Function)
 *   POST /radio/router/create  Create a mediasoup Router for a channel (SFU session init)
 *   POST /radio/transport/create  Create a WebRtcTransport for a participant
 *   POST /radio/transport/connect  Connect a WebRtcTransport (DTLS handshake)
 *   POST /radio/producer/create   Create a Producer (inbound media from participant)
 *   POST /radio/consumer/create   Create a Consumer (outbound media to participant)
 *   DELETE /radio/session/:transmissionId  Close a radio session and release SFU resources
 *   GET  /radio/health         Health check — returns worker/router counts + speech queue depth
 *
 * Mount this router in server.js:
 *   const { radioRouter } = require('./radio-router');
 *   app.use('/', radioRouter);
 */

'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const RADIO_JWT_SECRET = process.env.RADIO_JWT_SECRET || process.env.PTT_JWT_SECRET || '';
const RADIO_PROXY_SECRET = process.env.RADIO_PROXY_SECRET || process.env.PTT_PROXY_SECRET || '';
const ANNOUNCED_IP = process.env.ANNOUNCED_IP || process.env.SERVER_IP || '127.0.0.1';
const SFU_MIN_PORT = parseInt(process.env.SFU_MIN_PORT || '40000', 10);
const SFU_MAX_PORT = parseInt(process.env.SFU_MAX_PORT || '49999', 10);
const WORKER_COUNT = Math.min(
  parseInt(process.env.SFU_WORKER_COUNT || '1', 10),
  require('os').cpus().length
);
const TOKEN_TTL_SECONDS = 3600;
const REDIS_URL = String(process.env.REDIS_URL || '').trim();
const RADIO_SPEECH_QUEUE_KEY = process.env.RADIO_SPEECH_QUEUE_KEY || 'radio:speech:events';
const RADIO_SPEECH_DLQ_KEY = process.env.RADIO_SPEECH_DLQ_KEY || `${RADIO_SPEECH_QUEUE_KEY}:dlq`;
const RADIO_SPEECH_METRICS_URL = String(process.env.RADIO_SPEECH_METRICS_URL || '').trim();
const RADIO_SPEECH_METRICS_API_KEY = String(
  process.env.RADIO_SPEECH_METRICS_API_KEY
  || process.env.RADIO_SPEECH_INFERENCE_API_KEY
  || process.env.INFERENCE_API_KEY
  || ''
).trim();
const RADIO_SPEECH_METRICS_SECRET = String(process.env.RADIO_SPEECH_WEBHOOK_SECRET || '').trim();
const RADIO_SPEECH_METRICS_TIMEOUT_MS = Math.max(1000, parseInt(process.env.RADIO_SPEECH_METRICS_TIMEOUT_MS || '3000', 10));

let redisClient = null;
let redisReady = false;
let redisCreateClient = null;

function getRedisCreateClient() {
  if (redisCreateClient) return redisCreateClient;
  try {
    redisCreateClient = require('redis').createClient;
    return redisCreateClient;
  } catch {
    return null;
  }
}
const speechQueueMetrics = {
  eventsEnqueued: 0,
  enqueueFailures: 0,
  lastEnqueuedAt: null,
  lastEnqueueError: null,
};

function resetSpeechQueueMetrics() {
  speechQueueMetrics.eventsEnqueued = 0;
  speechQueueMetrics.enqueueFailures = 0;
  speechQueueMetrics.lastEnqueuedAt = null;
  speechQueueMetrics.lastEnqueueError = null;
}

async function initRadioRedis() {
  if (!REDIS_URL) return;
  if (redisClient) return;
  const createClient = getRedisCreateClient();
  if (!createClient) {
    console.warn('[radio-router] redis package not available; speech queue integration disabled');
    return;
  }

  redisClient = createClient({ url: REDIS_URL });
  redisClient.on('ready', () => {
    redisReady = true;
    console.log('[radio-router] Redis connected for speech queue');
  });
  redisClient.on('error', (err) => {
    redisReady = false;
    console.warn('[radio-router] Redis error:', err.message);
  });
  redisClient.on('end', () => {
    redisReady = false;
  });

  try {
    await redisClient.connect();
  } catch (err) {
    redisReady = false;
    console.warn('[radio-router] Redis connect failed:', err.message);
  }
}

async function enqueueSpeechEvent(event) {
  if (!(redisClient && redisReady)) return;
  try {
    const providerName = String(process.env.RADIO_SFU_PROVIDER || 'mediasoup').trim() || 'mediasoup';
    await redisClient.rPush(RADIO_SPEECH_QUEUE_KEY, JSON.stringify({
      ...event,
      source: event?.source || 'ptt-server.radio-router',
      provider: event?.provider || { name: providerName, pipeline: 'sfu-session-events' },
      enqueuedAt: new Date().toISOString(),
    }));
    speechQueueMetrics.eventsEnqueued += 1;
    speechQueueMetrics.lastEnqueuedAt = new Date().toISOString();
    speechQueueMetrics.lastEnqueueError = null;
  } catch (err) {
    speechQueueMetrics.enqueueFailures += 1;
    speechQueueMetrics.lastEnqueueError = String(err?.message || err);
    console.warn('[radio-router] Failed to enqueue speech event:', err.message);
  }
}

async function getSpeechQueueHealth() {
  if (!(redisClient && redisReady)) {
    return {
      enabled: !!REDIS_URL,
      ready: false,
      queueKey: RADIO_SPEECH_QUEUE_KEY,
      dlqKey: RADIO_SPEECH_DLQ_KEY,
      depth: null,
      dlqDepth: null,
      metrics: {
        ...speechQueueMetrics,
      },
    };
  }

  try {
    const [depth, dlqDepth] = await Promise.all([
      redisClient.lLen(RADIO_SPEECH_QUEUE_KEY),
      redisClient.lLen(RADIO_SPEECH_DLQ_KEY),
    ]);
    return {
      enabled: true,
      ready: true,
      queueKey: RADIO_SPEECH_QUEUE_KEY,
      dlqKey: RADIO_SPEECH_DLQ_KEY,
      depth,
      dlqDepth,
      metrics: {
        ...speechQueueMetrics,
      },
    };
  } catch (err) {
    return {
      enabled: true,
      ready: false,
      queueKey: RADIO_SPEECH_QUEUE_KEY,
      dlqKey: RADIO_SPEECH_DLQ_KEY,
      depth: null,
      dlqDepth: null,
      error: String(err?.message || err),
      metrics: {
        ...speechQueueMetrics,
      },
    };
  }
}

async function getSpeechProcessorHealth() {
  if (!RADIO_SPEECH_METRICS_URL) {
    return {
      enabled: false,
      ready: false,
      metricsUrl: null,
      status: 'not_configured',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), RADIO_SPEECH_METRICS_TIMEOUT_MS);

  try {
    const headers = { Accept: 'application/json' };
    if (RADIO_SPEECH_METRICS_API_KEY) headers.Authorization = `Bearer ${RADIO_SPEECH_METRICS_API_KEY}`;
    if (RADIO_SPEECH_METRICS_SECRET) headers['x-radio-speech-secret'] = RADIO_SPEECH_METRICS_SECRET;

    const response = await fetch(RADIO_SPEECH_METRICS_URL, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        enabled: true,
        ready: false,
        metricsUrl: RADIO_SPEECH_METRICS_URL,
        status: 'http_error',
        httpStatus: response.status,
      };
    }

    const payload = await response.json().catch(() => ({}));
    return {
      enabled: true,
      ready: true,
      metricsUrl: RADIO_SPEECH_METRICS_URL,
      status: 'online',
      generatedAt: payload.generated_at || null,
      radioPipeline: payload.radio_pipeline || null,
    };
  } catch (err) {
    return {
      enabled: true,
      ready: false,
      metricsUrl: RADIO_SPEECH_METRICS_URL,
      status: 'offline',
      error: String(err?.message || err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Proxy auth middleware (same pattern as existing ptt-server)
// ---------------------------------------------------------------------------
function proxyAuthMiddleware(req, res, next) {
  if (!RADIO_PROXY_SECRET) return next(); // dev mode: skip
  const secret = req.headers['x-proxy-secret'];
  if (!secret || secret !== RADIO_PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid proxy secret' });
  }
  next();
}

function verifyRadioJwt(req, res, next) {
  if (!RADIO_JWT_SECRET) {
    return res.status(503).json({ error: 'RADIO_JWT_SECRET not configured' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const claims = jwt.verify(token, RADIO_JWT_SECRET);
    req.radioClaims = claims;
    return next();
  } catch (_err) {
    return res.status(401).json({ error: 'Invalid or expired radio token' });
  }
}

function verifyTransmissionScope(req, res, next) {
  const claims = req.radioClaims || {};
  const claimedTransmissionId = claims.transmission_id;
  const bodyTransmissionId = req.body?.transmissionId;
  const pathTransmissionId = req.params?.transmissionId;
  const transmissionId = bodyTransmissionId || pathTransmissionId;

  if (!claimedTransmissionId || !transmissionId) {
    return res.status(400).json({ error: 'Missing transmission scope' });
  }
  if (claimedTransmissionId !== transmissionId) {
    return res.status(403).json({ error: 'Transmission scope mismatch' });
  }

  next();
}

// ---------------------------------------------------------------------------
// mediasoup worker pool
// ---------------------------------------------------------------------------
let mediasoup;
let workers = [];
let nextWorkerIndex = 0;
let sfuReady = false;

async function initSfu() {
  try {
    mediasoup = require('mediasoup');
  } catch {
    console.warn('[radio-router] mediasoup not installed — SFU routes will return 503 until installed');
    return;
  }

  for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
      rtcMinPort: SFU_MIN_PORT,
      rtcMaxPort: SFU_MAX_PORT,
    });
    worker.on('died', (error) => {
      console.error(`[radio-router] mediasoup worker #${i} died`, error);
      // Replace crashed worker
      mediasoup.createWorker({
        logLevel: 'warn',
        rtcMinPort: SFU_MIN_PORT,
        rtcMaxPort: SFU_MAX_PORT,
      }).then((newWorker) => {
        workers[i] = { worker: newWorker, routers: new Map() };
        newWorker.on('died', () => console.error(`[radio-router] replacement worker #${i} died`));
      }).catch(console.error);
    });
    workers.push({ worker, routers: new Map() });
  }
  sfuReady = true;
  console.log(`[radio-router] mediasoup SFU ready — ${WORKER_COUNT} worker(s)`);

  // Optional Redis queue used by speech workers.
  await initRadioRedis();
}

function getNextWorker() {
  const entry = workers[nextWorkerIndex % workers.length];
  nextWorkerIndex++;
  return entry;
}

// In-memory session registry: transmissionId → { workerIndex, routerId, transports, producers, consumers }
const sessions = new Map();

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
];

// ---------------------------------------------------------------------------
// POST /radio/token
// Called by the Supabase radio-token Edge Function to get a signed token.
// ---------------------------------------------------------------------------
router.post('/radio/token', proxyAuthMiddleware, (req, res) => {
  if (!RADIO_JWT_SECRET) {
    return res.status(503).json({ error: 'RADIO_JWT_SECRET not configured' });
  }

  const {
    sub, org, role, channel_scope, channel_type, transmission_id, is_emergency, iat, exp,
  } = req.body;

  if (!sub || !org || !channel_scope || !transmission_id) {
    return res.status(400).json({ error: 'Missing required token fields' });
  }

  const token = jwt.sign(
    { sub, org, role, channel_scope, channel_type, transmission_id, is_emergency },
    RADIO_JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS }
  );

  const iceServers = buildIceServers();

  res.json({ token, iceServers, expiresIn: TOKEN_TTL_SECONDS });
});

function buildIceServers() {
  const servers = [];
  const turnUrl = process.env.TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: [turnUrl],
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  const stunUrl = process.env.STUN_URL || 'stun:stun.l.google.com:19302';
  servers.push({ urls: [stunUrl] });
  return servers;
}

// ---------------------------------------------------------------------------
// POST /radio/router/create
// Create a mediasoup Router for an org-scoped channel.
// ---------------------------------------------------------------------------
router.post('/radio/router/create', verifyRadioJwt, verifyTransmissionScope, async (req, res) => {
  if (!sfuReady) return res.status(503).json({ error: 'SFU not ready' });

  const { transmissionId } = req.body;
  if (!transmissionId) return res.status(400).json({ error: 'transmissionId required' });

  if (sessions.has(transmissionId)) {
    const session = sessions.get(transmissionId);
    return res.json({ routerId: session.routerId, transmissionId });
  }

  const workerEntry = getNextWorker();
  const router = await workerEntry.worker.createRouter({ mediaCodecs });

  const session = {
    routerId: router.id,
    workerIndex: workers.indexOf(workerEntry),
    router,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };
  sessions.set(transmissionId, session);
  workerEntry.routers.set(router.id, router);

  res.json({ routerId: router.id, transmissionId, mediaCodecs: session.router.rtpCapabilities?.codecs || [] });
});

// ---------------------------------------------------------------------------
// POST /radio/transport/create
// Create a server-side WebRtcTransport for a participant.
// ---------------------------------------------------------------------------
router.post('/radio/transport/create', verifyRadioJwt, verifyTransmissionScope, async (req, res) => {
  if (!sfuReady) return res.status(503).json({ error: 'SFU not ready' });

  const { transmissionId, direction } = req.body; // direction: 'send' | 'recv'
  if (!transmissionId || !direction) {
    return res.status(400).json({ error: 'transmissionId and direction required' });
  }

  const session = sessions.get(transmissionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const transport = await session.router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: ANNOUNCED_IP }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  session.transports.set(transport.id, { transport, direction });

  res.json({
    id: transport.id,
    transportId: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  });
});

// ---------------------------------------------------------------------------
// POST /radio/transport/connect
// Client provides its DTLS parameters to complete the handshake.
// ---------------------------------------------------------------------------
router.post('/radio/transport/connect', verifyRadioJwt, verifyTransmissionScope, async (req, res) => {
  if (!sfuReady) return res.status(503).json({ error: 'SFU not ready' });

  const { transmissionId, transportId, dtlsParameters } = req.body;
  if (!transmissionId || !transportId || !dtlsParameters) {
    return res.status(400).json({ error: 'transmissionId, transportId, and dtlsParameters required' });
  }

  const session = sessions.get(transmissionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const entry = session.transports.get(transportId);
  if (!entry) return res.status(404).json({ error: 'Transport not found' });

  await entry.transport.connect({ dtlsParameters });
  res.json({ connected: true });
});

// ---------------------------------------------------------------------------
// POST /radio/producer/create
// Create a Producer — inbound audio from the sending participant.
// ---------------------------------------------------------------------------
router.post('/radio/producer/create', verifyRadioJwt, verifyTransmissionScope, async (req, res) => {
  if (!sfuReady) return res.status(503).json({ error: 'SFU not ready' });

  const { transmissionId, transportId, kind, rtpParameters } = req.body;
  if (!transmissionId || !transportId || !kind || !rtpParameters) {
    return res.status(400).json({ error: 'transmissionId, transportId, kind, and rtpParameters required' });
  }

  const session = sessions.get(transmissionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const entry = session.transports.get(transportId);
  if (!entry) return res.status(404).json({ error: 'Transport not found' });

  const producer = await entry.transport.produce({ kind, rtpParameters });
  session.producers.set(producer.id, producer);

  const claims = req.radioClaims || {};
  await enqueueSpeechEvent({
    type: 'radio.producer.created',
    transmissionId,
    producerId: producer.id,
    orgId: claims.org || null,
    speakerId: claims.sub || null,
    channelId: claims.channel_scope || null,
    channelType: claims.channel_type || null,
    isEmergency: !!claims.is_emergency,
    voiceMetadata: req.body?.appData?.voice_metadata || null,
  });

  producer.on('transportclose', () => {
    session.producers.delete(producer.id);
  });

  producer.on('close', () => {
    enqueueSpeechEvent({
      type: 'radio.producer.closed',
      transmissionId,
      producerId: producer.id,
      orgId: claims.org || null,
      speakerId: claims.sub || null,
    }).catch(() => {});
    session.producers.delete(producer.id);
  });

  res.json({ id: producer.id, producerId: producer.id });
});

// ---------------------------------------------------------------------------
// POST /radio/consumer/create
// Create a Consumer — outbound audio to a receiving participant.
// ---------------------------------------------------------------------------
router.post('/radio/consumer/create', verifyRadioJwt, verifyTransmissionScope, async (req, res) => {
  if (!sfuReady) return res.status(503).json({ error: 'SFU not ready' });

  const { transmissionId, transportId, producerId, rtpCapabilities } = req.body;
  if (!transmissionId || !transportId || !producerId || !rtpCapabilities) {
    return res.status(400).json({ error: 'transmissionId, transportId, producerId, and rtpCapabilities required' });
  }

  const session = sessions.get(transmissionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.router.canConsume({ producerId, rtpCapabilities })) {
    return res.status(400).json({ error: 'Cannot consume: incompatible RTP capabilities' });
  }

  const entry = session.transports.get(transportId);
  if (!entry) return res.status(404).json({ error: 'Transport not found' });

  const consumer = await entry.transport.consume({
    producerId,
    rtpCapabilities,
    paused: false,
  });
  session.consumers.set(consumer.id, consumer);

  res.json({
    id: consumer.id,
    consumerId: consumer.id,
    producerId: consumer.producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  });
});

// ---------------------------------------------------------------------------
// DELETE /radio/session/:transmissionId
// Close a radio session and release all SFU resources.
// ---------------------------------------------------------------------------
router.delete('/radio/session/:transmissionId', verifyRadioJwt, verifyTransmissionScope, async (req, res) => {
  const { transmissionId } = req.params;
  const session = sessions.get(transmissionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Close consumers, producers, transports in order
  for (const consumer of session.consumers.values()) {
    try { consumer.close(); } catch { /* ignore */ }
  }
  for (const producer of session.producers.values()) {
    try { producer.close(); } catch { /* ignore */ }
  }
  for (const { transport } of session.transports.values()) {
    try { transport.close(); } catch { /* ignore */ }
  }

  const workerEntry = workers[session.workerIndex];
  if (workerEntry) {
    workerEntry.routers.delete(session.routerId);
  }

  sessions.delete(transmissionId);

  const claims = req.radioClaims || {};
  await enqueueSpeechEvent({
    type: 'radio.session.closed',
    transmissionId,
    orgId: claims.org || null,
    speakerId: claims.sub || null,
    channelId: claims.channel_scope || null,
    channelType: claims.channel_type || null,
    isEmergency: !!claims.is_emergency,
  });

  res.json({ closed: true, transmissionId });
});

// ---------------------------------------------------------------------------
// GET /radio/health
// ---------------------------------------------------------------------------
router.get('/radio/health', async (req, res) => {
  const [speechQueue, speechProcessor] = await Promise.all([
    getSpeechQueueHealth(),
    getSpeechProcessorHealth(),
  ]);

  res.json({
    sfuReady,
    workerCount: workers.length,
    activeSessions: sessions.size,
    totalRouters: workers.reduce((sum, w) => sum + w.routers.size, 0),
    speechQueue,
    speechProcessor,
  });
});

// ---------------------------------------------------------------------------
// Export router and init function for mounting in server.js
// ---------------------------------------------------------------------------
module.exports = {
  radioRouter: router,
  initSfu,
  __test: {
    enqueueSpeechEvent,
    getSpeechQueueHealth,
    resetSpeechQueueMetrics,
    setRedisClientForTests: (client) => {
      redisClient = client;
    },
    setRedisReadyForTests: (ready) => {
      redisReady = !!ready;
    },
  },
};
