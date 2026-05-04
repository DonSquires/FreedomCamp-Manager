/**
 * Inference Service Media Tap Integration
 *
 * Mounts the RTP media tap listener into the inference-service.
 * Handles:
 * - POST /mediatap/tap_started — start RTP listener
 * - POST /mediatap/tap_stopped — stop RTP listener
 * - GET /mediatap/status — active tap list
 * - Periodic transcript delivery back to ppt-server
 *
 * Usage:
 *   const mediaTapRouter = require('./media-tap-integration');
 *   app.use('/', mediaTapRouter);
 */

const express = require('express');
const { RTPMediaTap } = require('./rtp-media-tap');

const router = express.Router();

// Global RTP media tap manager
const rtpTap = new RTPMediaTap({
  whisperCliPath: process.env.WHISPER_CLI_PATH || '/usr/local/bin/whisper',
  whisperModel: process.env.WHISPER_MODEL || 'base',
  pptServerUrl: process.env.PTT_SERVER_URL || 'http://localhost:3002',
});

// Start transcript delivery interval
const TRANSCRIPT_DELIVERY_INTERVAL = parseInt(process.env.TRANSCRIPT_DELIVERY_INTERVAL_MS) || 2000;
setInterval(async () => {
  try {
    await rtpTap.sendTranscripts();
  } catch (err) {
    console.error('[MediaTapIntegration] Transcript delivery error:', err);
  }
}, TRANSCRIPT_DELIVERY_INTERVAL);

/**
 * POST /mediatap/tap_started
 *
 * Start RTP listener for incoming audio
 *
 * Request:
 * {
 *   "tap_id": "tap-12345",
 *   "rtp_port": 40001,
 *   "metadata": {
 *     "org_id": "org-123",
 *     "channel_id": "general",
 *     "speaker_id": "user-456"
 *   }
 * }
 *
 * Response:
 * {
 *   "status": "listening",
 *   "tap_id": "tap-12345",
 *   "rtp_port": 40001
 * }
 */
router.post('/mediatap/tap_started', async (req, res) => {
  try {
    const { tap_id, rtp_port, metadata } = req.body;

    if (!tap_id || !rtp_port) {
      return res.status(400).json({ error: 'Missing tap_id or rtp_port' });
    }

    // Start RTP listener
    await rtpTap.startTap(tap_id, {
      rtp_port,
      metadata,
    });

    res.json({
      status: 'listening',
      tap_id,
      rtp_port,
    });
  } catch (err) {
    console.error('[MediaTapIntegration] tap_started error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /mediatap/tap_stopped
 *
 * Stop RTP listener and finalize audio processing
 *
 * Request:
 * {
 *   "tap_id": "tap-12345"
 * }
 *
 * Response:
 * {
 *   "status": "stopped",
 *   "tap_id": "tap-12345"
 * }
 */
router.post('/mediatap/tap_stopped', async (req, res) => {
  try {
    const { tap_id } = req.body;

    if (!tap_id) {
      return res.status(400).json({ error: 'Missing tap_id' });
    }

    // Stop RTP listener
    await rtpTap.stopTap(tap_id);

    res.json({
      status: 'stopped',
      tap_id,
    });
  } catch (err) {
    console.error('[MediaTapIntegration] tap_stopped error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /mediatap/status
 *
 * Get list of active RTP taps
 *
 * Response:
 * {
 *   "active_taps": ["tap-12345", "tap-67890"],
 *   "transcript_queue_length": 2
 * }
 */
router.get('/mediatap/status', (req, res) => {
  res.json({
    active_taps: rtpTap.getActiveTaps(),
    transcript_queue_length: rtpTap.transcriptQueue.length,
  });
});

// Export manager for testing
module.exports = router;
module.exports.rtpTapManager = rtpTap;
