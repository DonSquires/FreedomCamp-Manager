/**
 * PTT Server Main Entry Point
 *
 * Integrates:
 * - Floor control (radio-control-routes)
 * - SFU (mediasoup-sfu + sfu-transport-routes)
 * - Media tap (media-tap + inference integration)
 * - WebSocket real-time signaling (radio-websocket)
 *
 * Per Phase 1 implementation plan:
 * D1: Policy gateway ✓ (radio-token Edge Function)
 * D2: Control plane ✓ (floor-control, radio-control-routes, radio-websocket)
 * D3: SFU initialization ✓ (mediasoup-sfu, sfu-transport-routes, media-tap)
 * D4: AI media tap (inference integration) -- currently stubbed
 * D5: Schema finalization ✓ (migrations applied)
 *
 * Run:
 *   npm install
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run dev
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const redis = require('redis');
const { createClient } = require('@supabase/supabase-js');

// Import modules
const { sfuManager } = require('./mediasoup-sfu');
const { MediaTapManager } = require('./media-tap');
const floorControlRoutes = require('./radio-control-routes');
const sfuTransportRoutes = require('./sfu-transport-routes');
const radioWebSocketHandler = require('./radio-websocket');

// Environment
const PORT = parseInt(process.env.PTT_SERVER_PORT) || 3002;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Initialize services
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let redisClient;
let supabase;

/**
 * Initialize all services
 */
async function initialize() {
  try {
    console.log('[PTT Server] Initializing...');

    // 1. Connect Redis
    console.log('[PTT Server] Connecting to Redis...');
    redisClient = redis.createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => console.error('[Redis] Error:', err));
    await redisClient.connect();
    console.log('[PTT Server] Redis connected ✓');

    // 2. Initialize Supabase client
    console.log('[PTT Server] Initializing Supabase client...');
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
    console.log('[PTT Server] Supabase client initialized ✓');

    // 3. Initialize Mediasoup SFU
    console.log('[PTT Server] Initializing Mediasoup SFU...');
    await sfuManager.initialize();
    console.log('[PTT Server] Mediasoup SFU initialized ✓');

    // 4. Initialize Media Tap manager
    console.log('[PTT Server] Initializing Media Tap manager...');
    const mediaTapManager = new MediaTapManager({ redisClient, supabase });
    mediaTapManager.on('tap:started', ({ tapId, metadata }) => {
      console.log(`[PTT Server] Media tap started: ${tapId} (speaker: ${metadata.speaker_id})`);
    });
    mediaTapManager.on('tap:stopped', ({ tapId }) => {
      console.log(`[PTT Server] Media tap stopped: ${tapId}`);
    });
    console.log('[PTT Server] Media Tap manager initialized ✓');

    // 5. Setup Express middleware
    app.use(express.json());
    app.use((req, res, next) => {
      req.redisClient = redisClient;
      req.supabaseClient = supabase;
      req.mediaTapManager = mediaTapManager;
      next();
    });

    // 6. Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: Date.now(),
        services: {
          redis: redisClient?.isOpen ? 'connected' : 'disconnected',
          supabase: 'connected',
          mediasoup: sfuManager.workers.length > 0 ? 'initialized' : 'not initialized',
        },
      });
    });

    // 7. Register route handlers
    console.log('[PTT Server] Registering route handlers...');

    // Floor control routes (D2)
    app.use('/control', floorControlRoutes);

    // SFU transport routes (D3)
    app.use('/sfu', sfuTransportRoutes);

    // Media tap endpoint for transcript pushback from inference service
    app.post('/mediatap/transcript', async (req, res) => {
      try {
        const { tap_id, transcript } = req.body;
        if (!tap_id || !transcript) {
          return res.status(400).json({ error: 'Missing tap_id or transcript' });
        }
        await mediaTapManager.onTranscriptReceived(tap_id, transcript);
        res.json({ success: true });
      } catch (err) {
        console.error('[PTT Server] Transcript endpoint error:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // Get media tap status
    app.get('/mediatap/:tap_id', (req, res) => {
      const { tap_id } = req.params;
      const tap = mediaTapManager.getTap(tap_id);
      if (!tap) {
        return res.status(404).json({ error: 'Tap not found' });
      }
      res.json({
        tap_id,
        metadata: tap.metadata,
        session: tap.session,
      });
    });

    // 8. Setup WebSocket handler (D2)
    console.log('[PTT Server] Setting up WebSocket handler...');
    wss.on('connection', (ws, req) => {
      radioWebSocketHandler(ws, req, { redisClient, supabase });
    });

    console.log('[PTT Server] Route handlers registered ✓');

    // 9. Error handling
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[PTT Server] Unhandled rejection:', reason);
    });

    process.on('uncaughtException', (error) => {
      console.error('[PTT Server] Uncaught exception:', error);
      // In production: restart container
    });

    return { app, server, mediaTapManager };
  } catch (err) {
    console.error('[PTT Server] Initialization failed:', err);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log('[PTT Server] Shutting down...');

  try {
    // Close WebSocket server
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1000, 'Server shutting down');
      }
    });

    // Close HTTP server
    await new Promise((resolve) => {
      server.close(resolve);
    });

    // Close Mediasoup
    await sfuManager.close();

    // Disconnect Redis
    if (redisClient) {
      await redisClient.quit();
    }

    console.log('[PTT Server] Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[PTT Server] Shutdown error:', err);
    process.exit(1);
  }
}

/**
 * Start server
 */
async function start() {
  await initialize();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[PTT Server] Listening on port ${PORT} (http://0.0.0.0:${PORT}, ws://0.0.0.0:${PORT}/ws/radio)`
    );
    console.log('[PTT Server] Ready to accept connections');
  });

  // Handle signals
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Export for testing
module.exports = { initialize, shutdown, start };

// Start if run directly
if (require.main === module) {
  start();
}
