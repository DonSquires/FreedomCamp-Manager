/**
 * ORC/AI Inference Service — Production build for Railway
 *
 * Stack:
 *   YOLOv8n          vehicle detection (bounding box)
 *   MobileNetV3      384-dimensional feature embedding
 *   ONNX Runtime     cross-platform CPU inference
 *   OpenAI Vision    optional plate / make / model / colour extraction
 *                    (set OPENAI_API_KEY to enable; omit to skip)
 *
 * Endpoints:
 *   POST /infer      accept multipart photo OR JSON { image_base64 }
 *                    returns embedding + optional plate/vehicle metadata
 *   GET  /health     liveness + readiness
 *
 * Fallback behaviour:
 *   - If ONNX models not found: returns 503 so edge function falls back to
 *     OnSpace AI mode automatically.
 *   - If OpenAI key absent: plate/vehicle metadata fields are null; edge
 *     function accepts client-side plate from the OnSpace AI fallback.
 *
 * Environment variables:
 *   PORT                    default 3000
 *   NODE_ENV                production|development
 *   ALLOWED_ORIGINS         comma-separated list of allowed CORS origins
 *   OPENAI_API_KEY          optional — enables plate + vehicle metadata
 *   YOLO_MODEL_PATH         default ./models/yolov8n.onnx
 *   EMBEDDING_MODEL_PATH    default ./models/mobilenet_v3.onnx
 *   DETECTION_CONFIDENCE    default 0.5
 */

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DETECTION_CONFIDENCE = parseFloat(process.env.DETECTION_CONFIDENCE || '0.5');
const YOLO_MODEL_PATH = process.env.YOLO_MODEL_PATH || './models/yolov8n.onnx';
const EMBEDDING_MODEL_PATH = process.env.EMBEDDING_MODEL_PATH || './models/mobilenet_v3.onnx';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;

// Configure CORS
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  methods: ['POST', 'GET'],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '15mb' }));

// Configure multer for multipart uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
  },
});

// ============================================================================
// Model loading — graceful: mark unavailable rather than crash
// ============================================================================
let yoloSession = null;
let embeddingSession = null;
let modelsLoaded = false;

async function loadModels() {
  console.log('Loading ONNX models...');
  try {
    if (!fs.existsSync(YOLO_MODEL_PATH)) {
      console.warn(`⚠️  YOLOv8n not found at ${YOLO_MODEL_PATH} — run npm run download-models`);
      return;
    }
    yoloSession = await ort.InferenceSession.create(YOLO_MODEL_PATH, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all'
    });
    console.log('✅ YOLOv8n loaded');

    if (!fs.existsSync(EMBEDDING_MODEL_PATH)) {
      console.warn(`⚠️  MobileNetV3 not found at ${EMBEDDING_MODEL_PATH}`);
      return;
    }
    embeddingSession = await ort.InferenceSession.create(EMBEDDING_MODEL_PATH, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
    console.log('✅ MobileNetV3 loaded');
    modelsLoaded = true;
  } catch (error) {
    console.error('❌ Model loading failed (service will run in degraded mode):', error.message);
    // Do NOT exit — allow service to start and return 503 on /infer
  }
}

// ============================================================================
// Image helpers
// ============================================================================

// ============================================================================
// Image preprocessing helpers
// ============================================================================

