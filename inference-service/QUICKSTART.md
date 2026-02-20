# 🚀 Quick Start Guide - ORC/AI Inference Service

**Get running in 10 minutes**

---

## Prerequisites

- ✅ Node.js 18+ installed
- ✅ Git installed
- ✅ Terminal/command line access

---

## Step 1: Setup (2 minutes)

```bash
# Navigate to inference service
cd inference-service

# Install dependencies
npm install

# Download models (27 MB total)
npm run download-models
```

**Expected output:**
```
📥 Downloading YOLOv8n (6.2 MB)...
✅ YOLOv8n downloaded successfully
📥 Downloading MobileNetV3 (21 MB)...
✅ MobileNetV3 downloaded successfully
```

---

## Step 2: Test Locally (1 minute)

**Terminal 1 - Start server:**
```bash
npm start
```

**Terminal 2 - Run tests:**
```bash
chmod +x test-local.sh
./test-local.sh
```

**Expected output:**
```
✅ Models found
✅ Server is running
✅ Health check passed
✅ Inference successful!
   📊 Results:
      - Embedding Quality: 0.87
      - Detection Confidence: 0.92
      - Vector Dimension: 384
      - Processing Time: 245ms
🚀 Performance: GOOD (< 1 second)
✨ All tests passed! Ready for deployment.
```

**✅ If you see this, local testing is complete!**

---

## Step 3: Deploy to Production (5 minutes)

### **Option A: Fly.io (Recommended)**

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Deploy (will use fly.toml config)
fly deploy

# Get your URL
fly info
```

**Copy this URL - you'll need it:**
```
https://orc-ai-inference.fly.dev
```

**Set environment variable:**
```bash
fly secrets set ALLOWED_ORIGINS="https://xbfnlzmpumthnjmtqufp.supabase.co"
```

**Cost:** ~$5/month (Free tier available with credit card)

---

### **Option B: Render.com (Easier)**

1. Go to https://render.com
2. Sign up / login
3. Click **New** → **Web Service**
4. Connect your GitHub repo
5. Select `inference-service` directory
6. Click **Create Web Service**
7. In **Environment** tab, add:
   - `ALLOWED_ORIGINS` = `https://xbfnlzmpumthnjmtqufp.supabase.co`
8. Wait 5-10 minutes for deployment

**Your URL will be:**
```
https://orc-ai-inference.onrender.com
```

**Cost:** $7/month (Starter plan)

---

## Step 4: Test Production (2 minutes)

```bash
# Replace with YOUR deployed URL
INFERENCE_URL="https://orc-ai-inference.fly.dev"

# Test health
curl "$INFERENCE_URL/health" | jq .

# Test inference
curl -X POST "$INFERENCE_URL/infer" \
  -F "photo=@test-vehicle.jpg" \
  | jq .
```

**Expected:**
```json
{
  "success": true,
  "data": {
    "embedding_quality": 0.87,
    "embedding_model_version": "yolov8n_mobilenetv3_v1.0",
    ...
  }
}
```

**✅ If you see this, deployment is successful!**

---

## Step 5: Configure Supabase (1 minute)

```bash
# Set inference service URL in Supabase
supabase secrets set INFERENCE_SERVICE_URL="https://orc-ai-inference.fly.dev"

# Verify
supabase secrets list
```

---

## ✅ Success Checklist

- [ ] Models downloaded (27 MB)
- [ ] Local server starts without errors
- [ ] Local test script passes
- [ ] Deployed to Fly.io or Render
- [ ] Production health check returns "healthy"
- [ ] Production inference endpoint works
- [ ] `INFERENCE_SERVICE_URL` set in Supabase

---

## 🚨 Troubleshooting

### "Models not found"
```bash
npm run download-models
```

### "Server won't start"
```bash
# Check logs
npm start

# Common issue: Port 3000 in use
# Kill process: lsof -ti:3000 | xargs kill
```

### "Inference fails with 404"
- Photo must contain a visible vehicle
- Photo should be JPEG/PNG/WEBP
- Vehicle should fill ≥30% of frame

### "Deployment timeout on Render"
- Wait 10-15 minutes (ONNX models take time to load)
- Check logs in Render dashboard

---

## 📝 Next Steps

Once deployed, reply with:

```
✅ Inference service deployed
URL: https://orc-ai-inference.fly.dev
```

Then I'll proceed with:
- **Part B:** Deploy `orc-ingest` Edge Function
- **Part C:** Update frontend to use ORC/AI

---

**Need help?** Check full guide in `PHASE_2_INFERENCE_SERVICE_SETUP.md`
