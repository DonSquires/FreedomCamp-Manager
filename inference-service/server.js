/**
 * ORC/AI Inference Service
 * Vehicle Detection + Embedding Generation + Face Recognition
 * 
 * Stack:
 * - YOLOv8n (vehicle detection)
 * - MobileNetV3 (feature embedding)
 * - UltraFace (face detection — optional)
 * - ONNX Runtime (inference engine)
 * 
 * API Endpoints:
 * - POST /infer      - Generate vehicle embedding from photo
 * - POST /infer/alpr - Self-hosted ALPR
 * - POST /infer/chalk - Chalk pass AI
 * - POST /infer/face  - Face detection + embedding
 * - POST /infer/compare - Cosine similarity
 * - GET  /health     - Health check
 */

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { createSelfLearningService } = require('./lib/self-learning');
const { buildSelfHealingPlan, buildPatchTask, getKnowledgePacks } = require('./lib/assistant-knowledge');
const { createIntelStore } = require('./lib/intel-updates');

const app = express();
const PORT = process.env.PORT || 3000;
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
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for AI model processing
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
}));

// ── Rate limiters ────────────────────────────────────────────────────────────
// Inference endpoints are compute-intensive; limit per IP to prevent DoS.
// Authenticated routes are bound to the same window so an attacker who
// obtains a token still cannot flood the service.
const inferenceRateLimit = rateLimit({
  windowMs:         60 * 1000,          // 1 minute window
  max:              Number(process.env.INFER_RATE_LIMIT_RPM   ?? 30),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many inference requests — please slow down' },
});

const alprRateLimit = rateLimit({
  windowMs:         60 * 1000,
  max:              Number(process.env.ALPR_RATE_LIMIT_RPM    ?? 60),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many ALPR requests — please slow down' },
});

const tabularRateLimit = rateLimit({
  windowMs:         60 * 1000,
  max:              Number(process.env.TABULAR_RATE_LIMIT_RPM ?? 20),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many tabular analysis requests — please slow down' },
});
const faceRateLimit = rateLimit({
  windowMs:         60 * 1000,
  max:              Number(process.env.FACE_RATE_LIMIT_RPM ?? 30),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many face detection requests — please slow down' },
});

function normalizeProvider(value, fallback) {
  const provider = String(value || fallback || '').toLowerCase().trim();
  if (provider === 'chatgpt') return 'openai';
  return provider || fallback;
}

