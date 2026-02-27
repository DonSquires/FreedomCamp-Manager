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

// Configure CORS (restrict to your Supabase Edge Function)
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  methods: ['POST', 'GET'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

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

// Preprocess image for MobileNet (224x224)
async function preprocessForEmbedding(imageBuffer, bbox = null) {
  let pipeline = sharp(imageBuffer);

  // Crop to detected vehicle bbox if provided
  if (bbox) {
    const { x, y, width, height } = bbox;
    pipeline = pipeline.extract({
      left: Math.max(0, Math.floor(x)),
      top: Math.max(0, Math.floor(y)),
      width: Math.ceil(width),
      height: Math.ceil(height)
    });
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

// Main inference endpoint
app.post('/infer', upload.single('photo'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    if (!yoloSession || !embeddingSession) {
      return res.status(503).json({ error: 'Models not loaded — service is running in degraded mode' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
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
    const embeddingInput = await preprocessForEmbedding(req.file.buffer, detection.bbox);
    const { embedding, quality, norm } = await generateEmbedding(embeddingInput);

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
        }
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
  res.json({
    status: 'healthy',
    models: {
      yolo: yoloSession ? 'loaded' : 'not loaded',
      embedding: embeddingSession ? 'loaded' : 'not loaded'
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
    if (yoloSession && embeddingSession) {
      console.log(`📡 Ready to process vehicle photos`);
    } else {
      console.log(`⚠️  Running in degraded mode — /infer endpoint will return 503`);
    }
  });
});
