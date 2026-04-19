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
app.set('trust proxy', 1);

// Reject downgraded requests when a reverse proxy forwards protocol headers.
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    const forwardedProto = req.headers['x-forwarded-proto'];
    if (forwardedProto && String(forwardedProto).toLowerCase() !== 'https') {
      return res.status(400).json({ error: 'HTTPS required', message: 'Plain HTTP requests are not accepted in production.' });
    }
  }
  next();
});

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
const PROXY_SECRET = process.env.PTT_PROXY_SECRET;
const PTT_JWT_SECRET = process.env.PTT_JWT_SECRET;
const MAX_PARTICIPANTS = parseInt(process.env.MAX_PARTICIPANTS_PER_CHANNEL || '50', 10);
const MAX_CLIP_DURATION = parseInt(process.env.MAX_CLIP_DURATION_SECONDS || '30', 10);
const TURN_URL = process.env.TURN_URL;
const TURN_USERNAME = process.env.TURN_USERNAME;
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL;
const FORCE_TURN_RELAY = String(process.env.FORCE_TURN_RELAY || '').toLowerCase() === 'true';
const PTT_DISABLE_PUBLIC_STUN = String(process.env.PTT_DISABLE_PUBLIC_STUN || '').toLowerCase() === 'true';
const TOKEN_TRACKER_RETENTION_MS = parseInt(process.env.PTT_TOKEN_TRACKER_RETENTION_MS || '300000', 10);
const PREVIEW_HOST_REGEX =
  process.env.PTT_ALLOWED_PREVIEW_ORIGIN_REGEX ||
  '^preview-[a-z0-9-]+\\.onspace\\.build$';
const PTT_PROTOCOL_VERSION = '2.0.0';
const INTEROP_PROFILE = 'fieldops-ptt-interop-v1';
const SUPPORTED_WS_PROTOCOLS = ['ptt.v2', 'ptt.v1'];
const SUPPORTED_SIGNAL_TYPES = ['offer', 'answer', 'candidate'];
const SUPPORTED_CHANNEL_TYPES = ['org', 'incident', 'direct', 'team', 'deployment'];
const SUPPORTED_AUDIO_CODECS = ['audio/opus'];
const PTT_MEDIA_MODE_RAW = String(process.env.PTT_MEDIA_MODE || 'peer').toLowerCase();
const PTT_MEDIA_MODE = PTT_MEDIA_MODE_RAW === 'sfu' ? 'sfu' : 'peer';
const PTT_SFU_PROVIDER = String(process.env.PTT_SFU_PROVIDER || '').trim();
const PTT_SFU_URL = String(process.env.PTT_SFU_URL || '').trim();

function getMediaPathConfig() {
  return {
    mode: PTT_MEDIA_MODE,
    signaling_path: 'app->railway->app',
    media_path: PTT_MEDIA_MODE === 'sfu' ? 'app->sfu->app' : 'webrtc-peer-or-turn-relay',
    sfu: PTT_MEDIA_MODE === 'sfu'
      ? {
          provider: PTT_SFU_PROVIDER || 'custom',
          url_configured: !!PTT_SFU_URL,
          url: PTT_SFU_URL || null,
        }
      : null,
  };
}

function parseTurnUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(',')
    .map((url) => normalizeTurnUrl(url))
    .filter(Boolean);
}

function normalizeTurnUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;

  const url = rawUrl.trim();
  if (!url) return null;

  if (url.startsWith('turn:') || url.startsWith('turns:') || url.startsWith('stun:') || url.startsWith('stuns:')) {
    return withPreferredTurnTransport(url);
  }

  // Railway often exposes the TURN relay as bare host:port. Browsers require
  // an explicit turn: URL scheme for RTCPeerConnection iceServers.
  return withPreferredTurnTransport(`turn:${url}`);
}

function withPreferredTurnTransport(url) {
  if (typeof url !== 'string') return url;
  if (!url.startsWith('turn:')) return url;
  if (url.includes('transport=')) return url;

  // Railway proxy endpoints are TCP fronted; force TCP allocations so TURN
  // doesn't try UDP by default (which fails behind the proxy).
  if (url.includes('.proxy.rlwy.net')) {
    return `${url}${url.includes('?') ? '&' : '?'}transport=tcp`;
  }

  return url;
}

