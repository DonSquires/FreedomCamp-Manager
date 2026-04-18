/**
 * ORC/AI Inference Service
 * Vehicle Detection + Embedding Generation + Face Recognition + UI Assessment + Stack Navigation + NZ Legal Framework
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
 * - POST /assess/ui  - Analyze component code for layout, a11y, design consistency
 * - POST /assess/ui/screenshot - Analyze UI screenshot for colours, contrast, aesthetics
 * - POST /assess/ui/colours - Check colour palette contrast ratios (WCAG)
 * - POST /assess/ui/trace - Trace UI element behaviour (button → handler → API → DB)
 * - GET  /assess/ui/design-system - Get FieldOps design system reference
 * - GET  /navigate/stack-map - Full stack topology and debugging playbook
 * - GET  /navigate/route - Look up route details by path
 * - POST /navigate/debug - Get debugging steps for a described symptom
 * - GET  /legal/framework - NZ legal framework overview (all acts)
 * - GET  /legal/act/:key - Detailed view of a specific NZ act
 * - GET  /legal/guardrails - AI guardrails (G1-G12) Bob and Ollama must follow
 * - POST /legal/check - Check a proposed action against NZ legal guardrails
 * - POST /assess/ptt - Diagnose PTT (Push-to-Talk) issues from symptom description
 * - POST /assess/platform - Diagnose infrastructure platform issues (Supabase, Railway, Vercel, etc.)
 * - POST /infer/biosecurity - NZ biosecurity plant ID (Nassella neesiana / CNG) + density + checklist
 * - POST /infer/smoke - NZ RMA smoke complaint assessment + prohibited materials + checklist
 * - POST /infer/noise-audio - NZ noise complaint street-level audio assessment + matrix prefill
 * - GET  /platform/:key - Get Bob's knowledge about a specific platform
 * - GET  /platform/stack - Get full hybrid stack overview
 * - POST /ask-copilot - Queue a knowledge request for Copilot to research
 * - GET  /ask-copilot/pending - List unanswered knowledge requests (for Copilot workflow)
 * - GET  /ask-copilot - List all knowledge requests
 * - POST /ask-copilot/:id/answer - Receive a researched answer back from Copilot
 * - DELETE /ask-copilot/:id - Remove a knowledge request
 * - POST /code/assist - Natural language coding question → template + steps
 * - GET  /code/patterns - All code pattern templates (page, hook, edge function, migration, etc.)
 * - GET  /code/conventions - Naming conventions, TypeScript config, roles, timezone
 * - GET  /code/tasks - Step-by-step guides for common coding tasks
 * - GET  /code/tech-stack - Full tech stack reference
 * - GET  /code/layout - Project directory layout
 * - GET  /code/build - Build and dev commands
 * - GET  /code/file-guide - File-to-feature mapping
 * - POST /code/task - Submit a code-writing task for Bob to plan + workflow to execute
 * - GET  /code/tasks/pending - List pending code tasks (for ops-bob-code-task workflow)
 * - GET  /code/tasks - List all code tasks (filter ?status=pending|in_progress|completed|failed)
 * - GET  /code/tasks/:id - Get a single code task
 * - POST /code/tasks/:id/start - Mark a task in_progress (workflow picked it up)
 * - POST /code/tasks/:id/result - Record successful PR creation
 * - POST /code/tasks/:id/fail - Record task failure
 * - POST /code/tasks/:id/skip - Manually skip a pending task
 * - DELETE /code/tasks/:id - Remove a task
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
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { createSelfLearningService } = require('./lib/self-learning');
const { profileExamples } = require('./lib/pretrain-profiles');
const { buildSelfHealingPlan, buildPatchTask, getKnowledgePacks } = require('./lib/assistant-knowledge');
const { createIntelStore } = require('./lib/intel-updates');
const { analyzeComponentCode, analyzeScreenshot, assessColourPalette, identifyLayoutPattern, DESIGN_SYSTEM } = require('./lib/ui-assessment');
const { traceUIElement, getStackMap, findRoute, getDebuggingSteps, ROUTE_MAP, DEBUGGING_PLAYBOOK } = require('./lib/stack-navigation');
const { checkLegalCompliance, getLegalFramework, getLegalDetail, AI_LEGAL_GUARDRAILS } = require('./lib/nz-legal-framework');
const { getPlatformKnowledge, diagnosePlatformIssue, getHybridStackOverview, RAILWAY_SERVICES_AUDIT } = require('./lib/platform-knowledge');
const { createKnowledgeRequestStore } = require('./lib/knowledge-requests');
const { createCodeTaskStore } = require('./lib/code-tasks');
const { identifyPlants, getWeatherForLocation: getBioWeather } = require('./lib/biosecurity-inference');
const { assessSmoke } = require('./lib/smoke-inference');
const {
  getTechStack, getProjectLayout, getBuildCommands, getCodePattern,
  getAllPatterns, getConventions, getCommonTask, getAllCommonTasks,
  getFileGuide, answerCodingQuestion,
  TECH_STACK, CODE_PATTERNS, CONVENTIONS, COMMON_TASKS,
} = require('./lib/coding-knowledge');

const execFileAsync = promisify(execFile);

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

function envFlag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function normalizeOperatingMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (['self-contained', 'self_contained', 'strict', 'production'].includes(raw)) {
    return 'self-contained';
  }
  if (['build-training', 'build_training', 'training', 'connected', 'connected-assistant'].includes(raw)) {
    return 'build-training';
  }
  return null;
}

const YOLO_INPUT_SIZE = 640;
const VEHICLE_ATTRS_PROVIDER_RAW = (process.env.VEHICLE_ATTRS_PROVIDER || 'basic').toLowerCase();
const VEHICLE_ATTRS_PROVIDER = normalizeProvider(VEHICLE_ATTRS_PROVIDER_RAW, 'basic');
// OpenAI — kept ONLY for the opt-in VEHICLE_ATTRS_PROVIDER=openai feature.
// It is intentionally NOT used for chat, tender generation, or any document
// writing tasks. Bob and Ollama handle all document/AI tasks in-house.
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ATTR_TIMEOUT_MS = Number(process.env.ATTR_TIMEOUT_MS || 2500);
const TABULAR_NLP_PROVIDER_RAW = (process.env.TABULAR_NLP_PROVIDER || 'heuristic').toLowerCase();
const TABULAR_NLP_PROVIDER = normalizeProvider(TABULAR_NLP_PROVIDER_RAW, 'heuristic');
const CHAT_PROVIDER_RAW = (process.env.CHAT_PROVIDER || 'ollama').toLowerCase();
const CHAT_PROVIDER = normalizeProvider(CHAT_PROVIDER_RAW, 'heuristic');
const HEURISTIC_PLAYBOOK_MODE = (process.env.HEURISTIC_PLAYBOOK_MODE || 'compact').toLowerCase();
const CHAT_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 60000);
const TABULAR_NLP_TIMEOUT_MS = Number(process.env.TABULAR_NLP_TIMEOUT_MS || 2500);
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_BASE_URL_CONFIGURED = !!process.env.OLLAMA_BASE_URL;
// When OLLAMA_GATEWAY_KEY is set, all requests to Ollama include an Authorization header.
// This is used when OLLAMA_BASE_URL points at the RunPod gateway (runpod-gateway/).
const OLLAMA_GATEWAY_KEY = process.env.OLLAMA_GATEWAY_KEY || '';
const OLLAMA_GATEWAY_HEADERS = OLLAMA_GATEWAY_KEY
  ? { Authorization: `Bearer ${OLLAMA_GATEWAY_KEY}` }
  : {};
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL || OLLAMA_MODEL;
const TRANSLATION_TIMEOUT_MS = Number(process.env.TRANSLATION_TIMEOUT_MS || 20000);
// OLLAMA_MODEL_WRITING — specialist model for tender/document generation.
// Can be a larger or writing-focused model pulled into the same Ollama instance
// (e.g. qwen2.5:14b, mistral:7b, llama3.3:70b). Falls back to OLLAMA_MODEL
// if not set or not available. Run: ollama pull <model> on the Ollama service.
const OLLAMA_MODEL_WRITING = process.env.OLLAMA_MODEL_WRITING || OLLAMA_MODEL;
// OLLAMA_VISION_MODEL — multimodal model for photo analysis (vehicle attrs,
// biosecurity plant ID, smoke assessment). Must support the Ollama /api/chat
// images[] field (e.g. llama3.2-vision:11b, llava:13b).
// Leave unset to disable Ollama-based vision (features fall back to OpenAI or manual).
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || '';
const OLLAMA_VISION_ENABLED = !!OLLAMA_VISION_MODEL;
const WHISPER_SERVICE_URL = (process.env.WHISPER_SERVICE_URL || '').replace(/\/+$/, '');

/**
 * ollamaFetch — thin wrapper around fetch that injects OLLAMA_GATEWAY_HEADERS
 * so every outbound call to Ollama goes through the RunPod gateway auth layer
 * when OLLAMA_GATEWAY_KEY is configured.
 */
function ollamaFetch(url, options = {}) {
  const headers = { ...(options.headers || {}), ...OLLAMA_GATEWAY_HEADERS };
  return fetch(url, { ...options, headers });
}

const WHISPER_CLI_PATH = process.env.WHISPER_CLI_PATH || '';
const WHISPER_MODEL_PATH = process.env.WHISPER_MODEL_PATH || '';
const AUDIO_TRANSCRIBE_TIMEOUT_MS = Number(process.env.AUDIO_TRANSCRIBE_TIMEOUT_MS || 15000);
const AUDIO_SYNTH_TIMEOUT_MS = Number(process.env.AUDIO_SYNTH_TIMEOUT_MS || 15000);
const TTS_ENGINE = (process.env.TTS_ENGINE || 'espeak-ng').toLowerCase();
const TTS_DEFAULT_VOICE = process.env.TTS_DEFAULT_VOICE || 'en-nz';
const TTS_DEFAULT_RATE = Number(process.env.TTS_DEFAULT_RATE || 160);
const PTT_SERVER_URL = (process.env.PTT_SERVER_URL || '').replace(/\/+$/, '');
const OLLAMA_AUTO_PULL_MODELS = envFlag(process.env.OLLAMA_AUTO_PULL_MODELS, true);
const OLLAMA_PULL_TIMEOUT_MS = Number(process.env.OLLAMA_PULL_TIMEOUT_MS || 120000);
// SECONDARY_ASSISTANT_URL — optional second Railway-hosted AI service for
// document generation when the primary Ollama model isn't sufficient.
// Can be another Bob instance running a larger Ollama model, or a dedicated
// Railway writing-model service. Must expose POST /tender/generate.
// Example: https://bob-writer-production-xxxx.up.railway.app
const SECONDARY_ASSISTANT_URL = (process.env.SECONDARY_ASSISTANT_URL || '').replace(/\/+$/, '');
const SECONDARY_ASSISTANT_API_KEY = process.env.SECONDARY_ASSISTANT_API_KEY || '';
const SECONDARY_ASSISTANT_TIMEOUT_MS = Number(process.env.SECONDARY_ASSISTANT_TIMEOUT_MS || 90000);
// Accept any ollama.railway.internal URL regardless of port — the actual
// listening port on the Ollama service may differ from the default 11434
// (e.g. if OLLAMA_HOST is set to 0.0.0.0:8080 on the Ollama Railway service).
const REQUIRED_OLLAMA_BASE_URL = process.env.REQUIRED_OLLAMA_BASE_URL || 'http://ollama.railway.internal:11434';
function isRailwayOllamaInternal(url) {
  try { return new URL(url).hostname === 'ollama.railway.internal'; } catch { return false; }
}

function modelLooksPresent(availableModels, expectedModel) {
  if (!Array.isArray(availableModels) || !expectedModel) return false;
  const expected = String(expectedModel).trim().toLowerCase();
  if (!expected) return false;
  const expectedBase = expected.split(':')[0];
  return availableModels.some((name) => {
    const n = String(name || '').toLowerCase();
    return n === expected || n.startsWith(`${expectedBase}:`) || n === expectedBase;
  });
}

async function ensureOllamaModelPulled(modelName) {
  const model = String(modelName || '').trim();
  if (!model) return false;

  const pullController = new AbortController();
  const pullTimeout = setTimeout(() => pullController.abort(), OLLAMA_PULL_TIMEOUT_MS);
  try {
    const resp = await ollamaFetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false }),
      signal: pullController.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`⚠️  Auto-pull failed for model "${model}": HTTP ${resp.status} ${text.slice(0, 200)}`);
      return false;
    }

    console.log(`✅ Auto-pulled missing Ollama model: ${model}`);
    return true;
  } catch (err) {
    const msg = err?.name === 'AbortError'
      ? `timed out after ${Math.round(OLLAMA_PULL_TIMEOUT_MS / 1000)}s`
      : (err?.message || String(err));
    console.warn(`⚠️  Auto-pull failed for model "${model}": ${msg}`);
    return false;
  } finally {
    clearTimeout(pullTimeout);
  }
}
const DEPLOY_SIGNATURE = 'bob-self-contained-hardlock-v1';
const SOURCE_VERSION = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_VERSION || process.env.GITHUB_SHA || '';
const LEGACY_SELF_CONTAINED_MODE = envFlag(process.env.SELF_CONTAINED_MODE, true);
const LEGACY_REQUIRE_SELF_CONTAINED_MODE = envFlag(process.env.REQUIRE_SELF_CONTAINED_MODE, true);
const LEGACY_SELF_CONTAINED_STRICT_EGRESS = envFlag(process.env.SELF_CONTAINED_STRICT_EGRESS, true);
const CONFIGURED_OPERATING_MODE = normalizeOperatingMode(process.env.BOB_OPERATING_MODE || process.env.OPERATIONAL_MODE);
const OPERATING_MODE = CONFIGURED_OPERATING_MODE || (LEGACY_SELF_CONTAINED_MODE ? 'self-contained' : 'build-training');
const SELF_CONTAINED_MODE = OPERATING_MODE === 'self-contained';
const REQUIRE_SELF_CONTAINED_MODE = CONFIGURED_OPERATING_MODE
  ? OPERATING_MODE === 'self-contained'
  : LEGACY_REQUIRE_SELF_CONTAINED_MODE;
const SELF_LEARNING_ENABLED = envFlag(process.env.SELF_LEARNING_ENABLED, true);
const SELF_HEALING_ENABLED = envFlag(process.env.SELF_HEALING_ENABLED, true);
const INTEL_STATE_PATH = process.env.INTEL_STATE_PATH || path.join(__dirname, 'data', 'intel-state.json');
const INTEL_HMAC_KEY = process.env.INTEL_HMAC_KEY || '';
const SELF_LEARNING_STATE_PATH = process.env.SELF_LEARNING_STATE_PATH || path.join(__dirname, 'data', 'self-learning-state.json');
const DOCTOR_AUDIT_PATH = process.env.DOCTOR_AUDIT_PATH || path.join(__dirname, 'data', 'doctor-audit-log.json');
const DOCTOR_AUDIT_MAX_ENTRIES = Number(process.env.DOCTOR_AUDIT_MAX_ENTRIES || 500);
const DOCTOR_AUTO_HEAL_ENABLED = envFlag(process.env.DOCTOR_AUTO_HEAL_ENABLED, true);
const DOCTOR_AUTO_HEAL_INTERVAL_MS = Math.max(30_000, Number(process.env.DOCTOR_AUTO_HEAL_INTERVAL_MS || 120_000));
const DOCTOR_AUTO_HEAL_COOLDOWN_MS = Math.max(60_000, Number(process.env.DOCTOR_AUTO_HEAL_COOLDOWN_MS || 300_000));
const SIMILARITY_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD || 0.85);
const SIMILARITY_THRESHOLD_MIN = Number(process.env.SIMILARITY_THRESHOLD_MIN || 0.65);
const SIMILARITY_THRESHOLD_MAX = Number(process.env.SIMILARITY_THRESHOLD_MAX || 0.95);
const SELF_LEARNING_RATE = Number(process.env.SELF_LEARNING_RATE || 0.025);
const SELF_LEARNING_PRETRAIN_PROFILE = (process.env.SELF_LEARNING_PRETRAIN_PROFILE || 'nz-enforcement-v1').toLowerCase();
const SELF_LEARNING_PRETRAIN_MULTIPLIER = Math.max(1, Number(process.env.SELF_LEARNING_PRETRAIN_MULTIPLIER || 12));
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
    const host = url.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === 'ollama' ||
      host.endsWith('.railway.internal')
    );
  } catch {
    return false;
  }
}

const SELF_CONTAINED_STRICT_EGRESS = CONFIGURED_OPERATING_MODE
  ? OPERATING_MODE === 'self-contained'
  : SELF_CONTAINED_MODE && LEGACY_SELF_CONTAINED_STRICT_EGRESS;

function assertEgressAllowed(url, providerLabel = 'unknown') {
  if (!SELF_CONTAINED_STRICT_EGRESS) return;
  // In strict self-contained mode, Ollama is only allowed on local/private hosts.
  if (providerLabel === 'ollama') {
    if (isLocalUrl(url)) return;
    recordEgressEvent(providerLabel, 'blocked', `Strict self-contained egress policy blocked non-local Ollama URL: ${url}`);
    throw new Error(`Outbound network blocked in SELF_CONTAINED_MODE: ${url}`);
  }
  if (!isLocalUrl(url)) {
    recordEgressEvent(providerLabel, 'blocked', `Strict self-contained egress policy blocked URL: ${url}`);
    throw new Error(`Outbound network blocked in SELF_CONTAINED_MODE: ${url}`);
  }
}

async function safeFetch(url, options, providerLabel = 'unknown') {
  assertEgressAllowed(url, providerLabel);
  // Inject gateway auth header for all requests to Ollama
  if (OLLAMA_GATEWAY_KEY && String(url).startsWith(OLLAMA_BASE_URL)) {
    const headers = { ...(options?.headers || {}), ...OLLAMA_GATEWAY_HEADERS };
    return fetch(url, { ...(options || {}), headers });
  }
  return fetch(url, options);
}

const OPENAI_ENABLED = !SELF_CONTAINED_MODE && !!OPENAI_API_KEY;
// Ollama is allowed in self-contained mode when the URL is local/internal OR
// when OLLAMA_GATEWAY_KEY is set (RunPod gateway — private key-authenticated, not open internet).
const OLLAMA_URL_TRUSTED = isLocalUrl(OLLAMA_BASE_URL) || !!OLLAMA_GATEWAY_KEY;
const OLLAMA_VISION_ACTIVE = OLLAMA_VISION_ENABLED && (!SELF_CONTAINED_MODE || OLLAMA_URL_TRUSTED);
const CLOUD_ALPR_ENABLED = !SELF_CONTAINED_MODE && !!process.env.PLATERECOGNIZER_TOKEN;
const OLLAMA_REQUESTED = TABULAR_NLP_PROVIDER === 'ollama' || CHAT_PROVIDER === 'ollama';
const OLLAMA_ENABLED = OLLAMA_REQUESTED && (!SELF_CONTAINED_MODE || OLLAMA_URL_TRUSTED);
// Secondary Railway assistant — allowed as long as we have a URL+key and it's
// reachable (either via Railway internal network or in non-strict mode)
const SECONDARY_ASSISTANT_ENABLED = !!SECONDARY_ASSISTANT_URL && !!SECONDARY_ASSISTANT_API_KEY;


// ---------------------------------------------------------------------------
// Ollama circuit breaker – avoids log spam when Ollama is unreachable.
// After OLLAMA_CB_THRESHOLD consecutive failures the circuit "opens" and all
// requests short-circuit to the heuristic fallback for OLLAMA_CB_COOLDOWN_MS,
// after which a single probe request is allowed through ("half-open").
// ---------------------------------------------------------------------------
const OLLAMA_CB_THRESHOLD  = Number(process.env.OLLAMA_CB_THRESHOLD  || 3);
const OLLAMA_CB_COOLDOWN_MS = Number(process.env.OLLAMA_CB_COOLDOWN_MS || 60000);

const ollamaCircuitBreaker = {
  failures:   0,
  state:      'closed',   // closed | open | half-open
  openedAt:   0,
  lastError:  null,

  /** Record a successful Ollama call – resets the breaker. */
  recordSuccess() {
    if (this.failures > 0 || this.state !== 'closed') {
      console.log('✅ Ollama circuit breaker reset — connection restored');
    }
    this.failures  = 0;
    this.state     = 'closed';
    this.openedAt  = 0;
    this.lastError = null;
  },

  /** Record a failed Ollama call – may trip the breaker. */
  recordFailure(error) {
    this.failures += 1;
    const code = error?.cause?.code || error?.code || '';
    this.lastError = code ? `${error?.message || String(error)} [${code}]` : (error?.message || String(error));
    if (this.state === 'half-open') {
      // Probe failed — re-open the circuit for another cooldown period
      this.state    = 'open';
      this.openedAt = Date.now();
      console.warn(
        `🔌 Ollama circuit breaker re-OPEN — probe failed ` +
        `(${OLLAMA_BASE_URL}). Will retry in ${OLLAMA_CB_COOLDOWN_MS / 1000}s.`
      );
    } else if (this.failures >= OLLAMA_CB_THRESHOLD && this.state === 'closed') {
      this.state    = 'open';
      this.openedAt = Date.now();
      console.warn(
        `🔌 Ollama circuit breaker OPEN after ${this.failures} consecutive failures ` +
        `(${OLLAMA_BASE_URL}). Will retry in ${OLLAMA_CB_COOLDOWN_MS / 1000}s. ` +
        `Last error: ${this.lastError}`
      );
    }
  },

  /**
   * Returns true if the request should be allowed through.
   * Transitions open → half-open after cooldown expires.
   */
  allowRequest() {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= OLLAMA_CB_COOLDOWN_MS) {
        this.state = 'half-open';
        console.log('🔄 Ollama circuit breaker HALF-OPEN — allowing probe request');
        return true;
      }
      return false;
    }
    // half-open: allow one probe
    return true;
  },

  /** Snapshot for /health and diagnostics. */
  toJSON() {
    return {
      state:             this.state,
      consecutiveFailures: this.failures,
      lastError:         this.lastError,
      openedAt:          this.openedAt ? new Date(this.openedAt).toISOString() : null,
      threshold:         OLLAMA_CB_THRESHOLD,
      cooldownMs:        OLLAMA_CB_COOLDOWN_MS,
    };
  },

  /** Force-trip the breaker into open state (e.g. startup probe failure). */
  trip(error) {
    this.failures  = OLLAMA_CB_THRESHOLD;
    this.lastError = error?.message || String(error);
    this.state     = 'open';
    this.openedAt  = Date.now();
  },
};

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

if (!INTEL_HMAC_KEY) {
  console.warn('⚠️  INTEL_HMAC_KEY not set — bulletin signature verification disabled. Set INTEL_HMAC_KEY to enforce HMAC signing on /intel/ingest-bulletin.');
}

function buildRecentIntelContext(limit = 6) {
  const state = intelStore.getState();
  const bulletins = Array.isArray(state?.bulletins) ? state.bulletins.slice(-limit) : [];

  if (!bulletins.length) {
    return 'No curated intel bulletins are currently loaded.';
  }

  return bulletins.map((bulletin, index) => {
    const type = String(bulletin?.type || 'other').trim();
    const title = String(bulletin?.title || '').trim();
    const summary = String(bulletin?.summary || '').trim();
    return `${index + 1}. [${type}] ${title}: ${summary}`;
  }).join('\n');
}

function isTrainingFocusedQuery(message) {
  const lowered = String(message || '').toLowerCase();
  return [
    'build review',
    'training',
    'lint',
    'chunk',
    'remediation',
    'blocker',
    'privacy-safe review',
    'review order',
  ].some((token) => lowered.includes(token));
}

function answerFromTrainingIntel(message) {
  if (!isTrainingFocusedQuery(message)) return null;

  const lowered = String(message || '').toLowerCase();
  const intelState = intelStore.getState();
  const bulletins = Array.isArray(intelState?.bulletins) ? intelState.bulletins : [];
  if (!bulletins.length) return null;

  if ((lowered.includes('order') || lowered.includes('short list')) && lowered.includes('build review')) {
    return [
      '1. Critical release blockers',
      '2. Performance risks',
      '3. Reliability and maintainability risks',
      '4. Privacy checks before release',
      '5. 14-day remediation plan with owners',
    ].join('\n');
  }

  if (lowered.includes('acceptance') || lowered.includes('go-live')) {
    return [
      'Acceptance gate before go-live:',
      '- Lint errors must be 0',
      '- Build must succeed',
      '- Chunk strategy must exist for large routes',
      '- Bob review score must be at least 9 across 3 consecutive runs',
      '- Training loop must require no outbound dependency',
    ].join('\n');
  }

  if (lowered.includes('policy') || lowered.includes('self-contained') || lowered.includes('privacy-safe')) {
    return [
      'Internal training policy:',
      '- Bob must run in self-contained mode only',
      '- No external API calls for training or inference',
      '- Use internal evidence only such as build logs, lint logs, and repository context',
      '- Strip sensitive values from prompts and logs before storage',
    ].join('\n');
  }

  return bulletins.map((bulletin) => `${bulletin.title}: ${bulletin.summary}`).join('\n\n');
}

const knowledgeRequestsStore = createKnowledgeRequestStore(
  process.env.KNOWLEDGE_REQUESTS_PATH || path.join(__dirname, 'data', 'knowledge-requests.json')
);

const codeTaskStore = createCodeTaskStore(
  process.env.CODE_TASKS_PATH || path.join(__dirname, 'data', 'code-tasks.json')
);

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

function getWhisperAvailability() {
  return {
    cli_configured: !!WHISPER_CLI_PATH,
    cli_present: !!WHISPER_CLI_PATH && fs.existsSync(WHISPER_CLI_PATH),
    model_configured: !!WHISPER_MODEL_PATH,
    model_present: !!WHISPER_MODEL_PATH && fs.existsSync(WHISPER_MODEL_PATH),
  };
}