async function preprocessForYOLO(imageBuffer) {
  const { data } = await sharp(imageBuffer)
    .resize(640, 640, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // HWC → CHW, normalise [0-255] → [0-1]
  const chw = new Float32Array(3 * 640 * 640);
  for (let c = 0; c < 3; c++) {
    for (let h = 0; h < 640; h++) {
      for (let w = 0; w < 640; w++) {
        chw[c * 640 * 640 + h * 640 + w] = data[(h * 640 + w) * 3 + c] / 255.0;
      }
    }
  }
  return new ort.Tensor('float32', chw, [1, 3, 640, 640]);
}

async function preprocessForEmbedding(imageBuffer, bbox = null) {
  let pipeline = sharp(imageBuffer);
  if (bbox) {
    pipeline = pipeline.extract({
      left: Math.max(0, Math.floor(bbox.x)),
      top: Math.max(0, Math.floor(bbox.y)),
      width: Math.max(1, Math.ceil(bbox.width)),
      height: Math.max(1, Math.ceil(bbox.height)),
    });
  }

  const { data } = await pipeline
    .resize(224, 224, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // ImageNet normalisation
  const mean = [0.485, 0.456, 0.406];
  const std  = [0.229, 0.224, 0.225];
  const t = new Float32Array(3 * 224 * 224);
  for (let c = 0; c < 3; c++) {
    for (let h = 0; h < 224; h++) {
      for (let w = 0; w < 224; w++) {
        const px = data[(h * 224 + w) * 3 + c] / 255.0;
        t[c * 224 * 224 + h * 224 + w] = (px - mean[c]) / std[c];
      }
    }
  }
  return new ort.Tensor('float32', t, [1, 3, 224, 224]);
}

// ============================================================================
// YOLO detection helper
// ============================================================================

async function detectVehicle(imageBuffer) {
  const tensor = await preprocessForYOLO(imageBuffer);
  const results = await yoloSession.run({ images: tensor });
  const output = results.output0.data;

  const vehicleClasses = new Set([2, 3, 5, 7]); // car, motorcycle, bus, truck (COCO)
  let best = null;

  for (let i = 0; i < 8400; i++) {
    const o = i * 84;
    for (const cls of vehicleClasses) {
      const conf = output[o + 4 + cls];
      if (conf > DETECTION_CONFIDENCE && (!best || conf > best.confidence)) {
        best = {
          bbox: { x: output[o], y: output[o + 1], width: output[o + 2], height: output[o + 3] },
          confidence: conf,
          class: cls,
        };
      }
    }
  }
  return best;
}

// ============================================================================
// Embedding helper
// ============================================================================

async function generateEmbedding(imageBuffer, bbox = null) {
  const tensor = await preprocessForEmbedding(imageBuffer, bbox);
  const results = await embeddingSession.run({ input: tensor });
  const embedding = Array.from(results.output.data);
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  return { embedding, quality: Math.min(1.0, norm / 10.0), norm };
}

// ============================================================================
// OpenAI Vision — plate + vehicle metadata (optional)
// Sends the photo as a base64 data URL and asks for structured JSON.
// ============================================================================

async function extractVehicleMetadata(imageBuffer) {
  if (!OPENAI_API_KEY) return null;

  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const requestBody = JSON.stringify({
    model: 'gpt-4o-mini',
    max_tokens: 150,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'low' },
          },
          {
            type: 'text',
            text: `Look at this vehicle photo and respond ONLY with a JSON object (no markdown):
{
  "plate": "<NZ plate string or null>",
  "confidence": <0.0-1.0>,
  "make": "<manufacturer or null>",
  "model": "<model or null>",
  "colour": "<colour or null>",
  "year_approx": <integer or null>,
  "self_contained": <true if clearly a motorhome/campervan/caravan, otherwise false>
}`,
          },
        ],
      },
    ],
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(requestBody),
      },
    };

    const reqHttp = https.request(options, (resp) => {
      let raw = '';
      resp.on('data', (chunk) => (raw += chunk));
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const content = parsed.choices?.[0]?.message?.content ?? '';
          // Strip any accidental markdown fences
          const cleaned = content.replace(/```json\n?|```/g, '').trim();
          resolve(JSON.parse(cleaned));
        } catch {
          resolve(null);
        }
      });
    });

    reqHttp.on('error', () => resolve(null));
    reqHttp.write(requestBody);
    reqHttp.end();
  });
}

// ============================================================================
// Utility: decode base64 / data URL to Buffer
// ============================================================================

function decodeBase64(str) {
  const b64 = str.includes(',') ? str.split(',')[1] : str;
  return Buffer.from(b64, 'base64');
}

