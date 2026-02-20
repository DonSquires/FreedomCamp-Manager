# 🚀 **Phase 2: Inference Service Setup - Complete Guide**

**Status:** Ready to Deploy  
**Timeline:** 2-3 days  
**Cost:** ~$5-20/month

---

## 📋 **What We're Building**

```
┌─────────────────────────────────────────────────────────┐
│                  ORC/AI Architecture                     │
└─────────────────────────────────────────────────────────┘

Frontend (PlateCapture.tsx, ZoomScan.tsx)
    │
    │ POST /orc-ingest
    │ (photo + metadata)
    ↓
┌──────────────────────┐
│  Supabase Edge Fn    │
│   orc-ingest         │
│                      │
│  1. Upload photo     │
│  2. Call inference   │
│  3. Store embedding  │
│  4. Find matches     │
└──────────┬───────────┘
           │
           │ POST /infer (photo)
           ↓
    ┌────────────────┐
    │ Inference Svc  │
    │  (Fly.io)      │
    │                │
    │  YOLOv8n       │─→ Detect vehicle
    │  MobileNetV3   │─→ Generate 384D vector
    └────────────────┘
```

---

## ✅ **Phase 2 Checklist**

### **Part A: Deploy Inference Service** (~2 days)

- [ ] Download pretrained ONNX models
- [ ] Test inference service locally
- [ ] Deploy to Fly.io/Render
- [ ] Verify `/infer` endpoint works
- [ ] Note deployed URL

### **Part B: Deploy orc-ingest Edge Function** (~1 day)

- [ ] Configure INFERENCE_SERVICE_URL secret
- [ ] Deploy orc-ingest function
- [ ] Test with sample photo
- [ ] Verify embeddings stored in database

### **Part C: Update Frontend** (~1 day)

- [ ] Update PlateCapture.tsx to call orc-ingest
- [ ] Update ZoomScan.tsx to call orc-ingest
- [ ] Remove deprecated ALPRDiagnostic.tsx
- [ ] Test end-to-end workflow

---

## 🏗️ **Part A: Deploy Inference Service**

### **Step 1: Download Pretrained Models**

```bash
# Navigate to inference service directory
cd inference-service

# Create models directory
mkdir -p models

# Download YOLOv8n (6.2 MB)
curl -L https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx \
  -o models/yolov8n.onnx

# Download MobileNetV3 (21 MB)
curl -L https://github.com/onnx/models/raw/main/vision/classification/mobilenet/model/mobilenetv3-large-1.0.onnx \
  -o models/mobilenet_v3.onnx

# Verify downloads
ls -lh models/
# Expected:
# -rw-r--r--  6.2M yolov8n.onnx
# -rw-r--r-- 21.0M mobilenet_v3.onnx
```

---

### **Step 2: Test Locally**

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Start server
npm start

# Expected output:
# Loading ONNX models...
# ✅ YOLOv8n loaded
# ✅ MobileNetV3 loaded
# 🚀 Inference service running on port 3000
# 📡 Ready to process vehicle photos
```

**Test with sample image:**

```bash
# Download test vehicle photo
curl -L https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=640 \
  -o test-vehicle.jpg

# Test inference endpoint
curl -X POST http://localhost:3000/infer \
  -F "photo=@test-vehicle.jpg" \
  | jq .

# Expected response:
# {
#   "success": true,
#   "data": {
#     "embedding": [0.123, 0.456, ...],  // 384 numbers
#     "embedding_quality": 0.87,
#     "embedding_model_version": "yolov8n_mobilenetv3_v1.0",
#     "detection": {
#       "confidence": 0.92,
#       "bbox": { "x": 120, "y": 80, "width": 300, "height": 200 }
#     },
#     "metadata": {
#       "norm": 8.6,
#       "dimension": 384,
#       "processing_time_ms": 245
#     }
#   }
# }
```

**✅ If you see this response, local testing passed!**

---

### **Step 3: Deploy to Fly.io** (Recommended)

**Why Fly.io?**
- ✅ Free tier available ($5/month credit)
- ✅ Global edge network (low latency)
- ✅ Simple Docker deployment
- ✅ Built-in health checks

**Install Fly CLI:**

```bash
# macOS/Linux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```

**Login & Deploy:**

```bash
# Login to Fly.io
fly auth login

# Create app (replace with your preferred name)
fly launch --name orc-ai-inference --region sjc

# When prompted:
# - "Would you like to copy its configuration?" → No
# - "Would you like to set up a PostgreSQL database?" → No
# - "Would you like to set up an Upstash Redis database?" → No
# - "Would you like to deploy now?" → No (we need to configure first)

# Set environment variable
fly secrets set ALLOWED_ORIGINS="https://xbfnlzmpumthnjmtqufp.supabase.co"

# Deploy
fly deploy

# Wait for deployment (2-3 minutes)
# Expected output:
# ✅ Deployment successful!

# Get your service URL
fly info

# Example output:
# Hostname = orc-ai-inference.fly.dev
```

**Test deployed service:**

```bash
# Replace with your Fly.io URL
INFERENCE_URL="https://orc-ai-inference.fly.dev"

# Test health endpoint
curl $INFERENCE_URL/health | jq .

# Expected:
# {
#   "status": "healthy",
#   "models": {
#     "yolo": "loaded",
#     "embedding": "loaded"
#   },
#   "uptime": 123.45
# }

# Test inference endpoint
curl -X POST $INFERENCE_URL/infer \
  -F "photo=@test-vehicle.jpg" \
  | jq .
```

**✅ If health check passes, deployment successful!**