function getTtsAvailability() {
  const espeakPath = '/usr/bin/espeak-ng';
  return {
    engine: TTS_ENGINE,
    available: TTS_ENGINE === 'espeak-ng' && fs.existsSync(espeakPath),
    voice: TTS_DEFAULT_VOICE,
  };
}

async function convertAudioToWav(audioBuffer, extension = 'bin') {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-convert-'));
  const inputPath = path.join(tempDir, `input.${extension || 'bin'}`);
  const outputPath = path.join(tempDir, 'output.wav');
  try {
    fs.writeFileSync(inputPath, audioBuffer);
    await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', outputPath], {
      timeout: AUDIO_TRANSCRIBE_TIMEOUT_MS,
    });
    return fs.readFileSync(outputPath);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

function resolveAudioExtension(mimeType = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  return 'bin';
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

function round4(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

function safeEventKey(value) {
  const key = String(value || '').trim();
  if (!key) return null;
  return key.slice(0, 240);
}

function buildInferenceAdvice(payload = {}) {
  const pipeline = String(payload.pipeline || 'vehicle_infer');
  const degraded = Boolean(payload.degraded);
  const detectionConfidence = clamp01(payload.detectionConfidence);
  const embeddingQuality = clamp01(payload.embeddingQuality);
  const similarity = clamp01(payload.similarity);
  const thresholdUsed = clamp01(payload.thresholdUsed);
  const sameVehicle = typeof payload.sameVehicle === 'boolean' ? payload.sameVehicle : null;

  if (degraded) {
    return {
      risk_level: 'high',
      summary: 'Degraded inference mode: confidence is reduced and manual review is required.',
      recommended_actions: [
        'Require manual evidence review before enforcement action.',
        'Capture an additional image from a second angle.',
        'Record degraded-mode reason in investigation notes.',
      ],
      training_signal_recommended: true,
    };
  }

  if (pipeline === 'compare' && similarity !== null && thresholdUsed !== null) {
    const margin = Math.abs(similarity - thresholdUsed);
    if (margin < 0.03) {
      return {
        risk_level: 'medium',
        summary: 'Similarity is close to threshold; same/different decision is borderline.',
        recommended_actions: [
          'Request operator confirmation for same-vehicle classification.',
          'Capture a second comparison frame before issuing penalties.',
          'Submit learning feedback to improve threshold calibration.',
        ],
        training_signal_recommended: true,
      };
    }

    if (sameVehicle === true) {
      return {
        risk_level: margin >= 0.08 ? 'low' : 'medium',
        summary: 'Same-vehicle match is supported by similarity margin above threshold.',
        recommended_actions: [
          'Proceed with standard recheck workflow.',
          'Log confidence and threshold values for audit traceability.',
        ],
        training_signal_recommended: margin < 0.08,
      };
    }

    return {
      risk_level: margin >= 0.08 ? 'low' : 'medium',
      summary: 'Different-vehicle outcome is supported by similarity margin below threshold.',
      recommended_actions: [
        'Treat as a new vehicle event unless external evidence contradicts result.',
        'Retain comparison metrics in compliance notes.',
      ],
      training_signal_recommended: margin < 0.08,
    };
  }

  if (detectionConfidence !== null && detectionConfidence < 0.6) {
    return {
      risk_level: 'medium',
      summary: 'Vehicle detection confidence is below preferred operating threshold.',
      recommended_actions: [
        'Re-capture image with better framing and lighting.',
        'Avoid auto-escalation until confidence improves.',
        'Submit operator feedback if final decision is verified manually.',
      ],
      training_signal_recommended: true,
    };
  }

  if (embeddingQuality !== null && embeddingQuality < 0.4) {
    return {
      risk_level: 'medium',
      summary: 'Embedding quality is low and may weaken downstream similarity checks.',
      recommended_actions: [
        'Capture another image with clearer vehicle crop.',
        'Use manual verification for match-critical decisions.',
      ],
      training_signal_recommended: true,
    };
  }

  return {
    risk_level: 'low',
    summary: 'Inference confidence is within normal operational ranges.',
    recommended_actions: [
      'Proceed with normal workflow and retain audit metadata.',
    ],
    training_signal_recommended: false,
  };
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

  if (!ollamaCircuitBreaker.allowRequest()) {
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
      ollamaCircuitBreaker.recordFailure(new Error(`HTTP ${response.status}`));
      return heuristic;
    }

    const payload = await response.json();
    const content = payload?.message?.content;
    if (!content || typeof content !== 'string') {
      return heuristic;
    }

    const parsed = JSON.parse(content);
    ollamaCircuitBreaker.recordSuccess();
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
    ollamaCircuitBreaker.recordFailure(error);
    if (ollamaCircuitBreaker.state === 'open') {
      // First time tripping — the breaker itself already logged the details
    } else {
      console.warn(`⚠️ Tabular NLP via Ollama failed (${OLLAMA_BASE_URL}):`, error.message);
    }
    return heuristic;
  } finally {
    clearTimeout(timeout);
  }
}

// Build the prompt Bob sends to Ollama when generating an initial code plan for a task
function buildCodePlanPrompt(task, context, targetFiles) {
  const lines = [
    `Task: ${task}`,
  ];
  if (context) lines.push(`Context: ${context}`);
  if (Array.isArray(targetFiles) && targetFiles.length) {
    lines.push(`Target files: ${targetFiles.join(', ')}`);
  }
  lines.push('');
  lines.push('FieldOps codebase conventions:');
  lines.push('- React 18 + TypeScript + Vite + Tailwind CSS v3 + shadcn/ui. State: Zustand + TanStack Query v5. Forms: react-hook-form + zod.');
  lines.push('- Pages in src/pages/, hooks in src/hooks/, stores in src/stores/. Path alias @/* → ./src/*.');
  lines.push('- Supabase client: import { supabase } from "@/lib/supabase". Typed with Database from @/types/database.');
  lines.push('- Edge Functions: supabase/functions/<name>/index.ts, Deno runtime, withCors from ../_shared/withCors.ts.');
  lines.push('- Migrations: supabase/migrations/YYYYMMDD_HHMMSS_description.sql. RLS required on every table.');
  lines.push('- TypeScript: noImplicitAny=false, strictNullChecks=false. Do NOT tighten.');
  lines.push('- shadcn/ui components from @/components/ui/. Never re-implement them.');
  return lines.join('\n');
}

function generateHeuristicChatReply(message, context = {}) {
  const text = String(message || '').trim();
  if (!text) {
    return 'Please share a question or instruction so I can help.';
  }

  const lowered = text.toLowerCase();
  const trainingReply = answerFromTrainingIntel(text);
  if (trainingReply) {
    return trainingReply;
  }

  const useLegacyPlaybook =
    HEURISTIC_PLAYBOOK_MODE === 'legacy' ||
    context?.legacy_playbook === true;

  if (lowered.includes('can you hear me') || lowered.includes('can you hear') || lowered.includes('hear me')) {
    return 'I receive voice input as transcribed text from the app. I cannot hear live audio directly, but I can respond to what your mic capture sends here.';
  }
  if (
    lowered.includes('internet') ||
    lowered.includes('browse') ||
    lowered.includes('google') ||
    lowered.includes('web search') ||
    lowered.includes('access the web')
  ) {
    return 'I do not have open web browsing in this chat mode. I can use in-platform knowledge and diagnostics, and I can guide you to the exact official NZ source to verify current rules.';
  }
  if (
    lowered.includes('look at the feedback page') ||
    lowered.includes('open the feedback page') ||
    lowered.includes('check the feedback page') ||
    lowered.includes('can you see the page')
  ) {
    return 'I cannot click through pages directly from chat. If you share what you see on the feedback page (error text, screenshot, or steps), I can diagnose it and give the exact fix path.';
  }
  if (lowered.includes('status') || lowered.includes('health')) {
    return 'Service is running in self-contained mode. I can help with patrol workflows, plate checks, compliance process guidance, and UI assessment.';
  }
  if (lowered.includes('privacy') || lowered.includes('data')) {
    return 'This deployment is configured for local processing. External cloud calls are blocked by strict self-contained egress policy.';
  }
  if (lowered.includes('plate') || lowered.includes('rego')) {
    return 'I can assist with plate workflow guidance. Upload evidence through the enforcement workflow and I can help summarize next steps.';
  }

  // Compact fallback mode (default) keeps Bob aligned with trained behavior
  // and prevents stale endpoint/playbook dumps from overriding conversation.
  // Set HEURISTIC_PLAYBOOK_MODE=legacy (or context.legacy_playbook=true) to
  // re-enable the full historical rulebook below.
  if (!useLegacyPlaybook) {
    try {
      knowledgeRequestsStore.queueRequest(text, { source: 'heuristic-chat-fallback', context: context?.page || null });
    } catch (err) {
      console.warn('Failed to queue knowledge request:', err.message);
    }

    return 'I can help with this. Share the exact symptom, page/route, and expected behaviour, and I will give a focused diagnostic plan. I have queued this question for Copilot research so the answer is added to my intel feed.';
  }

  // UI/UX design domain
  if (lowered.includes('design system') || lowered.includes('theme') || lowered.includes('color') || lowered.includes('colour')) {
    return 'FieldOps uses a Tailwind CSS + shadcn/ui design system with HSL CSS variables. Four themes: light, dark, high-contrast, and night-patrol. Primary is teal (187°), accent is amber (48°), destructive is red. Use POST /assess/ui to analyze component code, or POST /assess/ui/colours to check contrast ratios.';
  }
  if (lowered.includes('accessibility') || lowered.includes('a11y') || lowered.includes('wcag') || lowered.includes('screen reader')) {
    return 'FieldOps targets WCAG AA compliance. Requirements: 4.5:1 contrast for text, 3:1 for large text. Use ARIA attributes, semantic HTML (<section>, <nav>, <main>), visible labels on all inputs, focus-visible rings for keyboard navigation, and sr-only for screen-reader-only text. Night-patrol mode needs 56px button height for gloved use.';
  }
  if (lowered.includes('layout') || lowered.includes('responsive') || lowered.includes('mobile') || lowered.includes('breakpoint')) {
    return 'FieldOps uses mobile-first responsive design. Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px). Dashboard pattern: grid-cols-1 sm:grid-cols-2 lg:grid-cols-4. Forms need visible labels, not placeholder-only. Tables need overflow-x-auto on mobile. Use POST /assess/ui with component code for detailed layout analysis.';
  }
  if (lowered.includes('night patrol') || lowered.includes('dark mode') || lowered.includes('night mode')) {
    return 'Night-patrol mode: pure black background (3% lightness), bright cyan primary for max legibility, 56px min button height, 52px min input height, 17px base font. Designed for officers wearing gloves in low-light. Applied via class="night-patrol" on <html> alongside "dark".';
  }
  if (lowered.includes('ui') || lowered.includes('component') || lowered.includes('button') || lowered.includes('card') || lowered.includes('form') || lowered.includes('table')) {
    return 'I can assess UI components for human-friendliness. Use POST /assess/ui with {code: "..."} to analyze JSX/TSX source code. I evaluate accessibility (35%), responsiveness (30%), and design consistency (35%). I also identify layout patterns (dashboard, form, list, detail, map) and provide actionable recommendations. Use POST /assess/ui/trace with {code: "..."} to trace what a button/link/form does — I follow the chain from onClick handler to Supabase query to database table.';
  }
  if (lowered.includes('screenshot') || lowered.includes('visual') || lowered.includes('aesthetic')) {
    return 'I can analyze UI screenshots for aesthetics. Use POST /assess/ui/screenshot with a screenshot file. I evaluate colour harmony, whitespace balance (15-40% ideal), WCAG contrast, and visual complexity. The analysis includes specific recommendations for improvement.';
  }

  // Navigation and debugging domain
  if (lowered.includes('route') || lowered.includes('navigate') || lowered.includes('page') || lowered.includes('path')) {
    return 'I know the full FieldOps route map. Use GET /navigate/route?path=/vehicles to look up any route — I will tell you the target component, required roles, and description. Use GET /navigate/stack-map for the full system topology from UI through to database. There are 60+ routes in App.tsx with ProtectedRoute, RoleRoute, and AreaRoute guards.';
  }
  if (lowered.includes('debug') || lowered.includes('fix') || lowered.includes('error') || lowered.includes('broken') || lowered.includes('not working') || lowered.includes('issue')) {
    return 'I can help debug FieldOps issues. Use POST /navigate/debug with {symptom: "button not working"} and I will give you step-by-step debugging instructions. I know common failure patterns: button not clickable (check disabled/onClick/mutation), link 404 (check route path), form error (check zod/RLS), blank page (check hook errors), data not loading (check RLS/filters/auth). I can also trace any UI element — POST /assess/ui/trace with the component code.';
  }
  if (lowered.includes('stack') || lowered.includes('architecture') || lowered.includes('how does') || lowered.includes('topology')) {
    return 'FieldOps stack: React UI (src/pages/) → Zustand + TanStack Query hooks (src/hooks/) → Supabase client (src/lib/supabase.ts) → Postgres with RLS (supabase/migrations/) → Edge Functions (supabase/functions/) → Bob inference on Railway (inference-service/). CI/CD via GitHub Actions (.github/workflows/). Use GET /navigate/stack-map for the full interactive topology.';
  }
  if (lowered.includes('supabase') || lowered.includes('database') || lowered.includes('rls') || lowered.includes('migration')) {
    return 'FieldOps uses Supabase Postgres with Row Level Security on every table. Key tables: vehicles, observations, zones, breaches, enforcement_actions, patrols, users, organizations. Types are generated in src/types/database.ts. Migrations in supabase/migrations/ (70+ files). Edge Functions in supabase/functions/ (70+ functions). All queries go through the typed Supabase client in src/lib/supabase.ts.';
  }
  if (lowered.includes('railway') || lowered.includes('deploy') || lowered.includes('ci') || lowered.includes('github action')) {
    const auditSummary = RAILWAY_SERVICES_AUDIT.known_issues_resolved.map(i => `[${i.id}] ${i.title} — ${i.fix_applied}`).join(' | ');
    return `FieldOps Railway services: Bob (inference-service/, deploy-bob-railway.yml), Proxy (proxy-server/, deploy-proxy-railway.yml), PTT (ptt-server/, deploy-ptt-railway.yml), Ollama (ollama/, deploy-ollama-railway.yml). Bob and Ollama share one Railway project for private networking (OLLAMA_BASE_URL=http://ollama.railway.internal:11434). Production Bob must have CHAT_PROVIDER=ollama, TABULAR_NLP_PROVIDER=ollama, SELF_CONTAINED_MODE=true. Check config via GET /health. Use GET /platform/railway-audit for full audit findings (${RAILWAY_SERVICES_AUDIT.known_issues_resolved.length} resolved issues). Quick summary: ${auditSummary}`;
  }
  if (lowered.includes('hook') || lowered.includes('query') || lowered.includes('mutation') || lowered.includes('tanstack') || lowered.includes('zustand')) {
    return 'Data flow: Components use TanStack Query hooks (src/hooks/useXxx.ts) for server state. useQuery fetches data with automatic caching. useMutation writes data and invalidates queries on success. Zustand stores (src/stores/) hold auth state (authStore.ts) and global filters (globalFiltersStore.ts). The Supabase client is typed with Database types from src/types/database.ts.';
  }

  // PTT (Push-to-Talk) domain — specific patterns first, general catch-all last
  if (lowered.includes('ptt connect') || lowered.includes('ptt unavailable') || lowered.includes('ptt error') || lowered.includes('ptt disconnect')) {
    return 'PTT connection troubleshooting: (1) Check ptt-signaling-token Edge Function is deployed. (2) Verify PTT_SERVER_URL set in Supabase secrets. (3) Check ptt-server /health on Railway. (4) PTT_JWT_SECRET and PROXY_SECRET must match on both Edge Function and ptt-server. (5) User must be authenticated with valid organization_id. (6) Token errors (4001/4002) mean re-login needed. (7) 4003 = channel full (>50 users). (8) "Unable to reach edge function" = Edge Function not deployed. Run set-ptt-secret.yml workflow to configure.';
  }
  if (lowered.includes('ptt server') || lowered.includes('signaling server') || (lowered.includes('signaling') && lowered.includes('ptt'))) {
    return 'PTT signaling server: ptt-server/ directory (Node.js + Express + ws). Railway deployment via Dockerfile. Env vars: PTT_JWT_SECRET (required), PROXY_SECRET (required), PORT (auto), TURN_URL/USERNAME/CREDENTIAL (optional for NAT traversal). WebSocket path: /ws?token=<jwt>. Messages: start_speaking, stop_speaking, signal (WebRTC SDP/ICE), status, ping/pong. Half-duplex enforced server-side. In-memory state (single instance; Redis for multi-instance scaling). Health: GET /health.';
  }
  if (lowered.includes('vox') || lowered.includes('voice activated') || lowered.includes('voice operated')) {
    return 'VOX (Voice Operated Exchange) mode: Auto-transmits when voice level exceeds threshold. Uses AudioContext + AnalyserNode to monitor audio level at 50ms intervals. Threshold configurable 0-100 (default in PTT settings popover). 500ms silence delay before stopping. Start: startVoxMonitoring() → creates audio context → checks level vs threshold → auto-calls startSpeaking()/stopSpeaking(). Adjust threshold lower (20-30%) for quiet speakers, higher (50-70%) for noisy environments.';
  }
  if (lowered.includes('bluetooth') || lowered.includes('headset') || lowered.includes('hardware button')) {
    return 'Bluetooth PTT: Uses Media Session API to capture hardware play/pause/stop buttons on Bluetooth headsets. initBluetoothPTT() plays silent audio loop to keep Media Session active, then maps play→startSpeaking, pause/stop→stopSpeaking. Requires user interaction to activate (click "Enable Bluetooth" in PTT settings). getBluetoothDevices() enumerates audio input devices with bluetooth/wireless/headset in label. Cleanup: cleanupBluetoothPTT() removes all handlers.';
  }
  if ((lowered.includes('microphone') || lowered.includes('mic')) && (lowered.includes('ptt') || lowered.includes('push to talk') || lowered.includes('speak'))) {
    return 'PTT audio: Microphone access uses getUserMedia({audio: {echoCancellation, noiseSuppression, autoGainControl}}). Audio clips recorded via MediaRecorder (audio/webm;codecs=opus), max 60s / 3MB, uploaded to ptt-clips Supabase Storage bucket with 24h signed URLs. If mic denied: check chrome://settings/content/microphone. If CHANNEL_BUSY: another user is speaking — half-duplex, wait for them. If audio cuts out: check VOX threshold (lower it to 20-30%). For Bluetooth PTT: uses Media Session API — requires user interaction to activate.';
  }
  if (lowered.includes('push to talk') || lowered.includes('ptt') || lowered.includes('walkie') || lowered.includes('voice chat')) {
    return 'Push-to-Talk (PTT) stack: PTTBar.tsx (UI) → ptt.ts (WebSocket + WebRTC) → pttBackground.ts (auto-connect) → pttStore.ts (Zustand) → ptt-signaling-token Edge Function → ptt-server on Railway (WebSocket signaling). Channel scopes: org:<uuid>, team:<uuid>, deployment:<uuid>, incident:<uuid>, direct:<uuid>. Input modes: PTT (hold to talk), Toggle (click), VOX (voice-activated). Half-duplex — one speaker at a time. PTTBar is used in TeamChat and OfficerHomePage. Use POST /assess/ptt with {symptom: "..."} to diagnose PTT issues.';
  }
  if (lowered.includes('websocket') || lowered.includes('webrtc') || lowered.includes('signaling')) {
    return 'PTT signaling server: ptt-server/ directory (Node.js + Express + ws). Railway deployment via Dockerfile. Env vars: PTT_JWT_SECRET (required), PROXY_SECRET (required), PORT (auto), TURN_URL/USERNAME/CREDENTIAL (optional for NAT traversal). WebSocket path: /ws?token=<jwt>. Messages: start_speaking, stop_speaking, signal (WebRTC SDP/ICE), status, ping/pong. Half-duplex enforced server-side. In-memory state (single instance; Redis for multi-instance scaling). Health: GET /health.';
  }

  // NZ legal domain
  if (lowered.includes('privacy act') || lowered.includes('ipp') || lowered.includes('personal information') || lowered.includes('privacy breach')) {
    return 'Privacy Act 2020 has 13 Information Privacy Principles (IPPs). Key: minimise collection (IPP 1), ensure security (IPP 5), limit use (IPP 10), limit disclosure (IPP 11), restrict cross-border transfers (IPP 12). Mandatory breach reporting for serious harm — notify Privacy Commissioner and affected individuals. Bob processes ALPR/face data under IPP 1 (necessary for enforcement) with audit logs (IPP 5). Use GET /legal/act/privacy_act_2020 for full details, or POST /legal/check to validate any action.';
  }
  if (lowered.includes('bill of rights') || lowered.includes('nzbora') || lowered.includes('human rights') || lowered.includes('natural justice')) {
    return 'NZBORA 1990 affirms fundamental rights. Key for enforcement: freedom of movement (s 18), unreasonable search protection (s 21), right to natural justice (s 27). Enforcement officers cannot detain — only Police have arrest powers. Automated breach detection must allow human review. All enforcement must be proportionate. Use GET /legal/act/nzbora_1990 for full details.';
  }
  if (lowered.includes('rma') || lowered.includes('resource management') || lowered.includes('environment')) {
    return 'RMA 1991: sustainable management of natural resources. Freedom camping must not cause environmental damage (waste, contamination). Māori cultural sites and wāhi tapu need special consideration. Enforcement data should track environmental impact alongside stay-limit breaches. Use GET /legal/act/rma_1991 for full details.';
  }
  if (lowered.includes('police') || lowered.includes('arrest') || lowered.includes('detain') || lowered.includes('force')) {
    return 'Policing Act 2008: Only NZ Police have arrest/detention/force powers — camping enforcement officers cannot arrest, detain, or use force. Involve Police for: threats of violence, criminal damage, refusal to identify (FCA s 27), stolen vehicles, drug offences, welfare concerns. Share only necessary information and log all disclosures. Use GET /legal/act/policing_act_2008 for full details.';
  }
  if (lowered.includes('nzdf') || lowered.includes('defence') || lowered.includes('military')) {
    return 'NZDF considerations: Defence land is outside council jurisdiction (managed under Defence Act 1990). NZDF may assist in civil emergencies. Military personnel subject to NZ law including Privacy Act and NZBORA. Do not share surveillance data with NZDF without authorisation. Security perimeters around facilities may restrict nearby camping. Use GET /legal/act/nzdf for full details.';
  }
  if (lowered.includes('evidence') || lowered.includes('admissib') || lowered.includes('chain of custody') || lowered.includes('court')) {
    return 'Evidence Act 2006: Computer-generated evidence (ALPR, breach detection) is admissible if system reliability is established (s 137). Chain of custody must be documented. Improperly obtained evidence may be excluded (s 30). Bob maintains audit trails with algorithm version, input data, and confidence scores. Photo evidence preserves original metadata. Use GET /legal/act/evidence_act_2006 for full details.';
  }
  if (lowered.includes('search') || lowered.includes('surveillance') || lowered.includes('alpr') || lowered.includes('camera')) {
    return 'Search and Surveillance Act 2012: Observation from public places is lawful — no warrant needed. ALPR scanning from public roads is lawful (plates are publicly visible). Photography from public land is lawful. Entering vehicles/tents requires warrant or consent. Covert surveillance (hidden cameras, tracking) requires authorisation. GPS tracking of officers is lawful with employer notice. Use GET /legal/act/search_surveillance_2012.';
  }
  if (lowered.includes('freedom camping act') || lowered.includes('fca') || lowered.includes('bylaw') || lowered.includes('infringement')) {
    return 'Freedom Camping Act 2011: Camping is permitted unless restricted by bylaw. Officers can issue infringement notices (≤$200), NTV, request name/address. Officers CANNOT arrest, detain, use force, or enter vehicles. Bylaws vary by council — zone rules are district-specific. SCV certification under NZS 5465:2001 can grant exemptions. Seizure/impounding requires specific grounds and judicial oversight. Use GET /legal/act/freedom_camping_act_2011.';
  }
  if (lowered.includes('guardrail') || lowered.includes('legal check') || lowered.includes('compliance check') || lowered.includes('lawful')) {
    return 'Bob follows 12 AI legal guardrails (G1-G12): privacy by design, lawful evidence only, human review required, proportionate enforcement, no Police powers, full audit trail, no cross-border leakage, data security, breach notification, respect for rights, not legal advice, vulnerable persons consideration. Use POST /legal/check with {description: "proposed action"} to check any action against these guardrails. Use GET /legal/guardrails for the full list.';
  }
  if (lowered.includes('oia') || lowered.includes('official information') || lowered.includes('information request')) {
    return 'OIA 1982: Public can request official information from local authorities within 20 working days. Enforcement data, patrol logs, and compliance stats may be subject to OIA requests. Data must be stored in retrievable format. Personal information should be separable for redaction. Do not delete data that may be subject to OIA requests. Use GET /legal/act/oia_1982 for full details.';
  }
  if (lowered.includes('vulnerable') || lowered.includes('homeless') || lowered.includes('welfare') || lowered.includes('special consideration')) {
    return 'Guardrail G12 — vulnerable persons: When encountering homeless individuals, families with young children, elderly, or disabled persons, consider welfare referrals before enforcement. These situations may require social services rather than infringement notices. Bob flags vulnerable person indicators and recommends proportionate responses. This aligns with NZBORA s 27 (natural justice) and operational policy.';
  }
  if (lowered.includes('law') || lowered.includes('legal') || lowered.includes('legislation') || lowered.includes('act')) {
    return 'I know NZ law relevant to freedom camping enforcement: Privacy Act 2020, NZBORA 1990, Freedom Camping Act 2011, Local Government Act 2002, RMA 1991, Search and Surveillance Act 2012, Evidence Act 2006, Policing Act 2008, Criminal Procedure Act 2011, Harmful Digital Communications Act 2015, OIA 1982, and NZDF considerations. Use GET /legal/framework for overview, GET /legal/act/{key} for details, POST /legal/check to validate actions. All guidance is operational — not formal legal advice.';
  }

  // Platform infrastructure domain
  if (lowered.includes('supabase') && (lowered.includes('function') || lowered.includes('edge'))) {
    return 'Supabase Edge Functions: 47 functions in supabase/functions/<name>/index.ts. Deno runtime. Must handle OPTIONS preflight. CORS via _shared/withCors.ts. Secrets via Supabase Dashboard → Settings → Edge Functions. Deploy: supabase functions deploy <name> --project-ref kxwjcupuxnnbnzcgmkoi. Key shared modules: withCors.ts (CORS), compliance.ts (breach calc), alpr.ts (plate recognition), orgConfig.ts (SMTP). Use POST /assess/platform with {symptom:"..."} to diagnose.';
  }
  if (lowered.includes('supabase') || (lowered.includes('rls') || lowered.includes('row level security') || lowered.includes('postgres') || lowered.includes('migration'))) {
    return 'Supabase: project ref kxwjcupuxnnbnzcgmkoi, AWS ap-southeast-2 (Sydney), PostgreSQL 17. Auth JWT 3600s expiry, token rotation on. RLS on every table — auth.uid() + organization_id. 70+ migrations in supabase/migrations/ (YYYYMMDD_* prefix). Apply: supabase db push. Types: supabase gen types typescript → src/types/database.ts. Connection pooler (Transaction mode) for Edge Functions. Anon key (RLS-enforced) for frontend; service role (bypasses RLS) for Edge Functions only. Use GET /platform/supabase for full knowledge. Use POST /assess/platform with {symptom:"..."} to diagnose.';
  }
  if ((lowered.includes('railway') && !lowered.includes('ptt server')) || lowered.includes('dockerfile') || lowered.includes('oom') || lowered.includes('health check') && lowered.includes('service')) {
    return 'Railway services: Bob (inference-service/, port 3000, 60s health), Proxy (proxy-server/, port 3000), PTT (ptt-server/, port 3002), Ollama (ollama/, port 11434). All must listen on process.env.PORT. Bob → Ollama via http://ollama.railway.internal:11434 (private network). Ollama pinned v0.20.2 (OLLAMA_HOST=0.0.0.0:11434). Bob needs 1GB+ RAM for ONNX. Tokens: RAILWAY_BOB_TOKEN (Bob+Ollama), RAILWAY_TOKEN (Proxy+PTT). Deploy via GitHub Actions workflows. Use GET /platform/railway for full knowledge.';
  }
  if (lowered.includes('github action') || lowered.includes('workflow') || lowered.includes('ci/cd') || lowered.includes('codespace')) {
    return 'GitHub: 25 Actions workflows in .github/workflows/. Deploy: frontend (Vercel), Bob/Ollama/PTT/Proxy (Railway), mobile (EAS), Edge Functions (Supabase). Database: db-push.yml (requires @DonSquires approval). Ops crons: Bob feedback 03:47 NZST, self-learning pretrain 04:21 NZST, intel every 6h. Codespaces: Node 22, Bun, Supabase CLI, Deno (ports: 5173/3000/3002/8080). bun.lock must be committed or Railway deploy fails. Bob sync: sync-bob-repo.yml → DonSquires/Bob. Use GET /platform/github for full knowledge.';
  }
  if (lowered.includes('vercel') || (lowered.includes('frontend') && lowered.includes('deploy'))) {
    return 'Vercel hosts the React/Vite SPA. Build: bun run build → dist/. SPA rewrite: all routes → /index.html. Security headers: HSTS 1yr, X-Frame-Options:DENY, CSP (connect-src: *.supabase.co wss: *.railway.app). Environments: production (VITE_SUPABASE_URL_PRODUCTION) and preview (VITE_SUPABASE_URL_PREVIEW). Domain: fcmanager.co.nz. DNS: CNAME www → cname.vercel-dns.com. Client env vars must be prefixed VITE_. Use GET /platform/vercel for full knowledge.';
  }
  if (lowered.includes('expo') || lowered.includes('mobile app') || lowered.includes('eas build') || (lowered.includes('mobile') && lowered.includes('deploy'))) {
    return 'Expo/EAS mobile app in mobile-app/. EAS project: 9ec25722-38ca-44d3-a8f5-62a8d8a64e6d. Android: com.ironeagle.fieldops.manager. Plugins: expo-camera, expo-location, expo-notifications, expo-secure-store. Build: eas build --platform android --profile production. OTA: eas update --channel production. Deploy workflow: deploy-mobile.yml. Keystore: ops-generate-keystore.yml. PTT on mobile uses Expo Audio + WebSocket. Use GET /platform/expo for full knowledge.';
  }
  if (lowered.includes('smtp') || lowered.includes('email') || (lowered.includes('mail') && !lowered.includes('gmail'))) {
    return 'Email: Zoho SMTP (smtp.zoho.com:465, SSL) for global send. Use App-Specific Password (not account password). Resend API (RESEND_API_KEY in Supabase secrets) for transactional email. Per-org SMTP stored encrypted in DB, retrieved via _shared/orgConfig.ts. Auth templates in supabase/templates/ (invite, recovery, confirmation, magic_link). DNS: SPF (include:zoho.com), DKIM from Zoho/Resend dashboard, DMARC. Zoho limit: ~200/day free. Use Resend for high volume. Use GET /platform/email for full knowledge.';
  }
  if ((lowered.includes('domain') || lowered.includes('dns') || lowered.includes('ssl') || lowered.includes('cors')) && !lowered.includes('ptt')) {
    return 'Domain: fcmanager.co.nz (.co.nz via NZRS). Vercel CNAME: www.fcmanager.co.nz → cname.vercel-dns.com. A record: @ → 76.76.21.21. SSL: Let\'s Encrypt auto-managed by Vercel. Supabase redirect_urls: fcmanager.co.nz, www, *.onspace.build, *.vercel.app, localhost:5173/3000. CORS allowlist in _shared/withCors.ts (DEV_CORS=true for local). Adding new domain: (1) Supabase redirect_urls, (2) CORS allowlist, (3) DNS records, (4) SSL. Use GET /platform/domain for full knowledge.';
  }
  if (lowered.includes('hybrid') || lowered.includes('architecture') || lowered.includes('stack overview') || lowered.includes('how everything') || lowered.includes('all the pieces')) {
    return 'FieldOps hybrid stack: Web (React → Vercel) + Mobile (Expo → EAS) → Supabase BaaS (auth/DB/47 Edge Functions/Storage) + Railway microservices (Bob/Proxy/PTT/Ollama). CI/CD: 25 GitHub Actions. Plate scan: Mobile → Edge Function → Proxy → NZSCV → observation → compliance check → breach. AI: Photo → Bob ONNX → plate result. PTT: Button → Edge Function → PTT server JWT → WebSocket → WebRTC audio. Self-learning: nightly GitHub Actions → Bob /learn/pretrain. Similar: ParkPow, Genetec, Axon Field, Parking+Plus NZ. Use GET /platform/stack for full architecture overview.';
  }
  if (lowered.includes('platform') || lowered.includes('infrastructure') || lowered.includes('hosting')) {
    return 'FieldOps infrastructure: Vercel (frontend SPA), Supabase (auth/DB/Edge Functions/Storage, project kxwjcupuxnnbnzcgmkoi), Railway (Bob/Proxy/PTT/Ollama microservices), GitHub Actions (25 CI/CD workflows), Expo EAS (mobile builds). Primary domain: fcmanager.co.nz. Email: Zoho SMTP + Resend. Use GET /platform/:key for knowledge on supabase/railway/github/vercel/expo/domain/email. Use POST /assess/platform with {symptom:"..."} to diagnose. Use POST /ask-copilot to queue questions Bob cannot answer.';
  }
  if (lowered.includes('ask copilot') || lowered.includes('knowledge request') || lowered.includes('learn') || lowered.includes('don\'t know') || lowered.includes('not sure')) {
    return 'Bob can queue knowledge requests for Copilot to research. Use POST /ask-copilot with {question: "...", category: "supabase|railway|github|vercel|expo|domain|email|ptt|general"} to submit a question. Copilot\'s ops-bob-ask-copilot.yml workflow polls GET /ask-copilot/pending hourly, researches answers via GitHub Models API, and sends answers back via POST /ask-copilot/:id/answer — which auto-ingests the knowledge into Bob\'s intel feed. Check status: GET /ask-copilot. Answered knowledge is available via /intel/state.';
  }

  // ---------------------------------------------------------------------------
  // Coding domain — FieldOps codebase patterns and conventions
  // ---------------------------------------------------------------------------
  if (lowered.includes('tech stack') || lowered.includes('what technology') || (lowered.includes('what') && lowered.includes('built with'))) {
    const s = TECH_STACK;
    return `FieldOps Manager tech stack: ${s.frontend.framework} + ${s.frontend.language} + ${s.frontend.bundler} + ${s.frontend.styling} + ${s.frontend.components}. State: ${s.frontend.state}. Forms: ${s.frontend.forms}. Routing: ${s.frontend.routing}. Package manager: ${s.package_manager}. Backend: ${s.backend.platform} (${s.backend.database}, Edge Functions, Auth, Storage). Services on Railway: ${s.services.inference}, ${s.services.proxy}, ${s.services.ptt}. Frontend hosted on Vercel, mobile on ${s.hosting.mobile}. Use GET /code/tech-stack for full details or POST /code/assist with {question:"..."} for coding guidance.`;
  }
  if ((lowered.includes('create') || lowered.includes('add') || lowered.includes('build') || lowered.includes('make')) && lowered.includes('page')) {
    const steps = COMMON_TASKS.add_page.join(' ');
    return `To add a new page in FieldOps: ${steps} Pattern: export default function MyPage() { const { user } = useAuthStore(); ... return <div className="p-6">...</div> }. Import shadcn/ui from @/components/ui/. Add route in App.tsx with RoleRoute. Run bun run build to check. Use POST /code/assist with {question:"create page"} for the full template.`;
  }
  if ((lowered.includes('create') || lowered.includes('add') || lowered.includes('write') || lowered.includes('make')) && (lowered.includes('hook') || lowered.includes('usequery') || lowered.includes('data fetch'))) {
    const steps = COMMON_TASKS.add_hook.join(' ');
    return `To create a hook in FieldOps (src/hooks/useMyData.ts): ${steps} Pattern: import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"; import { supabase } from "@/lib/supabase"; export function useMyData({ organizationId }) { return useQuery({ queryKey: ["table", organizationId], queryFn: async () => { const { data, error } = await supabase.from("table").select("*"); if (error) throw error; return data; } }); } Use POST /code/assist with {question:"create hook"} for the full template.`;
  }
  if ((lowered.includes('create') || lowered.includes('add') || lowered.includes('write')) && (lowered.includes('edge function') || lowered.includes('supabase function') || lowered.includes('deno function'))) {
    const steps = COMMON_TASKS.add_edge_function.join(' ');
    return `To create a Supabase Edge Function: ${steps} Template: import { withCors, jsonResponse, errorResponse, getCorsHeaders } from "../_shared/withCors.ts"; Deno.serve(async (req) => { if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) }); try { ... return jsonResponse({ success: true, data }, req); } catch (err) { return errorResponse(err.message, req); } }); Deploy: supabase functions deploy <name> --project-ref kxwjcupuxnnbnzcgmkoi. Use POST /code/assist with {question:"create edge function"} for the full template.`;
  }
  if ((lowered.includes('create') || lowered.includes('add') || lowered.includes('write')) && (lowered.includes('migration') || lowered.includes('table') || (lowered.includes('database') && lowered.includes('schema')))) {
    const steps = COMMON_TASKS.add_table.join(' ');
    return `To add a table/migration in FieldOps: ${steps} Pattern: File name supabase/migrations/YYYYMMDD_HHMMSS_description.sql. Include: create table public.my_table (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), ...); alter table public.my_table enable row level security; (add RLS policies). Always include organization_id for multi-tenant scoping. Use POST /code/assist with {question:"create migration"} for the full template.`;
  }
  if ((lowered.includes('create') || lowered.includes('add') || lowered.includes('write')) && lowered.includes('form')) {
    return `FieldOps forms use react-hook-form + zod. Pattern: const schema = z.object({ name: z.string().min(1) }); const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: "" } }); Return <Form {...form}><form onSubmit={form.handleSubmit(onSubmit)}><FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} /></form></Form>. Import Form, FormField, FormItem, FormLabel, FormControl, FormMessage from "@/components/ui/form". Use POST /code/assist with {question:"create form"} for the full template.`;
  }
  if ((lowered.includes('create') || lowered.includes('add') || lowered.includes('write')) && (lowered.includes('store') || lowered.includes('zustand'))) {
    return `Zustand stores live in src/stores/. Pattern: import { create } from "zustand"; import { createJSONStorage, persist } from "zustand/middleware"; export const useMyStore = create()(persist((set) => ({ value: "", setValue: (v) => set({ value: v }) }), { name: "my-store", storage: createJSONStorage(() => sessionStorage) })). Use sessionStorage not localStorage for security. Keep stores small — data fetching belongs in hooks. Use POST /code/assist with {question:"create store"} for the full template.`;
  }
  if ((lowered.includes('add') || lowered.includes('register') || lowered.includes('create')) && lowered.includes('route')) {
    return `Routes are in src/App.tsx using react-router-dom v6. Pattern: <Route path="/my-page" element={<RoleRoute roles={["admin","admin_officer","master"]}><MyPage /></RoleRoute>} />. Four roles: admin, master, officer, admin_officer. Use RoleRoute for role-gated pages, ProtectedRoute for any authenticated user, AreaRoute for portal area gates. Import your new page component at the top of App.tsx. Use POST /code/assist with {question:"add route"} for the full template.`;
  }
  if (lowered.includes('shadcn') || (lowered.includes('how') && lowered.includes('import') && (lowered.includes('button') || lowered.includes('card') || lowered.includes('component')))) {
    return `shadcn/ui components are in src/components/ui/. Import pattern: import { Button } from "@/components/ui/button"; import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"; import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog". Never re-implement them. Available: button, card, dialog, form, input, label, select, table, badge, alert, tabs, dropdown-menu, sheet, tooltip, calendar, checkbox, radio-group, switch, textarea. Feature components go in src/components/features/.`;
  }
  if (lowered.includes('typescript') && (lowered.includes('config') || lowered.includes('tsconfig') || lowered.includes('strict') || lowered.includes('setting'))) {
    return `FieldOps TypeScript config (tsconfig.app.json): noImplicitAny=false, strictNullChecks=false, skipLibCheck=true. Do NOT tighten these settings — the codebase relies on lenient TypeScript. Path alias @/* → ./src/* is defined in both tsconfig.json and vite.config.ts. Build: bun run build (runs tsc -b && vite build).`;
  }
  if ((lowered.includes('naming') || lowered.includes('convention') || lowered.includes('where to put') || lowered.includes('where should')) && (lowered.includes('file') || lowered.includes('component') || lowered.includes('hook') || lowered.includes('page'))) {
    const n = CONVENTIONS.naming;
    return `FieldOps naming conventions: ${n.pages} — ${n.hooks} — ${n.components} — ${n.stores} — ${n.edge_functions} — ${n.migrations}. Path alias @/* → ./src/*. All client env vars must be prefixed VITE_. Use POST /code/assist for code templates.`;
  }
  if (lowered.includes('path alias') || (lowered.includes('@/') && (lowered.includes('import') || lowered.includes('resolve')))) {
    return `FieldOps uses @/* → ./src/* path alias. Defined in tsconfig.json (paths) and vite.config.ts (resolve.alias). Examples: import { supabase } from "@/lib/supabase"; import { Button } from "@/components/ui/button"; import { useBreaches } from "@/hooks/useBreaches"; import { useAuthStore } from "@/stores/authStore"; import type { Database } from "@/types/database".`;
  }
  if (lowered.includes('env') && (lowered.includes('variable') || lowered.includes('var') || lowered.includes('secret'))) {
    return `FieldOps env vars: Frontend (Vercel) must be prefixed VITE_ — VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required. Edge Function secrets: supabase secrets set KEY=value --project-ref kxwjcupuxnnbnzcgmkoi. Railway service vars: set in Railway Dashboard → service → Variables. Bob service needs: INFERENCE_API_KEY, CHAT_PROVIDER=ollama, TABULAR_NLP_PROVIDER=ollama, SELF_CONTAINED_MODE=true, OLLAMA_BASE_URL=http://ollama.railway.internal:11434.`;
  }
  if (lowered.includes('bun') && (lowered.includes('install') || lowered.includes('lock') || lowered.includes('frozen'))) {
    return `bun.lock must be committed alongside package.json changes. Railway runs bun install --frozen-lockfile and will fail if bun.lock is stale or missing. Fix: run bun install (no --frozen-lockfile), commit the updated bun.lock. Verify: bun install --frozen-lockfile should output "no changes". Never use npm/yarn/pnpm in the root — use bun only.`;
  }
  if (lowered.includes('file') && (lowered.includes('guide') || lowered.includes('structure') || lowered.includes('layout') || lowered.includes('directory'))) {
    const fg = getFileGuide();
    const summary = Object.entries(fg).slice(0, 6).map(([f, d]) => `${f}: ${d}`).join('. ');
    return `FieldOps file guide: ${summary}. Use GET /code/layout for full structure, GET /code/file-guide for file-to-feature map, POST /code/assist for coding templates.`;
  }
  if (lowered.includes('rls') || (lowered.includes('row level') && lowered.includes('security'))) {
    return `Every Supabase table must have RLS enabled (alter table ... enable row level security). Policies scope by auth.uid() + organization_id. Frontend anon key respects RLS. Service role (in Edge Functions) bypasses RLS. If data is missing unexpectedly: check RLS policies in Supabase Dashboard → Table Editor → Policies. Common fix: add a SELECT policy that checks organization_id = (select organization_id from user_profiles where id = auth.uid()).`;
  }
  if (lowered.includes('code') || lowered.includes('coding') || lowered.includes('implement') || lowered.includes('develop') || lowered.includes('how do i build') || lowered.includes('how do i create')) {
    return 'I have full FieldOps coding knowledge. Use POST /code/assist with {question: "..."} for code templates and step-by-step guidance. I can help create pages (src/pages/), hooks (src/hooks/), Edge Functions (supabase/functions/), SQL migrations (supabase/migrations/), Zustand stores (src/stores/), forms (react-hook-form+zod), and routes (App.tsx). Use GET /code/patterns for all pattern templates, GET /code/conventions for naming and config rules, GET /code/tech-stack for the full stack reference.';
  }
  if (
    (lowered.includes('write') || lowered.includes('generate') || lowered.includes('build') || lowered.includes('make me')) &&
    (lowered.includes('code') || lowered.includes('page') || lowered.includes('component') || lowered.includes('hook') || lowered.includes('function') || lowered.includes('migration'))
  ) {
    return 'I can write code for you. Submit a coding task via POST /code/task with {task: "build a vehicle filter page with search and pagination", priority: "normal"}. The ops-bob-code-task workflow will generate the code using GitHub Models API with full FieldOps context, apply it to the repo, run bun run build to validate, then open a PR. Monitor progress: GET /code/tasks/pending. I also draft an initial plan with Ollama when the task is submitted.';
  }
  if (lowered.includes('code task') || lowered.includes('/code/task') || (lowered.includes('task') && lowered.includes('pr'))) {
    return 'Bob code tasks: POST /code/task {task:"...", context:"...", target_files:["src/pages/X.tsx"], priority:"normal|high"} to queue a task. GET /code/tasks/pending to see queued tasks. GET /code/tasks to list all (filter with ?status=pending|in_progress|completed|failed). GET /code/tasks/:id for a specific task. POST /code/tasks/:id/skip to cancel. DELETE /code/tasks/:id to remove. Completed tasks include the PR URL and list of files changed.';
  }

  const tone = context?.tone === 'brief' ? 'briefly' : 'clearly';
  // Auto-queue unknown questions for Copilot research
  try {
    knowledgeRequestsStore.queueRequest(text, { source: 'heuristic-chat-fallback', context: context?.page || null });
  } catch (err) {
    // Non-blocking — queue failure should not affect chat response
    console.warn('Failed to queue knowledge request:', err.message);
  }
  return `I don't have a specific answer for that in my current knowledge. I've queued this question for Copilot research — it will be answered and added to my intel feed via the ops-bob-ask-copilot workflow. Check GET /ask-copilot/pending to monitor status. In the meantime, I will respond ${tone} with what I know and keep recommendations aligned with local enforcement policy and NZ legal requirements.`;
}

async function generateChatReplyWithOllama(message, history = [], context = {}) {
  if (!OLLAMA_ENABLED) {
    recordEgressEvent('ollama', 'blocked', 'Chat requested ollama but local ollama is unavailable');
    return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
  }

  if (!ollamaCircuitBreaker.allowRequest()) {
    return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  const intelContext = buildRecentIntelContext();
  const trainingFocusedQuery = isTrainingFocusedQuery(message);
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
            content: 'You are Bob, the AI assistant embedded in FieldOps Manager — a freedom camping enforcement platform used by councils and security contractors in New Zealand.\n\nYou assist officers, supervisors, and administrators with:\n- NZ freedom camping law: Freedom Camping Act 2011, Local Government Act 2002, RMA 1991, Privacy Act 2020\n- Compliance analysis: breach trends, stay-night calculations, zone rule interpretation\n- Patrol operations: shift planning, route guidance, officer welfare checks\n- Enforcement actions: Notice to Vacate, Warning Notice, Infringement Notice, Noise Notice\n- Vehicle and plate workflows: ALPR results, SCV certification via NZSCV register\n- Incident and evidence management and investigation notes\n- Risk assessments, SOPs, H&S plans, evacuation plans, active offender procedures\n- Data import, system diagnostics, and operational guidance\n\nNZ Legal Framework (Bob and Ollama MUST abide by these rules):\n- Privacy Act 2020: 13 IPPs. Minimise collection, ensure security, limit use/disclosure, restrict cross-border transfers. Mandatory breach reporting.\n- NZBORA 1990: Rights to movement (s 18), protection from unreasonable search (s 21), natural justice (s 27). All enforcement must respect these.\n- Freedom Camping Act 2011: Officers can issue infringements/NTV/request identity. Officers CANNOT arrest, detain, use force, or enter vehicles — only Police can.\n- RMA 1991: Protect environment. Track environmental impact. Respect Māori cultural sites.\n- Search and Surveillance Act 2012: Public observation/ALPR lawful. Entering vehicles requires warrant/consent. Covert surveillance requires authorisation.\n- Evidence Act 2006: Computer evidence admissible if reliability established (s 137). Maintain chain of custody and audit trails.\n- Policing Act 2008: Involve Police for threats, violence, stolen vehicles, refusal to identify. Share only necessary info, log disclosures.\n- NZDF: Defence land outside council jurisdiction. Do not share surveillance data without authorisation.\n- AI Guardrails: G1 privacy by design, G2 lawful evidence, G3 human review, G4 proportionate enforcement, G5 no Police powers, G6 audit trail, G7 no cross-border leakage, G8 data security, G9 breach notification, G10 respect rights, G11 not legal advice, G12 vulnerable persons.\n- Use POST /legal/check to validate any action. GET /legal/framework for overview. GET /legal/guardrails for full rules.\n\nUI/UX Design Assessment:\n- Design system: Tailwind CSS v3 + shadcn/ui (Radix) with HSL CSS variable theming\n- Four themes: light, dark, high-contrast, night-patrol (for officers in low-light with gloves)\n- Colours: primary teal (HSL 187 72% 37%), accent amber (HSL 48 96% 53%), destructive red (HSL 0 84% 60%)\n- Night-patrol mode: pure black bg, bright cyan primary, 56px min button height, 52px min input height, 17px base font\n- WCAG AA target: 4.5:1 contrast for text, 3:1 for large text, semantic HTML, ARIA attributes, focus-visible rings\n- Responsive breakpoints: sm 640px, md 768px, lg 1024px, xl 1280px (mobile-first)\n- Layout patterns: dashboard (grid cards + table), form (labelled inputs + validation), list (virtualized + empty states), detail (hero + tabs), map (full-height + overlays)\n- Human-friendliness: score components on accessibility (35%), responsiveness (30%), design consistency (35%)\n- Use POST /assess/ui for code analysis, POST /assess/ui/screenshot for visual analysis, POST /assess/ui/colours for contrast checks\n\nFull-Stack Navigation & Debugging:\n- Stack: React UI (src/pages/) → hooks (src/hooks/) → Supabase client → Postgres with RLS → Edge Functions (supabase/functions/) → Railway inference\n- Routes: react-router-dom v6 in App.tsx with ProtectedRoute, RoleRoute, AreaRoute guards. 60+ routes.\n- Button trace: onClick handler → mutation.mutate() → supabase.from(table).insert/update/delete → Postgres → RLS → response → cache invalidation\n- Link trace: <Link to="/path"> → route match → role guard → page component → useParams → hook data fetch\n- Form trace: react-hook-form + zod validation → onSubmit → mutation → Supabase → success toast\n- Debug: POST /navigate/debug with symptom. GET /navigate/stack-map for topology. GET /navigate/route?path= for route lookup.\n- POST /assess/ui/trace to trace any button/link/form from JSX through to database\n- Common fixes: button disabled (check loading state), 404 (check route path), 403 (check RLS), blank page (check hook errors)\n\nPush-to-Talk (PTT) System:\n- Stack: PTTBar.tsx (UI) → ptt.ts (WebSocket + WebRTC) → pttBackground.ts (auto-connect) → pttStore.ts (Zustand) → ptt-signaling-token Edge Function → ptt-server on Railway (WebSocket)\n- Channel types: org:<uuid> (org-wide), team:<uuid>, deployment:<uuid>, incident:<uuid>, direct:<uuid> (1:1)\n- Token flow: requestPTTToken() → Edge Function validates auth + org → ptt-server /api/token/mint → JWT (10min expiry) → WebSocket connect with ?token=jwt\n- Input modes: PTT (hold to talk), Toggle (click), VOX (voice-activated with threshold). Half-duplex — one speaker per channel.\n- Auto-connect: usePTTAutoConnect hook in App.tsx starts pttBackground service on login. Maintains connection with ping/pong heartbeat.\n- Audio: getUserMedia with echoCancellation + noiseSuppression. MediaRecorder (opus/webm, max 60s/3MB). Clips upload to ptt-clips Supabase Storage.\n- Common issues: "PTT unavailable" = Edge Function not deployed or PTT_SERVER_URL not set. 4001/4002 = auth failure. 4003 = channel full. CHANNEL_BUSY = someone else talking.\n- PTT server env: PTT_JWT_SECRET + PROXY_SECRET (required, must match Edge Function). TURN_URL/USERNAME/CREDENTIAL (optional NAT traversal).\n- DB tables: ptt_messages (clip metadata), ptt_presence (online status), ptt_channels (config). All org-scoped with RLS.\n- Voice data privacy: Audio clips have 24h signed URLs, 30-day retention default, org-scoped access. Privacy Act IPP 5 applies.\n- Use POST /assess/ptt with {symptom: "..."} to diagnose PTT issues.\n\nFieldOps Codebase Coding Knowledge:\n- Tech stack: React 18 + TypeScript + Vite + Tailwind CSS v3 + shadcn/ui. State: Zustand + TanStack Query v5. Forms: react-hook-form + zod. Package manager: bun. Backend: Supabase (PostgreSQL 17, 47 Edge Functions, RLS). Services: Bob (inference-service/), Proxy (proxy-server/), PTT (ptt-server/), Ollama on Railway.\n- Project layout: pages in src/pages/, hooks in src/hooks/, stores in src/stores/, shadcn primitives in src/components/ui/ (never re-implement), feature components in src/components/features/. Path alias @/* → ./src/*.\n- Supabase client: import { supabase } from "@/lib/supabase". Typed with Database from @/types/database. Row types: Database["public"]["Tables"]["table"]["Row"]. All queries go through this typed client.\n- Hooks: useQuery for reads, useMutation for writes. queryKey must include all filter vars. invalidateQueries after mutations. toast from sonner for notifications. Files in src/hooks/useXxx.ts.\n- Edge Functions: supabase/functions/<name>/index.ts, Deno TypeScript. Always import withCors + getCorsHeaders + jsonResponse + errorResponse from ../_shared/withCors.ts. Always handle OPTIONS preflight. Deploy: supabase functions deploy <name> --project-ref kxwjcupuxnnbnzcgmkoi.\n- Migrations: supabase/migrations/YYYYMMDD_HHMMSS_description.sql. Every table needs RLS enabled. Policies scope by auth.uid() + organization_id. After migration regenerate types.\n- TypeScript config: noImplicitAny=false, strictNullChecks=false, skipLibCheck=true. Do NOT tighten these. Build: bun run build. Dev: bun run dev.\n- Roles: admin, master, officer, admin_officer. Route guards: RoleRoute, ProtectedRoute, AreaRoute in App.tsx. authStore.ts holds current user + organization_id.\n- All datetimes in Pacific/Auckland timezone. bun.lock must be committed — Railway uses --frozen-lockfile.\n- For coding templates and step-by-step guides: GET /code/patterns, GET /code/conventions, GET /code/tasks, POST /code/assist.\n- To write or update code: POST /code/task {task:"...", context:"...", target_files:[], priority:"normal|high"} — queues a task for the ops-bob-code-task workflow which generates code, applies file operations, runs bun run build, and opens a PR. Monitor: GET /code/tasks/pending.\n\nCurrent internal training and vetted intel:\n' + intelContext + '\n\nKey facts:\n- Zones have allowed_days, max_consecutive_nights, max_nights_per_month\n- Observations track plate_number, zone, recorded_at, and photo evidence\n- Breach triggers when stay limits are exceeded\n- Homeless or vulnerable occupants receive special consideration under policy\n- SCV status from NZSCV register can grant zone exemptions\n- All times are NZ timezone (Pacific/Auckland)\n\nResponse behavior guardrails:\n- Do not claim you can browse the public internet or fetch live web pages unless the request is explicitly routed through a configured platform connector in this environment.\n- Do not claim you can click, open, or inspect app pages directly. Ask the user for visible errors, screenshots, or steps and then diagnose.\n- Do not present internal endpoint playbooks (for example, GET/POST route lists) unless the user explicitly asks for API-level diagnostics. Keep normal replies user-focused.\n- If asked "Can you hear me?", explain that voice input arrives as transcribed text from the app and you respond to that transcript.\n- Keep answers in the trained FieldOps copilot voice: practical, direct, and concise.\n\nBe concise — field officers need fast actionable answers. When you do not know something specific, say so. Never fabricate data or plate numbers. All guidance is operational, not formal legal advice. Return plain text only, no markdown formatting.',
          },
          ...(trainingFocusedQuery
            ? [{
              role: 'system',
              content: 'The user is asking about Bob internal training, build review behavior, blockers, performance hotspots, privacy-safe review style, or remediation planning. Use the curated internal training intel below as the primary source of truth. If the user asks for an order or checklist, answer directly from the training intel as a short list.\n\nTraining intel:\n' + intelContext,
            }]
            : []),
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
      ollamaCircuitBreaker.recordFailure(new Error(`HTTP ${response.status}`));
      return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
    }

    const payload = await response.json();
    const content = payload?.message?.content;
    if (!content || typeof content !== 'string') {
      return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
    }

    const trimmed = content.trim();
    if (!trimmed) {
      return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
    }

    ollamaCircuitBreaker.recordSuccess();
    return {
      provider: 'ollama',
      text: trimmed,
      fallback: false,
    };
  } catch (error) {
    ollamaCircuitBreaker.recordFailure(error);
    if (ollamaCircuitBreaker.state === 'open') {
      // First time tripping — the breaker itself already logged the details
    } else {
      console.warn(`⚠️ Local chat via Ollama failed (${OLLAMA_BASE_URL}):`, error.message);
    }
    return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateTranslationWithOllama({ text, targetLanguage, sourceLanguage = null }) {
  if (!OLLAMA_ENABLED) {
    return {
      provider: 'heuristic',
      model_used: null,
      translated_text: String(text || '').trim(),
      detected_source: sourceLanguage,
      translation_confidence: 0.35,
      confidence_reason: 'Translation model unavailable; returned original text.',
      fallback: true,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);

  try {
    recordEgressEvent('ollama', 'attempted', 'translation endpoint');

    const prompt = [
      `Target language code: ${targetLanguage}`,
      sourceLanguage ? `Source language code: ${sourceLanguage}` : 'Source language code: auto-detect',
      'Translate the following text for NZ field operations context.',
      text,
    ].join('\n\n');

    const response = await safeFetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: TRANSLATION_MODEL,
        stream: false,
        format: 'json',
        messages: [
          {
            role: 'system',
            content: [
              'You are a professional real-time translator for field operations in New Zealand.',
              'Return strict JSON only with keys: translated_text, detected_source.',
              'translated_text must contain only the translation text with no labels or commentary.',
              'If the text is already in the target language, return it unchanged.',
            ].join(' '),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    }, 'ollama');

    if (!response.ok) {
      return {
        provider: 'heuristic',
        model_used: TRANSLATION_MODEL,
        translated_text: String(text || '').trim(),
        detected_source: sourceLanguage,
        translation_confidence: 0.4,
        confidence_reason: `Model request failed with HTTP ${response.status}; returned original text.`,
        fallback: true,
      };
    }

    const payload = await response.json().catch(() => ({}));
    const content = String(payload?.message?.content || '').trim();
    if (!content) {
      return {
        provider: 'heuristic',
        model_used: TRANSLATION_MODEL,
        translated_text: String(text || '').trim(),
        detected_source: sourceLanguage,
        translation_confidence: 0.4,
        confidence_reason: 'Translation model returned an empty response; returned original text.',
        fallback: true,
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { translated_text: content, detected_source: sourceLanguage };
    }

    const translated = String(parsed?.translated_text || '').trim();
    if (!translated) {
      return {
        provider: 'heuristic',
        model_used: TRANSLATION_MODEL,
        translated_text: String(text || '').trim(),
        detected_source: sourceLanguage,
        translation_confidence: 0.4,
        confidence_reason: 'Translation payload did not include translated text; returned original text.',
        fallback: true,
      };
    }

    const normalizedInput = String(text || '').trim();
    const unchanged = normalizedInput.localeCompare(translated, undefined, { sensitivity: 'accent' }) === 0;

    return {
      provider: 'ollama',
      model_used: TRANSLATION_MODEL,
      translated_text: translated,
      detected_source: typeof parsed?.detected_source === 'string' && parsed.detected_source.trim()
        ? parsed.detected_source.trim()
        : sourceLanguage,
      translation_confidence: unchanged ? 0.72 : 0.9,
      confidence_reason: unchanged
        ? 'Model returned the same text; source may already match the target language.'
        : 'Dedicated translation model completed successfully.',
      fallback: false,
    };
  } catch (error) {
    return {
      provider: 'heuristic',
      model_used: TRANSLATION_MODEL,
      translated_text: String(text || '').trim(),
      detected_source: sourceLanguage,
      translation_confidence: 0.35,
      confidence_reason: error?.message || 'Translation model failed; returned original text.',
      fallback: true,
    };
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
    // Optional caller-supplied system prompt override (used by Edge Functions like process-tender-document)
    const rawSystemPrompt = typeof req.body?.system_prompt === 'string' ? req.body.system_prompt.trim() : '';
    const systemPromptOverride = rawSystemPrompt || null;

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message must be a non-empty string' });
    }

    // Skip training-intel shortcut when caller supplies a custom system prompt
    if (!systemPromptOverride) {
      const trainingReply = answerFromTrainingIntel(message);
      if (trainingReply) {
        return res.json({
          success: true,
          provider: 'training-intel',
          fallback: false,
          message: trainingReply,
        });
      }
    }

    if (CHAT_PROVIDER === 'ollama') {
      const reply = await generateChatReplyWithOllama(message, history, context, systemPromptOverride);
      return res.json({
        success: true,
        provider: reply.provider,
        fallback: reply.fallback,
        message: reply.text,
        text: reply.text,
      });
    }

    return res.json({
      success: true,
      provider: 'heuristic',
      fallback: false,
      message: generateHeuristicChatReply(message, context),
      text: generateHeuristicChatReply(message, context),
    });
  } catch (error) {
    console.error('Chat endpoint error:', error);
    return res.status(500).json({ error: 'Chat failed', message: error.message });
  }
});

app.post('/translate', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const text = req.body?.text;
    const targetLanguage = String(req.body?.target_language || '').trim();
    const sourceLanguageRaw = String(req.body?.source_language || '').trim();
    const sourceLanguage = sourceLanguageRaw || null;

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text must be a non-empty string' });
    }

    if (!targetLanguage) {
      return res.status(400).json({ error: 'target_language must be provided (example: en-NZ)' });
    }

    const result = await generateTranslationWithOllama({
      text,
      targetLanguage,
      sourceLanguage,
    });

    return res.json({
      success: true,
      provider: result.provider,
      fallback: result.fallback,
      model_used: result.model_used,
      translated_text: result.translated_text,
      target_language: targetLanguage,
      detected_source: result.detected_source,
      translation_confidence: result.translation_confidence,
      confidence_reason: result.confidence_reason,
    });
  } catch (error) {
    console.error('Translate endpoint error:', error);
    return res.status(500).json({ error: 'Translation failed', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// Tender Document Generation — POST /tender/generate
//
// Multi-model cascade: Ollama (primary) → OpenAI (fallback) → Heuristic template
//
// Body: {
//   generation_type: 'application' | 'response',   // what to generate
//   context: {
//     extracted_text: string,                       // raw tender text
//     issuing_body: string,
//     key_services: string[],
//     key_requirements: string[],
//     key_dates: Array<{label, date}>,
//     reference_number: string,
//     due_date: string,
//     document_type: string,
//   },
//   organization_context: {
//     name: string,          // e.g. "Iron Eagle Security"
//     psa_licence: string,   // PSA licence number
//     nzbn: string,          // NZBN
//   }
// }
//
// Response: {
//   success: true,
//   provider: 'ollama' | 'openai' | 'heuristic',
//   model_used: string,
//   sections: {
//     cover_letter, executive_summary, services_offered,
//     pricing_notes, team_qualifications, health_and_safety, declaration
//   }
// }
// ---------------------------------------------------------------------------

const TENDER_GEN_TIMEOUT_MS = Number(process.env.TENDER_GEN_TIMEOUT_MS || 90000);
// Max characters of extracted tender text to include in the generation context.
// Keeps the Ollama prompt within context window limits for most models.
const MAX_TENDER_CONTEXT_CHARS = Number(process.env.MAX_TENDER_CONTEXT_CHARS || 8000);
// Max characters of reference material context to inject into the generation prompt.
const MAX_REFERENCE_CONTEXT_CHARS = Number(process.env.MAX_REFERENCE_CONTEXT_CHARS || 6000);

function buildTenderSystemPrompt(generationType, context, orgContext) {
  const orgName = orgContext?.name || 'Iron Eagle Security';
  const isResponse = generationType === 'response';
  const docLabel = isResponse ? 'TENDER RESPONSE' : 'TENDER APPLICATION';

  const servicesBlock = Array.isArray(context.key_services) && context.key_services.length
    ? context.key_services.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : 'Not yet extracted — infer from the document text.';

  const requirementsBlock = Array.isArray(context.key_requirements) && context.key_requirements.length
    ? context.key_requirements.map((r) => `- ${r}`).join('\n')
    : 'Not yet extracted — infer from the document text.';

  return `You are Bob, the AI procurement assistant for ${orgName}, a licensed security company based in New Zealand.
Your task is to generate a professional ${docLabel} document in NZ English.

ORGANISATION CONTEXT:
- Company: ${orgName}
- PSA Licence: ${orgContext?.psa_licence || '[PSA LICENCE NUMBER]'}
- NZBN: ${orgContext?.nzbn || '[NZBN]'}
- Key differentiator: FieldOps Manager — NZ-built patrol management system with GPS tracking, automated breach detection, ALPR, welfare checks, and live compliance dashboards.

TENDER CONTEXT:
- Issuing body: ${context.issuing_body || 'Unknown'}
- Reference: ${context.reference_number || 'N/A'}
- Due date: ${context.due_date || 'See tender document'}
- Services being tendered:
${servicesBlock}
- Key requirements / evaluation criteria:
${requirementsBlock}

GENERATION INSTRUCTIONS:
${isResponse ? `
You are generating a TENDER RESPONSE — ${orgName} is responding to an invitation to tender.
Frame content as fulfilling each requirement. Use the tender's own numbering/structure for services_offered.
` : `
You are generating a TENDER APPLICATION — ${orgName} is expressing interest and pitching to be shortlisted.
Frame content as a compelling pitch. Emphasise unique capability (FieldOps Manager, PSA compliance, NZ experience).
`}

CRITICAL RULES:
1. Use professional NZ English throughout. Use "organisation" not "organization". Use NZD for prices.
2. Do NOT fabricate specific CoA numbers, registration numbers, or insurance policy numbers — use [PLACEHOLDER] instead.
3. Do NOT fabricate specific dollar amounts — use [RATE] or [PRICE] placeholders the user will replace.
4. For pricing_notes, generate a markdown pricing TABLE with columns: Service | Unit | Rate (excl. GST) | Notes. Use [RATE] for all amounts.
5. The declaration section MUST include the NZ Commerce Act collusion/anti-competitive declaration.
6. Keep each section focused: cover_letter ≤ 300 words, executive_summary ≤ 400 words, other sections as needed.
7. Match the services_offered section sub-headings to the actual service items listed above.
8. Highlight FieldOps Manager capabilities (GPS patrol, welfare checks, breach detection, live reports) where relevant.

You MUST respond with ONLY a valid JSON object (no markdown, no code fences) with exactly these keys:
{
  "cover_letter": "...",
  "executive_summary": "...",
  "services_offered": "...",
  "pricing_notes": "...",
  "team_qualifications": "...",
  "health_and_safety": "...",
  "declaration": "..."
}`;
}

function buildTenderUserPrompt(context) {
  const excerpt = (context.extracted_text || '').slice(0, MAX_TENDER_CONTEXT_CHARS);
  const refBlock = context.reference_context
    ? `\n\n--- ORGANISATION REFERENCE MATERIAL ---\nThe following reference documents are provided to inform the tender response. Use them to calibrate pricing, compliance, and NZ-specific requirements:\n\n${String(context.reference_context).slice(0, MAX_REFERENCE_CONTEXT_CHARS)}\n--- END REFERENCE MATERIAL ---`
    : '';
  return excerpt
    ? `Here is the source tender document text for context:\n\n---\n${excerpt}\n---${refBlock}\n\nNow generate the ${context.generation_type || 'response'} document sections as a JSON object.`
    : `${refBlock}\n\nGenerate the document sections as a JSON object based on the context above.`.trim();
}

function heuristicTenderSections(generationType, context, orgContext) {
  const orgName = orgContext?.name || 'Iron Eagle Security';
  const issuer = context.issuing_body || '[Issuing Body]';
  const ref = context.reference_number || '[Reference]';
  const due = context.due_date || '[Due Date]';
  const services = Array.isArray(context.key_services) && context.key_services.length
    ? context.key_services
    : ['[Service 1]', '[Service 2]'];
  const isResponse = generationType === 'response';

  const servicesOffered = services.map((svc, i) =>
    `${i + 1}. ${svc}\n\n${orgName} is fully equipped to provide this service. Our officers are PSA-licensed, trained to the required standard, and supported by the FieldOps Manager platform which provides real-time GPS tracking, welfare check monitoring, and automated compliance reporting.\n`
  ).join('\n');

  const pricingRows = services.map((svc) =>
    `| ${svc} | Hour | [RATE] | + GST |`
  ).join('\n');

  const collusionDecl = 'We declare that this submission has been prepared without collusion or communication with any other tenderer, and that no arrangement or understanding exists between this organisation and any other party that would restrict or limit competitive tendering for this contract, as required under the New Zealand Commerce Act 1986.';

  return {
    cover_letter: `Dear ${issuer} Procurement Team,\n\nRe: ${ref} — ${isResponse ? 'Tender Response' : 'Expression of Interest'}\n\n${orgName} is pleased to ${isResponse ? 'submit this response to' : 'express our interest in'} the above tender. We are a licensed New Zealand security company with deep experience in the services described.\n\nWe believe ${orgName} is uniquely positioned to deliver exceptional outcomes through our FieldOps Manager platform — providing live GPS patrol monitoring, automated breach detection, welfare check compliance, and transparent reporting.\n\nWe look forward to the opportunity to demonstrate our capability.\n\nYours sincerely,\n[Authorised Signatory]\n[Title]\n${orgName}\nDate: ${due}`,

    executive_summary: `${orgName} is a New Zealand-based, PSA-licensed security services provider. We are ${isResponse ? 'responding to' : 'applying for'} ${ref} issued by ${issuer}.\n\nWe offer the following services as required: ${services.join(', ')}.\n\nOur key competitive advantage is the FieldOps Manager system — a purpose-built NZ patrol management platform providing:\n- Real-time GPS officer tracking\n- Automated welfare checks and lone-worker protection\n- ALPR vehicle scanning and compliance breach detection\n- Instant incident reporting with photo evidence\n- Live compliance dashboards for council oversight\n\nAll officers hold current PSA Certificates of Approval. Our H&S management system complies with the Health & Safety at Work Act 2015.`,

    services_offered: servicesOffered,

    pricing_notes: `All prices are in New Zealand Dollars and are exclusive of GST unless otherwise stated.\n\n| Service | Unit | Rate (excl. GST) | Notes |\n|---------|------|-----------------|-------|\n${pricingRows}\n| Call-out fee | Per call | [RATE] | Weekday |\n| Call-out fee | Per call | [RATE] | Weekend / Public Holiday |\n| Management & Reporting | Hour | [RATE] | |\n\nMinimum engagement: [X] hours per call-out.\nPublic holiday loading: [X]%.\nNote: All rates include officer travel within the defined service area.`,

    team_qualifications: `All ${orgName} security officers hold a current Certificate of Approval (CoA) issued by the New Zealand Police under the Private Security Personnel and Private Investigators Act 2010 (PSA). ${orgName} holds PSA Licence Number [PSA LICENCE NUMBER].\n\nTraining and qualifications:\n- PSA CoA (mandatory for all officers)\n- First Aid Certificate (current)\n- Noise control training [where applicable]\n- Freedom Camping Act 2011 enforcement training\n- FieldOps Manager platform certified\n\nSubcontracting: Any subcontractors employed will hold current PSA CoA and will be inducted into our H&S management system prior to commencement.`,

    health_and_safety: `${orgName} operates a comprehensive Health & Safety management system in compliance with the Health & Safety at Work Act 2015 (HSWA).\n\nAs a PCBU (Person Conducting a Business or Undertaking), ${orgName}:\n- Maintains a signed H&S policy statement\n- Operates a documented hazard and risk register\n- Requires all officers to complete pre-shift safety checks\n- Implements a welfare check system for lone workers (automated via FieldOps Manager — officers check in at regular intervals; escalation alerts are triggered if a check-in is missed)\n- Conducts H&S inductions for all staff and subcontractors\n- Reports and investigates all incidents and near-misses\n\nH&S accreditation and safety plan documentation is available on request.`,

    declaration: `${collusionDecl}\n\nAccuracy declaration: The information provided in this submission is accurate and complete to the best of our knowledge. ${orgName} accepts that any material misstatement may result in disqualification.\n\nSignatory: ___________________________\nName: [Name]\nTitle: [Title]\nDate: ${due}`,
  };
}

async function generateTenderWithOllama(generationType, context, orgContext) {
  if (!OLLAMA_ENABLED || !ollamaCircuitBreaker.allowRequest()) {
    return null;
  }

  const systemPrompt = buildTenderSystemPrompt(generationType, context, orgContext);
  const userPrompt = buildTenderUserPrompt({ ...context, generation_type: generationType });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TENDER_GEN_TIMEOUT_MS);

  try {
    recordEgressEvent('ollama', 'attempted', 'tender/generate');
    const response = await safeFetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        options: { temperature: 0.4, num_predict: 4096 },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    }, 'ollama');

    if (!response.ok) {
      ollamaCircuitBreaker.recordFailure(new Error(`HTTP ${response.status}`));
      return null;
    }

    const payload = await response.json();
    const rawContent = payload?.message?.content;
    if (!rawContent || typeof rawContent !== 'string') return null;

    let sections;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      sections = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    } catch {
      ollamaCircuitBreaker.recordSuccess();
      return null;
    }

    ollamaCircuitBreaker.recordSuccess();
    return { sections, provider: 'ollama', model_used: OLLAMA_MODEL };
  } catch (err) {
    ollamaCircuitBreaker.recordFailure(err);
    console.warn('⚠️ Tender generation via Ollama failed:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate tender sections using the WRITING model on the same Ollama instance.
 * OLLAMA_MODEL_WRITING may be the same as OLLAMA_MODEL, or a larger/specialist
 * model the operator has pulled (e.g. qwen2.5:14b, mistral:7b, llama3.3:70b).
 */
async function generateTenderWithOllamaWriting(generationType, context, orgContext) {
  // If the writing model is the same as the main model, skip — already tried above
  if (OLLAMA_MODEL_WRITING === OLLAMA_MODEL) return null;
  if (!OLLAMA_ENABLED || !ollamaCircuitBreaker.allowRequest()) return null;

  const systemPrompt = buildTenderSystemPrompt(generationType, context, orgContext);
  const userPrompt = buildTenderUserPrompt({ ...context, generation_type: generationType });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TENDER_GEN_TIMEOUT_MS);

  try {
    recordEgressEvent('ollama', 'attempted', `tender/generate writing-model:${OLLAMA_MODEL_WRITING}`);
    const response = await safeFetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL_WRITING,
        stream: false,
        format: 'json',
        options: { temperature: 0.4, num_predict: 4096 },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    }, 'ollama');

    if (!response.ok) {
      ollamaCircuitBreaker.recordFailure(new Error(`HTTP ${response.status}`));
      return null;
    }

    const payload = await response.json();
    const rawContent = payload?.message?.content;
    if (!rawContent || typeof rawContent !== 'string') return null;

    let sections;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      sections = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    } catch {
      ollamaCircuitBreaker.recordSuccess();
      return null;
    }

    ollamaCircuitBreaker.recordSuccess();
    return { sections, provider: 'ollama-writing', model_used: OLLAMA_MODEL_WRITING };
  } catch (err) {
    ollamaCircuitBreaker.recordFailure(err);
    console.warn(`⚠️ Tender generation via writing model (${OLLAMA_MODEL_WRITING}) failed:`, err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Forward a tender generation request to the secondary Railway-hosted assistant.
 * The secondary assistant must expose POST /tender/generate with the same API shape.
 * Authenticate with SECONDARY_ASSISTANT_API_KEY in the Authorization header.
 * Use this for a dedicated writing-specialist Railway service (another Bob instance
 * with a larger Ollama model, or a custom document-generation service).
 */
async function generateTenderWithSecondaryAssistant(generationType, context, orgContext) {
  if (!SECONDARY_ASSISTANT_ENABLED) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SECONDARY_ASSISTANT_TIMEOUT_MS);

  try {
    console.log(`🔄 Forwarding tender generation to secondary assistant: ${SECONDARY_ASSISTANT_URL}`);
    const response = await fetch(`${SECONDARY_ASSISTANT_URL}/tender/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECONDARY_ASSISTANT_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        generation_type: generationType,
        context,
        organization_context: orgContext,
      }),
    });

    if (!response.ok) {
      console.warn(`⚠️ Secondary assistant tender generation returned ${response.status}`);
      return null;
    }

    const payload = await response.json();
    if (!payload?.success || !payload?.sections) return null;

    return {
      sections: payload.sections,
      provider: 'secondary-assistant',
      model_used: payload.model_used || 'secondary',
    };
  } catch (err) {
    console.warn('⚠️ Secondary assistant tender generation failed:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Tender self-learning store — persists condensed knowledge from approved tenders
// ---------------------------------------------------------------------------
const TENDER_LEARNING_PATH = process.env.TENDER_LEARNING_PATH || path.join(__dirname, 'data', 'tender-learning.json');

function readTenderLearning() {
  try {
    if (!fs.existsSync(TENDER_LEARNING_PATH)) return { version: 1, entries: [] };
    const parsed = JSON.parse(fs.readFileSync(TENDER_LEARNING_PATH, 'utf8'));
    if (!parsed || !Array.isArray(parsed.entries)) return { version: 1, entries: [] };
    return parsed;
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeTenderLearning(state) {
  const dir = path.dirname(TENDER_LEARNING_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${TENDER_LEARNING_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, TENDER_LEARNING_PATH);
}

function buildTenderLearningContext() {
  const state = readTenderLearning();
  const recent = state.entries.slice(-20);
  if (!recent.length) return '';
  return recent.map((e) =>
    `[${e.generation_type?.toUpperCase() || 'TENDER'} | ${e.issuing_body || 'Unknown'}]: ${e.outcome_summary || ''}`
  ).join('\n');
}

app.post('/tender/generate', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const generationType = req.body?.generation_type === 'application' ? 'application' : 'response';
    const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
    const organizationContext = req.body?.organization_context && typeof req.body.organization_context === 'object'
      ? req.body.organization_context
      : {};

    // Enrich context with any past tender learning
    const learningContext = buildTenderLearningContext();
    if (learningContext) {
      context._past_learning = learningContext;
    }

    const hasReferenceContext = typeof context.reference_context === 'string' && context.reference_context.length > 0;

    // Cascade 1: primary Ollama model
    const ollamaResult = await generateTenderWithOllama(generationType, context, organizationContext);
    if (ollamaResult) {
      return res.json({ success: true, ...ollamaResult, references_used: hasReferenceContext });
    }

    // Cascade 2: specialist writing model on same Ollama instance (if different model configured)
    const writingResult = await generateTenderWithOllamaWriting(generationType, context, organizationContext);
    if (writingResult) {
      return res.json({ success: true, ...writingResult, references_used: hasReferenceContext });
    }

    // Cascade 3: secondary Railway-hosted assistant
    const secondaryResult = await generateTenderWithSecondaryAssistant(generationType, context, organizationContext);
    if (secondaryResult) {
      return res.json({ success: true, ...secondaryResult, references_used: hasReferenceContext });
    }

    // Cascade 4: enriched heuristic template (always available, no network required)
    const heuristicSections = heuristicTenderSections(generationType, context, organizationContext);
    return res.json({
      success: true,
      provider: 'heuristic',
      model_used: 'template',
      sections: heuristicSections,
      references_used: hasReferenceContext,
    });
  } catch (error) {
    console.error('Tender generate endpoint error:', error);
    return res.status(500).json({ error: 'Tender generation failed', message: error.message });
  }
});

/**
 * POST /tender/train
 * Ingest an approved tender's outcome into Bob's self-learning feed so future
 * generation improves. Called automatically when a tender reaches 'approved'
 * status in the frontend (via the generate-tender-sections edge function).
 *
 * Body: {
 *   generation_type: 'application' | 'response',
 *   issuing_body: string,
 *   key_services: string[],
 *   outcome: 'approved' | 'rejected' | 'shortlisted',
 *   outcome_notes: string,   // what worked / what to improve
 *   sections: object,        // the approved sections for pattern extraction
 * }
 */
app.post('/tender/train', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    if (!SELF_LEARNING_ENABLED) {
      return res.json({ success: true, learned: false, reason: 'self-learning disabled' });
    }

    const {
      generation_type, issuing_body, key_services, outcome, outcome_notes, sections,
      rejection_reason, rejection_category, reference_ids_used, reference_titles_used,
    } = req.body || {};

    const entry = {
      id: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      generation_type: generation_type === 'application' ? 'application' : 'response',
      issuing_body: String(issuing_body || '').trim().slice(0, 200),
      key_services: Array.isArray(key_services) ? key_services.slice(0, 20) : [],
      outcome: ['approved', 'rejected', 'shortlisted'].includes(outcome) ? outcome : 'unknown',
      outcome_summary: String(outcome_notes || '').trim().slice(0, 600),
      rejection_reason: rejection_reason ? String(rejection_reason).trim().slice(0, 400) : null,
      rejection_category: rejection_category || null,
      reference_ids_used: Array.isArray(reference_ids_used) ? reference_ids_used.slice(0, 20) : [],
      reference_titles_used: Array.isArray(reference_titles_used) ? reference_titles_used.slice(0, 20) : [],
      section_lengths: sections && typeof sections === 'object'
        ? Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, String(v || '').length]))
        : {},
      trained_at: new Date().toISOString(),
    };

    const state = readTenderLearning();
    state.entries.push(entry);
    // Keep max 200 entries — prune oldest
    if (state.entries.length > 200) state.entries = state.entries.slice(-200);
    state.updated_at = new Date().toISOString();
    writeTenderLearning(state);

    // Also push a condensed intel bulletin into Bob's main intel feed so the
    // chat assistant benefits from this knowledge immediately
    const rejectionSuffix = entry.rejection_reason
      ? ` Rejection reason: ${entry.rejection_reason}${entry.rejection_category ? ` (category: ${entry.rejection_category})` : ''}.`
      : '';
    const refSuffix = entry.reference_titles_used.length > 0
      ? ` References used: ${entry.reference_titles_used.join(', ')}.`
      : '';
    const bulletin = `Tender ${entry.outcome?.toUpperCase()}: ${entry.generation_type} for ${entry.issuing_body || 'unknown issuing body'}. Services: ${entry.key_services.join(', ')}.${rejectionSuffix} ${entry.outcome_summary}${refSuffix}`;
    try {
      intelStore.ingestBulletin({ summary: bulletin, category: 'tender-learning', source: 'tender-workspace' });
    } catch (e) {
      console.warn('⚠️ Could not push tender learning to intel feed:', e.message);
    }

    console.log(`🎓 Tender learning ingested: [${entry.outcome}] ${entry.issuing_body}${entry.rejection_reason ? ` — Rejection: ${entry.rejection_reason}` : ''}`);
    return res.json({ success: true, learned: true, entry_id: entry.id });
  } catch (error) {
    console.error('Tender train endpoint error:', error);
    return res.status(500).json({ error: 'Tender training failed', message: error.message });
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

    // Build the heuristic plan first — used as fallback and to populate bug_type/summary.
    const heuristicPlan = buildSelfHealingPlan(report, {
      selfContainedMode: SELF_CONTAINED_MODE,
    });

    // When Ollama is available, enhance the analysis with LLM root-cause reasoning.
    if (OLLAMA_ENABLED && ollamaCircuitBreaker.allowRequest()) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        recordEgressEvent('ollama', 'attempted', 'self-heal/bug-report');
        const systemPrompt = [
          'You are Bob, an AI assistant for FieldOps Manager — a field operations platform for freedom camping enforcement in New Zealand.',
          'Your task: perform root-cause analysis on a user-submitted bug report and return a structured JSON object.',
          'Rules: stay concise; do not invent reproduction steps not implied by the report; use NZ English.',
          'The JSON must conform exactly to the shape in the user message.',
        ].join(' ');

        const userPrompt = JSON.stringify({
          task: 'root_cause_analysis',
          report: {
            summary: String(report.summary || '').slice(0, 800),
            description: String(report.description || '').slice(0, 1200),
            severity: report.severity || 'medium',
            issue_type: report.issue_type || 'bug',
            current_page: report.current_page || null,
            steps_to_reproduce: String(report.steps_to_reproduce || '').slice(0, 600),
            actual_behavior: String(report.actual_behavior || '').slice(0, 600),
            expected_behavior: String(report.expected_behavior || '').slice(0, 600),
          },
          heuristic_bug_type: heuristicPlan.bug_type,
          expectedResponseShape: {
            bug_type: 'one of: auth | database | ui | network | performance | data | patrol | alpr | ptt | configuration | unknown',
            root_cause: 'concise 1-2 sentence root cause hypothesis',
            confidence: 'high | medium | low',
            suggested_fix: 'short actionable description of the fix',
            affected_files: ['list of likely affected source files or edge functions, max 5'],
            risk_score: 'integer 1-10 (10 = highest risk)',
            requires_human_approval: 'boolean',
          },
        });

        const ollamaResp = await safeFetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: false,
            format: 'json',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
        }, 'ollama');

        if (ollamaResp.ok) {
          const payload = await ollamaResp.json();
          const content = payload?.message?.content;
          if (content && typeof content === 'string') {
            let parsed;
            try {
              parsed = JSON.parse(content);
            } catch {
              // LLM returned malformed JSON despite format:json directive — fall through to heuristic.
              ollamaCircuitBreaker.recordSuccess(); // The request itself succeeded; don't penalise circuit breaker.
              console.warn('⚠️  Self-heal Ollama response was not valid JSON — using heuristic fallback.');
              parsed = null;
            }

            if (parsed) {
              ollamaCircuitBreaker.recordSuccess();

              // Merge Ollama analysis into the heuristic plan, keeping heuristic fields as fallback.
              const enhancedPlan = {
                ...heuristicPlan,
                bug_type: parsed.bug_type || heuristicPlan.bug_type,
                root_cause: parsed.root_cause || heuristicPlan.root_cause,
                confidence: parsed.confidence || 'medium',
                suggested_fix: parsed.suggested_fix || heuristicPlan.suggested_fix,
                affected_files: Array.isArray(parsed.affected_files) ? parsed.affected_files : [],
                risk_score: Number.isInteger(parsed.risk_score) ? parsed.risk_score : heuristicPlan.risk_score,
                requires_human_approval: typeof parsed.requires_human_approval === 'boolean'
                  ? parsed.requires_human_approval
                  : heuristicPlan.requires_human_approval,
                analysis_provider: 'ollama',
              };

              return res.json({
                success: true,
                self_healing_enabled: true,
                plan: enhancedPlan,
              });
            }
          }
        } else {
          ollamaCircuitBreaker.recordFailure(new Error(`HTTP ${ollamaResp.status}`));
        }
      } catch (ollamaError) {
        ollamaCircuitBreaker.recordFailure(ollamaError);
        console.warn('⚠️  Self-heal Ollama analysis failed, falling back to heuristic:', ollamaError.message);
      } finally {
        clearTimeout(timeout);
      }
    }

    return res.json({
      success: true,
      self_healing_enabled: true,
      plan: { ...heuristicPlan, analysis_provider: 'heuristic' },
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

// ---------------------------------------------------------------------------
// UI Assessment endpoints — teach Bob to visualise and evaluate UI
// ---------------------------------------------------------------------------

app.post('/assess/ui', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const code = req.body?.code;
    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'code must be a non-empty string containing component JSX/TSX source' });
    }

    if (code.length > 100_000) {
      return res.status(400).json({ error: 'code exceeds maximum length of 100,000 characters' });
    }

    const analysis = analyzeComponentCode(code);
    const layoutPatterns = identifyLayoutPattern(code);

    return res.json({
      success: true,
      analysis,
      layout_patterns: layoutPatterns,
      design_system: DESIGN_SYSTEM,
    });
  } catch (error) {
    console.error('UI code assessment error:', error);
    return res.status(500).json({ error: 'UI assessment failed', message: error.message });
  }
});

app.post('/assess/ui/screenshot', inferenceRateLimit, upload.single('screenshot'), requireInferenceAuth, async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'screenshot file is required (multipart/form-data, field name: screenshot)' });
    }

    const screenshotAnalysis = await analyzeScreenshot(req.file.buffer);

    return res.json({
      success: true,
      screenshot: screenshotAnalysis,
      design_system: DESIGN_SYSTEM,
    });
  } catch (error) {
    console.error('UI screenshot assessment error:', error);
    return res.status(500).json({ error: 'Screenshot assessment failed', message: error.message });
  }
});

app.post('/assess/ui/colours', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const colours = req.body?.colours;
    if (!Array.isArray(colours) || colours.length === 0) {
      return res.status(400).json({ error: 'colours must be a non-empty array of { name, hsl: [h,s,l] } or { name, rgb: [r,g,b] } objects' });
    }

    if (colours.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 colours per assessment' });
    }

    const paletteAssessment = assessColourPalette(colours);

    return res.json({
      success: true,
      palette: paletteAssessment,
      design_system_colours: DESIGN_SYSTEM.color_tokens,
    });
  } catch (error) {
    console.error('Colour assessment error:', error);
    return res.status(500).json({ error: 'Colour assessment failed', message: error.message });
  }
});

app.get('/assess/ui/design-system', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  return res.json({
    success: true,
    design_system: DESIGN_SYSTEM,
    knowledge: getKnowledgePacks().ui_design_context || null,
  });
});

// ---------------------------------------------------------------------------
// Stack Navigation endpoints — teach Bob to trace UI → DB and debug issues
// ---------------------------------------------------------------------------

app.post('/assess/ui/trace', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const code = req.body?.code;
    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'code must be a non-empty string containing component JSX/TSX source' });
    }

    if (code.length > 100_000) {
      return res.status(400).json({ error: 'code exceeds maximum length of 100,000 characters' });
    }

    const elementType = req.body?.element_type || 'auto';
    const trace = traceUIElement(code, elementType);

    return res.json({
      success: true,
      trace,
    });
  } catch (error) {
    console.error('UI trace error:', error);
    return res.status(500).json({ error: 'UI element trace failed', message: error.message });
  }
});

app.get('/navigate/stack-map', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  return res.json({
    success: true,
    stack: getStackMap(),
  });
});

app.get('/navigate/route', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  const path = req.query?.path;
  if (!path) {
    return res.json({ success: true, routes: ROUTE_MAP });
  }

  const route = findRoute(String(path));
  if (!route) {
    return res.json({
      success: true,
      route: null,
      message: `No route found for path "${path}". Check App.tsx for valid routes. The catch-all route redirects unknown paths to /.`,
    });
  }

  return res.json({ success: true, route });
});

app.post('/navigate/debug', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const symptom = req.body?.symptom;
    if (typeof symptom !== 'string' || !symptom.trim()) {
      return res.status(400).json({ error: 'symptom must be a non-empty string describing the issue' });
    }

    const steps = getDebuggingSteps(symptom);

    return res.json({
      success: true,
      debugging: steps,
    });
  } catch (error) {
    console.error('Debug navigation error:', error);
    return res.status(500).json({ error: 'Debug navigation failed', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// Coding Knowledge endpoints — FieldOps codebase patterns and conventions
// (Same context as the Copilot coding agent / Claude Opus 4.5)
// ---------------------------------------------------------------------------

const codeRateLimit = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

// GET /code/tech-stack — full tech stack reference
app.get('/code/tech-stack', codeRateLimit, requireInferenceAuth, (req, res) => {
  return res.json({ success: true, tech_stack: getTechStack() });
});

// GET /code/layout — project directory layout
app.get('/code/layout', codeRateLimit, requireInferenceAuth, (req, res) => {
  return res.json({ success: true, layout: getProjectLayout() });
});

// GET /code/build — build and dev commands
app.get('/code/build', codeRateLimit, requireInferenceAuth, (req, res) => {
  return res.json({ success: true, commands: getBuildCommands() });
});

// GET /code/patterns — all code patterns with templates
app.get('/code/patterns', codeRateLimit, requireInferenceAuth, (req, res) => {
  const key = req.query.key;
  if (key) {
    const pattern = getCodePattern(String(key));
    if (!pattern) {
      return res.status(404).json({
        error: `Pattern "${key}" not found.`,
        available: Object.keys(getAllPatterns()),
      });
    }
    return res.json({ success: true, pattern });
  }
  return res.json({ success: true, patterns: getAllPatterns() });
});

// GET /code/conventions — naming, TypeScript config, roles, timezone
app.get('/code/conventions', codeRateLimit, requireInferenceAuth, (req, res) => {
  return res.json({ success: true, conventions: getConventions() });
});

// GET /code/tasks — common task step-by-step guides
app.get('/code/tasks', codeRateLimit, requireInferenceAuth, (req, res) => {
  const key = req.query.key;
  if (key) {
    const task = getCommonTask(String(key));
    if (!task) {
      return res.status(404).json({
        error: `Task "${key}" not found.`,
        available: Object.keys(getAllCommonTasks()),
      });
    }
    return res.json({ success: true, task });
  }
  return res.json({ success: true, tasks: getAllCommonTasks() });
});

// GET /code/file-guide — file-to-feature mapping
app.get('/code/file-guide', codeRateLimit, requireInferenceAuth, (req, res) => {
  return res.json({ success: true, file_guide: getFileGuide() });
});

// POST /code/assist — natural language coding question → structured answer + template
app.post('/code/assist', inferenceRateLimit, requireInferenceAuth, (req, res) => {
  try {
    const question = req.body?.question;
    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'question must be a non-empty string' });
    }
    if (question.length > 2000) {
      return res.status(400).json({ error: 'question must be 2000 characters or fewer' });
    }

    const answer = answerCodingQuestion(question);
    if (!answer) {
      return res.json({
        success: true,
        question,
        answer: null,
        message: 'No specific coding pattern found for this question. Use GET /code/patterns for all templates, or POST /ask-copilot to queue a knowledge request.',
        endpoints: {
          patterns: 'GET /code/patterns',
          conventions: 'GET /code/conventions',
          tasks: 'GET /code/tasks',
          tech_stack: 'GET /code/tech-stack',
          layout: 'GET /code/layout',
          file_guide: 'GET /code/file-guide',
          queue_question: 'POST /ask-copilot',
        },
      });
    }

    return res.json({
      success: true,
      question,
      answer,
    });
  } catch (error) {
    console.error('Code assist error:', error);
    return res.status(500).json({ error: 'Code assist failed', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// NZ Legal Framework endpoints — teach Bob NZ law and compliance guardrails
// ---------------------------------------------------------------------------

app.get('/legal/framework', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  return res.json({
    success: true,
    framework: getLegalFramework(),
  });
});

app.get('/legal/guardrails', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  return res.json({
    success: true,
    guardrails: AI_LEGAL_GUARDRAILS,
  });
});

app.post('/legal/check', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const action = req.body;
    if (!action?.description || typeof action.description !== 'string') {
      return res.status(400).json({ error: 'action.description must be a non-empty string describing the proposed action' });
    }

    const result = checkLegalCompliance(action);

    return res.json({
      success: true,
      compliance: result,
    });
  } catch (error) {
    console.error('Legal compliance check error:', error);
    return res.status(500).json({ error: 'Legal compliance check failed', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// PTT Diagnostics endpoint — diagnose PTT issues
// ---------------------------------------------------------------------------

const PTT_DIAGNOSTICS = {
  connection: {
    keywords: ['connect', 'unavailable', 'disconnect', 'offline', 'wifi off', 'not connecting', 'error connecting'],
    diagnosis: 'PTT connection failure',
    checks: [
      { step: 'Check ptt-signaling-token Edge Function is deployed', detail: 'Run set-ptt-secret.yml workflow or: supabase functions deploy ptt-signaling-token --project-ref $REF --no-verify-jwt' },
      { step: 'Verify PTT_SERVER_URL in Supabase secrets', detail: 'Supabase Dashboard → Settings → Edge Functions → Secrets. Should be the Railway URL of ptt-server (e.g., https://ptt-server-production.up.railway.app)' },
      { step: 'Check ptt-server health on Railway', detail: 'GET https://<ptt-server-url>/health — should return {status:"ok",channels:N,connectedUsers:N}' },
      { step: 'Verify PTT_JWT_SECRET matches', detail: 'Same secret must be set on both Supabase Edge Function secrets AND Railway ptt-server environment variables' },
      { step: 'Verify PROXY_SECRET matches', detail: 'Edge Function uses this to authenticate with ptt-server /api/token/mint. Must match between Supabase secrets and Railway env.' },
      { step: 'Check user authentication', detail: 'User must be logged in with a valid session. PTT waits for auth loading to complete before connecting (usePTTAutoConnect).' },
      { step: 'Check organization_id', detail: 'User must have an organization_id. Master/grand_master users need an org selected in global filter dropdown.' },
      { step: 'Check browser Console for error details', detail: 'Look for "🎤 PTT:" messages. "unable to reach the edge function" = Edge Function not deployed. WebSocket close codes: 4001/4002=auth, 4003=channel full.' },
    ],
  },
  speaking: {
    keywords: ['speak', 'talk', 'mic', 'microphone', 'button grey', 'cannot talk', 'greyed out', 'muted', 'channel busy'],
    diagnosis: 'PTT speaking/microphone issue',
    checks: [
      { step: 'Verify PTT connection is active', detail: 'Green wifi icon in PTTBar = connected. If not connected, fix connection first (see connection diagnostics).' },
      { step: 'Check if channel is busy', detail: 'Half-duplex: only one speaker at a time. If someone else is speaking (yellow PTT button), wait for them to finish.' },
      { step: 'Check mute state', detail: 'If isMuted=true, PTT button is disabled. Click the mute/unmute button in PTTBar to toggle.' },
      { step: 'Check browser microphone permission', detail: 'Chrome: chrome://settings/content/microphone. Firefox: about:preferences#privacy. Ensure site is allowed.' },
      { step: 'Test microphone independently', detail: 'Use browser\'s built-in audio recorder or a site like mictests.com to verify mic works outside PTT.' },
      { step: 'Check WebSocket readyState', detail: 'In browser Console: ws.readyState should be 1 (OPEN). If 0 (CONNECTING) or 3 (CLOSED), connection is broken.' },
      { step: 'For VOX: adjust threshold', detail: 'If VOX mode and threshold too high, voice won\'t trigger. Lower threshold to 20-30% in PTT settings popover.' },
    ],
  },
  audio_quality: {
    keywords: ['choppy', 'echo', 'noise', 'quality', 'cutting out', 'one way', 'can\'t hear', 'no sound', 'static'],
    diagnosis: 'PTT audio quality issue',
    checks: [
      { step: 'Check network connection', detail: 'WebRTC audio requires stable connection. High latency or packet loss causes choppy audio. Try a different network.' },
      { step: 'Check for echo', detail: 'echoCancellation is enabled by default. If echo persists: use headphones/earbuds, or lower speaker volume.' },
      { step: 'Check for background noise', detail: 'noiseSuppression is enabled. If noisy: use a directional microphone, move to quieter area, or raise VOX threshold.' },
      { step: 'Check NAT traversal', detail: 'If behind corporate firewall/symmetric NAT, STUN alone may not work. Configure TURN server: set TURN_URL, TURN_USERNAME, TURN_CREDENTIAL on ptt-server.' },
      { step: 'Check one-way audio', detail: 'Both parties need microphone permission. Check WebRTC ICE connection state in DevTools. If ICE fails, TURN server is needed.' },
      { step: 'Check clip playback', detail: 'After speaking, clip uploads to ptt-clips Storage bucket. Check Network tab for upload success. If upload fails: check Storage bucket exists and RLS allows upload.' },
      { step: 'Check browser support', detail: 'audio/webm;codecs=opus required. Chrome, Firefox, Edge support it. Safari has limited WebM support — may need audio/mp4 fallback.' },
    ],
  },
  deployment: {
    keywords: ['deploy', 'railway', 'setup', 'install', 'configure', 'secret', 'env'],
    diagnosis: 'PTT deployment/configuration issue',
    checks: [
      { step: 'Deploy ptt-server to Railway', detail: 'Create Railway service from ptt-server/ directory. Set builder to Dockerfile. Configure env vars.' },
      { step: 'Set required env vars on Railway', detail: 'PTT_JWT_SECRET (generate: openssl rand -hex 32), PROXY_SECRET (shared with Edge Function), PORT (auto-set by Railway).' },
      { step: 'Set Supabase Edge Function secrets', detail: 'Run set-ptt-secret.yml workflow or manually set PTT_SERVER_URL and PTT_PROXY_SECRET in Supabase Dashboard.' },
      { step: 'Deploy ptt-signaling-token Edge Function', detail: 'supabase functions deploy ptt-signaling-token --project-ref $REF --no-verify-jwt' },
      { step: 'Create ptt-clips Storage bucket', detail: 'Supabase Dashboard → Storage → New Bucket → name: ptt-clips. Set RLS policies for org-scoped access.' },
      { step: 'Run PTT migration', detail: 'Migration 20260329000002_ptt_tables.sql creates ptt_messages, ptt_presence, ptt_channels tables.' },
      { step: 'Verify health endpoint', detail: 'GET https://<railway-url>/health should return status:ok. If not, check Railway logs for startup errors.' },
      { step: 'Optional: Configure TURN server', detail: 'For NAT traversal in corporate/restricted networks. Set TURN_URL, TURN_USERNAME, TURN_CREDENTIAL on ptt-server.' },
    ],
  },
};

app.post('/assess/ptt', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const symptom = String(req.body?.symptom || '').trim().toLowerCase();
    if (!symptom) {
      return res.status(400).json({ error: 'symptom is required', example: '{ "symptom": "PTT button greyed out" }' });
    }

    // Match symptom to diagnostic category
    let matched = null;
    let bestScore = 0;
    for (const [category, diag] of Object.entries(PTT_DIAGNOSTICS)) {
      let score = 0;
      for (const kw of diag.keywords) {
        if (symptom.includes(kw)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        matched = { category, ...diag };
      }
    }

    // Default to connection if no match
    if (!matched) {
      matched = { category: 'connection', ...PTT_DIAGNOSTICS.connection };
    }

    return res.json({
      success: true,
      symptom: req.body?.symptom,
      diagnosis: matched.diagnosis,
      category: matched.category,
      checks: matched.checks,
      stack_overview: 'PTTBar.tsx → ptt.ts → pttBackground.ts → pttStore.ts → ptt-signaling-token Edge Function → ptt-server (Railway)',
      files: {
        ui_component: 'src/components/features/PTTBar.tsx',
        library: 'src/lib/ptt.ts',
        background: 'src/lib/pttBackground.ts',
        store: 'src/stores/pttStore.ts',
        hook: 'src/hooks/usePTTAutoConnect.ts',
        edge_function: 'supabase/functions/ptt-signaling-token/index.ts',
        signaling_server: 'ptt-server/server.js',
        migration: 'supabase/migrations/20260329000002_ptt_tables.sql',
        secrets_workflow: '.github/workflows/set-ptt-secret.yml',
      },
    });
  } catch (error) {
    console.error('PTT assessment error:', error);
    return res.status(500).json({ error: 'PTT assessment failed', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// Platform knowledge & diagnostics
// ---------------------------------------------------------------------------

app.post('/assess/platform', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const symptom = String(req.body?.symptom || '').trim();
    if (!symptom) {
      return res.status(400).json({ error: 'symptom is required', example: '{ "symptom": "Railway service keeps crashing on startup" }' });
    }

    const result = diagnosePlatformIssue(symptom);

    // Attach relevant Railway audit checks when the issue is Railway-related
    let railwayAuditChecks = null;
    const loweredSymptom = symptom.toLowerCase();
    if (result.platform === 'railway' || loweredSymptom.includes('railway') || loweredSymptom.includes('ollama') || loweredSymptom.includes('chat_provider') || loweredSymptom.includes('tabular') || loweredSymptom.includes('wiring audit') || loweredSymptom.includes('self-contained')) {
      railwayAuditChecks = RAILWAY_SERVICES_AUDIT.assessment_checks;
    }

    return res.json({
      success: true,
      symptom,
      platform: result.platform,
      diagnosis: result.diagnosis,
      checks: result.checks,
      ...(railwayAuditChecks ? { railway_audit_checks: railwayAuditChecks } : {}),
      tip: 'For deeper knowledge use GET /platform/:key. For full Railway audit use GET /platform/railway-audit. To queue a research question for Copilot use POST /ask-copilot.',
    });
  } catch (error) {
    console.error('Platform assessment error:', error);
    return res.status(500).json({ error: 'Platform assessment failed', message: error.message });
  }
});

app.get('/platform/stack', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  return res.json({ success: true, overview: getHybridStackOverview() });
});

app.get('/platform/railway-audit', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  return res.json({ success: true, audit: RAILWAY_SERVICES_AUDIT });
});

app.get('/platform/:key', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  const key = String(req.params.key || '').toLowerCase();
  const knowledge = getPlatformKnowledge(key);
  if (!knowledge) {
    return res.status(404).json({
      error: 'Unknown platform key',
      valid_keys: ['supabase', 'railway', 'railway-audit', 'github', 'vercel', 'expo', 'domain', 'dns', 'email', 'smtp', 'hybrid', 'stack'],
    });
  }
  return res.json({ success: true, platform: key, knowledge });
});

// ---------------------------------------------------------------------------
// Ask-Copilot endpoints — Bob's bidirectional knowledge channel
// ---------------------------------------------------------------------------

// Queue a new knowledge request
app.post('/ask-copilot', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const question = String(req.body?.question || '').trim();
    if (!question) {
      return res.status(400).json({
        error: 'question is required',
        example: '{ "question": "How do I set up Supabase custom domain?", "category": "domain" }',
      });
    }

    const request = knowledgeRequestsStore.queueRequest(question, {
      category: req.body?.category,
      context: req.body?.context,
      source: req.body?.source || 'api',
      priority: req.body?.priority,
    });

    return res.status(201).json({
      success: true,
      request,
      message: 'Knowledge request queued. Copilot will research and answer via POST /ask-copilot/:id/answer. Monitor: GET /ask-copilot/pending.',
    });
  } catch (error) {
    console.error('Ask-copilot queue error:', error);
    return res.status(500).json({ error: 'Failed to queue knowledge request', message: error.message });
  }
});

// List ALL knowledge requests (with optional status filter)
app.get('/ask-copilot', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  try {
    const status = req.query.status;
    const category = req.query.category;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;

    const requests = knowledgeRequestsStore.listRequests({ status, category, limit });
    return res.json({
      success: true,
      requests,
      counts: knowledgeRequestsStore.getCounts(),
    });
  } catch (error) {
    console.error('Ask-copilot list error:', error);
    return res.status(500).json({ error: 'Failed to list knowledge requests', message: error.message });
  }
});

// List PENDING requests only (polled by ops-bob-ask-copilot.yml workflow)
app.get('/ask-copilot/pending', rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
    const priority = req.query.priority;

    const requests = knowledgeRequestsStore.listRequests({
      status: 'pending',
      priority: priority || undefined,
      limit,
    });

    return res.json({
      success: true,
      pending_count: requests.length,
      requests,
      counts: knowledgeRequestsStore.getCounts(),
      tip: 'POST /ask-copilot/:id/answer to send a researched answer. POST /ask-copilot/:id/skip to mark unanswerable.',
    });
  } catch (error) {
    console.error('Ask-copilot pending error:', error);
    return res.status(500).json({ error: 'Failed to list pending requests', message: error.message });
  }
});

// Receive an answer from Copilot — auto-ingests into Bob's intel feed
app.post('/ask-copilot/:id/answer', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const answer = String(req.body?.answer || '').trim();
    if (!answer) {
      return res.status(400).json({ error: 'answer is required' });
    }

    const answerSource = String(req.body?.source || 'copilot').slice(0, 100);
    const githubIssueUrl = req.body?.github_issue_url ? String(req.body.github_issue_url) : undefined;

    // Update the knowledge request record
    const request = knowledgeRequestsStore.answerRequest(id, answer, {
      source: answerSource,
      github_issue_url: githubIssueUrl,
    });

    // Auto-ingest into Bob's intel feed so all future queries benefit
    try {
      intelStore.ingestBulletin({
        type: 'system',
        title: `Copilot Answer: ${request.question.slice(0, 80)}`,
        summary: answer.slice(0, 500),
        content: answer,
        tags: [request.category, 'copilot-research', 'knowledge-request'],
        source: answerSource,
        metadata: {
          knowledge_request_id: id,
          question: request.question,
          category: request.category,
          answered_at: request.answered_at,
        },
      });
    } catch (ingestError) {
      // Log but don't fail — the answer is recorded even if intel ingest fails
      console.warn('Knowledge answer recorded but intel ingest failed:', ingestError.message);
    }

    return res.json({
      success: true,
      request,
      ingested_to_intel: true,
      message: 'Answer recorded and ingested into Bob\'s intel feed. Future chat queries will benefit from this knowledge.',
    });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    console.error('Ask-copilot answer error:', error);
    return res.status(status).json({ error: 'Failed to record answer', message: error.message });
  }
});

// Mark a request as skipped (Copilot could not research an answer)
app.post('/ask-copilot/:id/skip', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const reason = req.body?.reason;
    const request = knowledgeRequestsStore.skipRequest(id, reason);
    return res.json({ success: true, request });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to skip request', message: error.message });
  }
});

// Delete a knowledge request
app.delete('/ask-copilot/:id', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    knowledgeRequestsStore.deleteRequest(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to delete request', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// Code Task endpoints — Bob writes and updates code (same as Copilot agent)
//
// Flow:
//   1. POST /code/task         — submit a task; Bob drafts a plan with Ollama
//   2. GET  /code/tasks/pending — ops-bob-code-task.yml polls this
//   3. Workflow uses GitHub Models API + FieldOps context to generate files
//   4. POST /code/tasks/:id/start  — workflow marks task in_progress
//   5. POST /code/tasks/:id/result — workflow reports PR URL + build result
//   6. POST /code/tasks/:id/fail   — workflow reports failure
//   7. POST /code/tasks/:id/skip   — manually skip a pending task
//   8. DELETE /code/tasks/:id      — remove a task
// ---------------------------------------------------------------------------

const codeTaskRateLimit = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

// POST /code/task — submit a coding task
app.post('/code/task', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const task = req.body?.task;
    const context = req.body?.context;
    const target_files = req.body?.target_files;
    const priority = req.body?.priority;
    const requested_by = req.body?.requested_by;

    if (typeof task !== 'string' || !task.trim()) {
      return res.status(400).json({ error: 'task must be a non-empty string describing what to build or fix' });
    }
    if (task.length > 4000) {
      return res.status(400).json({ error: 'task must be 4000 characters or fewer' });
    }

    // Attempt to generate an initial plan with Ollama (non-blocking — fall back silently)
    let bob_plan = null;
    if (OLLAMA_ENABLED && !SELF_CONTAINED_MODE) {
      try {
        const planPrompt = buildCodePlanPrompt(task, context, target_files);
        const planResp = await fetchWithEgressCheck(
          `${OLLAMA_BASE_URL}/api/chat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: OLLAMA_MODEL,
              stream: false,
              options: { temperature: 0.2, num_predict: 1024 },
              messages: [
                {
                  role: 'system',
                  content: 'You are Bob, an AI coding assistant for FieldOps Manager. Your job is to produce a concise implementation plan for the given task. Output a numbered list of steps covering: files to create or modify, key patterns to follow, and any caveats. Keep it under 500 words.',
                },
                { role: 'user', content: planPrompt },
              ],
            }),
          },
          'ollama'
        );
        if (planResp.ok) {
          const planPayload = await planResp.json();
          const planText = planPayload?.message?.content;
          if (planText && typeof planText === 'string' && planText.trim()) {
            bob_plan = planText.trim().slice(0, 8000);
          }
        }
      } catch (planErr) {
        console.warn('⚠️  Bob code plan generation failed (non-fatal):', planErr.message);
      }
    }

    const entry = codeTaskStore.queueTask({
      task: task.trim(),
      context: context ? String(context).slice(0, 2000) : null,
      target_files: Array.isArray(target_files) ? target_files : [],
      priority: priority === 'high' ? 'high' : 'normal',
      requested_by: requested_by ? String(requested_by).slice(0, 200) : null,
      bob_plan,
    });

    return res.status(201).json({
      success: true,
      task: entry,
      message: `Task queued [${entry.short_id}]. The ops-bob-code-task workflow will pick it up, generate code, and open a PR. Monitor: GET /code/tasks/${entry.id}`,
    });
  } catch (error) {
    console.error('Code task queue error:', error);
    return res.status(500).json({ error: 'Failed to queue code task', message: error.message });
  }
});