// ============================================================================
// POST /infer  — accepts multipart OR JSON { image_base64 }
// ============================================================================

app.post('/infer', upload.single('photo'), async (req, res) => {
  const startTime = Date.now();

  if (!modelsLoaded) {
    return res.status(503).json({
      success: false,
      error: 'Models not loaded — run npm run download-models then restart',
      degraded: true,
    });
  }

  try {
    // ── Resolve image buffer from multipart OR JSON ──────────────────────
    let imageBuffer;
    if (req.file) {
      imageBuffer = req.file.buffer;
    } else if (req.body?.image_base64) {
      imageBuffer = decodeBase64(req.body.image_base64);
    } else {
      return res.status(400).json({ success: false, error: 'No image provided. Send multipart photo field or JSON image_base64.' });
    }

    console.log(`📸 Processing image (${imageBuffer.length} bytes)`);

    // ── 1. Detect vehicle (bounding box) ─────────────────────────────────
    const detection = await detectVehicle(imageBuffer);
    if (!detection) {
      return res.status(404).json({
        success: false,
        error: 'No vehicle detected in photo',
        suggestion: 'Ensure photo contains a clearly visible vehicle',
      });
    }
    console.log(`✅ Vehicle detected (conf: ${detection.confidence.toFixed(3)})`);

    // ── 2. Generate 384-D embedding ───────────────────────────────────────
    const { embedding, quality, norm } = await generateEmbedding(imageBuffer, detection.bbox);
    console.log(`✅ Embedding generated (quality: ${quality.toFixed(3)}, dim: ${embedding.length})`);

    // ── 3. Optional: OpenAI Vision plate + metadata ───────────────────────
    let metadata = null;
    if (OPENAI_API_KEY) {
      try {
        metadata = await extractVehicleMetadata(imageBuffer);
        if (metadata) console.log(`✅ OpenAI Vision: plate=${metadata.plate} make=${metadata.make}`);
      } catch (e) {
        console.warn('⚠️  OpenAI Vision failed (non-fatal):', e.message);
      }
    }

    const duration = Date.now() - startTime;

    return res.json({
      success: true,
      // Vehicle embedding (store in observations.vehicle_embedding)
      embedding,
      embedding_quality: quality,
      embedding_model_version: 'yolov8n_mobilenetv3_v1.0',
      // Detection bounding box
      detection: {
        confidence: detection.confidence,
        bbox: detection.bbox,
        class: detection.class,
      },
      // Plate + vehicle metadata (null if OpenAI not configured)
      plate: metadata?.plate ?? null,
      plate_confidence: metadata?.confidence ?? null,
      vehicle_make: metadata?.make ?? null,
      vehicle_model: metadata?.model ?? null,
      vehicle_colour: metadata?.colour ?? null,
      vehicle_year: metadata?.year_approx ?? null,
      self_contained: metadata?.self_contained ?? false,
      // Processing info
      processing_time_ms: duration,
      openai_vision_used: !!OPENAI_API_KEY,
    });

  } catch (error) {
    console.error('❌ Inference error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// GET /health
// ============================================================================

app.get('/health', (_req, res) => {
  res.json({
    status: modelsLoaded ? 'healthy' : 'degraded',
    models: {
      yolo: yoloSession ? 'loaded' : 'not loaded',
      embedding: embeddingSession ? 'loaded' : 'not loaded',
    },
    openai_vision: !!OPENAI_API_KEY,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// ============================================================================
// Error handler
// ============================================================================

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ============================================================================
// Start
// ============================================================================

loadModels().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ORC/AI inference service running on port ${PORT}`);
    console.log(`🧠 Models: ${modelsLoaded ? 'loaded' : 'NOT LOADED — degraded mode'}`);
    console.log(`🔍 OpenAI Vision: ${OPENAI_API_KEY ? 'enabled' : 'disabled (set OPENAI_API_KEY to enable plate extraction)'}`);
  });
});
