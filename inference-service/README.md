# 🚀 ORC/AI Inference Service

**Vehicle Detection + Embedding Generation**

This microservice processes vehicle photos to generate 384-dimensional embeddings for similarity matching.

---

## **Architecture**

```
┌─────────────────┐
│  Supabase Edge  │
│   orc-ingest    │
└────────┬────────┘
         │ POST /infer
         │ (photo)
         ↓
┌─────────────────┐
│ Inference Svc   │
│  (This service) │
│                 │
│  YOLOv8n        │─→ Detect vehicle
│  MobileNetV3    │─→ Generate 384D embedding
└────────┬────────┘
         │
         ↓ Returns:
    {
      embedding: [0.123, ...],
      quality: 0.87,
      confidence: 0.92
    }
```

---

## **Quick Start**

### **1. Install Dependencies**

```bash
npm install
```

### **2. Download Pretrained Models**

```bash
# Create models directory
mkdir -p models

# Download YOLOv8n (vehicle detection)
curl -L https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx \
  -o models/yolov8n.onnx

# Download MobileNetV3 (embeddings)
curl -L https://github.com/onnx/models/raw/main/vision/classification/mobilenet/model/mobilenetv3-large-1.0.onnx \
  -o models/mobilenet_v3.onnx
```

### **3. Configure Environment**

```bash
cp .env.example .env
# Edit .env with your Supabase URL
```

### **4. Run Locally**

```bash
npm start
```

Service runs on http://localhost:3000

---

## **API Reference**

### **POST /infer**

Generate vehicle embedding from photo.

**Request:**
```bash
curl -X POST http://localhost:3000/infer \
  -F "photo=@vehicle.jpg"
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "embedding": [0.123, 0.456, ...],  // 384 floats
    "embedding_quality": 0.87,
    "embedding_model_version": "yolov8n_mobilenetv3_v1.0",
    "detection": {
      "confidence": 0.92,
      "bbox": { "x": 120, "y": 80, "width": 300, "height": 200 },
      "class": 2
    },
    "metadata": {
      "norm": 8.6,
      "dimension": 384,
      "processing_time_ms": 245
    }
  }
}
```

**Error (404):**
```json
{
  "error": "No vehicle detected",
  "suggestion": "Ensure photo contains a clear vehicle"
}
```

---

### **GET /health**

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "models": {
    "yolo": "loaded",
    "embedding": "loaded"
  },
  "uptime": 12345.67,
  "memory": { ... }
}
```

---

## **Deployment**

### **Option 1: Fly.io (Recommended)**

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Create app
fly launch --name orc-ai-inference

# Set secrets
fly secrets set ALLOWED_ORIGINS="https://your-project.supabase.co"

# Deploy
fly deploy

# Get URL
fly info
# Example: https://orc-ai-inference.fly.dev
```

**Cost:** ~$5-10/month (shared-cpu-1x, 256MB RAM)

---

### **Option 2: Render**

1. Go to https://render.com
2. Click **New** → **Web Service**
3. Connect GitHub repo
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Add `ALLOWED_ORIGINS`
5. Deploy

**Cost:** $7/month (Starter plan)

---

### **Option 3: Railway**

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy
railway up

# Get URL
railway domain
```

**Cost:** $5/month (Hobby plan)

---

## **Testing**

### **Local Test**

```bash
# Start service
npm start

# Test with sample image
curl -X POST http://localhost:3000/infer \
  -F "photo=@test-vehicle.jpg" \
  | jq .
```

### **Production Test**

```bash
# Replace with your deployed URL
INFERENCE_URL="https://orc-ai-inference.fly.dev"

curl -X POST $INFERENCE_URL/infer \
  -F "photo=@vehicle.jpg" \
  | jq .
```

---

## **Performance**

**Typical Processing Times:**
- Vehicle detection (YOLOv8n): ~50-100ms
- Embedding generation (MobileNetV3): ~100-150ms
- **Total:** ~200-300ms per photo

**Throughput:**
- Single CPU: ~3-5 requests/second
- With load balancing: ~30-50 requests/second

---

## **Model Details**

### **YOLOv8n (Vehicle Detection)**
- **Size:** 6.2 MB
- **Input:** 640x640 RGB image
- **Output:** Bounding boxes + class probabilities
- **Classes:** Car (2), Motorcycle (3), Bus (5), Truck (7)

### **MobileNetV3-Large (Embeddings)**
- **Size:** 21 MB
- **Input:** 224x224 RGB image (cropped vehicle)
- **Output:** 384D feature vector
- **Normalization:** ImageNet mean/std

---

## **Monitoring**

### **Logs**

```bash
# Fly.io
fly logs

# Render
# Check dashboard

# Railway
railway logs
```

### **Metrics**

- Request count
- Average processing time
- Error rate
- Memory usage

---

## **Troubleshooting**

### **"No vehicle detected" errors**

**Causes:**
- Poor lighting
- Vehicle too small in frame
- Obstructed view

**Solutions:**
- Ask officer to retake photo
- Ensure vehicle fills ≥30% of frame
- Good lighting conditions

### **Slow inference (>1 second)**

**Causes:**
- CPU overload
- Large images (>5MB)

**Solutions:**
- Scale to more instances
- Resize images on client before upload
- Upgrade to CPU-optimized instance

### **Memory errors**

**Causes:**
- Too many concurrent requests
- Memory leak

**Solutions:**
- Add request queue (max 5 concurrent)
- Restart service daily (cron job)

---

## **Security**

### **CORS**

Only allow requests from your Supabase Edge Function:

```env
ALLOWED_ORIGINS=https://your-project.supabase.co
```

### **Rate Limiting**

Add rate limiting middleware (optional):

```bash
npm install express-rate-limit
```

```javascript
const rateLimit = require('express-rate-limit');

app.use('/infer', rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30 // Max 30 requests per minute
}));
```

---

## **Next Steps**

1. ✅ Deploy this service to Fly.io/Render
2. ✅ Test `/infer` endpoint with sample photos
3. ✅ Note the deployed URL (e.g., `https://orc-ai-inference.fly.dev`)
4. ⏭️ Create `orc-ingest` Edge Function to call this service
5. ⏭️ Update frontend to use `orc-ingest` instead of deleted ALPR

---

**Need help?** Check deployment guide in `PHASE_2_INFERENCE_SERVICE_SETUP.md`