// GET /code/tasks/pending — for ops-bob-code-task workflow to poll
app.get('/code/tasks/pending', codeTaskRateLimit, requireInferenceAuth, (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const tasks = codeTaskStore.listPending(limit);
    return res.json({ success: true, count: tasks.length, tasks });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list pending tasks', message: error.message });
  }
});

// GET /code/tasks — list all tasks with optional status filter
app.get('/code/tasks', codeTaskRateLimit, requireInferenceAuth, (req, res) => {
  try {
    const status = req.query.status;
    const tasks = codeTaskStore.listTasks({ status: status || undefined, limit: 50 });
    return res.json({ success: true, count: tasks.length, tasks, state: codeTaskStore.getState() });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list tasks', message: error.message });
  }
});

// GET /code/tasks/:id — get a single task
app.get('/code/tasks/:id', codeTaskRateLimit, requireInferenceAuth, (req, res) => {
  try {
    const task = codeTaskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: `Task not found: ${req.params.id}` });
    return res.json({ success: true, task });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get task', message: error.message });
  }
});

// POST /code/tasks/:id/start — workflow marks task in_progress
app.post('/code/tasks/:id/start', codeTaskRateLimit, requireInferenceAuth, (req, res) => {
  try {
    const task = codeTaskStore.startTask(req.params.id);
    return res.json({ success: true, task });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 400;
    return res.status(status).json({ error: 'Failed to start task', message: error.message });
  }
});