const YOLO_INPUT_SIZE = 640;
const VEHICLE_ATTRS_PROVIDER_RAW = (process.env.VEHICLE_ATTRS_PROVIDER || 'basic').toLowerCase();
const VEHICLE_ATTRS_PROVIDER = normalizeProvider(VEHICLE_ATTRS_PROVIDER_RAW, 'basic');
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ATTR_TIMEOUT_MS = Number(process.env.ATTR_TIMEOUT_MS || 2500);
const TABULAR_NLP_PROVIDER_RAW = (process.env.TABULAR_NLP_PROVIDER || 'heuristic').toLowerCase();
const TABULAR_NLP_PROVIDER = normalizeProvider(TABULAR_NLP_PROVIDER_RAW, 'heuristic');
const CHAT_PROVIDER_RAW = (process.env.CHAT_PROVIDER || 'ollama').toLowerCase();
const CHAT_PROVIDER = normalizeProvider(CHAT_PROVIDER_RAW, 'heuristic');
const CHAT_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 30000);
const TABULAR_NLP_TIMEOUT_MS = Number(process.env.TABULAR_NLP_TIMEOUT_MS || 2500);
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const SELF_CONTAINED_MODE = ['1', 'true', 'yes', 'on'].includes((process.env.SELF_CONTAINED_MODE || '').toLowerCase());
const REQUIRE_SELF_CONTAINED_MODE = ['1', 'true', 'yes', 'on'].includes((process.env.REQUIRE_SELF_CONTAINED_MODE || '').toLowerCase());
const SELF_LEARNING_ENABLED = !['0', 'false', 'no', 'off'].includes((process.env.SELF_LEARNING_ENABLED || 'true').toLowerCase());
const SELF_HEALING_ENABLED = !['0', 'false', 'no', 'off'].includes((process.env.SELF_HEALING_ENABLED || 'true').toLowerCase());
const INTEL_STATE_PATH = process.env.INTEL_STATE_PATH || path.join(__dirname, 'data', 'intel-state.json');
const INTEL_HMAC_KEY = process.env.INTEL_HMAC_KEY || '';
const SELF_LEARNING_STATE_PATH = process.env.SELF_LEARNING_STATE_PATH || path.join(__dirname, 'data', 'self-learning-state.json');
const SIMILARITY_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD || 0.85);
const SIMILARITY_THRESHOLD_MIN = Number(process.env.SIMILARITY_THRESHOLD_MIN || 0.65);
const SIMILARITY_THRESHOLD_MAX = Number(process.env.SIMILARITY_THRESHOLD_MAX || 0.95);
const SELF_LEARNING_RATE = Number(process.env.SELF_LEARNING_RATE || 0.025);
const INFERENCE_API_KEY = process.env.INFERENCE_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_JWKS_URL = process.env.SUPABASE_JWKS_URL || (SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` : '');
const SUPABASE_JWT_ISSUER = process.env.SUPABASE_JWT_ISSUER || (SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : '');
const SUPABASE_JWT_AUDIENCE = process.env.SUPABASE_JWT_AUDIENCE || '';
// Service role key — allows Supabase edge functions to authenticate as trusted
// service-to-service callers without requiring a separate INFERENCE_API_KEY.
// Set SUPABASE_SERVICE_ROLE_KEY on Railway to the same value as the Supabase
// project's service role key.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function isLocalUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  } catch {
    return false;
  }
}

const SELF_CONTAINED_STRICT_EGRESS = SELF_CONTAINED_MODE && !['0', 'false', 'no', 'off'].includes((process.env.SELF_CONTAINED_STRICT_EGRESS || 'true').toLowerCase());

function assertEgressAllowed(url, providerLabel = 'unknown') {
  if (!SELF_CONTAINED_STRICT_EGRESS) return;
  // Ollama is a self-hosted private LLM service — never considered outbound cloud egress.
  if (providerLabel === 'ollama') return;
  if (!isLocalUrl(url)) {
    recordEgressEvent(providerLabel, 'blocked', `Strict self-contained egress policy blocked URL: ${url}`);
    throw new Error(`Outbound network blocked in SELF_CONTAINED_MODE: ${url}`);
  }
}

async function safeFetch(url, options, providerLabel = 'unknown') {
  assertEgressAllowed(url, providerLabel);
  return fetch(url, options);
}

const OPENAI_ENABLED = !SELF_CONTAINED_MODE && !!OPENAI_API_KEY;
const CLOUD_ALPR_ENABLED = !SELF_CONTAINED_MODE && !!process.env.PLATERECOGNIZER_TOKEN;
// Ollama is a self-hosted LLM service — allowed regardless of SELF_CONTAINED_MODE
// because it never routes traffic to external cloud providers.
const OLLAMA_ENABLED = TABULAR_NLP_PROVIDER === 'ollama' || CHAT_PROVIDER === 'ollama';

const selfLearningService = createSelfLearningService({
  enabled: SELF_LEARNING_ENABLED,
  statePath: SELF_LEARNING_STATE_PATH,
  initialThreshold: SIMILARITY_THRESHOLD,
  minThreshold: SIMILARITY_THRESHOLD_MIN,
  maxThreshold: SIMILARITY_THRESHOLD_MAX,
  learningRate: SELF_LEARNING_RATE,
});

const intelStore = createIntelStore({
  statePath: INTEL_STATE_PATH,
  hmacKey: INTEL_HMAC_KEY,
});

const egressAudit = {
  started_at: new Date().toISOString(),
  self_contained_mode: SELF_CONTAINED_MODE,
  counts: {
    openai_attempted: 0,
    openai_blocked: 0,
    cloud_alpr_attempted: 0,
    cloud_alpr_blocked: 0,
    ollama_attempted: 0,
    ollama_blocked: 0,
  },
  last_event: null,
};

function recordEgressEvent(provider, outcome, details = null) {
  const event = {
    at: new Date().toISOString(),
    provider,
    outcome,
    details,
  };
  egressAudit.last_event = event;

  if (provider === 'openai') {
    if (outcome === 'attempted') egressAudit.counts.openai_attempted += 1;
    if (outcome === 'blocked') egressAudit.counts.openai_blocked += 1;
  }
  if (provider === 'cloud_alpr') {
    if (outcome === 'attempted') egressAudit.counts.cloud_alpr_attempted += 1;
    if (outcome === 'blocked') egressAudit.counts.cloud_alpr_blocked += 1;
  }
  if (provider === 'ollama') {
    if (outcome === 'attempted') egressAudit.counts.ollama_attempted += 1;
    if (outcome === 'blocked') egressAudit.counts.ollama_blocked += 1;
  }
}

let joseRuntimePromise = null;
let supabaseJwks = null;

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
    // Allow requests with no origin (like mobile apps, edge functions, or curl)
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
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-inference-api-key', 'x-client-info', 'apikey'],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

function getBearerToken(req) {
  const authHeader = req.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

async function getJoseRuntime() {
  if (!joseRuntimePromise) {
    joseRuntimePromise = import('jose').then(({ createRemoteJWKSet, jwtVerify }) => ({
      createRemoteJWKSet,
      jwtVerify,
    }));
  }
  return joseRuntimePromise;
}

async function verifySupabaseJwt(token) {
  if (SELF_CONTAINED_STRICT_EGRESS) {
    throw new Error('Supabase JWKS verification is disabled in strict self-contained mode');
  }
  if (!SUPABASE_JWKS_URL) {
    throw new Error('SUPABASE_JWKS_URL is not configured');
  }

  const { createRemoteJWKSet, jwtVerify } = await getJoseRuntime();
  if (!supabaseJwks) {
    supabaseJwks = createRemoteJWKSet(new URL(SUPABASE_JWKS_URL));
  }

  const verifyOptions = {};
  if (SUPABASE_JWT_ISSUER) verifyOptions.issuer = SUPABASE_JWT_ISSUER;
  if (SUPABASE_JWT_AUDIENCE) verifyOptions.audience = SUPABASE_JWT_AUDIENCE;

  const { payload } = await jwtVerify(token, supabaseJwks, verifyOptions);
  return payload;
}

async function requireInferenceAuth(req, res, next) {
  try {
    const apiKeyCandidate = req.get('x-inference-api-key') || getBearerToken(req);
    if (INFERENCE_API_KEY && apiKeyCandidate && apiKeyCandidate === INFERENCE_API_KEY) {
      req.inferenceAuth = { method: 'api_key' };
      return next();
    }

    // Accept the Supabase service role key as a trusted service-to-service token.
    // Edge functions always have SUPABASE_SERVICE_ROLE_KEY available and can send
    // it as Authorization: Bearer <key> to authenticate against this service.
    if (SUPABASE_SERVICE_ROLE_KEY && apiKeyCandidate && apiKeyCandidate === SUPABASE_SERVICE_ROLE_KEY) {
      req.inferenceAuth = { method: 'service_role' };
      return next();
    }

    const bearerToken = getBearerToken(req);
    if (bearerToken && SUPABASE_JWKS_URL) {
      const jwtPayload = await verifySupabaseJwt(bearerToken);
      req.inferenceAuth = {
        method: 'supabase_jwt',
        sub: jwtPayload?.sub || null,
        role: jwtPayload?.role || jwtPayload?.user_role || null,
      };
      return next();
    }

    const authConfigured = Boolean(INFERENCE_API_KEY || SUPABASE_SERVICE_ROLE_KEY || SUPABASE_JWKS_URL);
    if (!authConfigured) {
      return next();
    }

    return res.status(401).json({ error: 'Unauthorized inference request' });
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized inference request', details: error.message });
  }
}

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPEG, PNG, WEBP allowed.'));
    }
    cb(null, true);
  }
});

// Load ONNX models
let yoloSession = null;
let embeddingSession = null;

async function loadModels() {
  console.log('Loading ONNX models...');
  
  try {
    // YOLOv8n for vehicle detection
    yoloSession = await ort.InferenceSession.create('./models/yolov8n.onnx', {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all'
    });
    console.log('✅ YOLOv8n loaded');

    // MobileNetV3 for embeddings
    embeddingSession = await ort.InferenceSession.create('./models/mobilenet_v3.onnx', {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all'
    });
    console.log('✅ MobileNetV3 loaded');

  } catch (error) {
    console.error('❌ Model loading failed (service will run in degraded mode):', error.message);
    if (error.stack) console.error(error.stack);
    console.warn('🧠 Models: NOT LOADED — running in degraded mode (plate scan still works via Plate Recognizer API)');
  }
}

// Preprocess image for YOLO (640x640)
async function preprocessForYOLO(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .resize(640, 640, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Convert to Float32Array and normalize [0-255] -> [0-1]
  const float32Data = new Float32Array(3 * 640 * 640);
  for (let i = 0; i < data.length; i += 3) {
    float32Data[i] = data[i] / 255.0;       // R
    float32Data[i + 1] = data[i + 1] / 255.0; // G
    float32Data[i + 2] = data[i + 2] / 255.0; // B
  }

  // Convert HWC to CHW format
  const chw = new Float32Array(3 * 640 * 640);
  for (let c = 0; c < 3; c++) {
    for (let h = 0; h < 640; h++) {
      for (let w = 0; w < 640; w++) {
        chw[c * 640 * 640 + h * 640 + w] = float32Data[(h * 640 + w) * 3 + c];
      }
    }
  }

  return new ort.Tensor('float32', chw, [1, 3, 640, 640]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function parseYear(value) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 1950 || n > 2100) return null;
  return n;
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function detectDateFormatHeuristic(sampleRows) {
  let slashDdMm = 0;
  let slashMmDd = 0;
  let isoLike = 0;
  let excelSerial = 0;

  for (const row of sampleRows) {
    const candidate = Array.isArray(row) ? row[2] : null;

    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      if (candidate > 20000 && candidate < 90000) {
        excelSerial++;
      }
      continue;
    }

    if (typeof candidate !== 'string') continue;
    const dateText = candidate.trim();
    if (!dateText) continue;

    if (/^\d{4}-\d{2}-\d{2}/.test(dateText)) {
      isoLike++;
      continue;
    }

    if (dateText.includes('/')) {
      const parts = dateText.split('/');
      if (parts.length !== 3) continue;

      const a = Number.parseInt(parts[0], 10);
      const b = Number.parseInt(parts[1], 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

      if (a > 12 && b <= 12) {
        slashDdMm += 2;
      } else if (b > 12 && a <= 12) {
        slashMmDd += 2;
      } else {
        // ambiguous: NZ defaults are DD/MM/YYYY
        slashDdMm += 1;
      }
    }
  }

  const totalSignals = slashDdMm + slashMmDd + isoLike + excelSerial;
  if (totalSignals === 0) {
    return { dateFormat: 'unknown', confidence: 0.4, evidence: { slashDdMm, slashMmDd, isoLike, excelSerial } };
  }

  const scored = [
    { dateFormat: 'dd/mm/yyyy', score: slashDdMm },
    { dateFormat: 'mm/dd/yyyy', score: slashMmDd },
    { dateFormat: 'yyyy-mm-dd', score: isoLike },
    { dateFormat: 'excel_serial', score: excelSerial },
  ].sort((a, b) => b.score - a.score);

  const top = scored[0];
  const confidence = Math.max(0.5, Math.min(0.98, top.score / totalSignals));
  return {
    dateFormat: top.dateFormat,
    confidence,
    evidence: { slashDdMm, slashMmDd, isoLike, excelSerial },
  };
}

function analyzeTabularDataHeuristic(sampleRows) {
  const rows = Array.isArray(sampleRows) ? sampleRows : [];
  const dataRows = rows.slice(1);
  const scanRows = dataRows.slice(0, 200);

  const dateDetection = detectDateFormatHeuristic(rows.slice(0, 40));

  let blankDates = 0;
  let blankZones = 0;
  let blankPlates = 0;
  let blankNotes = 0;
  const dateStrings = [];

  for (const row of scanRows) {
    if (!Array.isArray(row)) continue;

    const zone = row[1];
    const date = row[2];
    const plate = row[3];
    const notes = row[4];

    if (zone === null || zone === undefined || String(zone).trim() === '') blankZones++;
    if (plate === null || plate === undefined || String(plate).trim() === '') blankPlates++;
    if (notes === null || notes === undefined || String(notes).trim() === '' || String(notes).toLowerCase() === 'nan') blankNotes++;
    if (date === null || date === undefined || String(date).trim() === '') {
      blankDates++;
    } else {
      dateStrings.push(String(date).trim());
    }
  }

  const recommendations = [];
  if (blankDates > 0) recommendations.push('Rows with blank dates will be skipped');
  if (blankZones > 0) recommendations.push('Rows with blank zone names will fail zone matching');
  if (blankPlates > 0) recommendations.push('Rows with blank plate values will be skipped');
  if (dateDetection.dateFormat === 'unknown') recommendations.push('Date format was ambiguous; DD/MM/YYYY fallback is recommended for NZ datasets');

  return {
    dateFormat: dateDetection.dateFormat,
    dateFormatConfidence: dateDetection.confidence,
    earliestDate: null,
    latestDate: null,
    totalRowsAnalyzed: scanRows.length,
    blankDates,
    blankZones,
    blankPlates,
    blankNotes,
    dataQualityIssues: recommendations,
    recommendations,
    provider: 'heuristic',
    evidence: dateDetection.evidence,
  };
}

async function analyzeTabularDataWithOllama(sampleRows) {
  const heuristic = analyzeTabularDataHeuristic(sampleRows);

  if (!OLLAMA_ENABLED) {
    recordEgressEvent('ollama', 'blocked', 'SELF_CONTAINED_MODE with non-local OLLAMA_BASE_URL');
    return heuristic;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TABULAR_NLP_TIMEOUT_MS);
  try {
    recordEgressEvent('ollama', 'attempted', 'analyzeTabularDataWithOllama');
    const response = await safeFetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        messages: [
          {
            role: 'system',
            content: 'Return only strict JSON. You are analyzing tabular NZ historical records.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'Analyze date format and quality in this table sample',
              sampleRows: Array.isArray(sampleRows) ? sampleRows.slice(0, 40) : [],
              expectedResponseShape: {
                dateFormat: 'dd/mm/yyyy | mm/dd/yyyy | yyyy-mm-dd | excel_serial | mixed | unknown',
                dateFormatConfidence: 0.9,
                earliestDate: 'YYYY-MM-DD or null',
                latestDate: 'YYYY-MM-DD or null',
                totalRowsAnalyzed: 0,
                blankDates: 0,
                blankZones: 0,
                blankPlates: 0,
                blankNotes: 0,
                dataQualityIssues: [],
                recommendations: [],
              },
            }),
          },
        ],
      }),
    }, 'ollama');

    if (!response.ok) {
      return heuristic;
    }

    const payload = await response.json();
    const content = payload?.message?.content;
    if (!content || typeof content !== 'string') {
      return heuristic;
    }

    const parsed = JSON.parse(content);
    return {
      ...heuristic,
      ...parsed,
      provider: 'ollama',
      dateFormat: cleanText(parsed?.dateFormat) || heuristic.dateFormat,
      dateFormatConfidence: clamp01(parsed?.dateFormatConfidence) ?? heuristic.dateFormatConfidence,
      dataQualityIssues: Array.isArray(parsed?.dataQualityIssues) ? parsed.dataQualityIssues : heuristic.dataQualityIssues,
      recommendations: Array.isArray(parsed?.recommendations) ? parsed.recommendations : heuristic.recommendations,
    };
  } catch (error) {
    console.warn('⚠️ Tabular NLP via Ollama failed:', error.message);
    return heuristic;
  } finally {
    clearTimeout(timeout);
  }
}

function generateHeuristicChatReply(message, context = {}) {
  const text = String(message || '').trim();
  if (!text) {
    return 'Please share a question or instruction so I can help.';
  }

  const lowered = text.toLowerCase();
  if (lowered.includes('status') || lowered.includes('health')) {
    return 'Service is running in self-contained mode. I can help with patrol workflows, plate checks, and compliance process guidance.';
  }
  if (lowered.includes('privacy') || lowered.includes('data')) {
    return 'This deployment is configured for local processing. External cloud calls are blocked by strict self-contained egress policy.';
  }
  if (lowered.includes('plate') || lowered.includes('rego')) {
    return 'I can assist with plate workflow guidance. Upload evidence through the enforcement workflow and I can help summarize next steps.';
  }

  const tone = context?.tone === 'brief' ? 'briefly' : 'clearly';
  return `I understand your request. I will respond ${tone} and keep recommendations aligned with local enforcement policy and evidence-first decisions.`;
}

async function generateChatReplyWithOllama(message, history = [], context = {}) {
  if (!OLLAMA_ENABLED) {
    recordEgressEvent('ollama', 'blocked', 'Chat requested ollama but local ollama is unavailable');
    return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    recordEgressEvent('ollama', 'attempted', 'chat response generation');
    const response = await safeFetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'You are Bob, the AI assistant embedded in FieldOps Manager — a freedom camping enforcement platform used by councils and security contractors in New Zealand.\n\nYou assist officers, supervisors, and administrators with:\n- NZ freedom camping law: Freedom Camping Act 2011, Local Government Act 2002, RMA 1991, Privacy Act 2020\n- Compliance analysis: breach trends, stay-night calculations, zone rule interpretation\n- Patrol operations: shift planning, route guidance, officer welfare checks\n- Enforcement actions: Notice to Vacate, Warning Notice, Infringement Notice, Noise Notice\n- Vehicle and plate workflows: ALPR results, SCV certification via NZSCV register\n- Incident and evidence management and investigation notes\n- Risk assessments, SOPs, H&S plans, evacuation plans, active offender procedures\n- Data import, system diagnostics, and operational guidance\n\nKey facts:\n- Zones have allowed_days, max_consecutive_nights, max_nights_per_month\n- Observations track plate_number, zone, recorded_at, and photo evidence\n- Breach triggers when stay limits are exceeded\n- Homeless or vulnerable occupants receive special consideration under policy\n- SCV status from NZSCV register can grant zone exemptions\n- All times are NZ timezone (Pacific/Auckland)\n\nBe concise — field officers need fast actionable answers. When you do not know something specific, say so. Never fabricate data or plate numbers. Return plain text only, no markdown formatting.',
          },
          ...history.slice(-12).map((m) => ({
            role: m?.role === 'assistant' ? 'assistant' : 'user',
            content: String(m?.content || ''),
          })),
          {
            role: 'user',
            content: String(message || ''),
          },
        ],
      }),
    }, 'ollama');

    if (!response.ok) {
      return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
    }

    const payload = await response.json();
    const content = payload?.message?.content;
    if (!content || typeof content !== 'string') {
      return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
    }

    return {
      provider: 'ollama',
      text: content.trim(),
      fallback: false,
    };
  } catch (error) {
    console.warn('⚠️ Local chat via Ollama failed:', error.message);
    return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
  } finally {
    clearTimeout(timeout);
  }
}

app.post('/nlp/tabular/analyze', tabularRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const sampleRows = req.body?.sampleRows;
    if (!Array.isArray(sampleRows) || sampleRows.length === 0) {
      return res.status(400).json({ error: 'sampleRows must be a non-empty array' });
    }

    const analysis = OLLAMA_ENABLED
      ? await analyzeTabularDataWithOllama(sampleRows)
      : analyzeTabularDataHeuristic(sampleRows);

    return res.json({
      success: true,
      provider: analysis.provider,
      analysis,
    });
  } catch (error) {
    console.error('Tabular NLP error:', error);
    return res.status(500).json({
      error: 'Tabular NLP failed',
      message: error.message,
    });
  }
});

app.post('/chat', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const message = req.body?.message;
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message must be a non-empty string' });
    }

    if (CHAT_PROVIDER === 'ollama') {
      const reply = await generateChatReplyWithOllama(message, history, context);
      return res.json({
        success: true,
        provider: reply.provider,
        fallback: reply.fallback,
        message: reply.text,
      });
    }

    return res.json({
      success: true,
      provider: 'heuristic',
      fallback: false,
      message: generateHeuristicChatReply(message, context),
    });
  } catch (error) {
    console.error('Chat endpoint error:', error);
    return res.status(500).json({ error: 'Chat failed', message: error.message });
  }
});

app.post('/self-heal/bug-report', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    if (!SELF_HEALING_ENABLED) {
      return res.status(503).json({ error: 'Self-healing assistant is disabled' });
    }

    const report = req.body?.report;
    if (!report || typeof report !== 'object') {
      return res.status(400).json({ error: 'report object is required' });
    }

    if (typeof report.summary !== 'string' || !report.summary.trim()) {
      return res.status(400).json({ error: 'report.summary must be a non-empty string' });
    }

    const plan = buildSelfHealingPlan(report, {
      selfContainedMode: SELF_CONTAINED_MODE,
    });

    return res.json({
      success: true,
      self_healing_enabled: true,
      plan,
    });
  } catch (error) {
    console.error('Self-heal endpoint error:', error);
    return res.status(500).json({ error: 'Self-heal planning failed', message: error.message });
  }
});

app.get('/self-heal/knowledge', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  return res.json({
    success: true,
    self_healing_enabled: SELF_HEALING_ENABLED,
    knowledge: getKnowledgePacks(),
  });
});

app.post('/self-heal/patch-task', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    if (!SELF_HEALING_ENABLED) {
      return res.status(503).json({ error: 'Self-healing assistant is disabled' });
    }

    const report = req.body?.report;
    if (!report || typeof report !== 'object' || !String(report.summary || '').trim()) {
      return res.status(400).json({ error: 'report with non-empty summary is required' });
    }

    const plan = req.body?.plan && typeof req.body.plan === 'object'
      ? req.body.plan
      : buildSelfHealingPlan(report, { selfContainedMode: SELF_CONTAINED_MODE });

    const patchTask = buildPatchTask(report, plan);

    return res.json({
      success: true,
      patch_task: patchTask,
    });
  } catch (error) {
    console.error('Patch task endpoint error:', error);
    return res.status(500).json({ error: 'Patch task generation failed', message: error.message });
  }
});

app.post('/intel/ingest-bulletin', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const rawBody = JSON.stringify(req.body || {});
    const signature = req.get('x-intel-signature') || '';

    if (!intelStore.verifySignature(rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid or missing bulletin signature' });
    }

    const bulletin = req.body?.bulletin;
    if (!bulletin || typeof bulletin !== 'object') {
      return res.status(400).json({ error: 'bulletin object is required' });
    }

    const stored = intelStore.ingestBulletin(bulletin);
    return res.json({
      success: true,
      stored,
      state: intelStore.getState(),
    });
  } catch (error) {
    console.error('Intel ingest error:', error);
    return res.status(500).json({ error: 'Intel ingest failed', message: error.message });
  }
});

app.get('/intel/state', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  return res.json({
    success: true,
    intel: intelStore.getState(),
  });
});

function nearestColourName(r, g, b) {
  const palette = [
    { name: 'white', rgb: [245, 245, 245] },
    { name: 'silver', rgb: [192, 192, 192] },
    { name: 'gray', rgb: [128, 128, 128] },
    { name: 'black', rgb: [20, 20, 20] },
    { name: 'red', rgb: [200, 40, 40] },
    { name: 'orange', rgb: [230, 120, 30] },
    { name: 'yellow', rgb: [235, 205, 40] },
    { name: 'green', rgb: [45, 140, 55] },
    { name: 'blue', rgb: [50, 90, 190] },
    { name: 'brown', rgb: [120, 80, 45] },
    { name: 'beige', rgb: [210, 190, 150] },
  ];

  let best = palette[0];
  let bestDist = Number.POSITIVE_INFINITY;

  for (const c of palette) {
    const dr = r - c.rgb[0];
    const dg = g - c.rgb[1];
    const db = b - c.rgb[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }

  return best.name;
}

async function estimateDominantColour(imageBuffer) {
  try {
    const stats = await sharp(imageBuffer).stats();
    const r = stats.channels?.[0]?.mean ?? 0;
    const g = stats.channels?.[1]?.mean ?? 0;
    const b = stats.channels?.[2]?.mean ?? 0;
    return {
      colour: nearestColourName(r, g, b),
      confidence: 0.45,
    };
  } catch (error) {
    console.warn('⚠️ Dominant colour estimation failed:', error.message);
    return { colour: null, confidence: null };
  }
}

// Convert model bbox to a safe Sharp extract rectangle in source-image pixels.
// Handles both center-based (YOLO-style) and top-left-based interpretations.
async function resolveSafeCrop(imageBuffer, bbox) {
  if (!bbox) return null;

  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width || 0;
  const imageHeight = metadata.height || 0;

  if (!imageWidth || !imageHeight) return null;

  const x = Number.isFinite(bbox.x) ? bbox.x : 0;
  const y = Number.isFinite(bbox.y) ? bbox.y : 0;
  const w = Number.isFinite(bbox.width) ? bbox.width : 0;
  const h = Number.isFinite(bbox.height) ? bbox.height : 0;

  if (w <= 1 || h <= 1) return null;

  const scaleX = imageWidth / YOLO_INPUT_SIZE;
  const scaleY = imageHeight / YOLO_INPUT_SIZE;

  const candidates = [
    // Candidate A: center-based xywh (common YOLO output)
    { left: x - w / 2, top: y - h / 2, width: w, height: h },
    // Candidate B: top-left-based xywh
    { left: x, top: y, width: w, height: h },
  ];

  for (const c of candidates) {
    const left = Math.floor(clamp(c.left * scaleX, 0, imageWidth - 1));
    const top = Math.floor(clamp(c.top * scaleY, 0, imageHeight - 1));
    const right = Math.ceil(clamp((c.left + c.width) * scaleX, left + 1, imageWidth));
    const bottom = Math.ceil(clamp((c.top + c.height) * scaleY, top + 1, imageHeight));
    const width = right - left;
    const height = bottom - top;

    if (width > 1 && height > 1 && left + width <= imageWidth && top + height <= imageHeight) {
      return { left, top, width, height };
    }
  }

  return null;
}

async function extractVehicleCropBuffer(imageBuffer, bbox = null) {
  if (!bbox) return imageBuffer;
  const safeCrop = await resolveSafeCrop(imageBuffer, bbox);
  if (!safeCrop) return imageBuffer;

  try {
    return await sharp(imageBuffer)
      .extract(safeCrop)
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch {
    return imageBuffer;
  }
}

// Preprocess image for MobileNet (224x224)
async function preprocessForEmbedding(imageBuffer, bbox = null) {
  let pipeline = sharp(imageBuffer);

  // Crop to detected vehicle bbox if provided
  if (bbox) {
    const safeCrop = await resolveSafeCrop(imageBuffer, bbox);
    if (safeCrop) {
      pipeline = pipeline.extract(safeCrop);
    } else {
      console.warn('⚠️ Invalid bbox crop; falling back to full-image embedding');
    }
  }

  const { data } = await pipeline
    .resize(224, 224, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Normalize using ImageNet stats
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  
  const float32Data = new Float32Array(3 * 224 * 224);
  for (let c = 0; c < 3; c++) {
    for (let h = 0; h < 224; h++) {
      for (let w = 0; w < 224; w++) {
        const idx = (h * 224 + w) * 3 + c;
        const pixelValue = data[idx] / 255.0;
        float32Data[c * 224 * 224 + h * 224 + w] = (pixelValue - mean[c]) / std[c];
      }
    }
  }

  return new ort.Tensor('float32', float32Data, [1, 3, 224, 224]);
}

// Detect vehicles using YOLOv8
async function detectVehicles(imageTensor) {
  const results = await yoloSession.run({ images: imageTensor });
  const output = results.output0.data;
  
  // Parse YOLO output (format: [batch, 84, 8400])
  // First 4 values: bbox (x, y, w, h)
  // Next 80 values: class probabilities
  
  const detections = [];
  const confidenceThreshold = 0.5;
  const vehicleClasses = [2, 3, 5, 7]; // car, motorcycle, bus, truck (COCO)
  
  for (let i = 0; i < 8400; i++) {
    const offset = i * 84;
    const x = output[offset];
    const y = output[offset + 1];
    const w = output[offset + 2];
    const h = output[offset + 3];
    
    // Check vehicle class confidences
    for (const classId of vehicleClasses) {
      const confidence = output[offset + 4 + classId];
      
      if (confidence > confidenceThreshold) {
        detections.push({
          bbox: { x, y, width: w, height: h },
          confidence,
          class: classId
        });
      }
    }
  }
  
  // Sort by confidence, return best detection
  detections.sort((a, b) => b.confidence - a.confidence);
  return detections[0] || null;
}

// Generate embedding using MobileNetV3
async function generateEmbedding(imageTensor) {
  const results = await embeddingSession.run({ input: imageTensor });
  const embedding = Array.from(results.output.data);
  
  // Calculate quality (L2 norm)
  const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  const quality = Math.min(1.0, norm / 10.0); // Normalize to [0, 1]
  
  return { embedding, quality, norm };
}

async function inferVehicleAttributesWithOpenAI(vehicleCropBuffer) {
  if (!OPENAI_ENABLED) {
    recordEgressEvent('openai', 'blocked', 'SELF_CONTAINED_MODE or OPENAI_API_KEY missing');
    return null;
  }

  const imageBase64 = vehicleCropBuffer.toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTR_TIMEOUT_MS);

  try {
    recordEgressEvent('openai', 'attempted', 'inferVehicleAttributesWithOpenAI');
    const response = await safeFetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a vehicle vision assistant. Return strict JSON only.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'From this vehicle photo crop, infer vehicle attributes for New Zealand roads. Return JSON with keys: vehicle_make, vehicle_model, vehicle_year, vehicle_colour, vehicle_make_confidence, vehicle_model_confidence, vehicle_year_confidence, vehicle_colour_confidence, sticker (object with presence, color, detection_confidence, color_confidence). Use best-effort estimates for make/model/year when plausible; do not leave null unless truly indeterminate. Keep confidences realistic in 0..1 and lower confidence when uncertain. vehicle_year must be an integer (e.g. 2016) or null.',
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
              },
            ],
          },
        ],
      }),
    }, 'openai');

    if (!response.ok) {
      console.warn(`⚠️ OpenAI attrs returned ${response.status}`);
      return null;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') return null;

    const parsed = JSON.parse(content);
    return {
      vehicle_make: cleanText(parsed.vehicle_make),
      vehicle_model: cleanText(parsed.vehicle_model),
      vehicle_year: parseYear(parsed.vehicle_year),
      vehicle_colour: cleanText(parsed.vehicle_colour),
      vehicle_make_confidence: clamp01(parsed.vehicle_make_confidence),
      vehicle_model_confidence: clamp01(parsed.vehicle_model_confidence),
      vehicle_year_confidence: clamp01(parsed.vehicle_year_confidence),
      vehicle_colour_confidence: clamp01(parsed.vehicle_colour_confidence),
      sticker: {
        presence: parsed?.sticker?.presence === null || parsed?.sticker?.presence === undefined
          ? null
          : Boolean(parsed.sticker.presence),
        color: cleanText(parsed?.sticker?.color),
        detection_confidence: clamp01(parsed?.sticker?.detection_confidence),
        color_confidence: clamp01(parsed?.sticker?.color_confidence),
      },
    };
  } catch (error) {
    console.warn('⚠️ OpenAI attrs failed:', error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function inferVehicleAttributes(fullImageBuffer, vehicleCropBuffer) {
  const dominant = await estimateDominantColour(vehicleCropBuffer || fullImageBuffer);

  const fallback = {
    vehicle_make: null,
    vehicle_model: null,
    vehicle_year: null,
    vehicle_colour: dominant.colour,
    vehicle_make_confidence: null,
    vehicle_model_confidence: null,
    vehicle_year_confidence: null,
    vehicle_colour_confidence: dominant.confidence,
    sticker: {
      presence: null,
      color: null,
      detection_confidence: null,
      color_confidence: null,
    },
  };

  if (VEHICLE_ATTRS_PROVIDER !== 'openai') {
    return fallback;
  }

  const ai = await inferVehicleAttributesWithOpenAI(vehicleCropBuffer || fullImageBuffer);
  if (!ai) return fallback;

  return {
    ...fallback,
    ...ai,
    vehicle_colour: ai.vehicle_colour || fallback.vehicle_colour,
    vehicle_colour_confidence: ai.vehicle_colour_confidence ?? fallback.vehicle_colour_confidence,
  };
}

// ============================================================================
// UltraFace-640 face detection model
//
// Optional ONNX model (version-RFB-640.onnx) from the ONNX Model Zoo.
// When present it provides fast, accurate face bounding boxes entirely on CPU
// without requiring an external API call.
//
// Input  : 1×3×480×640 float32, BGR channel order, normalised (pixel−127)/128
// Output : scores [1,4420,2]  — confidence for background (0) and face (1)
//          boxes  [1,4420,4]  — cx, cy, w, h normalised to 0-1
// Threshold: score[1] >= FACE_CONF_THRESHOLD is treated as a face.
// ============================================================================
const FACE_DETECT_MODEL_PATH   = path.join(__dirname, 'models', 'version-RFB-640.onnx');
const FACE_DETECT_INPUT_W      = 640;
const FACE_DETECT_INPUT_H      = 480;
const FACE_CONF_THRESHOLD      = 0.7;

let faceDetectSession = null;  // loaded on-demand, null = model not available

// Lazy-load UltraFace-640 (optional — falls back to OpenAI vision)
async function loadFaceDetectModel() {
  if (faceDetectSession !== null) return faceDetectSession;
  if (!fs.existsSync(FACE_DETECT_MODEL_PATH)) return null;
  try {
    faceDetectSession = await ort.InferenceSession.create(FACE_DETECT_MODEL_PATH, {
      executionProviders: ['cpu'],
    });
    console.log('✅ UltraFace-640 face detection model loaded:', FACE_DETECT_MODEL_PATH);
  } catch (err) {
    console.warn('⚠️  UltraFace model load failed (non-fatal):', err.message);
    faceDetectSession = null;
  }
  return faceDetectSession;
}

/**
 * Detect face bounding boxes using UltraFace-640 ONNX model.
 * Returns an array of { bbox:{x,y,width,height} (normalised 0-1), confidence }
 * sorted by confidence descending, or null if the model is unavailable.
 */
async function detectFacesWithONNX(imageBuffer) {
  const session = await loadFaceDetectModel();
  if (!session) return null;

  try {
    // Resize to model input: 640×480, BGR, (pixel-127)/128
    const { data: rawPixels, info } = await sharp(imageBuffer)
      .resize(FACE_DETECT_INPUT_W, FACE_DETECT_INPUT_H, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const numPixels = FACE_DETECT_INPUT_W * FACE_DETECT_INPUT_H;
    const floats    = new Float32Array(3 * numPixels);

    // Layout: CHW, BGR channel order, normalised (pixel−127)/128
    for (let i = 0; i < numPixels; i++) {
      const r = rawPixels[i * 3];
      const g = rawPixels[i * 3 + 1];
      const b = rawPixels[i * 3 + 2];
      floats[0 * numPixels + i] = (b - 127) / 128;  // B
      floats[1 * numPixels + i] = (g - 127) / 128;  // G
      floats[2 * numPixels + i] = (r - 127) / 128;  // R
    }

    const inputTensor = new ort.Tensor('float32', floats,
      [1, 3, FACE_DETECT_INPUT_H, FACE_DETECT_INPUT_W]);

    const inputName = session.inputNames[0];
    const outputs   = await session.run({ [inputName]: inputTensor });

    // UltraFace output names are 'scores' and 'boxes' (or indexed output0/output1)
    const scoresKey = session.outputNames.find(n => n.toLowerCase().includes('score')) || session.outputNames[0];
    const boxesKey  = session.outputNames.find(n => n.toLowerCase().includes('box'))   || session.outputNames[1];

    const scoresData = outputs[scoresKey].data;   // [1, 4420, 2] flattened → 8840 values
    const boxesData  = outputs[boxesKey].data;    // [1, 4420, 4] flattened → 17680 values
    const numAnchors = 4420;

    const detections = [];
    for (let i = 0; i < numAnchors; i++) {
      const bgConf   = scoresData[i * 2];
      const faceConf = scoresData[i * 2 + 1];
      if (faceConf >= FACE_CONF_THRESHOLD) {
        const cx = boxesData[i * 4];
        const cy = boxesData[i * 4 + 1];
        const bw = boxesData[i * 4 + 2];
        const bh = boxesData[i * 4 + 3];
        detections.push({
          bbox: {
            x:      Math.max(0, cx - bw / 2),
            y:      Math.max(0, cy - bh / 2),
            width:  Math.min(1, bw),
            height: Math.min(1, bh),
          },
          confidence: Math.round(faceConf * 10000) / 10000,
        });
      }
    }

    // Sort by confidence descending and apply simple greedy NMS
    detections.sort((a, b) => b.confidence - a.confidence);
    const kept = [];
    for (const det of detections) {
      const overlap = kept.some(k => {
        const ix = Math.max(0, Math.min(det.bbox.x + det.bbox.width,  k.bbox.x + k.bbox.width)  - Math.max(det.bbox.x, k.bbox.x));
        const iy = Math.max(0, Math.min(det.bbox.y + det.bbox.height, k.bbox.y + k.bbox.height) - Math.max(det.bbox.y, k.bbox.y));
        const inter = ix * iy;
        const union = det.bbox.width * det.bbox.height + k.bbox.width * k.bbox.height - inter;
        return union > 0 && (inter / union) > 0.45;
      });
      if (!overlap) kept.push(det);
    }

    return kept;  // array of { bbox, confidence }
  } catch (err) {
    console.warn('⚠️  UltraFace inference failed (non-fatal):', err.message);
    return null;
  }
}

// ── Face detection via OpenAI vision ─────────────────────────────────────────
// Returns { face_count, faces[] } or null on failure.
// Each face: { bbox: {x,y,w,h} (normalised 0-1), confidence, approximate_age, gender, description }
async function detectFacesWithOpenAI(imageBuffer) {
  if (!OPENAI_ENABLED) {
    recordEgressEvent('openai', 'blocked', 'SELF_CONTAINED_MODE or OPENAI_API_KEY missing');
    return null;
  }

  const imageBase64 = imageBuffer.toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTR_TIMEOUT_MS);

  try {
    recordEgressEvent('openai', 'attempted', 'detectFacesWithOpenAI');
    const response = await safeFetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a face detection assistant for NZ enforcement software. ' +
              'Return strict JSON only. Provide the minimum descriptors needed for ' +
              'identification purposes in compliance with the NZ Privacy Act 2020.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Analyse this image for human faces. Return JSON with keys: ' +
                  '"face_count" (integer), "faces" (array). ' +
                  'Each face object must have: ' +
                  '"bbox" (object with x, y, width, height as fractions 0.0-1.0 of image dimensions), ' +
                  '"confidence" (0.0-1.0), ' +
                  '"approximate_age" (string like "25-35" or "unknown"), ' +
                  '"gender" ("male", "female", or "unknown"), ' +
                  '"description" (brief neutral descriptor e.g. "dark hair, glasses" or null). ' +
                  'If no faces are present return { "face_count": 0, "faces": [] }.',
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
              },
            ],
          },
        ],
      }),
    }, 'openai');

    if (!response.ok) {
      console.warn(`⚠️ OpenAI face detection returned HTTP ${response.status}`);
      return null;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') return null;

    const parsed = JSON.parse(content);
    const faces = (Array.isArray(parsed.faces) ? parsed.faces : []).map((f) => ({
      bbox: f.bbox
        ? {
            x:      clamp01(Number(f.bbox.x)      ?? 0),
            y:      clamp01(Number(f.bbox.y)      ?? 0),
            width:  clamp01(Number(f.bbox.width)  ?? 0.5),
            height: clamp01(Number(f.bbox.height) ?? 0.5),
          }
        : null,
      confidence:      clamp01(Number(f.confidence)   ?? 0.8),
      approximate_age: String(f.approximate_age        ?? 'unknown'),
      gender:          String(f.gender                 ?? 'unknown'),
      description:     f.description != null ? String(f.description) : null,
    }));

    return { face_count: faces.length, faces };
  } catch (err) {
    console.warn('⚠️ OpenAI face detection failed:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Main inference endpoint
app.post('/infer', inferenceRateLimit, upload.single('photo'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    const modelsLoaded = !!(yoloSession && embeddingSession);

    // Degraded-mode path: ONNX models missing but AI attribute provider is active
    if (!modelsLoaded) {
      if (VEHICLE_ATTRS_PROVIDER === 'openai') {
        console.log(`⚙️  Degraded mode — skipping YOLO/embedding, calling AI attribute provider`);
        const vehicleAttrs = await inferVehicleAttributes(req.file.buffer, req.file.buffer);
        const duration = Date.now() - startTime;
        return res.json({
          success: true,
          degraded: true,
          data: {
            vehicle_make: vehicleAttrs.vehicle_make,
            vehicle_model: vehicleAttrs.vehicle_model,
            vehicle_year: vehicleAttrs.vehicle_year,
            vehicle_colour: vehicleAttrs.vehicle_colour,
            vehicle_color: vehicleAttrs.vehicle_colour,
            vehicle_make_confidence: vehicleAttrs.vehicle_make_confidence,
            vehicle_model_confidence: vehicleAttrs.vehicle_model_confidence,
            vehicle_year_confidence: vehicleAttrs.vehicle_year_confidence,
            vehicle_colour_confidence: vehicleAttrs.vehicle_colour_confidence,
            sticker: vehicleAttrs.sticker,
            metadata: { processing_time_ms: duration },
          }
        });
      }
      return res.status(503).json({ error: 'Models not loaded — service is running in degraded mode' });
    }

    console.log(`Processing ${req.file.originalname} (${req.file.size} bytes)`);

    // Step 1: Detect vehicle
    const yoloInput = await preprocessForYOLO(req.file.buffer);
    const detection = await detectVehicles(yoloInput);

    // If YOLO misses the vehicle, still attempt attribute inference on the
    // full image so make/model/year/colour can enrich the scan result.
    if (!detection) {
      console.warn('⚠️ No vehicle detected by YOLO — falling back to full-image attribute inference');
      const vehicleAttrs = await inferVehicleAttributes(req.file.buffer, req.file.buffer);
      const duration = Date.now() - startTime;
      return res.json({
        success: true,
        degraded: true,
        data: {
          embedding: null,
          embedding_quality: null,
          embedding_model_version: 'yolov8n_mobilenetv3_v1.0',
          detection: null,
          metadata: {
            norm: null,
            dimension: null,
            processing_time_ms: duration,
            fallback_reason: 'no_vehicle_detected',
          },
          vehicle_make: vehicleAttrs.vehicle_make,
          vehicle_model: vehicleAttrs.vehicle_model,
          vehicle_year: vehicleAttrs.vehicle_year,
          vehicle_colour: vehicleAttrs.vehicle_colour,
          vehicle_color: vehicleAttrs.vehicle_colour,
          vehicle_make_confidence: vehicleAttrs.vehicle_make_confidence,
          vehicle_model_confidence: vehicleAttrs.vehicle_model_confidence,
          vehicle_year_confidence: vehicleAttrs.vehicle_year_confidence,
          vehicle_colour_confidence: vehicleAttrs.vehicle_colour_confidence,
          sticker: vehicleAttrs.sticker,
        }
      });
    }

    console.log(`✅ Vehicle detected (confidence: ${detection.confidence.toFixed(2)})`);

    // Step 2: Generate embedding
    const vehicleCropBuffer = await extractVehicleCropBuffer(req.file.buffer, detection.bbox);
    const embeddingInput = await preprocessForEmbedding(req.file.buffer, detection.bbox);
    const [embeddingResult, vehicleAttrs] = await Promise.all([
      generateEmbedding(embeddingInput),
      inferVehicleAttributes(req.file.buffer, vehicleCropBuffer),
    ]);
    const { embedding, quality, norm } = embeddingResult;

    console.log(`✅ Embedding generated (quality: ${quality.toFixed(2)})`);

    // Step 3: Return results
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      data: {
        embedding: embedding,
        embedding_quality: quality,
        embedding_model_version: 'yolov8n_mobilenetv3_v1.0',
        detection: {
          confidence: detection.confidence,
          bbox: detection.bbox,
          class: detection.class
        },
        metadata: {
          norm: norm,
          dimension: embedding.length,
          processing_time_ms: duration
        },
        vehicle_make: vehicleAttrs.vehicle_make,
        vehicle_model: vehicleAttrs.vehicle_model,
        vehicle_year: vehicleAttrs.vehicle_year,
        vehicle_colour: vehicleAttrs.vehicle_colour,
        vehicle_color: vehicleAttrs.vehicle_colour,
        vehicle_make_confidence: vehicleAttrs.vehicle_make_confidence,
        vehicle_model_confidence: vehicleAttrs.vehicle_model_confidence,
        vehicle_year_confidence: vehicleAttrs.vehicle_year_confidence,
        vehicle_colour_confidence: vehicleAttrs.vehicle_colour_confidence,
        sticker: vehicleAttrs.sticker,
      }
    });

  } catch (error) {
    console.error('Inference error:', error);
    res.status(500).json({ 
      error: 'Inference failed',
      message: error.message 
    });
  }
});

// ============================================================================
// Self-hosted ALPR module
//
// Architecture:
//   1. Plate detection  — optional `models/plate_detect.onnx` (YOLOv9-nano, 320px input).
//                         If not present, falls back to the vehicle bbox from YOLOv8n
//                         (less precise but still useful).
//   2. Region prep      — Sharp crops + upscales the plate region, converts to greyscale,
//                         enhances contrast for OCR.
//   3. OCR              — tesseract.js (WebAssembly Tesseract, pure JS, no system deps).
//                         Char whitelist: A-Z 0-9.  PSM 7 (single text line).
//   4. NZ normalisation — strips non-alphanumeric chars, uppercases, validates known
//                         NZ plate patterns.
//
// The /infer/alpr endpoint returns the same shape as the Plate Recognizer API
// so _shared/alpr.ts can call either provider transparently.
// ============================================================================

const { createWorker } = require('tesseract.js');
const PLATE_DETECT_MODEL_PATH = path.join(__dirname, 'models', 'plate_detect.onnx');
const PLATE_DETECT_INPUT_SIZE  = 384;  // yolo-v9-t-384-license-plates-end2end input

let plateDetectSession = null;  // loaded on-demand, null = not available

// Lazy-load the plate detection model (optional — service works without it)
async function loadPlateDetectModel() {
  if (plateDetectSession !== null) return plateDetectSession;
  if (!fs.existsSync(PLATE_DETECT_MODEL_PATH)) return null;
  try {
    plateDetectSession = await ort.InferenceSession.create(PLATE_DETECT_MODEL_PATH, {
      executionProviders: ['cpu'],
    });
    console.log('✅ Plate detection model loaded:', PLATE_DETECT_MODEL_PATH);
  } catch (err) {
    console.warn('⚠️  Plate detect model load failed (non-fatal):', err.message);
    plateDetectSession = null;
  }
  return plateDetectSession;
}

/**
 * Generate a face embedding by cropping the face region and running MobileNetV3.
 * Returns 384-D embedding vector or null.
 */
async function generateFaceEmbedding(imageBuffer, faceBbox) {
  if (!embeddingSession) return null;

  try {
    let cropBuffer = imageBuffer;
    if (faceBbox && faceBbox.width > 0 && faceBbox.height > 0) {
      cropBuffer = await sharp(imageBuffer)
        .extract({
          left:   faceBbox.x,
          top:    faceBbox.y,
          width:  faceBbox.width,
          height: faceBbox.height,
        })
        .toBuffer();
    }

    // Resize face crop to MobileNetV3 input (224x224)
    const { data } = await sharp(cropBuffer)
      .resize(224, 224, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const float32 = new Float32Array(3 * 224 * 224);
    for (let c = 0; c < 3; c++) {
      for (let h = 0; h < 224; h++) {
        for (let w = 0; w < 224; w++) {
          float32[c * 224 * 224 + h * 224 + w] = data[(h * 224 + w) * 3 + c] / 255.0;
        }
      }
    }

    const inputTensor = new ort.Tensor('float32', float32, [1, 3, 224, 224]);
    const inputKey = embeddingSession.inputNames[0];
    const result = await embeddingSession.run({ [inputKey]: inputTensor });
    const outputKey = embeddingSession.outputNames[0];
    const embeddingData = result[outputKey].data;

    const embedding = Array.from(embeddingData).map(v => Math.round(v * 100000) / 100000);
    const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    const quality = norm > 0.1 ? Math.min(1, norm / 10) : 0;

    return { embedding, quality };
  } catch (err) {
    console.warn('⚠️  Face embedding generation failed (non-fatal):', err.message);
    return null;
  }
}

// Tesseract worker — created per request (stateless) for safety on Railway/Render
// For high-throughput deployments consider a persistent worker pool.
async function ocrPlate(imageBuffer) {
  const worker = await createWorker('eng', 1, {
    // Silence noisy Tesseract logs in production
    logger: () => {},
    errorHandler: () => {},
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      tessedit_pageseg_mode:   '7',  // PSM_SINGLE_LINE
    });
    const { data } = await worker.recognize(imageBuffer);
    return {
      text:       data.text?.trim()       ?? '',
      confidence: data.confidence         ?? 0,
      words:      data.words              ?? [],
    };
  } finally {
    await worker.terminate();
  }
}

// Preprocess image region for OCR:
//   - Crop to bbox (optional)
//   - Upscale to at least 100px tall (OCR accuracy improves significantly)
//   - Convert to greyscale
//   - Sharpen + increase contrast
async function prepPlateRegion(imageBuffer, bbox = null) {
  let pipeline = sharp(imageBuffer);

  if (bbox) {
    const rawX = Number(bbox.x);
    const rawY = Number(bbox.y);
    const rawW = Number(bbox.width);
    const rawH = Number(bbox.height);

    if (![rawX, rawY, rawW, rawH].every(Number.isFinite)) {
      console.warn('⚠️ Invalid ALPR bbox values; falling back to full-image OCR');
    } else {
      // Normalise potentially negative width/height to a top-left + positive-size box.
      const safeX = rawW < 0 ? rawX + rawW : rawX;
      const safeY = rawH < 0 ? rawY + rawH : rawY;
      const safeW = Math.abs(rawW);
      const safeH = Math.abs(rawH);

      if (safeW < 2 || safeH < 2) {
        console.warn('⚠️ ALPR bbox too small; falling back to full-image OCR');
      } else {
        // Add 10% padding around the detected plate region
        const meta   = await sharp(imageBuffer).metadata();
        const imgW   = meta.width  ?? 640;
        const imgH   = meta.height ?? 640;
        const pad    = Math.max(4, Math.round(Math.min(safeW, safeH) * 0.10));
        const left   = Math.max(0, Math.round(safeX - pad));
        const top    = Math.max(0, Math.round(safeY - pad));
        const right  = Math.min(imgW, Math.round(safeX + safeW + pad));
        const bottom = Math.min(imgH, Math.round(safeY + safeH + pad));
        const cropW = right - left;
        const cropH = bottom - top;

        if (cropW > 1 && cropH > 1) {
          pipeline = pipeline.extract({ left, top, width: cropW, height: cropH });
        } else {
          console.warn('⚠️ ALPR bbox crop invalid after clamping; falling back to full-image OCR');
        }
      }
    }
  }

  // Upscale: OCR benefits greatly from a minimum ~100px tall region
  const cropped  = await pipeline.toBuffer();
  const cropMeta = await sharp(cropped).metadata();
  const cropHeight = cropMeta.height || 1;
  const cropWidth = cropMeta.width || 200;
  const scale    = cropHeight < 150 ? Math.ceil(150 / cropHeight) : 2;

  return sharp(cropped)
    .resize({ width: cropWidth * scale, kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .normalise()                    // stretch histogram to full range
    .sharpen({ sigma: 2 })
    .threshold(128)                  // binarise for crisper OCR input
    .toBuffer();
}

// Detect license plate region using the plate detection ONNX model.
// Uses yolo-v9-t-384-license-plates-end2end.onnx (end2end = NMS baked in).
// Output tensor: [N, 7] — each row: [batch_idx, x1, y1, x2, y2, class_id, score]
// Coordinates are in letterboxed-image pixel space; de-letterboxed before returning.
// Returns { x, y, width, height, confidence } in PIXEL coordinates of original image
// or null if no plate found above threshold.
async function detectPlateRegion(imageBuffer) {
  const session = await loadPlateDetectModel();
  if (!session) return null;

  try {
    const meta  = await sharp(imageBuffer).metadata();
    const origW = meta.width  ?? 640;
    const origH = meta.height ?? 640;
    const size  = PLATE_DETECT_INPUT_SIZE;

    // Letterbox resize: maintain aspect ratio, pad with gray-114 to square.
    // Compute ratio and padding to de-letterbox predictions back to original coords.
    const ratio = Math.min(size / origH, size / origW);
    const newW  = Math.round(origW * ratio);
    const newH  = Math.round(origH * ratio);
    const dw    = (size - newW) / 2;  // horizontal padding per side
    const dh    = (size - newH) / 2;  // vertical padding per side

    const resized = await sharp(imageBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 114, g: 114, b: 114 } })
      .removeAlpha()
      .raw()
      .toBuffer();

    // Build float32 CHW tensor (RGB, 0-1 normalised) matching YOLOv9 expectations
    const floats = new Float32Array(3 * size * size);
    for (let i = 0; i < size * size; i++) {
      floats[i]                    = resized[i * 3]     / 255.0;  // R
      floats[size * size + i]      = resized[i * 3 + 1] / 255.0;  // G
      floats[2 * size * size + i]  = resized[i * 3 + 2] / 255.0;  // B
    }

    const tensor    = new ort.Tensor('float32', floats, [1, 3, size, size]);
    const inputKey  = session.inputNames[0];
    const outputs   = await session.run({ [inputKey]: tensor });
    const outTensor = outputs[session.outputNames[0]];
    const output    = outTensor.data;

    // End2end YOLOv9 output shape: [N, 7]
    //   col 0: batch index (ignore)
    //   col 1-4: x1, y1, x2, y2 in letterboxed pixel space
    //   col 5: class id
    //   col 6: confidence score
    const numDets  = outTensor.dims[0] ?? 0;
    const STRIDE   = 7;
    const threshold = 0.35;

    let bestScore = 0;
    let bestBbox  = null;

    for (let i = 0; i < numDets; i++) {
      const score = output[i * STRIDE + 6];
      if (!Number.isFinite(score) || score < threshold || score <= bestScore) continue;

      const x1s = output[i * STRIDE + 1];  // x1 in letterboxed space
      const y1s = output[i * STRIDE + 2];  // y1 in letterboxed space
      const x2s = output[i * STRIDE + 3];  // x2 in letterboxed space
      const y2s = output[i * STRIDE + 4];  // y2 in letterboxed space

      if (![x1s, y1s, x2s, y2s].every(Number.isFinite)) continue;

      // De-letterbox: remove padding offset and scale back to original image coords
      const x1 = clamp((x1s - dw) / ratio, 0, origW);
      const y1 = clamp((y1s - dh) / ratio, 0, origH);
      const x2 = clamp((x2s - dw) / ratio, 0, origW);
      const y2 = clamp((y2s - dh) / ratio, 0, origH);

      const width  = x2 - x1;
      const height = y2 - y1;
      if (width > 1 && height > 1) {
        bestScore = score;
        bestBbox  = {
          x:          Math.round(x1),
          y:          Math.round(y1),
          width:      Math.round(width),
          height:     Math.round(height),
          confidence: score,
        };
      }
    }

    return bestBbox;
  } catch (err) {
    console.warn('⚠️  Plate detect inference failed (non-fatal):', err.message);
    return null;
  }
}

// NZ plate format validation + normalisation
// Returns { plate, valid, pattern } or null if unreadable
const NZ_PLATE_PATTERNS = [
  // ABC123  — standard 3-letter + 3-digit format introduced post-2001
  { name: 'standard_modern',   re: /^[A-Z]{3}[0-9]{3}$/ },
  // AB1234  — older 2-letter + 4-digit format used pre-2001
  { name: 'standard_older',    re: /^[A-Z]{2}[0-9]{4}$/ },
  // A123 / AB12 / ABC1 — general mixed plates (motorcycles, trailers, etc.)
  { name: 'standard_mixed',    re: /^[A-Z]{1,3}[0-9]{1,4}$/ },
  // KIWI / NZ2023 — personalised/vanity plates (1–7 alphanumeric chars)
  { name: 'personalised',      re: /^[A-Z0-9]{1,7}$/ },
  // T12345 — trade plates issued to vehicle dealers / mechanics
  { name: 'trade',             re: /^T[0-9]{1,5}$/ },
  // D12345 — diplomatic corps plates
  { name: 'diplomatic',        re: /^D[0-9]{1,5}$/ },
];

function normaliseNZPlate(rawText) {
  if (!rawText) return null;
  // Strip anything that isn't A-Z or 0-9
  const cleaned = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  if (cleaned.length < 2 || cleaned.length > 7) return null;

  // Score against NZ patterns (higher score = more likely to be a real plate)
  for (const { name, re } of NZ_PLATE_PATTERNS) {
    if (re.test(cleaned)) {
      return { plate: cleaned, valid: true, pattern: name };
    }
  }
  // Still return if length is reasonable — OCR might have minor errors
  return { plate: cleaned, valid: false, pattern: 'unknown' };
}

function plateOcrVariants(rawText) {
  if (!rawText) return [];
  const cleaned = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return [];

  const replacements = [
    ['0', 'O'],
    ['O', '0'],
    ['1', 'I'],
    ['I', '1'],
    ['5', 'S'],
    ['S', '5'],
    ['2', 'Z'],
    ['Z', '2'],
    ['8', 'B'],
    ['B', '8'],
  ];

  const variants = new Set([cleaned]);
  for (const [a, b] of replacements) {
    if (cleaned.includes(a)) variants.add(cleaned.replaceAll(a, b));
  }

  return Array.from(variants);
}

// ── POST /infer/alpr — Self-hosted ALPR ─────────────────────────────────────
// Drop-in alternative to Plate Recognizer. Returns the same response shape so
// _shared/alpr.ts and all callers work unchanged.
//
// Required: photo file (multipart/form-data field "photo")
// Optional: vehicle_bbox JSON string — pre-computed vehicle bbox to guide
//           the search (avoids running YOLOv8n again if you already have it)
// ============================================================================
app.post('/infer/alpr', alprRateLimit, upload.single('photo'), requireInferenceAuth, async (req, res) => {
  const startTime = Date.now();

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded', field: 'photo' });
    }

    const imageBuffer = req.file.buffer;
    let vehicleBbox = null;

    // Parse optional pre-computed vehicle bbox
    if (req.body?.vehicle_bbox) {
      try { vehicleBbox = JSON.parse(req.body.vehicle_bbox); } catch { /* ignore */ }
    }

    // ── Step 1: Attempt dedicated plate detection ──────────────────
    let plateBbox = await detectPlateRegion(imageBuffer);
    let detectionMethod = plateBbox ? 'plate_detect_model' : null;

    // ── Step 2: Fallback — if no plate model, use vehicle crop from YOLOv8n ──
    if (!plateBbox) {
      if (vehicleBbox) {
        plateBbox = vehicleBbox;
        detectionMethod = 'vehicle_bbox_provided';
      } else if (yoloSession) {
        try {
          const yoloInput = await preprocessForYOLO(imageBuffer);
          const vehicleDet = await detectVehicles(yoloInput);
          if (vehicleDet) {
            plateBbox = vehicleDet.bbox;
            detectionMethod = 'yolov8n_vehicle_crop';
          }
        } catch { /* fall through to full-image OCR */ }
      }
    }

    if (!plateBbox) {
      detectionMethod = 'full_image_fallback';
    }

    // ── Step 3: Preprocess the plate/vehicle region for OCR ───────
    const ocrInput = await prepPlateRegion(imageBuffer, plateBbox);

    // ── Step 4: OCR ───────────────────────────────────────────────
    const ocrResult = await ocrPlate(ocrInput);

    // ── Step 5: Normalise + score candidates for NZ plates ───────
    const candidateScores = new Map();
    const addCandidate = (raw, sourceConfidence) => {
      const srcConf = Math.max(0, Math.min(1, Number(sourceConfidence) || 0));
      for (const variant of plateOcrVariants(raw)) {
        const n = normaliseNZPlate(variant);
        if (!n || !n.plate || n.plate.length < 2) continue;
        let score = srcConf;
        if (n.valid) score += 0.15;
        if (n.pattern === 'standard_modern' || n.pattern === 'standard_older') score += 0.07;
        if (n.pattern === 'unknown') score -= 0.05;
        const prev = candidateScores.get(n.plate) ?? 0;
        if (score > prev) candidateScores.set(n.plate, score);
      }
    };

    addCandidate(ocrResult.text, ocrResult.confidence / 100);
    for (const word of ocrResult.words || []) {
      const wordConf = Number.isFinite(word?.confidence)
        ? Number(word.confidence) / 100
        : (ocrResult.confidence / 100) * 0.85;
      addCandidate(word?.text || '', wordConf);
    }

    // If no plate candidate emerged from plate crop OCR, run one fallback OCR pass
    // on the full image so we don't miss cases where bbox localisation is off.
    if (candidateScores.size === 0 && plateBbox) {
      const fallbackInput = await prepPlateRegion(imageBuffer, null);
      const fallbackOcr = await ocrPlate(fallbackInput);
      addCandidate(fallbackOcr.text, (fallbackOcr.confidence / 100) * 0.85);
      for (const word of fallbackOcr.words || []) {
        const wordConf = Number.isFinite(word?.confidence)
          ? (Number(word.confidence) / 100) * 0.8
          : (fallbackOcr.confidence / 100) * 0.75;
        addCandidate(word?.text || '', wordConf);
      }
      detectionMethod = `${detectionMethod}+full_image_ocr_fallback`;
    }

    const sortedCandidates = Array.from(candidateScores.entries())
      .sort((a, b) => b[1] - a[1]);
    const bestPlate = sortedCandidates[0]?.[0] ?? null;
    const confidence = bestPlate ? Math.min(0.99, sortedCandidates[0][1]) : 0;
    const normalised = bestPlate ? normaliseNZPlate(bestPlate) : null;
    const candidates = sortedCandidates.slice(0, 8).map(([plate, score]) => ({
      plate,
      confidence: Math.max(0, Math.min(0.99, score)),
    }));

    const duration = Date.now() - startTime;

    // Return in Plate Recognizer-compatible shape so _shared/alpr.ts needs no changes
    return res.json({
      success: true,
      // Plate Recognizer compatible top-level keys
      plate:           bestPlate,
      confidence:      Math.round(confidence * 100) / 100,
      // Results array (matches Plate Recognizer format)
      results: bestPlate ? [{
        plate:      bestPlate,
        score:      confidence,
        box:        plateBbox ? {
          xmin: Math.round(plateBbox.x),
          ymin: Math.round(plateBbox.y),
          xmax: Math.round(plateBbox.x + plateBbox.width),
          ymax: Math.round(plateBbox.y + plateBbox.height),
        } : null,
        candidates: candidates.slice(0, 5),
        region:     { code: 'nz', score: 0.99 },
        valid_nz_format: normalised?.valid ?? false,
        nz_pattern:     normalised?.pattern ?? null,
      }] : [],
      // Extended metadata
      alpr_provider:    'local',
      detection_method: detectionMethod,
      ocr_raw_text:     ocrResult.text,
      processing_time_ms: duration,
    });

  } catch (error) {
    console.error('❌ /infer/alpr error:', error);
    return res.status(500).json({ error: 'ALPR failed', message: error.message });
  }
});

// ============================================================================
// POST /infer/chalk — TicketOr2-style AI-assisted chalk pass
//
// Accepts a vehicle/tyre photo and returns:
//   - plate number (via Plate Recognizer if PLATERECOGNIZER_TOKEN is set)
//   - tyre valve position (via OpenAI vision: north/east/south/west/unknown)
//   - vehicle make/model/year/colour (via existing AI attribute pipeline)
//   - vehicle embedding (for movement comparison at recheck)
//   - vehicle detection confidence
//
// All fields gracefully degrade: valve position → 'unknown' if OpenAI not
// configured, plate → null if ALPR not available, embedding → null if ONNX
// models not loaded.
// ============================================================================
app.post('/infer/chalk', inferenceRateLimit, upload.single('photo'), requireInferenceAuth, async (req, res) => {
  const startTime = Date.now();

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded', field: 'photo' });
    }

    const imageBuffer = req.file.buffer;

    // ── 1. Plate Recognition via Plate Recognizer ─────────────────────
    let plate = null;
    let plateConfidence = null;
    if (CLOUD_ALPR_ENABLED) {
      try {
        recordEgressEvent('cloud_alpr', 'attempted', 'chalk plate recognition');
        const formData = new FormData();
        const blob = new Blob([imageBuffer], { type: req.file.mimetype || 'image/jpeg' });
        formData.append('upload', blob, req.file.originalname || 'photo.jpg');
        formData.append('regions', process.env.ALPR_REGIONS || 'nz');

        const alprResp = await safeFetch(
          process.env.ALPR_CLOUD_URL || 'https://api.platerecognizer.com/v1/plate-reader/',
          {
            method: 'POST',
            headers: { Authorization: `Token ${process.env.PLATERECOGNIZER_TOKEN}` },
            body: formData,
            signal: AbortSignal.timeout(5000),
          },
          'cloud_alpr'
        );
        if (alprResp.ok) {
          const alprData = await alprResp.json();
          const best = alprData?.results?.[0];
          if (best?.plate) {
            plate = best.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            plateConfidence = best.score ?? null;
          }
        }
      } catch (alprErr) {
        console.warn('⚠️  /infer/chalk ALPR failed (non-fatal):', alprErr.message);
      }
    } else {
      recordEgressEvent('cloud_alpr', 'blocked', 'SELF_CONTAINED_MODE or PLATERECOGNIZER_TOKEN missing');
    }

    // ── 2. Tyre valve position via OpenAI vision ──────────────────────
    let valvePosition = 'unknown';
    let valveConfidence = 0;
    let valveDescription = 'Valve position could not be determined';

    if (OPENAI_ENABLED) {
      try {
        recordEgressEvent('openai', 'attempted', 'chalk valve detection');
        const imageBase64 = imageBuffer.toString('base64');
        const mimeType = req.file.mimetype || 'image/jpeg';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ATTR_TIMEOUT_MS);

        const valveResp = await safeFetch(`${OPENAI_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: OPENAI_MODEL,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content:
                  'You are a parking enforcement assistant. Analyse the tyre in this photo and determine ' +
                  'the clock position of the valve stem on the front-left tyre (or the most visible tyre). ' +
                  'This is used for electronic chalking — NZ council parking enforcement. ' +
                  'Return strict JSON only with keys: ' +
                  'valve_position (one of: "north","east","south","west","unknown"), ' +
                  'valve_confidence (0.0–1.0), ' +
                  'valve_description (short natural-language description of position, e.g. "Valve stem pointing approximately to 12 o\'clock (north)"). ' +
                  'If no tyre/wheel is clearly visible, return valve_position: "unknown" and valve_confidence: 0.',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'What is the tyre valve stem position in this image?' },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${mimeType};base64,${imageBase64}` },
                  },
                ],
              },
            ],
          }),
        }, 'openai');

        clearTimeout(timeout);

        if (valveResp.ok) {
          const valvePayload = await valveResp.json();
          const content = valvePayload?.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content);
            const pos = parsed.valve_position?.toLowerCase();
            if (['north', 'east', 'south', 'west', 'unknown'].includes(pos)) {
              valvePosition    = pos;
              valveConfidence  = clamp01(parsed.valve_confidence ?? 0);
              valveDescription = parsed.valve_description ?? valveDescription;
            }
          }
        }
      } catch (valveErr) {
        console.warn('⚠️  /infer/chalk valve detection failed (non-fatal):', valveErr.message);
      }
    } else {
      recordEgressEvent('openai', 'blocked', 'SELF_CONTAINED_MODE or OPENAI_API_KEY missing');
    }

    // ── 3. Vehicle detection + embedding + attributes ────────────────
    let embedding = null;
    let embeddingQuality = null;
    let vehicleDetection = null;
    let vehicleAttrs = { vehicle_make: null, vehicle_model: null, vehicle_year: null, vehicle_colour: null };

    const modelsLoaded = !!(yoloSession && embeddingSession);

    if (modelsLoaded) {
      try {
        const yoloInput = await preprocessForYOLO(imageBuffer);
        const detection = await detectVehicles(yoloInput);
        vehicleDetection = detection ? {
          confidence: detection.confidence,
          bbox: detection.bbox,
          class: detection.class,
        } : null;

        const cropBuffer = await extractVehicleCropBuffer(imageBuffer, detection?.bbox ?? null);
        const embeddingInput = await preprocessForEmbedding(imageBuffer, detection?.bbox ?? null);
        const [embResult, attrs] = await Promise.all([
          generateEmbedding(embeddingInput),
          inferVehicleAttributes(imageBuffer, cropBuffer),
        ]);
        embedding = embResult.embedding;
        embeddingQuality = embResult.quality;
        vehicleAttrs = attrs;
      } catch (inferErr) {
        console.warn('⚠️  /infer/chalk ONNX inference failed (non-fatal):', inferErr.message);
      }
    } else if (VEHICLE_ATTRS_PROVIDER === 'openai') {
      // Degraded: no ONNX but can still get attributes
      try {
        vehicleAttrs = await inferVehicleAttributes(imageBuffer, imageBuffer) || vehicleAttrs;
      } catch { /* non-fatal */ }
    }

    const duration = Date.now() - startTime;

    return res.json({
      success: true,
      data: {
        // ALPR
        plate,
        plate_confidence: plateConfidence,

        // Tyre valve (TicketOr2 core feature)
        valve_position:    valvePosition,
        valve_confidence:  valveConfidence,
        valve_description: valveDescription,

        // Vehicle detection
        vehicle_detected:    !!vehicleDetection,
        vehicle_confidence:  vehicleDetection?.confidence ?? null,
        detection:           vehicleDetection,

        // Embedding (store for movement comparison at recheck)
        embedding,
        embedding_quality:   embeddingQuality,

        // Vehicle attributes
        vehicle_make:    vehicleAttrs?.vehicle_make   ?? null,
        vehicle_model:   vehicleAttrs?.vehicle_model  ?? null,
        vehicle_year:    vehicleAttrs?.vehicle_year   ?? null,
        vehicle_colour:  vehicleAttrs?.vehicle_colour ?? null,

        metadata: {
          processing_time_ms: duration,
          alpr_available:     CLOUD_ALPR_ENABLED,
          valve_ai_available: OPENAI_ENABLED,
          onnx_available:     modelsLoaded,
        },
      },
    });

  } catch (error) {
    console.error('❌ /infer/chalk error:', error);
    return res.status(500).json({ error: 'Chalk inference failed', message: error.message });
  }
});

// ============================================================================
// POST /infer/compare — Cosine similarity between two 384D embeddings
//
// Used at recheck time to determine if the same physical vehicle is present
// (high similarity ≈ same vehicle, same position; lower ≈ different vehicle
// or vehicle moved and returned).
//
// Body (JSON): { embedding1: number[], embedding2: number[] }
// Response:    { similarity: number, same_vehicle: boolean, confidence: string }
// ============================================================================
app.post('/infer/compare', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const { embedding1, embedding2 } = req.body ?? {};

    if (!Array.isArray(embedding1) || !Array.isArray(embedding2)) {
      return res.status(400).json({ error: 'embedding1 and embedding2 must be arrays' });
    }
    if (embedding1.length !== embedding2.length || embedding1.length === 0) {
      return res.status(400).json({ error: 'Embeddings must be non-empty and equal length' });
    }

    // Cosine similarity
    let dot = 0, norm1 = 0, norm2 = 0;
    for (let i = 0; i < embedding1.length; i++) {
      dot   += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }
    const similarity = norm1 > 0 && norm2 > 0
      ? dot / (Math.sqrt(norm1) * Math.sqrt(norm2))
      : 0;

    const activeThreshold = selfLearningService.getThreshold();
    const same_vehicle = similarity >= activeThreshold;
    const confidence   = similarity >= (activeThreshold + 0.07) ? 'high'
                        : similarity >= activeThreshold ? 'medium'
                        : similarity >= Math.max(0, activeThreshold - 0.15) ? 'low'
                        : 'different';

    return res.json({
      similarity: Math.round(similarity * 10000) / 10000,  // 4 decimal places
      same_vehicle,
      confidence,
      threshold_used: Math.round(activeThreshold * 10000) / 10000,
      self_learning_enabled: selfLearningService.enabled,
      interpretation:
        same_vehicle
          ? `Same vehicle detected (similarity ${(similarity * 100).toFixed(1)}%)`
          : `Different vehicle or vehicle moved (similarity ${(similarity * 100).toFixed(1)}%)`,
    });

  } catch (error) {
    console.error('❌ /infer/compare error:', error);
    return res.status(500).json({ error: 'Comparison failed', message: error.message });
  }
});

// Collect labeled outcomes so similarity threshold can self-adjust over time.
app.post('/learn/compare-feedback', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const similarity = Number(req.body?.similarity);
    const actualSameVehicle = req.body?.actual_same_vehicle;
    const context = req.body?.context || {};

    if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) {
      return res.status(400).json({ error: 'similarity must be a number between 0 and 1' });
    }

    if (typeof actualSameVehicle !== 'boolean') {
      return res.status(400).json({ error: 'actual_same_vehicle must be a boolean' });
    }

    const learningResult = selfLearningService.applyCompareFeedback({
      similarity,
      actual_same_vehicle: actualSameVehicle,
      context,
    });

    return res.json({
      success: true,
      learning: learningResult,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to apply learning feedback', message: error.message });
  }
});

app.get('/learn/state', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  return res.json({
    success: true,
    learning: selfLearningService.getState(),
  });
});

// ============================================================================
// POST /infer/face — Face detection + embedding
//
// Detects human faces in a photo and generates a 384-D MobileNetV3 embedding
// suitable for cosine-similarity comparison via /infer/compare.
//
// Detection pipeline (in order of preference):
//   1. UltraFace-640 ONNX (version-RFB-640.onnx) — fast, private, on-device
//      Returns bboxes + confidence. Descriptions (age/gender) added via OpenAI if available.
//   2. OpenAI vision API — full detection + description (if ONNX unavailable)
//   3. Degraded: face_count=0 (if neither is available)
//
// Embedding: MobileNetV3 run on the primary face crop (or full image).
//
// Multipart body: photo (image/jpeg|png|webp)
// Response:
//   { face_count, faces[], embedding, embedding_quality, metadata }
//   Each face: { bbox:{x,y,width,height}|null, confidence, approximate_age,
//                gender, description }
//   bbox coords are normalised fractions (0-1) of the image dimensions.
// ============================================================================
app.post('/infer/face', inferenceRateLimit, upload.single('photo'), requireInferenceAuth, async (req, res) => {
  const startTime = Date.now();
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    const imageBuffer = req.file.buffer;
    let faces = [];
    let detectionMethod = 'none';

    // ── Step 1a: UltraFace-640 ONNX (preferred — fast, private) ──────────────
    const onnxDetections = await detectFacesWithONNX(imageBuffer);
    const onnxAvailable  = onnxDetections !== null;

    if (onnxDetections && onnxDetections.length > 0) {
      // Build face objects with placeholder descriptions; enrich with OpenAI below
      faces = onnxDetections.map(det => ({
        bbox:            det.bbox,
        confidence:      det.confidence,
        approximate_age: 'unknown',
        gender:          'unknown',
        description:     null,
      }));
      detectionMethod = 'onnx_ultraface';
    }

    // ── Step 1b: OpenAI vision — enrich descriptions or full fallback ─────────
    // Runs when:
    //   • ONNX found faces → enrich age/gender/description for each face
    //   • ONNX unavailable OR found 0 faces → full detection + description
    if (OPENAI_ENABLED && (faces.length > 0 || !onnxAvailable)) {
      try {
        const visionResult = await detectFacesWithOpenAI(imageBuffer);
        if (visionResult) {
          if (faces.length > 0 && visionResult.faces.length > 0) {
            // Enrich ONNX detections with OpenAI descriptions.
            // Simple approach: match by spatial proximity (nearest centroid).
            const enriched = faces.map(onnxFace => {
              const onnxCx = (onnxFace.bbox.x + onnxFace.bbox.width  / 2);
              const onnxCy = (onnxFace.bbox.y + onnxFace.bbox.height / 2);
              let   best   = null;
              let   bestDist = Infinity;
              for (const oaiFace of visionResult.faces) {
                if (!oaiFace.bbox) continue;
                const cx   = oaiFace.bbox.x + oaiFace.bbox.width  / 2;
                const cy   = oaiFace.bbox.y + oaiFace.bbox.height / 2;
                const dist = Math.hypot(cx - onnxCx, cy - onnxCy);
                if (dist < bestDist) { bestDist = dist; best = oaiFace; }
              }
              return {
                ...onnxFace,
                approximate_age: best?.approximate_age ?? 'unknown',
                gender:          best?.gender          ?? 'unknown',
                description:     best?.description     ?? null,
              };
            });
            faces = enriched;
            detectionMethod = 'onnx_ultraface+openai_description';
          } else if (faces.length === 0) {
            // ONNX found nothing — use OpenAI result as authoritative
            faces = visionResult.faces;
            detectionMethod = 'openai_vision';
          }
        }
      } catch (err) {
        console.warn('⚠️ /infer/face OpenAI enrichment failed (non-fatal):', err.message);
      }
    }

    // ── Step 2: Generate MobileNetV3 embedding ────────────────────────────────
    // Run on the primary face crop when a bbox is available, else full image.
    let embedding      = null;
    let embeddingQuality = null;
    const embeddingAvailable = !!embeddingSession;

    if (embeddingSession) {
      try {
        let pixelBbox = null;
        if (faces.length > 0 && faces[0].bbox) {
          const meta = await sharp(imageBuffer).metadata();
          const imgW = meta.width  || 640;
          const imgH = meta.height || 640;
          const nb   = faces[0].bbox;
          pixelBbox  = {
            x:      nb.x      * imgW,
            y:      nb.y      * imgH,
            width:  nb.width  * imgW,
            height: nb.height * imgH,
          };
        }
        const embeddingInput  = await preprocessForEmbedding(imageBuffer, pixelBbox);
        const embeddingResult = await generateEmbedding(embeddingInput);
        embedding        = embeddingResult.embedding;
        embeddingQuality = embeddingResult.quality;
      } catch (err) {
        console.warn('⚠️ /infer/face embedding generation failed (non-fatal):', err.message);
      }
    }

    const duration = Date.now() - startTime;
    return res.json({
      face_count:        faces.length,
      faces,
      embedding,
      embedding_quality: embeddingQuality,
      metadata: {
        detection_method:    detectionMethod,
        processing_time_ms:  duration,
        onnx_face_model:     onnxAvailable,
        onnx_embedding:      embeddingAvailable,
        openai_available:    OPENAI_ENABLED,
        embedding_available: embedding !== null,
      },
    });
  } catch (error) {
    console.error('❌ /infer/face error:', error);
    return res.status(500).json({ error: 'Face detection failed', message: error.message });
  }
});

// Health check
app.get('/health', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const modelsLoaded = !!(yoloSession && embeddingSession);
  res.json({
    status: 'healthy',
    models: {
      yolo: yoloSession ? 'loaded' : 'not loaded',
      embedding: embeddingSession ? 'loaded' : 'not loaded',
      face_detect: faceDetectSession ? 'loaded' : (fs.existsSync(FACE_DETECT_MODEL_PATH) ? 'not loaded' : 'not present'),
    },
    config: {
      VEHICLE_ATTRS_PROVIDER,
      VEHICLE_ATTRS_PROVIDER_RAW,
      TABULAR_NLP_PROVIDER,
      TABULAR_NLP_PROVIDER_RAW,
      CHAT_PROVIDER,
      CHAT_PROVIDER_RAW,
      SELF_CONTAINED_MODE,
      SELF_LEARNING_ENABLED,
      SELF_HEALING_ENABLED,
      INTEL_SIGNING_REQUIRED: !!INTEL_HMAC_KEY,
      SUPABASE_JWKS_CONFIGURED: !!SUPABASE_JWKS_URL,
      SUPABASE_JWT_ISSUER_CONFIGURED: !!SUPABASE_JWT_ISSUER,
      SUPABASE_JWT_AUDIENCE_CONFIGURED: !!SUPABASE_JWT_AUDIENCE,
      OPENAI_BASE_URL_CUSTOM: OPENAI_BASE_URL !== 'https://api.openai.com/v1',
      OPENAI_MODEL: OPENAI_MODEL || null,
      OPENAI_API_KEY_SET: OPENAI_ENABLED,
      INFERENCE_API_KEY_SET: !!INFERENCE_API_KEY,
      SUPABASE_SERVICE_ROLE_KEY_SET: !!SUPABASE_SERVICE_ROLE_KEY,
    },
    capabilities: {
      plate_inference: modelsLoaded,
      ai_attributes: VEHICLE_ATTRS_PROVIDER === 'openai' && OPENAI_ENABLED,
      tabular_nlp: true,
      tabular_nlp_ollama_enabled: OLLAMA_ENABLED,
      chat: true,
      chat_local_ollama_enabled: CHAT_PROVIDER === 'ollama' && OLLAMA_ENABLED,
      chat_heuristic_enabled: CHAT_PROVIDER === 'heuristic',
      self_healing_bug_assistant: SELF_HEALING_ENABLED,
      local_intel_updates: true,
      tabular_nlp_auth_api_key: !!INFERENCE_API_KEY,
      tabular_nlp_auth_supabase_jwt: !!SUPABASE_JWKS_URL,
      tabular_nlp_auth_service_role: !!SUPABASE_SERVICE_ROLE_KEY,
      self_learning: selfLearningService.enabled,
      compare_threshold: Math.round(selfLearningService.getThreshold() * 10000) / 10000,
      // Self-hosted ALPR
      local_alpr: true,                          // always available (tesseract.js)
      local_alpr_plate_model: fs.existsSync(PLATE_DETECT_MODEL_PATH),
      cloud_alpr_enabled: CLOUD_ALPR_ENABLED,
      chalk_valve_ai: VEHICLE_ATTRS_PROVIDER === 'openai' && OPENAI_ENABLED,
      // Face recognition
      face_detection: OPENAI_ENABLED || fs.existsSync(FACE_DETECT_MODEL_PATH),
      face_detection_onnx: fs.existsSync(FACE_DETECT_MODEL_PATH), // UltraFace-640
      face_embedding: modelsLoaded,              // MobileNetV3 embedding for comparison
    },
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Egress audit endpoint (requires the same auth as protected inference routes).
app.get('/audit/egress', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  res.json({
    success: true,
    audit: egressAudit,
  });
});

// Error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
loadModels().then(() => {
  if (REQUIRE_SELF_CONTAINED_MODE && !SELF_CONTAINED_MODE) {
    console.error('❌ REQUIRE_SELF_CONTAINED_MODE is true but SELF_CONTAINED_MODE is not enabled. Refusing to start.');
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ORC/AI inference service running on port ${PORT}`);
    // Config summary — makes misconfiguration visible at a glance in Railway logs
    const usesOllama = VEHICLE_ATTRS_PROVIDER === 'ollama' || TABULAR_NLP_PROVIDER === 'ollama';
    const usesOpenAI = (VEHICLE_ATTRS_PROVIDER === 'openai' || TABULAR_NLP_PROVIDER === 'openai') && OPENAI_ENABLED;
    console.log(`⚙️  Config:`, {
      VEHICLE_ATTRS_PROVIDER,
      TABULAR_NLP_PROVIDER,
      TABULAR_NLP_TIMEOUT_MS,
      SELF_CONTAINED_MODE,
      ...(usesOllama && { OLLAMA_BASE_URL, OLLAMA_MODEL }),
      INFERENCE_API_KEY_SET: !!INFERENCE_API_KEY,
      SUPABASE_SERVICE_ROLE_KEY_SET: !!SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_JWKS_URL: SUPABASE_JWKS_URL || '(not set)',
      SUPABASE_JWT_ISSUER: SUPABASE_JWT_ISSUER || '(not set)',
      ...(SUPABASE_JWT_AUDIENCE && { SUPABASE_JWT_AUDIENCE }),
      ...(usesOpenAI && {
        OPENAI_BASE_URL: OPENAI_BASE_URL || '(not set)',
        OPENAI_MODEL: OPENAI_MODEL || '(not set)',
        OPENAI_API_KEY_SET: OPENAI_ENABLED,
      }),
    });
    if (!INFERENCE_API_KEY && !SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('⚠️  No static auth configured (INFERENCE_API_KEY and SUPABASE_SERVICE_ROLE_KEY are both unset).');
      console.warn('   Authenticated endpoints (/infer/face, /infer/compare, /infer/alpr, /nlp/tabular/analyze, /chat, /self-heal/bug-report, /self-heal/knowledge, /self-heal/patch-task, /intel/ingest-bulletin, /intel/state)');
      console.warn('   will only accept valid Supabase user JWTs (Bearer token verified against JWKS).');
      console.warn('   Edge functions cannot call these endpoints without a user JWT.');
      console.warn('   Fix: set SUPABASE_SERVICE_ROLE_KEY environment variable to enable service-to-service auth.');
    }
    if (yoloSession && embeddingSession) {
      console.log(`📡 Ready to process vehicle photos — YOLO + embedding models loaded`);
    } else {
      console.log(`⚠️  Running in degraded mode — ONNX models NOT loaded`);
      console.log(`   /infer returns 503. Fix: ensure model files (yolov8n.onnx, mobilenetv3.onnx) are present at startup.`);
      console.log(`   Vehicle attributes via OpenAI will still work if VEHICLE_ATTRS_PROVIDER=openai`);
    }
    if (fs.existsSync(FACE_DETECT_MODEL_PATH)) {
      console.log(`🧠 UltraFace-640 face detection model present — will load on first /infer/face request`);
    } else {
      console.log(`ℹ️  UltraFace-640 not present (models/version-RFB-640.onnx). Face detection will use OpenAI vision fallback.`);
      console.log(`   Run: node scripts/download-models.js   to download all optional models.`);
    }
    if (SELF_CONTAINED_MODE) {
      console.log('🔒 SELF_CONTAINED_MODE enabled — outbound cloud AI/ALPR providers are disabled.');
      if (TABULAR_NLP_PROVIDER === 'ollama' && !OLLAMA_ENABLED) {
        console.log('ℹ️  OLLAMA_BASE_URL is non-local; tabular analysis will use heuristic mode.');
      }
    }
  });
});
