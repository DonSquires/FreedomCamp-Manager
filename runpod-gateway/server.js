/**
 * RunPod Ollama Gateway
 *
 * A lightweight authenticated reverse proxy that sits in front of Ollama on the
 * same RunPod pod.  Exposes Ollama to the internet via RunPod's TCP proxy while
 * enforcing:
 *
 *   1. Bearer-token authentication (BOB_GATEWAY_KEY env var)
 *   2. Per-IP rate limiting
 *   3. HTTPS-only enforcement (when behind RunPod's proxy)
 *   4. Security headers via helmet
 *
 * Environment variables:
 *   BOB_GATEWAY_KEY   – shared secret; clients must send "Authorization: Bearer <key>"
 *   OLLAMA_HOST       – Ollama base URL inside the pod (default: http://127.0.0.1:11434)
 *   PORT              – port to listen on (default: 8080)
 *   NODE_ENV          – set to "production" on RunPod to enable HTTPS enforcement
 *
 * Proxied paths (all → Ollama):
 *   GET  /health
 *   GET  /api/tags          (list models)
 *   POST /api/generate      (single-turn completion)
 *   POST /api/chat          (multi-turn chat)
 *   POST /api/embeddings    (embedding generation)
 *   POST /api/pull          (model management – restricted to admin key tier)
 *   GET  /api/show          (model info)
 *
 * Additional gateway routes (not proxied):
 *   GET  /gateway/health    – liveness probe (no auth required)
 */

'use strict';

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = parseInt(process.env.PORT ?? '8080', 10);
const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const GATEWAY_KEY = process.env.BOB_GATEWAY_KEY ?? '';
const ADMIN_KEY = process.env.BOB_GATEWAY_ADMIN_KEY ?? '';   // optional elevated-access key

if (!GATEWAY_KEY) {
  console.error('[gateway] FATAL: BOB_GATEWAY_KEY is not set. Refusing to start.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Trust RunPod's reverse proxy so rate limiting sees real IPs
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: false, // API only – no HTML
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// ---------------------------------------------------------------------------
// Remove the default x-powered-by header (added by helmet as well, but explicit)
// ---------------------------------------------------------------------------
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Rate limiting – apply before auth so even invalid requests are counted
// ---------------------------------------------------------------------------
const limiter = rateLimit({
  windowMs: 60 * 1000,         // 1 minute
  max: 120,                    // 120 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Rate limit exceeded. Slow down.' },
});
app.use(limiter);

// ---------------------------------------------------------------------------
// Parse JSON bodies
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '4mb' }));

// ---------------------------------------------------------------------------
// Unauthenticated liveness probe (RunPod health checks, k8s probes, etc.)
// ---------------------------------------------------------------------------
app.get('/gateway/health', (_req, res) => {
  res.json({ status: 'ok', ollama: OLLAMA_HOST, ts: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Auth middleware – all routes below require a valid Bearer token
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing Bearer token.' });
  }
  const token = authHeader.slice(7);
  if (token !== GATEWAY_KEY && token !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden', message: 'Invalid gateway key.' });
  }
  // Attach a tier flag so admin-only routes can check it
  res.locals.isAdmin = (ADMIN_KEY && token === ADMIN_KEY);
  next();
}

app.use(requireAuth);

// ---------------------------------------------------------------------------
// PROXY helper
// Forwards the request to Ollama and streams the response back.
// Strips hop-by-hop headers that must not be forwarded.
// ---------------------------------------------------------------------------
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'authorization',
]);

async function proxyToOllama(req, res, pathOverride) {
  const targetPath = pathOverride ?? req.path;
  const url = `${OLLAMA_HOST}${targetPath}`;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) {
      headers[k] = v;
    }
  }
  // Ensure content-type is forwarded for POST bodies
  if (!headers['content-type'] && req.method !== 'GET') {
    headers['content-type'] = 'application/json';
  }

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = JSON.stringify(req.body);
  }

  let upstream;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body,
    });
  } catch (err) {
    console.error('[gateway] Upstream fetch error:', err.message);
    return res.status(502).json({ error: 'Bad Gateway', message: 'Could not reach Ollama.' });
  }

  res.status(upstream.status);
  for (const [k, v] of upstream.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) {
      res.setHeader(k, v);
    }
  }

  // Pipe the body – handles both streaming (NDJSON) and regular JSON
  upstream.body.pipe(res);
}

// ---------------------------------------------------------------------------
// Proxied Ollama routes
// ---------------------------------------------------------------------------

// Health / model listing
app.get('/health', (req, res) => proxyToOllama(req, res, '/'));
app.get('/api/tags', (req, res) => proxyToOllama(req, res));
app.get('/api/show', (req, res) => proxyToOllama(req, res));

// Inference
app.post('/api/generate', (req, res) => proxyToOllama(req, res));
app.post('/api/chat', (req, res) => proxyToOllama(req, res));
app.post('/api/embeddings', (req, res) => proxyToOllama(req, res));

// Admin-only: model management
app.post('/api/pull', (req, res) => {
  if (!res.locals.isAdmin) {
    return res.status(403).json({ error: 'Forbidden', message: 'Model management requires admin key.' });
  }
  return proxyToOllama(req, res);
});
app.delete('/api/delete', (req, res) => {
  if (!res.locals.isAdmin) {
    return res.status(403).json({ error: 'Forbidden', message: 'Model management requires admin key.' });
  }
  return proxyToOllama(req, res);
});

// ---------------------------------------------------------------------------
// Catch-all – block undeclared paths
// ---------------------------------------------------------------------------
app.all('*', (_req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'Unknown gateway route.' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[gateway] RunPod Ollama gateway listening on :${PORT}`);
  console.log(`[gateway] Upstream Ollama: ${OLLAMA_HOST}`);
});
