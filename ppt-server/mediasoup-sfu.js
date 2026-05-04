/**
 * mediasoup SFU Integration
 *
 * Manages WebRTC SFU (Selective Forwarding Unit) for PTT radio.
 * - One Router per org_id
 * - WebRtcTransport per client per channel
 * - Plain RTP transport for AI media tap
 * - Producer/Consumer lifecycle management
 *
 * Per ADR 004 (SFU Platform - mediasoup v3)
 */

const mediasoup = require('mediasoup');

class MediasoupSFUManager {
  constructor() {
    this.workers = [];
    this.routers = new Map(); // Map<orgId, Router>
    this.workerIndex = 0;

    // Configuration
    this.mediasoupSettings = {
      worker: {
        rtcMinPort: parseInt(process.env.MEDIASOUP_MIN_PORT) || 40000,
        rtcMaxPort: parseInt(process.env.MEDIASOUP_MAX_PORT) || 49999,
        logLevel: 'warn',
      },
      router: {
        mediaCodecs: [
          {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
          },
          {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
          },
        ],
      },
      webRtcTransport: {
        listenIps: [
          {
            ip: process.env.MEDIASOUP_ANNOUNCE_IP || '127.0.0.1',
            announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP,
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        maxIncomingBitrate: 1500000,
        initialAvailableOutgoingBitrate: 1000000,
      },
      plainRtpTransport: {
        listenIp: { ip: '127.0.0.1' },
        maxIncomingBitrate: 3000000,
      },
    };
  }

  /**
   * Initialize mediasoup: create workers
   * One worker per CPU core (or configured count)
   */
  async initialize() {
    const numWorkers = parseInt(process.env.MEDIASOUP_WORKERS) || require('os').cpus().length;
    console.log(`[Mediasoup] Initializing ${numWorkers} workers...`);

    for (let i = 0; i < numWorkers; i++) {
      try {
        const worker = await mediasoup.createWorker(this.mediasoupSettings.worker);
        this.workers.push(worker);

        worker.on('died', () => {
          console.error(`[Mediasoup] Worker ${i} died! Restarting...`);
          // In production, implement auto-restart and consumer recovery
        });

        console.log(`[Mediasoup] Worker ${i} created (pid ${worker.pid})`);
      } catch (err) {
        console.error(`[Mediasoup] Failed to create worker ${i}:`, err);
        throw err;
      }
    }
  }

  /**
   * Get or create Router for org
   * @param {string} orgId
   * @returns {Promise<Router>}
   */
  async getOrCreateRouter(orgId) {
    if (this.routers.has(orgId)) {
      return this.routers.get(orgId);
    }

    const worker = this.workers[this.workerIndex % this.workers.length];
    this.workerIndex++;

    try {
      const router = await worker.createRouter(this.mediasoupSettings.router);
      this.routers.set(orgId, router);

      router.on('close', () => {
        console.warn(`[Mediasoup] Router for org ${orgId} closed`);
        this.routers.delete(orgId);
      });

      console.log(`[Mediasoup] Router created for org ${orgId}`);
      return router;
    } catch (err) {
      console.error(`[Mediasoup] Failed to create router for org ${orgId}:`, err);
      throw err;
    }
  }

  /**
   * Create WebRTC transport for client
   * @param {Router} router
   * @param {Object} config - { enableSctp, enableRtx, maxIncomingBitrate }
   * @returns {Promise<WebRtcTransport>}
   */
  async createWebRtcTransport(router, config = {}) {
    const transportConfig = {
      ...this.mediasoupSettings.webRtcTransport,
      ...config,
    };

    try {
      const transport = await router.createWebRtcTransport(transportConfig);

      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
          console.log('[Mediasoup] WebRTC transport DTLS closed');
          transport.close();
        }
      });

      transport.on('close', () => {
        console.log('[Mediasoup] WebRTC transport closed');
      });

      return transport;
    } catch (err) {
      console.error('[Mediasoup] Failed to create WebRTC transport:', err);
      throw err;
    }
  }

  /**
   * Create Plain RTP transport for media tap (AI speech intake)
   * @param {Router} router
   * @returns {Promise<PlainRtpTransport>}
   */
  async createPlainRtpTransport(router) {
    try {
      const transport = await router.createPlainRtpTransport(
        this.mediasoupSettings.plainRtpTransport
      );

      console.log(
        `[Mediasoup] PlainRTP transport created on ${transport.tuple.localIp}:${transport.tuple.localPort}`
      );

      return transport;
    } catch (err) {
      console.error('[Mediasoup] Failed to create PlainRTP transport:', err);
      throw err;
    }
  }

  /**
   * Create audio producer
   * @param {WebRtcTransport} transport
   * @param {RTCRtpSendParameters} rtpParameters
   * @returns {Promise<Producer>}
   */
  async createAudioProducer(transport, rtpParameters) {
    try {
      const producer = await transport.produce({
        kind: 'audio',
        rtpParameters,
      });

      console.log(`[Mediasoup] Audio producer created: ${producer.id}`);
      return producer;
    } catch (err) {
      console.error('[Mediasoup] Failed to create audio producer:', err);
      throw err;
    }
  }

  /**
   * Create audio consumer (client receiving audio from producer)
   * @param {Router} router
   * @param {WebRtcTransport} transport
   * @param {Producer} producer
   * @returns {Promise<Consumer>}
   */
  async createAudioConsumer(router, transport, producer) {
    try {
      // Check if router can consume from this producer
      if (!router.canConsume({
        producerId: producer.id,
        rtpCapabilities: transport.rtpCapabilities,
      })) {
        throw new Error('Router cannot consume from this producer');
      }

      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: transport.rtpCapabilities,
        paused: false,
      });

      console.log(`[Mediasoup] Audio consumer created: ${consumer.id}`);
      return consumer;
    } catch (err) {
      console.error('[Mediasoup] Failed to create audio consumer:', err);
      throw err;
    }
  }

  /**
   * Create media tap: connect PlainRTP transport to producer
   * Used for AI speech intake (Whisper STT)
   * @param {Router} router
   * @param {Producer} producer - Active speaker's producer
   * @returns {Promise<{transport, consumer}>}
   */
  async createMediaTap(router, producer) {
    try {
      const transport = await this.createPlainRtpTransport(router);

      // Create consumer on PlainRTP transport
      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: {},
        paused: false,
      });

      console.log(
        `[Mediasoup] Media tap created: transport=${transport.id}, consumer=${consumer.id}`
      );

      return {
        transport,
        consumer,
        rtpParameters: consumer.rtpParameters,
        tuple: transport.tuple,
      };
    } catch (err) {
      console.error('[Mediasoup] Failed to create media tap:', err);
      throw err;
    }
  }

  /**
   * Pause/resume producer (used for floor control)
   * @param {Producer} producer
   * @param {boolean} paused
   */
  async setProducerPaused(producer, paused) {
    try {
      if (paused) {
        await producer.pause();
        console.log(`[Mediasoup] Producer ${producer.id} paused`);
      } else {
        await producer.resume();
        console.log(`[Mediasoup] Producer ${producer.id} resumed`);
      }
    } catch (err) {
      console.error('[Mediasoup] Failed to set producer pause state:', err);
      throw err;
    }
  }

  /**
   * Close all resources (shutdown)
   */
  async close() {
    console.log('[Mediasoup] Shutting down...');

    for (const router of this.routers.values()) {
      await router.close();
    }
    this.routers.clear();

    for (const worker of this.workers) {
      await worker.close();
    }
    this.workers = [];

    console.log('[Mediasoup] Shutdown complete');
  }
}

// Singleton instance
const sfuManager = new MediasoupSFUManager();

module.exports = { MediasoupSFUManager, sfuManager };