// POST /code/tasks/:id/result — workflow reports successful PR creation
app.post('/code/tasks/:id/result', codeTaskRateLimit, requireInferenceAuth, (req, res) => {
  try {
    const { pr_url, pr_number, files_changed, build_passed, branch } = req.body || {};
    const task = codeTaskStore.completeTask(req.params.id, {
      pr_url,
      pr_number,
      files_changed,
      build_passed: build_passed === true,
      branch,
    });
    console.log(`🎉 Code task result received [${task.short_id}]: PR ${task.pr_url}`);
    return res.json({ success: true, task });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 400;
    return res.status(status).json({ error: 'Failed to record task result', message: error.message });
  }
});

// POST /code/tasks/:id/fail — workflow reports failure
app.post('/code/tasks/:id/fail', codeTaskRateLimit, requireInferenceAuth, (req, res) => {
  try {
    const error = req.body?.error;
    const task = codeTaskStore.failTask(req.params.id, error);
    return res.json({ success: true, task });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    return res.status(status).json({ error: 'Failed to record task failure', message: err.message });
  }
});

// POST /code/tasks/:id/skip — manually skip a pending task
app.post('/code/tasks/:id/skip', codeTaskRateLimit, requireInferenceAuth, (req, res) => {
  try {
    const reason = req.body?.reason;
    const task = codeTaskStore.skipTask(req.params.id, reason);
    return res.json({ success: true, task });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 400;
    return res.status(status).json({ error: 'Failed to skip task', message: error.message });
  }
});

