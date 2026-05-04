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
    const router = await sfuManager.getOrCreateRouter(req.orgId);

    // Create transport
    const transport = await sfuManager.createWebRtcTransport(router);

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

    // Get router for org
    const router = await sfuManager.getOrCreateRouter(req.orgId);

    // Find transport (would be stored in session/cache in production)
    // For now, error (in production, retrieve from store keyed by user + channel)
    // TODO: implement transport registry

    res.status(500).json({ error: 'Transport registry not yet implemented' });
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

    // TODO: Retrieve transport from registry
    // const transport = transportRegistry.get(transport_id);
    // if (!transport) return res.status(404).json({ error: 'Transport not found' });

    res.status(500).json({ error: 'Transport registry not yet implemented' });
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

    // TODO: Retrieve transport and producer from registries
    res.status(500).json({ error: 'Transport registry not yet implemented' });
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

    // TODO: Retrieve producer from registry
    res.status(500).json({ error: 'Transport registry not yet implemented' });
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

    // TODO: Retrieve producer from registry
    res.status(500).json({ error: 'Transport registry not yet implemented' });
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

    // TODO: Retrieve router and producer from registries
    // const router = routerRegistry.get(req.orgId);
    // const producer = producerRegistry.get(producer_id);
    // const tap = await sfuManager.createMediaTap(router, producer);

    res.status(500).json({ error: 'Transport registry not yet implemented' });
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

    // TODO: Retrieve producer from registry
    // const stats = await producer.getStats();

    res.status(500).json({ error: 'Transport registry not yet implemented' });
  } catch (err) {
    console.error('[SFU Transport] Stats retrieval failed:', err);
    res.status(500).json({ error: 'Failed to get stats', details: err.message });
  }
});

module.exports = router;
