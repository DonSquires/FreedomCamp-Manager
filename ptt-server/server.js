/**
 * PTT SIGNALING SERVER
 * Push-to-Talk WebRTC signaling server for FieldOps Manager
 * 
 * This server provides:
 * 1. WebSocket-based signaling for WebRTC peer connections
 * 2. Channel management (org-scoped, incident, direct)
 * 3. Presence tracking (who's online, who's talking)
 * 4. Token validation for secure channel access
 * 
 * Deploy this to Railway alongside the existing proxy and inference services.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

// ---------------------------------------------------------------------------
// Security headers with helmet
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'wss:', 'ws:'], // Allow WebSocket connections
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for WebRTC
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
}));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PROXY_SECRET = process.env.PROXY_SECRET;
const PTT_JWT_SECRET = process.env.PTT_JWT_SECRET;
const MAX_PARTICIPANTS = parseInt(process.env.MAX_PARTICIPANTS_PER_CHANNEL || '50', 10);
const MAX_CLIP_DURATION = parseInt(process.env.MAX_CLIP_DURATION_SECONDS || '30', 10);
const TURN_URL = process.env.TURN_URL;
const TURN_USERNAME = process.env.TURN_USERNAME;
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL;

// ---------------------------------------------------------------------------
// In-memory state (production would use Redis for multi-instance)
// ---------------------------------------------------------------------------

/**
 * Active channels: Map<channelId, Set<WebSocket>>
 * Each channel holds connected WebSocket clients
 */
const channels = new Map();

/**
 * User presence: Map<userId, { channelId, status, lastSeen, ws }>
 */
const userPresence = new Map();

/**
 * Channel metadata: Map<channelId, { organizationId, type, speakerId, createdAt }>
 */
const channelMeta = new Map();

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
// PTT_RATE_LIMIT_PER_MIN controls requests per minute (default 120)
const RATE_LIMIT_MAX = parseInt(process.env.PTT_RATE_LIMIT_PER_MIN || '120', 10);
const rateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Rate limit exceeded. Please try again later.' },
});

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
function checkProxyAuth(req) {
  if (!PROXY_SECRET) {
    return { status: 503, body: { error: 'Service not configured', message: 'PROXY_SECRET not set.' } };
  }
  const authHeader = req.headers['x-proxy-secret'];
  if (!authHeader || authHeader !== PROXY_SECRET) {
    return { status: 401, body: { error: 'Unauthorized', message: 'Invalid proxy authentication' } };
  }
  return null;
}

/**
 * Verify a PTT channel token issued by the Edge Function
 */
function verifyChannelToken(token) {
  if (!PTT_JWT_SECRET) {
    return { valid: false, error: 'PTT_JWT_SECRET not configured' };
  }
  try {
    const payload = jwt.verify(token, PTT_JWT_SECRET);
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// CORS configuration - strict allowlist for production
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS_ENV = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const DEFAULT_ORIGINS = [
  'https://freedomcampmanager.onspace.build',
  'https://fcmanager.co.nz',
  'https://www.fcmanager.co.nz',
];

// In development, allow localhost
if (process.env.NODE_ENV !== 'production') {
  DEFAULT_ORIGINS.push('http://localhost:5173', 'http://localhost:3000');
}

const allowedOrigins = new Set([...DEFAULT_ORIGINS, ...ALLOWED_ORIGINS_ENV]);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Check exact match
    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    
    // Check for preview subdomain pattern
    try {
      const url = new URL(origin);
      if (url.host.endsWith('.onspace.build') && url.host.startsWith('preview-react-9b4t5o-')) {
        return callback(null, true);
      }
    } catch {}
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-proxy-secret', 'x-client-info', 'apikey'],
  maxAge: 86400, // 24 hours
};

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------
app.use(cors(corsOptions));
app.use(express.json());

// ---------------------------------------------------------------------------
// HTTP Endpoints
// ---------------------------------------------------------------------------

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'PTT Signaling Server',
    channels: channels.size,
    connectedUsers: userPresence.size,
  });
});

/**
 * Service info
 */
app.get('/api/info', (req, res) => {
  res.json({
    service: 'PTT Signaling Server',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      info: 'GET /api/info',
      mintToken: 'POST /api/token/mint',
      channelList: 'GET /api/channels',
      presenceList: 'GET /api/presence/:channelId',
    },
    websocket: {
      path: '/ws',
      protocol: 'wss://',
    },
    limits: {
      maxParticipantsPerChannel: MAX_PARTICIPANTS,
      maxClipDurationSeconds: MAX_CLIP_DURATION,
    },
    turnConfigured: !!(TURN_URL && TURN_USERNAME && TURN_CREDENTIAL),
  });
});

