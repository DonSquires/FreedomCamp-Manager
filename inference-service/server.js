/**
 * ORC/AI Inference Service
 * Vehicle Detection + Embedding Generation
 * 
 * Stack:
 * - YOLOv8n (vehicle detection)
 * - MobileNetV3 (feature embedding)
 * - ONNX Runtime (inference engine)
 * 
 * API Endpoints:
 * - POST /infer - Generate vehicle embedding from photo
 * - GET /health - Health check
 */

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const YOLO_INPUT_SIZE = 640;
const VEHICLE_ATTRS_PROVIDER = (process.env.VEHICLE_ATTRS_PROVIDER || 'basic').toLowerCase();
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ATTR_TIMEOUT_MS = Number(process.env.ATTR_TIMEOUT_MS || 2500);
const TABULAR_NLP_PROVIDER = (process.env.TABULAR_NLP_PROVIDER || 'heuristic').toLowerCase();
const TABULAR_NLP_TIMEOUT_MS = Number(process.env.TABULAR_NLP_TIMEOUT_MS || 2500);
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const INFERENCE_API_KEY = process.env.INFERENCE_API_KEY || '';

// Configure CORS (restrict to your Supabase Edge Function)
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  methods: ['POST', 'GET'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

function requireInferenceApiKey(req, res, next) {
  if (!INFERENCE_API_KEY) return next();

  const header = req.get('x-inference-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!header || header !== INFERENCE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized inference request' });
  }

  return next();
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TABULAR_NLP_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
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
    });

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

app.post('/nlp/tabular/analyze', requireInferenceApiKey, async (req, res) => {
  try {
    const sampleRows = req.body?.sampleRows;
    if (!Array.isArray(sampleRows) || sampleRows.length === 0) {
      return res.status(400).json({ error: 'sampleRows must be a non-empty array' });
    }

    const analysis = TABULAR_NLP_PROVIDER === 'ollama'
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
  if (!OPENAI_API_KEY) {
    return null;
  }

  const imageBase64 = vehicleCropBuffer.toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTR_TIMEOUT_MS);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
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
    });

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

// Main inference endpoint
app.post('/infer', upload.single('photo'), async (req, res) => {
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
    
    if (!detection) {
      return res.status(404).json({ 
        error: 'No vehicle detected',
        suggestion: 'Ensure photo contains a clear vehicle'
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

// Health check
app.get('/health', (req, res) => {
  const modelsLoaded = !!(yoloSession && embeddingSession);
  res.json({
    status: 'healthy',
    models: {
      yolo: yoloSession ? 'loaded' : 'not loaded',
      embedding: embeddingSession ? 'loaded' : 'not loaded'
    },
    config: {
      VEHICLE_ATTRS_PROVIDER,
      OPENAI_BASE_URL: OPENAI_BASE_URL || null,
      OPENAI_MODEL: OPENAI_MODEL || null,
      OPENAI_API_KEY_SET: !!OPENAI_API_KEY,
    },
    capabilities: {
      plate_inference: modelsLoaded,
      ai_attributes: VEHICLE_ATTRS_PROVIDER === 'openai' && !!OPENAI_API_KEY,
      tabular_nlp: true,
    },
    uptime: process.uptime(),
    memory: process.memoryUsage()
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
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ORC/AI inference service running on port ${PORT}`);
    // Config summary — makes misconfiguration visible at a glance in Railway logs
    console.log(`⚙️  Config:`, {
      VEHICLE_ATTRS_PROVIDER,
      TABULAR_NLP_PROVIDER,
      TABULAR_NLP_TIMEOUT_MS,
      OLLAMA_BASE_URL,
      OLLAMA_MODEL,
      INFERENCE_API_KEY_SET: !!INFERENCE_API_KEY,
      OPENAI_BASE_URL: OPENAI_BASE_URL || '(not set)',
      OPENAI_MODEL: OPENAI_MODEL || '(not set)',
      OPENAI_API_KEY: OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0, 6)}…` : '(not set)',
    });
    if (yoloSession && embeddingSession) {
      console.log(`📡 Ready to process vehicle photos — YOLO + embedding models loaded`);
    } else {
      console.log(`⚠️  Running in degraded mode — ONNX models NOT loaded`);
      console.log(`   /infer returns 503. Fix: ensure model files (yolov8n.onnx, mobilenetv3.onnx) are present at startup.`);
      console.log(`   Vehicle attributes via OpenAI will still work if VEHICLE_ATTRS_PROVIDER=openai`);
    }
  });
});