// DELETE /code/tasks/:id — remove a task
app.delete('/code/tasks/:id', codeTaskRateLimit, requireInferenceAuth, (req, res) => {
  try {
    codeTaskStore.deleteTask(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: 'Failed to delete task', message: error.message });
  }
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

async function inferVehicleAttributesWithOllama(vehicleCropBuffer) {
  if (!OLLAMA_VISION_ACTIVE) return null;

  const imageBase64 = vehicleCropBuffer.toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTR_TIMEOUT_MS);

  try {
    const response = await ollamaFetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_VISION_MODEL,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: 'You are a vehicle vision assistant for NZ enforcement software. Return strict JSON only.' },
          {
            role: 'user',
            content: 'From this vehicle photo crop, infer vehicle attributes for New Zealand roads. Return JSON with keys: vehicle_make, vehicle_model, vehicle_year, vehicle_colour, vehicle_make_confidence, vehicle_model_confidence, vehicle_year_confidence, vehicle_colour_confidence, sticker (object with presence, color, detection_confidence, color_confidence). Use best-effort estimates for make/model/year when plausible; do not leave null unless truly indeterminate. Keep confidences realistic in 0..1 and lower confidence when uncertain. vehicle_year must be an integer (e.g. 2016) or null.',
            images: [imageBase64],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(`⚠️ Ollama vision attrs returned ${response.status}`);
      return null;
    }

    const payload = await response.json();
    const content = payload?.message?.content;
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
    console.warn('⚠️ Ollama vision attrs failed:', error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

  if (VEHICLE_ATTRS_PROVIDER === 'ollama') {
    const ai = await inferVehicleAttributesWithOllama(vehicleCropBuffer || fullImageBuffer);
    if (ai) return { ...fallback, ...ai, vehicle_colour: ai.vehicle_colour || fallback.vehicle_colour, vehicle_colour_confidence: ai.vehicle_colour_confidence ?? fallback.vehicle_colour_confidence };
    return fallback;
  }

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
            advice: buildInferenceAdvice({
              pipeline: 'vehicle_infer',
              degraded: true,
            }),
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
          advice: buildInferenceAdvice({
            pipeline: 'vehicle_infer',
            degraded: true,
            detectionConfidence: null,
            embeddingQuality: null,
          }),
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
        advice: buildInferenceAdvice({
          pipeline: 'vehicle_infer',
          degraded: false,
          detectionConfidence: detection.confidence,
          embeddingQuality: quality,
        }),
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

    // ── 2. Tyre valve position via Ollama vision or OpenAI ───────────
    let valvePosition = 'unknown';
    let valveConfidence = 0;
    let valveDescription = 'Valve position could not be determined';

    if (OLLAMA_VISION_ACTIVE || OPENAI_ENABLED) {
      try {
        const imageBase64 = imageBuffer.toString('base64');
        const mimeType = req.file.mimetype || 'image/jpeg';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ATTR_TIMEOUT_MS);

        const VALVE_SYSTEM_PROMPT =
          'You are a parking enforcement assistant. Analyse the tyre in this photo and determine ' +
          'the clock position of the valve stem on the front-left tyre (or the most visible tyre). ' +
          'This is used for electronic chalking — NZ council parking enforcement. ' +
          'Return strict JSON only with keys: ' +
          'valve_position (one of: "north","east","south","west","unknown"), ' +
          'valve_confidence (0.0–1.0), ' +
          'valve_description (short natural-language description of position, e.g. "Valve stem pointing approximately to 12 o\'clock (north)"). ' +
          'If no tyre/wheel is clearly visible, return valve_position: "unknown" and valve_confidence: 0.';

        let valveResp;
        let valvePayloadContent;

        if (OLLAMA_VISION_ACTIVE) {
          recordEgressEvent('ollama', 'attempted', 'chalk valve detection');
          valveResp = await ollamaFetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              model: OLLAMA_VISION_MODEL,
              stream: false,
              format: 'json',
              messages: [
                { role: 'system', content: VALVE_SYSTEM_PROMPT },
                { role: 'user', content: 'What is the tyre valve stem position in this image?', images: [imageBase64] },
              ],
            }),
          });
          if (valveResp.ok) {
            const payload = await valveResp.json();
            valvePayloadContent = payload?.message?.content;
          }
        } else {
          recordEgressEvent('openai', 'attempted', 'chalk valve detection');
          valveResp = await safeFetch(`${OPENAI_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
            signal: controller.signal,
            body: JSON.stringify({
              model: OPENAI_MODEL,
              temperature: 0,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: VALVE_SYSTEM_PROMPT },
                { role: 'user', content: [
                  { type: 'text', text: 'What is the tyre valve stem position in this image?' },
                  { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
                ]},
              ],
            }),
          }, 'openai');
          if (valveResp.ok) {
            const payload = await valveResp.json();
            valvePayloadContent = payload?.choices?.[0]?.message?.content;
          }
        }

        clearTimeout(timeout);

        if (valvePayloadContent) {
          const parsed = JSON.parse(valvePayloadContent);
          const pos = parsed.valve_position?.toLowerCase();
          if (['north', 'east', 'south', 'west', 'unknown'].includes(pos)) {
            valvePosition    = pos;
            valveConfidence  = clamp01(parsed.valve_confidence ?? 0);
            valveDescription = parsed.valve_description ?? valveDescription;
          }
        }
      } catch (valveErr) {
        console.warn('⚠️  /infer/chalk valve detection failed (non-fatal):', valveErr.message);
      }
    } else {
      recordEgressEvent('openai', 'blocked', 'No vision provider configured (set OLLAMA_VISION_MODEL or OPENAI_API_KEY)');
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
    } else if (VEHICLE_ATTRS_PROVIDER === 'ollama' || VEHICLE_ATTRS_PROVIDER === 'openai') {
      // Degraded: no ONNX but can still get attributes via vision provider
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

    const advice = buildInferenceAdvice({
      pipeline: 'compare',
      similarity,
      thresholdUsed: activeThreshold,
      sameVehicle: same_vehicle,
    });

    return res.json({
      similarity: round4(similarity),
      same_vehicle,
      confidence,
      threshold_used: round4(activeThreshold),
      self_learning_enabled: selfLearningService.enabled,
      interpretation:
        same_vehicle
          ? `Same vehicle detected (similarity ${(similarity * 100).toFixed(1)}%)`
          : `Different vehicle or vehicle moved (similarity ${(similarity * 100).toFixed(1)}%)`,
      advice,
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

    const operational = selfLearningService.applyOperationalFeedback({
      pipeline: 'compare',
      confidence: similarity,
      was_correct: learningResult.predicted_same_vehicle === learningResult.actual_same_vehicle,
      context,
    });

    return res.json({
      success: true,
      learning: learningResult,
      operational,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to apply learning feedback', message: error.message });
  }
});

app.post('/learn/ingest-feedback', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const source = String(req.body?.source || 'manual').trim().slice(0, 80) || 'manual';

    if (events.length === 0) {
      return res.status(400).json({ error: 'events must be a non-empty array' });
    }

    const maxEvents = Math.min(events.length, 200);
    let compareFeedbackApplied = 0;
    let operationalFeedbackApplied = 0;
    let duplicateEventsSkipped = 0;
    const warnings = [];

    for (let i = 0; i < maxEvents; i++) {
      const event = events[i] || {};
      const pipeline = String(event.pipeline || 'unknown').toLowerCase();
      const incomingKey = safeEventKey(event.event_key);
      const derivedKey = incomingKey || safeEventKey(`${source}|${pipeline}|${event.similarity ?? ''}|${event.actual_same_vehicle ?? ''}|${event.confidence ?? ''}|${event.was_correct ?? ''}|${event.note ?? ''}`);
      if (derivedKey && selfLearningService.hasProcessedEventKey(derivedKey)) {
        duplicateEventsSkipped += 1;
        continue;
      }

      const context = {
        source,
        event_index: i,
        operator_note: cleanText(event.note) || null,
        event_key: derivedKey,
      };

      let eventApplied = false;

      if (Number.isFinite(Number(event.similarity)) && typeof event.actual_same_vehicle === 'boolean') {
        try {
          selfLearningService.applyCompareFeedback({
            similarity: Number(event.similarity),
            actual_same_vehicle: event.actual_same_vehicle,
            context,
          });
          compareFeedbackApplied += 1;
          eventApplied = true;
        } catch (err) {
          warnings.push(`compare_feedback[${i}] rejected: ${err.message}`);
        }
      }

      try {
        const result = selfLearningService.applyOperationalFeedback({
          pipeline,
          confidence: Number(event.confidence),
          was_correct: typeof event.was_correct === 'boolean' ? event.was_correct : null,
          context,
        });
        if (result?.stored) {
          operationalFeedbackApplied += 1;
          eventApplied = true;
        }
      } catch (err) {
        warnings.push(`operational_feedback[${i}] rejected: ${err.message}`);
      }

      if (eventApplied && derivedKey) {
        selfLearningService.markProcessedEventKey(derivedKey);
      }
    }

    return res.json({
      success: true,
      source,
      events_received: events.length,
      events_processed: maxEvents,
      compare_feedback_applied: compareFeedbackApplied,
      operational_feedback_applied: operationalFeedbackApplied,
      duplicate_events_skipped: duplicateEventsSkipped,
      warnings: warnings.slice(0, 20),
      learning: selfLearningService.getState(),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to ingest feedback', message: error.message });
  }
});

app.post('/learn/pretrain', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    if (!selfLearningService.enabled) {
      return res.status(503).json({ error: 'Self-learning is disabled' });
    }

    const profile = String(req.body?.profile || SELF_LEARNING_PRETRAIN_PROFILE).toLowerCase();
    const requestedMultiplier = Number(req.body?.multiplier ?? SELF_LEARNING_PRETRAIN_MULTIPLIER);
    const multiplier = Number.isFinite(requestedMultiplier)
      ? clamp(Math.floor(requestedMultiplier), 1, 50)
      : SELF_LEARNING_PRETRAIN_MULTIPLIER;
    const examples = profileExamples(profile);
    const thresholdBefore = selfLearningService.getThreshold();

    for (let i = 0; i < multiplier; i++) {
      for (const ex of examples) {
        selfLearningService.applyCompareFeedback({
          similarity: ex.similarity,
          actual_same_vehicle: ex.actual,
          context: {
            source: 'runtime-pretrain',
            profile,
          },
        });
      }
    }

    const thresholdAfter = selfLearningService.getThreshold();
    return res.json({
      success: true,
      profile,
      multiplier,
      samples_applied: examples.length * multiplier,
      threshold_before: round4(thresholdBefore),
      threshold_after: round4(thresholdAfter),
      learning: selfLearningService.getState(),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Pretraining run failed', message: error.message });
  }
});

app.get('/learn/dedup-state', rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  const limitRaw = Number(req.query?.limit || 200);
  const limit = Number.isFinite(limitRaw) ? clamp(Math.floor(limitRaw), 1, 1000) : 200;
  const keys = selfLearningService.listProcessedEventKeys(limit);

  return res.json({
    success: true,
    limit,
    dedup_keys_count: keys.length,
    dedup_keys: keys,
  });
});

app.post('/learn/dedup-reset', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const prefix = cleanText(req.body?.prefix || '') || '';
    const resetResult = selfLearningService.clearProcessedEventKeys({ prefix });

    return res.json({
      success: true,
      reset: resetResult,
      learning: selfLearningService.getState(),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to reset dedup cache', message: error.message });
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

// ============================================================================
// POST /infer/biosecurity — NZ Biosecurity plant identification + density
//
// Identifies NZ invasive plant species (primarily Nassella neesiana / Chilean
// Needlegrass) from a photo or video. Bob uses OpenAI vision to pre-populate
// the officer's on-scene checklist with species, density, evidence features
// and recommended action.
//
// Body (multipart form OR JSON):
//   photo (file) or image_base64 (string) — required
//   video_frames_base64 (JSON array)       — optional: extracted video frames
//   gps_lat, gps_lng (number)              — optional: GPS for weather + region
//   context (JSON string)                  — optional: address, region
//
// Response: { success, species[], dominant_species, total_density_per_m2,
//             checklist_prefill, recommended_action, weather, confidence, ... }
// ============================================================================
app.post('/infer/biosecurity', inferenceRateLimit, upload.single('photo'), requireInferenceAuth, async (req, res) => {
  const startTime = Date.now();
  try {
    // Support multipart (photo file) or JSON (image_base64)
    let imageBase64 = null;
    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
    } else if (req.body?.image_base64) {
      imageBase64 = String(req.body.image_base64);
    } else {
      return res.status(400).json({ error: 'No photo uploaded', hint: 'Send as multipart "photo" file or JSON "image_base64"' });
    }

    // Optional video frames
    let extraFrames = [];
    if (req.body?.video_frames_base64) {
      try {
        const parsed = typeof req.body.video_frames_base64 === 'string'
          ? JSON.parse(req.body.video_frames_base64)
          : req.body.video_frames_base64;
        if (Array.isArray(parsed)) extraFrames = parsed;
      } catch { /* ignore parse errors — proceed with single frame */ }
    }

    // GPS context
    const gpsLat = req.body?.gps_lat ? parseFloat(req.body.gps_lat) : null;
    const gpsLng = req.body?.gps_lng ? parseFloat(req.body.gps_lng) : null;
    let contextObj = null;
    if (req.body?.context) {
      try { contextObj = JSON.parse(req.body.context); } catch { /* non-fatal */ }
    }
    const gpsContext = (gpsLat && gpsLng) ? { lat: gpsLat, lng: gpsLng, region: contextObj?.region } : null;

    // Run plant identification (AI vision)
    recordEgressEvent('openai', 'attempted', 'biosecurity plant identification');
    const identResult = await identifyPlants(imageBase64, extraFrames, gpsContext);

    // Fetch weather if GPS available
    let weather = null;
    if (gpsLat && gpsLng) {
      weather = await getBioWeather(gpsLat, gpsLng).catch(() => ({ available: false, reason: 'weather fetch failed' }));
    }

    if (identResult.success) {
      recordEgressEvent('openai', 'success', 'biosecurity plant identification');
    } else {
      recordEgressEvent('openai', 'unavailable', identResult.reason || 'plant identification unavailable');
    }

    return res.json({
      success: true,
      identification: identResult,
      weather,
      processing_time_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error('❌ /infer/biosecurity error:', error);
    return res.status(500).json({ error: 'Biosecurity inference failed', message: error.message });
  }
});

// ============================================================================
// POST /infer/smoke — NZ RMA smoke complaint assessment
//
// Assesses smoke opacity, colour, prohibited materials indicators, wind/drift
// direction, and provides a preliminary "offensive or objectionable" rating
// to help NZ compliance officers under RMA s.17A.
//
// Body (multipart form OR JSON):
//   photo (file) or image_base64 (string) — required
//   video_frames_base64 (JSON array)       — optional: extracted video frames
//   gps_lat, gps_lng (number)              — optional: GPS for weather
//   metadata (JSON string)                 — optional: {complaint_time, duration_reported_mins, address}
//
// Response: { success, smoke_opacity, smoke_color, prohibited_materials_suspected,
//             checklist_prefill, recommended_action, weather, offensive_rating, ... }
// ============================================================================
app.post('/infer/smoke', inferenceRateLimit, upload.single('photo'), requireInferenceAuth, async (req, res) => {
  const startTime = Date.now();
  try {
    let imageBase64 = null;
    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
    } else if (req.body?.image_base64) {
      imageBase64 = String(req.body.image_base64);
    } else {
      return res.status(400).json({ error: 'No photo uploaded', hint: 'Send as multipart "photo" file or JSON "image_base64"' });
    }

    let extraFrames = [];
    if (req.body?.video_frames_base64) {
      try {
        const parsed = typeof req.body.video_frames_base64 === 'string'
          ? JSON.parse(req.body.video_frames_base64)
          : req.body.video_frames_base64;
        if (Array.isArray(parsed)) extraFrames = parsed;
      } catch { /* non-fatal */ }
    }

    const gpsLat = req.body?.gps_lat ? parseFloat(req.body.gps_lat) : null;
    const gpsLng = req.body?.gps_lng ? parseFloat(req.body.gps_lng) : null;
    let metaObj = {};
    if (req.body?.metadata) {
      try { metaObj = JSON.parse(req.body.metadata); } catch { /* non-fatal */ }
    }

    recordEgressEvent('openai', 'attempted', 'smoke complaint assessment');
    const assessResult = await assessSmoke(imageBase64, extraFrames, metaObj);

    let weather = null;
    if (gpsLat && gpsLng) {
      weather = await getBioWeather(gpsLat, gpsLng).catch(() => ({ available: false, reason: 'weather fetch failed' }));
      // Merge weather into checklist_prefill if AI didn't detect wind
      if (weather?.available && assessResult.checklist_prefill && !assessResult.checklist_prefill.wind_direction) {
        assessResult.checklist_prefill.wind_direction = weather.wind_direction;
        assessResult.checklist_prefill.wind_speed_kmh = weather.wind_speed_kmh;
      }
    }

    if (assessResult.success) {
      recordEgressEvent('openai', 'success', 'smoke complaint assessment');
    } else {
      recordEgressEvent('openai', 'unavailable', assessResult.reason || 'smoke assessment unavailable');
    }

    return res.json({
      success: true,
      assessment: assessResult,
      weather,
      processing_time_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error('❌ /infer/smoke error:', error);
    return res.status(500).json({ error: 'Smoke inference failed', message: error.message });
  }
});

function extractWavSamples(audioBuffer) {
  if (!audioBuffer || audioBuffer.length < 44) return null;
  if (audioBuffer.toString('ascii', 0, 4) !== 'RIFF' || audioBuffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let channels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let pcmData = null;

  while (offset + 8 <= audioBuffer.length) {
    const chunkId = audioBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = audioBuffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === 'fmt ' && chunkStart + 16 <= audioBuffer.length) {
      channels = audioBuffer.readUInt16LE(chunkStart + 2);
      sampleRate = audioBuffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = audioBuffer.readUInt16LE(chunkStart + 14);
    } else if (chunkId === 'data') {
      pcmData = audioBuffer.slice(chunkStart, chunkStart + chunkSize);
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!pcmData || bitsPerSample !== 16) return null;

  const frameCount = Math.floor(pcmData.length / (2 * channels));
  if (frameCount <= 0) return null;

  const samples = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const idx = (i * channels + ch) * 2;
      const s = pcmData.readInt16LE(idx) / 32768;
      sum += s;
    }
    samples[i] = sum / channels;
  }

  return { samples, sampleRate };
}

function computeAudioFeatures(samples, sampleRate) {
  if (!samples?.length || !sampleRate) return null;
  const n = samples.length;
  let sumSq = 0;
  let peak = 0;
  let zc = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    sumSq += s * s;
    peak = Math.max(peak, Math.abs(s));
    if (i > 0 && ((samples[i - 1] <= 0 && s > 0) || (samples[i - 1] >= 0 && s < 0))) zc += 1;
  }

  const rms = Math.sqrt(sumSq / n);
  const dbfs = 20 * Math.log10(Math.max(rms, 1e-6));
  const approxDbA = Math.max(30, Math.min(110, 94 + dbfs));

  const windowSize = Math.min(4096, n);
  const start = Math.max(0, Math.floor((n - windowSize) / 2));
  let lowEnergy = 0;
  let totalEnergy = 0;
  const nyquist = sampleRate / 2;
  for (let k = 0; k < Math.floor(windowSize / 2); k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < windowSize; t++) {
      const angle = (2 * Math.PI * k * t) / windowSize;
      const s = samples[start + t] || 0;
      re += s * Math.cos(angle);
      im -= s * Math.sin(angle);
    }
    const mag2 = re * re + im * im;
    const freq = (k / windowSize) * sampleRate;
    totalEnergy += mag2;
    if (freq <= 250) lowEnergy += mag2;
  }

  const lowFreqRatio = totalEnergy > 0 ? lowEnergy / totalEnergy : 0;
  const zcr = zc / n;

  return {
    rms,
    peak,
    zcr,
    lowFreqRatio,
    approxDbA,
    durationSec: n / sampleRate,
    sampleRate,
  };
}

async function transcribeAudioWithWhisperService(audioBuffer, mimeType = 'audio/wav') {
  if (!WHISPER_SERVICE_URL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUDIO_TRANSCRIBE_TIMEOUT_MS);
  try {
    const audioBase64 = audioBuffer.toString('base64');
    const resp = await fetch(`${WHISPER_SERVICE_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ audio_base64: audioBase64, mime_type: mimeType, language: 'en' }),
    });
    if (!resp.ok) return null;
    const payload = await resp.json().catch(() => ({}));
    return typeof payload?.text === 'string' ? payload.text.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeAudioWithWhisperCli(audioBuffer, language = 'en') {
  if (!WHISPER_CLI_PATH || !WHISPER_MODEL_PATH) return null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noise-audio-'));
  const wavPath = path.join(tempDir, 'input.wav');
  const outPrefix = path.join(tempDir, 'out');
  try {
    fs.writeFileSync(wavPath, audioBuffer);
    await execFileAsync(WHISPER_CLI_PATH, ['-m', WHISPER_MODEL_PATH, '-f', wavPath, '-otxt', '-of', outPrefix, '-l', String(language || 'en').slice(0, 8)], {
      timeout: AUDIO_TRANSCRIBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const txtPath = `${outPrefix}.txt`;
    if (!fs.existsSync(txtPath)) return null;
    return fs.readFileSync(txtPath, 'utf8').trim();
  } catch {
    return null;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

// ============================================================================
// POST /infer/noise-audio — NZ noise complaint field-audio assessment
//
// Supports street-side officer assessments where the officer records quick
// observations and optional transcript from PTT/voice notes. This endpoint
// returns matrix-prefill values and an enforcement recommendation compatible
// with the Noise Officer assessment form.
//
// Body (JSON):
// {
//   transcript?: string,
//   observed_db?: number,
//   time_category?: 'day'|'evening'|'night',
//   location_context?: string,
//   complaint_address?: string,
//   matrix?: { volume_score?: number, time_score?: number, tone_score?: number }
// }
// ============================================================================
app.post('/infer/noise-audio', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    let transcript = String(req.body?.transcript || '').trim();
    let observedDb = req.body?.observed_db != null ? Number(req.body.observed_db) : null;
    const timeCategoryRaw = String(req.body?.time_category || 'night').toLowerCase();
    const timeCategory = ['day', 'evening', 'night'].includes(timeCategoryRaw) ? timeCategoryRaw : 'night';
    const locationContext = String(req.body?.location_context || '').trim();
    const complaintAddress = String(req.body?.complaint_address || '').trim();
    const matrix = req.body?.matrix && typeof req.body.matrix === 'object' ? req.body.matrix : {};
    const audioBase64 = String(req.body?.audio_base64 || '').trim();
    const audioMimeType = String(req.body?.audio_mime_type || 'audio/wav').trim();

    const toNum = (v, fallback = null) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    let audioFeatures = null;
    if (audioBase64) {
      try {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const wav = extractWavSamples(audioBuffer);
        if (wav) {
          audioFeatures = computeAudioFeatures(wav.samples, wav.sampleRate);
          if (observedDb == null && Number.isFinite(audioFeatures?.approxDbA)) {
            observedDb = Math.round(audioFeatures.approxDbA);
          }
        }

        if (!transcript) {
          transcript =
            (await transcribeAudioWithWhisperService(audioBuffer, audioMimeType)) ||
            (await transcribeAudioWithWhisperCli(audioBuffer)) ||
            '';
        }
      } catch {
        // Non-fatal: continue with transcript/heuristic fallback
      }
    }

    // Heuristic prefill fallback (always available)
    let volumeScore = toNum(matrix.volume_score, -1);
    if (volumeScore < 0) {
      if (observedDb == null) volumeScore = transcript ? 2 : -1;
      else if (observedDb < 40) volumeScore = 0;
      else if (observedDb < 50) volumeScore = 1;
      else if (observedDb < 65) volumeScore = 2;
      else if (observedDb < 75) volumeScore = 3;
      else volumeScore = 4;
    }

    let timeScore = toNum(matrix.time_score, -1);
    if (timeScore < 1) {
      timeScore = timeCategory === 'day' ? 1 : timeCategory === 'evening' ? 2 : 4;
    }

    const lower = transcript.toLowerCase();
    let toneScore = toNum(matrix.tone_score, -1);
    if (toneScore < 0) {
      if (!transcript) toneScore = 1;
      else if (audioFeatures?.lowFreqRatio >= 0.55) toneScore = 2;
      else if (/(bass|thump|vibration|rattle|subwoofer|window shaking)/.test(lower)) toneScore = 2;
      else if (/(music|party|speaker|tv|shouting|engine|machinery|generator|dog)/.test(lower)) toneScore = 1;
      else toneScore = 1;
    }

    const matrixTotal = volumeScore === 0 ? 0 : (volumeScore + timeScore + toneScore);
    const exceedsDistrictPlan = matrixTotal >= 5;
    const recommendedAction = matrixTotal >= 7
      ? 'enforcement_notice'
      : matrixTotal >= 5
        ? 'abatement_notice'
        : 'verbal_warning';

    const summary = {
      success: true,
      matrix_prefill: {
        volume_score: volumeScore,
        time_score: timeScore,
        tone_score: toneScore,
        matrix_total_score: matrixTotal,
      },
      observed_db_a: observedDb,
      audio_features: audioFeatures,
      transcript,
      recommended_action: recommendedAction,
      exceeds_district_plan: exceedsDistrictPlan,
      noise_type: /(dog|bark)/.test(lower)
        ? 'animal_noise'
        : /(engine|motorbike|car|revving)/.test(lower)
          ? 'vehicle_noise'
          : /(music|party|speaker|stereo)/.test(lower)
            ? 'music'
            : /(construction|machinery|generator)/.test(lower)
              ? 'machinery'
              : 'general_noise',
      noise_source: /(party|music|speaker|stereo)/.test(lower)
        ? 'residential party/music'
        : /(engine|motorbike|car|revving)/.test(lower)
          ? 'vehicle activity'
          : /(construction|machinery|generator)/.test(lower)
            ? 'equipment/machinery'
            : null,
      confidence: transcript || observedDb != null || audioFeatures ? 0.82 : 0.45,
      rationale:
        `Estimated from field audio observations${observedDb != null ? ` (${observedDb} dB)` : ''}` +
        `${locationContext ? ` at ${locationContext}` : ''}${complaintAddress ? ` for ${complaintAddress}` : ''}.`,
      ai_caution:
        'Audio assessment is a screening aid. Officer judgment and council matrix policy govern final enforcement action.',
    };

    // Optional Ollama refinement when available
    if (OLLAMA_ENABLED && OLLAMA_MODEL) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const prompt = [
          'You are an NZ council noise control assistant. Return strict JSON only.',
          `Transcript: ${transcript || '(none)'}`,
          `Observed dB: ${observedDb == null ? '(none)' : observedDb}`,
          `Time category: ${timeCategory}`,
          `Initial matrix scores: volume=${volumeScore}, time=${timeScore}, tone=${toneScore}`,
          'Return keys: noise_type, noise_source, confidence (0..1), rationale (<=180 chars).',
        ].join('\n');

        const refineResp = await ollamaFetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: false,
            format: 'json',
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        clearTimeout(timeout);

        if (refineResp.ok) {
          const payload = await refineResp.json().catch(() => null);
          const content = payload?.message?.content;
          if (typeof content === 'string' && content.trim().startsWith('{')) {
            const parsed = JSON.parse(content);
            if (parsed?.noise_type) summary.noise_type = String(parsed.noise_type);
            if (parsed?.noise_source) summary.noise_source = String(parsed.noise_source);
            if (parsed?.rationale) summary.rationale = String(parsed.rationale).slice(0, 200);
            if (parsed?.confidence != null) {
              const c = Number(parsed.confidence);
              if (Number.isFinite(c)) summary.confidence = Math.max(0, Math.min(1, c));
            }
          }
        }
      } catch {
        // Non-fatal: keep heuristic result
      }
    }

    return res.json(summary);
  } catch (error) {
    console.error('❌ /infer/noise-audio error:', error);
    return res.status(500).json({ error: 'Noise audio assessment failed', message: error.message });
  }
});