**Note your deployed URL** - you'll need it for Part B:
```
INFERENCE_SERVICE_URL=https://orc-ai-inference.fly.dev
```

---

### **Alternative: Deploy to Render** (Easier but Slower)

1. Go to https://render.com
2. Sign up/login
3. Click **New** → **Web Service**
4. Connect GitHub repo
5. Configure:
   - **Name:** `orc-ai-inference`
   - **Region:** Oregon (us-west)
   - **Branch:** main
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Starter ($7/month)
6. Add environment variable:
   - `ALLOWED_ORIGINS` = `https://xbfnlzmpumthnjmtqufp.supabase.co`
7. Click **Create Web Service**

**Wait 5-10 minutes for deployment**

Your URL will be: `https://orc-ai-inference.onrender.com`

---

## 🔧 **Part B: Deploy orc-ingest Edge Function**

### **Step 1: Configure Supabase Secret**

```bash
# Set inference service URL (use YOUR URL from Part A)
supabase secrets set INFERENCE_SERVICE_URL=https://orc-ai-inference.fly.dev

# Verify secret is set
supabase secrets list
# Expected output:
# INFERENCE_SERVICE_URL (set)
# SUPABASE_URL (set)
# SUPABASE_SERVICE_ROLE_KEY (set)
```

---

### **Step 2: Deploy Edge Function**

```bash
# Deploy orc-ingest function
supabase functions deploy orc-ingest

# Expected output:
# ✅ Deploying Function orc-ingest (project: xbfnlzmpumthnjmtqufp)
# ✅ Deployed!
```

---

### **Step 3: Test orc-ingest Function**

```bash
# Get your Supabase project URL
SUPABASE_URL="https://xbfnlzmpumthnjmtqufp.supabase.co"

# Get your anon key (from Supabase dashboard)
ANON_KEY="your_anon_key_here"

# Test orc-ingest with sample photo
curl -X POST "$SUPABASE_URL/functions/v1/orc-ingest" \
  -H "Authorization: Bearer $ANON_KEY" \
  -F "photo=@test-vehicle.jpg" \
  -F 'metadata={
    "organization_id": "your-org-id",
    "zone_id": "your-zone-id",
    "gps_latitude": -37.7870,
    "gps_longitude": 175.2793,
    "plate_number": "TEST123"
  }' \
  | jq .

# Expected response:
# {
#   "success": true,
#   "data": {
#     "observation_id": "abc-123-...",
#     "plate_number": "TEST123",
#     "photo_url": "https://...",
#     "embedding": {
#       "quality": 0.87,
#       "model": "yolov8n_mobilenetv3_v1.0",
#       "dimension": 384
#     },
#     "matches": [...]
#   }
# }
```

**✅ If you see `"success": true`, orc-ingest is working!**

---

### **Step 4: Verify Database**

```sql
-- Check latest observation has embedding
select 
  observation_id,
  plate_number,
  vehicle_embedding is not null as has_embedding,
  embedding_quality,
  embedding_model_version,
  recorded_at
from vehicle_observations_v2
order by recorded_at desc
limit 5;
```

**Expected:**
```
observation_id | plate_number | has_embedding | embedding_quality | model
---------------|--------------|---------------|-------------------|-------
abc-123...     | TEST123      | true          | 0.87              | yolov8n_mobilenetv3_v1.0
```

---

## 🎨 **Part C: Update Frontend** (Next Session)

I'll update these files in the next step:

1. **PlateCapture.tsx** - Replace ALPR call with orc-ingest
2. **ZoomScan.tsx** - Replace ALPR call with orc-ingest
3. **PlateScanner.tsx** - Update to use new workflow
4. **FlaggedVehicles.tsx** - Use embedding matches
5. **ALPRDiagnostic.tsx** - Delete (deprecated)

---

## 📊 **Current Progress**

**Phase 0: ALPR Deletion** ✅ Complete  
**Phase 1: Database Setup** ✅ Complete  
**Phase 2A: Inference Service** ⏳ In Progress  
**Phase 2B: orc-ingest Function** ⏸️ Next  
**Phase 2C: Frontend Updates** ⏸️ After 2B

---

## 🚀 **Next Steps**

**Complete Part A first:**

1. Download models to `inference-service/models/`
2. Test locally (`npm start`)
3. Deploy to Fly.io or Render
4. Test deployed `/infer` endpoint
5. Copy your deployment URL

**Once Part A is done, reply with:**
```
✅ Inference service deployed
URL: https://orc-ai-inference.fly.dev
```

Then I'll guide you through Part B (orc-ingest deployment) and Part C (frontend updates).

---

## 💰 **Cost Breakdown**

**Inference Service (Fly.io):**
- Shared CPU 1x: $5/month
- 256MB RAM: Included
- **Total:** ~$5/month

**Inference Service (Render):**
- Starter plan: $7/month
- **Total:** ~$7/month

**Supabase:**
- Edge Functions: Free (up to 500K requests/month)
- Storage: Free (up to 1GB)

**Total Monthly Cost:** $5-7

---

## 🎯 **Success Criteria**

Mark these when complete:

- [ ] Inference service runs locally
- [ ] Models load without errors
- [ ] `/infer` endpoint returns 384D embedding
- [ ] Service deployed to Fly.io/Render
- [ ] Health check passes in production
- [ ] orc-ingest Edge Function deployed
- [ ] Test photo creates observation with embedding
- [ ] match_vehicle() returns similar vehicles

---

**Ready to start Part A?** Reply when you've completed the model download and local testing! 🚀