/**
 * Mint a channel access token (called by Supabase Edge Function)
 * Body: { userId, userRole, organizationId, channelScope }
 */
app.post('/api/token/mint', rateLimitMiddleware, (req, res) => {
  const authResult = checkProxyAuth(req);
  if (authResult) {
    return res.status(authResult.status).json(authResult.body);
  }

  if (!PTT_JWT_SECRET) {
    return res.status(503).json({
      error: 'Service not configured',
      message: 'PTT_JWT_SECRET not set',
    });
  }

  const { userId, userRole, organizationId, channelScope, firstName, lastName } = req.body;

  if (!userId || !organizationId || !channelScope) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'userId, organizationId, and channelScope are required',
    });
  }

  // Validate channel scope format - supports org, incident, direct, team, deployment
  const validScopePattern = /^(org|incident|direct|team|deployment):[a-f0-9-]+$/;
  if (!validScopePattern.test(channelScope)) {
    return res.status(400).json({
      error: 'Invalid channelScope',
      message: 'channelScope must be org:<uuid>, incident:<uuid>, direct:<uuid>, team:<uuid>, or deployment:<uuid>',
    });
  }

  // Generate token with 10-minute expiry
  // 10 minutes is long enough for channel connection establishment and reconnection,
  // but short enough that leaked tokens have limited exposure window
  const TOKEN_EXPIRY = '10m';
  const token = jwt.sign(
    {
      sub: userId,
      role: userRole,
      org: organizationId,
      channel: channelScope,
      name: `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown',
      iat: Math.floor(Date.now() / 1000),
    },
    PTT_JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

  // Include ICE servers if TURN is configured
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  if (TURN_URL && TURN_USERNAME && TURN_CREDENTIAL) {
    iceServers.push({
      urls: TURN_URL,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    });
  }

  res.json({
    token,
    channelScope,
    expiresIn: 600,
    iceServers,
  });
});

/**
 * List active channels (admin/master only via Edge Function)
 */
app.get('/api/channels', rateLimitMiddleware, (req, res) => {
  const authResult = checkProxyAuth(req);
  if (authResult) {
    return res.status(authResult.status).json(authResult.body);
  }

  const orgFilter = req.query.organizationId;
  const result = [];

  for (const [channelId, meta] of channelMeta.entries()) {
    if (orgFilter && meta.organizationId !== orgFilter) continue;
    const participants = channels.get(channelId)?.size || 0;
    result.push({
      channelId,
      organizationId: meta.organizationId,
      type: meta.type,
      participants,
      speakerId: meta.speakerId,
      createdAt: meta.createdAt,
    });
  }

  res.json({ channels: result });
});

/**
 * Get presence for a specific channel
 */
app.get('/api/presence/:channelId', rateLimitMiddleware, (req, res) => {
  const authResult = checkProxyAuth(req);
  if (authResult) {
    return res.status(authResult.status).json(authResult.body);
  }

  const { channelId } = req.params;
  const result = [];

  for (const [userId, presence] of userPresence.entries()) {
    if (presence.channelId === channelId) {
      result.push({
        userId,
        status: presence.status,
        name: presence.name,
        role: presence.role,
        lastSeen: presence.lastSeen,
      });
    }
  }

  res.json({ presence: result });
});

// ---------------------------------------------------------------------------
// HTTP Server + WebSocket
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/**
 * Broadcast a message to all clients in a channel except the sender
 */
function broadcastToChannel(channelId, message, excludeWs = null) {
  const clients = channels.get(channelId);
  if (!clients) return;

  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(data);
    }
  }
}

/**
 * WebSocket connection handler
 */
wss.on('connection', (ws, req) => {
  // Extract token from query string
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }

  const verification = verifyChannelToken(token);
  if (!verification.valid) {
    ws.close(4002, verification.error);
    return;
  }

  const { sub: userId, role, org: organizationId, channel: channelId, name } = verification.payload;

  // Check channel participant limit
  const existingClients = channels.get(channelId);
  if (existingClients && existingClients.size >= MAX_PARTICIPANTS) {
    ws.close(4003, 'Channel full');
    return;
  }

  // Initialize channel if needed
  if (!channels.has(channelId)) {
    channels.set(channelId, new Set());
    const [type] = channelId.split(':');
    channelMeta.set(channelId, {
      organizationId,
      type,
      speakerId: null,
      createdAt: new Date().toISOString(),
    });
  }

  // Add client to channel
  channels.get(channelId).add(ws);

  // Update presence
  userPresence.set(userId, {
    channelId,
    status: 'online',
    name,
    role,
    lastSeen: new Date().toISOString(),
    ws,
  });

  // Notify others of join
  broadcastToChannel(channelId, {
    type: 'presence',
    event: 'join',
    userId,
    name,
    role,
    timestamp: new Date().toISOString(),
  }, ws);

  // Send current presence to new joiner
  const currentPresence = [];
  for (const [uid, p] of userPresence.entries()) {
    if (p.channelId === channelId && uid !== userId) {
      currentPresence.push({ userId: uid, name: p.name, role: p.role, status: p.status });
    }
  }
  ws.send(JSON.stringify({
    type: 'sync',
    channelId,
    presence: currentPresence,
    speakerId: channelMeta.get(channelId)?.speakerId || null,
  }));

  console.log(`📡 User ${name} (${userId}) joined channel ${channelId}`);

  // Handle messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(ws, userId, channelId, name, role, message);
    } catch (err) {
      console.error('Invalid message:', err.message);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    // Remove from channel
    const clients = channels.get(channelId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        channels.delete(channelId);
        channelMeta.delete(channelId);
      }
    }

    // Clear speaking state if this user was speaking
    const meta = channelMeta.get(channelId);
    if (meta && meta.speakerId === userId) {
      meta.speakerId = null;
    }

    // Update presence
    userPresence.delete(userId);

    // Notify others
    broadcastToChannel(channelId, {
      type: 'presence',
      event: 'leave',
      userId,
      name,
      timestamp: new Date().toISOString(),
    });

    console.log(`📡 User ${name} (${userId}) left channel ${channelId}`);
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for ${userId}:`, err.message);
  });
});

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(ws, userId, channelId, name, role, message) {
  const meta = channelMeta.get(channelId);

  switch (message.type) {
    case 'start_speaking':
      // Half-duplex: only one speaker at a time
      if (meta && meta.speakerId && meta.speakerId !== userId) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'CHANNEL_BUSY',
          message: 'Another user is currently speaking',
          speakerId: meta.speakerId,
        }));
        return;
      }
      if (meta) meta.speakerId = userId;
      broadcastToChannel(channelId, {
        type: 'speaking',
        event: 'start',
        userId,
        name,
        timestamp: new Date().toISOString(),
      }, ws);
      console.log(`🎤 ${name} started speaking in ${channelId}`);
      break;

    case 'stop_speaking':
      if (meta && meta.speakerId === userId) {
        meta.speakerId = null;
      }
      broadcastToChannel(channelId, {
        type: 'speaking',
        event: 'stop',
        userId,
        name,
        clipUrl: message.clipUrl || null,
        duration: message.duration || null,
        timestamp: new Date().toISOString(),
      }, ws);
      console.log(`🎤 ${name} stopped speaking in ${channelId}`);
      break;

    case 'signal':
      // Forward WebRTC signaling (SDP/ICE) to target peer or broadcast
      if (message.targetUserId) {
        // Direct signal to specific peer
        const targetPresence = userPresence.get(message.targetUserId);
        if (targetPresence && targetPresence.ws && targetPresence.ws.readyState === 1) {
          targetPresence.ws.send(JSON.stringify({
            type: 'signal',
            fromUserId: userId,
            fromName: name,
            signal: message.signal,
          }));
        }
      } else {
        // Broadcast signal to all in channel
        broadcastToChannel(channelId, {
          type: 'signal',
          fromUserId: userId,
          fromName: name,
          signal: message.signal,
        }, ws);
      }
      break;

    case 'ping':
      // Heartbeat/keepalive
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      const presence = userPresence.get(userId);
      if (presence) presence.lastSeen = new Date().toISOString();
      break;

    case 'status':
      // Update user status (online, busy, offshift)
      const userPres = userPresence.get(userId);
      if (userPres && ['online', 'busy', 'offshift'].includes(message.status)) {
        userPres.status = message.status;
        broadcastToChannel(channelId, {
          type: 'presence',
          event: 'status',
          userId,
          name,
          status: message.status,
          timestamp: new Date().toISOString(),
        }, ws);
      }
      break;

    default:
      console.warn(`Unknown message type: ${message.type}`);
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   🎤 PTT Signaling Server            ║
  ╠═══════════════════════════════════════╣
  ║   Port: ${PORT.toString().padEnd(29)}║
  ║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(22)}║
  ║   JWT Secret: ${(PTT_JWT_SECRET ? '✓ Configured' : '✗ Not configured').padEnd(23)}║
  ║   TURN Server: ${(TURN_URL ? '✓ Configured' : '✗ Not configured').padEnd(22)}║
  ╚═══════════════════════════════════════╝
  `);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully...');
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, shutting down gracefully...');
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});