app.post('/infer/transcribe', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const audioBase64 = String(req.body?.audio_base64 || '').trim();
    const audioMimeType = String(req.body?.audio_mime_type || 'audio/webm').trim();
    const language = String(req.body?.language || 'en').trim().slice(0, 8);

    if (!audioBase64) {
      return res.status(400).json({ error: 'audio_base64 is required' });
    }

    const sourceBuffer = Buffer.from(audioBase64, 'base64');
    if (!sourceBuffer.length) {
      return res.status(400).json({ error: 'audio_base64 decode failed' });
    }

    const extension = resolveAudioExtension(audioMimeType);
    const wavBuffer = extension === 'wav'
      ? sourceBuffer
      : await convertAudioToWav(sourceBuffer, extension);

    const transcript =
      (await transcribeAudioWithWhisperService(wavBuffer, 'audio/wav')) ||
      (await transcribeAudioWithWhisperCli(wavBuffer, language)) ||
      '';

    if (!transcript.trim()) {
      return res.status(502).json({
        error: 'Transcription unavailable',
        detail: 'Whisper service and CLI did not produce text.',
      });
    }

    return res.json({
      transcript: transcript.trim(),
      language,
      provider: 'whisper',
      source_mime_type: audioMimeType,
    });
  } catch (error) {
    console.error('❌ /infer/transcribe error:', error);
    return res.status(500).json({ error: 'Audio transcription failed', message: error.message });
  }
});