function toStunUrl(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('turns:')) return url.replace(/^turns:/, 'stuns:').replace(/\?.*$/, '');
  if (url.startsWith('turn:')) return url.replace(/^turn:/, 'stun:').replace(/\?.*$/, '');
  return null;
}

function isTurnConfigured() {
  return !!(TURN_URL && TURN_USERNAME && TURN_CREDENTIAL);
}

function buildIceServers() {
  const iceServers = [];

  const turnUrls = parseTurnUrls(TURN_URL);
  const derivedStunUrls = turnUrls
    .map((url) => toStunUrl(url))
    .filter(Boolean);

  if (!FORCE_TURN_RELAY) {
    if (!PTT_DISABLE_PUBLIC_STUN) {
      iceServers.push({ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] });
    } else if (derivedStunUrls.length > 0) {
      iceServers.push({ urls: derivedStunUrls });
    }
  }

  if (isTurnConfigured()) {
    iceServers.push({
      urls: turnUrls,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    });
  }

  return iceServers;
}

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

/**
 * Token mint throttle: Map<userId, { mintedAt, channelScope }>
 */
const tokenMintTracker = new Map();

let tokenTrackerSweepInterval = null;

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
// PTT_RATE_LIMIT_PER_MIN controls requests per minute (default 120)
const RATE_LIMIT_MAX = parseInt(process.env.PTT_RATE_LIMIT_PER_MIN || '120', 10);
const TOKEN_MINT_COOLDOWN_MS = parseInt(process.env.PTT_TOKEN_MINT_COOLDOWN_MS || '3000', 10);
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

let previewHostPattern = null;
try {
  previewHostPattern = new RegExp(PREVIEW_HOST_REGEX, 'i');
} catch (err) {
  console.error('[ptt] Invalid PTT_ALLOWED_PREVIEW_ORIGIN_REGEX:', err.message);
}

function isAllowedPreviewOrigin(origin) {
  try {
    const url = new URL(origin);
    if (!url.host.endsWith('.onspace.build')) return false;
    if (!previewHostPattern) return false;
    return previewHostPattern.test(url.host);
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Check exact match
    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    
    if (isAllowedPreviewOrigin(origin)) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-proxy-secret', 'x-client-info', 'x-ptt-protocol', 'apikey'],
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
    turnConfigured: isTurnConfigured(),
    forceTurnRelay: FORCE_TURN_RELAY,
    mediaPath: getMediaPathConfig(),
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
      auth: {
        preferred: 'sec-websocket-protocol auth.<jwt>',
        fallback: 'query token',
      },
    },
    limits: {
      maxParticipantsPerChannel: MAX_PARTICIPANTS,
      maxClipDurationSeconds: MAX_CLIP_DURATION,
    },
    turnConfigured: isTurnConfigured(),
    forceTurnRelay: FORCE_TURN_RELAY,
    protocol: {
      version: PTT_PROTOCOL_VERSION,
      interopProfile: INTEROP_PROFILE,
      wsProtocols: SUPPORTED_WS_PROTOCOLS,
      signalTypes: SUPPORTED_SIGNAL_TYPES,
      channelTypes: SUPPORTED_CHANNEL_TYPES,
      audioCodecs: SUPPORTED_AUDIO_CODECS,
    },
    mediaPath: getMediaPathConfig(),
  });
});

/**
 * Interoperability capabilities for external/professional integrations.
 */
app.get('/api/capabilities', (req, res) => {
  res.json({
    service: 'PTT Signaling Server',
    timestamp: new Date().toISOString(),
    protocolVersion: PTT_PROTOCOL_VERSION,
    interopProfile: INTEROP_PROFILE,
    websocket: {
      path: '/ws',
      supportedProtocols: SUPPORTED_WS_PROTOCOLS,
      authModes: ['sec-websocket-protocol auth.<jwt>', 'query token'],
      messageTypes: ['server_hello', 'hello', 'hello_ack', 'sync', 'presence', 'speaking', 'signal', 'ping', 'pong', 'error'],
      signalTypes: SUPPORTED_SIGNAL_TYPES,
    },
    media: {
      codecs: SUPPORTED_AUDIO_CODECS,
      halfDuplex: true,
      maxClipDurationSeconds: MAX_CLIP_DURATION,
      turnConfigured: isTurnConfigured(),
      forceTurnRelay: FORCE_TURN_RELAY,
      path: getMediaPathConfig(),
    },
    channels: SUPPORTED_CHANNEL_TYPES,
  });
});

