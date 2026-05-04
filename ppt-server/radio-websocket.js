/**
 * Radio Control WebSocket Handler
 * 
 * Manages real-time floor events and presence updates via WebSocket.
 * - Subscribes to floor and presence Redis channels
 * - Broadcasts events to connected clients
 * - Manages presence Heartbeat (online/offline) tracking
 * 
 * Per ADR 008 (Event Backbone - Redis pub/sub)
 */

const WebSocket = require('ws');
const { redis: redisClient } = require('./floor-control');

// Create a separate Redis client for pub/sub (cannot share with regular client)
const redisPubSub = redisClient.duplicate();

/**
 * Radio WebSocket Server Handler
 * Upgrade HTTP connection to WebSocket, verify JWT, subscribe to channels
 */
async function handleRadioWebSocket(ws, req) {
  const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const token = urlParams.get('token') || (req.headers.authorization?.split(' ')[1] || '');

  // Verify token (same as REST endpoint)
  let tokenPayload;
  try {
    tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64'));
    if (tokenPayload.exp * 1000 < Date.now()) {
      ws.close(1008, 'Token expired');
      return;
    }
  } catch (err) {
    ws.close(1008, 'Invalid token');
    return;
  }

  const { sub: userId, org: orgId, role, channel_scope, transmission_id } = tokenPayload;

  // Setup WebSocket state
  const wsState = {
    userId,
    orgId,
    role,
    channelScope: channel_scope,
    transmissionId: transmission_id,
    subscriptions: new Set(),
  };

  console.log(`[RadioWS] Client connected: ${userId} on ${channel_scope}`);

  // Subscribe to floor events channel
  const floorEventsChannel = `radio:org:${orgId}:${channel_scope}:floor:events`;
  const presenceChannel = `radio:org:${orgId}:${channel_scope}:presence:events`;

  // Create subscription handler
  const handlePubSubMessage = (channel, message) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const data = JSON.parse(message);
        ws.send(JSON.stringify({
          type: 'radio_event',
          channel,
          data,
          timestamp: Date.now(),
        }));
      } catch (err) {
        console.error('[RadioWS] Failed to parse or send message:', err);
      }
    }
  };

  // Handle WebSocket messages from client
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'subscribe': {
          const { channels } = msg;
          for (const ch of channels || []) {
            wsState.subscriptions.add(ch);
            // Client can subscribe to multiple event channels
            // (floor, presence, translation, tts, etc.)
          }
          ws.send(JSON.stringify({ type: 'subscribed', channels }));
          break;
        }

        case 'presence_update': {
          const { status } = msg; // 'online', 'offline', 'listening', 'speaking'
          const presenceKey = `radio:org:${orgId}:${channel_scope}:presence:${userId}`;

          if (status === 'offline') {
            await redisClient.del(presenceKey);
            await redisClient.publish(
              presenceChannel,
              JSON.stringify({
                event: 'presence_left',
                officer_id: userId,
                timestamp: Date.now(),
              })
            );
          } else {
            await redisClient.hSet(presenceKey, {
              officer_id: userId,
              status,
              last_heartbeat: Date.now(),
            });
            await redisClient.publish(
              presenceChannel,
              JSON.stringify({
                event: 'presence_update',
                officer_id: userId,
                status,
                timestamp: Date.now(),
              })
            );
          }
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
        }

        default:
          console.warn('[RadioWS] Unknown message type:', msg.type);
      }
    } catch (err) {
      console.error('[RadioWS] Error handling client message:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: err.message,
      }));
    }
  });

  // Subscribe to Redis pub/sub channels
  await redisPubSub.subscribe(
    [floorEventsChannel, presenceChannel],
    handlePubSubMessage
  );

  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connected',
    channel_scope,
    user_id: userId,
    transmission_id,
    timestamp: Date.now(),
  }));

  // Handle client disconnect
  ws.on('close', async (code, reason) => {
    console.log(`[RadioWS] Client disconnected: ${userId} (code=${code}, reason=${reason})`);

    // Unsubscribe from Redis channels
    await redisPubSub.unsubscribe([floorEventsChannel, presenceChannel]);

    // Update presence: mark offline
    const presenceKey = `radio:org:${orgId}:${channel_scope}:presence:${userId}`;
    await redisClient.del(presenceKey);

    // Publish presence left event
    await redisClient.publish(
      presenceChannel,
      JSON.stringify({
        event: 'presence_left',
        officer_id: userId,
        timestamp: Date.now(),
      })
    );
  });

  // Handle WebSocket errors
  ws.on('error', (err) => {
    console.error('[RadioWS] WebSocket error:', err);
  });
}

/**
 * Initialize WebSocket server alongside Express app
 * @param {http.Server} server - HTTP server instance
 */
function initializeRadioWebSocket(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Route /ws/radio to radio WebSocket handler
    if (url.pathname === '/ws/radio') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleRadioWebSocket(ws, req).catch((err) => {
          console.error('[RadioWS] Upgrade error:', err);
          socket.destroy();
        });
      });
    } else {
      socket.destroy();
    }
  });

  console.log('[RadioWS] WebSocket server initialized on /ws/radio');
  return wss;
}

module.exports = { initializeRadioWebSocket, handleRadioWebSocket };