app.post('/infer/speak', inferenceRateLimit, requireInferenceAuth, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const voice = String(req.body?.voice || TTS_DEFAULT_VOICE).trim();
    const rate = Number.isFinite(Number(req.body?.rate)) ? Math.max(90, Math.min(260, Number(req.body?.rate))) : TTS_DEFAULT_RATE;
    const format = String(req.body?.format || 'wav').toLowerCase() === 'wav' ? 'wav' : 'wav';

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    if (TTS_ENGINE !== 'espeak-ng') {
      return res.status(503).json({ error: `Unsupported TTS engine: ${TTS_ENGINE}` });
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-'));
    const outputPath = path.join(tempDir, `speech.${format}`);
    try {
      await execFileAsync('/usr/bin/espeak-ng', ['-v', voice, '-s', String(rate), '-w', outputPath, text], {
        timeout: AUDIO_SYNTH_TIMEOUT_MS,
      });

      const wav = fs.readFileSync(outputPath);
      return res.json({
        audio_base64: wav.toString('base64'),
        audio_mime_type: 'audio/wav',
        provider: 'espeak-ng',
        voice,
        rate,
      });
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  } catch (error) {
    console.error('❌ /infer/speak error:', error);
    return res.status(500).json({ error: 'Speech synthesis failed', message: error.message });
  }
});