/**
 * Runtime diagnostics for deployment verification.
 */
app.get('/api/diagnostics', (req, res) => {
  res.json({
    service: 'PTT Signaling Server',
    timestamp: new Date().toISOString(),
    channels: channels.size,
    connectedUsers: userPresence.size,
    transport: {
      turnConfigured: isTurnConfigured(),
      forceTurnRelay: FORCE_TURN_RELAY,
      iceTransportPolicy: FORCE_TURN_RELAY ? 'relay' : 'all',
      hasTurnCredentials: !!(TURN_USERNAME && TURN_CREDENTIAL),
    },
    mediaPath: getMediaPathConfig(),
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

  const now = Date.now();
  const lastMint = tokenMintTracker.get(userId) || null;
  const mintedAt = typeof lastMint?.mintedAt === 'number' ? lastMint.mintedAt : 0;
  const mintedChannelScope = typeof lastMint?.channelScope === 'string' ? lastMint.channelScope : null;

  // Allow quick channel switching while still protecting repeated token mint
  // requests for the same channel during reconnect churn.
  if (mintedAt && mintedChannelScope === channelScope && now - mintedAt < TOKEN_MINT_COOLDOWN_MS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((TOKEN_MINT_COOLDOWN_MS - (now - mintedAt)) / 1000));
    return res.status(429).json({
      error: 'Token mint rate limited',
      message: 'A recent Push to Talk token was already issued for this user. Retry shortly.',
      retryAfter: retryAfterSeconds,
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
  tokenMintTracker.set(userId, { mintedAt: now, channelScope });

  if (FORCE_TURN_RELAY && !isTurnConfigured()) {
    return res.status(503).json({
      error: 'TURN relay required',
      message: 'FORCE_TURN_RELAY is enabled but TURN_URL/TURN_USERNAME/TURN_CREDENTIAL are missing',
    });
  }

  const iceServers = buildIceServers();

  res.json({
    token,
    channelScope,
    expiresIn: 600,
    iceServers,
    iceTransportPolicy: FORCE_TURN_RELAY ? 'relay' : 'all',
    transport: {
      turnConfigured: isTurnConfigured(),
      forceTurnRelay: FORCE_TURN_RELAY,
    },
    signaling: {
      protocolVersion: PTT_PROTOCOL_VERSION,
      interopProfile: INTEROP_PROFILE,
      wsProtocols: SUPPORTED_WS_PROTOCOLS,
    },
    mediaPath: getMediaPathConfig(),
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
 * Remove non-open sockets from a channel set and clean empty channel metadata.
 */
function pruneChannelClients(channelId) {
  const clients = channels.get(channelId);
  if (!clients) return 0;

  for (const client of clients) {
    if (!client || client.readyState !== 1) {
      clients.delete(client);
    }
  }

  if (clients.size === 0) {
    channels.delete(channelId);
    channelMeta.delete(channelId);
    return 0;
  }

  return clients.size;
}

function extractTokenFromWebSocketRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const queryToken = url.searchParams.get('token');
  const protocolHeader = req.headers['sec-websocket-protocol'];
  let selectedProtocol = 'ptt.v1';

  if (typeof protocolHeader !== 'string' || protocolHeader.trim().length === 0) {
    return { token: queryToken, requestedProtocol: selectedProtocol };
  }

  const protocols = protocolHeader
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const supported = protocols.find((value) => SUPPORTED_WS_PROTOCOLS.includes(value));
  if (supported) {
    selectedProtocol = supported;
  }

  const authProtocol = protocols.find((value) => value.startsWith('auth.'));
  if (!authProtocol) {
    return { token: queryToken, requestedProtocol: selectedProtocol };
  }

  return { token: authProtocol.slice('auth.'.length), requestedProtocol: selectedProtocol };
}

function startTokenTrackerSweep() {
  if (tokenTrackerSweepInterval) return;

  tokenTrackerSweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [userId, mintState] of tokenMintTracker.entries()) {
      const mintedAt = typeof mintState?.mintedAt === 'number' ? mintState.mintedAt : 0;
      if (!mintedAt || now - mintedAt > TOKEN_TRACKER_RETENTION_MS) {
        tokenMintTracker.delete(userId);
      }
    }
  }, 60_000);
}

/**
 * WebSocket connection handler
 */
wss.on('connection', (ws, req) => {
  // Prefer subprotocol auth.<jwt>, fallback to query token for backward compatibility.
  const wsAuth = extractTokenFromWebSocketRequest(req);
  const token = wsAuth?.token;

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
  ws.pttProtocol = wsAuth.requestedProtocol || 'ptt.v1';

  ws.send(JSON.stringify({
    type: 'server_hello',
    protocolVersion: PTT_PROTOCOL_VERSION,
    interopProfile: INTEROP_PROFILE,
    selectedProtocol: ws.pttProtocol,
    supportedProtocols: SUPPORTED_WS_PROTOCOLS,
    capabilities: {
      signalTypes: SUPPORTED_SIGNAL_TYPES,
      channelTypes: SUPPORTED_CHANNEL_TYPES,
      codecs: SUPPORTED_AUDIO_CODECS,
      halfDuplex: true,
    },
    timestamp: new Date().toISOString(),
  }));

  // Remove dead sockets before checking channel capacity.
  pruneChannelClients(channelId);

  // If this user reconnects before the old socket closes, replace stale session.
  const existingPresence = userPresence.get(userId);
  if (existingPresence && existingPresence.ws && existingPresence.ws !== ws) {
    const previousChannelId = existingPresence.channelId;
    const previousClients = channels.get(previousChannelId);
    if (previousClients) {
      previousClients.delete(existingPresence.ws);
      if (previousClients.size === 0) {
        channels.delete(previousChannelId);
        channelMeta.delete(previousChannelId);
      }
    }

    try {
      existingPresence.ws.close(4000, 'Replaced by a newer session');
    } catch (_err) {
      // Ignore close errors for already-closing sockets.
    }

    if (previousChannelId === channelId) {
      broadcastToChannel(channelId, {
        type: 'presence',
        event: 'leave',
        userId,
        name: existingPresence.name || name,
        timestamp: new Date().toISOString(),
      });
    }
  }

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
    transport: {
      turnConfigured: isTurnConfigured(),
      forceTurnRelay: FORCE_TURN_RELAY,
      iceTransportPolicy: FORCE_TURN_RELAY ? 'relay' : 'all',
    },
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

    // Update presence only if this socket is still the active one for the user.
    const currentPresence = userPresence.get(userId);
    if (currentPresence?.ws === ws) {
      userPresence.delete(userId);
    }

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
    case 'hello':
      ws.send(JSON.stringify({
        type: 'hello_ack',
        protocolVersion: PTT_PROTOCOL_VERSION,
        interopProfile: INTEROP_PROFILE,
        selectedProtocol: ws.pttProtocol || 'ptt.v1',
        accepted: true,
        timestamp: new Date().toISOString(),
      }));
      break;

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
        if (
          targetPresence &&
          targetPresence.channelId === channelId &&
          targetPresence.ws &&
          targetPresence.ws.readyState === 1
        ) {
          targetPresence.ws.send(JSON.stringify({
            type: 'signal',
            fromUserId: userId,
            fromName: name,
            signal: message.signal,
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            code: 'SIGNAL_TARGET_UNAVAILABLE',
            message: 'Target peer is not available in this channel',
            targetUserId: message.targetUserId,
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
  startTokenTrackerSweep();
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   🎤 PTT Signaling Server            ║
  ╠═══════════════════════════════════════╣
  ║   Port: ${PORT.toString().padEnd(29)}║
  ║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(22)}║
  ║   JWT Secret: ${(PTT_JWT_SECRET ? '✓ Configured' : '✗ Not configured').padEnd(23)}║
  ║   TURN Server: ${(isTurnConfigured() ? '✓ Configured' : '✗ Not configured').padEnd(22)}║
  ║   Force TURN Relay: ${(FORCE_TURN_RELAY ? '✓ Enabled' : '○ Disabled').padEnd(17)}║
  ╚═══════════════════════════════════════╝
  `);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully...');
  if (tokenTrackerSweepInterval) clearInterval(tokenTrackerSweepInterval);
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, shutting down gracefully...');
  if (tokenTrackerSweepInterval) clearInterval(tokenTrackerSweepInterval);
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});
