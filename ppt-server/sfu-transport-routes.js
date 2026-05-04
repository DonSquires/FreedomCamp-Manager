/**
 * SFU Transport Routes
 *
 * REST API endpoints for:
 * - Create WebRTC transport (send/recv)
 * - Connect transport (DTLS handshake)
 * - Create producer (incoming audio)
 * - Create consumer (outgoing audio)
 * - Pause/resume producers
 *
 * All routes are org-scoped via req.orgId (from JWT)
 */

const express = require('express');
const router = express.Router();
const { sfuManager } = require('./mediasoup-sfu');

// In-memory registries for active mediasoup resources.
// Key format: `${orgId}:${resourceId}` to enforce org scoping.
const transportRegistry = new Map();
const producerRegistry = new Map();

function transportKey(orgId, transportId) {
  return `${orgId}:${transportId}`;
}

function producerKey(orgId, producerId) {
  return `${orgId}:${producerId}`;
}

function getRegisteredTransport(orgId, transportId) {
  return transportRegistry.get(transportKey(orgId, transportId)) || null;
}

function getRegisteredProducer(orgId, producerId) {
  return producerRegistry.get(producerKey(orgId, producerId)) || null;
}

function closeTransportEntry(entry) {
  if (!entry || !entry.transport) return;
  try {
    if (!entry.transport.closed) {
      entry.transport.close();
    }
  } catch {
    // Best-effort cleanup.
  }
}

function cleanupByTransmission(orgId, transmissionId) {
  if (!transmissionId) return { closedTransports: 0, removedProducers: 0 };

  const transportKeysToRemove = [];
  let closedTransports = 0;

  for (const [key, entry] of transportRegistry.entries()) {
    if (entry.orgId === orgId && String(entry.transmissionId || '') === String(transmissionId)) {
      closeTransportEntry(entry);
      transportKeysToRemove.push(key);
      closedTransports += 1;
    }
  }

  for (const key of transportKeysToRemove) {
    transportRegistry.delete(key);
  }

  const producerKeysToRemove = [];
  for (const [key, entry] of producerRegistry.entries()) {
    if (entry.orgId === orgId && String(entry.transmissionId || '') === String(transmissionId)) {
      try {
        if (entry.producer && !entry.producer.closed) {
          entry.producer.close();
        }
      } catch {
        // Best-effort cleanup.
      }
      producerKeysToRemove.push(key);
    }
  }

  for (const key of producerKeysToRemove) {
    producerRegistry.delete(key);
  }

  return {
    closedTransports,
    removedProducers: producerKeysToRemove.length,
  };
}

/**
 * Middleware: Extract org + role from JWT
 * (Same pattern as radio-control-routes.js)
 */
function verifyRadioToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Bearer token' });
  }

  const token = authHeader.substring(7);

  try {
    // In production: validate JWT signature against SUPABASE_JWT_SECRET
    // For now: decode without verification (assumed secure transport)
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64'));

    req.orgId = payload.org_id;
    req.role = payload.role;
    req.userId = payload.sub;
    req.transmissionId = payload.transmission_id;

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

router.use(verifyRadioToken);

/**
 * POST /sfu/transport/create
 * Create WebRTC transport (send + recv)
 *
 * Request:
 * {
 *   "channel_id": "general",
 *   "direction": "send" | "recv"
 * }
 *
 * Response:
 * {
 *   "transport_id": "...",
 *   "iceParameters": {...},
 *   "iceCandidates": [...],
 *   "dtlsParameters": {...}
 * }
 */
router.post('/transport/create', async (req, res) => {
  try {
    const { channel_id, direction } = req.body;

    if (!channel_id) {
      return res.status(400).json({ error: 'Missing channel_id' });
    }

    // Get router for org
    const orgRouter = await sfuManager.getOrCreateRouter(req.orgId);

    // Create transport
    const transport = await sfuManager.createWebRtcTransport(orgRouter);

    const key = transportKey(req.orgId, transport.id);
    transportRegistry.set(key, {
      transport,
      orgId: req.orgId,
      userId: req.userId,
      channelId: channel_id,
      direction: direction || 'send',
      transmissionId: req.transmissionId || null,
      createdAt: Date.now(),
    });

    transport.on('close', () => {
      transportRegistry.delete(key);
    });

    // Return only what client needs for first answer
    res.json({
      transport_id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    });
  } catch (err) {
    console.error('[SFU Transport] Create failed:', err);
    res.status(500).json({ error: 'Failed to create transport', details: err.message });
  }
});

/**
 * POST /sfu/transport/connect
 * Complete DTLS handshake: exchange client dtlsParameters
 *
 * Request:
 * {
 *   "transport_id": "...",
 *   "dtlsParameters": {...}
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Transport connected"
 * }
 */
router.post('/transport/connect', async (req, res) => {
  try {
    const { transport_id, dtlsParameters } = req.body;

    if (!transport_id || !dtlsParameters) {
      return res.status(400).json({ error: 'Missing transport_id or dtlsParameters' });
    }

    const entry = getRegisteredTransport(req.orgId, transport_id);
    if (!entry) {
      return res.status(404).json({ error: 'Transport not found' });
    }

    await entry.transport.connect({ dtlsParameters });

    res.json({
      success: true,
      message: 'Transport connected',
      transport_id,
    });
  } catch (err) {
    console.error('[SFU Transport] Connect failed:', err);
    res.status(500).json({ error: 'Failed to connect transport', details: err.message });
  }
});

/**
 * POST /sfu/transport/:transport_id/produce
 * Create producer (client sends audio)
 *
 * Request:
 * {
 *   "kind": "audio",
 *   "rtpParameters": {...},
 *   "appData": {"channel_id": "general"}
 * }
 *
 * Response:
 * {
 *   "producer_id": "...",
 *   "timestamp": 1234567890
 * }
 */
router.post('/transport/:transport_id/produce', async (req, res) => {
  try {
    const { transport_id } = req.params;
    const { kind, rtpParameters, appData } = req.body;

    if (!kind || !rtpParameters) {
      return res.status(400).json({ error: 'Missing kind or rtpParameters' });
    }

    const entry = getRegisteredTransport(req.orgId, transport_id);
    if (!entry) {
      return res.status(404).json({ error: 'Transport not found' });
    }

    const producer = await entry.transport.produce({
      kind,
      rtpParameters,
      appData: {
        ...(appData || {}),
        org_id: req.orgId,
        channel_id: appData?.channel_id || entry.channelId,
        user_id: req.userId,
        transmission_id: req.transmissionId || entry.transmissionId,
      },
    });

    const pKey = producerKey(req.orgId, producer.id);
    producerRegistry.set(pKey, {
      producer,
      orgId: req.orgId,
      userId: req.userId,
      channelId: appData?.channel_id || entry.channelId,
      transmissionId: req.transmissionId || entry.transmissionId,
      transportId: transport_id,
      createdAt: Date.now(),
    });

    producer.on('transportclose', () => {
      producerRegistry.delete(pKey);
    });

    producer.on('close', () => {
      producerRegistry.delete(pKey);
    });

    res.json({
      producer_id: producer.id,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('[SFU Transport] Produce failed:', err);
    res.status(500).json({ error: 'Failed to create producer', details: err.message });
  }
});

/**
 * POST /sfu/transport/:transport_id/consume
 * Create consumer (client receives audio from producer)
 *
 * Request:
 * {
 *   "producer_id": "...",
 *   "rtpCapabilities": {...}
 * }
 *
 * Response:
 * {
 *   "consumer_id": "...",
 *   "kind": "audio",
 *   "rtpParameters": {...}
 * }
 */
router.post('/transport/:transport_id/consume', async (req, res) => {
  try {
    const { transport_id } = req.params;
    const { producer_id, rtpCapabilities } = req.body;

    if (!producer_id || !rtpCapabilities) {
      return res.status(400).json({ error: 'Missing producer_id or rtpCapabilities' });
    }

    const transportEntry = getRegisteredTransport(req.orgId, transport_id);
    if (!transportEntry) {
      return res.status(404).json({ error: 'Transport not found' });
    }

    const producerEntry = getRegisteredProducer(req.orgId, producer_id);
    if (!producerEntry) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    const orgRouter = await sfuManager.getOrCreateRouter(req.orgId);
    if (!orgRouter.canConsume({ producerId: producer_id, rtpCapabilities })) {
      return res.status(400).json({ error: 'Cannot consume with provided rtpCapabilities' });
    }

    const consumer = await transportEntry.transport.consume({
      producerId: producer_id,
      rtpCapabilities,
      paused: false,
    });

    res.json({
      consumer_id: consumer.id,
      producer_id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producer_paused: producerEntry.producer.paused,
    });
  } catch (err) {
    console.error('[SFU Transport] Consume failed:', err);
    res.status(500).json({ error: 'Failed to create consumer', details: err.message });
  }
});

/**
 * POST /sfu/producer/:producer_id/pause
 * Pause producer (used when floor is released)
 *
 * Request: {}
 * Response: { "paused": true }
 */
router.post('/producer/:producer_id/pause', async (req, res) => {
  try {
    const { producer_id } = req.params;

    const entry = getRegisteredProducer(req.orgId, producer_id);
    if (!entry) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    await entry.producer.pause();
    res.json({ paused: true, producer_id });
  } catch (err) {
    console.error('[SFU Transport] Pause failed:', err);
    res.status(500).json({ error: 'Failed to pause producer', details: err.message });
  }
});

/**
 * POST /sfu/producer/:producer_id/resume
 * Resume producer (used when floor is granted)
 *
 * Request: {}
 * Response: { "paused": false }
 */
router.post('/producer/:producer_id/resume', async (req, res) => {
  try {
    const { producer_id } = req.params;

    const entry = getRegisteredProducer(req.orgId, producer_id);
    if (!entry) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    await entry.producer.resume();
    res.json({ paused: false, producer_id });
  } catch (err) {
    console.error('[SFU Transport] Resume failed:', err);
    res.status(500).json({ error: 'Failed to resume producer', details: err.message });
  }
});

/**
 * POST /sfu/mediatap/create
 * Create media tap for AI speech intake
 * Connects PlainRTP transport to active speaker producer
 *
 * Request:
 * {
 *   "channel_id": "general",
 *   "producer_id": "..."
 * }
 *
 * Response:
 * {
 *   "transport_id": "...",
 *   "consumer_id": "...",
 *   "rtpParameters": {...},
 *   "tuple": { "localIp": "127.0.0.1", "localPort": 40001 }
 * }
 */
router.post('/mediatap/create', async (req, res) => {
  try {
    const { channel_id, producer_id } = req.body;

    if (!channel_id || !producer_id) {
      return res.status(400).json({ error: 'Missing channel_id or producer_id' });
    }

    const producerEntry = getRegisteredProducer(req.orgId, producer_id);
    if (!producerEntry) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    const orgRouter = await sfuManager.getOrCreateRouter(req.orgId);
    const tap = await sfuManager.createMediaTap(orgRouter, producerEntry.producer);

    res.json({
      transport_id: tap.transport.id,
      consumer_id: tap.consumer.id,
      rtpParameters: tap.rtpParameters,
      tuple: tap.tuple,
      channel_id,
      producer_id,
    });
  } catch (err) {
    console.error('[SFU Transport] MediaTap creation failed:', err);
    res
      .status(500)
      .json({ error: 'Failed to create media tap', details: err.message });
  }
});

/**
 * GET /sfu/stats/:producer_id
 * Get producer stats (bitrate, packets, etc.)
 *
 * Response:
 * {
 *   "producer_id": "...",
 *   "kind": "audio",
 *   "stats": [
 *     {
 *       "type": "inbound-rtp",
 *       "bytesReceived": 123456,
 *       "packetsReceived": 5000,
 *       "packetsLost": 2
 *     }
 *   ]
 * }
 */
router.get('/stats/:producer_id', async (req, res) => {
  try {
    const { producer_id } = req.params;

    const entry = getRegisteredProducer(req.orgId, producer_id);
    if (!entry) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    const stats = await entry.producer.getStats();
    res.json({
      producer_id,
      kind: entry.producer.kind,
      stats,
    });
  } catch (err) {
    console.error('[SFU Transport] Stats retrieval failed:', err);
    res.status(500).json({ error: 'Failed to get stats', details: err.message });
  }
});

/**
 * DELETE /sfu/radio/session/:transmissionId
 * Best-effort session teardown for all registered resources tied to a transmission.
 */
router.delete('/radio/session/:transmissionId', async (req, res) => {
  try {
    const { transmissionId } = req.params;
    if (!transmissionId) {
      return res.status(400).json({ error: 'Missing transmissionId' });
    }

    const result = cleanupByTransmission(req.orgId, transmissionId);
    return res.json({
      success: true,
      transmissionId,
      ...result,
    });
  } catch (err) {
    console.error('[SFU Transport] Session teardown failed:', err);
    return res.status(500).json({ error: 'Failed to teardown session', details: err.message });
  }
});

module.exports = router;