// Health check
app.get('/health', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const modelsLoaded = !!(yoloSession && embeddingSession);
  const whisper = getWhisperAvailability();
  const tts = getTtsAvailability();
  res.json({
    status: 'healthy',
    models: {
      yolo: yoloSession ? 'loaded' : 'not loaded',
      embedding: embeddingSession ? 'loaded' : 'not loaded',
      face_detect: faceDetectSession ? 'loaded' : (fs.existsSync(FACE_DETECT_MODEL_PATH) ? 'not loaded' : 'not present'),
      whisper_cli: whisper.cli_present ? 'present' : (whisper.cli_configured ? 'missing' : 'not configured'),
      whisper_model: whisper.model_present ? 'present' : (whisper.model_configured ? 'missing' : 'not configured'),
      tts_engine: tts.available ? tts.engine : `${tts.engine}:unavailable`,
    },
    config: {
      DEPLOY_SIGNATURE,
      SOURCE_VERSION: SOURCE_VERSION || null,
      OPERATING_MODE,
      VEHICLE_ATTRS_PROVIDER,
      VEHICLE_ATTRS_PROVIDER_RAW,
      TABULAR_NLP_PROVIDER,
      TABULAR_NLP_PROVIDER_RAW,
      CHAT_PROVIDER,
      CHAT_PROVIDER_RAW,
      HEURISTIC_PLAYBOOK_MODE,
      SELF_CONTAINED_MODE,
      REQUIRE_SELF_CONTAINED_MODE,
      SELF_CONTAINED_STRICT_EGRESS,
      SELF_LEARNING_ENABLED,
      SELF_HEALING_ENABLED,
      INTEL_SIGNING_REQUIRED: !!INTEL_HMAC_KEY,
      SUPABASE_JWKS_CONFIGURED: !!SUPABASE_JWKS_URL,
      SUPABASE_JWT_ISSUER_CONFIGURED: !!SUPABASE_JWT_ISSUER,
      SUPABASE_JWT_AUDIENCE_CONFIGURED: !!SUPABASE_JWT_AUDIENCE,
      SUPABASE_JWT_RUNTIME_ENABLED: !!SUPABASE_JWKS_URL && !SELF_CONTAINED_STRICT_EGRESS,
      EXTERNAL_EGRESS_ALLOWED: !SELF_CONTAINED_STRICT_EGRESS,
      OPENAI_BASE_URL_CUSTOM: OPENAI_BASE_URL !== 'https://api.openai.com/v1',
      OPENAI_MODEL: OPENAI_MODEL || null,
      OPENAI_API_KEY_SET: OPENAI_ENABLED,
      INFERENCE_API_KEY_SET: !!INFERENCE_API_KEY,
      SUPABASE_SERVICE_ROLE_KEY_SET: !!SUPABASE_SERVICE_ROLE_KEY,
      OLLAMA_BASE_URL: OLLAMA_BASE_URL,
      OLLAMA_BASE_URL_CONFIGURED,
      OLLAMA_MODEL,
      TRANSLATION_MODEL,
      TRANSLATION_TIMEOUT_MS,
      WHISPER_CLI_PATH: WHISPER_CLI_PATH || null,
      WHISPER_MODEL_PATH: WHISPER_MODEL_PATH || null,
      CHAT_TIMEOUT_MS,
      AUDIO_SYNTH_TIMEOUT_MS,
      TTS_ENGINE,
      TTS_DEFAULT_VOICE,
    },
    capabilities: {
      plate_inference: modelsLoaded,
      ai_attributes: (VEHICLE_ATTRS_PROVIDER === 'openai' && OPENAI_ENABLED) || (VEHICLE_ATTRS_PROVIDER === 'ollama' && OLLAMA_VISION_ACTIVE),
      tabular_nlp: true,
      tabular_nlp_ollama_enabled: OLLAMA_ENABLED,
      chat: true,
      chat_local_ollama_enabled: CHAT_PROVIDER === 'ollama' && OLLAMA_ENABLED,
      chat_heuristic_enabled: CHAT_PROVIDER === 'heuristic',
      translation: true,
      translation_local_ollama_enabled: OLLAMA_ENABLED,
      translation_model: TRANSLATION_MODEL,
      speech_synthesis: tts.available,
      speech_synthesis_engine: tts.engine,
      self_healing_bug_assistant: SELF_HEALING_ENABLED,
      local_intel_updates: true,
      tabular_nlp_auth_api_key: !!INFERENCE_API_KEY,
      tabular_nlp_auth_supabase_jwt: !!SUPABASE_JWKS_URL,
      tabular_nlp_auth_service_role: !!SUPABASE_SERVICE_ROLE_KEY,
      self_learning: selfLearningService.enabled,
      compare_threshold: Math.round(selfLearningService.getThreshold() * 10000) / 10000,
      // Tender generation — fully self-hosted, no cloud AI
      tender_generation: true,
      tender_primary_model: OLLAMA_MODEL,
      tender_writing_model: OLLAMA_MODEL_WRITING,
      tender_writing_model_distinct: OLLAMA_MODEL_WRITING !== OLLAMA_MODEL,
      tender_secondary_assistant_enabled: SECONDARY_ASSISTANT_ENABLED,
      tender_secondary_assistant_url: SECONDARY_ASSISTANT_ENABLED ? SECONDARY_ASSISTANT_URL : null,
      tender_training_enabled: SELF_LEARNING_ENABLED,
      // Self-hosted ALPR
      local_alpr: true,                          // always available (tesseract.js)
      local_alpr_plate_model: fs.existsSync(PLATE_DETECT_MODEL_PATH),
      cloud_alpr_enabled: CLOUD_ALPR_ENABLED,
      chalk_valve_ai: OPENAI_ENABLED || OLLAMA_VISION_ACTIVE,
      // Face recognition
      face_detection: OPENAI_ENABLED || fs.existsSync(FACE_DETECT_MODEL_PATH),
      face_detection_onnx: fs.existsSync(FACE_DETECT_MODEL_PATH), // UltraFace-640
      face_embedding: modelsLoaded,              // MobileNetV3 embedding for comparison
      // Coding knowledge (FieldOps codebase — same as Copilot coding agent context)
      code_assist: true,
      code_patterns_available: Object.keys(CODE_PATTERNS),
      // Code writing (Bob queues tasks; ops-bob-code-task workflow executes them)
      code_task_queue: true,
      code_tasks_pending: codeTaskStore.getState().counts.pending,
      // Biosecurity + Smoke OOH enforcement AI
      biosecurity_plant_id: OPENAI_ENABLED || OLLAMA_VISION_ACTIVE,
      smoke_assessment: OPENAI_ENABLED || OLLAMA_VISION_ACTIVE,
      noise_audio_assessment: true,
      noise_audio_local_whisper: whisper.cli_present && whisper.model_present,
    },
    ollama_circuit_breaker: OLLAMA_ENABLED ? ollamaCircuitBreaker.toJSON() : null,
    knowledge_requests: knowledgeRequestsStore.getState(),
    code_tasks: codeTaskStore.getState(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

async function probeOllamaTags(timeoutMs = 8000) {
  const result = {
    ok: false,
    status: null,
    latency_ms: null,
    error: null,
    models: [],
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    const resp = await ollamaFetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);

    result.status = resp.status;
    result.latency_ms = Date.now() - startedAt;

    if (!resp.ok) {
      result.error = `HTTP ${resp.status}`;
      return result;
    }

    const payload = await resp.json().catch(() => ({}));
    const modelNames = Array.isArray(payload?.models)
      ? payload.models.map((m) => String(m?.name || m?.model || '')).filter(Boolean)
      : [];

    result.ok = true;
    result.models = modelNames;
    return result;
  } catch (err) {
    const code = err?.cause?.code || err?.code || '';
    result.error = code ? `${err?.message || String(err)} [${code}]` : (err?.message || String(err));
    return result;
  }
}

async function probePttHealth(timeoutMs = 5000) {
  if (!PTT_SERVER_URL) {
    return { ok: false, configured: false, status: null, latency_ms: null, error: 'PTT_SERVER_URL not configured' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    const resp = await safeFetch(`${PTT_SERVER_URL}/health`, { method: 'GET', signal: controller.signal }, 'ptt');
    clearTimeout(timer);
    return {
      ok: resp.ok,
      configured: true,
      status: resp.status,
      latency_ms: Date.now() - startedAt,
      error: resp.ok ? null : `HTTP ${resp.status}`,
    };
  } catch (err) {
    const code = err?.cause?.code || err?.code || '';
    return {
      ok: false,
      configured: true,
      status: null,
      latency_ms: null,
      error: code ? `${err?.message || String(err)} [${code}]` : (err?.message || String(err)),
    };
  }
}

const DOCTOR_PLAYBOOK_IDS = ['ollama_recovery', 'ptt_token_path_repair', 'edge_auth_alignment'];
let doctorAutoHealInFlight = false;
const doctorAutoHealState = {
  timer: null,
  lastRunByPlaybook: {},
};

function readDoctorAuditLog() {
  try {
    if (!fs.existsSync(DOCTOR_AUDIT_PATH)) return { version: 1, entries: [] };
    const parsed = JSON.parse(fs.readFileSync(DOCTOR_AUDIT_PATH, 'utf8'));
    if (!parsed || !Array.isArray(parsed.entries)) return { version: 1, entries: [] };
    return parsed;
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeDoctorAuditLog(state) {
  const dir = path.dirname(DOCTOR_AUDIT_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const nextState = {
    version: 1,
    entries: Array.isArray(state?.entries)
      ? state.entries.slice(-DOCTOR_AUDIT_MAX_ENTRIES)
      : [],
  };
  const tmp = `${DOCTOR_AUDIT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(nextState, null, 2));
  fs.renameSync(tmp, DOCTOR_AUDIT_PATH);
}

function appendDoctorAuditEntry(entry) {
  const state = readDoctorAuditLog();
  const next = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...entry,
  };
  state.entries.push(next);
  writeDoctorAuditLog(state);
  return next;
}

function getDoctorTimeline(limit = 30) {
  const parsedLimit = Number(limit);
  const clamped = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(100, Math.floor(parsedLimit)))
    : 30;
  const state = readDoctorAuditLog();
  return state.entries.slice(-clamped).reverse();
}

function doctorCanAutoRun(playbook) {
  const last = Number(doctorAutoHealState.lastRunByPlaybook[playbook] || 0);
  return Date.now() - last >= DOCTOR_AUTO_HEAL_COOLDOWN_MS;
}

function markDoctorAutoRun(playbook) {
  doctorAutoHealState.lastRunByPlaybook[playbook] = Date.now();
}

async function runDoctorPlaybook(playbook, options = {}) {
  const dryRun = options?.dryRun !== false;
  const trigger = options?.trigger || 'manual';
  const actor = options?.actor || 'system';
  const executedAt = new Date().toISOString();
  const steps = [];

  if (!DOCTOR_PLAYBOOK_IDS.includes(playbook)) {
    return {
      success: false,
      error: 'Unknown playbook',
      available_playbooks: DOCTOR_PLAYBOOK_IDS,
      playbook,
      dry_run: dryRun,
      executed_at: executedAt,
    };
  }

  let response;

  if (playbook === 'ollama_recovery') {
    const before = OLLAMA_ENABLED ? ollamaCircuitBreaker.toJSON() : null;
    const preProbe = OLLAMA_ENABLED ? await probeOllamaTags(7000) : { ok: false, error: 'OLLAMA disabled by config' };
    steps.push({ step: 'pre_probe', result: preProbe });

    if (!dryRun && OLLAMA_ENABLED) {
      ollamaCircuitBreaker.recordSuccess();
      steps.push({ step: 'breaker_reset', result: ollamaCircuitBreaker.toJSON() });

      const requiredModels = [
        OLLAMA_MODEL,
        OLLAMA_MODEL_WRITING,
        TRANSLATION_MODEL,
        OLLAMA_VISION_ACTIVE ? OLLAMA_VISION_MODEL : null,
      ].filter(Boolean);
      const missing = requiredModels.filter((m) => !modelLooksPresent(preProbe.models || [], m));
      if (missing.length && OLLAMA_AUTO_PULL_MODELS) {
        const pullResults = [];
        for (const model of missing) {
          const pulled = await ensureOllamaModelPulled(model);
          pullResults.push({ model, pulled });
        }
        steps.push({ step: 'model_autopull', result: pullResults });
      }
    }

    const postProbe = OLLAMA_ENABLED ? await probeOllamaTags(7000) : { ok: false, error: 'OLLAMA disabled by config' };
    if (postProbe.ok) ollamaCircuitBreaker.recordSuccess();
    else if (OLLAMA_ENABLED) ollamaCircuitBreaker.recordFailure(new Error(postProbe.error || 'post-repair probe failed'));

    const after = OLLAMA_ENABLED ? ollamaCircuitBreaker.toJSON() : null;
    response = {
      success: true,
      playbook,
      dry_run: dryRun,
      executed_at: executedAt,
      before,
      after,
      steps,
      verification: postProbe,
    };
  }

  if (playbook === 'ptt_token_path_repair') {
    const before = await probePttHealth(5000);
    steps.push({ step: 'pre_probe', result: before });

    const remediation = [];
    if (!PTT_SERVER_URL) remediation.push('Set PTT_SERVER_URL on the Bob inference service and Supabase edge environment.');
    if (!SUPABASE_SERVICE_ROLE_KEY) remediation.push('Set SUPABASE_SERVICE_ROLE_KEY so trusted service-to-service auth is available.');
    if (!INFERENCE_API_KEY && !SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_JWKS_URL) {
      remediation.push('Set INFERENCE_API_KEY (or SUPABASE_SERVICE_ROLE_KEY/JWKS) so secure token mint path can authenticate.');
    }
    steps.push({ step: 'remediation_plan', result: remediation });

    const after = await probePttHealth(5000);
    response = { success: true, playbook, dry_run: dryRun, executed_at: executedAt, before, after, steps };
  }

  if (playbook === 'edge_auth_alignment') {
    const checks = {
      inference_api_key_set: !!INFERENCE_API_KEY,
      service_role_set: !!SUPABASE_SERVICE_ROLE_KEY,
      jwks_url_set: !!SUPABASE_JWKS_URL,
      jwt_issuer_set: !!SUPABASE_JWT_ISSUER,
      jwt_audience_set: !!SUPABASE_JWT_AUDIENCE,
      runtime_jwt_enabled: !!SUPABASE_JWKS_URL && !SELF_CONTAINED_STRICT_EGRESS,
      strict_egress: SELF_CONTAINED_STRICT_EGRESS,
    };
    const remediation = [];
    if (!checks.inference_api_key_set && !checks.service_role_set && !checks.jwks_url_set) {
      remediation.push('Configure one auth path: INFERENCE_API_KEY (recommended), SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_JWKS_URL.');
    }
    if (checks.jwks_url_set && !checks.jwt_issuer_set) remediation.push('Set SUPABASE_JWT_ISSUER for strict JWT issuer validation.');
    if (checks.jwks_url_set && !checks.jwt_audience_set) remediation.push('Set SUPABASE_JWT_AUDIENCE for strict JWT audience validation.');
    if (checks.strict_egress && checks.jwks_url_set) {
      remediation.push('JWKS runtime verification is blocked by strict egress in self-contained mode; use INFERENCE_API_KEY or service role path for edge-to-Bob calls.');
    }
    response = { success: true, playbook, dry_run: dryRun, executed_at: executedAt, checks, remediation };
  }

  appendDoctorAuditEntry({
    playbook,
    trigger,
    actor,
    dry_run: dryRun,
    success: !!response?.success,
    summary: response?.success
      ? `${playbook} completed`
      : response?.error || `${playbook} failed`,
    result: response,
  });

  return response;
}

async function runDoctorAutoHealCycle() {
  if (!DOCTOR_AUTO_HEAL_ENABLED || doctorAutoHealInFlight) return;
  doctorAutoHealInFlight = true;
  try {
    const snapshot = await buildDoctorHealthSnapshot();
    const riskIds = new Set((snapshot?.active_risks || []).map((r) => r.id));
    const candidates = [];

    if (riskIds.has('ollama_connectivity_unstable') || riskIds.has('vision_model_missing')) {
      candidates.push('ollama_recovery');
    }
    if (riskIds.has('ptt_token_path_unhealthy')) {
      candidates.push('ptt_token_path_repair');
    }
    if (riskIds.has('edge_auth_unconfigured')) {
      candidates.push('edge_auth_alignment');
    }

    for (const playbook of candidates) {
      if (!doctorCanAutoRun(playbook)) continue;
      markDoctorAutoRun(playbook);
      await runDoctorPlaybook(playbook, {
        dryRun: false,
        trigger: 'auto-heal',
        actor: 'doctor-loop',
      });
      break;
    }
  } catch (err) {
    appendDoctorAuditEntry({
      playbook: 'auto_heal_cycle',
      trigger: 'auto-heal',
      actor: 'doctor-loop',
      dry_run: false,
      success: false,
      summary: err?.message || String(err),
      result: { error: err?.message || String(err) },
    });
  } finally {
    doctorAutoHealInFlight = false;
  }
}

async function buildDoctorHealthSnapshot() {
  const modelsLoaded = !!(yoloSession && embeddingSession);
  const ollamaProbe = OLLAMA_ENABLED ? await probeOllamaTags(7000) : null;
  const pttProbe = await probePttHealth(5000);
  const breaker = OLLAMA_ENABLED ? ollamaCircuitBreaker.toJSON() : null;
  const crossArea = {
    supabase: {
      configured: !!SUPABASE_URL,
      service_auth_ready: !!SUPABASE_SERVICE_ROLE_KEY,
      jwt_runtime_ready: !!SUPABASE_JWKS_URL && !!SUPABASE_JWT_ISSUER && !!SUPABASE_JWT_AUDIENCE,
      mode: !!SUPABASE_SERVICE_ROLE_KEY || !!SUPABASE_JWKS_URL ? 'connected' : 'limited',
    },
    railway: {
      configured: true,
      inferred_environment: !!process.env.RAILWAY_ENVIRONMENT,
      service_audit_known: Array.isArray(RAILWAY_SERVICES_AUDIT?.services),
      mode: 'knowledge+runtime',
    },
    vercel: {
      configured: !!process.env.VERCEL_URL || !!process.env.VERCEL_PROJECT_ID,
      mode: 'knowledge',
      note: 'Bob can diagnose Vercel patterns from project knowledge; direct control depends on external workflow connectors.',
    },
    github: {
      configured: !!process.env.GITHUB_TOKEN || !!process.env.GH_TOKEN,
      mode: 'knowledge+workflow',
      note: 'Bob can queue code/intel tasks and collaborate with GitHub workflows; full GitHub API control depends on token wiring.',
    },
  };

  const risks = [];
  if (!modelsLoaded) {
    risks.push({
      id: 'inference_models_not_loaded',
      severity: 'high',
      component: 'inference',
      message: 'YOLO/embedding ONNX models are not fully loaded.',
      runbook: 'Investigate model files and startup logs. Restart inference service after model restore.',
    });
  }
  if (OLLAMA_ENABLED && (!ollamaProbe?.ok || breaker?.state === 'open')) {
    risks.push({
      id: 'ollama_connectivity_unstable',
      severity: 'critical',
      component: 'ollama',
      message: ollamaProbe?.error || `Ollama breaker is ${breaker?.state || 'unknown'}`,
      runbook: 'Run playbook: ollama_recovery.',
    });
  }
  if (OLLAMA_VISION_ACTIVE && !modelLooksPresent(ollamaProbe?.models || [], OLLAMA_VISION_MODEL)) {
    risks.push({
      id: 'vision_model_missing',
      severity: 'high',
      component: 'ollama',
      message: `Vision model missing: ${OLLAMA_VISION_MODEL}`,
      runbook: 'Run playbook: ollama_recovery to auto-pull missing model.',
    });
  }
  if (!pttProbe.ok) {
    risks.push({
      id: 'ptt_token_path_unhealthy',
      severity: pttProbe.configured ? 'high' : 'medium',
      component: 'ptt',
      message: pttProbe.error || 'PTT health probe failed',
      runbook: 'Run playbook: ptt_token_path_repair.',
    });
  }
  if (!INFERENCE_API_KEY && !SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_JWKS_URL) {
    risks.push({
      id: 'edge_auth_unconfigured',
      severity: 'high',
      component: 'auth',
      message: 'No inference authentication method is configured.',
      runbook: 'Run playbook: edge_auth_alignment for exact remediation steps.',
    });
  }
  if (!crossArea.supabase.configured) {
    risks.push({
      id: 'supabase_unconfigured',
      severity: 'high',
      component: 'supabase',
      message: 'SUPABASE_URL is not configured on Bob.',
      runbook: 'Configure SUPABASE_URL and auth path (service role or JWT runtime) for cross-area diagnostics.',
    });
  }

  let score = 100;
  for (const risk of risks) {
    if (risk.severity === 'critical') score -= 30;
    else if (risk.severity === 'high') score -= 20;
    else if (risk.severity === 'medium') score -= 10;
    else score -= 5;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    status: score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 50 ? 'degraded' : 'critical',
    doctor_score: score,
    components: {
      inference: {
        status: modelsLoaded ? 'healthy' : 'degraded',
        models: {
          yolo: yoloSession ? 'loaded' : 'not loaded',
          embedding: embeddingSession ? 'loaded' : 'not loaded',
          face_detect: faceDetectSession ? 'loaded' : (fs.existsSync(FACE_DETECT_MODEL_PATH) ? 'not loaded' : 'not present'),
        },
      },
      ollama: {
        enabled: OLLAMA_ENABLED,
        vision_enabled: OLLAMA_VISION_ACTIVE,
        model: OLLAMA_MODEL,
        vision_model: OLLAMA_VISION_MODEL || null,
        probe: ollamaProbe,
        breaker,
      },
      ptt: pttProbe,
      auth: {
        inference_api_key_set: !!INFERENCE_API_KEY,
        service_role_set: !!SUPABASE_SERVICE_ROLE_KEY,
        jwks_url_set: !!SUPABASE_JWKS_URL,
        jwt_issuer_set: !!SUPABASE_JWT_ISSUER,
        jwt_audience_set: !!SUPABASE_JWT_AUDIENCE,
        runtime_jwt_enabled: !!SUPABASE_JWKS_URL && !SELF_CONTAINED_STRICT_EGRESS,
      },
      queues: {
        knowledge_requests: knowledgeRequestsStore.getState().counts,
        code_tasks: codeTaskStore.getState().counts,
      },
      cross_area: crossArea,
    },
    active_risks: risks,
    recent_runs: getDoctorTimeline(5),
    auto_heal: {
      enabled: DOCTOR_AUTO_HEAL_ENABLED,
      interval_ms: DOCTOR_AUTO_HEAL_INTERVAL_MS,
      cooldown_ms: DOCTOR_AUTO_HEAL_COOLDOWN_MS,
      in_flight: doctorAutoHealInFlight,
    },
    playbooks: [
      { id: 'ollama_recovery', title: 'Ollama Recovery', description: 'Resets breaker, probes tags, and optionally pulls missing Ollama models.' },
      { id: 'ptt_token_path_repair', title: 'PTT Token Path Repair', description: 'Validates PTT server reachability and token path preconditions.' },
      { id: 'edge_auth_alignment', title: 'Edge Auth Alignment', description: 'Checks inference auth mismatch conditions and returns remediations.' },
    ],
    checked_at: new Date().toISOString(),
  };
}

// Doctor control-room health endpoint (protected).
app.get('/doctor/health', rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, async (req, res) => {
  const snapshot = await buildDoctorHealthSnapshot();
  res.json(snapshot);
});

// Doctor execution timeline endpoint (protected).
app.get('/doctor/timeline', rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, (req, res) => {
  const limit = Number(req.query?.limit || 30);
  res.json({
    success: true,
    entries: getDoctorTimeline(limit),
  });
});

// Doctor playbook runner (protected, supports dry-run mode).
app.post('/doctor/playbook/run', rateLimit({ windowMs: 60_000, max: 12, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, async (req, res) => {
  const playbook = String(req.body?.playbook || '').trim();
  const dryRun = req.body?.dry_run !== false;

  if (!playbook) {
    return res.status(400).json({ error: 'playbook is required', available_playbooks: DOCTOR_PLAYBOOK_IDS });
  }
  const result = await runDoctorPlaybook(playbook, {
    dryRun,
    trigger: 'manual',
    actor: req?.user?.email || req?.user?.id || 'api-client',
  });
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

// Ollama circuit breaker reset + live probe (protected — requires inference auth).
app.post('/ops/circuit-reset', rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }), requireInferenceAuth, async (req, res) => {
  const prevState = ollamaCircuitBreaker.toJSON();
  // Reset to closed so the probe below is allowed through
  ollamaCircuitBreaker.recordSuccess();
  console.log('🔄 /ops/circuit-reset invoked — breaker reset, running live probe...');

  let probeStatus = null;
  let probeError  = null;
  let probeMs     = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const t0 = Date.now();
    const resp = await ollamaFetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    probeMs     = Date.now() - t0;
    probeStatus = resp.status;
    if (resp.ok) {
      ollamaCircuitBreaker.recordSuccess();
    } else {
      ollamaCircuitBreaker.recordFailure(new Error(`HTTP ${resp.status}`));
    }
  } catch (err) {
    const code = err?.cause?.code || err?.code || '';
    probeError = code ? `${err.message} [${code}]` : err.message;
    ollamaCircuitBreaker.recordFailure(err);
  }

  res.json({
    success: true,
    previous: prevState,
    current:  ollamaCircuitBreaker.toJSON(),
    probe: { url: `${OLLAMA_BASE_URL}/api/tags`, status: probeStatus, error: probeError, ms: probeMs },
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

  if (!OLLAMA_BASE_URL_CONFIGURED) {
    console.warn('⚠️  OLLAMA_BASE_URL is not set — defaulting to http://127.0.0.1:11434 (localhost).');
    console.warn('   On Railway, set OLLAMA_BASE_URL=http://ollama.railway.internal:<port> where <port> matches the Ollama OLLAMA_HOST setting.');
    console.warn('   Check the Ollama service startup logs for the line: 🌐 Binding Ollama to 0.0.0.0:<port>');
  } else if (OLLAMA_REQUESTED && !isRailwayOllamaInternal(OLLAMA_BASE_URL)) {
    if (SELF_CONTAINED_MODE) {
      console.warn(`⚠️  OLLAMA_BASE_URL is not a Railway internal URL. Current value: ${OLLAMA_BASE_URL}`);
      console.warn('   SELF_CONTAINED_MODE will keep Ollama disabled for non-local URLs; chat will fall back to heuristic.');
      recordEgressEvent('ollama', 'blocked', 'self-contained startup with non-local/non-required OLLAMA_BASE_URL');
    } else {
      console.warn(`⚠️  OLLAMA_BASE_URL is not a Railway internal URL. Current value: ${OLLAMA_BASE_URL}`);
      console.warn('   build-training mode allows external Ollama URLs, but railway.internal is recommended for security.');
      recordEgressEvent('ollama', 'allow', 'startup with external OLLAMA_BASE_URL while SELF_CONTAINED_MODE=false');
    }
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ORC/AI inference service running on port ${PORT}`);
    // Config summary — makes misconfiguration visible at a glance in Railway logs
    const usesOllama = VEHICLE_ATTRS_PROVIDER === 'ollama' || TABULAR_NLP_PROVIDER === 'ollama';
    const usesOpenAI = (VEHICLE_ATTRS_PROVIDER === 'openai' || TABULAR_NLP_PROVIDER === 'openai') && OPENAI_ENABLED;
    console.log(`⚙️  Config:`, {
      OPERATING_MODE,
      VEHICLE_ATTRS_PROVIDER,
      TABULAR_NLP_PROVIDER,
      TABULAR_NLP_TIMEOUT_MS,
      SELF_CONTAINED_MODE,
      REQUIRE_SELF_CONTAINED_MODE,
      SELF_CONTAINED_STRICT_EGRESS,
      OLLAMA_BASE_URL,
      OLLAMA_BASE_URL_CONFIGURED,
      ...(usesOllama && { OLLAMA_MODEL }),
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
      console.warn('   Authenticated endpoints (/infer/face, /infer/compare, /infer/alpr, /nlp/tabular/analyze, /chat, /self-heal/*, /intel/*, /assess/ui/*, /navigate/*)');
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
    if (OPERATING_MODE === 'self-contained') {
      console.log('🔒 SELF_CONTAINED_MODE enabled — outbound cloud AI/ALPR providers are disabled.');
      if (TABULAR_NLP_PROVIDER === 'ollama' && !OLLAMA_ENABLED) {
        console.log('ℹ️  OLLAMA_BASE_URL is non-local; tabular analysis will use heuristic mode.');
      }
    } else {
      console.log('🌐 Build/training mode enabled — external providers, JWKS auth, and remote Ollama URLs are allowed.');
    }

    // -----------------------------------------------------------------------
    // Startup Ollama connectivity probe – surfaces misconfigurations early.
    // Non-blocking: the server is already listening and can serve requests.
    // -----------------------------------------------------------------------
    if (OLLAMA_ENABLED) {
      const probeUrl = `${OLLAMA_BASE_URL}/api/tags`;
      console.log(`🔍 Probing Ollama at ${probeUrl} …`);
      const probeController = new AbortController();
      const probeTimeout = setTimeout(() => probeController.abort(), 5000);
      fetch(probeUrl, { signal: probeController.signal })
        .then(async (resp) => {
          clearTimeout(probeTimeout);
          if (resp.ok) {
            const body = await resp.json().catch(() => null);
            const models = body?.models?.map((m) => m.name) || [];
            console.log(`✅ Ollama reachable — ${models.length} model(s) available${models.length ? ': ' + models.join(', ') : ''}`);
            const requiredModels = Array.from(new Set([
              OLLAMA_MODEL,
              OLLAMA_MODEL_WRITING,
              OLLAMA_VISION_ACTIVE ? OLLAMA_VISION_MODEL : null,
            ].filter(Boolean)));
            const missing = requiredModels.filter((m) => !modelLooksPresent(models, m));

            if (missing.length > 0) {
              console.warn(`⚠️  Missing Ollama model(s): ${missing.join(', ')}`);
              if (OLLAMA_AUTO_PULL_MODELS) {
                console.log(`🛠️  OLLAMA_AUTO_PULL_MODELS enabled — attempting to pull missing models...`);
                for (const modelName of missing) {
                  // eslint-disable-next-line no-await-in-loop
                  await ensureOllamaModelPulled(modelName);
                }
              } else {
                console.warn('ℹ️  Auto-pull disabled. Set OLLAMA_AUTO_PULL_MODELS=true to pull missing models automatically.');
              }
            }
          } else {
            console.warn(`⚠️  Ollama probe returned HTTP ${resp.status} (${OLLAMA_BASE_URL})`);
          }
        })
        .catch((err) => {
          clearTimeout(probeTimeout);
          console.warn(`❌ Ollama unreachable at ${OLLAMA_BASE_URL}: ${err.message}`);
          console.warn(`   Chat and tabular NLP will fall back to heuristic mode.`);
          console.warn(`   Verify OLLAMA_BASE_URL port matches the Ollama service (check OLLAMA_HOST on the Ollama container).`);
          // Pre-trip the circuit breaker so real requests don't spam logs
          ollamaCircuitBreaker.trip(err);
        });
    }

    if (DOCTOR_AUTO_HEAL_ENABLED) {
      console.log(`🩺 Doctor auto-heal loop enabled (${Math.round(DOCTOR_AUTO_HEAL_INTERVAL_MS / 1000)}s interval, ${Math.round(DOCTOR_AUTO_HEAL_COOLDOWN_MS / 1000)}s cooldown)`);
      runDoctorAutoHealCycle().catch(() => {});
      doctorAutoHealState.timer = setInterval(() => {
        runDoctorAutoHealCycle().catch(() => {});
      }, DOCTOR_AUTO_HEAL_INTERVAL_MS);
    } else {
      console.log('🩺 Doctor auto-heal loop disabled (DOCTOR_AUTO_HEAL_ENABLED=false)');
    }
  });
});
